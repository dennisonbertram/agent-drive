import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptedSize } from './crypto-format.js';
import { AgentDriveApiError } from './client.js';
import { createMountBridge, resolveMountHelper, runLinuxMount } from './mount.js';

const DRIVE = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function entry(path: string, ciphertextSize: number, versionId = VERSION) {
  return {
    fileId: '33333333-3333-4333-8333-333333333333',
    versionId,
    path,
    ciphertextSize,
    agentId: 'agent',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: '2026-01-02T03:04:05.000Z',
  };
}

function mountedVersion(id: string, plaintextBytes: number) {
  return {
    id,
    path: '/file',
    ciphertextSize: encryptedSize(plaintextBytes),
    wrappedKey: 'synthetic-wrapped-key',
    agentId: 'synthetic-agent',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: '2026-01-02T03:04:05.000Z',
  };
}

async function scratch() {
  const path = await mkdtemp(join(tmpdir(), 'agent-drive-mount-test-'));
  dirs.push(path);
  return path;
}

describe('mount bridge', () => {
  it('lists one directory page with canonical single-component names and plaintext sizes', async () => {
    const client = {
      browse: vi.fn().mockResolvedValue({
        items: [
          {
            kind: 'folder' as const,
            path: '/notes/daily',
            items: 2,
            ciphertextSize: 0,
            createdAt: '',
          },
          entry('/notes/readme.txt', encryptedSize(5)),
        ],
        nextCursor: 'next-page',
      }),
      openRangeReader: vi.fn(),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(bridge.request({ id: 'a', op: 'list', path: '/notes' })).resolves.toEqual({
        id: 'a',
        ok: true,
        entries: [
          { name: 'daily', kind: 'directory', size: 0, mtimeMs: Date.parse('') || 0 },
          {
            name: 'readme.txt',
            kind: 'file',
            size: 5,
            mtimeMs: Date.parse('2026-01-02T03:04:05.000Z'),
            versionId: VERSION,
          },
        ],
        nextCursor: 'next-page',
      });
      expect(client.browse).toHaveBeenCalledWith(DRIVE, { folder: '/notes' });
      expect(client.openRangeReader).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });

  it('uses delimiter listing at the root so nested files are not treated as direct children', async () => {
    const client = {
      browse: vi.fn().mockResolvedValue({
        items: [
          { kind: 'folder' as const, path: '/nested', items: 1, ciphertextSize: 0, createdAt: '' },
          entry('/root.txt', encryptedSize(1)),
        ],
        nextCursor: null,
      }),
      openRangeReader: vi.fn(),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(bridge.request({ id: 1, op: 'list', path: '/' })).resolves.toMatchObject({
        ok: true,
        entries: [
          { name: 'nested', kind: 'directory' },
          { name: 'root.txt', kind: 'file' },
        ],
      });
      expect(client.browse).toHaveBeenCalledWith(DRIVE, { folder: '/' });
      expect(client.openRangeReader).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });

  it('reads bounded ranges through one version-pinned reader and closes it on unmount', async () => {
    const payload = Buffer.from('binary\0payload');
    const reader = {
      plaintextBytes: payload.byteLength,
      version: mountedVersion(VERSION, payload.byteLength),
      read: vi.fn(async (offset: number, size: number) => payload.subarray(offset, offset + size)),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi.fn().mockResolvedValue(reader),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(
        bridge.request({
          id: 1,
          op: 'read',
          path: '/notes/data.bin',
          versionId: VERSION,
          offset: 2,
          size: 4,
        }),
      ).resolves.toEqual({ id: 1, ok: true, data: payload.subarray(2, 6).toString('base64') });
      await expect(
        bridge.request({
          id: 2,
          op: 'read',
          path: '/notes/data.bin',
          versionId: VERSION,
          offset: 5,
          size: 4,
        }),
      ).resolves.toEqual({ id: 2, ok: true, data: payload.subarray(5, 9).toString('base64') });
      expect(client.openRangeReader).toHaveBeenCalledWith(DRIVE, '/notes/data.bin', VERSION, {
        signal: expect.any(AbortSignal),
      });
      expect(client.openRangeReader).toHaveBeenCalledTimes(1);
      expect(reader.read).toHaveBeenNthCalledWith(1, 2, 4);
      expect(reader.read).toHaveBeenNthCalledWith(2, 5, 4);
    } finally {
      await bridge.close();
    }
    expect(reader.close).toHaveBeenCalledTimes(1);
  });

  it('negotiates capabilities, stages bytes, and keeps a pinned read available after release', async () => {
    const payload = Buffer.from([0, 255, 17, 128]);
    let released = false;
    let writtenBytes: Uint8Array | undefined;
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'handle-1',
        recoveryPath: '/private/stage',
        size: 0,
      })),
      write: vi.fn(async (_handleId: string, _offset: number, bytes: Uint8Array) => {
        writtenBytes = Uint8Array.from(bytes);
        return { bytesWritten: bytes.byteLength };
      }),
      truncate: vi.fn(async (_handleId: string, size: number) => ({ size })),
      readStaged: vi.fn(async (_handleId: string, offset: number, size: number) => {
        if (released) throw Object.assign(new Error('closed'), { code: 'EBADF' });
        return {
          data: payload.subarray(offset, offset + size),
          eof: offset + size >= payload.byteLength,
        };
      }),
      flush: vi.fn(async () => ({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        path: '/docs/new.bin',
      })),
      release: vi.fn(async () => {
        released = true;
        return {};
      }),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const reader = {
      version: mountedVersion('cccccccc-cccc-4ccc-8ccc-cccccccccccc', payload.byteLength),
      plaintextBytes: payload.byteLength,
      read: vi.fn(async (offset: number, size: number) => payload.subarray(offset, offset + size)),
      close: vi.fn(async () => {}),
    };
    const client = { browse: vi.fn(), openRangeReader: vi.fn(async () => reader) };
    const capabilities = {
      readOnly: false,
      write: true,
      delete: false,
      writePaths: ['/docs'],
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      ops: [
        'capabilities',
        'stat',
        'list',
        'read',
        'openWrite',
        'write',
        'truncate',
        'readStaged',
        'flush',
        'release',
        'mkdir',
        'rename',
      ],
    };
    const bridge = await createMountBridge(client, DRIVE, { capabilities, writeback });
    try {
      await expect(bridge.request({ id: 5, op: 'capabilities' })).resolves.toEqual({
        id: 5,
        ok: true,
        capabilities,
      });
      await expect(
        bridge.request({ id: 6, op: 'openWrite', path: '/outside/no.txt', baseVersionId: null }),
      ).resolves.toMatchObject({ id: 6, ok: false, errno: 'EACCES' });
      await expect(
        bridge.request({
          id: 7,
          op: 'openWrite',
          path: '/docs/new.bin',
          baseVersionId: null,
          truncateOnOpen: true,
        }),
      ).resolves.toMatchObject({ id: 7, ok: true, handleId: 'handle-1', size: 0 });
      expect(writeback.openWrite).toHaveBeenCalledWith(
        '/docs/new.bin',
        null,
        undefined,
        true,
        true,
      );
      await expect(
        bridge.request({
          id: 8,
          op: 'write',
          handleId: 'handle-1',
          offset: 0,
          data: payload.toString('base64'),
        }),
      ).resolves.toMatchObject({ id: 8, ok: true, bytesWritten: payload.byteLength });
      await expect(
        bridge.request({
          id: 9,
          op: 'read',
          path: '/docs/new.bin',
          versionId: 'staged:handle-1',
          offset: 1,
          size: 2,
        }),
      ).resolves.toEqual({ id: 9, ok: true, data: payload.subarray(1, 3).toString('base64') });
      await expect(
        bridge.request({ id: 10, op: 'flush', handleId: 'handle-1' }),
      ).resolves.toMatchObject({
        id: 10,
        ok: true,
        version: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', path: '/docs/new.bin' },
      });
      await expect(
        bridge.request({ id: 11, op: 'release', handleId: 'handle-1' }),
      ).resolves.toMatchObject({ id: 11, ok: true });
      await expect(
        bridge.request({
          id: 12,
          op: 'read',
          path: '/docs/new.bin',
          versionId: 'staged:handle-1',
          offset: 0,
          size: 4,
        }),
      ).resolves.toEqual({ id: 12, ok: true, data: payload.toString('base64') });
      expect(client.openRangeReader).toHaveBeenCalledWith(
        DRIVE,
        '/docs/new.bin',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        {
          signal: expect.any(AbortSignal),
        },
      );
      expect(Array.from(writtenBytes ?? [])).toEqual(Array.from(payload));
    } finally {
      await bridge.close();
    }
  });

  it('overlays only direct staged files and keeps remote directories on a name collision', async () => {
    const client = {
      browse: vi.fn().mockResolvedValue({
        items: [
          {
            kind: 'folder' as const,
            path: '/docs/collision',
            items: 1,
            ciphertextSize: 0,
            createdAt: '',
          },
        ],
        nextCursor: null,
      }),
      openRangeReader: vi.fn(),
    };
    const writeback = {
      openWrite: vi.fn(),
      write: vi.fn(),
      truncate: vi.fn(),
      readStaged: vi.fn(),
      flush: vi.fn(),
      release: vi.fn(),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
      listStaged: vi.fn(async (folder?: string) =>
        folder === '/docs'
          ? [
              {
                path: '/docs/collision',
                size: 4,
                handleId: 'stage-1',
                recoveryPath: '/private/a',
                state: 'dirty',
              },
              {
                path: '/docs/new.txt',
                size: 2,
                handleId: 'stage-2',
                recoveryPath: '/private/b',
                state: 'dirty',
              },
            ]
          : [],
      ),
    };
    const bridge = await createMountBridge(client, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: [],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        ops: [],
      },
      writeback,
    });
    try {
      await expect(
        bridge.request({ id: 'overlay', op: 'list', path: '/docs' }),
      ).resolves.toMatchObject({
        ok: true,
        entries: [
          { name: 'collision', kind: 'directory' },
          { name: 'new.txt', kind: 'file', size: 2, versionId: 'staged:stage-2' },
        ],
      });
      await expect(
        bridge.request({ id: 'collision-stat', op: 'stat', path: '/docs/collision' }),
      ).resolves.toMatchObject({
        ok: true,
        entry: { name: 'collision', kind: 'directory' },
      });
      expect(writeback.listStaged).toHaveBeenCalledWith('/docs');
    } finally {
      await bridge.close();
    }
  });

  it('requires delete capability for unlink, rmdir, and replacement rename', async () => {
    const client = {
      browse: vi.fn(),
      openRangeReader: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
      rename: vi.fn(),
    };
    const writeback = {
      openWrite: vi.fn(),
      write: vi.fn(),
      truncate: vi.fn(),
      readStaged: vi.fn(),
      flush: vi.fn(),
      release: vi.fn(),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge(client, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: ['/docs'],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        ops: [],
      },
      writeback,
    });
    try {
      await expect(
        bridge.request({ id: 1, op: 'unlink', path: '/docs/a', ifVersionId: VERSION }),
      ).resolves.toMatchObject({ errno: 'EACCES' });
      await expect(
        bridge.request({ id: 2, op: 'rmdir', path: '/docs/sub' }),
      ).resolves.toMatchObject({ errno: 'EACCES' });
      await expect(
        bridge.request({
          id: 3,
          op: 'rename',
          path: '/docs/a',
          destinationPath: '/docs/b',
          ifSourceVersionId: VERSION,
          ifDestinationVersionId: 'v2',
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).resolves.toMatchObject({ errno: 'EACCES' });
      expect(client.unlink).not.toHaveBeenCalled();
      expect(client.rmdir).not.toHaveBeenCalled();
      expect(client.rename).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });

  it('forwards the canonical mkdir, rmdir, unlink, and no-replace rename RPCs', async () => {
    const sourceVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const mutations = {
      mkdir: vi.fn(async (_driveId: string, path: string) => ({
        path,
        directory_id: 'directory-1',
        created_at: '2026-11-26T00:00:00.000Z',
      })),
      rmdir: vi.fn(async (_driveId: string, path: string) => ({ path })),
      unlink: vi.fn(async (_driveId: string, path: string, ifVersionId: string) => ({
        id: 'file-1',
        path,
        deleted_at: '2026-11-26T00:00:00.000Z',
        ifVersionId,
      })),
      rename: vi.fn(
        async (
          _driveId: string,
          _path: string,
          destinationPath: string,
          options: {
            ifSourceVersionId: string;
            ifDestinationVersionId: string | null;
            operationId: string;
          },
        ) => ({ id: 'file-2', path: destinationPath, versionId: options.ifSourceVersionId }),
      ),
    };
    const writeback = {
      openWrite: vi.fn(),
      write: vi.fn(),
      truncate: vi.fn(),
      readStaged: vi.fn(),
      flush: vi.fn(),
      release: vi.fn(),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge(
      { browse: vi.fn(), openRangeReader: vi.fn(), ...mutations },
      DRIVE,
      {
        capabilities: {
          readOnly: false,
          write: true,
          delete: true,
          writePaths: ['/docs'],
          maxReadBytes: 1024 * 1024,
          maxWriteBytes: 1024 * 1024,
          ops: [],
        },
        writeback,
      },
    );
    try {
      await expect(
        bridge.request({ id: 1, op: 'mkdir', path: '/docs/new-folder' }),
      ).resolves.toEqual({
        id: 1,
        ok: true,
        entry: {
          path: '/docs/new-folder',
          directory_id: 'directory-1',
          created_at: '2026-11-26T00:00:00.000Z',
        },
      });
      await expect(
        bridge.request({ id: 2, op: 'rmdir', path: '/docs/old-folder' }),
      ).resolves.toEqual({
        id: 2,
        ok: true,
        entry: { path: '/docs/old-folder' },
      });
      await expect(
        bridge.request({ id: 3, op: 'unlink', path: '/docs/old.txt', ifVersionId: sourceVersion }),
      ).resolves.toMatchObject({
        id: 3,
        ok: true,
        entry: { path: '/docs/old.txt', ifVersionId: sourceVersion },
      });
      await expect(
        bridge.request({
          id: 4,
          op: 'rename',
          path: '/docs/source.txt',
          destinationPath: '/docs/target.txt',
          ifSourceVersionId: sourceVersion,
          ifDestinationVersionId: null,
          operationId,
        }),
      ).resolves.toEqual({
        id: 4,
        ok: true,
        entry: { id: 'file-2', path: '/docs/target.txt', versionId: sourceVersion },
      });
      expect(mutations.mkdir).toHaveBeenCalledWith(DRIVE, '/docs/new-folder');
      expect(mutations.rmdir).toHaveBeenCalledWith(DRIVE, '/docs/old-folder');
      expect(mutations.unlink).toHaveBeenCalledWith(DRIVE, '/docs/old.txt', sourceVersion);
      expect(mutations.rename).toHaveBeenCalledWith(DRIVE, '/docs/source.txt', '/docs/target.txt', {
        ifSourceVersionId: sourceVersion,
        ifDestinationVersionId: null,
        operationId,
      });
    } finally {
      await bridge.close();
    }
  });

  it('flushes a saved temporary file before guarded replacement rename and preserves conflicts', async () => {
    let released = false;
    let destination = 'original destination bytes';
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'temp-handle',
        recoveryPath: '/private/temp',
        size: 0,
      })),
      write: vi.fn(async (_handleId: string, _offset: number, data: Uint8Array) => ({
        bytesWritten: data.byteLength,
      })),
      truncate: vi.fn(async (_handleId: string, size: number) => ({ size })),
      readStaged: vi.fn(async () => ({ data: new Uint8Array(), eof: true })),
      flush: vi.fn(async () => ({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        path: '/docs/.temp123',
      })),
      release: vi.fn(async () => {
        released = true;
        return {};
      }),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const rename = vi.fn(
      async (
        _drive: string,
        _source: string,
        _destination: string,
        options: { ifSourceVersionId: string; ifDestinationVersionId: string | null },
      ) => {
        expect(options.ifSourceVersionId).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
        expect(options.ifDestinationVersionId).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        throw new AgentDriveApiError('conflict', 409, 'The destination changed.');
      },
    );
    const client = { browse: vi.fn(), openRangeReader: vi.fn(), rename };
    const bridge = await createMountBridge(client, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: true,
        writePaths: ['/docs'],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        ops: [],
      },
      writeback,
    });
    try {
      await expect(
        bridge.request({
          id: 1,
          op: 'openWrite',
          path: '/docs/.temp123',
          baseVersionId: null,
          truncateOnOpen: true,
        }),
      ).resolves.toMatchObject({ ok: true, handleId: 'temp-handle' });
      await bridge.request({
        id: 2,
        op: 'write',
        handleId: 'temp-handle',
        offset: 0,
        data: Buffer.from('new file bytes').toString('base64'),
      });
      await expect(
        bridge.request({ id: 3, op: 'release', handleId: 'temp-handle' }),
      ).resolves.toMatchObject({ ok: true });
      expect(released).toBe(true);
      await expect(
        bridge.request({
          id: 4,
          op: 'rename',
          path: '/docs/.temp123',
          destinationPath: '/docs/document.txt',
          ifSourceVersionId: 'staged:temp-handle',
          ifDestinationVersionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      ).resolves.toMatchObject({ id: 4, ok: false, errno: 'ESTALE' });
      expect(rename).toHaveBeenCalledTimes(1);
      expect(writeback.flush).toHaveBeenCalledTimes(1);
      expect(destination).toBe('original destination bytes');
    } finally {
      destination = 'original destination bytes';
      await bridge.close();
    }
  });

  it('returns conflict version and durable recovery path after a failed flush', async () => {
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'conflict-handle',
        recoveryPath: '/private/recovery.bin',
        size: 1,
      })),
      write: vi.fn(async () => ({ bytesWritten: 0 })),
      truncate: vi.fn(async (_handleId: string, size: number) => ({ size })),
      readStaged: vi.fn(async () => ({ data: new Uint8Array([1]), eof: true })),
      flush: vi.fn(async () => {
        throw Object.assign(new Error('stale'), {
          code: 'ESTALE',
          recoveryPath: '/private/recovery.bin',
          currentVersionId: 'remote-v2',
        });
      }),
      release: vi.fn(async () => ({ recoveryPath: '/private/recovery.bin' })),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: ['/docs'],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        ops: [],
      },
      writeback,
    });
    try {
      await bridge.request({
        id: 'open',
        op: 'openWrite',
        path: '/docs/file',
        baseVersionId: null,
      });
      await expect(
        bridge.request({ id: 'flush', op: 'flush', handleId: 'conflict-handle' }),
      ).resolves.toEqual({
        id: 'flush',
        ok: false,
        errno: 'ESTALE',
        recoveryPath: '/private/recovery.bin',
        currentVersionId: 'remote-v2',
      });
    } finally {
      await bridge.close();
    }
  });

  it('maps structured billing and storage limits to quota errors while keeping recovery paths', async () => {
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'limit-handle',
        recoveryPath: '/private/recovery.bin',
        size: 1,
      })),
      write: vi.fn(async () => ({ bytesWritten: 0 })),
      truncate: vi.fn(async (_handleId: string, size: number) => ({ size })),
      readStaged: vi.fn(async () => ({ data: new Uint8Array([1]), eof: true })),
      flush: vi.fn(),
      release: vi.fn(async () => ({ recoveryPath: '/private/recovery.bin' })),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: ['/docs'],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        ops: [],
      },
      writeback,
    });
    try {
      await bridge.request({
        id: 'open',
        op: 'openWrite',
        path: '/docs/file',
        baseVersionId: null,
      });

      const failures = [
        { error: new AgentDriveApiError('payment_required', 402, 'spend cap'), errno: 'EDQUOT' },
        { error: new AgentDriveApiError('quota_exceeded', 413, 'drive quota'), errno: 'ENOSPC' },
        { error: new AgentDriveApiError('unauthorized', 401, 'unauthorized'), errno: 'EACCES' },
        { error: new AgentDriveApiError('permission_denied', 403, 'denied'), errno: 'EACCES' },
        { error: new AgentDriveApiError('conflict', 409, 'changed'), errno: 'ESTALE' },
        { error: new AgentDriveApiError('internal_error', 500, 'temporary failure'), errno: 'EIO' },
        { error: Object.assign(new Error('file too large'), { code: 'EFBIG' }), errno: 'EFBIG' },
      ];

      for (const [index, failure] of failures.entries()) {
        writeback.flush.mockRejectedValueOnce(
          Object.assign(failure.error, { recoveryPath: '/private/recovery.bin' }),
        );
        await expect(
          bridge.request({ id: `flush-${index}`, op: 'flush', handleId: 'limit-handle' }),
        ).resolves.toEqual({
          id: `flush-${index}`,
          ok: false,
          errno: failure.errno,
          recoveryPath: '/private/recovery.bin',
        });
      }
    } finally {
      await bridge.close();
    }
  });

  it('closes the active reader before replacing it with another pinned file', async () => {
    const firstReader = {
      plaintextBytes: 1,
      version: mountedVersion(VERSION, 1),
      read: vi.fn(async () => new Uint8Array([1])),
      close: vi.fn(async () => {}),
    };
    const secondVersion = '44444444-4444-4444-8444-444444444444';
    const secondReader = {
      plaintextBytes: 1,
      version: mountedVersion(secondVersion, 1),
      read: vi.fn(async () => new Uint8Array([2])),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi
        .fn()
        .mockResolvedValueOnce(firstReader)
        .mockResolvedValueOnce(secondReader),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await bridge.request({
        id: 1,
        op: 'read',
        path: '/first',
        versionId: VERSION,
        offset: 0,
        size: 1,
      });
      await bridge.request({
        id: 2,
        op: 'read',
        path: '/second',
        versionId: secondVersion,
        offset: 0,
        size: 1,
      });
      expect(firstReader.close).toHaveBeenCalledTimes(1);
      expect(secondReader.close).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
    expect(secondReader.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a reader for another version and maps missing pinned versions', async () => {
    const wrongReader = {
      plaintextBytes: 1,
      version: mountedVersion('55555555-5555-4555-8555-555555555555', 1),
      read: vi.fn(async () => new Uint8Array([9])),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi
        .fn()
        .mockResolvedValueOnce(wrongReader)
        .mockRejectedValueOnce(new AgentDriveApiError('file_not_found', 404, 'missing')),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(
        bridge.request({
          id: 1,
          op: 'read',
          path: '/file',
          versionId: VERSION,
          offset: 0,
          size: 1,
        }),
      ).resolves.toEqual({ id: 1, ok: false, errno: 'ESTALE' });
      expect(wrongReader.close).toHaveBeenCalledTimes(1);
      expect(wrongReader.read).not.toHaveBeenCalled();
      await expect(
        bridge.request({
          id: 2,
          op: 'read',
          path: '/missing',
          versionId: VERSION,
          offset: 0,
          size: 1,
        }),
      ).resolves.toEqual({ id: 2, ok: false, errno: 'ENOENT' });
    } finally {
      await bridge.close();
    }
  });

  it('passes abort through to the pinned reader and waits for an active read to cancel', async () => {
    const controller = new AbortController();
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => (markReadStarted = resolve));
    let readerSignal: AbortSignal | undefined;
    const reader = {
      plaintextBytes: 8,
      version: mountedVersion(VERSION, 8),
      read: vi.fn(
        () =>
          new Promise<Uint8Array>((_resolve, reject) => {
            markReadStarted();
            readerSignal?.addEventListener('abort', () => reject(readerSignal?.reason), {
              once: true,
            });
          }),
      ),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi.fn(
        async (
          _drive: string,
          _path: string,
          _version: string,
          options?: { signal?: AbortSignal },
        ) => {
          readerSignal = options?.signal;
          return reader;
        },
      ),
    };
    const bridge = await createMountBridge(client, DRIVE, { signal: controller.signal });
    const pending = bridge.request({
      id: 1,
      op: 'read',
      path: '/file',
      versionId: VERSION,
      offset: 0,
      size: 1,
    });
    await readStarted;
    controller.abort(new Error('synthetic interruption'));
    await expect(pending).resolves.toEqual({ id: 1, ok: false, errno: 'EIO' });
    await bridge.close();
    expect(readerSignal).toBeInstanceOf(AbortSignal);
    expect(readerSignal?.aborted).toBe(true);
    expect(reader.close).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight range read when the bridge closes', async () => {
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => (readStarted = resolve));
    let readerSignal: AbortSignal | undefined;
    const reader = {
      plaintextBytes: 1,
      version: mountedVersion(VERSION, 1),
      read: vi.fn(
        () =>
          new Promise<Uint8Array>((_resolve, reject) => {
            readStarted();
            readerSignal?.addEventListener('abort', () => reject(readerSignal?.reason), {
              once: true,
            });
          }),
      ),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi.fn(
        async (
          _drive: string,
          _path: string,
          _version: string,
          options?: { signal?: AbortSignal },
        ) => {
          readerSignal = options?.signal;
          return reader;
        },
      ),
    };
    const bridge = await createMountBridge(client, DRIVE);
    const pending = bridge.request({
      id: 1,
      op: 'read',
      path: '/file',
      versionId: VERSION,
      offset: 0,
      size: 1,
    });
    await started;
    await bridge.close();
    await expect(pending).resolves.toEqual({ id: 1, ok: false, errno: 'EIO' });
    expect(readerSignal?.aborted).toBe(true);
    expect(reader.close).toHaveBeenCalledTimes(1);
  });

  it('stats through partial pages and preserves numeric native request IDs', async () => {
    const target = entry('/target.txt', encryptedSize(2));
    const client = {
      browse: vi
        .fn()
        .mockResolvedValueOnce({ items: [], nextCursor: 'page-2' })
        .mockResolvedValueOnce({ items: [target], nextCursor: null }),
      openRangeReader: vi.fn(),
    };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(bridge.request({ id: 41, op: 'stat', path: '/target.txt' })).resolves.toEqual({
        id: 41,
        ok: true,
        entry: {
          name: 'target.txt',
          kind: 'file',
          size: 2,
          mtimeMs: Date.parse(target.createdAt),
          versionId: VERSION,
        },
      });
      expect(client.browse).toHaveBeenNthCalledWith(1, DRIVE, { folder: '/' });
      expect(client.browse).toHaveBeenNthCalledWith(2, DRIVE, {
        folder: '/',
        cursor: 'page-2',
      });
    } finally {
      await bridge.close();
    }
  });

  it('rejects unsafe paths, invalid ranges, and stale versions without reading', async () => {
    const client = { browse: vi.fn(), openRangeReader: vi.fn() };
    const bridge = await createMountBridge(client, DRIVE);
    try {
      await expect(
        bridge.request({ id: 'x', op: 'list', path: '/../secret' }),
      ).resolves.toMatchObject({
        id: 'x',
        ok: false,
        errno: 'EINVAL',
      });
      await expect(
        bridge.request({
          id: 'y',
          op: 'read',
          path: '/file',
          versionId: VERSION,
          offset: -1,
          size: 1,
        }),
      ).resolves.toMatchObject({ id: 'y', ok: false, errno: 'EINVAL' });
      await expect(
        bridge.request({
          id: 'z',
          op: 'read',
          path: '/file',
          versionId: VERSION,
          offset: 0,
          size: 1024 * 1024 + 1,
        }),
      ).resolves.toMatchObject({ id: 'z', ok: false, errno: 'EINVAL' });
      expect(client.openRangeReader).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });

  it('runs only the configured absolute helper and removes Agent Drive credentials from its env', async () => {
    const root = await scratch();
    const helper = join(root, 'mount-helper');
    await writeFile(
      helper,
      `#!/usr/bin/env node
const fs = require('node:fs');
if ((fs.statSync(process.argv[2]).mode & 0o777) !== 0o700) process.exit(92);
if (process.env.AGENT_DRIVE_API_KEY) process.exit(90);
process.stdout.write(JSON.stringify({ id: 8, op: 'list', path: '/' }) + '\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.includes('\\n')) {
    const response = JSON.parse(input.slice(0, input.indexOf('\\n')));
    if (response.id !== 8 || response.ok !== true || response.entries.length !== 0) process.exit(91);
    process.exit(0);
  }
});
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'synthetic-secret');
    const client = {
      browse: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      openRangeReader: vi.fn(),
    };
    await expect(
      runLinuxMount(client, DRIVE, join(root, 'mountpoint'), { helperPath: helper }),
    ).resolves.toBeUndefined();
    expect(client.browse).toHaveBeenCalledWith(DRIVE, { folder: '/' });
    await expect(stat(join(root, 'mountpoint'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('round-trips maximum read and write payloads over Linux NDJSON pipes', async () => {
    const root = await scratch();
    const helper = join(root, 'large-payload-helper');
    await writeFile(
      helper,
      `#!/usr/bin/env node
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin });
const responses = input[Symbol.asyncIterator]();
async function request(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
  const line = await responses.next();
  if (line.done) process.exit(70);
  return JSON.parse(line.value);
}
(async () => {
  if (process.argv[3] !== '--read-write') process.exit(71);
  const opened = await request({ id: 1, op: 'openWrite', path: '/docs/file.bin', baseVersionId: null });
  if (!opened.ok || opened.handleId !== 'large-handle') process.exit(72);
  const write = await request({ id: 2, op: 'write', handleId: 'large-handle', offset: 0, data: Buffer.alloc(1048576, 165).toString('base64') });
  if (!write.ok || write.bytesWritten !== 1048576) process.exit(73);
  const read = await request({ id: 3, op: 'read', path: '/docs/file.bin', versionId: 'v1', offset: 0, size: 1048576 });
  if (!read.ok || Buffer.from(read.data, 'base64').length !== 1048576 || !Buffer.from(read.data, 'base64').equals(Buffer.alloc(1048576, 165))) process.exit(74);
  process.exit(0);
})().catch(() => process.exit(75));
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    const expected = Buffer.alloc(1024 * 1024, 0xa5);
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'large-handle',
        recoveryPath: '/private/stage',
        size: 0,
      })),
      write: vi.fn(async (_id: string, _offset: number, bytes: Uint8Array) => ({
        bytesWritten: bytes.byteLength,
      })),
      truncate: vi.fn(),
      readStaged: vi.fn(),
      flush: vi.fn(),
      release: vi.fn(),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const client = {
      browse: vi.fn(),
      openRangeReader: vi.fn(async () => ({
        version: mountedVersion('v1', expected.byteLength),
        plaintextBytes: expected.byteLength,
        read: vi.fn(async (offset: number, size: number) =>
          expected.subarray(offset, offset + size),
        ),
        close: vi.fn(async () => {}),
      })),
    };
    await expect(
      runLinuxMount(client, DRIVE, join(root, 'mountpoint'), {
        helperPath: helper,
        readWrite: true,
        writeback,
        capabilities: {
          readOnly: false,
          write: true,
          delete: false,
          writePaths: ['/docs'],
          maxReadBytes: 1024 * 1024,
          maxWriteBytes: 1024 * 1024,
          ops: ['read', 'openWrite', 'write'],
        },
      }),
    ).resolves.toBeUndefined();
    expect(writeback.write).toHaveBeenCalledTimes(1);
    expect(writeback.write.mock.calls[0]?.[2]).toHaveLength(1024 * 1024);
  });

  it('requires an absolute configured helper and reports a missing executable before mounting', async () => {
    expect(() =>
      resolveMountHelper(import.meta.url, { AGENT_DRIVE_MOUNT_HELPER: 'mount-helper' }),
    ).toThrow('AGENT_DRIVE_MOUNT_HELPER must be an absolute path.');
    const root = await scratch();
    const client = { browse: vi.fn(), openRangeReader: vi.fn() };
    await expect(
      runLinuxMount(client, DRIVE, join(root, 'mountpoint'), {
        helperPath: join(root, 'missing-helper'),
      }),
    ).rejects.toThrow('The Agent Drive mount helper is missing or not executable.');
    expect(client.browse).not.toHaveBeenCalled();
  });

  it('reports a helper startup error without waiting for the shutdown grace period', async () => {
    const root = await scratch();
    const helper = join(root, 'unavailable-interpreter-helper');
    await writeFile(helper, '#!/agent-drive-test/missing-interpreter\n', { mode: 0o700 });
    await chmod(helper, 0o700);
    const startedAt = Date.now();

    await expect(
      runLinuxMount(
        { browse: vi.fn(), openRangeReader: vi.fn() },
        DRIVE,
        join(root, 'mountpoint'),
        { helperPath: helper },
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it('does not start a helper when cancellation was already requested', async () => {
    const root = await scratch();
    const helper = join(root, 'must-not-start-helper');
    const started = join(root, 'started');
    await writeFile(
      helper,
      `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started');
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    const controller = new AbortController();
    controller.abort();
    const mountPoint = join(root, 'mountpoint');

    await expect(
      runLinuxMount({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, mountPoint, {
        helperPath: helper,
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    await expect(readFile(started, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(mountPoint)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans an owned mountpoint even when writeback shutdown reports preserved recovery data', async () => {
    const root = await scratch();
    const helper = join(root, 'exit-helper');
    await writeFile(helper, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o700 });
    await chmod(helper, 0o700);
    const mountPoint = join(root, 'created-mountpoint');
    const writeback = {
      openWrite: vi.fn(),
      write: vi.fn(),
      truncate: vi.fn(),
      readStaged: vi.fn(),
      flush: vi.fn(),
      release: vi.fn(),
      listStaged: vi.fn(async () => []),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {
        throw new Error('Uncommitted local edits remain at /private/recovery.bin');
      }),
    };
    await expect(
      runLinuxMount({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, mountPoint, {
        helperPath: helper,
        writeback,
      }),
    ).rejects.toThrow('Uncommitted local edits remain');
    await expect(stat(mountPoint)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('terminates and reaps a helper that sends malformed protocol data', async () => {
    const root = await scratch();
    const helper = join(root, 'malformed-helper');
    await writeFile(
      helper,
      `#!/usr/bin/env node
process.stdout.write('not-json\\n');
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    await expect(
      runLinuxMount(
        { browse: vi.fn(), openRangeReader: vi.fn() },
        DRIVE,
        join(root, 'mountpoint'),
        {
          helperPath: helper,
        },
      ),
    ).rejects.toThrow('Mount helper sent malformed protocol data.');
  });

  it('keeps a healthy helper alive until abort and then allows graceful shutdown', async () => {
    const root = await scratch();
    const helper = join(root, 'healthy-long-lived-helper');
    const started = join(root, 'started');
    const terminated = join(root, 'terminated');
    await writeFile(
      helper,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(started)}, 'ready');
process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(terminated)}, 'graceful');
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    const controller = new AbortController();
    const mounting = runLinuxMount(
      { browse: vi.fn(), openRangeReader: vi.fn() },
      DRIVE,
      join(root, 'mountpoint'),
      { helperPath: helper, signal: controller.signal },
    );
    const result = mounting.then(
      () => 'resolved',
      () => 'rejected',
    );

    try {
      const startupDeadline = Date.now() + 5000;
      while (Date.now() < startupDeadline) {
        try {
          await readFile(started, 'utf8');
          break;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
      }
      await expect(readFile(started, 'utf8')).resolves.toBe('ready');
      await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
      expect(
        await Promise.race([
          result,
          new Promise((resolveWait) => setTimeout(() => resolveWait('running'), 0)),
        ]),
      ).toBe('running');
      await expect(readFile(terminated, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      controller.abort();
      await expect(mounting).resolves.toBeUndefined();
      await expect(readFile(terminated, 'utf8')).resolves.toBe('graceful');
    } finally {
      controller.abort();
      await mounting.catch(() => undefined);
    }
  });

  it('force-kills a helper that ignores SIGTERM only after explicit abort', async () => {
    const root = await scratch();
    const helper = join(root, 'stubborn-helper');
    const pidFile = join(root, 'pid');
    await writeFile(
      helper,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    await chmod(helper, 0o700);
    const controller = new AbortController();
    const mounting = runLinuxMount(
      { browse: vi.fn(), openRangeReader: vi.fn() },
      DRIVE,
      join(root, 'mountpoint'),
      { helperPath: helper, signal: controller.signal },
    );
    const result = mounting.then(
      () => 'resolved',
      () => 'rejected',
    );
    let helperPid: number | undefined;

    try {
      const startupDeadline = Date.now() + 5000;
      while (Date.now() < startupDeadline) {
        try {
          helperPid = Number(await readFile(pidFile, 'utf8'));
          break;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
      }
      expect(Number.isInteger(helperPid)).toBe(true);
      await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
      expect(
        await Promise.race([
          result,
          new Promise((resolveWait) => setTimeout(() => resolveWait('running'), 0)),
        ]),
      ).toBe('running');

      controller.abort();
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(() => process.kill(helperPid!, 0)).not.toThrow();
      await expect(mounting).resolves.toBeUndefined();
      expect(() => process.kill(helperPid!, 0)).toThrow();
    } finally {
      controller.abort();
      await mounting.catch(() => undefined);
    }
  });

  it('preserves existing mountpoints and rejects nonempty directories and symlinks', async () => {
    const root = await scratch();
    const helper = join(root, 'exit-helper');
    await writeFile(helper, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o700 });
    await chmod(helper, 0o700);
    const client = { browse: vi.fn(), openRangeReader: vi.fn() };

    const existing = join(root, 'existing');
    await mkdir(existing, { mode: 0o750 });
    await chmod(existing, 0o750);
    await runLinuxMount(client, DRIVE, existing, { helperPath: helper });
    expect((await stat(existing)).mode & 0o777).toBe(0o750);
    expect(await readdir(existing)).toEqual([]);

    const nonempty = join(root, 'nonempty');
    await mkdir(nonempty);
    await writeFile(join(nonempty, 'keep.txt'), 'keep');
    await expect(runLinuxMount(client, DRIVE, nonempty, { helperPath: helper })).rejects.toThrow(
      'Mountpoint must be empty.',
    );
    expect(await readFile(join(nonempty, 'keep.txt'), 'utf8')).toBe('keep');

    const target = join(root, 'target');
    const link = join(root, 'mount-link');
    await mkdir(target);
    await symlink(target, link);
    await expect(runLinuxMount(client, DRIVE, link, { helperPath: helper })).rejects.toThrow(
      'Mountpoint must be a real directory, not a symlink.',
    );
  });
});

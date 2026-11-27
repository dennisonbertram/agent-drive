import { describe, expect, it, vi } from 'vitest';
import { createMountBridge } from './mount.js';

const DRIVE = '11111111-1111-4111-8111-111111111111';

describe('Finder final flush retirement', () => {
  it('completes, uploads, and retires each Finder save in one mutation slot', async () => {
    const calls: string[] = [];
    let allowFirstFlush!: () => void;
    const firstFlush = new Promise<void>((resolve) => {
      allowFirstFlush = resolve;
    });
    let signalFirstFlush!: () => void;
    const firstFlushStarted = new Promise<void>((resolve) => {
      signalFirstFlush = resolve;
    });
    const writeback = {
      openWrite: vi.fn(async (path: string) => ({
        handleId: path === '/first' ? 'first-handle' : 'second-handle',
        recoveryPath: `/private/${path.slice(1)}.data`,
        size: 0,
      })),
      finalize: vi.fn(async (handleId: string) => {
        calls.push(`complete:${handleId}`);
        calls.push(`flush:start:${handleId}`);
        if (handleId === 'first-handle') {
          signalFirstFlush();
          await firstFlush;
        }
        calls.push(`flush:done:${handleId}`);
        calls.push(`close:${handleId}`);
        return {
          id:
            handleId === 'first-handle'
              ? '11111111-1111-4111-8111-111111111111'
              : '22222222-2222-4222-8222-222222222222',
          path: handleId === 'first-handle' ? '/first' : '/second',
        };
      }),
      release: vi.fn(async () => ({})),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: [],
        maxReadBytes: 1024,
        maxWriteBytes: 1024,
        ops: ['openWrite', 'finalizeWrite'],
      },
      writeback: writeback as never,
    });

    try {
      await bridge.request({
        id: 'open-first',
        op: 'openWrite',
        path: '/first',
        baseVersionId: null,
        incomplete: true,
      });
      await bridge.request({
        id: 'open-second',
        op: 'openWrite',
        path: '/second',
        baseVersionId: null,
        incomplete: true,
      });
      const first = bridge.request({
        id: 'finalize-first',
        op: 'finalizeWrite',
        handleId: 'first-handle',
        operationId: '11111111-1111-4111-8111-111111111111',
      });
      const firstStart = await Promise.race([
        firstFlushStarted.then(() => 'started' as const),
        first.then(() => 'rejected' as const),
      ]);
      expect(firstStart).toBe('started');
      const second = bridge.request({
        id: 'finalize-second',
        op: 'finalizeWrite',
        handleId: 'second-handle',
        operationId: '22222222-2222-4222-8222-222222222222',
      });

      allowFirstFlush();
      await expect(first).resolves.toMatchObject({
        id: 'finalize-first',
        ok: true,
        version: { id: '11111111-1111-4111-8111-111111111111' },
      });
      await expect(second).resolves.toMatchObject({
        id: 'finalize-second',
        ok: true,
        version: { id: '22222222-2222-4222-8222-222222222222' },
      });
      expect(writeback.finalize).toHaveBeenCalledTimes(2);
      expect(calls).toEqual([
        'complete:first-handle',
        'flush:start:first-handle',
        'flush:done:first-handle',
        'close:first-handle',
        'complete:second-handle',
        'flush:start:second-handle',
        'flush:done:second-handle',
        'close:second-handle',
      ]);
    } finally {
      allowFirstFlush();
      await bridge.close();
    }
  });

  it('lets a rejected stage close while an unrelated upload is still running', async () => {
    let finishFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      finishFlush = resolve;
    });
    let started!: () => void;
    const flushStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const closeWithoutFlush = vi.fn(async () => ({ recoveryPath: '/private/rejected.data' }));
    const writeback = {
      openWrite: vi.fn(async (path: string) => ({
        handleId: path === '/uploading' ? 'uploading-handle' : 'rejected-handle',
        recoveryPath: `/private/${path.slice(1)}.data`,
        size: 0,
      })),
      flush: vi.fn(async (handleId: string) => {
        if (handleId === 'uploading-handle') {
          started();
          await flushGate;
        }
        return { id: '33333333-3333-4333-8333-333333333333', path: '/uploading' };
      }),
      closeWithoutFlush,
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: [],
        maxReadBytes: 1024,
        maxWriteBytes: 1024,
        ops: ['openWrite', 'flush', 'closeWrite'],
      },
      writeback: writeback as never,
    });

    try {
      await bridge.request({
        id: 'open-upload',
        op: 'openWrite',
        path: '/uploading',
        baseVersionId: null,
      });
      await bridge.request({
        id: 'open-rejected',
        op: 'openWrite',
        path: '/rejected',
        baseVersionId: null,
      });
      const upload = bridge.request({ id: 'upload', op: 'flush', handleId: 'uploading-handle' });
      await flushStarted;
      const close = bridge.request({
        id: 'close-rejected',
        op: 'closeWrite',
        handleId: 'rejected-handle',
      });
      const closeResult = await Promise.race([
        close,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
      ]);
      expect(closeResult).toMatchObject({ id: 'close-rejected', ok: true });
      expect(closeWithoutFlush).toHaveBeenCalledWith('rejected-handle');
      finishFlush();
      await expect(upload).resolves.toMatchObject({ ok: true });
    } finally {
      finishFlush();
      await bridge.close();
    }
  });

  it('closes a non-submitted write handle without invoking flush or release', async () => {
    const writeback = {
      openWrite: vi.fn(async () => ({
        handleId: 'staged-handle',
        recoveryPath: '/private/staged.data',
        size: 0,
      })),
      flush: vi.fn(async () => ({ id: 'unexpected', path: '/doc.txt' })),
      release: vi.fn(async () => ({})),
      closeWithoutFlush: vi.fn(async () => ({ recoveryPath: '/private/staged.data' })),
      recover: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const bridge = await createMountBridge({ browse: vi.fn(), openRangeReader: vi.fn() }, DRIVE, {
      capabilities: {
        readOnly: false,
        write: true,
        delete: false,
        writePaths: [],
        maxReadBytes: 1024,
        maxWriteBytes: 1024,
        ops: ['openWrite', 'closeWrite'],
      },
      writeback: writeback as never,
    });

    try {
      const opened = await bridge.request({
        id: 'open',
        op: 'openWrite',
        path: '/doc.txt',
        baseVersionId: null,
        truncateOnOpen: true,
      });
      expect(opened).toMatchObject({ id: 'open', ok: true, handleId: 'staged-handle' });
      await expect(
        bridge.request({ id: 'close', op: 'closeWrite', handleId: 'staged-handle' }),
      ).resolves.toEqual({
        id: 'close',
        ok: true,
        recoveryPath: '/private/staged.data',
      });
      await expect(
        bridge.request({ id: 'close-again', op: 'closeWrite', handleId: 'staged-handle' }),
      ).resolves.toEqual({ id: 'close-again', ok: true });
      expect(writeback.closeWithoutFlush).toHaveBeenCalledWith('staged-handle');
      expect(writeback.closeWithoutFlush).toHaveBeenCalledTimes(1);
      expect(writeback.flush).not.toHaveBeenCalled();
      expect(writeback.release).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });
});

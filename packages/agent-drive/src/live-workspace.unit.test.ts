import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdtemp,
  link,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveWorkspaceProvider, LIVE_WORKSPACE_HELPER_SOURCE } from './live-workspace.js';

const roots: string[] = [];

async function startHelper(root: string) {
  const helperDir = await mkdtemp(join(tmpdir(), 'agent-drive-helper-'));
  roots.push(helperDir);
  const resolvedRoot = await realpath(root);
  const script = join(helperDir, '.helper.py');
  await writeFile(script, LIVE_WORKSPACE_HELPER_SOURCE, { mode: 0o600 });
  const child = spawn('python3', ['-u', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const lines = createInterface({ input: child.stdout! });
  const iterator = lines[Symbol.asyncIterator]();
  const send = async (request: Record<string, unknown>) => {
    child.stdin!.write(`${JSON.stringify(request)}\n`);
    const result = await iterator.next();
    if (result.done) throw new Error(`helper exited without a response: ${stderr}`);
    return JSON.parse(result.value) as Record<string, unknown>;
  };
  const init = await send({ id: 'init', op: 'init', root: resolvedRoot });
  if (!init.ok) throw new Error(`helper init failed: ${JSON.stringify(init)}`);
  return { child, send };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('live workspace helper', () => {
  it('filters Agent Drive credentials from setup and SSH child processes', async () => {
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'synthetic-drive-secret');
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', 'synthetic-drive-bundle');
    vi.stubEnv('AGENT_DRIVE_INSTABOX_CLI', '/opt/instabox/bin/instabox');
    vi.stubEnv('INSTABOX_API_KEY', 'ibk_synthetic-test-key');
    const environments: Array<Record<string, string | undefined>> = [];
    const invokedCommands: string[] = [];
    const cliPath = process.env.AGENT_DRIVE_INSTABOX_CLI!;
    class FakeChild extends EventEmitter {
      stdin = new PassThrough();
      stdout = new PassThrough();
      killed = false;
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      kill() {
        this.killed = true;
        this.signalCode = 'SIGTERM';
        this.stdout.end();
        queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
        return true;
      }
    }
    const fakeSpawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
      invokedCommands.push(command);
      environments.push(options.env ?? {});
      const child = new FakeChild();
      const isHelper = args.includes('python3');
      if (isHelper) {
        let pending = '';
        child.stdin.on('data', (chunk: Buffer) => {
          pending += chunk.toString('utf8');
          for (;;) {
            const newline = pending.indexOf('\n');
            if (newline < 0) break;
            const request = JSON.parse(pending.slice(0, newline)) as {
              id: string | number;
              op: string;
            };
            pending = pending.slice(newline + 1);
            child.stdout.write(
              `${JSON.stringify({
                id: request.id,
                ok: true,
                ...(request.op === 'init' ? { rootIdentity: 'synthetic-root-identity' } : {}),
                ...(request.op === 'list' ? { entries: [], nextCursor: null } : {}),
              })}\n`,
            );
          }
        });
      } else {
        const output = args.includes('sha256sum')
          ? `${createHash('sha256').update(LIVE_WORKSPACE_HELPER_SOURCE).digest('hex')}  ${args.at(-1)}\n`
          : args[0] === 'get'
            ? JSON.stringify({ id: 'm_synthetic', status: 'running' })
            : '';
        setImmediate(() => {
          child.stdout.end(output);
          child.exitCode = 0;
          child.emit('close', 0, null);
        });
      }
      return child as unknown as ReturnType<typeof spawn>;
    }) as typeof spawn;
    const provider = await createLiveWorkspaceProvider({
      sandboxId: 'synthetic-sandbox',
      root: '/tmp/synthetic-workspace',
      beforeIO: async () => undefined,
      spawnProcess: fakeSpawn,
    });
    try {
      await provider.dispatch({ id: 1, op: 'list', path: '/' });
      expect(environments.length).toBe(5);
      expect(invokedCommands).toEqual(Array.from({ length: 5 }, () => cliPath));
      for (const environment of environments) {
        expect(environment).not.toHaveProperty('AGENT_DRIVE_API_KEY');
        expect(environment).not.toHaveProperty('AGENT_DRIVE_CREDENTIALS');
        expect(environment).toMatchObject({
          INSTABOX_API_KEY: 'ibk_synthetic-test-key',
          INSTABOX_NO_TELEMETRY: '1',
        });
      }
    } finally {
      await provider.close();
    }
  });

  it('lists and reads only bounded ranges under the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
    roots.push(root);
    await writeFile(join(root, 'note.txt'), 'abcdefgh');
    const { child, send } = await startHelper(root);
    try {
      const listing = await send({ id: 1, op: 'list', path: '/' });
      expect(listing.ok).toBe(true);
      expect(listing.entries).toMatchObject([{ name: 'note.txt', kind: 'file', size: 8 }]);
      expect(await readdir(root)).toEqual(['note.txt']);
      const entry = await send({ id: 2, op: 'stat', path: '/note.txt' });
      expect((entry.entry as { versionId: string }).versionId).toMatch(/^[0-9a-f-]{36}$/);
      const read = await send({
        id: 3,
        op: 'read',
        path: '/note.txt',
        versionId: (entry.entry as { versionId: string }).versionId,
        offset: 2,
        size: 3,
      });
      expect(Buffer.from(read.data as string, 'base64').toString()).toBe('cde');
      expect(
        await send({ id: 4, op: 'read', path: '/../outside', offset: 0, size: 1 }),
      ).toMatchObject({
        ok: false,
        errno: 'EINVAL',
      });
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
    }
  });

  it('marks existing files read-only and rejects writes before creating staging state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
    roots.push(root);
    const file = join(root, 'settings.env');
    await writeFile(file, 'BASE=one\n');
    const { child, send } = await startHelper(root);
    try {
      const listing = await send({ id: 1, op: 'list', path: '/' });
      expect(listing.entries).toMatchObject([
        { name: 'settings.env', kind: 'file', readOnly: true },
      ]);
      const current = await send({ id: 2, op: 'stat', path: '/settings.env' });
      expect(current.entry).toMatchObject({ kind: 'file', readOnly: true });
      expect(
        await send({
          id: 3,
          op: 'openWrite',
          path: '/settings.env',
          baseVersionId: (current.entry as { versionId: string }).versionId,
        }),
      ).toMatchObject({ ok: false, errno: 'EROFS' });
      expect(await readdir(root)).toEqual(['settings.env']);

      await writeFile(file, 'BASE=changed\n');
      expect(
        await send({
          id: 4,
          op: 'openWrite',
          path: '/settings.env',
          baseVersionId: (current.entry as { versionId: string }).versionId,
        }),
      ).toMatchObject({ ok: false, errno: 'ESTALE' });
      expect(await readdir(root)).toEqual(['settings.env']);
      expect(await readFile(file, 'utf8')).toBe('BASE=changed\n');

      await mkdir(join(root, 'nested'));
      const directory = await send({ id: 5, op: 'stat', path: '/nested' });
      expect(directory.entry).toMatchObject({ kind: 'directory' });
      expect(directory.entry).not.toHaveProperty('readOnly');
      const newFile = await send({
        id: 6,
        op: 'openWrite',
        path: '/nested/new.env',
        baseVersionId: null,
      });
      expect(newFile.ok).toBe(true);
      await send({
        id: 7,
        op: 'write',
        handleId: newFile.handleId,
        offset: 0,
        data: Buffer.from('NEW=one\n').toString('base64'),
      });
      expect(
        await send({
          id: 8,
          op: 'flush',
          handleId: newFile.handleId,
          operationId: 'nested-create',
        }),
      ).toMatchObject({ ok: true });
      expect(await readFile(join(root, 'nested', 'new.env'), 'utf8')).toBe('NEW=one\n');
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
    }
  });

  it('creates a new .env with mode 0600 and rejects symlink and hardlink targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
    roots.push(root);
    const outside = join(root, '..', `outside-${process.pid}`);
    await writeFile(outside, 'outside');
    const { child, send } = await startHelper(root);
    try {
      const opened = await send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
        truncateOnOpen: true,
      });
      expect(opened.ok).toBe(true);
      const handleId = opened.handleId as string;
      expect(
        await send({
          id: 2,
          op: 'write',
          handleId,
          offset: 0,
          data: Buffer.from('API_KEY=synthetic-test-value\n').toString('base64'),
        }),
      ).toMatchObject({ ok: true, bytesWritten: 29 });
      const committed = await send({ id: 3, op: 'flush', handleId, operationId: 'op-env-create' });
      expect(committed).toMatchObject({ ok: true });
      expect(
        await send({ id: 6, op: 'flush', handleId, operationId: 'op-env-create' }),
      ).toMatchObject({
        ok: true,
        version: committed.version,
      });
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('API_KEY=synthetic-test-value\n');
      expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o600);
      await symlink(outside, join(root, 'link'));
      await link(outside, join(root, 'hardlink'));
      expect(await send({ id: 4, op: 'stat', path: '/link' })).toMatchObject({ ok: false });
      expect(await send({ id: 5, op: 'stat', path: '/hardlink' })).toMatchObject({ ok: false });
      expect(await readFile(outside, 'utf8')).toBe('outside');
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
      await rm(outside, { force: true });
    }
  });

  it('keeps an open staged handle readable after flush until release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
    roots.push(root);
    const { child, send } = await startHelper(root);
    const bytes = Buffer.from('FILE=written-and-flushed\n');
    try {
      const opened = await send({
        id: 1,
        op: 'openWrite',
        path: '/draft.env',
        baseVersionId: null,
        truncateOnOpen: true,
      });
      expect(opened.ok).toBe(true);
      expect(
        await send({
          id: 2,
          op: 'write',
          handleId: opened.handleId,
          offset: 0,
          data: bytes.toString('base64'),
        }),
      ).toMatchObject({ ok: true, bytesWritten: bytes.length });
      const flushed = await send({
        id: 3,
        op: 'flush',
        handleId: opened.handleId,
        operationId: 'linux-flush-readback',
      });
      expect(flushed.ok).toBe(true);
      expect(await readFile(join(root, 'draft.env'))).toEqual(bytes);

      const staged = await send({
        id: 4,
        op: 'readStaged',
        handleId: opened.handleId,
        offset: 0,
        size: bytes.length,
      });
      expect(staged.ok).toBe(true);
      expect(Buffer.from(staged.data as string, 'base64')).toEqual(bytes);
      expect(staged.eof).toBe(true);

      expect(
        await send({
          id: 5,
          op: 'release',
          handleId: opened.handleId,
          operationId: 'linux-flush-readback',
        }),
      ).toMatchObject({ ok: true, version: flushed.version });
      expect(await readdir(root)).toEqual(['draft.env']);
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
    }
  });

  it('preserves a competing create when a staged new file conflicts and keeps capabilities local', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
    roots.push(root);
    const file = join(root, '.env');
    const { child, send } = await startHelper(root);
    try {
      const opened = await send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
        truncateOnOpen: true,
      });
      await send({
        id: 2,
        op: 'write',
        handleId: opened.handleId,
        offset: 0,
        data: Buffer.from('API_KEY=staged-value\n').toString('base64'),
      });
      await writeFile(file, 'API_KEY=concurrent-value\n');
      expect(
        await send({ id: 3, op: 'flush', handleId: opened.handleId, operationId: 'op-conflict' }),
      ).toMatchObject({ ok: false, errno: 'ESTALE', recoveryPath: expect.any(String) });
      expect(await readFile(file, 'utf8')).toBe('API_KEY=concurrent-value\n');
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => undefined);
    }

    let wakes = 0;
    const received: Array<Record<string, unknown>> = [];
    const provider = await createLiveWorkspaceProvider({
      sandboxId: 'synthetic-sandbox',
      root,
      beforeIO: async () => {
        wakes += 1;
      },
      transport: {
        request: async (payload) => {
          received.push(payload);
          if (payload.op === 'read')
            return { id: payload.id as string | number, ok: true, data: 'eA==' };
          if (payload.op === 'openWrite')
            return {
              id: payload.id as string | number,
              ok: true,
              handleId: 'stage-one',
              recoveryPath: '/.stage',
              size: 0,
            };
          return { id: payload.id as string | number, ok: true, entries: [], nextCursor: null };
        },
        close: async () => undefined,
      },
    });
    expect((await provider.dispatch({ id: 'caps', op: 'capabilities' })).ok).toBe(true);
    expect(await provider.dispatch({ id: 'root', op: 'stat', path: '/' })).toMatchObject({
      ok: true,
      entry: { name: '', kind: 'directory' },
    });
    expect(wakes).toBe(0);
    expect((await provider.dispatch({ id: 'list', op: 'list', path: '/' })).ok).toBe(true);
    expect(wakes).toBe(1);
    expect((await provider.dispatch({ id: 'list-again', op: 'list', path: '/' })).ok).toBe(true);
    expect(wakes).toBe(1);
    const uuid = '01234567-89ab-4cde-8f01-23456789abcd';
    expect(
      (
        await provider.dispatch({
          id: 'read',
          op: 'read',
          path: '/.env',
          versionId: uuid,
          offset: 0,
          size: 1,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await provider.dispatch({ id: 'open', op: 'openWrite', path: '/.env', baseVersionId: uuid }))
        .ok,
    ).toBe(true);
    expect(received.map(({ op }) => op)).toEqual(['list', 'list', 'read', 'openWrite']);
    expect(wakes).toBe(1);
    await provider.close();
  });
});

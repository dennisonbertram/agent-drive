import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_WORKSPACE_HELPER_SOURCE } from './live-workspace.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

type Rpc = Record<string, unknown> & { id: string | number; op: string };

async function startHelper(inputRoot: string, rootIdentity?: string) {
  const root = await realpath(inputRoot);
  const helperDir = await mkdtemp(join(tmpdir(), 'agent-drive-helper-test-'));
  roots.push(helperDir);
  const script = join(helperDir, 'helper.py');
  await writeFile(script, LIVE_WORKSPACE_HELPER_SOURCE, { mode: 0o600 });
  const child = spawn('python3', ['-u', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const lines = createInterface({ input: child.stdout! });
  const iterator = lines[Symbol.asyncIterator]();
  const send = async (request: Rpc) => {
    child.stdin!.write(`${JSON.stringify(request)}\n`);
    const line = await iterator.next();
    if (line.done) throw new Error(`helper exited without a response: ${stderr}`);
    return JSON.parse(line.value) as Record<string, unknown>;
  };
  const init = await send({
    id: 'init',
    op: 'init',
    root,
    ...(rootIdentity ? { rootIdentity } : {}),
  });
  return {
    child,
    root,
    init,
    send,
    async stop() {
      child.stdin!.end();
      await once(child, 'exit').catch(() => undefined);
    },
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('live workspace embedded helper', () => {
  it('pins the registered root identity across helper sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-root-'));
    roots.push(root);
    const first = await startHelper(root);
    expect(first.init).toMatchObject({ ok: true, rootIdentity: expect.any(String) });
    const identity = first.init.rootIdentity as string;
    await first.stop();

    const moved = `${root}-moved`;
    await rename(root, moved);
    roots.push(moved);
    await mkdir(root);
    const second = await startHelper(root, identity);
    expect(second.init).toMatchObject({ ok: false, errno: 'ESTALE' });
    await second.stop();
  });

  it('rejects writes after fsync instead of silently losing acknowledged data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-fsync-'));
    roots.push(root);
    const helper = await startHelper(root);
    try {
      expect(helper.init.ok).toBe(true);
      const opened = await helper.send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
      });
      expect(typeof opened.recoveryPath).toBe('string');
      expect((opened.recoveryPath as string).slice(helper.root.length + 1)).toMatch(
        /^\.agent-drive-live-staging-v1-[a-f0-9]{32}\/stage-[a-f0-9]{32}$/,
      );
      const handleId = opened.handleId as string;
      await helper.send({
        id: 2,
        op: 'write',
        handleId,
        offset: 0,
        data: Buffer.from('FIRST=one\n').toString('base64'),
      });
      const flushed = await helper.send({ id: 3, op: 'flush', handleId });
      expect(flushed.ok).toBe(true);
      expect(
        await helper.send({
          id: 4,
          op: 'write',
          handleId,
          offset: 10,
          data: Buffer.from('SECOND=two\n').toString('base64'),
        }),
      ).toMatchObject({ ok: false, errno: 'EROFS' });
      const released = await helper.send({ id: 5, op: 'release', handleId });
      expect(released.ok, JSON.stringify(released)).toBe(true);
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('FIRST=one\n');
      expect(
        (await readdir(root)).filter((name) => name.startsWith('.agent-drive-live-staging-v1-')),
      ).toEqual([]);
    } finally {
      await helper.stop();
    }
  });

  it('finalizes once, removes staged plaintext, and supports an idempotent retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-finalize-'));
    roots.push(root);
    const helper = await startHelper(root);
    try {
      const opened = await helper.send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
      });
      expect(typeof opened.recoveryPath).toBe('string');
      expect((opened.recoveryPath as string).startsWith(`${helper.root}/`)).toBe(true);
      const handleId = opened.handleId as string;
      const operationId = '8d8c6617-6047-4d33-93b2-b9cc9dd3c08e';
      await helper.send({
        id: 2,
        op: 'write',
        handleId,
        offset: 0,
        data: Buffer.from('API_KEY=synthetic\n').toString('base64'),
      });
      const finalized = await helper.send({ id: 3, op: 'finalizeWrite', handleId, operationId });
      expect(finalized.ok).toBe(true);
      expect(
        await helper.send({ id: 4, op: 'finalizeWrite', handleId, operationId }),
      ).toMatchObject({
        ok: true,
        version: finalized.version,
      });
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('API_KEY=synthetic\n');
      expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o600);
      expect(
        (await readdir(root)).filter((name) => name.startsWith('.agent-drive-live-staging-v1-')),
      ).toEqual([]);
      expect((await readdir(root)).filter((name) => name.startsWith('commit-'))).toEqual([]);
    } finally {
      await helper.stop();
    }
  });

  it('cleans an uncommitted private stage when the helper disconnects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-disconnect-'));
    roots.push(root);
    const helper = await startHelper(root);
    const opened = await helper.send({
      id: 1,
      op: 'openWrite',
      path: '/.env',
      baseVersionId: null,
    });
    await helper.send({
      id: 2,
      op: 'write',
      handleId: opened.handleId as string,
      offset: 0,
      data: Buffer.from('API_KEY=synthetic-disconnect\n').toString('base64'),
    });
    await helper.stop();
    expect(
      (await readdir(root)).filter((name) => name.startsWith('.agent-drive-live-staging-v1-')),
    ).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith('commit-'))).toEqual([]);
  });

  it('keeps private stages invisible to an overlapping parent mount', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-overlap-'));
    roots.push(root);
    await mkdir(join(root, 'project'));
    const parent = await startHelper(root);
    const nested = await startHelper(join(root, 'project'));
    try {
      const opened = await nested.send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
      });
      const recoveryPath = opened.recoveryPath as string;
      expect(recoveryPath.startsWith(`${nested.root}/`)).toBe(true);
      const hiddenName = recoveryPath.slice(nested.root.length + 1).split('/')[0];
      const listing = await parent.send({ id: 2, op: 'list', path: '/project' });
      expect(listing.entries).toEqual([]);
      expect(
        await parent.send({ id: 3, op: 'stat', path: `/project/${hiddenName}` }),
      ).toMatchObject({ ok: false, errno: 'EACCES' });
    } finally {
      await parent.stop();
      await nested.stop();
    }
  });

  it('bounds encoded list pages and advances by a stable cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-pages-'));
    roots.push(root);
    await Promise.all(
      Array.from({ length: 600 }, (_, index) =>
        writeFile(join(root, `file-${String(index).padStart(4, '0')}`), 'x'),
      ),
    );
    const helper = await startHelper(root);
    try {
      const first = await helper.send({ id: 1, op: 'list', path: '/' });
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(60_000);
      expect(typeof first.nextCursor).toBe('string');
      const entries = [...(first.entries as Array<{ name: string }>)];
      let cursor = first.nextCursor as string | null;
      let requestId = 2;
      while (cursor) {
        const page = await helper.send({ id: requestId++, op: 'list', path: '/', cursor });
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(60_000);
        entries.push(...(page.entries as Array<{ name: string }>));
        cursor = page.nextCursor as string | null;
        expect(requestId).toBeLessThan(8);
      }
      expect(entries).toHaveLength(600);
      expect(new Set(entries.map(({ name }) => name)).size).toBe(600);
    } finally {
      await helper.stop();
    }
  });

  it('creates a directory safely and commits a child file without a project temp copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-mkdir-'));
    roots.push(root);
    const helper = await startHelper(root);
    try {
      expect(await helper.send({ id: 1, op: 'mkdir', path: '/agent' })).toMatchObject({ ok: true });
      expect((await stat(join(root, 'agent'))).mode & 0o777).toBe(0o700);
      const opened = await helper.send({
        id: 2,
        op: 'openWrite',
        path: '/agent/.env',
        baseVersionId: null,
      });
      const handleId = opened.handleId as string;
      await helper.send({
        id: 3,
        op: 'write',
        handleId,
        offset: 0,
        data: Buffer.from('API_KEY=synthetic\n').toString('base64'),
      });
      expect(
        await helper.send({
          id: 4,
          op: 'finalizeWrite',
          handleId,
          operationId: 'cf65f5fb-78a8-4d84-9011-96f9ac694ca3',
        }),
      ).toMatchObject({ ok: true });
      expect(await readFile(join(root, 'agent', '.env'), 'utf8')).toBe('API_KEY=synthetic\n');
      expect(await readdir(join(root, 'agent'))).toEqual(['.env']);
    } finally {
      await helper.stop();
    }
  });

  it('preserves failed new-file content at an absolute recovery path without visible commit temps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-conflict-'));
    roots.push(root);
    const helper = await startHelper(root);
    try {
      const opened = await helper.send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
      });
      const handleId = opened.handleId as string;
      const recoveryPath = opened.recoveryPath as string;
      expect(recoveryPath.startsWith(`${helper.root}/`)).toBe(true);
      const content = 'API_KEY=synthetic-conflict\n';
      await helper.send({
        id: 2,
        op: 'write',
        handleId,
        offset: 0,
        data: Buffer.from(content).toString('base64'),
      });
      await writeFile(join(root, '.env'), 'API_KEY=winner\n');
      expect(await helper.send({ id: 3, op: 'flush', handleId })).toMatchObject({
        ok: false,
        errno: 'ESTALE',
        recoveryPath,
      });
      expect(await readFile(recoveryPath, 'utf8')).toBe(content);
      expect((await readdir(root)).filter((name) => name.startsWith('commit-'))).toEqual([]);
    } finally {
      await helper.stop();
    }
  });

  it('ignores a stage in a git checkout before payload bytes are written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-live-git-'));
    roots.push(root);
    await execFileAsync('git', ['init', '--quiet', root]);
    const helper = await startHelper(root);
    try {
      const opened = await helper.send({
        id: 1,
        op: 'openWrite',
        path: '/.env',
        baseVersionId: null,
      });
      await helper.send({
        id: 2,
        op: 'write',
        handleId: opened.handleId as string,
        offset: 0,
        data: Buffer.from('API_KEY=synthetic\n').toString('base64'),
      });
      const { stdout } = await execFileAsync('git', ['-C', root, 'status', '--porcelain']);
      expect(stdout).toBe('');
      const stageDir = (opened.recoveryPath as string).slice(
        0,
        (opened.recoveryPath as string).lastIndexOf('/'),
      );
      expect(await readFile(join(stageDir, '.gitignore'), 'utf8')).toBe('*\n');
    } finally {
      await helper.stop();
    }
  });
});

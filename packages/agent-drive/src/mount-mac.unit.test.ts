import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMacMount } from './mount-mac.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-mac-mount-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeHelper(directory: string, source: string) {
  const helper = join(directory, 'AgentDriveFinder.mjs');
  await writeFile(helper, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  await chmod(helper, 0o700);
  return helper;
}

const waitForSignal = `
process.on('SIGTERM', () => {
  clearInterval(hold);
  process.exit(0);
});
const hold = setInterval(() => {}, 1000);
`;

describe('macOS Finder mount bridge', () => {
  it('keeps the helper control pipe open after the startup line', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const helper = await writeHelper(
      directory,
      `
const { createInterface } = await import('node:readline');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const line = await new Promise((resolve) => input.once('line', resolve));
input.close();
JSON.parse(line);
await new Promise((resolve) => setTimeout(resolve, 30));
if (process.stdin.readableEnded) process.exit(41);
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint: join(directory, 'requested-mount'),
      dispatch: async () => ({}),
    });

    await handle.close();
    expect(await handle.waitForExit()).toMatchObject({ code: 0 });
  }, 20_000);

  it('validates and dispatches the producer-completion write protocol over authenticated loopback RPC', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const requestedMountpoint = join(directory, 'requested-mount');
    const helper = await writeHelper(
      directory,
      `
const { createInterface } = await import('node:readline');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const line = await new Promise((resolve) => input.once('line', resolve));
input.close();
const startup = JSON.parse(line);
const endpoint = 'http://127.0.0.1:' + startup.port + '/rpc';
const headers = { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' };
const open = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ id: 'open-copy', op: 'openWrite', path: '/doc.txt', baseVersionId: 'base-v1', truncateOnOpen: true, incomplete: true }) });
const opened = await open.json();
if (open.status !== 200 || opened.handleId !== 'copy-handle') process.exit(41);
const invalid = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ id: 'bad-open', op: 'openWrite', path: '/doc.txt', baseVersionId: 'base-v1', incomplete: 'yes' }) });
if (invalid.status !== 400) process.exit(42);
const complete = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ id: 'complete-copy', op: 'completeWrite', handleId: 'copy-handle' }) });
if (complete.status !== 200 || (await complete.json()).id !== 'complete-copy') process.exit(43);
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    const dispatched: Array<Record<string, unknown>> = [];
    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint,
      dispatch: async (request) => {
        const rpc = request as Record<string, unknown>;
        dispatched.push(rpc);
        if (rpc.op === 'openWrite')
          return {
            id: rpc.id,
            ok: true,
            handleId: 'copy-handle',
            recoveryPath: '/tmp/synthetic-copy.data',
            size: 0,
          };
        return { id: rpc.id, ok: true };
      },
    });

    expect(dispatched).toEqual([
      {
        id: 'open-copy',
        op: 'openWrite',
        path: '/doc.txt',
        baseVersionId: 'base-v1',
        truncateOnOpen: true,
        incomplete: true,
      },
      { id: 'complete-copy', op: 'completeWrite', handleId: 'copy-handle' },
    ]);
    await handle.close();
    await expect(handle.waitForExit()).resolves.toMatchObject({ code: 0 });
  }, 20_000);

  it('uses a private helper handshake and serves only authenticated loopback POST /rpc', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const requestedMountpoint = join(directory, 'requested-mount');
    const helper = await writeHelper(
      directory,
      `
import { request as helperRequest } from 'node:http';
let input = '';
const startup = await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    input += chunk.toString();
    const newline = input.indexOf('\\n');
    if (newline >= 0) {
      process.stdin.off('data', onData);
      resolve(JSON.parse(input.slice(0, newline)));
    }
  };
  process.stdin.on('data', onData);
  process.stdin.on('error', reject);
});
if (Object.keys(startup).sort().join(',') !== 'driveId,port,token') process.exit(20);
if (startup.driveId !== 'synthetic-drive' || !Number.isInteger(startup.port) || typeof startup.token !== 'string') process.exit(21);
if (process.argv.includes(startup.token)) process.exit(22);
if (Object.keys(process.env).some((name) => name.startsWith('AGENT_DRIVE_'))) process.exit(23);
const endpoint = 'http://127.0.0.1:' + startup.port;
const headers = { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' };
const body = JSON.stringify({ id: 'one', op: 'stat', path: '/note.txt' });
const good = await fetch(endpoint + '/rpc', { method: 'POST', headers, body });
if (good.status !== 200 || (await good.json()).id !== 'one') process.exit(24);
const noAuth = await fetch(endpoint + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
if (noAuth.status !== 401) process.exit(25);
const badType = await fetch(endpoint + '/rpc', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body });
if (badType.status !== 415) process.exit(26);
const badOrigin = await fetch(endpoint + '/rpc', { method: 'POST', headers: { ...headers, origin: 'https://attacker.invalid' }, body });
if (badOrigin.status !== 403) process.exit(27);
const badRoute = await fetch(endpoint + '/other', { method: 'POST', headers, body });
if (badRoute.status !== 404) process.exit(28);
const badMethod = await fetch(endpoint + '/rpc', { method: 'GET', headers });
if (badMethod.status !== 405) process.exit(29);
const wrongHost = await new Promise((resolve, reject) => {
  const request = helperRequest({ host: '127.0.0.1', port: startup.port, method: 'POST', path: '/rpc', headers: { host: 'attacker.invalid:' + startup.port, ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (response) => {
    response.resume();
    response.once('end', () => resolve(response.statusCode));
  });
  request.once('error', reject);
  request.end(body);
});
if (wrongHost !== 403) process.exit(30);
const tooLarge = await new Promise((resolve, reject) => {
  const request = helperRequest({ host: '127.0.0.1', port: startup.port, method: 'POST', path: '/rpc', headers: { ...headers, 'content-length': '999999999' } }, (response) => {
    response.resume();
    response.once('end', () => resolve(response.statusCode));
  });
  request.once('error', reject);
  request.end(body);
});
if (tooLarge !== 413) process.exit(31);
const oversizedRead = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: JSON.stringify({ id: 'large', op: 'read', path: '/note.txt', versionId: 'v1', offset: 0, size: 1048577 }) });
if (oversizedRead.status !== 400) process.exit(32);
const capabilities = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: JSON.stringify({ id: 7, op: 'capabilities' }) });
if (capabilities.status !== 200 || (await capabilities.json()).id !== 7) process.exit(33);
const maxWriteBody = JSON.stringify({ id: 'max-write', op: 'write', handleId: 'h', offset: 0, data: Buffer.alloc(1048576).toString('base64') });
const maxWrite = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: maxWriteBody });
if (maxWrite.status !== 200) process.exit(34);
const oversizedWrite = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: JSON.stringify({ id: 'large-write', op: 'write', handleId: 'h', offset: 0, data: Buffer.alloc(1048577).toString('base64') }) });
if (oversizedWrite.status !== 400) process.exit(35);
const maxRead = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: JSON.stringify({ id: 'max-read', op: 'read', path: '/note.txt', versionId: 'v1', offset: 0, size: 1048576 }) });
if (maxRead.status !== 200 || (await maxRead.json()).data.length !== 1398104) process.exit(36);
const maxReadStaged = await fetch(endpoint + '/rpc', { method: 'POST', headers, body: JSON.stringify({ id: 'max-read-staged', op: 'readStaged', handleId: 'h', offset: 0, size: 1048576 }) });
if (maxReadStaged.status !== 200 || (await maxReadStaged.json()).data.length !== 1398104) process.exit(37);
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'must-not-reach-helper');
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', 'must-not-reach-helper');
    const dispatched: unknown[] = [];

    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint,
      dispatch: async (request) => {
        dispatched.push(request);
        const id = (request as { id: string | number }).id;
        const op = (request as { op: string }).op;
        if (op === 'capabilities')
          return {
            id,
            ok: true,
            capabilities: {
              readOnly: false,
              write: true,
              delete: true,
              writePaths: [],
              maxReadBytes: 1048576,
              maxWriteBytes: 1048576,
              ops: [],
            },
          };
        if (op === 'write') return { id, ok: true, bytesWritten: 1048576 };
        if (op === 'read') return { id, ok: true, data: Buffer.alloc(1048576).toString('base64') };
        if (op === 'readStaged')
          return { id, ok: true, data: Buffer.alloc(1048576).toString('base64'), eof: true };
        return { id, ok: true, entry: { name: 'note.txt', kind: 'file', size: 4, mtimeMs: 1 } };
      },
    });

    expect(handle.actualPath).toBe(actualPath);
    expect(await readlink(requestedMountpoint)).toBe(actualPath);
    expect(dispatched).toHaveLength(5);
    expect(dispatched[0]).toEqual({ id: 'one', op: 'stat', path: '/note.txt' });
    expect(dispatched[1]).toEqual({ id: 7, op: 'capabilities' });
    expect(dispatched[2]).toMatchObject({ id: 'max-write', op: 'write' });
    await handle.close();
    expect(await handle.waitForExit()).toMatchObject({ code: 0 });
    await expect(lstat(requestedMountpoint)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('leaves an existing matching symlink and occupied directory untouched', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const matching = join(directory, 'matching');
    const occupied = join(directory, 'occupied');
    await symlink(actualPath, matching);
    await mkdir(occupied);
    await writeFile(join(occupied, 'keep.txt'), 'keep');
    const helper = await writeHelper(
      directory,
      `
let input = '';
await new Promise((resolve) => process.stdin.once('data', (chunk) => {
  input += chunk.toString();
  resolve(JSON.parse(input.slice(0, input.indexOf('\\n'))));
}));
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);

    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint: matching,
      dispatch: async () => ({}),
    });
    await handle.close();
    expect(await readlink(matching)).toBe(actualPath);

    await expect(
      startMacMount({
        driveId: 'synthetic-drive',
        requestedMountpoint: occupied,
        dispatch: async () => ({}),
      }),
    ).rejects.toThrow();
    expect((await lstat(occupied)).isDirectory()).toBe(true);
    expect(await readFile(join(occupied, 'keep.txt'), 'utf8')).toBe('keep');
  }, 20_000);

  it('does not remove a requested path that replaced its owned alias during shutdown', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const requestedMountpoint = join(directory, 'requested-mount');
    const helper = await writeHelper(
      directory,
      `
let input = '';
await new Promise((resolve) => process.stdin.once('data', (chunk) => {
  input += chunk.toString();
  resolve(JSON.parse(input.slice(0, input.indexOf('\\n'))));
}));
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint,
      dispatch: async () => ({}),
    });

    await unlink(requestedMountpoint);
    await writeFile(requestedMountpoint, 'replacement');
    await handle.close();

    expect(await readFile(requestedMountpoint, 'utf8')).toBe('replacement');
  }, 20_000);

  it('aborts a pending dispatcher request when the RPC client disconnects', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const requestedMountpoint = join(directory, 'requested-mount');
    const helper = await writeHelper(
      directory,
      `
import { request as helperRequest } from 'node:http';
let input = '';
const startup = await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    input += chunk.toString();
    const newline = input.indexOf('\\n');
    if (newline >= 0) {
      process.stdin.off('data', onData);
      resolve(JSON.parse(input.slice(0, newline)));
    }
  };
  process.stdin.on('data', onData);
  process.stdin.on('error', reject);
});
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
setTimeout(() => {
  const request = helperRequest({ host: '127.0.0.1', port: startup.port, method: 'POST', path: '/rpc', headers: { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' } });
  request.end(JSON.stringify({ id: 'cancel-me', op: 'stat', path: '/note.txt' }));
  setTimeout(() => request.destroy(), 30);
}, 50);
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    let resolveAborted!: () => void;
    const aborted = new Promise<void>((resolvePromise) => {
      resolveAborted = resolvePromise;
    });
    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint,
      dispatch: async (_request, signal) =>
        await new Promise((resolvePromise) => {
          signal?.addEventListener(
            'abort',
            () => {
              resolveAborted();
              resolvePromise({ id: 'cancel-me', ok: false, errno: 'ECANCELED' });
            },
            { once: true },
          );
        }),
    });

    await expect(aborted).resolves.toBeUndefined();
    await handle.close();
  }, 20_000);

  it('returns the committed result from one bounded finalizeWrite operation after a slow upload', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const startupPath = join(directory, 'startup.json');
    const goPath = join(directory, 'start-flush');
    const resultPath = join(directory, 'flush-result.json');
    const helper = await writeHelper(
      directory,
      `
import { createInterface } from 'node:readline';
import { access, readFile, writeFile } from 'node:fs/promises';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const line = await new Promise((resolve) => input.once('line', resolve));
input.close();
const startup = JSON.parse(line);
await writeFile(${JSON.stringify(startupPath)}, JSON.stringify(startup));
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
while (true) {
  try { await access(${JSON.stringify(goPath)}); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
}
const endpoint = 'http://127.0.0.1:' + startup.port + '/rpc';
const headers = { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' };
const post = async (body) => await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
const initial = await (await post({ id: 'flush-start', op: 'finalizeWrite', handleId: 'slow-handle', operationId: '11111111-1111-4111-8111-111111111111' })).json();
if (!initial.pending || typeof initial.operationId !== 'string') {
  await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ initial }));
  process.exit(41);
}
const repeated = await (await post({ id: 'flush-retry', op: 'finalizeWrite', handleId: 'slow-handle', operationId: initial.operationId })).json();
if (!repeated.pending || repeated.operationId !== initial.operationId) process.exit(43);
const unrelated = await (await post({ id: 'while-pending', op: 'stat', path: '/note.txt' })).json();
if (!unrelated.ok) process.exit(44);
let result;
for (let count = 0; count < 200; count++) {
  result = await (await post({ id: 'flush-status-' + count, op: 'flushStatus', handleId: 'slow-handle', operationId: initial.operationId })).json();
  if (!result.pending) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ initial, result }));
process.exit(result.ok && result.version?.id === 'committed-v1' ? 0 : 42);
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    let startDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      startDispatch = resolve;
    });
    let finishUnrelated!: () => void;
    const unrelatedDispatched = new Promise<void>((resolve) => {
      finishUnrelated = resolve;
    });
    let finishDispatch!: (value: unknown) => void;
    let dispatchCalls = 0;
    let closeWriteCalls = 0;
    const dispatchResult = new Promise<unknown>((resolve) => {
      finishDispatch = resolve;
    });
    const handle = await startMacMount({
      driveId: 'synthetic-drive',
      requestedMountpoint: join(directory, 'requested-mount'),
      dispatch: async (request) => {
        const rpc = request as Record<string, unknown>;
        if (rpc.op === 'closeWrite') {
          closeWriteCalls += 1;
          return { id: rpc.id, ok: true };
        }
        if (rpc.op === 'stat') {
          finishUnrelated();
          return { id: (request as Record<string, unknown>).id, ok: true, entry: {} };
        }
        dispatchCalls += 1;
        expect(request).toMatchObject({ op: 'finalizeWrite', handleId: 'slow-handle' });
        startDispatch();
        return await dispatchResult;
      },
    });
    const startup = JSON.parse(await readFile(startupPath, 'utf8')) as {
      port: number;
      token: string;
    };
    vi.useFakeTimers();
    try {
      await writeFile(goPath, 'go');
      await dispatchStarted;
      await unrelatedDispatched;
      await vi.advanceTimersByTimeAsync(20_001);
      finishDispatch({
        id: 'flush-start',
        ok: true,
        version: { id: 'committed-v1', path: '/slow.bin' },
      });
      await expect(handle.waitForExit()).resolves.toMatchObject({ code: 0 });
      const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
        initial: Record<string, unknown>;
        result: Record<string, unknown>;
      };
      expect(result.initial).toMatchObject({ id: 'flush-start', ok: true, pending: true });
      expect(result.result).toMatchObject({
        id: expect.stringMatching(/^flush-status-/),
        ok: true,
        version: { id: 'committed-v1', path: '/slow.bin' },
      });
      expect(startup.port).toBeGreaterThan(0);
      expect(startup.token).toBeTruthy();
      expect(dispatchCalls).toBe(1);
      expect(closeWriteCalls).toBe(0);
    } finally {
      vi.useRealTimers();
      await handle.close();
    }
  }, 20_000);
});

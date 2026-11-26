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
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
${waitForSignal}
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
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
${waitForSignal}
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
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
${waitForSignal}
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
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
${waitForSignal}
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
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)} }) + '\\n');
setTimeout(() => {
  const request = helperRequest({ host: '127.0.0.1', port: startup.port, method: 'POST', path: '/rpc', headers: { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' } });
  request.end(JSON.stringify({ id: 'cancel-me', op: 'stat', path: '/note.txt' }));
  setTimeout(() => request.destroy(), 30);
}, 50);
${waitForSignal}
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
});

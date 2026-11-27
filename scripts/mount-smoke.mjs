#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  open,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { encryptFile, generateDriveKey } from '../packages/agent-drive/dist/crypto.js';

const execFileAsync = promisify(execFile);
const helperPath = process.argv[2];
assert(helperPath, 'usage: node scripts/mount-smoke.mjs <agent-drive-mount-binary> [cli-js]');
assert.equal(process.platform, 'linux', 'the FUSE smoke must run inside Linux');

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(
  process.argv[3] ?? join(repositoryRoot, 'packages/agent-drive/dist/cli.js'),
);
const fixtureDriveId = 'synthetic-mount-drive';
const fixtureToken = 'synthetic-mount-token';
const fixtureKey = generateDriveKey();
const fixtureAgentId = 'synthetic-mount-agent';
const fixtureDate = '2026-01-02T03:04:05.000Z';
const pageSize = 2;

const makeBytes = (length, seed) =>
  Buffer.from(Array.from({ length }, (_, index) => (index * 73 + seed * 19) & 0xff));
const plaintext = {
  changingV1: makeBytes(48_123, 7),
  changingV2: makeBytes(65_537, 13),
  current: makeBytes(2_381, 17),
  empty: Buffer.alloc(0),
  normal: Buffer.from('synthetic mounted file\n'),
  nested: Buffer.from('synthetic nested file\n'),
};
const versionRecords = new Map();
const pathVersions = new Map([
  ['/changing.bin', 'synthetic-v1'],
  ['/current.bin', 'synthetic-current'],
  ['/empty.bin', 'synthetic-empty'],
  ['/normal.txt', 'synthetic-normal'],
  ['/nested/leaf.txt', 'synthetic-leaf'],
]);
let changingVersion = 'synthetic-v1';
let listRequestCount = 0;
const listRequests = [];
const listSnapshots = [];
let getMetadataRequests = [];
let storageRequests = [];
let writeRequests = 0;
let unauthorizedRequests = 0;
let whoamiRequestCount = 0;

async function addVersion(path, id, data, timestamp = fixtureDate) {
  const encrypted = await encryptFile(data, fixtureKey);
  versionRecords.set(id, {
    id,
    path,
    ciphertext: Buffer.from(encrypted.ciphertext),
    wrappedKey: encrypted.wrappedKey,
    createdAt: timestamp,
  });
}

await addVersion('/changing.bin', 'synthetic-v1', plaintext.changingV1, '2026-01-02T03:04:05.000Z');
await addVersion('/changing.bin', 'synthetic-v2', plaintext.changingV2, '2026-01-03T03:04:05.000Z');
await addVersion('/current.bin', 'synthetic-current', plaintext.current);
await addVersion('/empty.bin', 'synthetic-empty', plaintext.empty);
await addVersion('/normal.txt', 'synthetic-normal', plaintext.normal);
await addVersion('/nested/leaf.txt', 'synthetic-leaf', plaintext.nested);

function fileRow(path) {
  const versionId = path === '/changing.bin' ? changingVersion : pathVersions.get(path);
  const version = versionRecords.get(versionId);
  return {
    id: `file-${versionId}`,
    path,
    version_id: versionId,
    ciphertext_size: version.ciphertext.byteLength,
    agent_id: fixtureAgentId,
    machine_id: null,
    user_id: null,
    tags: [],
    description: null,
    created_at: version.createdAt,
  };
}

function childrenFor(prefix) {
  const folder = prefix || '/';
  if (folder === '/') {
    return [
      fileRow('/changing.bin'),
      fileRow('/current.bin'),
      fileRow('/empty.bin'),
      { kind: 'folder', path: '/nested', items: 1, ciphertext_size: 0, created_at: fixtureDate },
      fileRow('/normal.txt'),
    ];
  }
  if (folder === '/nested') return [fileRow('/nested/leaf.txt')];
  return [];
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/v1/')) {
    if (request.headers.authorization !== `Bearer ${fixtureToken}`) {
      unauthorizedRequests += 1;
      json(response, 401, {
        error: { code: 'unauthorized', message: 'Synthetic fixture rejected the request.' },
      });
      return;
    }
    if (request.method !== 'GET') {
      writeRequests += 1;
      json(response, 403, {
        error: { code: 'forbidden', message: 'Synthetic fixture is read-only.' },
      });
      return;
    }
    if (url.pathname === '/api/v1/whoami') {
      whoamiRequestCount += 1;
      json(response, 200, {
        accountId: 'synthetic-mount-account',
        agentId: fixtureAgentId,
        keyId: 'synthetic-mount-key',
        scopes: ['read'],
        writePaths: [],
        driveIds: [fixtureDriveId],
      });
      return;
    }
    if (url.pathname === '/api/v1/drives') {
      json(response, 200, {
        items: [
          {
            id: fixtureDriveId,
            name: 'synthetic',
            quota_bytes: 1_000_000,
            created_at: fixtureDate,
            agentOnly: true,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    const listMatch = url.pathname.match(/^\/api\/v1\/drives\/([^/]+)\/list$/u);
    if (listMatch) {
      assert.equal(decodeURIComponent(listMatch[1]), fixtureDriveId);
      listRequestCount += 1;
      const prefix = url.searchParams.get('prefix') ?? '/';
      const cursor = url.searchParams.get('cursor');
      listRequests.push({ prefix, cursor });
      const offset = cursor === null ? 0 : Number(cursor.slice('cursor-'.length));
      const items = childrenFor(prefix);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(1, items.length)) {
        json(response, 400, {
          error: { code: 'invalid_cursor', message: 'Invalid synthetic cursor.' },
        });
        return;
      }
      const page = items.slice(offset, offset + pageSize);
      listSnapshots.push({
        prefix,
        changingVersion: page.find((item) => item.path === '/changing.bin')?.version_id,
      });
      const nextOffset = offset + page.length;
      json(response, 200, {
        items: page,
        nextCursor: nextOffset < items.length ? `cursor-${nextOffset}` : null,
      });
      return;
    }
    const getMatch = url.pathname.match(/^\/api\/v1\/drives\/([^/]+)\/get$/u);
    if (getMatch) {
      assert.equal(decodeURIComponent(getMatch[1]), fixtureDriveId);
      const path = url.searchParams.get('path');
      const requestedVersion = url.searchParams.get('versionId');
      const versionId =
        requestedVersion ?? (path === '/changing.bin' ? changingVersion : pathVersions.get(path));
      const version = versionRecords.get(versionId);
      if (!version || version.path !== path) {
        json(response, 404, {
          error: { code: 'not_found', message: 'Synthetic version not found.' },
        });
        return;
      }
      getMetadataRequests.push({ path, versionId });
      const authorizedRange =
        url.searchParams.get('authorizeRange') === '1' ? url.searchParams.get('range') : null;
      json(response, 200, {
        id: version.id,
        path: version.path,
        ciphertextSize: version.ciphertext.byteLength,
        wrappedKey: version.wrappedKey,
        agentId: fixtureAgentId,
        machineId: null,
        userId: null,
        tags: [],
        description: null,
        createdAt: version.createdAt,
        downloadUrl: `http://127.0.0.1:${server.address().port}/storage/${version.id}`,
        ...(authorizedRange ? { downloadRange: authorizedRange } : {}),
      });
      return;
    }
    json(response, 404, { error: { code: 'not_found', message: 'Unknown synthetic API route.' } });
    return;
  }

  const storageMatch = url.pathname.match(/^\/storage\/([^/]+)$/u);
  if (storageMatch && request.method === 'GET') {
    const version = versionRecords.get(storageMatch[1]);
    if (!version) {
      response.writeHead(404);
      response.end();
      return;
    }
    const range = request.headers.range;
    if (range) storageRequests.push({ versionId: version.id, range });
    else storageRequests.push({ versionId: version.id, range: null });
    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d+)$/u);
      if (!match) {
        response.writeHead(416, { 'content-range': `bytes */${version.ciphertext.byteLength}` });
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (start > end || start >= version.ciphertext.byteLength) {
        response.writeHead(416, { 'content-range': `bytes */${version.ciphertext.byteLength}` });
        response.end();
        return;
      }
      const body = version.ciphertext.subarray(
        start,
        Math.min(end + 1, version.ciphertext.byteLength),
      );
      response.writeHead(206, {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${start + body.byteLength - 1}/${version.ciphertext.byteLength}`,
        'content-length': body.byteLength,
        'content-type': 'application/octet-stream',
      });
      response.end(body);
      return;
    }
    response.writeHead(200, {
      'accept-ranges': 'bytes',
      'content-length': version.ciphertext.byteLength,
      'content-type': 'application/octet-stream',
    });
    response.end(version.ciphertext);
    return;
  }

  response.writeHead(404);
  response.end();
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const temporaryRoot = await mkdtemp(join(tmpdir(), 'agent-drive-mount-smoke-'));
const mountpoint = resolve(join(temporaryRoot, 'mount'));
await mkdir(mountpoint);
const configPath = join(temporaryRoot, 'config.json');
await writeFile(configPath, '{}\n', { mode: 0o600 });
const apiUrl = `http://127.0.0.1:${server.address().port}`;
const childEnv = {
  PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: temporaryRoot,
  TMPDIR: temporaryRoot,
  AGENT_DRIVE_CONFIG: configPath,
  AGENT_DRIVE_API_URL: apiUrl,
  AGENT_DRIVE_API_KEY: fixtureToken,
  AGENT_DRIVE_KEY: fixtureKey,
  AGENT_DRIVE_MOUNT_HELPER: resolve(helperPath),
  AGENT_DRIVE_MACHINE: fixtureAgentId,
};
const child = spawn(
  process.execPath,
  [cliPath, 'mount', mountpoint, '--drive', fixtureDriveId, '--api', apiUrl, '--read-only'],
  {
    cwd: repositoryRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let childStdout = '';
let childStderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => (childStdout = (childStdout + chunk).slice(-4_096)));
child.stderr.on('data', (chunk) => (childStderr = (childStderr + chunk).slice(-8_192)));
const childExit = new Promise((resolveExit) => {
  child.once('error', (error) => resolveExit({ error }));
  child.once('exit', (code, signal) => resolveExit({ code, signal }));
});
const isExpectedSigtermExit = (exit) =>
  Boolean(exit && !exit.error && exit.code === 143 && exit.signal === null);

let ownedMountId;
let shutdownSignalSent = false;
let fallbackUnmountUsed = false;
const mountIdsAtPath = async () => {
  const mountInfo = await readFile('/proc/self/mountinfo', 'utf8');
  const escapedMountpoint = mountpoint
    .replaceAll('\\', '\\134')
    .replaceAll(' ', '\\040')
    .replaceAll('\t', '\\011')
    .replaceAll('\n', '\\012');
  return mountInfo.split('\n').flatMap((line) => {
    const fields = line.split(' ');
    return fields[4] === escapedMountpoint ? [Number(fields[0])] : [];
  });
};
const captureOwnedMount = async () => {
  const mountIds = await mountIdsAtPath();
  if (ownedMountId === undefined && mountIds.length === 1) ownedMountId = mountIds[0];
  return mountIds;
};
const isMountpointMounted = async () => {
  const mountIds = await captureOwnedMount();
  return mountIds.length > 0;
};
async function waitForMount() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const exit = await Promise.race([childExit, delay(0).then(() => null)]);
    if (exit) throw new Error(`CLI exited before mount (code ${exit.code ?? 'none'}).`);
    const mountIds = await captureOwnedMount();
    assert(mountIds.length <= 1, 'the unique smoke mountpoint must not contain stacked mounts');
    if (ownedMountId !== undefined) return;
    await delay(50);
  }
  throw new Error('CLI did not mount within 15 seconds.');
}

async function waitForGracefulShutdown(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exit = await Promise.race([childExit, delay(0).then(() => null)]);
    const stillMounted = await isMountpointMounted();
    if (exit && !stillMounted) return { exit, stillMounted };
    await delay(100, undefined, { ref: false });
  }
  return {
    exit: await Promise.race([childExit, delay(0).then(() => null)]),
    stillMounted: await isMountpointMounted(),
  };
}

async function fallbackUnmountOwnedMount() {
  const mountIds = await captureOwnedMount();
  if (ownedMountId === undefined || !mountIds.includes(ownedMountId)) return;
  assert.deepEqual(
    mountIds,
    [ownedMountId],
    'refusing fallback cleanup because another mount shares the unique smoke mountpoint',
  );
  fallbackUnmountUsed = true;
  await execFileAsync('fusermount3', ['-u', '-q', '--', mountpoint], { timeout: 5_000 });
  assert.equal(
    await isMountpointMounted(),
    false,
    'fallback unmount must detach the smoke-owned mount',
  );
}

let testError;
let shutdownError;
let unmountError;
let cleanupError;
let outcome;
const openedHandles = [];
try {
  await waitForMount();
  const names = await readdir(mountpoint);
  assert.deepEqual(names, ['changing.bin', 'current.bin', 'empty.bin', 'nested', 'normal.txt']);
  assert(listRequestCount >= 3, 'root listing should cross at least three synthetic API pages');
  const pageCrossingCount = listRequestCount;
  const emptyInfo = await stat(join(mountpoint, 'empty.bin'));
  assert.equal(emptyInfo.size, 0);
  assert.deepEqual(await readdir(join(mountpoint, 'nested')), ['leaf.txt']);
  assert.equal(getMetadataRequests.length, 0, 'ls/stat must not request file-version metadata');
  assert.equal(storageRequests.length, 0, 'ls/stat must not download file bytes');

  const normal = await readFile(join(mountpoint, 'normal.txt'));
  assert.deepEqual(normal, plaintext.normal);
  const current = await readFile(join(mountpoint, 'current.bin'));
  assert.deepEqual(current, plaintext.current);
  const empty = await readFile(join(mountpoint, 'empty.bin'));
  assert.equal(empty.byteLength, 0);
  const nested = await readFile(join(mountpoint, 'nested', 'leaf.txt'));
  assert.deepEqual(nested, plaintext.nested);

  const oldHandle = await open(join(mountpoint, 'changing.bin'), 'r');
  openedHandles.push(oldHandle);
  const oldFirst = Buffer.alloc(37);
  const oldFirstRead = await oldHandle.read(oldFirst, 0, oldFirst.byteLength, 4_019);
  assert.equal(oldFirstRead.bytesRead, oldFirst.byteLength);
  assert.deepEqual(oldFirst, plaintext.changingV1.subarray(4_019, 4_056));
  assert(
    getMetadataRequests.some(
      (entry) => entry.path === '/changing.bin' && entry.versionId === 'synthetic-v1',
    ),
  );

  changingVersion = 'synthetic-v2';
  await delay(1_250);
  const oldListSnapshotCount = listSnapshots.length;
  const refreshDeadline = Date.now() + 5_000;
  while (
    Date.now() < refreshDeadline &&
    !listSnapshots
      .slice(oldListSnapshotCount)
      .some((snapshot) => snapshot.changingVersion === 'synthetic-v2')
  ) {
    await readdir(mountpoint);
    await delay(150);
  }
  assert(
    listSnapshots
      .slice(oldListSnapshotCount)
      .some((snapshot) => snapshot.changingVersion === 'synthetic-v2'),
    'the refreshed listing should select the new version for the same path',
  );
  const updatedStat = await stat(join(mountpoint, 'changing.bin'));
  assert.equal(
    updatedStat.size,
    plaintext.changingV2.byteLength,
    'a refreshed path lookup should expose current version size',
  );

  const newHandle = await open(join(mountpoint, 'changing.bin'), 'r');
  openedHandles.push(newHandle);
  const newRange = Buffer.alloc(53);
  const newRead = await newHandle.read(newRange, 0, newRange.byteLength, 23_007);
  assert.equal(newRead.bytesRead, newRange.byteLength);
  assert.deepEqual(newRange, plaintext.changingV2.subarray(23_007, 23_060));

  const oldSecond = Buffer.alloc(41);
  const oldSecondRead = await oldHandle.read(oldSecond, 0, oldSecond.byteLength, 31_101);
  assert.equal(oldSecondRead.bytesRead, oldSecond.byteLength);
  assert.deepEqual(oldSecond, plaintext.changingV1.subarray(31_101, 31_142));
  assert(
    getMetadataRequests.some(
      (entry) => entry.path === '/changing.bin' && entry.versionId === 'synthetic-v2',
    ),
  );

  await assert.rejects(writeFile(join(mountpoint, 'normal.txt'), 'forbidden'), (error) =>
    Boolean(error?.code),
  );
  await assert.rejects(open(join(mountpoint, 'created.txt'), 'wx'), (error) =>
    Boolean(error?.code),
  );
  assert.equal(writeRequests, 0, 'read-only filesystem writes should fail before any API mutation');

  assert.equal(unauthorizedRequests, 0, 'CLI must use only its configured synthetic bearer token');
  assert.equal(whoamiRequestCount, 1, 'mount should fetch scoped identity permissions');
  assert.equal(
    getMetadataRequests.length >= 5,
    true,
    'normal, empty, nested, and both changing versions should be authenticated',
  );
  assert(storageRequests.length > 0, 'file reads should retrieve encrypted storage bytes');
  outcome = {
    result: 'PASS',
    gracefulShutdown: true,
    detachedBeforeFallback: true,
    rootApiPages: pageCrossingCount,
    nestedListRequests: listRequests.filter((request) => request.prefix === '/nested').length,
    metadataRequests: getMetadataRequests.length,
    storageRequests: storageRequests.length,
    rangedStorageRequests: storageRequests.filter((entry) => entry.range !== null).length,
    whoamiRequests: whoamiRequestCount,
    oldAndNewVersionIdsVerified: true,
    verifiedCases: [
      'real-cli-authenticates-against-loopback-only-synthetic-api',
      'root-list-crosses-api-pages-without-file-metadata-or-storage-get',
      'nested-folder-list-and-decrypted-read',
      'distinct-current-file, normal-file, and empty-file reads',
      'same-path-version-change-preserves-open-handle-and-refreshes-new-open',
      'nonzero-offset-reads-match-decrypted-fixture-bytes',
      'read-only-write-and-create-rejected-without-api-mutation',
    ],
  };
} catch (error) {
  testError = error;
} finally {
  for (const handle of openedHandles.splice(0)) await handle.close().catch(() => {});
  let exit = await Promise.race([childExit, delay(0).then(() => null)]);
  let mounted = await isMountpointMounted().catch((error) => {
    shutdownError ??= error;
    return true;
  });
  if (!exit && child.exitCode === null && child.signalCode === null) {
    shutdownSignalSent = child.kill('SIGTERM');
    const shutdown = await waitForGracefulShutdown(mounted ? 18_000 : 3_000).catch((error) => {
      shutdownError ??= error;
      return null;
    });
    exit = shutdown?.exit ?? exit;
    mounted = shutdown?.stillMounted ?? mounted;
  }
  if (!shutdownSignalSent) {
    shutdownError ??= new Error('ordinary SIGTERM was not delivered to a live CLI process');
  }
  if (exit && !isExpectedSigtermExit(exit)) {
    if (exit.signal) {
      shutdownError ??= new Error(
        `ordinary SIGTERM shutdown was terminated by OS signal ${exit.signal}; expected CLI exit code 143`,
      );
    } else if (exit.error) {
      shutdownError ??= new Error('ordinary SIGTERM shutdown did not report a process exit status');
    } else {
      shutdownError ??= new Error(
        `ordinary SIGTERM shutdown exited with code ${exit.code ?? 'none'}; expected CLI exit code 143`,
      );
    }
  }
  if (!exit) {
    shutdownError ??= new Error('CLI did not exit within the graceful shutdown deadline');
  }
  if (mounted) {
    shutdownError ??= new Error(
      'ordinary SIGTERM did not detach the smoke-owned mount before fallback cleanup',
    );
    try {
      await fallbackUnmountOwnedMount();
      mounted = false;
    } catch (error) {
      unmountError = error;
    }
  }
  if (!exit && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const gracefulExit = await Promise.race([childExit, delay(2_000).then(() => null)]);
    if (!gracefulExit) {
      child.kill('SIGKILL');
      await Promise.race([childExit, delay(2_000)]);
    }
  }
  mounted = await isMountpointMounted().catch((error) => {
    cleanupError ??= error;
    return true;
  });
  if (mounted) {
    cleanupError ??= new Error(
      `FUSE mount remains active at ${mountpoint}; left ${temporaryRoot} intact.`,
    );
  } else {
    try {
      await unlink(configPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      await rmdir(mountpoint);
      await rmdir(temporaryRoot);
    } catch (error) {
      cleanupError = error;
    }
  }
  await new Promise((resolveClose) => server.close(resolveClose));
}

const safeExit = await Promise.race([childExit, delay(0).then(() => null)]);
if (
  testError ||
  shutdownError ||
  cleanupError ||
  unmountError ||
  fallbackUnmountUsed ||
  !safeExit ||
  !isExpectedSigtermExit(safeExit)
) {
  const parts = [
    testError?.message,
    shutdownError?.message,
    cleanupError?.message,
    unmountError?.message,
  ].filter(Boolean);
  if (fallbackUnmountUsed) {
    parts.push('The smoke required fallback unmount cleanup; graceful shutdown did not pass.');
  }
  if (safeExit && !isExpectedSigtermExit(safeExit)) {
    if (safeExit.signal) {
      parts.push(`CLI was terminated by OS signal ${safeExit.signal}.`);
    } else if (safeExit.error) {
      parts.push('CLI process exit could not be observed.');
    } else {
      parts.push(
        `CLI exited with code ${safeExit.code ?? 'none'}; expected exit code 143 after SIGTERM.`,
      );
    }
  }
  const redact = (value) =>
    value
      .replaceAll(fixtureToken, '[synthetic-token]')
      .replaceAll(fixtureKey, '[synthetic-key]')
      .replaceAll(fixtureDriveId, '[synthetic-drive]')
      .replace(/synthetic-[A-Za-z0-9_-]+/gu, '[fixture-id]')
      .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]');
  if (childStderr.trim()) parts.push(`Sanitized CLI stderr: ${redact(childStderr.trim())}`);
  if (childStdout.trim()) parts.push(`Sanitized CLI stdout: ${redact(childStdout.trim())}`);
  parts.push(
    `Synthetic fixture counts: whoami=${whoamiRequestCount}, list=${listRequestCount}, nested=${listRequests.filter((request) => request.prefix === '/nested').length}, metadata=${getMetadataRequests.length}, storage=${storageRequests.length}, writes=${writeRequests}, unauthorized=${unauthorizedRequests}.`,
  );
  throw new Error(parts.join(' '));
}

console.log(JSON.stringify({ ...outcome, unmounted: true, cliExitCode: safeExit.code }));

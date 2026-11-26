import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const helperPath = process.argv[2] ?? process.env.AGENT_DRIVE_FINDER_HELPER;
if (!helperPath) {
  console.error('Usage: node native-finder-probe.mjs <AgentDriveFinder executable>');
  process.exit(2);
}

const driveId = randomUUID();
const token = randomBytes(32).toString('base64url');
const versionId = randomUUID();
const body = Buffer.from('finderOK');
const rpcSummary = { capabilities: 0, list: 0, stat: 0, read: 0, readBytes: 0 };
const entries = [
  { name: 'sample.txt', kind: 'file', size: body.length, mtimeMs: Date.now(), versionId },
  { name: 'empty', kind: 'directory', size: 0, mtimeMs: Date.now(), versionId: null },
];

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/rpc') {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.origin && request.headers.origin !== `http://127.0.0.1:${server.address().port}`) {
    response.writeHead(403).end();
    return;
  }
  const receivedToken = Buffer.from(request.headers.authorization ?? '');
  const expectedToken = Buffer.from(`Bearer ${token}`);
  if (receivedToken.length !== expectedToken.length || !timingSafeEqual(receivedToken, expectedToken)) {
    response.writeHead(401).end();
    return;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 16_384) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  try {
    const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof rpc.id !== 'string' || !['capabilities', 'list', 'stat', 'read'].includes(rpc.op)) {
      response.writeHead(400).end();
      return;
    }
    rpcSummary[rpc.op]++;
    let result;
    if (rpc.op === 'capabilities') {
      result = {
        capabilities: {
          readOnly: true,
          write: false,
          delete: false,
          writePaths: [],
          maxReadBytes: 1_048_576,
          maxWriteBytes: 0,
          ops: ['capabilities', 'list', 'stat', 'read'],
        },
      };
    } else if (rpc.op === 'list' && (rpc.path === '/' || rpc.path === '/empty')) {
      result = { entries: rpc.path === '/' ? entries : [], nextCursor: null };
    } else if (rpc.op === 'stat' && rpc.path === '/sample.txt') {
      result = { entry: entries[0] };
    } else if (rpc.op === 'stat' && rpc.path === '/empty') {
      result = { entry: entries[1] };
    } else if (rpc.op === 'read' && rpc.path === '/sample.txt' && rpc.versionId === versionId &&
               Number.isSafeInteger(rpc.offset) && Number.isSafeInteger(rpc.size) && rpc.offset >= 0 && rpc.size >= 0) {
      const bytes = body.subarray(rpc.offset, rpc.offset + rpc.size);
      rpcSummary.readBytes += bytes.length;
      result = { data: bytes.toString('base64') };
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: rpc.id, ok: false, errno: 'ENOENT',
      }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: rpc.id, ok: true, ...result,
    }));
  } catch {
    response.writeHead(400).end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const safeEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR']
  .filter((key) => typeof process.env[key] === 'string')
  .map((key) => [key, process.env[key]]));
const helper = spawn(helperPath, ['connect'], { stdio: ['pipe', 'pipe', 'pipe'], env: safeEnv });
let stdout = '';
let stderr = '';
let line;
let timer;
const output = new Promise((resolve, reject) => {
  timer = setTimeout(() => reject(new Error('helper startup timed out')), 60_000);
  helper.stdout.setEncoding('utf8');
  helper.stderr.setEncoding('utf8');
  helper.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 4_096) {
      clearTimeout(timer);
      reject(new Error('helper output exceeded limit'));
      helper.kill('SIGTERM');
      return;
    }
    const newline = stdout.indexOf('\n');
    if (newline >= 0 && line === undefined) {
      line = stdout.slice(0, newline);
      clearTimeout(timer);
      resolve(line);
    }
  });
  helper.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 4_096) stderr = stderr.slice(-4_096);
  });
  helper.once('error', (error) => {
    clearTimeout(timer);
    reject(new Error(`could not launch helper (${error.code ?? 'spawn-error'})`));
  });
  helper.once('exit', (code) => {
    if (line === undefined) {
      clearTimeout(timer);
      reject(new Error(`helper exited before mount path (status ${code ?? 'signal'}): ${stderr.trim() || 'no diagnostic'}`));
    }
  });
});

let result;
let failure;
try {
  helper.stdin.write(`${JSON.stringify({ driveId, port: address.port, token, temporaryDomain: true })}\n`);
  const mounted = JSON.parse(await output);
  if (typeof mounted.path !== 'string' || !mounted.path.startsWith('/')) {
    throw new Error('helper returned an invalid Finder path');
  }
  const cloudStorageRoot = join(homedir(), 'Library', 'CloudStorage') + sep;
  if (!mounted.path.startsWith(cloudStorageRoot)) {
    throw new Error('registered path is outside the agent CloudStorage directory');
  }
  let listing = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    try { listing = await readdir(mounted.path); } catch {}
    if (listing.includes('sample.txt') && listing.includes('empty')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!listing.includes('sample.txt') || !listing.includes('empty')) {
    throw new Error('Finder listing did not contain both synthetic entries');
  }
  const samplePath = join(mounted.path, 'sample.txt');
  const file = await open(samplePath, 'r');
  let content;
  try {
    const buffer = Buffer.alloc(9);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    content = buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
  if (content.toString('utf8') !== body.toString('utf8')) {
    throw new Error('Finder returned unexpected synthetic file bytes');
  }
  if (rpcSummary.capabilities === 0 || rpcSummary.list === 0 || rpcSummary.read === 0 || rpcSummary.readBytes !== body.length) {
    throw new Error('Finder did not complete the expected loopback list and bounded read');
  }
  result = { driveId, domainId: `agent-drive-${driveId}`, path: mounted.path, listing, readBytes: content.length, rpcSummary };
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown probe failure';
} finally {
  clearTimeout(timer);
  if (!helper.stdin.destroyed && !helper.stdin.writableEnded) helper.stdin.end();
  if (helper.exitCode === null && helper.signalCode === null) {
    await new Promise((resolve) => {
      const terminateTimer = setTimeout(() => helper.kill('SIGTERM'), 5_000);
      const killTimer = setTimeout(() => helper.kill('SIGKILL'), 10_000);
      helper.once('exit', (...status) => {
        clearTimeout(terminateTimer);
        clearTimeout(killTimer);
        resolve(status);
      });
    });
  }
  await new Promise((resolve) => server.close(resolve));
}

if (failure) {
  console.error(JSON.stringify({ driveId, domainId: `agent-drive-${driveId}`, error: failure, helperStderr: stderr.trim() }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result));
  console.log(JSON.stringify({ helperExit: helper.exitCode ?? helper.signalCode ?? 'unknown' }));
}

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { access, lstat, readlink, stat, symlink, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const DEFAULT_HELPER = '/Applications/Agent Drive.app/Contents/MacOS/AgentDriveFinder';
const MAX_METADATA_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_BODY_BYTES = 1536 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS = 8;
const REQUEST_TIMEOUT_MS = 20_000;
const HELPER_START_TIMEOUT_MS = 15_000;
const HELPER_STOP_TIMEOUT_MS = 5_000;

export type MacMountExit = { code: number | null; signal: NodeJS.Signals | null };

export type MacMountHandle = {
  actualPath: string;
  requestedPath: string;
  waitForExit(): Promise<MacMountExit>;
  close(): Promise<void>;
};

export type StartMacMountOptions = {
  driveId: string;
  requestedMountpoint: string;
  dispatch(request: unknown, signal?: AbortSignal): Promise<unknown>;
};

type AliasOwnership = { path: string; target: string; dev: number; ino: number };

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function safeEqual(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'USER',
    'LOGNAME',
    'LANG',
    '__CF_USER_TEXT_ENCODING',
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^LC_[A-Z0-9_]+$/.test(key) && value !== undefined) env[key] = value;
  }
  return env as NodeJS.ProcessEnv;
}

async function readLimited(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = request.headers['content-length'];
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error('Request too large'), { status: 413 });
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES)
      throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function validRpcRequest(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (
    !(typeof value.id === 'string' && value.id.length >= 1 && value.id.length <= 128) &&
    !(typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id >= 0)
  )
    return false;
  if (
    typeof value.op !== 'string' ||
    ![
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
      'rmdir',
      'unlink',
      'rename',
    ].includes(value.op)
  )
    return false;
  if (value.op === 'capabilities') return true;
  if (['write', 'truncate', 'readStaged', 'flush', 'release'].includes(value.op)) {
    if (
      typeof value.handleId !== 'string' ||
      value.handleId.length < 1 ||
      value.handleId.length > 128
    )
      return false;
  }
  if (
    ['stat', 'list', 'read', 'openWrite', 'mkdir', 'rmdir', 'unlink', 'rename'].includes(value.op)
  ) {
    if (
      typeof value.path !== 'string' ||
      value.path.length < 1 ||
      value.path.length > 4096 ||
      !value.path.startsWith('/')
    )
      return false;
  }
  if (value.op === 'read' || value.op === 'readStaged') {
    if (
      value.op === 'read' &&
      (typeof value.versionId !== 'string' || !value.versionId || value.versionId.length > 256)
    )
      return false;
    if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0) return false;
    if (
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      (value.size as number) > MAX_READ_BYTES
    )
      return false;
  }
  if (value.op === 'write') {
    if (
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 0 ||
      typeof value.data !== 'string'
    )
      return false;
    const decoded = Buffer.from(value.data, 'base64');
    if (
      decoded.byteLength > MAX_WRITE_BYTES ||
      decoded.toString('base64') !== value.data ||
      (value.offset as number) + decoded.byteLength > Number.MAX_SAFE_INTEGER
    ) {
      decoded.fill(0);
      return false;
    }
    decoded.fill(0);
  }
  if (value.op === 'truncate' && (!Number.isSafeInteger(value.size) || (value.size as number) < 0))
    return false;
  if (value.op === 'openWrite') {
    if (
      !(
        value.baseVersionId === null ||
        (typeof value.baseVersionId === 'string' &&
          value.baseVersionId.length > 0 &&
          value.baseVersionId.length <= 128)
      )
    )
      return false;
    if (
      value.size !== undefined &&
      (!Number.isSafeInteger(value.size) || (value.size as number) < 0)
    )
      return false;
    if (value.truncateOnOpen !== undefined && typeof value.truncateOnOpen !== 'boolean')
      return false;
  }
  if (value.op === 'rename') {
    if (
      typeof value.destinationPath !== 'string' ||
      value.destinationPath.length < 1 ||
      value.destinationPath.length > 4096 ||
      !value.destinationPath.startsWith('/')
    )
      return false;
    if (
      typeof value.ifSourceVersionId !== 'string' ||
      !value.ifSourceVersionId ||
      value.ifSourceVersionId.length > 128
    )
      return false;
    if (
      !(
        value.ifDestinationVersionId === null ||
        (typeof value.ifDestinationVersionId === 'string' &&
          value.ifDestinationVersionId.length > 0 &&
          value.ifDestinationVersionId.length <= 128)
      )
    )
      return false;
    if (
      typeof value.operationId !== 'string' ||
      !value.operationId ||
      value.operationId.length > 128
    )
      return false;
  }
  if (
    value.op === 'unlink' &&
    (typeof value.ifVersionId !== 'string' || !value.ifVersionId || value.ifVersionId.length > 128)
  )
    return false;
  if (
    value.op === 'list' &&
    value.cursor !== undefined &&
    (typeof value.cursor !== 'string' || value.cursor.length > 4096)
  )
    return false;
  return true;
}

async function waitForChild(child: ChildProcess, timeoutMs: number): Promise<MacMountExit> {
  const stdioClosed = child.stdio.every((stream) => stream == null || stream.closed);
  if ((child.exitCode !== null || child.signalCode !== null) && stdioClosed) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error('Finder helper did not stop')), timeoutMs);
    timer.unref();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function removeOwnedAlias(ownership: AliasOwnership | undefined): Promise<void> {
  if (!ownership) return;
  try {
    const current = await lstat(ownership.path);
    if (!current.isSymbolicLink() || current.dev !== ownership.dev || current.ino !== ownership.ino)
      return;
    if (resolve(ownership.path, await readlink(ownership.path)) !== ownership.target) return;
    const confirmed = await lstat(ownership.path);
    if (
      !confirmed.isSymbolicLink() ||
      confirmed.dev !== ownership.dev ||
      confirmed.ino !== ownership.ino
    )
      return;
    await unlink(ownership.path);
  } catch {
    // Cleanup is best effort; never remove a path that no longer matches our symlink.
  }
}

async function prepareAlias(
  requestedPath: string,
  actualPath: string,
): Promise<AliasOwnership | undefined> {
  if (requestedPath === actualPath) return undefined;
  try {
    await symlink(actualPath, requestedPath, 'dir');
    const created = await lstat(requestedPath);
    return { path: requestedPath, target: actualPath, dev: created.dev, ino: created.ino };
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error;
    const current = await lstat(requestedPath);
    if (
      !current.isSymbolicLink() ||
      resolve(requestedPath, await readlink(requestedPath)) !== actualPath
    ) {
      throw new Error('Requested mountpoint is already occupied');
    }
    return undefined;
  }
}

async function readHelperPath(): Promise<string> {
  const configured = process.env.AGENT_DRIVE_FINDER_HELPER;
  const helper = configured ?? DEFAULT_HELPER;
  if (!isAbsolute(helper)) throw new Error('Finder helper override must be an absolute path');
  const normalized = resolve(helper);
  const metadata = await stat(normalized);
  if (!metadata.isFile()) throw new Error('Finder helper is not a regular file');
  await access(normalized, constants.X_OK);
  return normalized;
}

async function receiveHelperPath(child: ChildProcess): Promise<string> {
  const stdout = child.stdout;
  if (!stdout) throw new Error('Finder helper stdout is unavailable');
  return await new Promise((resolvePath, reject) => {
    let data = '';
    let settled = false;
    const finish = (error?: Error, path?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.removeAllListeners('data');
      stdout.removeAllListeners('end');
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      if (error) reject(error);
      else resolvePath(path!);
    };
    const onError = (error: Error) => finish(error);
    const onClose = (code: number | null) =>
      finish(
        new Error(
          `Finder helper exited before reporting its mount path (code ${code ?? 'unknown'})`,
        ),
      );
    const timer = setTimeout(
      () => finish(new Error('Finder helper startup timed out')),
      HELPER_START_TIMEOUT_MS,
    );
    timer.unref();
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      data += chunk;
      if (Buffer.byteLength(data) > 4096)
        return finish(new Error('Finder helper output exceeded its limit'));
      const newline = data.indexOf('\n');
      if (newline < 0) return;
      if (newline !== data.length - 1)
        return finish(new Error('Finder helper returned unexpected output'));
      try {
        const result: unknown = JSON.parse(data.slice(0, newline));
        if (
          !isRecord(result) ||
          typeof result.path !== 'string' ||
          !isAbsolute(result.path) ||
          result.path.includes('\0')
        ) {
          return finish(new Error('Finder helper returned an invalid mount path'));
        }
        finish(undefined, resolve(result.path));
      } catch {
        finish(new Error('Finder helper returned invalid JSON'));
      }
    });
    stdout.once('end', () => {
      void new Promise<MacMountExit>((resolveExit) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolveExit({ code: child.exitCode, signal: child.signalCode });
        } else {
          child.once('close', (code, signal) => resolveExit({ code, signal }));
        }
      }).then((exit) =>
        finish(new Error(`Finder helper exited during startup (code ${exit.code ?? 'unknown'})`)),
      );
    });
    child.once('error', onError);
    child.once('close', onClose);
  });
}

export async function startMacMount(options: StartMacMountOptions): Promise<MacMountHandle> {
  if (!options.driveId || options.driveId.length > 256) throw new Error('Invalid drive id');
  if (!isAbsolute(options.requestedMountpoint))
    throw new Error('Requested mountpoint must be absolute');
  const requestedPath = resolve(options.requestedMountpoint);
  const helper = await readHelperPath();
  const token = randomBytes(32).toString('base64url');
  const server = createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed)
        jsonResponse(response, 500, { error: 'Internal error' });
      else response.destroy();
    });
  });
  let activeRequests = 0;
  const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
    const port = (server.address() as { port: number } | null)?.port;
    const expectedHost = port === undefined ? '' : `127.0.0.1:${port}`;
    if (request.headers.host !== expectedHost)
      return jsonResponse(response, 403, { error: 'Forbidden' });
    if (request.url !== '/rpc') return jsonResponse(response, 404, { error: 'Not found' });
    if (request.method !== 'POST')
      return jsonResponse(response, 405, { error: 'Method not allowed' });
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${expectedHost}`)
      return jsonResponse(response, 403, { error: 'Forbidden' });
    if (!safeEqual(`Bearer ${token}`, request.headers.authorization))
      return jsonResponse(response, 401, { error: 'Unauthorized' });
    if (
      request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      return jsonResponse(response, 415, { error: 'Unsupported media type' });
    }
    if (activeRequests >= MAX_CONCURRENT_REQUESTS)
      return jsonResponse(response, 429, { error: 'Too many requests' });
    activeRequests += 1;
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Request timed out')));
    let rpcId: string | number | undefined;
    try {
      const body = await readLimited(request);
      let rpc: unknown;
      try {
        rpc = JSON.parse(body.toString('utf8'));
      } catch {
        return jsonResponse(response, 400, { error: 'Invalid JSON' });
      }
      if (!validRpcRequest(rpc)) return jsonResponse(response, 400, { error: 'Invalid request' });
      if (rpc.op !== 'write' && body.byteLength > MAX_METADATA_BODY_BYTES) {
        return jsonResponse(response, 413, { error: 'Request too large' });
      }
      rpcId = rpc.id as string | number;
      const controller = new AbortController();
      const cancel = () =>
        controller.abort(
          Object.assign(new Error('RPC client disconnected'), { code: 'ECANCELED' }),
        );
      request.once('aborted', cancel);
      response.once('close', () => {
        if (!response.writableEnded) cancel();
      });
      let timeout: NodeJS.Timeout | undefined;
      let dispatchResult: unknown;
      try {
        dispatchResult = await Promise.race([
          options.dispatch(rpc, controller.signal),
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true,
            });
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort(Object.assign(new Error('RPC timed out'), { code: 'ETIMEDOUT' }));
            }, REQUEST_TIMEOUT_MS);
            timeout.unref();
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        request.removeListener('aborted', cancel);
      }
      const result = dispatchResult;
      if (!isRecord(result) || result.id !== rpc.id || typeof result.ok !== 'boolean') {
        return jsonResponse(response, 502, { error: 'Invalid dispatcher response' });
      }
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES)
        return jsonResponse(response, 502, { error: 'Response too large' });
      jsonResponse(response, 200, result);
    } catch (error) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
      if (response.destroyed) return;
      if (status === 413) {
        response.shouldKeepAlive = false;
        response.setHeader('connection', 'close');
        response.once('finish', () => request.destroy());
        jsonResponse(response, status, { error: 'Request too large' });
      } else if (status !== undefined) jsonResponse(response, status, { error: 'Request failed' });
      else {
        if (rpcId) {
          const errno = isRecord(error) && typeof error.code === 'string' ? error.code : 'EIO';
          jsonResponse(response, 200, {
            id: rpcId,
            ok: false,
            errno: /^[A-Z0-9_]{1,32}$/.test(errno) ? errno : 'EIO',
          });
        } else {
          jsonResponse(response, 500, { error: 'RPC failed' });
        }
      }
    } finally {
      activeRequests -= 1;
    }
  };
  server.headersTimeout = 10_000;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error('Could not bind Finder RPC server');
  }
  const child = spawn(helper, ['connect'], {
    env: childEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  child.stderr?.resume();
  let childExit: MacMountExit | undefined;
  const exitPromise = new Promise<MacMountExit>((resolveExit) => {
    child.once('error', () => {
      childExit = { code: null, signal: null };
      resolveExit(childExit);
    });
    child.once('close', (code, signal) => {
      childExit = { code, signal };
      resolveExit(childExit);
    });
  });
  const startup = JSON.stringify({ driveId: options.driveId, port: address.port, token }) + '\n';
  child.stdin?.end(startup);

  let actualPath: string;
  let alias: AliasOwnership | undefined;
  try {
    actualPath = await receiveHelperPath(child);
    const actualMetadata = await stat(actualPath);
    if (!actualMetadata.isDirectory()) throw new Error('Finder helper path is not a directory');
    alias = await prepareAlias(requestedPath, actualPath);
  } catch (error) {
    child.kill('SIGTERM');
    try {
      await waitForChild(child, HELPER_STOP_TIMEOUT_MS);
    } catch {
      child.kill('SIGKILL');
    }
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    actualPath,
    requestedPath,
    waitForExit: async () => childExit ?? (await exitPromise),
    close: async () => {
      closePromise ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          try {
            await waitForChild(child, HELPER_STOP_TIMEOUT_MS);
          } catch {
            child.kill('SIGKILL');
            await waitForChild(child, HELPER_STOP_TIMEOUT_MS).catch(() => undefined);
          }
        }
        await new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
          server.closeAllConnections();
        });
        await removeOwnedAlias(alias);
      })();
      await closePromise;
    },
  };
}

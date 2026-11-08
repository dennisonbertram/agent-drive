import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import https from 'node:https';
import { constants as osConstants } from 'node:os';
import { basename, join } from 'node:path';
import zlib from 'node:zlib';
import { codexOverride, codexProviderFlags } from './capture-codex.js';
import { Drainer, Spool, SpoolFullError } from './capture-spool.js';
import { AgentDriveClient } from './client.js';
import {
  configPath,
  machineName,
  resolveConnection,
  resolveDriveId,
  resolveDriveKey,
} from './config.js';
import { decodeDriveKey, encryptFile } from './crypto.js';
import { AGENT_PATTERN, tracePath, traceTags } from './trace-path.js';

const MiB = 1024 * 1024;
const PER_DIRECTION = 4 * MiB;
const RESERVATION = 2 * PER_DIRECTION;
const MAX_TRACE = 9 * MiB;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const REQUEST_HEADERS = new Set([
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'user-agent',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-runtime',
]);
const RESPONSE_HEADERS = new Set([
  'content-type',
  'request-id',
  'x-request-id',
  'x-should-retry',
  'retry-after',
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-limit',
  'anthropic-ratelimit-tokens-remaining',
  'openai-processing-ms',
  'openai-version',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
]);

type Upstream = { protocol: 'https' | 'http'; hostname: string; port: number };
export type ProxyOptions = {
  agent: string;
  driveId: string;
  driveKey: string;
  drainer: Drainer;
  log: (line: string) => void;
  upstreams?: Record<'anthropic' | 'openai', Upstream>;
  budgetBytes?: number;
  hooks?: {
    beforeEncrypt?: () => Promise<void> | void;
    onProcess?: (state: 'start' | 'end') => void;
  };
};

const DEFAULT_UPSTREAMS = {
  anthropic: { protocol: 'https', hostname: 'api.anthropic.com', port: 443 },
  openai: { protocol: 'https', hostname: 'api.openai.com', port: 443 },
} as const;

/** Keeps at most `limit` bytes; later bytes are dropped and the buffer is marked truncated. */
class Tee {
  chunks: Buffer[] = [];
  size = 0;
  truncated = false;
  push(chunk: Buffer) {
    const room = PER_DIRECTION - this.size;
    if (chunk.length > room) this.truncated = true;
    if (room <= 0) return;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(part);
    this.size += part.length;
  }
  get bytes() {
    return Buffer.concat(this.chunks);
  }
}

function pick(headers: IncomingHttpHeaders, allowed: Set<string>) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (allowed.has(key) && value !== undefined)
      out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function decodeBody(bytes: Buffer): unknown {
  let text: string | undefined;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = undefined;
  }
  if (text === undefined || text.includes('\0'))
    return {
      binary: true,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseSse(text: string) {
  const events: { event: string; data: unknown }[] = [];
  for (const block of text.split(/\r?\n\r?\n/u)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/u)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''));
    }
    if (!data.length) continue;
    const joined = data.join('\n');
    let parsed: unknown = joined;
    try {
      parsed = JSON.parse(joined);
    } catch {
      /* keep the string */
    }
    events.push({ event, data: parsed });
  }
  return events;
}

type Captured = {
  provider: 'anthropic' | 'openai';
  method: string;
  path: string;
  startedAt: number;
  endedAt: number;
  status: number;
  requestHeaders: IncomingHttpHeaders;
  responseHeaders: IncomingHttpHeaders;
  request: Tee;
  response: Tee;
};

/** Decodes one direction. Returns the body (or an omitted marker) and records truncation. */
function direction(tee: Tee, headers: IncomingHttpHeaders, label: string, truncated: string[]) {
  let bytes = tee.bytes;
  if (tee.truncated) truncated.push(label);
  if (
    String(headers['content-encoding'] ?? '')
      .toLowerCase()
      .includes('gzip')
  ) {
    try {
      bytes = zlib.gunzipSync(bytes, {
        maxOutputLength: PER_DIRECTION,
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    } catch {
      if (!truncated.includes(label)) truncated.push(label);
      return { bytes: null, omitted: { omitted: true, bytes: tee.size } };
    }
  }
  return { bytes, omitted: null };
}

export function buildTrace(agent: string, c: Captured) {
  const truncated: string[] = [];
  const req = direction(c.request, c.requestHeaders, 'request.body', truncated);
  const res = direction(c.response, c.responseHeaders, 'response.body', truncated);
  const requestBody = req.bytes ? decodeBody(req.bytes) : req.omitted;
  let responseKey: 'body' | 'sse' = 'body';
  let responseValue: unknown = res.omitted;
  if (res.bytes) {
    const decoded = decodeBody(res.bytes);
    if (
      String(c.responseHeaders['content-type'] ?? '').includes('text/event-stream') &&
      typeof decoded === 'string'
    ) {
      responseKey = 'sse';
      responseValue = parseSse(decoded);
    } else responseValue = decoded;
  }
  const model =
    (requestBody as { model?: unknown } | null)?.model ??
    (responseKey === 'body' ? (responseValue as { model?: unknown } | null)?.model : undefined);
  const trace = {
    v: 1,
    agent,
    provider: c.provider,
    startedAt: new Date(c.startedAt).toISOString(),
    endedAt: new Date(c.endedAt).toISOString(),
    durationMs: c.endedAt - c.startedAt,
    truncated,
    request: {
      method: c.method,
      path: c.path,
      headers: pick(c.requestHeaders, REQUEST_HEADERS),
      body: requestBody,
    },
    response: {
      status: c.status,
      headers: pick(c.responseHeaders, RESPONSE_HEADERS),
      [responseKey]: responseValue,
    } as Record<string, unknown>,
  };
  let json = JSON.stringify(trace);
  if (Buffer.byteLength(json) > MAX_TRACE) {
    delete trace.response.body;
    delete trace.response.sse;
    trace.response.body = { omitted: true, bytes: c.response.size };
    if (!truncated.includes('response.body')) truncated.push('response.body');
    json = JSON.stringify(trace);
    if (Buffer.byteLength(json) > MAX_TRACE) {
      trace.request.body = { omitted: true, bytes: c.request.size };
      if (!truncated.includes('request.body')) truncated.push('request.body');
      json = JSON.stringify(trace);
    }
  }
  return { json, model: typeof model === 'string' ? model : undefined };
}

export async function startProxy(options: ProxyOptions) {
  const upstreams = options.upstreams ?? DEFAULT_UPSTREAMS;
  const budget = options.budgetBytes ?? 64 * MiB;
  const { drainer, log } = options;
  let reserved = 0;
  let peakReserved = 0;
  const dropped = new Map<string, number>();
  const tasks = new Set<Promise<void>>();
  let queue: Promise<unknown> = Promise.resolve();
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    log(`capture warning: ${message}`);
  };
  const drop = (reason: string) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);

  // One trace is processed at a time, so processing allocations stay bounded.
  const enqueue = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function processCapture(c: Captured) {
    options.hooks?.onProcess?.('start');
    try {
      const { json, model } = buildTrace(options.agent, c);
      await options.hooks?.beforeEncrypt?.();
      const encrypted = await encryptFile(Buffer.from(json), options.driveKey);
      const suffix = randomBytes(3).toString('hex');
      const meta = {
        path: tracePath({ agent: options.agent, model, at: new Date(c.startedAt), suffix }),
        wrappedKey: encrypted.wrappedKey,
        ciphertextSize: encrypted.ciphertext.byteLength,
        tags: traceTags(options.agent, model),
      };
      await drainer.spool.add(
        `${String(c.startedAt).padStart(13, '0')}-${suffix}`,
        encrypted.ciphertext,
        meta,
      );
      drainer.kick();
    } finally {
      options.hooks?.onProcess?.('end');
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const match = /^\/(anthropic|openai)(\/.*)?$/u.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"unknown route"}');
      req.resume();
      return;
    }
    const provider = match[1] as 'anthropic' | 'openai';
    const path = match[2] ?? '/';
    const method = req.method ?? 'GET';
    const upstream = upstreams[provider];
    const startedAt = Date.now();
    const capturing = reserved + RESERVATION <= budget;
    if (capturing) {
      reserved += RESERVATION;
      peakReserved = Math.max(peakReserved, reserved);
    }
    const request = new Tee();
    const response = new Tee();
    let status = 0;
    let responseHeaders: IncomingHttpHeaders = {};
    let released = false;
    const release = () => {
      if (capturing && !released) reserved -= RESERVATION;
      released = true;
    };
    const line = (code: number, outcome: string) =>
      log(`capture: ${method} ${path} ${code} ${Date.now() - startedAt}ms ${outcome}`);

    const headers: IncomingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers))
      if (!HOP_BY_HOP.has(name) && name !== 'host') headers[name] = value;
    const defaultPort = upstream.protocol === 'https' ? 443 : 80;
    headers.host =
      upstream.port === defaultPort ? upstream.hostname : `${upstream.hostname}:${upstream.port}`;
    const transport = upstream.protocol === 'https' ? https : http;
    const up = transport.request({
      host: upstream.hostname,
      port: upstream.port,
      method,
      path,
      headers,
    });
    if (capturing) req.on('data', (chunk: Buffer) => request.push(chunk));
    req.pipe(up);
    up.on('error', (error) => {
      release();
      if (res.headersSent) return void res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"error":"bad gateway"}');
      line(
        502,
        `not captured: upstream error (${(error as NodeJS.ErrnoException).code ?? error.message})`,
      );
    });
    up.on('response', (ures) => {
      status = ures.statusCode ?? 502;
      responseHeaders = ures.headers;
      const out: IncomingHttpHeaders = {};
      for (const [name, value] of Object.entries(ures.headers))
        if (!HOP_BY_HOP.has(name)) out[name] = value;
      res.writeHead(status, out);
      if (capturing) ures.on('data', (chunk: Buffer) => response.push(chunk));
      ures.pipe(res);
      ures.on('error', () => res.destroy());
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        up.destroy();
        release();
      }
    });
    res.on('finish', () => {
      const code = status;
      if (!capturing) {
        drop('memory');
        return line(code, 'not captured: memory');
      }
      const task: Promise<void> = enqueue(() =>
        processCapture({
          provider,
          method,
          path,
          startedAt,
          endedAt: Date.now(),
          status,
          requestHeaders: req.headers,
          responseHeaders,
          request,
          response,
        }),
      )
        .then(() => line(code, 'captured'))
        .catch((error: unknown) => {
          const full = error instanceof SpoolFullError;
          drop(full ? 'spool full' : 'error');
          if (!full) warnOnce(`could not save a trace: ${(error as Error).message}`);
          line(code, `not captured: ${full ? 'spool full' : 'error'}`);
        })
        .finally(() => {
          release();
          tasks.delete(task);
        });
      tasks.add(task);
    });
  }

  const server = http.createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;

  return {
    port,
    get reservedBytes() {
      return reserved;
    },
    get peakReservedBytes() {
      return peakReserved;
    },
    dropped,
    drainer,
    /** Stops the server, waits for capture tasks (<= taskGraceMs), then drains (<= totalGraceMs overall). */
    async close(grace: { taskMs?: number; totalMs?: number } = {}) {
      const deadline = Date.now() + (grace.totalMs ?? 10_000);
      server.close();
      server.closeAllConnections();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled([...tasks]),
        new Promise((resolve) => (timer = setTimeout(resolve, grace.taskMs ?? 5000))),
      ]);
      clearTimeout(timer);
      await drainer.finish(deadline);
    },
    async summary() {
      const queued = await drainer.spool.queued();
      const reasons = [...dropped].map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none';
      const total = [...dropped.values()].reduce((a, b) => a + b, 0);
      return `capture: ${drainer.uploaded} uploaded, ${queued.count} queued (${(queued.bytes / MiB).toFixed(1)} MiB in ${drainer.spool.dir}), ${total} not captured (${reasons}), ${await drainer.spool.invalidCount()} invalid`;
    },
  };
}

function spawnChild(command: string[], env: NodeJS.ProcessEnv, args: string[]) {
  return new Promise<number>((resolve) => {
    const child = spawn(command[0]!, args, { stdio: 'inherit', env });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    // The terminal already sends Ctrl-C to the child; stay alive so shutdown still runs.
    const onInt = () => {};
    process.on('SIGINT', onInt);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);
    const done = (code: number) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', forward);
      process.off('SIGHUP', forward);
      resolve(code);
    };
    child.on('error', (error) => {
      process.stderr.write(`capture: cannot run ${command[0]}: ${error.message}\n`);
      done(127);
    });
    child.on('exit', (code, signal) =>
      done(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1)),
    );
  });
}

function chosenEnvironment(command: string[]) {
  const name = basename(command[0]!);
  const present = (variable: string) => (process.env[variable] ? variable : undefined);
  if (name === 'claude') return present('ANTHROPIC_BASE_URL');
  if (name === 'codex') return present('OPENAI_BASE_URL') ?? codexOverride(command.slice(1));
  return present('ANTHROPIC_BASE_URL') ?? present('OPENAI_BASE_URL');
}

/** Runs COMMAND with its LLM calls captured; falls back to running it unwrapped. Returns the exit code. */
export async function runCapture(input: { command: string[]; agent?: string; drive?: string }) {
  const { command } = input;
  if (!command.length)
    throw new Error('Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]');
  const base = basename(command[0]!);
  const agent =
    input.agent ??
    (base
      .toLowerCase()
      .replace(/[^a-z0-9._-]/gu, '-')
      .replace(/^[^a-z0-9]+/u, '')
      .slice(0, 40) ||
      'agent');
  if (!AGENT_PATTERN.test(agent))
    throw new Error('--agent must be 1-40 characters: lowercase letters, digits, ".", "_" or "-".');
  const unwrapped = (reason: string) => {
    process.stderr.write(`capture disabled: ${reason}; running ${command[0]} without capture\n`);
    return spawnChild(command, process.env, command.slice(1));
  };
  const preset = chosenEnvironment(command);
  if (preset) return unwrapped(`${preset} is already set`);

  let proxy: Awaited<ReturnType<typeof startProxy>>;
  const log = (line: string) => process.stderr.write(`${line}\n`);
  try {
    const connection = await resolveConnection();
    const driveId = resolveDriveId(input.drive, connection.config, connection.apiUrl);
    if (!/^[A-Za-z0-9_-]+$/u.test(driveId)) throw new Error(`invalid drive ID ${driveId}`);
    const driveKey = await resolveDriveKey(driveId, undefined, connection.config);
    if (!driveKey) throw new Error(`no drive key for drive ${driveId}`);
    decodeDriveKey(driveKey);
    const client = new AgentDriveClient({
      apiUrl: connection.apiUrl,
      apiKey: connection.apiKey,
      machine: machineName(),
      driveKey,
    });
    const spool = await Spool.open(join(`${configPath()}.state`, 'capture', driveId));
    const drainer = new Drainer(spool, client, driveId, { log });
    proxy = await startProxy({ agent, driveId, driveKey, drainer, log });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/gu, ' ')
      .replace(/\.$/u, '');
    return unwrapped(reason);
  }

  proxy.drainer.kick(); // leftovers from earlier offline runs
  const origin = `http://127.0.0.1:${proxy.port}`;
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: `${origin}/anthropic`,
    OPENAI_BASE_URL: `${origin}/openai`,
  };
  const args =
    base === 'codex' ? [...codexProviderFlags(proxy.port), ...command.slice(1)] : command.slice(1);
  const code = await spawnChild(command, env, args);
  await proxy.close();
  log(await proxy.summary());
  return code;
}

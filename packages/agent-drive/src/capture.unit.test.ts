import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Drainer, Spool, type UploadClient } from './capture-spool.js';
import { startProxy, type ProxyOptions } from './capture.js';
import { AgentDriveApiError } from './client.js';
import { decryptFile, generateDriveKey } from './crypto.js';

const MiB = 1024 * 1024;
const KEY = generateDriveKey();
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Seen = { url: string; headers: http.IncomingHttpHeaders; body: Buffer };

async function fakeUpstream(
  respond: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: Buffer,
    seen: Seen[],
  ) => void,
) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      respond(req, res, body, seen);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as { port: number }).port;
  const upstream = { protocol: 'http' as const, hostname: '127.0.0.1', port };
  return { seen, port, upstreams: { anthropic: upstream, openai: upstream } };
}

async function setup(
  upstreams: ProxyOptions['upstreams'],
  options: {
    client?: UploadClient;
    capBytes?: number;
    spoolDir?: string;
    proxy?: Partial<ProxyOptions>;
  } = {},
) {
  const dir = options.spoolDir ?? (await mkdtemp(join(tmpdir(), 'capture-test-')));
  cleanups.push(async () => {
    await chmod(dir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const logs: string[] = [];
  const uploads: { path: string; ciphertext: Uint8Array; wrappedKey: string }[] = [];
  const client: UploadClient = options.client ?? {
    putEncrypted: async (_d, path, ciphertext, wrappedKey) => {
      uploads.push({ path, ciphertext, wrappedKey });
    },
  };
  const spool = await Spool.open(dir, options.capBytes ? { capBytes: options.capBytes } : {});
  const drainer = new Drainer(spool, client, 'drive1', {
    log: (l) => logs.push(l),
    minBackoffMs: 5,
    maxBackoffMs: 10,
  });
  const proxy = await startProxy({
    agent: 'claude',
    driveId: 'drive1',
    driveKey: KEY,
    drainer,
    log: (l) => logs.push(l),
    ...(upstreams ? { upstreams } : {}),
    ...options.proxy,
  });
  cleanups.push(() => proxy.close({ taskMs: 100, totalMs: 100 }));
  return { proxy, dir, logs, uploads, spool };
}

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function send(
  port: number,
  path: string,
  options: { method?: string; headers?: http.OutgoingHttpHeaders; body?: Buffer | string } = {},
  onChunk?: (chunk: Buffer, at: number) => void,
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          onChunk?.(c, Date.now());
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.on('socket', (socket) => socket.on('error', () => {})); // early 502s can reset a large upload
    req.end(options.body);
  });
}

async function spooled(dir: string) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  const out = [];
  for (const name of names) {
    const meta = JSON.parse(await readFile(join(dir, name), 'utf8')) as {
      path: string;
      wrappedKey: string;
      tags: string[];
    };
    const ciphertext = new Uint8Array(await readFile(join(dir, name.replace(/json$/u, 'adrv'))));
    const text = new TextDecoder().decode(await decryptFile(ciphertext, meta.wrappedKey, KEY));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.push({ meta, text, trace: JSON.parse(text) as Record<string, any> });
  }
  return out;
}

const jsonReply = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('routing', () => {
  it('strips the prefix, rewrites host only, and 404s unknown prefixes', async () => {
    const up = await fakeUpstream((_q, res) => jsonReply(res, { ok: true }));
    const s = await setup(up.upstreams);
    const headers = { 'content-type': 'application/json', 'x-custom': 'a', 'anthropic-beta': 'b' };
    await send(s.proxy.port, '/anthropic/v1/messages?x=1', { headers, body: '{"model":"m"}' });
    await send(s.proxy.port, '/openai/v1/responses', { headers, body: '{}' });
    expect(up.seen.map((x) => x.url)).toEqual(['/v1/messages?x=1', '/v1/responses']);
    expect(up.seen[0]!.headers.host).toBe(`127.0.0.1:${up.port}`);
    expect(up.seen[0]!.headers['x-custom']).toBe('a');
    expect(up.seen[0]!.headers['anthropic-beta']).toBe('b');
    const before = up.seen.length;
    const miss = await send(s.proxy.port, '/foo', { headers, body: '{}' });
    expect(miss.status).toBe(404);
    expect(up.seen.length).toBe(before);
    await s.proxy.close({ taskMs: 1000, totalMs: 2000 });
    expect(s.logs.some((l) => /capture: POST \/v1\/messages 200 \d+ms captured/u.test(l))).toBe(
      true,
    );
    expect((await spooled(s.dir)).length + s.uploads.length).toBe(2);
  });
});

describe('streaming', () => {
  it('delivers each chunk before the next is sent, with identical bytes', async () => {
    const parts = [
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: d\ndata: {"a":1}\n\n',
      'event: d\ndata: {"a":2}\n\n',
    ];
    const sentAt: number[] = [];
    const up = await fakeUpstream((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0;
      const next = () => {
        if (i === parts.length) return res.end();
        sentAt.push(Date.now());
        res.write(parts[i++]);
        setTimeout(next, 50);
      };
      next();
    });
    const s = await setup(up.upstreams, {
      client: { putEncrypted: async () => Promise.reject(new TypeError('offline')) },
    });
    const arrivals: number[] = [];
    const reply = await send(
      s.proxy.port,
      '/anthropic/v1/messages',
      { body: '{"model":"m"}' },
      (_c, at) => arrivals.push(at),
    );
    expect(reply.body.toString()).toBe(parts.join(''));
    expect(arrivals.length).toBe(3);
    expect(arrivals[0]!).toBeLessThan(sentAt[1]! + 20);
    expect(arrivals[1]!).toBeLessThan(sentAt[2]! + 20);
    await s.proxy.close({ taskMs: 1000, totalMs: 2000 });
    const [first] = await spooled(s.dir);
    expect(first!.trace.response.sse[0]).toEqual({ event: 'ping', data: { type: 'ping' } });
  });
});

describe('byte-identical under failure', () => {
  it('forwards the same response whether or not capture and upload work', async () => {
    const up = await fakeUpstream((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-up': '1' });
      res.end('{"model":"m","reply":"hello"}');
    });
    const request = { headers: { 'content-type': 'application/json' }, body: '{"model":"m"}' };
    const baseline = await (async () => {
      const s = await setup(up.upstreams);
      const r = await send(s.proxy.port, '/anthropic/v1/messages', request);
      await s.proxy.close({ taskMs: 1000, totalMs: 1000 });
      return r;
    })();
    const comparable = (r: Reply) => ({
      status: r.status,
      body: r.body.toString(),
      headers: { ...r.headers, date: '' },
    });

    const cases: {
      name: string;
      options: Parameters<typeof setup>[1];
      after: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>;
    }[] = [
      {
        name: 'upload succeeds',
        options: {},
        after: async (s) => expect(s.uploads.length).toBe(1),
      },
      {
        name: 'network error',
        options: {
          client: { putEncrypted: async () => Promise.reject(new TypeError('fetch failed')) },
        },
        after: async (s) => expect((await spooled(s.dir)).length).toBe(1),
      },
      {
        name: 'api 503',
        options: {
          client: {
            putEncrypted: async () =>
              Promise.reject(new AgentDriveApiError('internal_error', 503, 'down')),
          },
        },
        after: async (s) => expect((await spooled(s.dir)).length).toBe(1),
      },
      {
        name: 'spool full',
        options: { capBytes: 1 },
        after: async (s) => {
          expect((await spooled(s.dir)).length).toBe(0);
          expect(s.logs.some((l) => l.includes('not captured: spool full'))).toBe(true);
        },
      },
    ];
    for (const c of cases) {
      const s = await setup(up.upstreams, c.options);
      const r = await send(s.proxy.port, '/anthropic/v1/messages', request);
      expect(comparable(r), c.name).toEqual(comparable(baseline));
      await s.proxy.close({ taskMs: 1000, totalMs: 300 });
      await c.after(s);
    }

    // Read-only spool: the capture write throws, the agent still gets the same bytes, one warning.
    const dir = await mkdtemp(join(tmpdir(), 'capture-ro-'));
    const s = await setup(up.upstreams, { spoolDir: dir });
    await chmod(dir, 0o500);
    const r = await send(s.proxy.port, '/anthropic/v1/messages', request);
    await send(s.proxy.port, '/anthropic/v1/messages', request);
    expect(comparable(r)).toEqual(comparable(baseline));
    await s.proxy.close({ taskMs: 1000, totalMs: 300 });
    expect(s.logs.filter((l) => l.startsWith('capture warning:')).length).toBe(1);
  });

  it('passes error bodies through unchanged and returns 502 when the upstream is down', async () => {
    const error = { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } };
    const up = await fakeUpstream((_q, res) => jsonReply(res, error, 400));
    const s = await setup(up.upstreams);
    const r = await send(s.proxy.port, '/anthropic/v1/messages', { body: '{}' });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body.toString())).toEqual(error);
    const dead = await setup({
      anthropic: { protocol: 'http', hostname: '127.0.0.1', port: 1 },
      openai: { protocol: 'http', hostname: '127.0.0.1', port: 1 },
    });
    const bad = await send(dead.proxy.port, '/anthropic/v1/messages', { body: '{}' });
    expect(bad.status).toBe(502);
    expect(dead.logs.some((l) => l.includes(' 502 ') && l.includes('upstream error'))).toBe(true);
  });
});

describe('bounded memory', () => {
  it('captures only what the budget allows and never runs two traces at once', async () => {
    let arrived = 0;
    const waiting: (() => void)[] = [];
    const up = await fakeUpstream((_q, res) => {
      const finish = () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.alloc(6 * MiB, 'r'));
      };
      arrived++;
      waiting.push(finish);
      if (arrived === 6) waiting.forEach((f) => f());
    });
    let active = 0;
    let maxActive = 0;
    const s = await setup(up.upstreams, {
      proxy: {
        budgetBytes: 16 * MiB,
        hooks: {
          onProcess: (state) => {
            active += state === 'start' ? 1 : -1;
            maxActive = Math.max(maxActive, active);
          },
        },
      },
    });
    const sample: number[] = [];
    const timer = setInterval(() => sample.push(s.proxy.reservedBytes), 2);
    const replies = await Promise.all(
      Array.from({ length: 6 }, () =>
        send(s.proxy.port, '/anthropic/v1/messages', { body: Buffer.alloc(6 * MiB, 'q') }),
      ),
    );
    clearInterval(timer);
    for (const r of replies) {
      expect(r.status).toBe(200);
      expect(r.body.equals(Buffer.alloc(6 * MiB, 'r'))).toBe(true);
    }
    await s.proxy.close({ taskMs: 10_000, totalMs: 10_000 });
    expect(s.logs.filter((l) => l.includes('not captured: memory')).length).toBe(4);
    expect(s.logs.filter((l) => l.endsWith(' captured')).length).toBe(2);
    expect(Math.max(...sample, s.proxy.peakReservedBytes)).toBeLessThanOrEqual(16 * MiB);
    expect(maxActive).toBe(1);
    const traces = s.uploads.length ? [] : await spooled(s.dir);
    for (const t of traces)
      expect(t.trace.truncated).toEqual(expect.arrayContaining(['request.body', 'response.body']));
  }, 30_000);
});

describe('redaction', () => {
  it('forwards credentials but never stores them', async () => {
    const up = await fakeUpstream((_q, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'sid=SECRET-E',
        'request-id': 'r1',
      });
      res.end('{"ok":true}');
    });
    const s = await setup(up.upstreams, {
      client: { putEncrypted: async () => Promise.reject(new TypeError('offline')) },
    });
    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer SECRET-A',
      'x-api-key': 'SECRET-B',
      'OpenAI-Api-Key': 'SECRET-C',
      'X-Custom-Token': 'SECRET-D',
      cookie: 'a=SECRET-F',
      'anthropic-beta': 'oauth-2025-04-20',
    };
    await send(s.proxy.port, '/anthropic/v1/messages', { headers, body: '{"model":"m"}' });
    await s.proxy.close({ taskMs: 1000, totalMs: 200 });
    const h = up.seen[0]!.headers;
    expect([h.authorization, h['x-api-key'], h['openai-api-key'], h['x-custom-token']]).toEqual([
      'Bearer SECRET-A',
      'SECRET-B',
      'SECRET-C',
      'SECRET-D',
    ]);
    const [trace] = await spooled(s.dir);
    expect(trace!.trace.request.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(trace!.trace.response.headers['request-id']).toBe('r1');
    expect(trace!.text).not.toMatch(/SECRET-[A-F]/u);
    expect(trace!.meta.path).toMatch(
      /^\/traces\/claude\/\d{4}-\d\d-\d\d\/\d{6}\.\d{3}Z_m_[0-9a-f]{6}\.json$/u,
    );
    expect(trace!.meta.tags).toEqual(['trace', 'agent:claude', 'model:m']);
  });
});

describe('gzip and size rules', () => {
  const echo = async () => {
    const up = await fakeUpstream((_q, res, body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ n: body.length }));
    });
    const s = await setup(up.upstreams, {
      client: { putEncrypted: async () => Promise.reject(new TypeError('offline')) },
    });
    return { up, s };
  };
  const capture = async (body: Buffer, headers: http.OutgoingHttpHeaders = {}) => {
    const { s } = await echo();
    await send(s.proxy.port, '/anthropic/v1/messages', { body, headers });
    await s.proxy.close({ taskMs: 5000, totalMs: 200 });
    const [t] = await spooled(s.dir);
    return t!;
  };
  const jsonOf = (size: number) => {
    const head = '{"model":"m","pad":"';
    return Buffer.from(`${head}${'x'.repeat(size - head.length - 2)}"}`);
  };

  it('decodes gzip requests and treats a gzip bomb as truncated without changing forwarding', async () => {
    const plain = { model: 'm', text: 'hi' };
    const gz = zlib.gzipSync(JSON.stringify(plain));
    const { up, s } = await echo();
    await send(s.proxy.port, '/anthropic/v1/messages', {
      body: gz,
      headers: { 'content-encoding': 'gzip' },
    });
    const bomb = zlib.gzipSync(Buffer.alloc(8 * MiB, 'a'));
    expect(bomb.length).toBeLessThan(100_000);
    await send(s.proxy.port, '/anthropic/v1/messages', {
      body: bomb,
      headers: { 'content-encoding': 'gzip' },
    });
    expect(up.seen[0]!.body.equals(gz)).toBe(true);
    expect(up.seen[1]!.body.equals(bomb)).toBe(true);
    await s.proxy.close({ taskMs: 5000, totalMs: 200 });
    const traces = await spooled(s.dir);
    expect(traces.find((t) => t.trace.request.body.text === 'hi')).toBeTruthy();
    expect(traces.find((t) => t.trace.truncated.includes('request.body'))).toBeTruthy();
  });

  it('stores 4 MiB - 1 whole and truncates 4 MiB + 1', async () => {
    const whole = await capture(jsonOf(4 * MiB - 1), { 'content-type': 'application/json' });
    expect(whole.trace.truncated).toEqual([]);
    expect(whole.trace.request.body.model).toBe('m');
    const cut = await capture(jsonOf(4 * MiB + 1), { 'content-type': 'application/json' });
    expect(cut.trace.truncated).toContain('request.body');
  }, 20_000);

  it('stores NUL bytes as a small binary marker', async () => {
    const t = await capture(Buffer.alloc(4 * MiB - 1, 0));
    expect(t.trace.request.body).toMatchObject({ binary: true, bytes: 4 * MiB - 1 });
    expect(t.text.length).toBeLessThan(MiB);
  }, 20_000);

  it('keeps every trace under 9 MiB, omitting the response first', async () => {
    const big = Buffer.alloc(3.5 * MiB, '"'); // not JSON; each byte doubles when escaped
    const up = await fakeUpstream((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(big);
    });
    const s = await setup(up.upstreams, {
      client: { putEncrypted: async () => Promise.reject(new TypeError('offline')) },
    });
    await send(s.proxy.port, '/anthropic/v1/messages', { body: big });
    await s.proxy.close({ taskMs: 10_000, totalMs: 200 });
    const [t] = await spooled(s.dir);
    expect(Buffer.byteLength(t!.text)).toBeLessThan(9 * MiB);
    expect(t!.trace.truncated[0]).toBe('response.body');
    expect(t!.trace.response.body).toMatchObject({ omitted: true });
  }, 30_000);
});

describe('shutdown ordering', () => {
  it('finishes encryption and upload before reporting', async () => {
    const up = await fakeUpstream((_q, res) => jsonReply(res, { model: 'm' }));
    const s = await setup(up.upstreams, {
      proxy: { hooks: { beforeEncrypt: () => new Promise((r) => setTimeout(r, 300)) } },
    });
    await send(s.proxy.port, '/anthropic/v1/messages', { body: '{"model":"m"}' });
    await s.proxy.close({ taskMs: 5000, totalMs: 10_000 });
    expect(s.uploads.length).toBe(1);
    expect(await s.proxy.summary()).toContain('capture: 1 uploaded, 0 queued');
  });
});

describe('review fixes', () => {
  it('drops captures after upstream failures so retained bytes stay within the budget', async () => {
    const dead = { protocol: 'http' as const, hostname: '127.0.0.1', port: 1 };
    const s = await setup({ anthropic: dead, openai: dead }, { proxy: { budgetBytes: 8 * MiB } });
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        send(s.proxy.port, '/anthropic/v1/messages', { body: Buffer.alloc(4 * MiB, 'q') }),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([502, 502, 502, 502]);
    await s.proxy.close({ taskMs: 2000, totalMs: 500 });
    expect(s.proxy.reservedBytes).toBe(0);
    expect(s.proxy.peakReservedBytes).toBeLessThanOrEqual(8 * MiB);
    expect((await spooled(s.dir)).length + s.uploads.length).toBe(0);
  }, 20_000);

  it('keeps query strings out of the log and redacts credential-like values in the trace', async () => {
    const up = await fakeUpstream((_q, res) => jsonReply(res, { ok: true }));
    const s = await setup(up.upstreams, {
      client: { putEncrypted: async () => Promise.reject(new TypeError('offline')) },
    });
    await send(s.proxy.port, '/anthropic/v1/messages?api_key=SECRET-Q&beta=true&x-Token=SECRET-T', {
      body: '{"model":"m"}',
    });
    await s.proxy.close({ taskMs: 1000, totalMs: 200 });
    expect(up.seen[0]!.url).toContain('api_key=SECRET-Q');
    expect(s.logs.join('\n')).not.toContain('SECRET');
    expect(s.logs.join('\n')).not.toContain('beta=true');
    const [t] = await spooled(s.dir);
    expect(t!.text).not.toContain('SECRET');
    expect(t!.trace.request.path).toBe(
      '/v1/messages?api_key=[redacted]&beta=true&x-Token=[redacted]',
    );
  });

  it('removes headers named in Connection in both directions', async () => {
    const up = await fakeUpstream((_q, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        connection: 'x-resp-hop',
        'x-resp-hop': 'secret',
        'x-keep': '1',
      });
      res.end('{}');
    });
    const s = await setup(up.upstreams);
    const r = await send(s.proxy.port, '/anthropic/v1/messages', {
      headers: { connection: 'x-hop, close', 'x-hop': 'a', 'x-other': 'b' },
      body: '{}',
    });
    expect(up.seen[0]!.headers['x-hop']).toBeUndefined();
    expect(up.seen[0]!.headers['x-other']).toBe('b');
    expect(r.headers['x-resp-hop']).toBeUndefined();
    expect(r.headers['x-keep']).toBe('1');
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLogin } from './device.js';

const { subtle } = webcrypto;
const text = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString('base64url');
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-device-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  return join(dir, 'config.json');
}

const start = {
  device_code: 'dev-code',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://x.test/connect',
  verification_uri_complete: 'https://x.test/connect?code=BCDF-GHJK',
  expires_in: 600,
  interval: 5,
};

type Handler = (n: number, publicKey: string) => Response | Promise<Response>;

function run(tokens: Handler) {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const out: string[] = [];
  const sleeps: number[] = [];
  let polls = 0;
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/oauth/device_authorization')) return json(200, start);
    return tokens(polls++, calls[0]?.body.public_key ?? '');
  };
  const promise = deviceLogin({
    apiUrl: 'https://x.test/api',
    name: 'bot',
    machine: 'box',
    fetch: fetcher as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    log: (line) => out.push(line),
    openBrowser: false,
  });
  return { promise, calls, out, sleeps };
}

async function seal(publicKey: string, driveId: string, secret: string) {
  const agent = await subtle.importKey(
    'raw',
    Buffer.from(publicKey, 'base64url'),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: agent }, eph.privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: text.encode('agent-drive-device-v1'),
      info: text.encode(driveId),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: text.encode(driveId) },
    aes,
    text.encode(secret),
  );
  return { epk: b64(await subtle.exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

describe('deviceLogin', () => {
  it('polls through pending and slow_down, saves config, never prints secrets', async () => {
    const path = await setup();
    const r = run(async (n, publicKey) => {
      if (n === 0) return json(400, { error: 'authorization_pending' });
      if (n === 1) return json(400, { error: 'slow_down' });
      return json(200, {
        access_token: 'adk_SECRETTOKEN',
        token_type: 'Bearer',
        scope: 'read write',
        api_url: 'https://x.test/api',
        agent_name: 'bot',
        drive_ids: ['d1', 'd2'],
        new_drive_id: 'd3',
        sealed_drive_keys: {
          d1: await seal(publicKey, 'd1', 'KEY-ONE'),
          d2: { epk: 'bad', iv: 'bad', ct: 'bad' },
        },
      });
    });
    await r.promise;
    expect(r.sleeps).toEqual([5000, 5000, 10000]);
    expect(r.calls[0]?.body).toMatchObject({ client_name: 'bot', machine: 'box' });
    expect(r.calls[1]?.body).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'dev-code',
    });
    const saved = JSON.parse(await readFile(path, 'utf8')) as {
      apiUrl: string;
      apiKey: string;
      driveKeys: Record<string, string>;
    };
    expect(saved.apiUrl).toBe('https://x.test/api');
    expect(saved.apiKey).toBe('adk_SECRETTOKEN');
    expect(saved.driveKeys.d1).toBe('KEY-ONE');
    expect(saved.driveKeys.d2).toBeUndefined();
    expect(saved.driveKeys.d3).toBeTruthy();
    const printed = r.out.join('\n');
    expect(printed).toContain('BCDF-GHJK');
    expect(printed).toContain('https://x.test/connect?code=BCDF-GHJK');
    expect(printed).toMatch(/d2/u);
    for (const secret of ['adk_SECRETTOKEN', 'KEY-ONE', saved.driveKeys.d3 ?? 'x'])
      expect(printed).not.toContain(secret);
  });

  it('reports a denied request', async () => {
    await setup();
    const r = run(() => json(400, { error: 'access_denied' }));
    await expect(r.promise).rejects.toThrow(/denied/iu);
  });

  it('reports an expired code from the server', async () => {
    await setup();
    const r = run(() => json(400, { error: 'expired_token' }));
    await expect(r.promise).rejects.toThrow(/expired/iu);
  });

  it('gives up after expires_in without server help', async () => {
    await setup();
    const r = run(() => json(400, { error: 'authorization_pending' }));
    await expect(r.promise).rejects.toThrow(/expired/iu);
    expect(r.sleeps.length).toBeLessThanOrEqual(121);
  });

  it('rejects a non-loopback http API URL without sending a request', async () => {
    const fetcher = vi.fn();
    await expect(
      deviceLogin({
        apiUrl: 'http://example.com/api',
        name: 'bot',
        machine: 'box',
        fetch: fetcher as unknown as typeof fetch,
        log: () => undefined,
        openBrowser: false,
      }),
    ).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows loopback http and refuses redirects', async () => {
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => json(500, {}));
    await expect(
      deviceLogin({
        apiUrl: 'http://127.0.0.1:3100/api',
        name: 'bot',
        machine: 'box',
        fetch: fetcher as unknown as typeof fetch,
        log: () => undefined,
        openBrowser: false,
      }),
    ).rejects.toThrow(/refused/);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
});

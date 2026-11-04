import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLogin, defaultAgentName } from './device.js';
import { AgentDriveApiError } from './client.js';
import { apiErrorLines, createdDriveNote, localKeyMap, pickCheckDrive, runCheck } from './check.js';

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

function run(tokens: Handler, extra: { apiUrl?: string } = {}) {
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
    apiUrl: extra.apiUrl ?? 'https://x.test/api',
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
        // The server lists the new drive in drive_ids too.
        drive_ids: ['d1', 'd2', 'd3'],
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
    expect(printed).toMatch(/No usable key for: d2\./u);
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
    const fetcher = vi.fn(async () => json(500, {}));
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
    expect((fetcher.mock.calls[0] as unknown[] | undefined)?.[1]).toMatchObject({
      redirect: 'error',
    });
  });

  it('saves the login URL, not a server-supplied api_url', async () => {
    const path = await setup();
    const r = run(() =>
      json(200, {
        access_token: 'adk_T',
        api_url: 'http://evil.example/api',
        drive_ids: ['dn'],
        new_drive_id: 'dn',
      }),
    );
    await r.promise;
    const saved = JSON.parse(await readFile(path, 'utf8')) as { apiUrl: string };
    expect(saved.apiUrl).toBe('https://x.test/api');
  });

  it('sends known_drive_ids from saved keys for the same origin only', async () => {
    const path = await setup();
    await writeFile(
      path,
      JSON.stringify({ apiUrl: 'https://x.test/api', apiKey: 'k', driveKeys: { a: 'A', b: 'B' } }),
    );
    const same = run(() => json(200, { access_token: 't', drive_ids: ['a'] }));
    await same.promise;
    expect(same.calls[0]?.body.known_drive_ids).toEqual(['a', 'b']);
    const other = run(() => json(200, { access_token: 't', drive_ids: ['n'], new_drive_id: 'n' }), {
      apiUrl: 'https://other.test/api',
    });
    await other.promise;
    expect(other.calls[0]?.body.known_drive_ids).toBeUndefined();
  });

  it('fails with the contract message when no granted drive has a key, but keeps the config', async () => {
    const path = await setup();
    const r = run(() => json(200, { access_token: 'adk_T', drive_ids: ['d9'] }));
    await expect(r.promise).rejects.toThrow(
      "Login finished but this agent has no usable drive key. Run `agent-drive login` again; the owner's approval will create a drive for this agent.",
    );
    expect(JSON.parse(await readFile(path, 'utf8')).apiKey).toBe('adk_T');
  });

  it('counts a granted drive whose key is already saved as usable', async () => {
    const path = await setup();
    await writeFile(path, JSON.stringify({ apiUrl: 'https://x.test/api', driveKeys: { d9: 'K' } }));
    const r = run(() => json(200, { access_token: 't', drive_ids: ['d9'] }));
    await r.promise;
    expect(r.out.join('\n')).toContain('Usable drives: d9');
  });

  it('defaults the agent name to "<machine> agent"', () => {
    vi.stubEnv('AGENT_DRIVE_MACHINE', 'laptop');
    expect(defaultAgentName()).toBe('laptop agent');
  });
});

describe('check and key helpers', () => {
  it('whoami localDriveKeys reports which authorized drives have a key', async () => {
    expect(await localKeyMap(['a', 'b'], async (id) => (id === 'a' ? 'K' : undefined))).toEqual({
      a: true,
      b: false,
    });
    expect(await localKeyMap(null, async () => 'K')).toEqual({});
  });

  it('picks the only keyed drive, or requires --drive', () => {
    expect(pickCheckDrive(undefined, ['a', 'b'], { a: true, b: false })).toBe('a');
    expect(() => pickCheckDrive(undefined, ['a', 'b'], { a: true, b: true })).toThrow(/--drive/u);
    expect(() => pickCheckDrive(undefined, ['a'], { a: false })).toThrow(/no usable drive key/iu);
    expect(() => pickCheckDrive('z', ['a'], { a: true })).toThrow(/no key/iu);
    expect(pickCheckDrive('a', ['a', 'b'], { a: true, b: true })).toBe('a');
  });

  function fake(readBack: (b: Uint8Array) => Uint8Array) {
    let sent: Uint8Array = new Uint8Array();
    return {
      put: vi.fn(async (_d: string, _p: string, bytes: Uint8Array, o: unknown) => {
        sent = bytes;
        expect(o).toEqual({ mode: 'overwrite' });
        return {} as never;
      }),
      get: vi.fn(async () => ({ bytes: readBack(sent) }) as never),
    };
  }

  it('check succeeds when the bytes round-trip', async () => {
    const c = fake((b) => b);
    expect(await runCheck(c, 'd1')).toBe('check ok drive=d1');
    expect(c.put.mock.calls[0]?.[1]).toBe('/.agent-drive/check.txt');
  });

  it('check fails on a mismatch', async () => {
    await expect(
      runCheck(
        fake(() => new Uint8Array([1])),
        'd1',
      ),
    ).rejects.toThrow(/mismatch/iu);
  });

  it('check surfaces a permission error', async () => {
    const c = {
      put: async () => {
        throw new AgentDriveApiError(
          'permission_denied',
          403,
          'The API key lacks the "write" scope.',
        );
      },
      get: async () => ({}) as never,
    };
    await expect(runCheck(c, 'd1')).rejects.toThrow('lacks the "write" scope');
  });

  it('drive create note has no key and names the config path', () => {
    const note = createdDriveNote('/c/config.json');
    expect(note).toBe('Drive key saved to /c/config.json; back it up.');
  });

  it('appends the reconnect hint only for permission_denied', () => {
    const denied = new AgentDriveApiError(
      'permission_denied',
      403,
      'The API key lacks the "write" scope.',
    );
    expect(apiErrorLines(denied)).toEqual([
      'The API key lacks the "write" scope.',
      'Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope.',
    ]);
    expect(apiErrorLines(new AgentDriveApiError('not_found', 404, 'nope'))).toEqual(['nope']);
  });
});

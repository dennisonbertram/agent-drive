import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLogin, defaultAgentName } from './device.js';
import { AgentDriveApiError } from './client.js';
import { DriveCryptoError } from './crypto.js';
import { apiErrorLines, createdDriveNote, localKeyMap, pickCheckDrive, runCheck } from './check.js';

const { subtle } = webcrypto;
const text = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString('base64url');
const dirs: string[] = [];
const K1 = Buffer.alloc(32, 1).toString('base64url');
const K2 = Buffer.alloc(32, 2).toString('base64url');
const K9 = Buffer.alloc(32, 9).toString('base64url');
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
          d1: await seal(publicKey, 'd1', K1),
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
      driveKeyOrigins: Record<string, string>;
    };
    expect(saved.apiUrl).toBe('https://x.test/api');
    expect(saved.apiKey).toBe('adk_SECRETTOKEN');
    expect(saved.driveKeys.d1).toBe(K1);
    expect(saved.driveKeys.d2).toBeUndefined();
    expect(saved.driveKeys.d3).toBeTruthy();
    expect(saved.driveKeyOrigins).toEqual({ d1: 'https://x.test', d3: 'https://x.test' });
    const printed = r.out.join('\n');
    expect(printed).toContain('BCDF-GHJK');
    expect(printed).toContain('https://x.test/connect?code=BCDF-GHJK');
    expect(printed).toMatch(/d2/u);
    expect(printed).toMatch(/No usable key for: d2\./u);
    for (const secret of ['adk_SECRETTOKEN', K1, saved.driveKeys.d3 ?? 'x'])
      expect(printed).not.toContain(secret);
  });

  it('prints the write paths only when the key is limited', async () => {
    await setup();
    const token = (write_paths: string[]) => async () =>
      json(200, {
        access_token: 'adk_T',
        scope: 'read write',
        drive_ids: ['d3'],
        new_drive_id: 'd3',
        write_paths,
      });
    const limited = run(token(['/inbox/x', '/outputs']));
    await limited.promise;
    expect(limited.out).toContain('Writes limited to: /inbox/x, /outputs');
    const open = run(token([]));
    await open.promise;
    expect(open.out.join('\n')).not.toContain('Writes limited');
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
      JSON.stringify({
        apiUrl: 'https://x.test/api',
        apiKey: 'k',
        driveKeys: { a: K1, b: K2 },
        driveKeyOrigins: { a: 'https://x.test', b: 'https://x.test' },
      }),
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

  it('migrates legacy keys without origins to the saved apiUrl origin', async () => {
    const path = await setup();
    await writeFile(
      path,
      JSON.stringify({ apiUrl: 'https://x.test/api', apiKey: 'k', driveKeys: { a: K1 } }),
    );
    const same = run(() => json(200, { access_token: 't', drive_ids: ['a'] }));
    await same.promise;
    expect(same.calls[0]?.body.known_drive_ids).toEqual(['a']);
    expect(same.out.join('\n')).toContain('Usable drives: a');
    const saved = JSON.parse(await readFile(path, 'utf8')) as { driveKeyOrigins: unknown };
    expect(saved.driveKeyOrigins).toEqual({ a: 'https://x.test' });
    await writeFile(
      path,
      JSON.stringify({ apiUrl: 'https://x.test/api', apiKey: 'k', driveKeys: { a: K1 } }),
    );
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
    await writeFile(
      path,
      JSON.stringify({
        apiUrl: 'https://x.test/api',
        driveKeys: { d9: K9 },
        driveKeyOrigins: { d9: 'https://x.test' },
      }),
    );
    const r = run(() => json(200, { access_token: 't', drive_ids: ['d9'] }));
    await r.promise;
    expect(r.out.join('\n')).toContain('Usable drives: d9');
  });

  it('sends the saved key as a bearer header only to the saved origin', async () => {
    const path = await setup();
    await writeFile(path, JSON.stringify({ apiUrl: 'https://x.test/api', apiKey: 'adk_OLD' }));
    const headers: Record<string, string>[] = [];
    const go = (apiUrl: string) =>
      deviceLogin({
        apiUrl,
        name: 'bot',
        machine: 'box',
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
          headers.push(init?.headers as Record<string, string>);
          return String(url).endsWith('/oauth/device_authorization')
            ? json(200, start)
            : json(200, { access_token: 't', drive_ids: ['n'], new_drive_id: 'n' });
        }) as typeof fetch,
        sleep: async () => undefined,
        log: () => undefined,
        openBrowser: false,
      });
    await go('https://x.test/api');
    expect(headers[0]?.authorization).toBe('Bearer adk_OLD');
    expect(headers[1]?.authorization).toBeUndefined();
    await writeFile(path, JSON.stringify({ apiUrl: 'https://x.test/api', apiKey: 'adk_OLD' }));
    headers.length = 0;
    await go('https://other.test/api');
    expect(headers[0]?.authorization).toBeUndefined();
  });

  it('does not send or count keys from another origin, or malformed (a missing origin is migrated)', async () => {
    const path = await setup();
    await writeFile(
      path,
      JSON.stringify({
        apiUrl: 'https://x.test/api',
        apiKey: 'k',
        driveKeys: { good: K1, other: K2, unknown: K9, bad: 'K' },
        driveKeyOrigins: {
          good: 'https://x.test',
          other: 'https://other.test',
          bad: 'https://x.test',
        },
      }),
    );
    const r = run(() =>
      json(200, { access_token: 't', drive_ids: ['good', 'other', 'unknown', 'bad'] }),
    );
    await r.promise;
    expect(r.calls[0]?.body.known_drive_ids).toEqual(['good', 'unknown']);
    expect(r.out.join('\n')).toContain('Usable drives: good, unknown\n');
  });

  it('caps the default name at 64 characters', () => {
    vi.stubEnv('AGENT_DRIVE_MACHINE', 'h'.repeat(200));
    expect(defaultAgentName()).toHaveLength(64);
    expect(defaultAgentName().endsWith(' agent')).toBe(true);
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
      recent: vi.fn(async () => ({ items: [], nextCursor: null }) as never),
      list: vi.fn(async () => ({ items: [], nextCursor: null }) as never),
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

  it('check downloads the newest file from the recent feed and fails if it cannot be decrypted', async () => {
    const ev = (path: string, operation = 'put') => ({ path, operation });
    const items = [ev('/.agent-drive/check.txt'), ev('/gone', 'delete'), ev('/new'), ev('/old')];
    const base = fake((b) => b);
    const gets: string[] = [];
    const c = {
      ...base,
      recent: async () => ({ items }) as never,
      // list's first page would hold only an older file the key still opens
      list: async () =>
        ({ items: [{ path: '/a-old', createdAt: '2026-01-01T00:00:00Z' }] }) as never,
      get: vi.fn(async (_d: string, path: string) => {
        gets.push(path);
        if (path === '/new') throw new DriveCryptoError('decryption_failed', 'bad');
        return { bytes: new Uint8Array() } as never;
      }),
    };
    await expect(runCheck(c, 'd1')).rejects.toThrow(
      'This drive key cannot decrypt existing files.',
    );
    expect(gets).toEqual(['/new']);
    expect(base.put).not.toHaveBeenCalled();
    const ok = {
      ...base,
      recent: c.recent,
      get: vi.fn(async (d: string, path: string) =>
        path === '/new'
          ? ({ bytes: new Uint8Array() } as never)
          : (base.get as (d: string, p: string) => Promise<never>)(d, path),
      ),
    };
    expect(await runCheck(ok as never, 'd1')).toBe('check ok drive=d1');
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
      recent: async () => ({ items: [] }) as never,
      list: async () => ({ items: [] }) as never,
    };
    await expect(runCheck(c, 'd1')).rejects.toThrow('lacks the "write" scope');
  });

  it('check writes its file under the first write path', async () => {
    const c = fake((b) => b);
    const ok = await runCheck(c, 'd1', { scopes: ['read', 'write'], writePaths: ['/inbox/x'] });
    expect(ok).toBe('check ok drive=d1');
    expect(c.put.mock.calls[0]?.[1]).toBe('/inbox/x/.agent-drive/check.txt');
  });

  describe('read-only check', () => {
    const readOnly = { scopes: ['read'], writePaths: [] };
    const gone = () => new AgentDriveApiError('not_found', 404, 'gone');
    const files = (...paths: string[]) => paths.map((path) => ({ path }));
    function reader(pages: string[][], get: (path: string) => Promise<unknown>) {
      return {
        ...fake((b) => b),
        list: vi.fn(async (_d: string, _p: unknown, _l: unknown, cursor?: string) => {
          const index = cursor ? Number(cursor) : 0;
          return {
            items: files(...pages[index]!),
            nextCursor: index + 1 < pages.length ? String(index + 1) : null,
          } as never;
        }),
        get: vi.fn(async (_d: string, path: string) => get(path) as never),
      };
    }

    it('skips a candidate deleted since listing and never writes', async () => {
      const c = reader([['/a', '/b']], async (path) => {
        if (path === '/a') throw gone();
        return { bytes: new Uint8Array() };
      });
      expect(await runCheck(c, 'd1', readOnly)).toBe('check ok drive=d1 (read-only)');
      expect(c.put).not.toHaveBeenCalled();
    });

    it('continues to the next page when page one is all stale, and skips the check file', async () => {
      const c = reader([['/.agent-drive/check.txt', '/a'], ['/b']], async (path) => {
        if (path !== '/b') throw gone();
        return { bytes: new Uint8Array() };
      });
      expect(await runCheck(c, 'd1', readOnly)).toBe('check ok drive=d1 (read-only)');
      expect(c.get.mock.calls.map((call) => call[1])).toEqual(['/a', '/b']);
    });

    it('is not verified when nothing can be decrypted', async () => {
      const c = reader([['/a'], []], async () => {
        throw gone();
      });
      await expect(runCheck(c, 'd1', readOnly)).rejects.toThrow(/^check not verified drive=d1:/u);
      await expect(
        runCheck(
          reader([[]], async () => ({})),
          'd1',
          readOnly,
        ),
      ).rejects.toThrow(/not verified/u);
    });

    it('reports a key that cannot decrypt', async () => {
      const c = reader([['/a']], async () => {
        throw new DriveCryptoError('decryption_failed', 'bad');
      });
      await expect(runCheck(c, 'd1', readOnly)).rejects.toThrow(
        'This drive key cannot decrypt existing files.',
      );
    });
  });

  it('omits the scope hint for a write-path denial', () => {
    const denied = new AgentDriveApiError(
      'permission_denied',
      403,
      'The API key may only write under /inbox/x.',
    );
    expect(apiErrorLines(denied)).toEqual(['The API key may only write under /inbox/x.']);
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

  it('tells the conflict loser what to do for each state', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const lines = (
      state: 'exists' | 'changed' | 'trashed' | 'absent',
      currentVersionId?: string | null,
    ) => apiErrorLines(new AgentDriveApiError('conflict', 409, 'msg', { state, currentVersionId }));
    for (const state of ['exists', 'changed'] as const)
      expect(lines(state, id)).toEqual([
        'msg',
        `Current version: ${id}. Read the file again, merge your change, then retry with --if-version ${id}.`,
      ]);
    expect(lines('trashed', id)).toEqual([
      'msg',
      'The file is in the trash: restore it with "restore <path>" or write with --overwrite.',
    ]);
    expect(lines('absent', null)).toEqual([
      'msg',
      'There is no file at this path now; write it without --if-version.',
    ]);
  });
});

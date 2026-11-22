import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentDriveApiError, type AgentDriveClient } from './client.js';
import { generateDriveKey } from './crypto.js';
import { buildBundle } from './credentials.js';
import { readConfig, writeConfig } from './config.js';
import { unsealDriveKey, type SealedDriveKey } from './seal.js';
import {
  accountKeyFingerprint,
  accountSealStatePath,
  AccountKeyPinMismatch,
  autoSealHeldKeys,
  heldSealTargets,
  recordAgentOnlyDrive,
  sealDrivesToAccount,
} from './account-seal.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KEY_ID = '33333333-3333-4333-8333-333333333333';
const KEY_A = generateDriveKey();
const KEY_B = generateDriveKey();

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function dir() {
  const d = await mkdtemp(join(tmpdir(), 'agent-drive-seal-'));
  dirs.push(d);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(d, 'config.json'));
  return d;
}

async function accountKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
    'base64url',
  );
  return { privateKey: pair.privateKey, publicKey };
}

type Post = { driveId: string; keyId: string; sealed: SealedDriveKey };

function mockClient(opts: {
  publicKey?: string;
  keyId?: string;
  origin?: string;
  statuses?: Record<string, 'created' | 'exists'>;
  failPost?: string[] | true;
  list?: AgentDriveClient['listDrives'] | 'deny';
}) {
  const posts: Post[] = [];
  const client = {
    apiOrigin: opts.origin ?? 'https://x.test',
    accountKey: vi.fn(async () =>
      opts.publicKey ? { keyId: opts.keyId ?? KEY_ID, publicKey: opts.publicKey, format: 1 } : null,
    ),
    addAccountKeySlot: vi.fn(
      async (driveId: string, body: { keyId: string; sealed: SealedDriveKey }) => {
        if (opts.failPost === true || opts.failPost?.includes(driveId)) throw new Error('api down');
        posts.push({ driveId, ...body });
        return { status: opts.statuses?.[driveId] ?? ('created' as const) };
      },
    ),
    listDrives: vi.fn(
      opts.list === 'deny'
        ? async () => {
            throw new AgentDriveApiError('permission_denied', 403, 'Missing scope read.');
          }
        : ((opts.list ?? (async () => ({ items: [], nextCursor: null }))) as never),
    ),
  };
  return { client: client as unknown as AgentDriveClient, posts };
}

type StateFile = {
  pins: Record<string, string>;
  checked: Record<string, string>;
  agentOnly: string[];
};
async function readSealState(): Promise<StateFile> {
  return JSON.parse(await readFile(accountSealStatePath(), 'utf8')) as StateFile;
}

const baseConfig = {
  apiUrl: 'https://x.test/api',
  apiKey: 'tok',
};

describe('sealDrivesToAccount', () => {
  it('seals each held key to the account key and the slot opens with its private key', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client, posts } = mockClient({ publicKey: account.publicKey });
    const result = await sealDrivesToAccount({
      client,
      config: baseConfig,
      targets: [
        { driveId: A, driveKey: KEY_A },
        { driveId: B, driveKey: KEY_B },
      ],
      force: true,
    });
    expect(result.get(A)).toBe('sealed');
    expect(result.get(B)).toBe('sealed');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.keyId).toBe(KEY_ID);
    // Cross-check against the same context the console uses to unseal.
    const opened = await unsealDriveKey(account.privateKey, A, posts[0]!.sealed, {
      salt: 'agent-drive-account-v1',
      label: `${KEY_ID}:${A}`,
    });
    expect(opened).toBe(KEY_A);
  });

  it('marks existing slots as already sealed and agent-only targets are never posted', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client, posts } = mockClient({
      publicKey: account.publicKey,
      statuses: { [A]: 'exists' },
    });
    const result = await sealDrivesToAccount({
      client,
      config: baseConfig,
      targets: [
        { driveId: A, driveKey: KEY_A },
        { driveId: B, driveKey: KEY_B, agentOnly: true },
      ],
      force: true,
    });
    expect(result.get(A)).toBe('already sealed');
    expect(result.get(B)).toBe('agent-only');
    expect(posts.map((p) => p.driveId)).toEqual([A]);
  });

  it('reports no account key without posting anything', async () => {
    await dir();
    const { client, posts } = mockClient({});
    const result = await sealDrivesToAccount({
      client,
      config: baseConfig,
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
    });
    expect(result.get(A)).toBe('no account key');
    expect(posts).toHaveLength(0);
  });

  it('pins the fingerprint on first use and refuses a changed account key', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client } = mockClient({ publicKey: account.publicKey });
    await sealDrivesToAccount({
      client,
      config: { ...baseConfig },
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
    });
    // The pin lives in the private state file, never in config.json.
    expect((await readConfig()).accountKeyPins).toBeUndefined();
    expect((await readSealState()).pins['https://x.test']).toBe(
      accountKeyFingerprint(account.publicKey),
    );
    const stat = await import('node:fs/promises').then((fs) => fs.stat(accountSealStatePath()));
    expect(stat.mode & 0o777).toBe(0o600);

    const other = await accountKeyPair();
    const swapped = mockClient({ publicKey: other.publicKey });
    await expect(
      sealDrivesToAccount({
        client: swapped.client,
        config: baseConfig,
        targets: [{ driveId: A, driveKey: KEY_A }],
        force: true,
      }),
    ).rejects.toThrow(AccountKeyPinMismatch);
    expect(swapped.posts).toHaveLength(0);

    // --repin accepts the new key and updates the pin, again in the state file only.
    await sealDrivesToAccount({
      client: swapped.client,
      config: baseConfig,
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
      repin: true,
    });
    expect(swapped.posts).toHaveLength(1);
    expect((await readSealState()).pins['https://x.test']).toBe(
      accountKeyFingerprint(other.publicKey),
    );
    expect((await readConfig()).accountKeyPins).toBeUndefined();
  });

  it('keys the pin by the client apiOrigin, not the configured apiUrl', async () => {
    await dir();
    const account = await accountKeyPair();
    // The config points at x.test but this client effectively talks to y.test
    // (as AGENT_DRIVE_API_URL would produce).
    const { client } = mockClient({ publicKey: account.publicKey, origin: 'https://y.test' });
    await sealDrivesToAccount({
      client,
      config: baseConfig,
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
    });
    const state = await readSealState();
    expect(state.pins['https://y.test']).toBe(accountKeyFingerprint(account.publicKey));
    expect(state.pins['https://x.test']).toBeUndefined();
  });

  it('serializes first-use pinning so a second process compares the committed pin', async () => {
    await dir();
    const first = await accountKeyPair();
    const second = await accountKeyPair();
    const one = mockClient({ publicKey: first.publicKey });
    const two = mockClient({ publicKey: second.publicKey });
    const results = await Promise.allSettled([
      sealDrivesToAccount({
        client: one.client,
        config: baseConfig,
        targets: [{ driveId: A, driveKey: KEY_A }],
        force: true,
      }),
      sealDrivesToAccount({
        client: two.client,
        config: baseConfig,
        targets: [{ driveId: B, driveKey: KEY_B }],
        force: true,
      }),
    ]);
    // Exactly one process pins first; the other compares against that committed pin and stops.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AccountKeyPinMismatch);
    const state = await readSealState();
    expect(Object.keys(state.pins)).toEqual(['https://x.test']);
  });

  it('marks one drive failed without stopping the rest, and stamps only successes', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client, posts } = mockClient({
      publicKey: account.publicKey,
      failPost: [A],
    });
    const failures: string[] = [];
    const result = await sealDrivesToAccount({
      client,
      config: baseConfig,
      targets: [
        { driveId: A, driveKey: KEY_A },
        { driveId: B, driveKey: KEY_B },
      ],
      force: true,
      onFailure: (driveId) => failures.push(driveId),
    });
    expect(result.get(A)).toBe('failed');
    expect(result.get(B)).toBe('sealed');
    expect(failures).toEqual([A]);
    expect(posts.map((p) => p.driveId)).toEqual([B]);
    const state = await readSealState();
    expect(state.checked[A]).toBeUndefined();
    expect(typeof state.checked[B]).toBe('string');
  });

  it('never posts a locally recorded agent-only drive, whatever the listing says', async () => {
    await dir();
    await recordAgentOnlyDrive(B);
    const account = await accountKeyPair();
    const { client, posts } = mockClient({ publicKey: account.publicKey });
    const result = await sealDrivesToAccount({
      client,
      config: baseConfig,
      // The listing flag says B is ordinary; the local record still wins.
      targets: [
        { driveId: A, driveKey: KEY_A },
        { driveId: B, driveKey: KEY_B, agentOnly: false },
      ],
      force: true,
    });
    expect(result.get(B)).toBe('agent-only');
    expect(posts.map((p) => p.driveId)).toEqual([A]);
    // A server-side agent-only rejection is remembered locally too.
    const rejecting = mockClient({ publicKey: account.publicKey });
    rejecting.client.addAccountKeySlot = vi.fn(async (driveId: string) => {
      if (driveId === A)
        throw new AgentDriveApiError(
          'conflict',
          409,
          'This drive is agent-only; it cannot hold an account-key slot.',
        );
      return { status: 'created' as const };
    }) as never;
    const second = await sealDrivesToAccount({
      client: rejecting.client,
      config: baseConfig,
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
    });
    expect(second.get(A)).toBe('agent-only');
    expect((await readSealState()).agentOnly).toContain(A);
  });

  it('records the no-account-key check so the throttled path skips it next run', async () => {
    await dir();
    const { client } = mockClient({
      list: async () => ({
        items: [{ id: A, name: 'a', agentOnly: false, created_at: 't', quota_bytes: 0 }],
        nextCursor: null,
      }),
    });
    const config = {
      ...baseConfig,
      driveKeys: { [A]: KEY_A },
      driveKeyOrigins: { [A]: 'https://x.test' },
    };
    const warnings: string[] = [];
    const warn = (line: string) => warnings.push(line);
    await autoSealHeldKeys({ client, config, warn });
    expect(vi.mocked(client.accountKey).mock.calls.length).toBe(1);
    expect(typeof (await readSealState()).checked[A]).toBe('string');
    // The throttled follow-up does not even list drives.
    await autoSealHeldKeys({ client, config, warn });
    expect(vi.mocked(client.listDrives).mock.calls.length).toBe(1);
    expect(vi.mocked(client.accountKey).mock.calls.length).toBe(1);
  });

  it('throttles repeat seals for 24 hours unless forced', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client, posts } = mockClient({ publicKey: account.publicKey });
    const targets = [{ driveId: A, driveKey: KEY_A }];
    const config = { ...baseConfig };
    await sealDrivesToAccount({ client, config, targets });
    expect(posts).toHaveLength(1);

    const again = await sealDrivesToAccount({ client, config, targets });
    expect(again.size).toBe(0);
    expect(posts).toHaveLength(1);

    const forced = await sealDrivesToAccount({ client, config, targets, force: true });
    expect(forced.get(A)).toBe('sealed');
    expect(posts).toHaveLength(2);
  });
});

/** Runs the real CLI in-process against a stubbed API (same harness as cli.command.unit.test). */
type Saved = { keys: Record<string, string>; origins: Record<string, string> };
async function cli(
  argv: string[],
  saved: Saved,
  respond: (path: string, init?: RequestInit) => unknown,
  extra?: { pins?: Record<string, string>; env?: Record<string, string>; dir?: string },
) {
  // `dir` reuses one config directory so private state (pins) carries across runs.
  const d = extra?.dir ?? (await mkdtemp(join(tmpdir(), 'agent-drive-cmd-')));
  dirs.push(d);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(d, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
  for (const [name, value] of Object.entries(extra?.env ?? {})) vi.stubEnv(name, value);
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: saved.keys,
    driveKeyOrigins: saved.origins,
    keyBackup: Object.fromEntries(
      Object.keys(saved.keys).map((id) => [id, { at: 'now', method: 'file' as const }]),
    ),
    ...(extra?.pins ? { accountKeyPins: extra.pins } : {}),
  });
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname.replace('/api/v1/', '');
      paths.push(`${init?.method ?? 'GET'} ${path}`);

      // Honor abort signals: the sealing client's 5s deadline must be able to cut a hung call.
      const abort = init?.signal
        ? new Promise<never>((_resolve, reject) => {
            const fail = () => reject(new DOMException('Aborted', 'AbortError'));
            if (init.signal!.aborted) fail();
            else init.signal!.addEventListener('abort', fail, { once: true });
          })
        : null;
      const body = await (abort
        ? Promise.race([Promise.resolve(respond(path, init)), abort])
        : respond(path, init));
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true));
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', ...argv]);
  process.exitCode = undefined;
  vi.resetModules();
  const mod = (await import('./cli.js')) as { done?: Promise<void> };
  // The CLI entry point runs the command without awaiting it; `done` settles when the whole
  // command (including best-effort account sealing) has finished.
  await mod.done;
  // Getters, not snapshots: best-effort account sealing can write to stderr after the first
  // output line, and tests poll these inside vi.waitFor.
  return {
    get out() {
      return out.join('');
    },
    get err() {
      return err.join('');
    },
    paths,
  };
}

async function waitForPath(paths: string[], fragment: string) {
  await vi.waitFor(() => expect(paths.some((p) => p.includes(fragment))).toBe(true), {
    timeout: 3000,
  });
}

describe('account sealing at the command level', () => {
  const one: Saved = { keys: { [A]: generateDriveKey() }, origins: { [A]: 'https://x.test' } };
  /** API with an account key; drives A and B exist, B optionally agent-only. */
  async function api(opts: { noAccountKey?: boolean; agentOnly?: boolean } = {}) {
    const account = await accountKeyPair();
    const respond = (path: string, init?: RequestInit): unknown => {
      if (path === 'account-key')
        return opts.noAccountKey
          ? { accountKey: null }
          : { keyId: KEY_ID, publicKey: account.publicKey, format: 1 };
      if (path === 'drives' && init?.method === 'POST')
        return { id: B, name: 'fresh', created: true, agentOnly: opts.agentOnly === true };
      if (path === 'drives')
        return {
          items: [
            { id: A, name: 'a', agentOnly: false, created_at: 't' },
            { id: B, name: 'b', agentOnly: opts.agentOnly === true, created_at: 't' },
          ],
          nextCursor: null,
        };
      if (path.endsWith('/account-key-slot')) return { status: 'created' };
      return {};
    };
    return { account, respond };
  }

  it('drive create seals the new key to the account key', async () => {
    const { account, respond } = await api();
    const r = await cli(['drive', 'create', '--name', 'fresh'], { keys: {}, origins: {} }, respond);
    expect(r.out).toContain(B);
    await waitForPath(r.paths, `POST drives/${B}/account-key-slot`);
    expect(r.err).toContain('back it up');
    // The sealed slot opens with the account private key under the console's context.
    const calls = vi.mocked(fetch).mock.calls as [URL | string, RequestInit?][];
    const slot = calls.find(([url, init]) => {
      const path = new URL(String(url)).pathname;
      return path.endsWith('/account-key-slot') && init?.method === 'POST';
    });
    expect(slot).toBeDefined();
    const posted = JSON.parse(String(slot![1]!.body)) as {
      keyId: string;
      sealed: SealedDriveKey;
    };
    expect(posted.keyId).toBe(KEY_ID);
    const config = await readConfig();
    const sealed = await unsealDriveKey(account.privateKey, B, posted.sealed, {
      salt: 'agent-drive-account-v1',
      label: `${KEY_ID}:${B}`,
    });
    expect(sealed).toBe(config.driveKeys?.[B]);
  }, 15_000);

  it('drive create --agent-only sends the flag and never posts a slot', async () => {
    const { respond } = await api({ agentOnly: true });
    const r = await cli(
      ['drive', 'create', '--name', 'fresh', '--agent-only'],
      { keys: {}, origins: {} },
      respond,
    );
    expect(r.out).toContain(B);
    await vi.waitFor(() => expect(r.paths.length).toBeGreaterThan(1), { timeout: 3000 });
    expect(r.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
  }, 15_000);

  it('drive create warns once when the account has no account key', async () => {
    const { respond } = await api({ noAccountKey: true });
    const r = await cli(['drive', 'create', '--name', 'fresh'], { keys: {}, origins: {} }, respond);
    expect(r.out).toContain(B);
    await vi.waitFor(() => expect(r.err).toContain('Your account has no account key yet'), {
      timeout: 3000,
    });
    expect(r.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
  }, 15_000);

  it('a failing slot POST only adds one stderr line; the command still succeeds', async () => {
    const { respond } = await api();
    const wrapped = (path: string, init?: RequestInit): unknown =>
      path.endsWith('/account-key-slot')
        ? new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 })
        : respond(path, init);
    const r = await cli(['drive', 'create', '--name', 'fresh'], { keys: {}, origins: {} }, wrapped);
    expect(r.out).toContain(B);
    await vi.waitFor(() => expect(r.err).toContain('Drive key sealing skipped'), {
      timeout: 3000,
    });
  }, 15_000);

  it('account seal prints one line per drive', async () => {
    const { respond } = await api({ agentOnly: true });
    const two: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://x.test' },
    };
    const r = await cli(['account', 'seal'], two, respond);
    await vi.waitFor(() => expect(r.out.split('\n').length).toBeGreaterThan(1), { timeout: 3000 });
    expect(r.out).toContain(`${A}: sealed`);
    expect(r.out).toContain(`${B}: agent-only`);
  }, 15_000);

  it('account seal reports no account key and already sealed', async () => {
    const none = await api({ noAccountKey: true });
    const r = await cli(['account', 'seal'], one, none.respond);
    expect(r.out).toContain(`${A}: no account key`);
    const existing = await api();
    const r2 = await cli(['account', 'seal', '--drive', A], one, (path, init) =>
      path.endsWith('/account-key-slot') ? { status: 'exists' } : existing.respond(path, init),
    );
    expect(r2.out).toContain(`${A}: already sealed`);
  }, 15_000);

  it('account seal refuses a changed account key until --repin', async () => {
    const { respond } = await api();
    const pinned = { 'https://x.test': '0000 0000 0000 0000' };
    const r = await cli(['account', 'seal'], one, respond, { pins: pinned });
    await vi.waitFor(() => expect(r.err).toContain('account public key changed'), {
      timeout: 3000,
    });
    expect(r.err).toContain('--repin');
    expect(r.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
    const repinned = await cli(['account', 'seal', '--repin'], one, respond, { pins: pinned });
    expect(repinned.out).toContain(`${A}: sealed`);
    // The new pin went to the state file; config.json keeps only the stale legacy value.
    expect((await readSealState()).pins['https://x.test']).not.toBe('0000 0000 0000 0000');
    expect((await readConfig()).accountKeyPins?.['https://x.test']).toBe('0000 0000 0000 0000');
  }, 15_000);

  it('seals a named drive when the key cannot list drives', async () => {
    // A write-only agent key gets 403 on GET /drives; --drive must still seal through the
    // slot endpoint's own checks.
    const one = {
      keys: { [A]: KEY_A, [B]: KEY_B },
      origins: { [A]: 'https://x.test', [B]: 'https://x.test' },
    };
    const account = await accountKeyPair();
    const r = await cli(['account', 'seal', '--drive', B], one, (path) => {
      if (path === 'drives')
        // A 403 Response (not a thrown ApiError): cli.js's client builds the error itself.
        return new Response(
          JSON.stringify({ error: { code: 'permission_denied', message: 'Missing scope read.' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        );
      if (path === 'account-key') return { keyId: KEY_ID, publicKey: account.publicKey, format: 1 };
      return { status: 'created' };
    });
    expect(r.out).toContain(`${B}: sealed`);
    expect(r.out).not.toContain(`${A}:`);
    expect(r.paths.some((p) => p === `POST drives/${B}/account-key-slot`)).toBe(true);
  }, 15_000);

  it('seals via an env-bundle credential and enforces the pin without persisting secrets', async () => {
    // Credentials live in the env bundle; config.json must gain neither the drive key nor a pin.
    const bundle = buildBundle({
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: { [A]: KEY_A },
      driveKeyOrigins: { [A]: 'https://x.test' },
    });
    const account = await accountKeyPair();
    const shared = await mkdtemp(join(tmpdir(), 'agent-drive-cmd-'));
    const r = await cli(
      ['account', 'seal'],
      { keys: {}, origins: {} },
      (path) => {
        if (path === 'drives')
          return {
            items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }],
            nextCursor: null,
          };
        if (path === 'account-key')
          return { keyId: KEY_ID, publicKey: account.publicKey, format: 1 };
        return { status: 'created' };
      },
      { env: { AGENT_DRIVE_CREDENTIALS: bundle }, dir: shared },
    );
    expect(r.out).toContain(`${A}: sealed`);
    const saved = await readConfig();
    expect(saved.driveKeys ?? {}).toEqual({});
    expect(saved.accountKeyPins).toBeUndefined();
    // A rotated account key now trips the pin on the next run — the pin lives in the shared
    // directory's private state, which the env bundle could not bypass.
    const other = await accountKeyPair();
    const r2 = await cli(
      ['account', 'seal'],
      { keys: {}, origins: {} },
      (path) => {
        if (path === 'drives')
          return {
            items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }],
            nextCursor: null,
          };
        if (path === 'account-key') return { keyId: KEY_ID, publicKey: other.publicKey, format: 1 };
        return { status: 'created' };
      },
      { env: { AGENT_DRIVE_CREDENTIALS: bundle }, dir: shared },
    );
    expect(r2.err).toContain('--repin');
    expect(r2.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
    // The first pin still stands.
    expect((await readSealState()).pins['https://x.test']).toBe(
      accountKeyFingerprint(account.publicKey),
    );
  }, 15_000);

  it('keeps pins isolated per effective api origin', async () => {
    // AGENT_DRIVE_API_URL overrides the effective origin; the pin keys off that, not the saved
    // apiUrl. The saved driveKeyOrigins bind the key to the override origin so it is 'held'.
    const account = await accountKeyPair();
    const r = await cli(
      ['account', 'seal'],
      { keys: { [A]: KEY_A }, origins: { [A]: 'https://other.test' } },
      (path) => {
        if (path === 'drives')
          return {
            items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }],
            nextCursor: null,
          };
        if (path === 'account-key')
          return { keyId: KEY_ID, publicKey: account.publicKey, format: 1 };
        return { status: 'created' };
      },
      { env: { AGENT_DRIVE_API_URL: 'https://other.test/api' } },
    );
    expect(r.out).toContain(`${A}: sealed`);
    const state = await readSealState();
    expect(state.pins['https://other.test']).toBe(accountKeyFingerprint(account.publicKey));
    expect(state.pins['https://x.test']).toBeUndefined();
  }, 15_000);

  it('a hung seal never blocks the command and is cut by the deadline', async () => {
    const one = {
      keys: { [A]: KEY_A },
      origins: { [A]: 'https://x.test' },
    };
    const entry = {
      id: 'f1',
      version_id: 'v1',
      path: '/x.txt',
      ciphertext_size: 3,
      agent_id: 'ag',
      machine_id: 'm',
      user_id: 'u',
      tags: [],
      created_at: 't',
    };
    const r = await cli(['ls'], one, (path) => {
      if (path === 'account-key') return new Promise<never>(() => {}); // hangs
      if (path === `drives/${A}/list`) return { items: [entry], nextCursor: null };
      if (path === 'drives')
        return {
          items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }],
          nextCursor: null,
        };
      return { status: 'created' };
    });
    // The listing printed; the hung seal was aborted at the 5s deadline without a slot POST.
    expect(r.out).toContain('x.txt');
    expect(r.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
  }, 15_000);

  it('backup also schedules the seal after the command', async () => {
    const one = {
      keys: { [A]: KEY_A },
      origins: { [A]: 'https://x.test' },
    };
    const source = await mkdtemp(join(tmpdir(), 'agent-drive-backup-'));
    dirs.push(source);
    await writeFile(join(source, 'note.txt'), 'hi');
    const account = await accountKeyPair();
    // --dry-run keeps backupDirectory offline; the seal hook still runs against the stubbed API.
    const r = await cli(['backup', source, '--dry-run'], one, (path) => {
      if (path === 'account-key') return { keyId: KEY_ID, publicKey: account.publicKey, format: 1 };
      if (path === 'drives')
        return {
          items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }],
          nextCursor: null,
        };
      return { status: 'created' };
    });
    expect(r.out).toContain('backup uploaded=0 unchanged=0 failed=0');
    expect(r.paths.some((p) => p === `POST drives/${A}/account-key-slot`)).toBe(true);
  }, 15_000);
});

describe('heldSealTargets key resolution', () => {
  const configWith = (origins: Record<string, string>) => ({
    ...baseConfig,
    driveKeys: { [A]: KEY_A, [B]: KEY_B },
    driveKeyOrigins: origins,
  });

  it('only selects saved keys bound to the client apiOrigin', async () => {
    await dir();
    const targets = await heldSealTargets({
      config: configWith({ [A]: 'https://x.test', [B]: 'https://other.test' }),
      origin: 'https://x.test',
    });
    expect(targets.map((t) => t.driveId)).toEqual([A]);
  });

  it('resolves env-per-drive and AGENT_DRIVE_KEY/--key-file like commands do', async () => {
    const d = await dir();
    const envKey = generateDriveKey();
    const fileKey = generateDriveKey();
    vi.stubEnv(`AGENT_DRIVE_KEY_${B.replace(/-/g, '_').toUpperCase()}`, envKey);
    const keyFile = join(d, 'key.txt');
    await writeFile(keyFile, `${fileKey}\n`);
    // B has an env key although config holds one for a foreign origin; A resolves via key file
    // as the selected drive.
    const targets = await heldSealTargets({
      config: configWith({ [A]: 'https://other.test', [B]: 'https://other.test' }),
      origin: 'https://x.test',
      driveIds: [A, B],
      selectedDriveId: A,
      keyFile,
    });
    expect(targets).toEqual([
      { driveId: A, driveKey: fileKey, agentOnly: false },
      { driveId: B, driveKey: envKey, agentOnly: false },
    ]);
    // AGENT_DRIVE_KEY applies only to the selected drive, and env-per-drive beats it.
    const generalKey = generateDriveKey();
    vi.stubEnv('AGENT_DRIVE_KEY', generalKey);
    const second = await heldSealTargets({
      config: configWith({ [A]: 'https://other.test', [B]: 'https://other.test' }),
      origin: 'https://x.test',
      driveIds: [A, B],
      selectedDriveId: A,
    });
    expect(second).toEqual([
      { driveId: A, driveKey: generalKey, agentOnly: false },
      { driveId: B, driveKey: envKey, agentOnly: false },
    ]);
  });
});

describe('autoSealHeldKeys', () => {
  const config = () => ({
    ...baseConfig,
    driveKeys: { [A]: KEY_A, [B]: KEY_B },
    driveKeyOrigins: { [A]: 'https://x.test', [B]: 'https://x.test' },
  });

  it('paginates the drive listing fully', async () => {
    await dir();
    const account = await accountKeyPair();
    const pages = [
      { items: [{ id: A, name: 'a', agentOnly: false, created_at: 't' }], nextCursor: 'p2' },
      { items: [{ id: B, name: 'b', agentOnly: false, created_at: 't' }], nextCursor: null },
    ];
    const cursors: (string | undefined)[] = [];
    const { client, posts } = mockClient({ publicKey: account.publicKey });
    client.listDrives = vi.fn(async (_limit?: number, cursor?: string) => {
      cursors.push(cursor);
      return pages[cursor ? 1 : 0]!;
    }) as never;
    await autoSealHeldKeys({ client, config: config(), warn: () => {} });
    expect(cursors).toEqual([undefined, 'p2']);
    expect(posts.map((p) => p.driveId).sort()).toEqual([A, B].sort());
  });

  it('still seals held keys when the listing is denied (write-only key)', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client, posts } = mockClient({ publicKey: account.publicKey, list: 'deny' });
    await autoSealHeldKeys({ client, config: config(), warn: () => {} });
    expect(posts.map((p) => p.driveId).sort()).toEqual([A, B].sort());
  });

  it('stays silent once the deadline aborts the attempt', async () => {
    await dir();
    const account = await accountKeyPair();
    const { client } = mockClient({ publicKey: account.publicKey, list: 'deny' });
    client.accountKey = vi.fn(async () => {
      throw new AgentDriveApiError('internal_error', 0, 'aborted by deadline');
    }) as never;
    const deadline = AbortSignal.timeout(0);
    await new Promise((r) => setTimeout(r, 5));
    const warnings: string[] = [];
    await autoSealHeldKeys({ client, config: config(), deadline, warn: (l) => warnings.push(l) });
    expect(warnings).toEqual([]);
  });
});

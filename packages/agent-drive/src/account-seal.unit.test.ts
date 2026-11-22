import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriveClient } from './client.js';
import { generateDriveKey } from './crypto.js';
import { readConfig, writeConfig } from './config.js';
import { unsealDriveKey, type SealedDriveKey } from './seal.js';
import {
  accountKeyFingerprint,
  AccountKeyPinMismatch,
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
  statuses?: Record<string, 'created' | 'exists'>;
  failPost?: boolean;
}) {
  const posts: Post[] = [];
  const client = {
    accountKey: vi.fn(async () =>
      opts.publicKey ? { keyId: opts.keyId ?? KEY_ID, publicKey: opts.publicKey, format: 1 } : null,
    ),
    addAccountKeySlot: vi.fn(
      async (driveId: string, body: { keyId: string; sealed: SealedDriveKey }) => {
        if (opts.failPost) throw new Error('api down');
        posts.push({ driveId, ...body });
        return { status: opts.statuses?.[driveId] ?? ('created' as const) };
      },
    ),
  };
  return { client: client as unknown as AgentDriveClient, posts };
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
    // The pin lives in the config file; the next command sees it in its fresh snapshot.
    const config = await readConfig();
    expect(config.accountKeyPins?.['https://x.test']).toBe(
      accountKeyFingerprint(account.publicKey),
    );

    const other = await accountKeyPair();
    const swapped = mockClient({ publicKey: other.publicKey });
    await expect(
      sealDrivesToAccount({
        client: swapped.client,
        config,
        targets: [{ driveId: A, driveKey: KEY_A }],
        force: true,
      }),
    ).rejects.toThrow(AccountKeyPinMismatch);
    expect(swapped.posts).toHaveLength(0);

    // --repin accepts the new key and updates the pin.
    await sealDrivesToAccount({
      client: swapped.client,
      config,
      targets: [{ driveId: A, driveKey: KEY_A }],
      force: true,
      repin: true,
    });
    expect(swapped.posts).toHaveLength(1);
    expect((await readConfig()).accountKeyPins?.['https://x.test']).toBe(
      accountKeyFingerprint(other.publicKey),
    );
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
  extra?: { pins?: Record<string, string> },
) {
  const d = await mkdtemp(join(tmpdir(), 'agent-drive-cmd-'));
  dirs.push(d);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(d, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
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
      const body = respond(path, init);
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
  });

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
  });

  it('drive create warns once when the account has no account key', async () => {
    const { respond } = await api({ noAccountKey: true });
    const r = await cli(['drive', 'create', '--name', 'fresh'], { keys: {}, origins: {} }, respond);
    expect(r.out).toContain(B);
    await vi.waitFor(() => expect(r.err).toContain('Your account has no account key yet'), {
      timeout: 3000,
    });
    expect(r.paths.some((p) => p.includes('account-key-slot'))).toBe(false);
  });

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
  });

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
  });

  it('account seal reports no account key and already sealed', async () => {
    const none = await api({ noAccountKey: true });
    const r = await cli(['account', 'seal'], one, none.respond);
    expect(r.out).toContain(`${A}: no account key`);
    const existing = await api();
    const r2 = await cli(['account', 'seal', '--drive', A], one, (path, init) =>
      path.endsWith('/account-key-slot') ? { status: 'exists' } : existing.respond(path, init),
    );
    expect(r2.out).toContain(`${A}: already sealed`);
  });

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
    const saved = await readConfig();
    expect(saved.accountKeyPins?.['https://x.test']).not.toBe('0000 0000 0000 0000');
  });
});

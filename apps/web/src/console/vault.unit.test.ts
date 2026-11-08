import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encryptFile, generateDriveKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { createAccountKey, sealToAccount, type AccountKeyRecord } from './account-key';
import { Vault, vaultRequest, type LockReason } from './vault';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const DRIVE = '33333333-3333-4333-8333-333333333333';
const PASSPHRASE = 'K7M2Q9X4B8T3V6N5R1D0';

let record: AccountKeyRecord;
const driveKey = generateDriveKey();
const otherKey = generateDriveKey();
let envelope: string;
let otherEnvelope: string;
let goodSlot: unknown;
let badSlot: unknown;

beforeAll(async () => {
  record = (await createAccountKey(ACCOUNT, PASSPHRASE)).record;
  envelope = (await encryptFile(new Uint8Array([1, 2, 3]), driveKey)).wrappedKey;
  otherEnvelope = (await encryptFile(new Uint8Array([1, 2, 3]), otherKey)).wrappedKey;
  const slot = async (key: string) => ({
    driveId: DRIVE,
    keyId: record.id,
    format: 1,
    revision: 4,
    sealed: await sealToAccount(record.publicKey, record.id, DRIVE, key),
  });
  goodSlot = await slot(driveKey);
  badSlot = await slot(otherKey);
}, 30_000);

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Routes = Record<string, (method: string, body: unknown) => unknown>;
function makeVault(
  routes: Routes = {},
  envelopeOf: () => Promise<string> = async () => envelope,
  anyPath: () => Promise<string | undefined> = async () => '/a.txt',
) {
  const locked: LockReason[] = [];
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request = async (path: string, method = 'GET', body?: unknown) => {
    calls.push({ path, method, body });
    const key = Object.keys(routes).find((route) => path.startsWith(route));
    if (!key) throw new Error(`unexpected ${method} ${path}`);
    return routes[key]!(method, body);
  };
  const envelopeCalls = vi.fn(envelopeOf);
  const vault = new Vault({
    request,
    strict: request,
    envelope: envelopeCalls,
    anyPath,
    onLocked: (reason) => locked.push(reason),
  });
  return { vault, locked, calls, envelopeCalls };
}

const base = (slot: unknown = goodSlot): Routes => ({
  whoami: () => ({ accountId: ACCOUNT }),
  'account-key/slots': () => ({ items: [slot], nextCursor: null }),
  'account-key': () => ({ accountKey: { ...record, createdAt: 'x', updatedAt: 'x' } }),
});

describe('Vault', () => {
  it('unlocks with a typed generated passphrase and opens a verified drive key', async () => {
    const { vault } = makeVault(base());
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(vault.fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/u);
    const typed = 'k7m2-q9x4 b8t3-v6n5 r1d0';
    expect(await vault.unlock(typed)).toBe(true);
    expect(vault.status).toBe('unlocked');
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
  }, 30_000);

  it('rejects a wrong passphrase without unlocking', async () => {
    const { vault } = makeVault(base());
    await vault.load();
    await expect(vault.unlock('not the passphrase')).rejects.toThrow(
      'That passphrase is not correct.',
    );
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('installs nothing when Lock happens while the passphrase is being checked', async () => {
    const { vault } = makeVault(base());
    await vault.load();
    const pending = vault.unlock(PASSPHRASE);
    vault.lock('manual');
    expect(await pending).toBe(false);
    expect(vault.status).toBe('locked');
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'none' });
  }, 30_000);

  it('installs nothing when the slot fetch resolves after Lock', async () => {
    const gate = deferred<unknown>();
    const { vault } = makeVault({ ...base(), 'account-key/slots': () => gate.promise });
    await vault.load();
    const pending = vault.unlock(PASSPHRASE);
    await vi.waitFor(() => expect(vault.fetchingSlots).toBe(true), { timeout: 10_000 });
    vault.lock('manual');
    gate.resolve({ items: [goodSlot], nextCursor: null });
    expect(await pending).toBe(false);
    expect(vault.status).toBe('locked');
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);

  it('returns stale, not a key, when Lock happens during verification', async () => {
    const gate = deferred<string>();
    const { vault, envelopeCalls } = makeVault(base(), () => gate.promise);
    await vault.load();
    await vault.unlock(PASSPHRASE);
    const pending = vault.keyFor(DRIVE, '/a.txt');
    // Lock only after the envelope request has been issued.
    await vi.waitFor(() => expect(envelopeCalls).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    vault.lock('idle');
    gate.resolve(envelope);
    expect(await pending).toEqual({ status: 'stale' });
  }, 30_000);

  it('rejects a slot that does not open the file, and verifies again next time', async () => {
    const { vault, envelopeCalls } = makeVault(base(badSlot));
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'mismatch' });
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'mismatch' });
    expect(envelopeCalls).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('stores a new drive key as a create, and replaces a failing slot only with a verified key', async () => {
    const posts: unknown[] = [];
    const routes = {
      ...base(badSlot),
      [`drives/${DRIVE}/account-key`]: (_m: string, body: unknown) => {
        posts.push(body);
        return { revision: 9 };
      },
    };
    const { vault } = makeVault(routes);
    await vault.load();
    await vault.unlock(PASSPHRASE);
    // Unverifiable key while a slot exists: no write.
    const empty = makeVault(routes, undefined, async () => undefined);
    await empty.vault.load();
    await empty.vault.unlock(PASSPHRASE);
    expect(await empty.vault.addKey(DRIVE, driveKey)).toBe('skipped');
    expect(posts).toHaveLength(0);
    // Verified key: replaces revision 4.
    expect(await vault.addKey(DRIVE, driveKey, { path: '/a.txt' })).toBe('added');
    expect(posts[0]).toMatchObject({ keyId: record.id, expectedRevision: 4 });
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
    // A key that fails its own file is never stored.
    const wrongFile = makeVault(routes, async () => otherEnvelope);
    await wrongFile.vault.load();
    await wrongFile.vault.unlock(PASSPHRASE);
    expect(await wrongFile.vault.addKey(DRIVE, driveKey, { path: '/a.txt' })).toBe('skipped');
  }, 60_000);

  it('locks when the server says the passphrase changed elsewhere', async () => {
    const routes = {
      ...base(),
      'drives/': () => {
        throw Object.assign(new Error('Your passphrase was changed elsewhere. Reload the page.'), {
          status: 409,
        });
      },
    };
    const { vault, locked } = makeVault(routes);
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(
      await vault.addKey('44444444-4444-4444-8444-444444444444', driveKey, { trusted: true }),
    ).toBe('stale');
    expect(locked).toEqual(['stale']);
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('refuses an older record than one this tab already used', async () => {
    let generation = 2;
    const routes = {
      ...base(),
      'account-key': () => ({ accountKey: { ...record, wrapGeneration: generation } }),
    };
    const { vault } = makeVault(routes);
    await vault.load();
    generation = 1;
    await expect(vault.unlock(PASSPHRASE)).rejects.toThrow('looks older');
  }, 30_000);
});

describe('Vault setup', () => {
  const noVault = (extra: Routes = {}) => {
    const posts: string[] = [];
    const routes: Routes = {
      whoami: () => ({ accountId: ACCOUNT }),
      'account-key': () => ({ accountKey: null }),
      'drives/': (_m, body) => {
        posts.push(JSON.stringify(body));
        return { revision: 1 };
      },
      ...extra,
    };
    return { posts, ...makeVault(routes) };
  };
  const keys = { [DRIVE]: { key: driveKey, trusted: false } };

  it('never seals a key that does not open a real file', async () => {
    const wrong = makeVault(
      {
        whoami: () => ({ accountId: ACCOUNT }),
        'account-key': () => ({ accountKey: null }),
        'drives/': () => {
          throw new Error('must not write');
        },
      },
      async () => otherEnvelope,
    );
    await wrong.vault.load();
    const result = await wrong.vault.setup(PASSPHRASE, keys);
    expect(result).toEqual({ added: 0, total: 1 });
    expect(
      wrong.calls.some((call) => call.path.startsWith('drives/') && call.method === 'POST'),
    ).toBe(false);
  }, 30_000);

  it('seals a checked key and a trusted one', async () => {
    const { vault, posts } = noVault();
    await vault.load();
    const result = await vault.setup(PASSPHRASE, {
      [DRIVE]: { key: driveKey, trusted: false },
      '44444444-4444-4444-8444-444444444444': { key: otherKey, trusted: true },
    });
    expect(result).toEqual({ added: 2, total: 2 });
    expect(posts).toHaveLength(2);
  }, 30_000);

  it('does nothing when Lock happens during the fingerprint', async () => {
    const { vault, posts } = noVault();
    await vault.load();
    const gate = deferred<ArrayBuffer>();
    const digest = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockImplementationOnce(() => gate.promise);
    const pending = vault.setup(PASSPHRASE, keys);
    await vi.waitFor(() => expect(digest).toHaveBeenCalled(), { timeout: 10_000 });
    vault.lock('manual');
    gate.resolve(new ArrayBuffer(32));
    expect(await pending).toBeNull();
    expect(vault.status).toBe('none');
    expect(posts).toHaveLength(0);
  }, 30_000);

  it('is cancelled by a closed dialog while the account key is being saved', async () => {
    const gate = deferred<unknown>();
    // Delay only the create (strict calls use the same request stub).
    const delayed = makeVault({
      whoami: () => ({ accountId: ACCOUNT }),
      'account-key': (method) => (method === 'POST' ? gate.promise : { accountKey: null }),
      'drives/': () => ({ revision: 1 }),
    });
    await delayed.vault.load();
    const pending = delayed.vault.setup(PASSPHRASE, keys);
    await vi.waitFor(
      () => expect(delayed.calls.some((call) => call.method === 'POST')).toBe(true),
      { timeout: 10_000 },
    );
    delayed.vault.cancelUnlock();
    gate.resolve({});
    expect(await pending).toBeNull();
    expect(delayed.vault.status).toBe('none');
    expect(delayed.vault.slotCount).toBe(0);
    expect(delayed.calls.filter((call) => call.path.startsWith('drives/'))).toHaveLength(0);
  }, 30_000);
});

describe('vaultRequest', () => {
  it('passes Clerk reverification responses through unchanged', async () => {
    vi.stubGlobal('fetch', async () => reverificationErrorResponse('strict'));
    const body = await vaultRequest('account-key', 'POST', { a: 1 });
    expect(body).toEqual(await reverificationErrorResponse('strict').json());
    expect(JSON.stringify(body)).toContain('reverification');
    vi.unstubAllGlobals();
  });

  it('throws other failures with their status', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'Nope.' } }, { status: 409 }),
    );
    await expect(vaultRequest('account-key', 'POST', {})).rejects.toMatchObject({
      message: 'Nope.',
      status: 409,
    });
    vi.unstubAllGlobals();
  });
});

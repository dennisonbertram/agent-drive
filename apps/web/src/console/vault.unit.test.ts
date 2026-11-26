import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The WebAuthn ceremony module is a browser surface; the vault's own guards are tested here
// with the ceremony replaced by controllable fakes.
vi.mock('./passkey', () => ({
  enrollAccountPasskey: vi.fn(),
  unlockWithAccountPasskey: vi.fn(),
}));

import {
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import {
  createTraceInbox,
  sealFileKeyToInbox,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import {
  createAccountKey,
  sealToAccount,
  unlockAccountKey,
  type AccountKeyRecord,
} from './account-key';
import type { PersistedStore } from './persisted-key';
import { sealDriveKey } from '../device/seal';
import { enrollAccountPasskey, unlockWithAccountPasskey } from './passkey';
import { BROWSER_KEY_DELETE_FAILED, Vault, vaultRequest, type LockReason } from './vault';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const DRIVE = '33333333-3333-4333-8333-333333333333';
const PASSPHRASE = 'K7M2Q9X4B8T3V6N5R1D0';

let record: AccountKeyRecord;
const driveKey = generateDriveKey();
const otherKey = generateDriveKey();
let envelope: string;
let otherEnvelope: string;
let goodSlot: unknown;
const OTHER_DRIVE = '44444444-4444-4444-8444-444444444444';
let inboxRecord: TraceInboxRecord;
let otherDriveRecord: TraceInboxRecord;
let v2Envelope: string;
let badSlot: unknown;

beforeAll(async () => {
  record = (await createAccountKey(ACCOUNT, PASSPHRASE)).record;
  envelope = (await encryptFile(new Uint8Array([1, 2, 3]), driveKey)).wrappedKey;
  otherEnvelope = (await encryptFile(new Uint8Array([1, 2, 3]), otherKey)).wrappedKey;
  inboxRecord = await createTraceInbox(DRIVE, driveKey);
  otherDriveRecord = await createTraceInbox(OTHER_DRIVE, driveKey);
  v2Envelope = await sealFileKeyToInbox(await unwrapFileKey(envelope, driveKey), {
    driveId: DRIVE,
    ...inboxRecord,
  });
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
  inbox: () => Promise<TraceInboxRecord | null> = async () => null,
  persisted?: PersistedStore,
  owner?: () => string | null,
  extra?: {
    peers?: { notify: () => void; subscribe: (onLock: () => void) => void };
    onNotice?: (line: string) => void;
  },
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
    inbox,
    persisted,
    owner,
    onLocked: (reason) => locked.push(reason),
    peers: extra?.peers,
    onNotice: extra?.onNotice,
  });
  return { vault, locked, calls, envelopeCalls };
}

const base = (slot: unknown = goodSlot): Routes => ({
  whoami: () => ({ accountId: ACCOUNT }),
  'account-key/slots': () => ({ items: [slot], nextCursor: null }),
  'account-key': () => ({ accountKey: { ...record, createdAt: 'x', updatedAt: 'x' } }),
});

const store = (over: Partial<PersistedStore> = {}): PersistedStore => ({
  read: async () => null,
  readLockGeneration: async () => 0,
  write: async () => true,
  clear: async () => {},
  ...over,
});

describe('Vault', () => {
  it('restores the previous status when a pending load is cancelled', async () => {
    const pending = deferred<unknown>();
    let reads = 0;
    const { vault } = makeVault({
      ...base(),
      whoami: () => {
        if (++reads === 1) throw new Error('offline');
        return reads === 2 ? pending.promise : { accountId: ACCOUNT };
      },
    });
    await vault.load();
    expect(vault.status).toBe('error');
    const retry = vault.load();
    expect(vault.status).toBe('loading');
    vault.cancelUnlock();
    expect(vault.status).toBe('error');
    expect(vault.loadError).toBe('offline');
    pending.resolve({ accountId: ACCOUNT });
    await retry;
    expect(vault.status).toBe('error');
    await vault.load();
    expect(vault.status).toBe('locked');
  });

  it('leaves a recoverable status when the first load is cancelled', async () => {
    const pending = deferred<unknown>();
    const { vault } = makeVault({ ...base(), whoami: () => pending.promise });
    const first = vault.load();
    vault.cancelUnlock();
    expect(vault.status).toBe('error');
    expect(vault.loadError).not.toBe('');
    pending.resolve({ accountId: ACCOUNT });
    await first;
    await vault.load();
    expect(vault.status).not.toBe('error');
  });

  it('does not clobber a load started after the cancel', async () => {
    const pending = deferred<unknown>();
    let reads = 0;
    const { vault } = makeVault({
      ...base(),
      whoami: () => (++reads === 1 ? pending.promise : { accountId: ACCOUNT }),
    });
    const first = vault.load();
    vault.cancelUnlock();
    await vault.load();
    expect(vault.status).toBe('locked');
    pending.resolve({ accountId: ACCOUNT });
    await first;
    expect(vault.status).toBe('locked');
  });

  it('discards old account reads after clear and discovers the new account', async () => {
    const pendingRecord = deferred<unknown>();
    let account = ACCOUNT;
    let reads = 0;
    const { vault, calls } = makeVault({
      ...base(),
      whoami: () => ({ accountId: account }),
      'account-key': () => (++reads === 1 ? pendingRecord.promise : { accountKey: null }),
    });
    const oldLoad = vault.load();
    vault.clear();
    account = OTHER_DRIVE;
    await vault.load();
    pendingRecord.resolve({ accountKey: record });
    await oldLoad;
    expect(vault.status).toBe('none');
    expect(vault.record).toBeNull();
    expect(vault.fingerprint).toBe('');
    expect(calls.filter(({ path }) => path === 'whoami')).toHaveLength(2);
  });

  it('only publishes the latest record read within a session', async () => {
    const pendingRecord = deferred<unknown>();
    let reads = 0;
    const { vault } = makeVault({
      ...base(),
      'account-key': () => (++reads === 1 ? pendingRecord.promise : { accountKey: null }),
    });
    const oldLoad = vault.load();
    await vault.load();
    pendingRecord.resolve({ accountKey: record });
    await oldLoad;
    expect(vault.status).toBe('none');
    expect(vault.record).toBeNull();
  });

  it('locks and discards slots when a refresh discovers a removed account key', async () => {
    let removed = false;
    const { vault, locked } = makeVault({
      ...base(),
      'account-key': () => ({ accountKey: removed ? null : record }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    removed = true;
    await vault.load();
    expect(vault.status).toBe('none');
    expect(vault.slotCount).toBe(0);
    expect(await vault.slotKey(DRIVE)).toBeNull();
    expect(locked).toEqual(['stale']);
  }, 30_000);

  it('invalidates an unlock as soon as reset starts, not when deletion finishes', async () => {
    const slots = deferred<unknown>();
    const deletion = deferred<unknown>();
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => slots.promise,
      'account-key': (method) => (method === 'DELETE' ? deletion.promise : { accountKey: record }),
    });
    await vault.load();
    const unlocking = vault.unlock(PASSPHRASE);
    await vi.waitFor(() => expect(vault.fetchingSlots).toBe(true), { timeout: 10_000 });
    const resetting = vault.reset();
    slots.resolve({ items: [goodSlot], nextCursor: null });
    expect(await unlocking).toBe(false);
    expect(vault.status).toBe('locked');
    expect(vault.fetchingSlots).toBe(false);
    deletion.resolve({});
    await resetting;
    expect(vault.status).toBe('none');
    expect(await vault.slotKey(DRIVE)).toBeNull();
  }, 30_000);

  it('a new record load supersedes an in-flight unlock', async () => {
    const slots = deferred<unknown>();
    let removed = false;
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => slots.promise,
      'account-key': () => ({ accountKey: removed ? null : record }),
    });
    await vault.load();
    const unlocking = vault.unlock(PASSPHRASE);
    await vi.waitFor(() => expect(vault.fetchingSlots).toBe(true), { timeout: 10_000 });
    removed = true;
    await vault.load();
    slots.resolve({ items: [goodSlot], nextCursor: null });
    expect(await unlocking).toBe(false);
    expect(vault.status).toBe('none');
    expect(vault.slotCount).toBe(0);
    expect(vault.fetchingSlots).toBe(false);
  }, 30_000);

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

  it('retries a failed status load and clears the stale error when locked', async () => {
    let fail = true;
    const routes = {
      ...base(),
      'account-key': () => {
        if (fail) throw new Error('temporary status failure');
        return { accountKey: { ...record, createdAt: 'x', updatedAt: 'x' } };
      },
    };
    const { vault } = makeVault(routes);
    await vault.load();
    expect(vault.status).toBe('error');
    expect(vault.loadError).toBe('temporary status failure');
    fail = false;
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(vault.loadError).toBe('');
  }, 30_000);

  it('retries a failed status load and clears the stale error when no vault exists', async () => {
    let fail = true;
    const routes = {
      ...base(),
      'account-key': () => {
        if (fail) throw new Error('temporary status failure');
        return { accountKey: null };
      },
    };
    const { vault } = makeVault(routes);
    await vault.load();
    expect(vault.status).toBe('error');
    fail = false;
    await vault.load();
    expect(vault.status).toBe('none');
    expect(vault.loadError).toBe('');
  }, 30_000);

  it('does not commit a delayed status record after Lock invalidates its epoch', async () => {
    const gate = deferred<unknown>();
    const { vault, calls } = makeVault({ ...base(), 'account-key': () => gate.promise });
    const pending = vault.load();
    await vi.waitFor(() => expect(calls.some((call) => call.path === 'account-key')).toBe(true), {
      timeout: 10_000,
    });
    vault.lock('manual');
    gate.resolve({ accountKey: { ...record, createdAt: 'x', updatedAt: 'x' } });
    await pending;
    expect(vault.record).toBeNull();
    expect(vault.fingerprint).toBe('');
  }, 30_000);

  it('refreshes the account identity after clear instead of reusing the previous account', async () => {
    const otherRecord = (await createAccountKey(OTHER_ACCOUNT, PASSPHRASE)).record;
    let accountId = ACCOUNT;
    let currentRecord = record;
    const whoami = vi.fn(() => ({ accountId }));
    const { vault } = makeVault({
      ...base(),
      whoami,
      'account-key': () => ({
        accountKey: { ...currentRecord, createdAt: 'x', updatedAt: 'x' },
      }),
    });
    await vault.load();
    expect(vault.record?.accountId).toBe(ACCOUNT);
    accountId = OTHER_ACCOUNT;
    currentRecord = otherRecord;
    vault.clear();
    await vault.load();
    expect(whoami).toHaveBeenCalledTimes(2);
    expect(vault.record?.accountId).toBe(OTHER_ACCOUNT);
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

  it('replaces a slot the account key cannot open at all (squatted or corrupt)', async () => {
    // A squatter's slot is well-formed but sealed to a foreign key: `current` unseals to
    // null and the verified recovery key still replaces it at its revision.
    const foreign = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const foreignPublic = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.exportKey('raw', foreign.publicKey)),
      ),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    const corruptSlot = {
      driveId: DRIVE,
      keyId: record.id,
      format: 1,
      revision: 4,
      sealed: await sealDriveKey(foreignPublic, DRIVE, driveKey, {
        salt: 'agent-drive-account-v1',
        label: `${record.id}:${DRIVE}`,
      }),
    };
    const posts: unknown[] = [];
    const routes = {
      ...base(corruptSlot),
      [`drives/${DRIVE}/account-key`]: (_m: string, body: unknown) => {
        posts.push(body);
        return { revision: 9 };
      },
    };
    const { vault } = makeVault(routes);
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(await vault.addKey(DRIVE, driveKey, { path: '/a.txt' })).toBe('added');
    expect(posts[0]).toMatchObject({ keyId: record.id, expectedRevision: 4 });
  }, 30_000);

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

describe('Vault ensureSlot', () => {
  // A tab that unlocked before an agent sealed a drive has no cached slot: the scoped read
  // asks for just that drive, never a retry or a poll of the whole list.
  it('fetches one filtered slot for a drive enrolled after unlock, then opens it', async () => {
    let enrolled = false;
    const { vault, calls } = makeVault({
      ...base(),
      'account-key/slots': () => ({ items: enrolled ? [goodSlot] : [], nextCursor: null }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    enrolled = true;
    expect(await vault.ensureSlot(DRIVE)).toBe(true);
    expect(vault.hasSlot(DRIVE)).toBe(true);
    const scoped = calls.filter(({ path }) => path.startsWith('account-key/slots?driveId='));
    expect(scoped).toEqual([
      { path: `account-key/slots?driveId=${DRIVE}&limit=1`, method: 'GET', body: undefined },
    ]);
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
  }, 30_000);

  it('serves a known slot from cache without another request', async () => {
    const { vault, calls } = makeVault(base());
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(true);
    const seen = calls.length;
    expect(await vault.ensureSlot(DRIVE)).toBe(true);
    expect(calls).toHaveLength(seen);
  }, 30_000);

  it('returns false on a confirmed miss and does not cache it', async () => {
    const { vault, calls } = makeVault({
      ...base(),
      'account-key/slots': () => ({ items: [], nextCursor: null }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(await vault.ensureSlot(DRIVE)).toBe(false);
    // A miss is not cached: a later seal is still discovered by asking again.
    expect(await vault.ensureSlot(DRIVE)).toBe(false);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    expect(calls.filter(({ path }) => path.includes('driveId='))).toHaveLength(2);
  }, 30_000);

  it('throws when the slot read fails instead of reporting a miss', async () => {
    let broken = false;
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => {
        if (broken) throw new Error('offline');
        return { items: [], nextCursor: null };
      },
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    broken = true;
    await expect(vault.ensureSlot(DRIVE)).rejects.toThrow('Retry');
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);

  it('answers false without a request while locked or without a record', async () => {
    const { vault, calls } = makeVault(base());
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(await vault.ensureSlot(DRIVE)).toBe(false);
    expect(calls.some(({ path }) => path.includes('slots'))).toBe(false);
    await vault.unlock(PASSPHRASE);
    vault.lock('manual');
    const seen = calls.length;
    expect(await vault.ensureSlot(DRIVE)).toBe(false);
    expect(calls).toHaveLength(seen);
    const empty = makeVault({ ...base(), 'account-key': () => ({ accountKey: null }) });
    await empty.vault.load();
    expect(await empty.vault.ensureSlot(DRIVE)).toBe(false);
    expect(empty.calls.some(({ path }) => path.includes('slots'))).toBe(false);
  }, 30_000);

  it('discards a slot read that resolves after Lock', async () => {
    const gate = deferred<unknown>();
    const routes: Routes = { ...base() };
    const { vault, calls } = makeVault(routes);
    routes['account-key/slots'] = () =>
      calls.at(-1)!.path.includes('driveId=') ? gate.promise : { items: [], nextCursor: null };
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    const pending = vault.ensureSlot(DRIVE);
    await vi.waitFor(() => expect(calls.some(({ path }) => path.includes('driveId='))).toBe(true), {
      timeout: 10_000,
    });
    vault.lock('manual');
    gate.resolve({ items: [goodSlot], nextCursor: null });
    expect(await pending).toBe(false);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('never writes into the slot map a newer unlock installed', async () => {
    const gate = deferred<unknown>();
    const routes: Routes = { ...base() };
    const { vault, calls } = makeVault(routes);
    routes['account-key/slots'] = () =>
      calls.at(-1)!.path.includes('driveId=') ? gate.promise : { items: [], nextCursor: null };
    await vault.load();
    await vault.unlock(PASSPHRASE);
    const pending = vault.ensureSlot(DRIVE);
    await vi.waitFor(() => expect(calls.some(({ path }) => path.includes('driveId='))).toBe(true), {
      timeout: 10_000,
    });
    const again = vault.unlock(PASSPHRASE);
    gate.resolve({ items: [goodSlot], nextCursor: null });
    expect(await again).toBe(true);
    expect(await pending).toBe(false);
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);

  it('coalesces two refreshes of the same drive into a single read', async () => {
    const gate = deferred<unknown>();
    const routes: Routes = { ...base() };
    const { vault, calls } = makeVault(routes);
    routes['account-key/slots'] = () =>
      calls.at(-1)!.path.includes('driveId=') ? gate.promise : { items: [], nextCursor: null };
    await vault.load();
    await vault.unlock(PASSPHRASE);
    const first = vault.ensureSlot(DRIVE);
    const second = vault.ensureSlot(DRIVE);
    gate.resolve({ items: [goodSlot], nextCursor: null });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(calls.filter(({ path }) => path.includes('driveId='))).toHaveLength(1);
  }, 30_000);

  it('refuses a slot sealed under another account key', async () => {
    const foreign = {
      ...(goodSlot as Record<string, unknown>),
      keyId: '55555555-5555-4555-8555-555555555555',
    };
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => ({ items: [foreign], nextCursor: null }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    expect(await vault.ensureSlot(DRIVE)).toBe(false);
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);
});

describe('browser-held key', () => {
  it('reports unlocked only after the persisted write has resolved', async () => {
    const write = deferred<void>();
    const writes: string[] = [];
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          await write.promise;
          return true;
        },
      }),
    );
    await vault.load();
    const unlocking = vault.unlock(PASSPHRASE, true);
    await vi.waitFor(() => expect(writes).toEqual([record.id]), { timeout: 10_000 });
    expect(vault.status).not.toBe('unlocked');
    write.resolve();
    expect(await unlocking).toBe(true);
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('clears the stored key when Keep unlocked is off, before reporting unlocked', async () => {
    const clear = deferred<void>();
    let cleared = 0;
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        clear: async () => {
          cleared += 1;
          await clear.promise;
        },
      }),
    );
    await vault.load();
    const unlocking = vault.unlock(PASSPHRASE, false);
    await vi.waitFor(() => expect(cleared).toBe(1), { timeout: 10_000 });
    expect(vault.status).not.toBe('unlocked');
    clear.resolve();
    expect(await unlocking).toBe(true);
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('drops a stored key owned by another user instead of installing it', async () => {
    let cleared = 0;
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        read: async () => ({
          keyId: record.id,
          owner: 'user_b_previous',
          key: {} as CryptoKey,
        }),
        clear: async () => {
          cleared += 1;
        },
      }),
      () => 'user_a_current',
    );
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(cleared).toBe(1);
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);

  it('restores a stored key owned by the signed-in user without a passphrase', async () => {
    const privateKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({ read: async () => ({ keyId: record.id, owner: 'user_a_current', key: privateKey }) }),
      () => 'user_a_current',
    );
    await vault.load();
    expect(vault.status).toBe('unlocked');
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
  }, 30_000);

  it('does not write the browser key when unlock is cancelled during the slot fetch', async () => {
    const gate = deferred<unknown>();
    const writes: string[] = [];
    const { vault } = makeVault(
      { ...base(), 'account-key/slots': () => gate.promise },
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          return true;
        },
      }),
    );
    await vault.load();
    const pending = vault.unlock(PASSPHRASE, true);
    await vi.waitFor(() => expect(vault.fetchingSlots).toBe(true), { timeout: 10_000 });
    vault.cancelUnlock();
    gate.resolve({ items: [goodSlot], nextCursor: null });
    expect(await pending).toBe(false);
    expect(writes).toEqual([]);
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('surfaces a failed delete from Lock this browser and stays unlocked', async () => {
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        clear: async () => {
          throw new Error('IDB unavailable');
        },
      }),
    );
    await vault.load();
    // persist=true: the write path degrades softly, so the vault still unlocks.
    await vault.unlock(PASSPHRASE, true);
    await expect(vault.lockBrowser()).rejects.toThrow('IDB unavailable');
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('a committed browser write is deleted when the unlock is cancelled after it', async () => {
    const write = deferred<void>();
    const writes: string[] = [];
    const clears: unknown[] = [];
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          await write.promise;
          return true;
        },
        clear: async (match) => {
          clears.push(match ?? null);
        },
      }),
    );
    await vault.load();
    const pending = vault.unlock(PASSPHRASE, true);
    // The write has started; release it, then cancel before the vault's continuation runs.
    await vi.waitFor(() => expect(writes).toEqual([record.id]), { timeout: 10_000 });
    write.resolve();
    vault.cancelUnlock();
    expect(await pending).toBe(false);
    // The committed write is removed — by this unlock's own {keyId, startedAt} match.
    expect(clears).toEqual([{ keyId: record.id, startedAt: expect.any(Number) }]);
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('unchecking Keep this browser unlocked surfaces a failed delete', async () => {
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        clear: async () => {
          throw new Error('IDB unavailable');
        },
      }),
    );
    await vault.load();
    await expect(vault.unlock(PASSPHRASE, false)).rejects.toThrow('IDB unavailable');
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('setup deletes a committed browser write when cancelled after it', async () => {
    const write = deferred<void>();
    const writes: string[] = [];
    const clears: unknown[] = [];
    const { vault } = makeVault(
      {
        whoami: () => ({ accountId: ACCOUNT }),
        'account-key': () => ({ accountKey: null }),
        'drives/': () => ({ revision: 1 }),
      },
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          await write.promise;
          return true;
        },
        clear: async (match) => {
          clears.push(match ?? null);
        },
      }),
    );
    await vault.load();
    const pending = vault.setup(PASSPHRASE, {});
    await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 10_000 });
    write.resolve();
    vault.cancelUnlock();
    expect(await pending).toBeNull();
    expect(clears).toEqual([{ keyId: expect.any(String), startedAt: expect.any(Number) }]);
    expect(vault.status).toBe('none');
  }, 30_000);

  it('repairs a slot it cannot open at the row revision the server has', async () => {
    // A slot row this build cannot parse keeps its revision, so the repair write replaces it
    // (expectedRevision) instead of inserting a second row that can never win.
    const unopenable = {
      driveId: DRIVE,
      keyId: record.id,
      format: 1,
      revision: 7,
      sealed: 'not-a-sealed-payload',
    };
    const posts: unknown[] = [];
    const routes = {
      ...base(unopenable),
      [`drives/${DRIVE}/account-key`]: (_m: string, body: unknown) => {
        posts.push(body);
        return { revision: 8 };
      },
    };
    const { vault } = makeVault(routes);
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(false);
    expect(await vault.addKey(DRIVE, driveKey, { path: '/a.txt' })).toBe('added');
    expect(posts[0]).toMatchObject({ keyId: record.id, expectedRevision: 7 });
  }, 30_000);

  it('setup commits the browser key before reporting unlocked', async () => {
    const write = deferred<void>();
    const writes: string[] = [];
    const { vault } = makeVault(
      {
        whoami: () => ({ accountId: ACCOUNT }),
        'account-key': () => ({ accountKey: null }),
        'drives/': () => ({ revision: 1 }),
      },
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          await write.promise;
          return true;
        },
      }),
    );
    await vault.load();
    const setting = vault.setup(PASSPHRASE, {});
    await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 10_000 });
    expect(vault.status).not.toBe('unlocked');
    write.resolve();
    expect(await setting).toEqual({ added: 0, total: 0 });
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('restores the stored non-extractable key and it still satisfies deriveBits', async () => {
    const storedKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    expect(storedKey.extractable).toBe(false);
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({ read: async () => ({ keyId: record.id, key: storedKey }) }),
    );
    await vault.load();
    expect(vault.status).toBe('unlocked');
    // keyFor unseals the slot with ECDH deriveBits on the restored key.
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
  }, 30_000);

  it('ignores a stored key that belongs to another account key', async () => {
    const storedKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        read: async () => ({
          keyId: '55555555-5555-4555-8555-555555555555',
          key: storedKey,
        }),
      }),
    );
    await vault.load();
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('writes under the lock generation snapshot taken when the unlock started', async () => {
    const writes: { generation: number; startedAt: number | undefined }[] = [];
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        readLockGeneration: async () => 7,
        write: async (_keyId, _key, _owner, generation, startedAt) => {
          writes.push({ generation, startedAt });
          return true;
        },
      }),
    );
    await vault.load();
    expect(await vault.unlock(PASSPHRASE, true)).toBe(true);
    // The write carries the pre-unlock counter so a cross-tab lock can refuse it.
    expect(writes).toEqual([{ generation: 7, startedAt: expect.any(Number) }]);
  }, 30_000);

  it('drops its in-memory key when another tab locks the browser', async () => {
    let peerLock: (() => void) | undefined;
    const { vault, locked } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        peers: {
          notify: () => {},
          subscribe: (onLock) => {
            peerLock = onLock;
          },
        },
      },
    );
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.status).toBe('unlocked');
    peerLock!();
    expect(vault.status).toBe('locked');
    expect(locked).toEqual(['manual']);
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'none' });
  }, 30_000);

  it('Lock this browser deletes the key, tells the other tabs, then locks', async () => {
    const events: string[] = [];
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        clear: async () => {
          events.push('clear');
        },
      }),
      undefined,
      {
        peers: {
          notify: () => {
            events.push('notify');
          },
          subscribe: () => {},
        },
      },
    );
    await vault.load();
    await vault.unlock(PASSPHRASE);
    events.length = 0; // unlock with the box unchecked clears any stored key first
    await vault.lockBrowser();
    expect(events).toEqual(['clear', 'notify']);
    expect(vault.status).toBe('locked');
  }, 30_000);

  it('surfaces the notice when a cancelled unlock’s cleanup delete fails', async () => {
    const write = deferred<void>();
    const writes: string[] = [];
    const notices: string[] = [];
    const { vault } = makeVault(
      base(),
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          await write.promise;
          return true;
        },
        clear: async () => {
          throw new Error('IDB unavailable');
        },
      }),
      undefined,
      { onNotice: (line) => notices.push(line) },
    );
    await vault.load();
    const pending = vault.unlock(PASSPHRASE, true);
    await vi.waitFor(() => expect(writes).toEqual([record.id]), { timeout: 10_000 });
    write.resolve();
    vault.cancelUnlock();
    // Still reports "cancelled" — but the leftover key is not silent anymore.
    expect(await pending).toBe(false);
    expect(notices).toEqual([BROWSER_KEY_DELETE_FAILED]);
  }, 30_000);
});

describe('Vault passkey', () => {
  const enroll = vi.mocked(enrollAccountPasskey);
  const passkeyUnlock = vi.mocked(unlockWithAccountPasskey);
  // A wrap that passes the record parser: 4-byte credential id, 12-byte iv, 48-byte ciphertext.
  const wrap = {
    credentialId: 'AQIDBA',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'A'.repeat(64),
  };
  const passkeyRoutes = (extra: Routes = {}): Routes => ({
    whoami: () => ({ accountId: ACCOUNT }),
    'account-key/slots': () => ({ items: [goodSlot], nextCursor: null }),
    'account-key/passkey': (_m, body) => ({
      accountKey: {
        ...record,
        passkey: (body as { passkey?: unknown }).passkey ?? wrap,
      },
    }),
    'account-key': () => ({ accountKey: { ...record, passkey: wrap } }),
    ...extra,
  });

  it('refreshes a cached slot when another tab may have repaired it', async () => {
    let reads = 0;
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => {
        reads += 1;
        return { items: [reads === 1 ? badSlot : goodSlot], nextCursor: null };
      },
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(await vault.ensureSlot(DRIVE)).toBe(true);
    expect(await vault.slotKey(DRIVE)).toBe(otherKey);
    expect(await vault.ensureSlot(DRIVE, true)).toBe(true);
    expect(await vault.slotKey(DRIVE)).toBe(driveKey);
    expect(reads).toBe(2);
  }, 30_000);

  it('preserves a locally repaired slot when an older refresh finishes late', async () => {
    const refresh = deferred<unknown>();
    let reads = 0;
    const { vault } = makeVault({
      ...base(),
      'account-key/slots': () => {
        reads += 1;
        return reads === 1 ? { items: [badSlot], nextCursor: null } : refresh.promise;
      },
      [`drives/${DRIVE}/account-key`]: () => ({ revision: 5 }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    const refreshing = vault.ensureSlot(DRIVE, true);
    await vi.waitFor(() => expect(reads).toBe(2));
    expect(await vault.addKey(DRIVE, driveKey)).toBe('added');
    refresh.resolve({ items: [badSlot], nextCursor: null });
    expect(await refreshing).toBe(true);
    expect(await vault.slotKey(DRIVE)).toBe(driveKey);
  }, 30_000);

  it('clears only a cached slot confirmed absent by a refresh', async () => {
    let reads = 0;
    const { vault } = makeVault({
      ...base(badSlot),
      'account-key/slots': () => ({
        items: reads++ === 0 ? [badSlot] : [],
        nextCursor: null,
      }),
    });
    await vault.load();
    await vault.unlock(PASSPHRASE);
    expect(vault.hasSlot(DRIVE)).toBe(true);
    expect(await vault.ensureSlot(DRIVE, true)).toBe(false);
    expect(vault.hasSlot(DRIVE)).toBe(false);
  }, 30_000);

  it('unlocks with the passkey assertion and installs slots plus the browser key', async () => {
    const privateKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    passkeyUnlock.mockResolvedValue(privateKey);
    const writes: string[] = [];
    const { vault } = makeVault(
      passkeyRoutes(),
      undefined,
      undefined,
      undefined,
      store({
        write: async (keyId) => {
          writes.push(keyId);
          return true;
        },
      }),
    );
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(await vault.unlockWithPasskey(true)).toBe(true);
    expect(vault.status).toBe('unlocked');
    expect(writes).toEqual([record.id]);
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
    expect(passkeyUnlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: record.id }),
      expect.anything(),
    );
  }, 30_000);

  it('refuses a passkey unlock when the record has no wrapper', async () => {
    const { vault } = makeVault(base());
    await vault.load();
    await expect(vault.unlockWithPasskey()).rejects.toThrow('no passkey');
    expect(vault.status).toBe('locked');
    expect(passkeyUnlock).not.toHaveBeenCalled();
  }, 30_000);

  it('aborting the dialog cancels the assertion and installs nothing', async () => {
    const gate = deferred<CryptoKey>();
    let seen: AbortSignal | undefined;
    passkeyUnlock.mockImplementation((_record, signal) => {
      seen = signal as AbortSignal;
      return gate.promise;
    });
    const { vault } = makeVault(passkeyRoutes());
    await vault.load();
    const pending = vault.unlockWithPasskey();
    await vi.waitFor(() => expect(seen).toBeDefined(), { timeout: 10_000 });
    vault.cancelUnlock();
    expect(seen!.aborted).toBe(true);
    gate.resolve({} as CryptoKey);
    expect(await pending).toBe(false);
    expect(vault.status).toBe('locked');
    expect(await vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'none' });
  }, 30_000);

  it('supersedes an in-flight passphrase unlock', async () => {
    const slots = deferred<unknown>();
    const privateKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    passkeyUnlock.mockResolvedValue(privateKey);
    const { vault } = makeVault({
      ...passkeyRoutes(),
      'account-key/slots': () => slots.promise,
    });
    await vault.load();
    const first = vault.unlock(PASSPHRASE);
    await vi.waitFor(() => expect(vault.fetchingSlots).toBe(true), { timeout: 10_000 });
    const second = vault.unlockWithPasskey();
    slots.resolve({ items: [goodSlot], nextCursor: null });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('clears the stored key on a passkey unlock with Keep unlocked off', async () => {
    const privateKey = await unlockAccountKey(record, ACCOUNT, PASSPHRASE);
    passkeyUnlock.mockResolvedValue(privateKey);
    let cleared = 0;
    const { vault } = makeVault(
      passkeyRoutes(),
      undefined,
      undefined,
      undefined,
      store({
        clear: async () => {
          cleared += 1;
        },
      }),
    );
    await vault.load();
    expect(await vault.unlockWithPasskey(false)).toBe(true);
    expect(cleared).toBe(1);
    expect(vault.status).toBe('unlocked');
  }, 30_000);

  it('enrolls and stores the wrap through the strict endpoint', async () => {
    enroll.mockResolvedValue(wrap);
    const posts: unknown[] = [];
    const { vault } = makeVault({
      whoami: () => ({ accountId: ACCOUNT }),
      'account-key/slots': () => ({ items: [goodSlot], nextCursor: null }),
      'account-key/passkey': (_m, body) => {
        posts.push(body);
        return { accountKey: { ...record, passkey: wrap } };
      },
      'account-key': () => ({ accountKey: record }),
    });
    await vault.load();
    expect(vault.status).toBe('locked');
    expect(await vault.addPasskey(PASSPHRASE, 'owner@example.com')).toBe(true);
    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ id: record.id }),
      PASSPHRASE,
      'owner@example.com',
      expect.anything(),
    );
    expect(posts).toEqual([
      {
        expectedKeyId: record.id,
        expectedGeneration: record.wrapGeneration,
        passkey: wrap,
      },
    ]);
    expect(vault.record?.passkey).toEqual(wrap);
  }, 30_000);

  it('does not enroll when a wrapper already exists', async () => {
    const posts: unknown[] = [];
    const { vault } = makeVault({
      ...passkeyRoutes(),
      'account-key/passkey': (_m, body) => {
        posts.push(body);
        return { accountKey: { ...record, passkey: wrap } };
      },
    });
    await vault.load();
    expect(await vault.addPasskey(PASSPHRASE, 'owner@example.com')).toBe(true);
    expect(enroll).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  }, 30_000);

  it('cancelling enrollment aborts the ceremony and writes nothing', async () => {
    const gate = deferred<typeof wrap>();
    let seen: AbortSignal | undefined;
    enroll.mockImplementation((_record, _passphrase, _user, signal) => {
      seen = signal as AbortSignal;
      return gate.promise;
    });
    const posts: unknown[] = [];
    const { vault } = makeVault({
      ...passkeyRoutes(),
      'account-key/passkey': (_m, body) => {
        posts.push(body);
        return { accountKey: { ...record, passkey: wrap } };
      },
      'account-key': () => ({ accountKey: record }),
    });
    await vault.load();
    const pending = vault.addPasskey(PASSPHRASE, 'owner@example.com');
    await vi.waitFor(() => expect(seen).toBeDefined(), { timeout: 10_000 });
    vault.cancelUnlock();
    expect(seen!.aborted).toBe(true);
    gate.resolve(wrap);
    expect(await pending).toBe(false);
    expect(posts).toHaveLength(0);
    expect(vault.record?.passkey ?? null).toBeNull();
  }, 30_000);

  it('locks stale when the passkey store answers with a changed-generation conflict', async () => {
    enroll.mockResolvedValue(wrap);
    const { vault, locked } = makeVault({
      ...passkeyRoutes(),
      'account-key/passkey': () => {
        throw Object.assign(new Error('Your passphrase was changed elsewhere. Reload the page.'), {
          status: 409,
        });
      },
      'account-key': () => ({ accountKey: record }),
    });
    await vault.load();
    await expect(vault.addPasskey(PASSPHRASE, 'owner@example.com')).rejects.toThrow(
      'changed elsewhere',
    );
    expect(locked).toEqual(['stale']);
    expect(vault.status).toBe('locked');
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

  describe('trace inbox (envelope v2)', () => {
    const noFile = async () => undefined;
    const withInbox = (record: TraceInboxRecord | null) => async () => record;

    it('verifyKey checks a v1 file', async () => {
      const { vault } = makeVault();
      expect(await vault.verifyKey(DRIVE, driveKey)).toBe('file');
      expect(await vault.verifyKey(DRIVE, otherKey)).toBe('mismatch');
    });

    it('verifyKey checks a retained file path when it is supplied from Trash', async () => {
      const { vault } = makeVault(
        {},
        async () => envelope,
        async () => '/deleted.txt',
      );
      expect(await vault.verifyKey(DRIVE, driveKey)).toBe('file');
      expect(await vault.verifyKey(DRIVE, otherKey)).toBe('mismatch');
    });

    it('verifyKey checks a v2 file through the inbox', async () => {
      const { vault } = makeVault({}, async () => v2Envelope, undefined, withInbox(inboxRecord));
      expect(await vault.verifyKey(DRIVE, driveKey)).toBe('file');
      expect(await vault.verifyKey(DRIVE, otherKey)).toBe('mismatch');
    });

    it('verifyKey on an empty drive uses the inbox, or is unverifiable without one', async () => {
      const a = makeVault({}, undefined, noFile, withInbox(inboxRecord)).vault;
      expect(await a.verifyKey(DRIVE, driveKey)).toBe('inbox');
      expect(await a.verifyKey(DRIVE, otherKey)).toBe('mismatch');
      const b = makeVault({}, undefined, noFile, withInbox(null)).vault;
      expect(await b.verifyKey(DRIVE, driveKey)).toBe('unverifiable');
    });

    it("verifyKey rejects another drive's inbox record", async () => {
      const { vault } = makeVault({}, undefined, noFile, withInbox(otherDriveRecord));
      expect(await vault.verifyKey(DRIVE, driveKey)).toBe('mismatch');
    });

    it('keyFor opens a v2 envelope with the right key and not a wrong one', async () => {
      const good = makeVault(base(), async () => v2Envelope, undefined, withInbox(inboxRecord));
      await good.vault.load();
      await good.vault.unlock(PASSPHRASE);
      expect(await good.vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'key', key: driveKey });
      const bad = makeVault(
        base(badSlot),
        async () => v2Envelope,
        undefined,
        withInbox(inboxRecord),
      );
      await bad.vault.load();
      await bad.vault.unlock(PASSPHRASE);
      expect(await bad.vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'mismatch' });
    });

    it('empty drive with an inbox: addKey adds the right key and skips a wrong one', async () => {
      const routes: Routes = {
        ...base({ ...(goodSlot as object), driveId: OTHER_DRIVE }),
        [`drives/${DRIVE}/account-key`]: () => ({ revision: 1 }),
      };
      const { vault } = makeVault(routes, undefined, noFile, withInbox(inboxRecord));
      await vault.load();
      await vault.unlock(PASSPHRASE);
      expect(await vault.addKey(DRIVE, otherKey)).toBe('skipped');
      expect(await vault.addKey(DRIVE, driveKey)).toBe('added');
    });

    it('empty drive without an inbox: addKey still skips', async () => {
      const { vault } = makeVault(base(), undefined, noFile);
      await vault.load();
      await vault.unlock(PASSPHRASE);
      expect(await vault.addKey(DRIVE, driveKey)).toBe('skipped');
    });

    it('a driveId inside the server record cannot override the requested drive', async () => {
      const sealedToOther = await sealFileKeyToInbox(await unwrapFileKey(envelope, driveKey), {
        driveId: OTHER_DRIVE,
        ...otherDriveRecord,
      });
      const forged = { ...otherDriveRecord, driveId: OTHER_DRIVE } as TraceInboxRecord;
      expect(
        await makeVault({}, undefined, noFile, withInbox(forged)).vault.verifyKey(DRIVE, driveKey),
      ).toBe('mismatch');
      expect(
        await makeVault(
          {},
          async () => sealedToOther,
          undefined,
          withInbox(forged),
        ).vault.verifyKey(DRIVE, driveKey),
      ).toBe('mismatch');
    });

    it('a truncated envelope is a mismatch, not a rejection', async () => {
      const short = envelope.slice(0, 40);
      const { vault } = makeVault({}, async () => short);
      expect(await vault.verifyKey(DRIVE, driveKey)).toBe('mismatch');
      const keyed = makeVault(base(), async () => short);
      await keyed.vault.load();
      await keyed.vault.unlock(PASSPHRASE);
      expect(await keyed.vault.keyFor(DRIVE, '/a.txt')).toEqual({ status: 'mismatch' });
    });
  });
});

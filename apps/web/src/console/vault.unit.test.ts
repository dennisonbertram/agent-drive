import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  describe('trace inbox (envelope v2)', () => {
    const noFile = async () => undefined;
    const withInbox = (record: TraceInboxRecord | null) => async () => record;

    it('verifyKey checks a v1 file', async () => {
      const { vault } = makeVault();
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

import { describe, expect, it } from 'vitest';
import { createPersistedStore, type PersistedBackend } from './persisted-key';

// A Map-backed backend with the same atomic read-then-write contract as the IndexedDB one.
function memoryBackend() {
  const data = new Map<string, Record<string, unknown>>();
  let deferred: Promise<void> | null = null;
  const backend: PersistedBackend & { raw: Map<string, Record<string, unknown>> } = {
    raw: data,
    get: () => Promise.resolve(data.get('account-private-key')),
    transact: async (fn) => {
      // Only the first transact after hold() waits — later ones (another tab's lock) proceed.
      const pending = deferred;
      deferred = null;
      if (pending) await pending;
      const next = fn(data.get('account-private-key'));
      if (next !== undefined) data.set('account-private-key', next);
    },
  };
  return {
    backend,
    /** Holds the next transact until resolve() runs (simulates a slow IndexedDB write). */
    hold() {
      let resolve!: () => void;
      deferred = new Promise<void>((r) => (resolve = r));
      return resolve;
    },
  };
}

const fakeKey = { algorithm: { name: 'ECDH' } } as CryptoKey;

describe('createPersistedStore ordering', () => {
  it('stores and reads back a key record', async () => {
    const { backend } = memoryBackend();
    const store = createPersistedStore(backend, () => 1000);
    await store.write('k1', fakeKey, 'u1', 100);
    const record = await store.read();
    expect(record?.keyId).toBe('k1');
    expect(record?.owner).toBe('u1');
    expect(record?.startedAt).toBe(100);
  });

  it('serializes writes and deletes so a queued write cannot outlive a delete', async () => {
    const mem = memoryBackend();
    const store = createPersistedStore(mem.backend, () => 1000);
    const release = mem.hold();
    // The write is blocked inside transact; the delete queues behind it and must still win.
    const writing = store.write('k1', fakeKey, 'u1', 100);
    const clearing = store.clear();
    release();
    await Promise.all([writing, clearing]);
    expect(await store.read()).toBeNull();
    expect(mem.backend.raw.get('account-private-key')).toEqual({ lockedAt: 1000 });
  });

  it('refuses an older write that lands after a lock tombstone (cross-tab)', async () => {
    const mem = memoryBackend();
    // Two store instances = two tabs sharing one IndexedDB.
    const tabA = createPersistedStore(mem.backend, () => 2000);
    const tabB = createPersistedStore(mem.backend, () => 2000);
    const release = mem.hold();
    const writing = tabA.write('k1', fakeKey, 'u1', 100); // unlock began at t=100
    await tabB.clear(); // the other tab's "Lock this browser" commits a tombstone at t=2000
    release();
    await writing;
    // The older write is refused by the tombstone: the lock wins.
    expect(await tabA.read()).toBeNull();
    expect(mem.backend.raw.get('account-private-key')).toEqual({ lockedAt: 2000 });
  });

  it('a newer write beats an older in-flight write', async () => {
    const mem = memoryBackend();
    const store = createPersistedStore(mem.backend, () => 1000);
    const release = mem.hold();
    const older = store.write('k1', fakeKey, 'u1', 100);
    const newer = store.write('k1', fakeKey, 'u1', 500);
    release();
    await Promise.all([older, newer]);
    // Both ran in order; the newer record stands.
    const record = await store.read();
    expect(record?.startedAt).toBe(500);
    // And an even older late write is still refused afterwards.
    await store.write('k1', fakeKey, 'u1', 50);
    expect((await store.read())?.startedAt).toBe(500);
  });

  it('a conditional clear only removes this unlocks own record', async () => {
    const mem = memoryBackend();
    const store = createPersistedStore(mem.backend, () => 1000);
    await store.write('k1', fakeKey, 'u1', 100);
    // A stale cancel must not delete a newer record.
    await store.write('k1', fakeKey, 'u1', 500);
    await store.clear({ keyId: 'k1', startedAt: 100 });
    expect(await store.read()).not.toBeNull();
    // The matching cancel deletes and leaves a tombstone behind.
    await store.clear({ keyId: 'k1', startedAt: 500 });
    expect(await store.read()).toBeNull();
    expect(mem.backend.raw.get('account-private-key')).toEqual({ lockedAt: 1000 });
  });

  it('propagates a failed delete so callers can surface it', async () => {
    const failing: PersistedBackend = {
      get: () => Promise.resolve(undefined),
      transact: () => Promise.reject(new Error('idb gone')),
    };
    const store = createPersistedStore(failing);
    await expect(store.clear()).rejects.toThrow('idb gone');
    // ...while reads and writes degrade silently.
    await expect(store.write('k1', fakeKey)).resolves.toBeUndefined();
    await expect(store.read()).resolves.toBeNull();
  });
});

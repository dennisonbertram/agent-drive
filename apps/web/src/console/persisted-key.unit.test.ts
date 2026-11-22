import { describe, expect, it } from 'vitest';
import { createPersistedStore, type PersistedBackend } from './persisted-key';

const RECORD = 'account-private-key';
const LOCK_GENERATION = 'lockGeneration';

// A Map-backed backend with the same atomic read-then-write contract as the IndexedDB one.
function memoryBackend() {
  const data = new Map<string, Record<string, unknown>>();
  let deferred: Promise<void> | null = null;
  const backend: PersistedBackend & { raw: Map<string, Record<string, unknown>> } = {
    raw: data,
    get: (key) => Promise.resolve(data.get(key)),
    transact: async (fn) => {
      // Only the first transact after hold() waits — later ones (another tab's lock) proceed.
      const pending = deferred;
      deferred = null;
      if (pending) await pending;
      fn({
        get: (key) => data.get(key),
        set: (key, value) => {
          if (value === undefined) data.delete(key);
          else data.set(key, value);
        },
      });
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
    expect(await store.write('k1', fakeKey, 'u1', 0, 100)).toBe(true);
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
    const writing = store.write('k1', fakeKey, 'u1', 0, 100);
    const clearing = store.clear();
    release();
    await Promise.all([writing, clearing]);
    expect(await store.read()).toBeNull();
    // The lock deleted the key and bumped the counter in one transaction.
    expect(mem.backend.raw.has(RECORD)).toBe(false);
    expect(mem.backend.raw.get(LOCK_GENERATION)).toEqual({ lockGeneration: 1 });
  });

  it('a cross-tab lock revokes a generation snapshot taken before it', async () => {
    const mem = memoryBackend();
    // Two store instances = two tabs sharing one IndexedDB, the same millisecond.
    const tabA = createPersistedStore(mem.backend, () => 1000);
    const tabB = createPersistedStore(mem.backend, () => 1000);
    const snapshot = await tabA.readLockGeneration(); // tab A's unlock starts
    const release = mem.hold();
    const writing = tabA.write('k1', fakeKey, 'u1', snapshot, 100);
    await tabB.clear(); // the other tab's "Lock this browser": delete + bump in one tx
    release();
    // The write's generation is stale the moment it runs — refused, whatever the clock says.
    expect(await writing).toBe(false);
    expect(await tabA.read()).toBeNull();
    expect(mem.backend.raw.get(LOCK_GENERATION)).toEqual({ lockGeneration: 1 });
    // A fresh unlock snapshots the new counter and commits normally.
    const next = await tabA.readLockGeneration();
    expect(next).toBe(1);
    expect(await tabA.write('k1', fakeKey, 'u1', next, 200)).toBe(true);
    expect((await tabA.read())?.startedAt).toBe(200);
  });

  it('a newer write beats an older in-flight write', async () => {
    const mem = memoryBackend();
    const store = createPersistedStore(mem.backend, () => 1000);
    const release = mem.hold();
    const older = store.write('k1', fakeKey, 'u1', 0, 100);
    const newer = store.write('k1', fakeKey, 'u1', 0, 500);
    release();
    await Promise.all([older, newer]);
    // Both ran in order; the newer record stands.
    const record = await store.read();
    expect(record?.startedAt).toBe(500);
    // And an even older late write is refused afterwards.
    expect(await store.write('k1', fakeKey, 'u1', 0, 50)).toBe(false);
    expect((await store.read())?.startedAt).toBe(500);
  });

  it('a conditional clear removes only this unlock’s own record and never bumps the counter', async () => {
    const mem = memoryBackend();
    const store = createPersistedStore(mem.backend, () => 1000);
    await store.write('k1', fakeKey, 'u1', 0, 100);
    // A stale cancel must not delete a newer record.
    await store.write('k1', fakeKey, 'u1', 0, 500);
    await store.clear({ keyId: 'k1', startedAt: 100 });
    expect(await store.read()).not.toBeNull();
    // The matching cancel deletes exactly its own write — it is not a lock.
    await store.clear({ keyId: 'k1', startedAt: 500 });
    expect(await store.read()).toBeNull();
    expect(mem.backend.raw.has(LOCK_GENERATION)).toBe(false);
  });

  it('propagates a failed delete and a failed read so callers can surface them', async () => {
    const failing: PersistedBackend = {
      get: () => Promise.reject(new Error('idb gone')),
      transact: () => Promise.reject(new Error('idb gone')),
    };
    const store = createPersistedStore(failing);
    await expect(store.clear()).rejects.toThrow('idb gone');
    await expect(store.read()).rejects.toThrow('idb gone');
    await expect(store.readLockGeneration()).rejects.toThrow('idb gone');
    // ...while writes still degrade silently.
    await expect(store.write('k1', fakeKey, null, 0)).resolves.toBe(false);
  });
});

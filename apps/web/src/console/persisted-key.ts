// "Keep this browser unlocked": the account private key lives in IndexedDB as a non-extractable
// CryptoKey. Structured cloning stores the key handle, not bytes — extractable stays false, so the
// key can only ever be used for ECDH deriveBits in this browser, never exported. Never a string,
// never localStorage.
//
// `owner` is the signed-in user id the key belongs to: a record written under another user is
// cleared on sight, so a new sign-in in this browser never inherits the previous user's key.
//
// Ordering: every write and delete runs through one serialized queue, so a slow unlock's write
// can never land after a later "Lock this browser"/sign-out delete in this tab. Across tabs the
// record carries timestamps: a delete stores a tombstone `{ lockedAt }` and a write carries its
// unlock's `startedAt`; a write older than the committed tombstone (`startedAt < lockedAt`), or
// older than a newer committed write, is refused — the lock always wins.

const DB_NAME = 'agent-drive';
const STORE = 'console';
const RECORD = 'account-private-key';

export type PersistedAccountKey = {
  keyId: string;
  owner?: string | null;
  key: CryptoKey;
  /** When the unlock that wrote this record began; compared against tombstones. */
  startedAt?: number;
};

/** Only deletes the record when the stored key is still this unlock's (not a newer write). */
export type ClearMatch = { keyId: string; startedAt: number };

export type PersistedStore = {
  read: () => Promise<PersistedAccountKey | null>;
  write: (
    keyId: string,
    key: CryptoKey,
    owner?: string | null,
    startedAt?: number,
  ) => Promise<void>;
  clear: (match?: ClearMatch) => Promise<void>;
};

type StoredRecord = Record<string, unknown>;

/**
 * The atomic unit the serialized queue runs: `fn` sees the committed record and returns its
 * replacement (undefined leaves storage untouched), both inside one transaction.
 */
export type PersistedBackend = {
  get: () => Promise<StoredRecord | undefined>;
  transact: (fn: (current: StoredRecord | undefined) => StoredRecord | undefined) => Promise<void>;
};

const lockedAtOf = (record: StoredRecord | undefined): number | undefined =>
  record && typeof record.lockedAt === 'number' ? record.lockedAt : undefined;

const startedAtOf = (record: StoredRecord | undefined): number =>
  record && typeof record.startedAt === 'number' ? record.startedAt : 0;

const isKeyRecord = (record: StoredRecord | undefined): record is StoredRecord =>
  Boolean(record) && typeof record!.keyId === 'string' && Boolean(record!.key);

/**
 * The store's ordering rules, over any backend that can read-then-write atomically. A failed
 * delete propagates (the caller must know the lock did not land); read and write degrade to
 * "ask again"/no-op so the feature fails soft.
 */
export function createPersistedStore(
  backend: PersistedBackend,
  now: () => number = () => Date.now(),
): PersistedStore {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    read: () =>
      enqueue(() => backend.get())
        .then((value) => {
          if (!isKeyRecord(value)) return null;
          const record = value as unknown as PersistedAccountKey;
          return {
            ...record,
            owner: typeof record.owner === 'string' ? record.owner : null,
          };
        })
        .catch(() => null),
    write: (keyId, key, owner, startedAt = now()) =>
      enqueue(() =>
        backend.transact((current) => {
          const lockedAt = lockedAtOf(current);
          if (lockedAt !== undefined && startedAt < lockedAt) return undefined;
          if (startedAtOf(current) > startedAt) return undefined;
          return { keyId, owner: owner ?? null, key, startedAt };
        }),
      )
        .then(() => undefined)
        .catch(() => {}),
    clear: (match) =>
      enqueue(() =>
        backend.transact((current) => {
          if (match) {
            // A conditional clear (a cancelled unlock removing its own write) never deletes a
            // tombstone or a newer unlock's record.
            if (!isKeyRecord(current)) return undefined;
            if (current!.keyId !== match.keyId || startedAtOf(current) > match.startedAt)
              return undefined;
          }
          return { lockedAt: now() };
        }),
      ),
  };
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolves on tx.oncomplete, not request.onsuccess: a reload between them would roll the write
// back, so callers can rely on the promise meaning "committed", not "queued".
const idbBackend: PersistedBackend = {
  async get() {
    const db = await openDb();
    try {
      return await new Promise<StoredRecord | undefined>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(RECORD);
        request.onsuccess = () => resolve(request.result as StoredRecord | undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  async transact(fn) {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const get = store.get(RECORD);
        let failed: unknown;
        get.onsuccess = () => {
          try {
            const next = fn(get.result as StoredRecord | undefined);
            if (next !== undefined) store.put(next, RECORD);
          } catch (error) {
            failed = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failed ?? tx.error);
        tx.onabort = () => reject(failed ?? tx.error);
      });
    } finally {
      db.close();
    }
  },
};

const noopBackend: PersistedBackend = {
  get: () => Promise.resolve(undefined),
  transact: (fn) => {
    fn(undefined);
    return Promise.resolve();
  },
};

// The real IndexedDB store (a no-op backend where IndexedDB is unavailable, e.g. SSR). read and
// write swallow errors — the feature degrades to "ask again" — but clear propagates: "Lock this
// browser" and the sign-out guard must know the delete landed.
export const persistedAccountKey: PersistedStore = createPersistedStore(
  typeof indexedDB === 'undefined' ? noopBackend : idbBackend,
);

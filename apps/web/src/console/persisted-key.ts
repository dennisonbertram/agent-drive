// "Keep this browser unlocked": the account private key lives in IndexedDB as a non-extractable
// CryptoKey. Structured cloning stores the key handle, not bytes — extractable stays false, so the
// key can only ever be used for ECDH deriveBits in this browser, never exported. Never a string,
// never localStorage.
//
// `owner` is the signed-in user id the key belongs to: a record written under another user is
// cleared on sight, so a new sign-in in this browser never inherits the previous user's key.
//
// Ordering: every write and delete runs through one serialized queue, so a slow unlock's write
// can never land after a later "Lock this browser"/sign-out delete in this tab. Across tabs a
// `lockGeneration` counter replaces wall-clock ordering: Lock/sign-out increments it and deletes
// the key in ONE readwrite transaction, while an unlock snapshots the counter when it starts and
// commits its write — in one readwrite transaction — only when the counter is unchanged. Two
// tabs in the same millisecond can never both win: a lock anywhere always wins.
//
// Locking also posts on BroadcastChannel('agent-drive-vault') so every other open tab drops its
// in-memory key immediately instead of discovering the missing record later.

const DB_NAME = 'agent-drive';
const STORE = 'console';
const RECORD = 'account-private-key';
const LOCK_GENERATION = 'lockGeneration';
const LOCK_CHANNEL = 'agent-drive-vault';

export type PersistedAccountKey = {
  keyId: string;
  owner?: string | null;
  key: CryptoKey;
  /** When the unlock that wrote this record began; distinguishes successive writes. */
  startedAt?: number;
};

/** Only deletes the record when the stored key is still this unlock's (not a newer write). */
export type ClearMatch = { keyId: string; startedAt: number };

export type PersistedStore = {
  /** Rejects on a storage failure — a caller must not mistake "cannot read" for "nothing stored". */
  read: () => Promise<PersistedAccountKey | null>;
  /** The lock counter an unlock snapshots before it starts deriving its key. */
  readLockGeneration: () => Promise<number>;
  /**
   * Commits the record only while the counter still equals `generation` — the value this
   * unlock read when it started — and no newer write already committed. Resolves whether it
   * committed; storage failures degrade to false so the feature fails soft.
   */
  write: (
    keyId: string,
    key: CryptoKey,
    owner: string | null | undefined,
    generation: number,
    startedAt?: number,
  ) => Promise<boolean>;
  /**
   * Without a match: deletes the key and increments the lock counter in one transaction (Lock
   * this browser, sign-out), so a generation a racing unlock snapshot can never commit after
   * it. With a match (a cancelled unlock cleaning up): deletes only that exact record and
   * leaves the counter alone. Failures propagate — the caller must know the delete did not land.
   */
  clear: (match?: ClearMatch) => Promise<void>;
};

type StoredRecord = Record<string, unknown>;

/**
 * The atomic unit the serialized queue runs: `fn` sees both committed records inside one
 * readwrite transaction and mutates a view (`set(key, undefined)` deletes). Throwing aborts it.
 */
export type PersistedBackend = {
  get: (key: string) => Promise<StoredRecord | undefined>;
  transact: (
    fn: (view: {
      get: (key: string) => StoredRecord | undefined;
      set: (key: string, value: StoredRecord | undefined) => void;
    }) => void,
  ) => Promise<void>;
};

const generationOf = (record: StoredRecord | undefined): number =>
  record && typeof record.lockGeneration === 'number' ? record.lockGeneration : 0;

const startedAtOf = (record: StoredRecord | undefined): number =>
  record && typeof record.startedAt === 'number' ? record.startedAt : 0;

const isKeyRecord = (record: StoredRecord | undefined): record is StoredRecord =>
  Boolean(record) && typeof record!.keyId === 'string' && Boolean(record!.key);

/**
 * The store's ordering rules, over any backend that can read-then-write atomically. A failed
 * delete propagates (the caller must know the lock did not land); writes degrade to false so
 * the feature fails soft.
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
      enqueue(() => backend.get(RECORD)).then((value) => {
        if (!isKeyRecord(value)) return null;
        const record = value as unknown as PersistedAccountKey;
        return {
          ...record,
          owner: typeof record.owner === 'string' ? record.owner : null,
        };
      }),
    readLockGeneration: () =>
      enqueue(() => backend.get(LOCK_GENERATION)).then((record) => generationOf(record)),
    write: (keyId, key, owner, generation, startedAt = now()) =>
      enqueue(async () => {
        let committed = false;
        await backend.transact((view) => {
          // Refuse when a lock moved the counter since this unlock snapshot it, or a newer
          // write already landed.
          if (generationOf(view.get(LOCK_GENERATION)) !== generation) return;
          if (startedAtOf(view.get(RECORD)) > startedAt) return;
          committed = true;
          view.set(RECORD, { keyId, owner: owner ?? null, key, startedAt });
        });
        return committed;
      }).catch(() => false),
    clear: (match) =>
      enqueue(() =>
        backend.transact((view) => {
          if (match) {
            // A conditional clear removes exactly this unlock's own write — never a newer
            // write (different startedAt) and never another tab's record.
            const current = view.get(RECORD);
            if (!isKeyRecord(current)) return;
            if (current.keyId !== match.keyId || startedAtOf(current) !== match.startedAt) return;
            view.set(RECORD, undefined);
            return;
          }
          // Lock/sign-out: counter and delete land together or not at all.
          view.set(RECORD, undefined);
          view.set(LOCK_GENERATION, {
            lockGeneration: generationOf(view.get(LOCK_GENERATION)) + 1,
          });
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
// back, so callers can rely on the promise meaning "committed", not "queued". Both records are
// read inside the same readwrite transaction before `fn` runs, so the lock counter and the key
// are compared and mutated atomically.
const idbBackend: PersistedBackend = {
  async get(key) {
    const db = await openDb();
    try {
      return await new Promise<StoredRecord | undefined>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
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
        const got = new Map<string, StoredRecord | undefined>();
        let failed: unknown;
        for (const key of [RECORD, LOCK_GENERATION]) {
          const request = store.get(key);
          request.onsuccess = () => {
            got.set(key, request.result as StoredRecord | undefined);
            if (got.size < 2) return;
            try {
              fn({
                get: (key) => got.get(key),
                set: (key, value) => {
                  if (value === undefined) void store.delete(key);
                  else void store.put(value, key);
                },
              });
            } catch (error) {
              failed = error;
              tx.abort();
            }
          };
          request.onerror = () => {
            failed = request.error;
            tx.abort();
          };
        }
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
    fn({ get: () => undefined, set: () => {} });
    return Promise.resolve();
  },
};

// The real IndexedDB store (a no-op backend where IndexedDB is unavailable, e.g. SSR). Writes
// degrade to false — the feature degrades to "ask again" — but clear propagates: "Lock this
// browser" and the sign-out guard must know the delete landed.
export const persistedAccountKey: PersistedStore = createPersistedStore(
  typeof indexedDB === 'undefined' ? noopBackend : idbBackend,
);

// One channel per page: subscribe registers the vault's listener, notify posts the lock.
let channel: BroadcastChannel | undefined;
function lockChannel() {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  try {
    return (channel ??= new BroadcastChannel(LOCK_CHANNEL));
  } catch {
    return undefined;
  }
}

/** The BroadcastChannel pair vaults use: notify on "Lock this browser"/sign-out, lock on receipt. */
export const vaultLockPeers = {
  notify() {
    try {
      lockChannel()?.postMessage('lock');
    } catch {
      // A denied channel only delays the other tabs until their next read.
    }
  },
  subscribe(onLock: () => void) {
    const active = lockChannel();
    if (!active) return;
    active.addEventListener('message', (event: MessageEvent) => {
      if (event.data === 'lock') onLock();
    });
  },
};

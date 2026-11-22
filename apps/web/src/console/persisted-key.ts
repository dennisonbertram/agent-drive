// "Keep this browser unlocked": the account private key lives in IndexedDB as a non-extractable
// CryptoKey. Structured cloning stores the key handle, not bytes — extractable stays false, so the
// key can only ever be used for ECDH deriveBits in this browser, never exported. Never a string,
// never localStorage.
//
// `owner` is the signed-in user id the key belongs to: a record written under another user is
// cleared on sight, so a new sign-in in this browser never inherits the previous user's key.

const DB_NAME = 'agent-drive';
const STORE = 'console';
const RECORD = 'account-private-key';

export type PersistedAccountKey = { keyId: string; owner?: string | null; key: CryptoKey };
export type PersistedStore = {
  read: () => Promise<PersistedAccountKey | null>;
  write: (keyId: string, key: CryptoKey, owner?: string | null) => Promise<void>;
  clear: () => Promise<void>;
};

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

async function read(): Promise<PersistedAccountKey | null> {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(RECORD);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as { keyId?: unknown }).keyId !== 'string' ||
      !(value as { key?: unknown }).key
    )
      return null;
    const record = value as PersistedAccountKey;
    return { ...record, owner: typeof record.owner === 'string' ? record.owner : null };
  } finally {
    db.close();
  }
}

// Resolves on tx.oncomplete, not request.onsuccess: a reload between them would roll the write
// back, so callers can rely on the promise meaning "committed", not "queued".
async function write(keyId: string, key: CryptoKey, owner: string | null) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ keyId, owner, key }, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function clear() {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// The real IndexedDB store. read/write swallow errors (the feature degrades to "ask again"),
// but clear propagates: "Lock this browser" and the sign-out guard must know the delete landed.
export const persistedAccountKey: PersistedStore = {
  read: () => {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return read().catch(() => null);
  },
  write: (keyId, key, owner) => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return write(keyId, key, owner ?? null).catch(() => {});
  },
  clear: () => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return clear();
  },
};

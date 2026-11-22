// "Keep this browser unlocked": the account private key lives in IndexedDB as a non-extractable
// CryptoKey. Structured cloning stores the key handle, not bytes — extractable stays false, so the
// key can only ever be used for ECDH deriveBits in this browser, never exported. Never a string,
// never localStorage.

const DB_NAME = 'agent-drive';
const STORE = 'console';
const RECORD = 'account-private-key';

export type PersistedAccountKey = { keyId: string; key: CryptoKey };
export type PersistedStore = {
  read: () => Promise<PersistedAccountKey | null>;
  write: (keyId: string, key: CryptoKey) => Promise<void>;
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
    return value as PersistedAccountKey;
  } finally {
    db.close();
  }
}

// Resolves on tx.oncomplete, not request.onsuccess: a reload between them would roll the write
// back, so callers can rely on the promise meaning "committed", not "queued".
async function write(keyId: string, key: CryptoKey) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ keyId, key }, RECORD);
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

/** The real IndexedDB store; unavailable (or denied) browsers behave as {read→null, write→noop}. */
export const persistedAccountKey: PersistedStore = {
  read: () => {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return read().catch(() => null);
  },
  write: (keyId, key) => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return write(keyId, key).catch(() => {});
  },
  clear: () => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return clear().catch(() => {});
  },
};

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedStore } from '@/src/console/persisted-key';
import { reconcilePersistedKey } from './vault-key-guard';

afterEach(() => vi.unstubAllGlobals());

const store = (over: Partial<PersistedStore> = {}): PersistedStore => ({
  read: async () => null,
  write: async () => {},
  clear: async () => {},
  ...over,
});

const fakeKey = {} as CryptoKey;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe('reconcilePersistedKey', () => {
  it('keeps the signed-in user’s record and drops another user’s', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const mine = store({
      read: async () => ({ keyId: 'k', owner: 'user_a', key: fakeKey }),
    });
    expect(await reconcilePersistedKey('user_a', { clerkEnabled: true, store: mine })).toBe('kept');
    let cleared = 0;
    const foreign = store({
      read: async () => ({ keyId: 'k', owner: 'user_b', key: fakeKey }),
      clear: async () => {
        cleared += 1;
      },
    });
    expect(await reconcilePersistedKey('user_a', { clerkEnabled: true, store: foreign })).toBe(
      'cleared',
    );
    expect(cleared).toBe(1);
  });

  it('deletes ownerless legacy records — signed in or signed out — under Clerk', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    for (const userId of ['user_a', null]) {
      let cleared = 0;
      const legacy = store({
        read: async () => ({ keyId: 'k', key: fakeKey }), // pre-owner records have no owner
        clear: async () => {
          cleared += 1;
        },
      });
      expect(await reconcilePersistedKey(userId, { clerkEnabled: true, store: legacy })).toBe(
        'cleared',
      );
      expect(cleared).toBe(1);
    }
  });

  it('keeps ownerless records in a deployment without Clerk', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const legacy = store({
      read: async () => ({ keyId: 'k', owner: null, key: fakeKey }),
    });
    expect(await reconcilePersistedKey(null, { clerkEnabled: false, store: legacy })).toBe('kept');
  });

  it('flags a failed delete, reports it once per episode, and retries next load', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    let fails = true;
    const reports: string[] = [];
    let record: { keyId: string; owner: string; key: CryptoKey } | null = {
      keyId: 'k',
      owner: 'user_b',
      key: fakeKey,
    };
    const flaky = store({
      read: async () => record,
      clear: async () => {
        if (fails) throw new Error('idb unavailable');
        record = null;
      },
    });
    const opts = {
      clerkEnabled: true,
      store: flaky,
      report: (line: string) => reports.push(line),
    };
    // First failure: flagged for retry and reported once.
    expect(await reconcilePersistedKey('user_a', opts)).toBe('retry');
    expect(reports).toHaveLength(1);
    expect(localStorage.getItem('agent-drive:key-delete-failed')).toBe('1');
    // Still failing on the next "page load": retried, not reported again.
    expect(await reconcilePersistedKey('user_a', opts)).toBe('retry');
    expect(reports).toHaveLength(1);
    // Once the delete lands, the flag clears and nothing remains owed.
    fails = false;
    expect(await reconcilePersistedKey('user_a', opts)).toBe('cleared');
    expect(localStorage.getItem('agent-drive:key-delete-failed')).toBeNull();
    expect(await reconcilePersistedKey('user_a', opts)).toBe('kept');
  });

  it('a flagged retry deletes even when the record reads back empty', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('agent-drive:key-delete-failed', '1');
    let cleared = 0;
    // read returns null — could be an empty store or a failed read; the retry is still owed.
    const empty = store({
      clear: async () => {
        cleared += 1;
      },
    });
    expect(await reconcilePersistedKey('user_a', { clerkEnabled: true, store: empty })).toBe(
      'cleared',
    );
    expect(cleared).toBe(1);
  });
});

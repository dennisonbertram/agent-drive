'use client';
import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { persistedAccountKey, type PersistedStore } from '@/src/console/persisted-key';

function useClerkIdentity() {
  const { isLoaded, user } = useUser();
  return { loaded: isLoaded, userId: user?.id ?? null };
}
function useNoIdentity() {
  return { loaded: true, userId: null as string | null };
}

// A delete that could not land is remembered in localStorage so the next page load retries it.
const RETRY_KEY = 'agent-drive:key-delete-failed';

function retryFlag() {
  try {
    return globalThis.localStorage?.getItem(RETRY_KEY) === '1';
  } catch {
    return false;
  }
}

function setRetryFlag(on: boolean) {
  try {
    if (on) globalThis.localStorage?.setItem(RETRY_KEY, '1');
    else globalThis.localStorage?.removeItem(RETRY_KEY);
  } catch {
    // Storage-denied browsers just lose the retry marker.
  }
}

/**
 * The guard's decision, injectable for tests: deletes the IndexedDB-held account key whenever
 * the record's owner is not the signed-in user — and, under Clerk, whenever a legacy record has
 * no owner at all (signing out counts: ownerless then means "nobody's"). A failed delete is
 * flagged so the next page load retries it, and reported exactly once per failure episode.
 */
export async function reconcilePersistedKey(
  userId: string | null,
  opts: { clerkEnabled: boolean; store?: PersistedStore; report?: (line: string) => void },
): Promise<'kept' | 'cleared' | 'retry'> {
  const store = opts.store ?? persistedAccountKey;
  const report = opts.report ?? ((line: string) => console.error(line));
  const flagged = retryFlag();
  let stored: Awaited<ReturnType<PersistedStore['read']>> = null;
  let readFailed = false;
  try {
    stored = await store.read();
  } catch {
    // A failed read must not look like "nothing to delete": attempt the delete anyway.
    readFailed = true;
  }
  const mustClear =
    flagged ||
    readFailed ||
    (stored !== null &&
      (opts.clerkEnabled
        ? stored.owner == null || stored.owner !== userId
        : (stored.owner ?? null) !== userId));
  if (!mustClear) return 'kept';
  try {
    await store.clear();
    setRetryFlag(false);
    return 'cleared';
  } catch {
    if (!flagged) {
      setRetryFlag(true);
      report(
        'Could not remove the saved account key from this browser. It will be retried on the next page load.',
      );
    }
    return 'retry';
  }
}

/**
 * Clears the IndexedDB-held account key whenever the signed-in user changes — sign-out and
 * user-switching included — from anywhere in the app, not just while the Files console is
 * mounted. On load it also drops a record whose owner is not the current user, so a key left
 * by an earlier sign-in never carries over. Rendered inside ClerkProvider only.
 */
export function VaultKeyGuard({ clerkEnabled }: { clerkEnabled: boolean }) {
  const useIdentity = clerkEnabled ? useClerkIdentity : useNoIdentity;
  const { loaded, userId } = useIdentity();
  useEffect(() => {
    // Before Clerk loads, userId would read as signed-out — wait for the real identity.
    if (!loaded) return;
    void reconcilePersistedKey(userId, { clerkEnabled });
  }, [loaded, userId, clerkEnabled]);
  return null;
}

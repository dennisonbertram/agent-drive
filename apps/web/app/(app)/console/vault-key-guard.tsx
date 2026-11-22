'use client';
import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { persistedAccountKey } from '@/src/console/persisted-key';

function useClerkIdentity() {
  const { isLoaded, user } = useUser();
  return { loaded: isLoaded, userId: user?.id ?? null };
}
function useNoIdentity() {
  return { loaded: true, userId: null as string | null };
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
    void persistedAccountKey
      .read()
      .then((stored) =>
        stored && (stored.owner ?? null) !== userId ? persistedAccountKey.clear() : undefined,
      )
      .catch(() => {});
  }, [loaded, userId]);
  return null;
}

import { clerkClient } from '@clerk/nextjs/server';
import { clerkKeysConfigured } from './clerk-config';

export function consoleIdentityDeletionConfigured() {
  return clerkKeysConfigured(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    process.env.CLERK_SECRET_KEY,
  );
}

export async function deleteConsoleIdentity(userId: string) {
  if (!consoleIdentityDeletionConfigured())
    throw new Error('Console identity deletion is not configured.');
  if (process.env.NODE_ENV === 'test') {
    throw new Error('The Clerk identity adapter must be mocked in tests.');
  }
  const client = await clerkClient();
  try {
    await client.users.deleteUser(userId);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404)
      return;
    throw error;
  }
}

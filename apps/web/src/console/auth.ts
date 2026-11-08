import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth as clerkAuth } from '@clerk/nextjs/server';
import { clerkKeysConfigured } from './clerk-config';

export const testSessionCookieName = 'agent_drive_test_session';
const testUserIdPattern = /^e2e_[a-zA-Z0-9_-]+$/;
const testSessionLifetimeMs = 60 * 60 * 1000;

function testModeRequested() {
  return process.env.AGENT_DRIVE_TEST_AUTH === '1';
}

function testSecret() {
  const secret = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

export function testAuthEnabled() {
  return process.env.NODE_ENV === 'development' && testModeRequested() && !!testSecret();
}

export function clerkConfigured() {
  return (
    !testModeRequested() &&
    clerkKeysConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, process.env.CLERK_SECRET_KEY)
  );
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function validSignature(payload: string, provided: string, secret: string) {
  const expected = signature(payload, secret);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function issueTestSessionCookie(userId: string, now = Date.now()) {
  if (!testUserIdPattern.test(userId)) throw new Error('Invalid test user ID.');
  const secret = testSecret();
  if (!secret) throw new Error('Test authentication is not configured.');
  const expiresAt = now + testSessionLifetimeMs;
  const payload = Buffer.from(`${userId}.${expiresAt}`).toString('base64url');
  return {
    value: `${payload}.${signature(payload, secret)}`,
    expiresAt,
  };
}

export function verifyTestSessionCookie(value: string | undefined, now = Date.now()) {
  const secret = testSecret();
  if (!secret || !value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = value.slice(0, separator);
  const providedSignature = value.slice(separator + 1);
  if (!validSignature(payload, providedSignature, secret)) return null;
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const match = /^((?:e2e_[a-zA-Z0-9_-]+))\.([0-9]+)$/.exec(decoded);
  if (!match) return null;
  const expiresAt = Number(match[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  return match[1]!;
}

export async function consoleUserId(): Promise<string | null> {
  // A requested test mode always fails closed outside development and never
  // falls through to a real Clerk session.
  if (testModeRequested()) {
    if (!testAuthEnabled()) return null;
    const store = await cookies();
    return verifyTestSessionCookie(store.get(testSessionCookieName)?.value);
  }
  if (!clerkConfigured()) return null;
  const session = await clerkAuth();
  return session.userId ?? null;
}

/** True when this session recently passed Clerk strict reverification (always true in test auth). */
export async function consoleReverified(): Promise<boolean> {
  if (testModeRequested()) return testAuthEnabled();
  if (!clerkConfigured()) return false;
  const session = await clerkAuth();
  return session.has({ reverification: 'strict' });
}

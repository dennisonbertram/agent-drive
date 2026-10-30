import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as createTestSession } from '../../app/api/test-session/route';
import proxy, { config as proxyConfig } from '../../proxy';
import {
  consoleUserId,
  clerkConfigured,
  issueTestSessionCookie,
  testAuthEnabled,
  verifyTestSessionCookie,
} from './auth';
import { clerkKeysConfigured, isClerkConsolePage } from './clerk-config';

const originalEnvironment = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...originalEnvironment };
});

describe('console test authentication', () => {
  it('signs and validates a session until its one-hour expiry', () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.AGENT_DRIVE_TEST_AUTH = '1';
    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'a'.repeat(32);
    const issued = issueTestSessionCookie('e2e_alice', 1_000);

    expect(verifyTestSessionCookie(issued.value, 1_000)).toBe('e2e_alice');
    expect(verifyTestSessionCookie(issued.value, issued.expiresAt)).toBeNull();
  });

  it('rejects tampered payloads, signatures, and user IDs', () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.AGENT_DRIVE_TEST_AUTH = '1';
    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'b'.repeat(32);
    const issued = issueTestSessionCookie('e2e_bob', 1_000);
    const [payload, signature] = issued.value.split('.');

    expect(verifyTestSessionCookie(`${payload}x.${signature}`, 1_001)).toBeNull();
    expect(verifyTestSessionCookie(`${payload}.${signature}x`, 1_001)).toBeNull();
    expect(verifyTestSessionCookie('not-a-session', 1_001)).toBeNull();
  });

  it('requires development test mode and a sufficiently long secret', () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.AGENT_DRIVE_TEST_AUTH = '1';
    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'c'.repeat(31);
    expect(testAuthEnabled()).toBe(false);

    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'c'.repeat(32);
    expect(testAuthEnabled()).toBe(true);

    vi.stubEnv('NODE_ENV', 'test');
    expect(testAuthEnabled()).toBe(false);
  });

  it('never accepts a test identity in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.AGENT_DRIVE_TEST_AUTH = '1';
    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'd'.repeat(32);
    expect(testAuthEnabled()).toBe(false);
    expect(await consoleUserId()).toBeNull();
  });

  it('issues test cookies only for exact loopback requests with the shared secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.AGENT_DRIVE_TEST_AUTH = '1';
    process.env.AGENT_DRIVE_TEST_AUTH_SECRET = 'e'.repeat(32);
    const request = (url: string, secret: string, userId = 'e2e_route') =>
      createTestSession(
        new Request(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify({ userId }),
        }),
      );

    const accepted = await request(
      'http://127.0.0.1/api/test-session',
      process.env.AGENT_DRIVE_TEST_AUTH_SECRET,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('set-cookie')).toContain('HttpOnly');
    expect(accepted.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(accepted.headers.get('set-cookie')).toContain('Path=/');

    expect(
      (await request('http://localhost.attacker.test/api/test-session', 'e'.repeat(32))).status,
    ).toBe(404);
    expect((await request('http://localhost/api/test-session', 'wrong-secret')).status).toBe(401);
    expect(
      (await request('http://localhost/api/test-session', 'e'.repeat(32), 'owner')).status,
    ).toBe(400);
  });

  it('matches console APIs through Clerk without protecting them as sign-in pages', () => {
    expect(proxyConfig.matcher).toContain('/api/console/:path*');
    expect(proxyConfig.matcher).not.toContain('/api/v1/:path*');
    expect(isClerkConsolePage('/console')).toBe(true);
    expect(isClerkConsolePage('/api/console/session')).toBe(false);
    expect(isClerkConsolePage('/api/v1/whoami')).toBe(false);
    expect(proxy).toBeTypeOf('function');
  });

  it('treats example Clerk credentials as unconfigured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AGENT_DRIVE_TEST_AUTH', '0');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_replace_me');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_replace_me');

    expect(clerkKeysConfigured('pk_test_replace_me', 'sk_test_replace_me')).toBe(false);
    expect(clerkConfigured()).toBe(false);
    expect(clerkKeysConfigured('pk_test_live-value', 'sk_test_live-value')).toBe(true);
  });
});

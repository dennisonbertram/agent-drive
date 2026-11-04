import { afterEach, expect, it, vi } from 'vitest';

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: clerk.auth }));
import { consoleUserId } from './auth';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function productionConfiguration() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AGENT_DRIVE_TEST_AUTH', '0');
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_boundary_fixture');
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_boundary_fixture');
}

it('uses the Clerk identity in the production path and does not invent a signed-out identity', async () => {
  productionConfiguration();
  clerk.auth.mockResolvedValueOnce({ userId: 'user_simulated_owner' });
  expect(await consoleUserId()).toBe('user_simulated_owner');
  clerk.auth.mockResolvedValueOnce({ userId: null });
  expect(await consoleUserId()).toBeNull();
  expect(clerk.auth).toHaveBeenCalledTimes(2);
});

it('fails closed on Clerk errors and accidental production test-mode configuration', async () => {
  productionConfiguration();
  clerk.auth.mockRejectedValueOnce(new Error('Simulated Clerk failure'));
  await expect(consoleUserId()).rejects.toThrow('Simulated Clerk failure');
  vi.stubEnv('AGENT_DRIVE_TEST_AUTH', '1');
  vi.stubEnv('AGENT_DRIVE_TEST_AUTH_SECRET', 'fixture-secret-that-is-at-least-32-characters');
  expect(await consoleUserId()).toBeNull();
  expect(clerk.auth).toHaveBeenCalledTimes(1);
});

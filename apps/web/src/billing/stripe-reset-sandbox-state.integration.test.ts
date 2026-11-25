import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { resetSandboxState } from '../../scripts/stripe-reset-sandbox-state.mjs';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive';
const pool = new Pool({ connectionString: databaseUrl });

let accountId = '';
let cleanAccountId = '';
let pendingReportId = '';
let deliveredReportId = '';

type BillingRow = {
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  checkout_idempotency_key: string | null;
  checkout_session_id: string | null;
  checkout_created_at: Date | null;
};

async function billingRow(id: string) {
  return (
    await pool.query<BillingRow>(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status,
              checkout_idempotency_key, checkout_session_id, checkout_created_at
         FROM billing_accounts WHERE account_id = $1`,
      [id],
    )
  ).rows[0];
}

beforeAll(async () => {
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle'),
  });
  accountId = (
    await pool.query<{ id: string }>('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `sandbox-reset-${randomUUID()}`,
    ])
  ).rows[0]!.id;
  cleanAccountId = (
    await pool.query<{ id: string }>('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `sandbox-reset-clean-${randomUUID()}`,
    ])
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO billing_accounts
       (account_id, plan, stripe_customer_id, stripe_subscription_id, subscription_status,
        checkout_idempotency_key, checkout_session_id, checkout_created_at)
     VALUES ($1, 'developer', $2, 'sub_sandbox', 'active', 'checkout/key', 'cs_sandbox', now())`,
    [accountId, `cus_sandbox_${randomUUID().replaceAll('-', '')}`],
  );
  await pool.query(`INSERT INTO billing_accounts (account_id, plan) VALUES ($1, 'free')`, [
    cleanAccountId,
  ]);
  pendingReportId = (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_meter_reports
         (account_id, period_start, stripe_customer_id, cents)
       VALUES ($1, now(), 'cus_sandbox_pending', 500) RETURNING id`,
      [accountId],
    )
  ).rows[0]!.id;
  deliveredReportId = (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_meter_reports
         (account_id, period_start, stripe_customer_id, cents, reported_at)
       VALUES ($1, now(), 'cus_sandbox_done', 300, now()) RETURNING id`,
      [accountId],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  for (const id of [accountId, cleanAccountId])
    if (id) await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  await pool.end();
});

it('dry run lists the rows to reset without changing them', async () => {
  const log = vi.fn();
  await resetSandboxState({ databaseUrl, log });

  const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
  expect(printed).toContain('dry run');
  expect(printed).toContain(accountId);
  expect(printed).toContain('plan: developer -> free');
  expect(printed).toContain('stripe_customer_id: cus_sandbox_');
  expect(printed).toContain('stripe_subscription_id: sub_sandbox -> NULL');
  expect(printed).toContain('checkout_session_id: cs_sandbox -> NULL');
  expect(printed).toContain(`pending meter report ${pendingReportId}`);
  expect(printed).toContain('-> abandoned');
  expect(printed).not.toContain(deliveredReportId);

  expect(await billingRow(accountId)).toMatchObject({
    plan: 'developer',
    stripe_subscription_id: 'sub_sandbox',
  });
  expect(
    (
      await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM billing_meter_reports WHERE id = $1 AND reported_at IS NULL AND first_attempt_at IS NULL',
        [pendingReportId],
      )
    ).rows[0]!.count,
  ).toBe('1');
});

it('refuses --apply without --confirm-sandbox-only', async () => {
  await expect(
    resetSandboxState({ databaseUrl, apply: true, log: () => undefined }),
  ).rejects.toThrow(/--confirm-sandbox-only/u);
  expect(await billingRow(accountId)).toMatchObject({ plan: 'developer' });
});

it('refuses to connect without DATABASE_URL', async () => {
  await expect(resetSandboxState({ log: () => undefined })).rejects.toThrow(/DATABASE_URL/u);
});

it('apply clears the sandbox pointers, frees paid plans, and parks pending reports', async () => {
  const log = vi.fn();
  await resetSandboxState({
    databaseUrl,
    apply: true,
    confirmSandboxOnly: true,
    log,
  });

  expect(await billingRow(accountId)).toEqual({
    plan: 'free',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    subscription_status: null,
    checkout_idempotency_key: null,
    checkout_session_id: null,
    checkout_created_at: null,
  });
  expect(await billingRow(cleanAccountId)).toMatchObject({ plan: 'free' });

  const pending = (
    await pool.query<{
      first_attempt_at: Date | null;
      lease_until: Date | null;
      reported_at: Date | null;
      last_error: string | null;
    }>(
      'SELECT first_attempt_at, lease_until, reported_at, last_error FROM billing_meter_reports WHERE id = $1',
      [pendingReportId],
    )
  ).rows[0]!;
  // Parked, not deleted: the row is still there, past the 23-hour retry window.
  expect(pending.reported_at).toBeNull();
  expect(pending.lease_until).toBeNull();
  expect(pending.first_attempt_at!.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  expect(pending.last_error).toContain('Abandoned');

  const delivered = (
    await pool.query<{ first_attempt_at: Date | null }>(
      'SELECT first_attempt_at FROM billing_meter_reports WHERE id = $1',
      [deliveredReportId],
    )
  ).rows[0]!;
  expect(delivered.first_attempt_at).toBeNull();

  const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
  expect(printed).toContain('Applied:');
});

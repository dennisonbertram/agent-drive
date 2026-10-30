import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { drainOutboxes } from './maintenance';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive',
});
let accountId = '';

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  accountId = (
    await pool.query<{ id: string }>('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `billing-maintenance-${randomUUID()}`,
    ])
  ).rows[0]!.id;
});

afterAll(async () => {
  if (accountId) await pool.query('DELETE FROM accounts WHERE id=$1', [accountId]);
  await pool.end();
});

it('drains batches once, isolates failures, retries the same id, and pauses expired attempts', async () => {
  const periodStart = new Date();
  await pool.query(
    `INSERT INTO billing_meter_reports (account_id,period_start,stripe_customer_id,cents,created_at)
     SELECT $1,$2,'cus_maintenance_fixture',1,now() + (n * interval '1 millisecond')
       FROM generate_series(1,102) AS n`,
    [accountId, periodStart],
  );
  await pool.query(
    `INSERT INTO billing_notifications (account_id,period_start,threshold_cents,email,created_at)
     SELECT $1,$2,n,'maintenance-' || n || '@example.test',now() + (n * interval '1 millisecond')
       FROM generate_series(1,2) AS n`,
    [accountId, periodStart],
  );
  const meterIds = (
    await pool.query<{ id: string }>(
      'SELECT id FROM billing_meter_reports WHERE account_id=$1 ORDER BY created_at',
      [accountId],
    )
  ).rows.map(({ id }) => id);
  const notificationIds = (
    await pool.query<{ id: string }>(
      'SELECT id FROM billing_notifications WHERE account_id=$1 ORDER BY created_at',
      [accountId],
    )
  ).rows.map(({ id }) => id);
  const attemptedMeters: string[] = [];
  const attemptedNotifications: string[] = [];
  const meterFailures = new Set([meterIds[0]!]);
  const emailFailures = new Set([notificationIds[0]!]);
  const providers = {
    meterDeliveryConfigured: () => true,
    emailConfigured: () => true,
    sendMeterReport: async ({ id }: { id: string }) => {
      attemptedMeters.push(id);
      if (meterFailures.delete(id)) throw new Error('synthetic Stripe outage');
    },
    sendBillingEmail: async ({ idempotencyKey }: { idempotencyKey: string }) => {
      const id = idempotencyKey.replace('billing-notification/', '');
      attemptedNotifications.push(id);
      if (emailFailures.delete(id)) throw new Error('synthetic Resend outage');
    },
  };

  await drainOutboxes(providers);
  expect(attemptedMeters).toHaveLength(100);
  expect(new Set(attemptedMeters).size).toBe(100);
  expect(attemptedMeters).toContain(meterIds[0]);
  expect(new Set(attemptedNotifications)).toEqual(new Set(notificationIds));
  let meterState = await pool.query<{ attempted: string; reported: string }>(
    `SELECT count(*) FILTER (WHERE first_attempt_at IS NOT NULL)::text AS attempted,
            count(*) FILTER (WHERE reported_at IS NOT NULL)::text AS reported
       FROM billing_meter_reports WHERE account_id=$1`,
    [accountId],
  );
  expect(meterState.rows[0]).toEqual({ attempted: '100', reported: '99' });

  const successfulFirstBatch = new Set(attemptedMeters.filter((id) => id !== meterIds[0]));
  await drainOutboxes(providers);
  expect(attemptedMeters).toHaveLength(103);
  expect(attemptedMeters.slice(100)).toContain(meterIds[0]);
  expect(attemptedMeters.filter((id) => successfulFirstBatch.has(id))).toEqual(
    expect.arrayContaining([...successfulFirstBatch]),
  );
  expect(attemptedMeters.slice(100).some((id) => successfulFirstBatch.has(id))).toBe(false);
  expect(attemptedNotifications).toHaveLength(3);
  expect(attemptedNotifications.slice(2)).toContain(notificationIds[0]);
  meterState = await pool.query<{ attempted: string; reported: string }>(
    `SELECT count(*) FILTER (WHERE first_attempt_at IS NOT NULL)::text AS attempted,
            count(*) FILTER (WHERE reported_at IS NOT NULL)::text AS reported
       FROM billing_meter_reports WHERE account_id=$1`,
    [accountId],
  );
  expect(meterState.rows[0]).toEqual({ attempted: '102', reported: '102' });
  const notificationState = await pool.query<{ sent: string }>(
    'SELECT count(*) FILTER (WHERE sent_at IS NOT NULL)::text AS sent FROM billing_notifications WHERE account_id=$1',
    [accountId],
  );
  expect(notificationState.rows[0]?.sent).toBe('2');

  const expiredMeter = (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_meter_reports
         (account_id,period_start,stripe_customer_id,cents,first_attempt_at)
       VALUES ($1,$2,'cus_expired_fixture',1,now()-interval '24 hours') RETURNING id`,
      [accountId, periodStart],
    )
  ).rows[0]!.id;
  const expiredNotification = (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_notifications
         (account_id,period_start,threshold_cents,email,first_attempt_at)
       VALUES ($1,$2,3,'expired@example.test',now()-interval '25 hours') RETURNING id`,
      [accountId, periodStart],
    )
  ).rows[0]!.id;
  const meterAttemptsBeforePause = attemptedMeters.length;
  const emailAttemptsBeforePause = attemptedNotifications.length;
  await drainOutboxes(providers);
  expect(attemptedMeters).toHaveLength(meterAttemptsBeforePause);
  expect(attemptedNotifications).toHaveLength(emailAttemptsBeforePause);
  const paused = await pool.query<{ last_error: string }>(
    `SELECT last_error FROM billing_meter_reports WHERE id=$1
     UNION ALL
     SELECT last_error FROM billing_notifications WHERE id=$2`,
    [expiredMeter, expiredNotification],
  );
  expect(paused.rows).toHaveLength(2);
  expect(paused.rows.every(({ last_error }) => last_error.includes('idempotency window'))).toBe(
    true,
  );
});

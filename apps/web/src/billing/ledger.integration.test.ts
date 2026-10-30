import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getPool, withTransaction } from '../db/client';
import { billingState, billingSummary } from './ledger';
import { GIB } from './policy';

let accountId = '';
let agentId = '';
let driveId = '';
let fileId = '';

async function addVersions(count: number) {
  await getPool().query(
    `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     SELECT $1,$2,'objects/' || $3::text || '/' || gen_random_uuid()::text,$4,'synthetic-quota-metadata',$5
     FROM generate_series(1,$6::int)`,
    [fileId, driveId, accountId, (5n * GIB).toString(), agentId, count],
  );
}

beforeAll(async () => {
  for (const [name, value] of Object.entries({
    BILLING_DRIVE_MONTH_CENTS: '200',
    BILLING_STORAGE_GIB_MONTH_CENTS: '5',
    BILLING_EGRESS_GIB_CENTS: '15',
    BILLING_OPERATIONS_1000_CENTS: '1',
  }))
    vi.stubEnv(name, value);
  accountId = (
    await getPool().query<{ id: string }>('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `billing-math-${randomUUID()}`,
    ])
  ).rows[0]!.id;
  agentId = (
    await getPool().query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'billing-math-agent'],
    )
  ).rows[0]!.id;
  driveId = (
    await getPool().query<{ id: string }>(
      'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,$3) RETURNING id',
      [accountId, 'billing-math-drive', (2048n * GIB).toString()],
    )
  ).rows[0]!.id;
  fileId = (
    await getPool().query<{ id: string }>(
      'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
      [driveId, '/all-retained-versions'],
    )
  ).rows[0]!.id;
  await getPool().query(
    `INSERT INTO billing_accounts (account_id,plan,subscription_status,stripe_customer_id) VALUES ($1,'developer','active',$2)`,
    [accountId, `cus_synthetic_${randomUUID().replaceAll('-', '')}`],
  );
});

afterAll(async () => {
  if (accountId) {
    await getPool().query('DELETE FROM versions WHERE drive_id = $1', [driveId]);
    await getPool().query('DELETE FROM accounts WHERE id=$1', [accountId]);
  }
  vi.unstubAllEnvs();
});

it('meters retained versions exactly, preserves earned charges across tier changes, and freezes rates', async () => {
  await addVersions(21);
  let summary = await billingSummary(accountId);
  expect(summary.storageBytes).toBe((105n * GIB).toString());
  expect(summary.overageCents).toBe('25');
  expect(summary.totalCents).toBe('2025');
  await billingSummary(accountId);
  let reports = await getPool().query<{ cents: string }>(
    'SELECT sum(cents)::text AS cents FROM billing_meter_reports WHERE account_id=$1',
    [accountId],
  );
  expect(reports.rows[0]!.cents).toBe('25');

  await withTransaction(async (client) => {
    await billingState(client, accountId);
    await client.query("UPDATE billing_accounts SET plan='team' WHERE account_id=$1", [accountId]);
    await billingState(client, accountId);
  });
  summary = await billingSummary(accountId);
  expect(summary.overageCents).toBe('25');
  expect(summary.totalCents).toBe('20025');

  await addVersions(184);
  summary = await billingSummary(accountId);
  expect(summary.storageBytes).toBe((1025n * GIB).toString());
  expect(summary.overageCents).toBe('30');

  await withTransaction(async (client) => {
    await billingState(client, accountId);
    await client.query("UPDATE billing_accounts SET plan='developer' WHERE account_id=$1", [
      accountId,
    ]);
    await billingState(client, accountId);
  });
  vi.stubEnv('BILLING_STORAGE_GIB_MONTH_CENTS', '100');
  await addVersions(1);
  summary = await billingSummary(accountId);
  expect(summary.overageCents).toBe('55');
  expect(summary.totalCents).toBe('20055');
  expect(summary.rates?.storage).toBe('5');
  reports = await getPool().query<{ cents: string }>(
    'SELECT sum(cents)::text AS cents FROM billing_meter_reports WHERE account_id=$1',
    [accountId],
  );
  expect(reports.rows[0]!.cents).toBe('55');
});

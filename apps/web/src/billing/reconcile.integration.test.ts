import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  findCheckoutRecoverySession: vi.fn(),
  meterDeliveryConfigured: vi.fn(() => true),
  sendMeterReportWithResponse: vi.fn(),
}));

vi.mock('./providers', () => providerMocks);

import {
  attestMeterReportAccepted,
  inspectBillingReconciliation,
  inspectMeterReport,
  recoverCheckoutSession,
  replayMeterReport,
} from './reconcile';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive',
});
const fixtureAccounts: string[] = [];

async function createDeletingAccount() {
  const accountId = (
    await pool.query<{ id: string }>(
      `INSERT INTO accounts (name,deleting_at) VALUES ($1,now()) RETURNING id`,
      [`billing-reconcile-${randomUUID()}`],
    )
  ).rows[0]!.id;
  fixtureAccounts.push(accountId);
  return accountId;
}

async function createBlockedReport(accountId: string, expiredAttempt = false) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_meter_reports
         (account_id,period_start,stripe_customer_id,cents,created_at,first_attempt_at)
       VALUES ($1,date_trunc('month',now()),'cus_reconcile_fixture',55,now(),
               CASE WHEN $2::boolean THEN now()-interval '24 hours' ELSE NULL END)
       RETURNING id`,
      [accountId, expiredAttempt],
    )
  ).rows[0]!.id;
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterEach(() => vi.clearAllMocks());

afterAll(async () => {
  if (fixtureAccounts.length)
    await pool.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])', [fixtureAccounts]);
  await pool.end();
});

it('shows reported, retry-safe, and expired reports as different operator states', async () => {
  const accountId = await createDeletingAccount();
  const recent = await createBlockedReport(accountId);
  const expired = await createBlockedReport(accountId, true);
  await pool.query('UPDATE billing_meter_reports SET reported_at=now() WHERE id=$1', [recent]);

  const state = await inspectBillingReconciliation(accountId);
  expect(state.meterReports.map(({ id, status }) => ({ id, status }))).toEqual(
    expect.arrayContaining([
      { id: recent, status: 'reported' },
      { id: expired, status: 'unresolved' },
    ]),
  );
  expect(state.meterReports.find(({ id }) => id === expired)?.stripeTimestamp).toEqual(
    expect.any(Number),
  );
});

it('surfaces older unresolved reports after newer completed reports', async () => {
  const accountId = await createDeletingAccount();
  const older = (
    await pool.query<{ id: string }>(
      `INSERT INTO billing_meter_reports
         (account_id,period_start,stripe_customer_id,cents,created_at,first_attempt_at)
       VALUES ($1,date_trunc('month',now()),'cus_reconcile_fixture',55,
               now()-interval '60 days',now()-interval '61 days')
       RETURNING id`,
      [accountId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO billing_meter_reports
         (account_id,period_start,stripe_customer_id,cents,created_at,reported_at)
       SELECT $1,date_trunc('month',now()),'cus_reconcile_fixture',1,
              now()+(n*interval '1 millisecond'),now()
       FROM generate_series(1,100) AS n`,
    [accountId],
  );

  const listing = await inspectBillingReconciliation(accountId);
  expect(
    listing.meterReports.some(({ id, status }) => id === older && status === 'unresolved'),
  ).toBe(true);
  await expect(inspectMeterReport(older)).resolves.toMatchObject({
    id: older,
    status: 'unresolved',
  });
});

it('continues through every unresolved report in bounded pages', async () => {
  const accountId = await createDeletingAccount();
  await pool.query(
    `INSERT INTO billing_meter_reports
       (account_id,period_start,stripe_customer_id,cents,created_at)
     SELECT $1,date_trunc('month',now()),'cus_reconcile_fixture',1,
            now()-interval '60 days'-(n*interval '1 millisecond')
       FROM generate_series(1,205) AS n`,
    [accountId],
  );

  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await inspectBillingReconciliation(accountId, cursor);
    expect(page.meterReports.length).toBeLessThanOrEqual(100);
    seen.push(...page.meterReports.map((report) => report.id));
    cursor = page.nextCursor;
  } while (cursor);

  expect(seen).toHaveLength(205);
  expect(new Set(seen).size).toBe(205);
});

it('keeps an expired unverified report pending and records a verified operator attestation once', async () => {
  const accountId = await createDeletingAccount();
  const reportId = await createBlockedReport(accountId, true);
  const expectedReport = await inspectMeterReport(reportId);
  await expect(replayMeterReport(reportId, 'operator-fixture')).rejects.toThrow(
    'outside the 23-hour retry window',
  );
  expect(
    (
      await pool.query<{ reported_at: Date | null }>(
        'SELECT reported_at FROM billing_meter_reports WHERE id=$1',
        [reportId],
      )
    ).rows[0]!.reported_at,
  ).toBeNull();

  await expect(
    attestMeterReportAccepted(reportId, 'req_reconcilefixture', 'operator-fixture'),
  ).resolves.toMatchObject({ status: 'operator-confirmed-accepted' });
  await expect(
    attestMeterReportAccepted(reportId, 'req_reconcilefixture', 'operator-fixture'),
  ).resolves.toMatchObject({ status: 'already-reported' });
  const resolved = await pool.query<{
    reported_at: Date | null;
    action: string;
    operator_id: string;
    external_reference: string;
    evidence: { verification: string; cents: string };
  }>(
    `SELECT r.reported_at,e.action,e.operator_id,e.external_reference,e.evidence
       FROM billing_meter_reports r
       JOIN billing_reconciliation_events e ON e.meter_report_id=r.id
      WHERE r.id=$1`,
    [reportId],
  );
  expect(resolved.rows).toHaveLength(1);
  expect(resolved.rows[0]).toMatchObject({
    action: 'meter_operator_confirmed_accepted',
    operator_id: 'operator-fixture',
    external_reference: 'req_reconcilefixture',
    evidence: {
      verification: 'operator-attested-stripe-request-log-success',
      reportId,
      customerId: 'cus_reconcile_fixture',
      cents: '55',
      stripeTimestamp: expectedReport?.stripeTimestamp,
    },
  });
  expect(resolved.rows[0]?.reported_at).toBeInstanceOf(Date);
});

it('rejects a Stripe request ID already attested for another report without unblocking the second', async () => {
  const firstAccount = await createDeletingAccount();
  const secondAccount = await createDeletingAccount();
  const firstReport = await createBlockedReport(firstAccount, true);
  const secondReport = await createBlockedReport(secondAccount, true);
  await attestMeterReportAccepted(firstReport, 'req_sharedfixture', 'operator-fixture');

  await expect(
    attestMeterReportAccepted(secondReport, 'req_sharedfixture', 'operator-fixture'),
  ).rejects.toThrow('billing_reconciliation_events_external_reference_unique');
  const second = await pool.query<{ reported_at: Date | null; audit_events: string }>(
    `SELECT r.reported_at,
            (SELECT count(*)::text FROM billing_reconciliation_events e WHERE e.meter_report_id=r.id) AS audit_events
       FROM billing_meter_reports r WHERE r.id=$1`,
    [secondReport],
  );
  expect(second.rows[0]).toEqual({ reported_at: null, audit_events: '0' });
});

it('replays a report with its original UUID and commits provider success plus audit atomically', async () => {
  const accountId = await createDeletingAccount();
  const reportId = await createBlockedReport(accountId);
  providerMocks.sendMeterReportWithResponse.mockRejectedValueOnce(new Error('synthetic outage'));
  await expect(replayMeterReport(reportId, 'operator-fixture')).rejects.toThrow(
    'Stripe did not confirm the meter report',
  );
  const failed = await pool.query<{
    reported_at: Date | null;
    lease_until: Date | null;
    last_error: string | null;
  }>('SELECT reported_at,lease_until,last_error FROM billing_meter_reports WHERE id=$1', [
    reportId,
  ]);
  expect(failed.rows[0]).toMatchObject({
    reported_at: null,
    lease_until: null,
    last_error: 'Operator replay did not receive a successful Stripe response.',
  });

  let signalProviderEntry!: () => void;
  let releaseProviderResponse!: (response: { lastResponse: { requestId: string } }) => void;
  const providerEntered = new Promise<void>((resolve) => {
    signalProviderEntry = resolve;
  });
  const providerResponse = new Promise<{ lastResponse: { requestId: string } }>((resolve) => {
    releaseProviderResponse = resolve;
  });
  providerMocks.sendMeterReportWithResponse.mockImplementationOnce(() => {
    signalProviderEntry();
    return providerResponse;
  });

  const primary = replayMeterReport(reportId, 'operator-fixture');
  try {
    await providerEntered;
    const providerDispatches = providerMocks.sendMeterReportWithResponse.mock.calls.length;
    await expect(replayMeterReport(reportId, 'operator-fixture')).rejects.toThrow(
      'Another billing worker currently holds this report lease.',
    );
    expect(providerMocks.sendMeterReportWithResponse).toHaveBeenCalledTimes(providerDispatches);
  } finally {
    releaseProviderResponse({ lastResponse: { requestId: 'req_providerfixture' } });
  }

  await expect(primary).resolves.toMatchObject({ status: 'replayed', reportId });
  expect(providerMocks.sendMeterReportWithResponse).toHaveBeenCalledTimes(2);
  expect(providerMocks.sendMeterReportWithResponse).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: reportId, customer: 'cus_reconcile_fixture', cents: '55' }),
  );
  await expect(replayMeterReport(reportId, 'operator-fixture')).resolves.toMatchObject({
    status: 'already-reported',
  });
  expect(providerMocks.sendMeterReportWithResponse).toHaveBeenCalledTimes(2);
  const audit = await pool.query<{ action: string; external_reference: string }>(
    'SELECT action,external_reference FROM billing_reconciliation_events WHERE meter_report_id=$1',
    [reportId],
  );
  expect(audit.rows).toEqual([
    { action: 'meter_report_replayed', external_reference: 'req_providerfixture' },
  ]);
});

it('does not claim a report until local Stripe metering configuration is usable', async () => {
  const accountId = await createDeletingAccount();
  const reportId = await createBlockedReport(accountId);
  providerMocks.meterDeliveryConfigured.mockReturnValueOnce(false);

  await expect(replayMeterReport(reportId, 'operator-fixture')).rejects.toThrow();
  const untouched = await pool.query<{
    first_attempt_at: Date | null;
    lease_until: Date | null;
  }>('SELECT first_attempt_at,lease_until FROM billing_meter_reports WHERE id=$1', [reportId]);
  expect(untouched.rows[0]).toEqual({ first_attempt_at: null, lease_until: null });
  expect(providerMocks.sendMeterReportWithResponse).not.toHaveBeenCalled();

  providerMocks.sendMeterReportWithResponse.mockResolvedValueOnce({
    lastResponse: { requestId: 'req_configuredfixture' },
  });
  await expect(replayMeterReport(reportId, 'operator-fixture')).resolves.toMatchObject({
    status: 'replayed',
    reportId,
  });

  providerMocks.meterDeliveryConfigured.mockReturnValueOnce(false);
  await expect(replayMeterReport(reportId, 'operator-fixture')).resolves.toMatchObject({
    status: 'already-reported',
  });

  const priorAttemptReportId = await createBlockedReport(accountId);
  await pool.query(
    "UPDATE billing_meter_reports SET first_attempt_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
    [priorAttemptReportId],
  );
  const beforeRetry = await pool.query<{ first_attempt_at: Date }>(
    'SELECT first_attempt_at FROM billing_meter_reports WHERE id=$1',
    [priorAttemptReportId],
  );
  providerMocks.meterDeliveryConfigured.mockReturnValueOnce(false);
  await expect(replayMeterReport(priorAttemptReportId, 'operator-fixture')).rejects.toThrow(
    'Stripe metering is not configured',
  );
  const afterRetry = await pool.query<{
    first_attempt_at: Date | null;
    lease_until: Date | null;
  }>('SELECT first_attempt_at,lease_until FROM billing_meter_reports WHERE id=$1', [
    priorAttemptReportId,
  ]);
  expect(afterRetry.rows[0]).toEqual({
    first_attempt_at: beforeRetry.rows[0]!.first_attempt_at,
    lease_until: null,
  });
});

it('recovers only a provider matched checkout and serializes racing operators', async () => {
  const accountId = await createDeletingAccount();
  const key = `checkout/v3/${accountId}/developer/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  const customerId = `cus_reconcile_${accountId.replaceAll('-', '')}`;
  const reservedAt = new Date();
  await pool.query(
    `INSERT INTO billing_accounts
       (account_id,plan,stripe_customer_id,checkout_idempotency_key,checkout_created_at)
       VALUES ($1,'free',$4,$2,$3)`,
    [accountId, key, reservedAt, customerId],
  );
  providerMocks.findCheckoutRecoverySession.mockResolvedValue({
    id: 'cs_reconcile_fixture',
    customer: customerId,
    client_reference_id: accountId,
    status: 'open',
    livemode: false,
    created: Math.floor(reservedAt.getTime() / 1000),
  });

  const results = await Promise.allSettled([
    recoverCheckoutSession(accountId, 'operator-fixture'),
    recoverCheckoutSession(accountId, 'operator-fixture'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(providerMocks.findCheckoutRecoverySession).toHaveBeenCalledWith(
    expect.objectContaining({ plan: 'developer' }),
  );
  const recovered = await pool.query<{
    checkout_session_id: string | null;
    action: string;
    external_reference: string;
  }>(
    `SELECT b.checkout_session_id,e.action,e.external_reference
       FROM billing_accounts b JOIN billing_reconciliation_events e
         ON e.account_id=b.account_id AND e.checkout_idempotency_key=b.checkout_idempotency_key
      WHERE b.account_id=$1`,
    [accountId],
  );
  expect(recovered.rows).toEqual([
    {
      checkout_session_id: 'cs_reconcile_fixture',
      action: 'checkout_session_recovered',
      external_reference: 'cs_reconcile_fixture',
    },
  ]);
});

it('keeps a malformed checkout reservation blocked without querying Stripe', async () => {
  const accountId = await createDeletingAccount();
  const key = `checkout/v4/${accountId}/free/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  const customerId = `cus_reconcile_${accountId.replaceAll('-', '')}`;
  await pool.query(
    `INSERT INTO billing_accounts
       (account_id,plan,stripe_customer_id,checkout_idempotency_key,checkout_created_at)
     VALUES ($1,'free',$2,$3,now())`,
    [accountId, customerId, key],
  );

  await expect(recoverCheckoutSession(accountId, 'operator-fixture')).rejects.toThrow(
    'malformed or unsupported',
  );
  expect(providerMocks.findCheckoutRecoverySession).not.toHaveBeenCalled();
  expect(
    (
      await pool.query<{ checkout_session_id: string | null }>(
        'SELECT checkout_session_id FROM billing_accounts WHERE account_id=$1',
        [accountId],
      )
    ).rows[0],
  ).toEqual({ checkout_session_id: null });
});

it('leaves an ambiguous checkout reservation unchanged and without a recovery audit', async () => {
  const accountId = await createDeletingAccount();
  const key = `checkout/v3/${accountId}/developer/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
  const customerId = `cus_reconcile_${accountId.replaceAll('-', '')}`;
  await pool.query(
    `INSERT INTO billing_accounts
       (account_id,plan,stripe_customer_id,checkout_idempotency_key,checkout_created_at)
     VALUES ($1,'developer',$3,$2,now())`,
    [accountId, key, customerId],
  );
  providerMocks.findCheckoutRecoverySession.mockResolvedValue(null);

  await expect(recoverCheckoutSession(accountId, 'operator-fixture')).rejects.toThrow(
    'zero or multiple matching sessions',
  );
  const state = await pool.query<{ checkout_session_id: string | null; events: string }>(
    `SELECT b.checkout_session_id,
            (SELECT count(*)::text FROM billing_reconciliation_events e WHERE e.account_id=b.account_id) AS events
       FROM billing_accounts b WHERE b.account_id=$1`,
    [accountId],
  );
  expect(state.rows[0]).toEqual({ checkout_session_id: null, events: '0' });
});

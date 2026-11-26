import type Stripe from 'stripe';
import { getPool, withTransaction } from '../db/client';
import { findCheckoutRecoverySession, sendMeterReportWithResponse } from './providers';
import { classifyMeterDelivery } from './reconcile-policy';

export { classifyMeterDelivery, uniqueCheckoutSession } from './reconcile-policy';
export type {
  CheckoutCandidate,
  CheckoutExpectation,
  CheckoutLineItem,
  MeterDeliveryRow,
  MeterDeliveryStatus,
} from './reconcile-policy';

type PendingReport = {
  id: string;
  account_id: string;
  stripe_customer_id: string;
  cents: string;
  created_at: Date;
  first_attempt_at: Date | null;
  lease_until: Date | null;
  reported_at: Date | null;
  period_start: Date;
  deleting_at: Date | null;
};

function requireOperator(value: string | undefined) {
  const operator = value?.trim();
  if (!operator || operator.length > 120 || /[\r\n\0]/u.test(operator)) {
    throw new Error(
      'Set BILLING_OPERATOR_ID to the approved operator identifier before applying changes.',
    );
  }
  return operator;
}

function requireReportId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    throw new Error('A valid meter report UUID is required.');
}

function meterTimestamp(report: Pick<PendingReport, 'created_at'>, periodStart: Date) {
  return Math.min(
    Math.floor(report.created_at.getTime() / 1000),
    Math.floor(
      (Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1) - 1000) / 1000,
    ),
  );
}

function presentMeterReport(row: PendingReport) {
  const status = classifyMeterDelivery(row);
  return {
    id: row.id,
    accountId: row.account_id,
    stripeCustomerId: row.stripe_customer_id,
    cents: row.cents,
    createdAt: row.created_at,
    stripeTimestamp: meterTimestamp(row, row.period_start),
    firstAttemptAt: row.first_attempt_at,
    deleting: !!row.deleting_at,
    status,
    reason:
      status === 'unresolved'
        ? 'Stripe has no API to retrieve a meter event by its report identifier. Verify the exact UUID, customer, cents, and timestamp in Stripe request logs before using the operator attestation command.'
        : undefined,
  };
}

export async function inspectBillingReconciliation(accountId?: string) {
  const reports = await getPool().query<PendingReport>(
    `SELECT r.id,r.account_id,r.stripe_customer_id,r.cents::text,r.created_at,r.period_start,
            r.first_attempt_at,r.lease_until,r.reported_at,a.deleting_at
       FROM billing_meter_reports r JOIN accounts a ON a.id=r.account_id
      WHERE ($1::uuid IS NULL OR r.account_id=$1)
        AND a.deleting_at IS NOT NULL
      ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,
    [accountId ?? null],
  );
  const checkouts = await getPool().query<{
    account_id: string;
    stripe_customer_id: string | null;
    checkout_idempotency_key: string;
    checkout_created_at: Date | null;
    deleting_at: Date | null;
  }>(
    `SELECT b.account_id,b.stripe_customer_id,b.checkout_idempotency_key,
            b.checkout_created_at,a.deleting_at
       FROM billing_accounts b JOIN accounts a ON a.id=b.account_id
      WHERE b.checkout_idempotency_key IS NOT NULL AND b.checkout_session_id IS NULL
        AND a.deleting_at IS NOT NULL
        AND ($1::uuid IS NULL OR b.account_id=$1)
      ORDER BY b.checkout_created_at,b.account_id`,
    [accountId ?? null],
  );
  return {
    meterReports: reports.rows.map(presentMeterReport),
    checkouts: checkouts.rows.map((row) => ({
      accountId: row.account_id,
      stripeCustomerId: row.stripe_customer_id,
      idempotencyKey: row.checkout_idempotency_key,
      reservedAt: row.checkout_created_at,
      deleting: !!row.deleting_at,
      status: 'unresolved' as const,
      reason:
        'A checkout reservation has no stored session. Recovery requires one unique Stripe session matching account, customer, plan prices, mode, and reservation time; zero or multiple matches remain blocked.',
    })),
  };
}

export async function inspectMeterReport(reportId: string) {
  requireReportId(reportId);
  const result = await getPool().query<PendingReport>(
    `SELECT r.id,r.account_id,r.stripe_customer_id,r.cents::text,r.created_at,r.period_start,
            r.first_attempt_at,r.lease_until,r.reported_at,a.deleting_at
       FROM billing_meter_reports r JOIN accounts a ON a.id=r.account_id
      WHERE r.id=$1`,
    [reportId],
  );
  const row = result.rows[0];
  return row ? presentMeterReport(row) : null;
}

export async function replayMeterReport(reportId: string, operatorId: string) {
  requireReportId(reportId);
  const operator = requireOperator(operatorId);
  const claim = await withTransaction(async (client) => {
    const result = await client.query<PendingReport & { period_start: Date }>(
      `SELECT r.id,r.account_id,r.stripe_customer_id,r.cents::text,r.created_at,
              r.first_attempt_at,r.lease_until,r.reported_at,r.period_start,a.deleting_at
         FROM billing_meter_reports r JOIN accounts a ON a.id=r.account_id
        WHERE r.id=$1 FOR UPDATE OF r`,
      [reportId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('The meter report does not exist.');
    if (!row.deleting_at)
      throw new Error('Meter report replay is restricted to reports blocking account erasure.');
    if (row.reported_at) return null;
    if (row.lease_until && row.lease_until.getTime() > Date.now())
      throw new Error('Another billing worker currently holds this report lease.');
    if (classifyMeterDelivery(row) === 'unresolved')
      throw new Error(
        'This report is outside the 23-hour retry window. Verify the Stripe request log and use the operator attestation path if it proves acceptance.',
      );
    const lease = await client.query<{ lease_until: string }>(
      `UPDATE billing_meter_reports
          SET first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),
              lease_until=clock_timestamp()+interval '1 hour'
        WHERE id=$1 AND reported_at IS NULL
          AND (lease_until IS NULL OR lease_until < clock_timestamp())
          AND (first_attempt_at IS NULL OR first_attempt_at > clock_timestamp()-interval '23 hours')
        RETURNING lease_until::text AS lease_until`,
      [reportId],
    );
    if (!lease.rowCount)
      throw new Error('The report changed while it was being claimed; inspect it again.');
    return { ...row, leaseUntil: lease.rows[0]!.lease_until };
  });
  if (!claim) return { status: 'already-reported' as const };

  let response: Stripe.Response<Stripe.Billing.MeterEvent>;
  try {
    response = await sendMeterReportWithResponse({
      id: claim.id,
      customer: claim.stripe_customer_id,
      cents: claim.cents,
      timestamp: meterTimestamp(claim, claim.period_start),
    });
  } catch {
    await getPool().query(
      `UPDATE billing_meter_reports SET lease_until=NULL,
              last_error='Operator replay did not receive a successful Stripe response.'
        WHERE id=$1 AND lease_until=$2::timestamptz AND reported_at IS NULL`,
      [claim.id, claim.leaseUntil],
    );
    throw new Error(
      'Stripe did not confirm the meter report. The report remains pending; inspect it before retrying.',
    );
  }

  const requestId = response.lastResponse?.requestId ?? null;
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE billing_meter_reports
          SET reported_at=clock_timestamp(),lease_until=NULL,last_error=NULL
        WHERE id=$1 AND lease_until=$2::timestamptz AND reported_at IS NULL
        RETURNING account_id`,
      [claim.id, claim.leaseUntil],
    );
    if (!result.rowCount)
      throw new Error(
        'Stripe accepted the report, but its lease changed before the database update. Keep erasure blocked and inspect the Stripe request log.',
      );
    await client.query(
      `INSERT INTO billing_reconciliation_events
         (account_id,meter_report_id,action,operator_id,external_reference,evidence)
       VALUES ($1,$2,'meter_report_replayed',$3,$4,$5::jsonb)`,
      [
        claim.account_id,
        claim.id,
        operator,
        requestId ?? `meter-event:${claim.id}`,
        JSON.stringify({
          verification: 'stripe-api-success-response',
          stripeRequestId: requestId,
          meterEventIdentifier: claim.id,
          customerId: claim.stripe_customer_id,
          cents: claim.cents,
          timestamp: meterTimestamp(claim, claim.period_start),
        }),
      ],
    );
  });
  return { status: 'replayed' as const, reportId, requestId };
}

export async function attestMeterReportAccepted(
  reportId: string,
  providerRequestId: string,
  operatorId: string,
) {
  requireReportId(reportId);
  const operator = requireOperator(operatorId);
  if (!/^req_[A-Za-z0-9]+$/u.test(providerRequestId))
    throw new Error('A Stripe request log ID in req_… format is required.');
  return withTransaction(async (client) => {
    const result = await client.query<PendingReport>(
      `SELECT r.id,r.account_id,r.stripe_customer_id,r.cents::text,r.created_at,r.period_start,
              r.first_attempt_at,r.lease_until,r.reported_at,a.deleting_at
         FROM billing_meter_reports r JOIN accounts a ON a.id=r.account_id
        WHERE r.id=$1 FOR UPDATE OF r`,
      [reportId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('The meter report does not exist.');
    if (!row.deleting_at)
      throw new Error(
        'Operator delivery attestation is restricted to reports blocking account erasure.',
      );
    if (classifyMeterDelivery(row) === 'reported') return { status: 'already-reported' as const };
    if (classifyMeterDelivery(row) !== 'unresolved')
      throw new Error(
        'Only reports paused beyond the 23-hour retry window can use operator settlement attestation.',
      );
    const update = await client.query(
      `UPDATE billing_meter_reports SET reported_at=clock_timestamp(),lease_until=NULL,last_error=NULL
        WHERE id=$1 AND reported_at IS NULL
          AND (lease_until IS NULL OR lease_until < clock_timestamp())
          AND first_attempt_at <= clock_timestamp()-interval '23 hours'`,
      [reportId],
    );
    if (!update.rowCount)
      throw new Error('The report changed while it was being resolved; inspect it again.');
    await client.query(
      `INSERT INTO billing_reconciliation_events
         (account_id,meter_report_id,action,operator_id,external_reference,evidence)
       VALUES ($1,$2,'meter_operator_confirmed_accepted',$3,$4,$5::jsonb)`,
      [
        row.account_id,
        row.id,
        operator,
        providerRequestId,
        JSON.stringify({
          verification: 'operator-attested-stripe-request-log-success',
          providerRequestId,
          reportId: row.id,
          customerId: row.stripe_customer_id,
          cents: row.cents,
          createdAt: row.created_at.toISOString(),
          stripeTimestamp: meterTimestamp(row, row.period_start),
        }),
      ],
    );
    return { status: 'operator-confirmed-accepted' as const, reportId, providerRequestId };
  });
}

export async function recoverCheckoutSession(accountId: string, operatorId: string) {
  const operator = requireOperator(operatorId);
  const current = await getPool().query<{
    stripe_customer_id: string | null;
    checkout_idempotency_key: string | null;
    checkout_created_at: Date | null;
    plan: 'developer' | 'team' | string;
    checkout_session_id: string | null;
    deleting_at: Date | null;
  }>(
    `SELECT b.stripe_customer_id,b.checkout_idempotency_key,b.checkout_created_at,b.plan,
            b.checkout_session_id,a.deleting_at
       FROM billing_accounts b JOIN accounts a ON a.id=b.account_id
      WHERE b.account_id=$1`,
    [accountId],
  );
  const row = current.rows[0];
  if (!row?.checkout_idempotency_key || row.checkout_session_id)
    throw new Error('No unresolved checkout reservation exists for this account.');
  if (!row.deleting_at)
    throw new Error('Checkout recovery is restricted to reservations blocking account erasure.');
  if (!row.stripe_customer_id || !row.checkout_created_at)
    throw new Error(
      'The checkout reservation lacks a customer or creation time; leave erasure blocked for manual investigation.',
    );
  const recovered = await findCheckoutRecoverySession({
    accountId,
    customerId: row.stripe_customer_id,
    plan: row.plan,
    reservedAt: row.checkout_created_at,
    idempotencyKey: row.checkout_idempotency_key,
  });
  if (!recovered)
    throw new Error(
      'Stripe returned zero or multiple matching sessions. No database state changed; keep erasure blocked and inspect Stripe Checkout Sessions for this account and reservation time.',
    );

  await withTransaction(async (client) => {
    const account = await client.query(
      'SELECT id FROM accounts WHERE id=$1 AND deleting_at IS NOT NULL FOR UPDATE',
      [accountId],
    );
    if (!account.rowCount)
      throw new Error(
        'Account erasure stopped before checkout recovery; inspect the account state.',
      );
    const locked = await client.query<{
      stripe_customer_id: string | null;
      checkout_idempotency_key: string | null;
      checkout_session_id: string | null;
    }>(
      `SELECT stripe_customer_id,checkout_idempotency_key,checkout_session_id
         FROM billing_accounts WHERE account_id=$1 FOR UPDATE`,
      [accountId],
    );
    const billing = locked.rows[0];
    if (
      !billing ||
      billing.checkout_idempotency_key !== row.checkout_idempotency_key ||
      billing.stripe_customer_id !== row.stripe_customer_id ||
      billing.checkout_session_id
    )
      throw new Error(
        'The checkout reservation changed during Stripe verification; inspect it again.',
      );
    await client.query(
      `UPDATE billing_accounts SET checkout_session_id=$3
        WHERE account_id=$1 AND checkout_idempotency_key=$2 AND checkout_session_id IS NULL`,
      [accountId, row.checkout_idempotency_key, recovered.id],
    );
    await client.query(
      `INSERT INTO billing_reconciliation_events
         (account_id,checkout_idempotency_key,action,operator_id,external_reference,evidence)
       VALUES ($1,$2,'checkout_session_recovered',$3,$4,$5::jsonb)`,
      [
        accountId,
        row.checkout_idempotency_key,
        operator,
        recovered.id,
        JSON.stringify({
          verification: 'provider-session-unique-match',
          sessionId: recovered.id,
          status: recovered.status,
          customerId: recovered.customer,
          clientReferenceId: recovered.client_reference_id,
          liveMode: recovered.livemode,
          created: recovered.created,
          planPriceId:
            row.plan === 'developer'
              ? process.env.STRIPE_DEVELOPER_PRICE_ID
              : process.env.STRIPE_TEAM_PRICE_ID,
          usagePriceId: process.env.STRIPE_USAGE_PRICE_ID,
        }),
      ],
    );
  });
  return {
    status: 'session-recovered' as const,
    accountId,
    sessionId: recovered.id,
    sessionStatus: recovered.status,
  };
}

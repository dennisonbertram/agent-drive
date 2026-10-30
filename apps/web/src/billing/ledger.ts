import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, withTransaction } from '../db/client';
import { ApiError } from '../api/errors';
import {
  accruedOverage,
  billingRates,
  monthBounds,
  paymentRequired,
  PLANS,
  quoteUsage,
  type PlanName,
  type Usage,
  type Rates,
} from './policy';

type BillingAccount = {
  account_id: string;
  plan: PlanName;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  stripe_event_created: string;
  spend_cap_cents: string | null;
  alert_threshold_cents: string | null;
  alert_email: string | null;
};
type BillingPeriod = {
  account_id: string;
  period_start: Date;
  peak_drives: string;
  peak_storage_bytes: string;
  authorized_egress_bytes: string;
  plan: PlanName;
  baseline_cents: string;
  earned_cents: string;
  base_cents: string;
  rates: Record<keyof Rates, string> | null;
};
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const encodeRates = (rates: Rates | null) =>
  rates
    ? JSON.stringify(
        Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, value.toString()])),
      )
    : null;
const decodeRates = (rates: BillingPeriod['rates']): Rates | null =>
  rates
    ? {
        drive: BigInt(rates.drive),
        storage: BigInt(rates.storage),
        egress: BigInt(rates.egress),
        operations: BigInt(rates.operations),
      }
    : null;

export async function lockBillingAccount(client: PoolClient, accountId: string) {
  const exists = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
    accountId,
  ]);
  if (!exists.rowCount) throw new ApiError('not_found', 'Account not found.');
  await client.query(
    'INSERT INTO billing_accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [accountId],
  );
  const result = await client.query<BillingAccount>(
    'SELECT * FROM billing_accounts WHERE account_id = $1 FOR UPDATE',
    [accountId],
  );
  return result.rows[0]!;
}

export async function billingState(client: PoolClient, accountId: string, periodStart?: Date) {
  const account = await lockBillingAccount(client, accountId);
  const clock = await client.query<{ now: Date }>('SELECT now() AS now');
  const { start, end } = monthBounds(periodStart ?? clock.rows[0]!.now);
  const currentMonth = monthBounds(clock.rows[0]!.now).start.getTime() === start.getTime();
  const current = await client.query<{
    drives: string;
    storage: string;
    operations: string;
    pending_operations: string;
    egress: string;
  }>(
    `SELECT (SELECT count(*) FROM drives WHERE account_id = $1 AND created_at < $3)::text AS drives,
       (SELECT COALESCE(sum(v.ciphertext_size),0) FROM versions v JOIN drives d ON d.id = v.drive_id WHERE d.account_id = $1 AND v.created_at < $3)::text AS storage,
       (SELECT count(*) FROM audit_events WHERE account_id = $1 AND created_at >= $2 AND created_at < $3 AND outcome = 'success')::text AS operations,
       (SELECT count(*) FROM audit_events WHERE account_id = $1 AND created_at >= $2 AND created_at < $3 AND outcome = 'pending')::text AS pending_operations,
       (SELECT COALESCE(sum(bytes_sent),0) FROM billing_egress_events WHERE account_id = $1 AND occurred_at >= $2 AND occurred_at < $3)::text AS egress`,
    [accountId, start, end],
  );
  const row = current.rows[0]!;
  const usage: Usage = {
    drives: BigInt(row.drives),
    storageBytes: BigInt(row.storage),
    operations: BigInt(row.operations),
    egressBytes: BigInt(row.egress),
  };
  const period = await client.query<BillingPeriod>(
    `INSERT INTO billing_periods (account_id, period_start, peak_drives, peak_storage_bytes, plan, rates, base_cents)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (account_id, period_start) DO UPDATE
       SET peak_drives = GREATEST(billing_periods.peak_drives, EXCLUDED.peak_drives),
           peak_storage_bytes = GREATEST(billing_periods.peak_storage_bytes, EXCLUDED.peak_storage_bytes)
     RETURNING *`,
    [
      accountId,
      start,
      usage.drives.toString(),
      usage.storageBytes.toString(),
      account.plan,
      encodeRates(billingRates()),
      PLANS[account.plan].baseCents,
    ],
  );
  let periodRow = period.rows[0]!;
  if (currentMonth && periodRow.plan !== account.plan) {
    const peak = {
      ...usage,
      drives: BigInt(periodRow.peak_drives),
      storageBytes: BigInt(periodRow.peak_storage_bytes),
    };
    const earned = accruedOverage(
      quoteUsage(periodRow.plan, peak, decodeRates(periodRow.rates)).overageCents,
      BigInt(periodRow.baseline_cents),
      BigInt(periodRow.earned_cents),
    );
    const rates = billingRates();
    const baseline = quoteUsage(account.plan, peak, rates).overageCents;
    const changed = await client.query<BillingPeriod>(
      `UPDATE billing_periods SET plan = $3, rates = $4::jsonb, earned_cents = $5, baseline_cents = $6,
        base_cents = GREATEST(base_cents,$7) WHERE account_id = $1 AND period_start = $2 RETURNING *`,
      [
        accountId,
        start,
        account.plan,
        encodeRates(rates),
        earned.toString(),
        baseline.toString(),
        PLANS[account.plan].baseCents,
      ],
    );
    periodRow = changed.rows[0]!;
  }
  return {
    account: { ...account, plan: periodRow.plan },
    period: periodRow,
    current: usage,
    pendingOperations: BigInt(row.pending_operations),
    start,
    end,
    rates: decodeRates(periodRow.rates),
  };
}
export type BillingState = Awaited<ReturnType<typeof billingState>>;

function peakUsage(state: BillingState): Usage {
  return {
    ...state.current,
    drives: BigInt(state.period.peak_drives),
    storageBytes: BigInt(state.period.peak_storage_bytes),
  };
}

export function quoteState(state: BillingState, usage = peakUsage(state)) {
  const quote = quoteUsage(state.account.plan, usage, state.rates);
  const overageCents = accruedOverage(
    quote.overageCents,
    BigInt(state.period.baseline_cents),
    BigInt(state.period.earned_cents),
  );
  return { ...quote, overageCents, totalCents: BigInt(state.period.base_cents) + overageCents };
}

// Call while holding the account lock, before any intent/drive/file locks; the caller's
// transaction must also contain the mutation so concurrent drives cannot overspend.
export async function enforceWriteBudget(
  client: PoolClient,
  accountId: string,
  options: {
    bytes?: bigint;
    drives?: bigint;
    excludeIntentId?: string;
    reserveOnly?: boolean;
  } = {},
) {
  const state = await billingState(client, accountId);
  const pending = await client.query<{ bytes: string }>(
    `SELECT COALESCE(sum(ciphertext_size),0)::text AS bytes FROM upload_intents
     WHERE account_id = $1 AND committed_version_id IS NULL AND expires_at > now()
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [accountId, options.excludeIntentId ?? null],
  );
  const stored = state.current.storageBytes + (options.bytes ?? 0n);
  const projected: Usage = {
    drives: max(BigInt(state.period.peak_drives), state.current.drives + (options.drives ?? 0n)),
    storageBytes: max(
      BigInt(state.period.peak_storage_bytes),
      stored + BigInt(pending.rows[0]!.bytes),
    ),
    operations: state.current.operations + max(1n, state.pendingOperations),
    egressBytes: state.current.egressBytes,
  };
  const rates = state.rates;
  const quote = quoteState(state, projected);
  const allowanceUsage = {
    ...projected,
    drives: state.current.drives + (options.drives ?? 0n),
    storageBytes: stored + BigInt(pending.rows[0]!.bytes),
  };
  if (
    quoteUsage(state.account.plan, allowanceUsage, rates).overLimit &&
    (state.account.plan === 'free' || !rates)
  ) {
    paymentRequired(
      'Your plan allowance would be exceeded. Upgrade or enable configured overage billing.',
    );
  }
  if (
    state.account.subscription_status &&
    !['active', 'trialing', 'canceled', 'incomplete_expired'].includes(
      state.account.subscription_status,
    )
  ) {
    paymentRequired('Your subscription needs attention before new writes can be accepted.');
  }
  if (
    state.account.plan !== 'free' &&
    !['active', 'trialing'].includes(state.account.subscription_status ?? '')
  ) {
    paymentRequired('Your subscription needs attention before new writes can be accepted.');
  }
  if (
    state.account.spend_cap_cents !== null &&
    (quoteState(state).totalCents >= BigInt(state.account.spend_cap_cents) ||
      quote.totalCents > BigInt(state.account.spend_cap_cents))
  ) {
    paymentRequired(
      'Your monthly write spend cap has been reached. Existing files remain readable.',
    );
  }
  if (!options.reserveOnly) {
    await client.query(
      `UPDATE billing_periods SET peak_drives = GREATEST(peak_drives,$3), peak_storage_bytes = GREATEST(peak_storage_bytes,$4)
       WHERE account_id = $1 AND period_start = $2`,
      [accountId, state.start, projected.drives.toString(), stored.toString()],
    );
  }
  return state;
}

export async function authorizeDownload(
  accountId: string,
  bytes: bigint,
  sign: () => Promise<string>,
) {
  return withTransaction(async (client) => {
    const state = await billingState(client, accountId);
    const authorized = BigInt(state.period.authorized_egress_bytes) + bytes;
    if (
      authorized > PLANS[state.account.plan].egressBytes &&
      (state.account.plan === 'free' ||
        !state.rates ||
        !['active', 'trialing'].includes(state.account.subscription_status ?? ''))
    ) {
      paymentRequired('Your monthly download allowance has been reached.');
    }
    const url = await sign();
    await client.query(
      'UPDATE billing_periods SET authorized_egress_bytes = $3 WHERE account_id = $1 AND period_start = $2',
      [accountId, state.start, authorized.toString()],
    );
    return url;
  });
}

export async function enforceOperationBudget(client: PoolClient, accountId: string) {
  const state = await billingState(client, accountId);
  if (
    state.current.operations + state.pendingOperations >= PLANS[state.account.plan].operations &&
    (state.account.plan === 'free' ||
      !state.rates ||
      !['active', 'trialing'].includes(state.account.subscription_status ?? ''))
  ) {
    paymentRequired('Your monthly API operation allowance has been reached.');
  }
}

export async function enforceKeyRateLimit(keyId: string | null) {
  if (!keyId) return;
  const raw = process.env.API_KEY_REQUESTS_PER_MINUTE ?? '600';
  if (!/^\d{1,5}$/u.test(raw) || Number(raw) < 1 || Number(raw) > 10000) {
    throw new ApiError('internal_error', 'The API rate limit is not configured correctly.');
  }
  const result = await getPool().query<{ requests: number; retry_after: number }>(
    `INSERT INTO api_key_rate_limits (api_key_id, window_start, requests)
       VALUES ($1, date_trunc('minute',now()), 1)
     ON CONFLICT (api_key_id) DO UPDATE SET
       window_start = date_trunc('minute',now()),
       requests = CASE WHEN api_key_rate_limits.window_start = date_trunc('minute',now())
         THEN LEAST(api_key_rate_limits.requests + 1,10001) ELSE 1 END
     RETURNING requests, GREATEST(1,CEIL(EXTRACT(EPOCH FROM (window_start + interval '1 minute' - now()))))::int AS retry_after`,
    [keyId],
  );
  if (result.rows[0]!.requests > Number(raw)) {
    throw new ApiError(
      'rate_limited',
      'This API key has reached its request limit. Retry shortly.',
      429,
      { retryAfter: result.rows[0]!.retry_after },
    );
  }
}

export type Transfer = {
  bucket: string;
  requestId: string;
  objectKey: string;
  bytes: bigint;
  occurredAt: Date;
};
export async function recordTransfer(transfer: Transfer) {
  if (transfer.bytes < 0n || !Number.isFinite(transfer.occurredAt.getTime()))
    throw new Error('Invalid transfer.');
  if (transfer.bucket !== process.env.S3_BUCKET) return;
  await withTransaction(async (client) => {
    const object = await client.query<{ account_id: string; agent_id: string; drive_id: string }>(
      'SELECT d.account_id, v.agent_id, v.drive_id FROM versions v JOIN drives d ON d.id = v.drive_id WHERE v.object_key = $1',
      [transfer.objectKey],
    );
    const owner = object.rows[0];
    if (!owner) return;
    await lockBillingAccount(client, owner.account_id);
    await client.query(
      `INSERT INTO billing_egress_events (id,account_id,agent_id,drive_id,object_key,bytes_sent,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [
        `${transfer.bucket}:${transfer.requestId}`,
        owner.account_id,
        owner.agent_id,
        owner.drive_id,
        transfer.objectKey,
        transfer.bytes.toString(),
        transfer.occurredAt,
      ],
    );
  });
}

export async function queueBillingDeliveries(client: PoolClient, state: BillingState) {
  const quote = quoteState(state);
  if (state.account.stripe_customer_id) {
    const queued = await client.query<{ cents: string }>(
      'SELECT COALESCE(sum(cents),0)::text AS cents FROM billing_meter_reports WHERE account_id = $1 AND period_start = $2',
      [state.account.account_id, state.start],
    );
    const difference = quote.overageCents - BigInt(queued.rows[0]!.cents);
    if (difference > 0n) {
      await client.query(
        `INSERT INTO billing_meter_reports (id,account_id,period_start,stripe_customer_id,cents)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          randomUUID(),
          state.account.account_id,
          state.start,
          state.account.stripe_customer_id,
          difference.toString(),
        ],
      );
    }
  }
  if (
    state.account.alert_email &&
    state.account.alert_threshold_cents !== null &&
    quote.totalCents >= BigInt(state.account.alert_threshold_cents)
  ) {
    await client.query(
      `INSERT INTO billing_notifications (id,account_id,period_start,threshold_cents,email)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,period_start,threshold_cents) DO NOTHING`,
      [
        randomUUID(),
        state.account.account_id,
        state.start,
        state.account.alert_threshold_cents,
        state.account.alert_email,
      ],
    );
  }
  return quote;
}

export async function billingSummary(accountId: string, periodStart?: Date) {
  return withTransaction(async (client) => {
    const state = await billingState(client, accountId, periodStart);
    const quote = await queueBillingDeliveries(client, state);
    const agents = await client.query<{
      id: string;
      name: string;
      storage_bytes: string;
      egress_bytes: string;
      operations: string;
    }>(
      `SELECT a.id, a.name,
        (SELECT COALESCE(sum(v.ciphertext_size),0)::text FROM versions v WHERE v.agent_id = a.id AND v.created_at < $3) AS storage_bytes,
        (SELECT COALESCE(sum(e.bytes_sent),0)::text FROM billing_egress_events e WHERE e.agent_id = a.id AND e.occurred_at >= $2 AND e.occurred_at < $3) AS egress_bytes,
        (SELECT count(*)::text FROM audit_events e WHERE e.agent_id = a.id AND e.created_at >= $2 AND e.created_at < $3 AND e.outcome = 'success') AS operations
       FROM agents a WHERE a.account_id = $1 ORDER BY a.name,a.id`,
      [accountId, state.start, state.end],
    );
    const summary = {
      plan: state.account.plan,
      subscriptionStatus: state.account.subscription_status,
      periodStart: state.start.toISOString(),
      periodEnd: state.end.toISOString(),
      storageBytes: state.current.storageBytes.toString(),
      peakStorageBytes: state.period.peak_storage_bytes,
      drives: state.current.drives.toString(),
      egressBytes: state.current.egressBytes.toString(),
      authorizedEgressBytes: state.period.authorized_egress_bytes,
      operations: state.current.operations.toString(),
      egressMeteringConfigured: Boolean(
        process.env.S3_LOGS_BUCKET && process.env.S3_LOGS_PREFIX && state.rates,
      ),
      totalCents: quote.totalCents.toString(),
      overageCents: quote.overageCents.toString(),
      spendCapCents: state.account.spend_cap_cents,
      alertThresholdCents: state.account.alert_threshold_cents,
      alertEmail: state.account.alert_email,
      overageConfigured: state.rates !== null,
      rates: state.rates
        ? Object.fromEntries(
            Object.entries(state.rates).map(([key, value]) => [key, String(value)]),
          )
        : null,
      checkoutRates: billingRates()
        ? Object.fromEntries(
            Object.entries(billingRates()!).map(([key, value]) => [key, String(value)]),
          )
        : null,
      hasCustomer: !!state.account.stripe_customer_id,
      agents: agents.rows,
      limits: Object.fromEntries(
        Object.entries(PLANS[state.account.plan]).map(([key, value]) => [key, String(value)]),
      ),
    };
    await client.query(
      'UPDATE billing_periods SET statement = $3::jsonb WHERE account_id = $1 AND period_start = $2',
      [accountId, state.start, JSON.stringify(summary)],
    );
    return summary;
  });
}

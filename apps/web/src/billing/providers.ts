import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { ApiError } from '../api/errors';
import { getPool, withTransaction } from '../db/client';
import { billingOrigin, billingRates } from './policy';
import { billingState, lockBillingAccount } from './ledger';

const placeholder = /replace[-_]me/iu;

export function configured(value: string | undefined) {
  return !!value?.trim() && !placeholder.test(value);
}

export function checkoutConfigured() {
  return (
    configured(process.env.STRIPE_SECRET_KEY) &&
    configured(process.env.STRIPE_WEBHOOK_SECRET) &&
    configured(process.env.STRIPE_DEVELOPER_PRICE_ID) &&
    configured(process.env.STRIPE_TEAM_PRICE_ID) &&
    configured(process.env.STRIPE_USAGE_PRICE_ID) &&
    configured(process.env.STRIPE_METER_EVENT_NAME) &&
    configured(process.env.AGENT_DRIVE_PUBLIC_URL) &&
    billingRates() !== null &&
    configured(process.env.S3_LOGS_BUCKET) &&
    configured(process.env.S3_LOGS_PREFIX)
  );
}

export function egressMeteringConfigured() {
  return (
    billingRates() !== null &&
    configured(process.env.S3_LOGS_BUCKET) &&
    configured(process.env.S3_LOGS_PREFIX)
  );
}

export function meterDeliveryConfigured() {
  return (
    configured(process.env.STRIPE_SECRET_KEY) && configured(process.env.STRIPE_METER_EVENT_NAME)
  );
}

export function emailConfigured() {
  return configured(process.env.RESEND_API_KEY) && configured(process.env.EMAIL_FROM);
}

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!configured(key)) throw new ApiError('internal_error', 'Stripe billing is not configured.');
  if (!key!.startsWith('sk_live_') && !key!.startsWith('sk_test_'))
    throw new ApiError('internal_error', 'The Stripe key mode is invalid.');
  return new Stripe(key!, { timeout: 10_000 });
}

function stripeLiveMode() {
  return process.env.STRIPE_SECRET_KEY!.startsWith('sk_live_');
}

async function customerForAccount(accountId: string, client: Stripe) {
  const customer = await withTransaction(async (db) => {
    const billing = await lockBillingAccount(db, accountId);
    if (billing.stripe_customer_id) return billing.stripe_customer_id;
    const created = await client.customers.create(
      { metadata: { accountId } },
      { idempotencyKey: `customer/${accountId}` },
    );
    await db.query('UPDATE billing_accounts SET stripe_customer_id = $2 WHERE account_id = $1', [
      accountId,
      created.id,
    ]);
    return created.id;
  });
  return customer;
}

async function validatePrices(client: Stripe) {
  const baseIds = [process.env.STRIPE_DEVELOPER_PRICE_ID, process.env.STRIPE_TEAM_PRICE_ID];
  const usageId = process.env.STRIPE_USAGE_PRICE_ID;
  if (!baseIds.every(configured) || !configured(usageId))
    throw new ApiError('internal_error', 'Stripe price configuration is incomplete.');
  const prices = await Promise.all([...baseIds, usageId].map((id) => client.prices.retrieve(id!)));
  const developer = prices[0]!;
  const team = prices[1]!;
  const usage = prices[2]!;
  for (const [price, expected] of [
    [developer, 2000],
    [team, 20000],
  ] as const) {
    if (
      !price.active ||
      price.livemode !== stripeLiveMode() ||
      price.currency !== 'usd' ||
      price.unit_amount !== expected ||
      price.billing_scheme !== 'per_unit' ||
      price.transform_quantity !== null ||
      price.tiers_mode !== null ||
      price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== 'licensed'
    )
      throw new ApiError('internal_error', 'Stripe base prices are not configured correctly.');
  }
  if (
    !usage.active ||
    usage.livemode !== stripeLiveMode() ||
    usage.currency !== 'usd' ||
    usage.unit_amount !== 1 ||
    usage.billing_scheme !== 'per_unit' ||
    usage.transform_quantity !== null ||
    usage.tiers_mode !== null ||
    usage.recurring?.interval !== 'month' ||
    usage.recurring.interval_count !== 1 ||
    usage.recurring.usage_type !== 'metered'
  )
    throw new ApiError('internal_error', 'Stripe usage price is not configured correctly.');
  if (!usage.recurring.meter)
    throw new ApiError('internal_error', 'The usage price must be attached to a Stripe meter.');
  const meter = await client.billing.meters.retrieve(usage.recurring.meter);
  if (
    meter.event_name !== process.env.STRIPE_METER_EVENT_NAME ||
    meter.livemode !== stripeLiveMode() ||
    meter.default_aggregation.formula !== 'sum' ||
    meter.customer_mapping.type !== 'by_id' ||
    meter.customer_mapping.event_payload_key !== 'stripe_customer_id' ||
    meter.value_settings.event_payload_key !== 'value' ||
    meter.status !== 'active'
  )
    throw new ApiError('internal_error', 'The Stripe usage meter is not configured correctly.');
}

function nextMonthStart(createdAt: Date) {
  return Math.floor(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth() + 1, 1) / 1000);
}

export async function createCheckout(accountId: string, plan: 'developer' | 'team') {
  if (!checkoutConfigured()) throw new ApiError('conflict', 'Paid checkout is not configured.');
  const client = stripe();
  await validatePrices(client);
  const customer = await customerForAccount(accountId, client);
  const idempotencyKey = `checkout/${accountId}/${plan}/${randomUUID()}`;
  const reserved = await withTransaction(async (db) => {
    const billing = await lockBillingAccount(db, accountId);
    const checkout = await db.query<{
      checkout_idempotency_key: string | null;
      checkout_session_id: string | null;
      checkout_created_at: Date | null;
    }>(
      'SELECT checkout_idempotency_key, checkout_session_id, checkout_created_at FROM billing_accounts WHERE account_id = $1 FOR UPDATE',
      [accountId],
    );
    const {
      checkout_idempotency_key: currentKey,
      checkout_session_id: currentSession,
      checkout_created_at: createdAt,
    } = checkout.rows[0]!;
    if (
      billing.stripe_subscription_id &&
      ['active', 'trialing'].includes(billing.subscription_status ?? '')
    )
      return {
        update: true,
        portal: false,
        idempotencyKey: null,
        sessionId: null,
        createdAt: null,
      };
    if (
      billing.stripe_subscription_id &&
      ['past_due', 'unpaid', 'incomplete'].includes(billing.subscription_status ?? '')
    )
      return {
        update: false,
        portal: true,
        idempotencyKey: null,
        sessionId: null,
        createdAt: null,
      };
    if (currentKey) {
      if (!currentKey.startsWith(`checkout/${accountId}/${plan}/`))
        throw new ApiError('conflict', 'A different checkout is already in progress.');
      if (
        !currentSession &&
        (!createdAt || Date.now() - createdAt.getTime() >= 23 * 60 * 60 * 1000)
      )
        throw new ApiError(
          'conflict',
          'Checkout recovery is ambiguous after 23 hours; reconcile the Stripe checkout manually.',
        );
      return {
        update: false,
        portal: false,
        idempotencyKey: currentKey,
        sessionId: currentSession,
        createdAt,
      };
    }
    await db.query(
      `UPDATE billing_accounts
          SET checkout_idempotency_key = $2, checkout_created_at = now(), checkout_session_id = NULL
        WHERE account_id = $1`,
      [accountId, idempotencyKey],
    );
    const created = await db.query<{ checkout_created_at: Date }>(
      'SELECT checkout_created_at FROM billing_accounts WHERE account_id = $1',
      [accountId],
    );
    return {
      update: false,
      portal: false,
      idempotencyKey,
      sessionId: null,
      createdAt: created.rows[0]!.checkout_created_at,
    };
  });
  if (reserved.update) {
    const targetPrice =
      plan === 'developer'
        ? process.env.STRIPE_DEVELOPER_PRICE_ID!
        : process.env.STRIPE_TEAM_PRICE_ID!;
    const result = await withTransaction(async (db) => {
      const billing = await lockBillingAccount(db, accountId);
      if (!billing.stripe_customer_id || billing.stripe_customer_id !== customer)
        throw new ApiError('conflict', 'The Stripe customer does not belong to this account.');
      if (!billing.stripe_subscription_id)
        throw new ApiError('conflict', 'The paid subscription is not available for update.');
      const current = await client.subscriptions.retrieve(billing.stripe_subscription_id);
      if (current.customer !== customer || !['active', 'trialing'].includes(current.status))
        return { portal: true };
      const items = current.items.data;
      const base = items.find((item) => {
        const id = typeof item.price === 'string' ? item.price : item.price.id;
        return (
          id === process.env.STRIPE_DEVELOPER_PRICE_ID || id === process.env.STRIPE_TEAM_PRICE_ID
        );
      });
      const usage = items.find((item) => {
        const id = typeof item.price === 'string' ? item.price : item.price.id;
        return id === process.env.STRIPE_USAGE_PRICE_ID;
      });
      if (!base || !usage || items.length !== 2 || base.quantity !== 1)
        throw new ApiError(
          'conflict',
          'The Stripe subscription items are incompatible with billing.',
        );
      const currentId = typeof base.price === 'string' ? base.price : base.price.id;
      await billingState(db, accountId);
      if (currentId !== targetPrice) {
        let updated: Stripe.Subscription;
        try {
          updated = await client.subscriptions.update(
            current.id,
            {
              items: [{ id: base.id, price: targetPrice, quantity: 1 }],
              proration_behavior: 'create_prorations',
              payment_behavior: 'error_if_incomplete',
            },
            { idempotencyKey: `tier-change/${accountId}/${randomUUID()}` },
          );
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode === 402)
            throw new ApiError(
              'payment_required',
              'The plan change could not be completed. Update payment details in the billing portal and retry.',
              undefined,
              { upgradeUrl: `${billingOrigin()}/console/billing` },
            );
          throw error;
        }
        if (
          updated.customer !== customer ||
          !['active', 'trialing'].includes(updated.status) ||
          updated.items.data.length !== 2
        )
          throw new ApiError('conflict', 'Stripe returned an incompatible subscription update.');
        const updatedUsage = updated.items.data.find((item) => {
          const id = typeof item.price === 'string' ? item.price : item.price.id;
          return id === process.env.STRIPE_USAGE_PRICE_ID;
        });
        const updatedBase = updated.items.data.find((item) => item.id === base.id);
        const updatedBasePrice =
          updatedBase && typeof updatedBase.price === 'string'
            ? updatedBase.price
            : updatedBase?.price.id;
        if (
          !updatedUsage ||
          updatedUsage.id !== usage.id ||
          !updatedBase ||
          updatedBase.quantity !== 1 ||
          updatedBasePrice !== targetPrice
        )
          throw new ApiError('conflict', 'Stripe returned an incompatible subscription update.');
      }
      await db.query(
        `UPDATE billing_accounts SET plan = $2, subscription_status = $3,
          stripe_subscription_id = $4 WHERE account_id = $1`,
        [accountId, plan, current.status, billing.stripe_subscription_id],
      );
      await billingState(db, accountId);
      return { updated: true };
    });
    if (result.portal) return createPortal(accountId);
    return result;
  }
  if (reserved.portal) return createPortal(accountId);
  if (reserved.sessionId) {
    const previous = await client.checkout.sessions.retrieve(reserved.sessionId);
    if (previous.status === 'open' && previous.url) return { url: previous.url };
    if (previous.status !== 'expired')
      throw new ApiError('conflict', 'Checkout completed; subscription status is being updated.');
    await withTransaction(async (db) => {
      await lockBillingAccount(db, accountId);
      await db.query(
        `UPDATE billing_accounts SET checkout_idempotency_key = NULL, checkout_session_id = NULL,
                checkout_created_at = NULL
          WHERE account_id = $1 AND checkout_idempotency_key = $2`,
        [accountId, reserved.idempotencyKey],
      );
    });
    return createCheckout(accountId, plan);
  }
  const price =
    plan === 'developer'
      ? process.env.STRIPE_DEVELOPER_PRICE_ID!
      : process.env.STRIPE_TEAM_PRICE_ID!;
  const usage = process.env.STRIPE_USAGE_PRICE_ID!;
  const session = await client.checkout.sessions.create(
    {
      mode: 'subscription',
      customer,
      client_reference_id: accountId,
      line_items: [{ price, quantity: 1 }, { price: usage }],
      subscription_data: {
        billing_cycle_anchor: nextMonthStart(reserved.createdAt ?? new Date()),
        proration_behavior: 'create_prorations',
        metadata: { accountId, plan },
      },
      success_url: `${billingOrigin()}/console/billing?checkout=success`,
      cancel_url: `${billingOrigin()}/console/billing?checkout=cancelled`,
    },
    { idempotencyKey: reserved.idempotencyKey! },
  );
  if (!session.url) throw new ApiError('internal_error', 'Stripe did not return a checkout URL.');
  await getPool().query(
    'UPDATE billing_accounts SET checkout_session_id = $2 WHERE account_id = $1 AND checkout_idempotency_key = $3',
    [accountId, session.id, reserved.idempotencyKey],
  );
  return { url: session.url };
}

export async function createPortal(accountId: string) {
  const customer = await withTransaction(async (db) => {
    const billing = await lockBillingAccount(db, accountId);
    if (!billing.stripe_customer_id)
      throw new ApiError('conflict', 'A Stripe customer has not been created yet.');
    return billing.stripe_customer_id;
  });
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${billingOrigin()}/console/billing`,
  });
  return { url: session.url };
}

export async function sendBillingEmail(input: {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
}) {
  if (!emailConfigured()) throw new ApiError('internal_error', 'Email billing is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!response.ok) throw new Error(`Resend request failed with status ${response.status}.`);
}

export async function sendMeterReport(input: {
  id: string;
  customer: string;
  cents: string;
  timestamp: number;
}) {
  if (!meterDeliveryConfigured()) throw new Error('Stripe metering is not configured.');
  const client = stripe();
  await client.billing.meterEvents.create(
    {
      event_name: process.env.STRIPE_METER_EVENT_NAME!,
      payload: { value: input.cents, stripe_customer_id: input.customer },
      identifier: input.id,
      timestamp: input.timestamp,
    },
    { idempotencyKey: input.id },
  );
}

export async function processStripeWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!configured(secret) || !signature)
    throw new ApiError('unauthorized', 'Invalid Stripe signature.');
  const client = stripe();
  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(rawBody, signature, secret!);
  } catch {
    throw new ApiError('unauthorized', 'Invalid Stripe signature.');
  }
  const expectedLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;
  if (event.livemode !== expectedLive)
    throw new ApiError('unauthorized', 'Stripe mode does not match configuration.');
  const supported = new Set([
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
  ]);
  if (!supported.has(event.type)) return { received: true };
  const object = event.data.object as unknown as {
    id?: string;
    customer?: string | { id: string };
    subscription?: string | { id: string } | null;
    parent?: {
      type?: string;
      subscription_details?: { subscription?: string | { id: string } };
    } | null;
    client_reference_id?: string | null;
    mode?: string;
  };
  const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
  const subscriptionId =
    typeof object.subscription === 'string'
      ? object.subscription
      : (object.subscription?.id ??
        (object.parent?.type === 'subscription_details'
          ? typeof object.parent.subscription_details?.subscription === 'string'
            ? object.parent.subscription_details.subscription
            : object.parent.subscription_details?.subscription?.id
          : event.type.startsWith('customer.subscription.')
            ? object.id
            : undefined));
  if (event.type.startsWith('invoice.') && !subscriptionId) return { received: true };
  if (!customerId || !subscriptionId)
    throw new ApiError(
      'validation_error',
      'The Stripe event is missing its customer or subscription.',
    );
  const mapped = await getPool().query(
    'SELECT account_id FROM billing_accounts WHERE stripe_customer_id = $1',
    [customerId],
  );
  const accountId = mapped.rows[0]?.account_id as string | undefined;
  if (!accountId)
    throw new ApiError('unauthorized', 'The Stripe customer is not mapped to an account.');
  if (
    event.type === 'checkout.session.completed' &&
    (object.mode !== 'subscription' || object.client_reference_id !== accountId)
  )
    throw new ApiError('unauthorized', 'The checkout session account or mode does not match.');
  await withTransaction(async (db) => {
    const billing = await lockBillingAccount(db, accountId);
    const duplicate = await db.query('SELECT 1 FROM stripe_events WHERE id = $1', [event.id]);
    if (duplicate.rowCount) return;
    if (BigInt(billing.stripe_event_created) > BigInt(event.created)) {
      await db.query('INSERT INTO stripe_events (id, created, type) VALUES ($1,$2,$3)', [
        event.id,
        event.created,
        event.type,
      ]);
      return;
    }
    await validatePrices(client);
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    const subscriptionCustomer =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    if (subscriptionCustomer !== customerId)
      throw new ApiError('unauthorized', 'The Stripe subscription customer does not match.');
    if (subscription.metadata.accountId && subscription.metadata.accountId !== accountId)
      throw new ApiError('unauthorized', 'The Stripe subscription account does not match.');
    const priceIds = subscription.items.data.map((item) =>
      typeof item.price === 'string' ? item.price : item.price.id,
    );
    const developerPrice = process.env.STRIPE_DEVELOPER_PRICE_ID!;
    const teamPrice = process.env.STRIPE_TEAM_PRICE_ID!;
    const usagePrice = process.env.STRIPE_USAGE_PRICE_ID!;
    const baseItems = subscription.items.data.filter((item) => {
      const id = typeof item.price === 'string' ? item.price : item.price.id;
      return id === developerPrice || id === teamPrice;
    });
    const usageItems = subscription.items.data.filter((item) => {
      const id = typeof item.price === 'string' ? item.price : item.price.id;
      return id === usagePrice;
    });
    const hasDeveloper = priceIds.includes(developerPrice);
    const hasTeam = priceIds.includes(teamPrice);
    if (
      subscription.items.data.length !== 2 ||
      baseItems.length !== 1 ||
      usageItems.length !== 1 ||
      baseItems[0]!.quantity !== 1 ||
      hasDeveloper === hasTeam
    )
      throw new ApiError(
        'validation_error',
        'The subscription prices do not match billing configuration.',
      );
    const paidPlan = hasTeam ? 'team' : 'developer';
    const otherSubscriptionIsCurrent =
      !!billing.stripe_subscription_id &&
      billing.stripe_subscription_id !== subscription.id &&
      !['canceled', 'incomplete_expired'].includes(billing.subscription_status ?? '');
    if (
      otherSubscriptionIsCurrent &&
      (BigInt(billing.stripe_event_created) > BigInt(event.created) ||
        ['canceled', 'incomplete_expired'].includes(subscription.status) ||
        !['active', 'trialing'].includes(subscription.status))
    ) {
      await db.query('INSERT INTO stripe_events (id, created, type) VALUES ($1,$2,$3)', [
        event.id,
        event.created,
        event.type,
      ]);
      return;
    }
    if (otherSubscriptionIsCurrent)
      throw new ApiError('conflict', 'The account already has a different active subscription.');
    await billingState(db, accountId);
    const plan =
      subscription.status === 'canceled' || subscription.status === 'incomplete_expired'
        ? 'free'
        : ['active', 'trialing'].includes(subscription.status)
          ? paidPlan
          : billing.plan;
    await db.query(
      `UPDATE billing_accounts
          SET plan = $2, subscription_status = $3, stripe_subscription_id = $4,
              stripe_event_created = $5, stripe_event_id = $6,
              checkout_idempotency_key = NULL, checkout_session_id = NULL, checkout_created_at = NULL
        WHERE account_id = $1 AND stripe_event_created <= $5`,
      [accountId, plan, subscription.status, subscription.id, event.created, event.id],
    );
    await billingState(db, accountId);
    await db.query('INSERT INTO stripe_events (id, created, type) VALUES ($1,$2,$3)', [
      event.id,
      event.created,
      event.type,
    ]);
  });
  return { received: true };
}

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

const transport = vi.hoisted(() => ({ port: 0 }));
vi.mock('stripe', async (importOriginal) => {
  const { default: RealStripe } = await importOriginal<typeof import('stripe')>();
  return {
    default: class LocalStripe extends RealStripe {
      constructor(key: string, options: ConstructorParameters<typeof RealStripe>[1]) {
        super(key, {
          ...options,
          host: '127.0.0.1',
          port: transport.port,
          protocol: 'http',
          maxNetworkRetries: 0,
        });
      }
    },
  };
});

import {
  closeStripeBillingForDeletion,
  createCheckout,
  createPortal,
  processStripeWebhook,
  sendBillingEmail,
  sendMeterReport,
} from './providers';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive',
});
const accountId = randomUUID();
const customerId = `cus_${randomUUID().replaceAll('-', '')}`;
const subscriptionId = `sub_${randomUUID().replaceAll('-', '')}`;
const eventIds: string[] = [];
const requests: { method: string; path: string; body: string; idempotency?: string }[] = [];
const unexpected: string[] = [];
const nativeFetch = globalThis.fetch;
let checkoutOutage = true;
let emailOutage = true;
let meterOutage = true;
let declineUpgrade = true;
let basePrice = 'price_developer_http';
let subscriptionStatus = 'active';
let checkoutStatus = 'open';
const subscription = () => ({
  id: subscriptionId,
  object: 'subscription',
  customer: customerId,
  livemode: false,
  metadata: { accountId },
  status: subscriptionStatus,
  items: {
    data: [
      { id: 'si_base_http', price: { id: basePrice }, quantity: 1 },
      { id: 'si_usage_http', price: { id: 'price_usage_http' } },
    ],
  },
});
const checkout = () => ({
  id: 'cs_http',
  object: 'checkout.session',
  customer: customerId,
  livemode: false,
  status: checkoutStatus,
  url: 'https://checkout.example.test/simulated',
});
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  const url = new URL(request.url!, 'http://localhost');
  const path = url.pathname;
  const method = request.method!;
  requests.push({ method, path, body, idempotency: request.headers['idempotency-key'] as string });
  const send = (value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const form = new URLSearchParams(body);
  if (method === 'GET' && path.startsWith('/v1/prices/')) {
    const id = path.split('/').at(-1)!;
    const amount = { price_developer_http: 2000, price_team_http: 20000, price_usage_http: 1 }[id];
    if (amount !== undefined)
      return send({
        id,
        object: 'price',
        active: true,
        livemode: false,
        currency: 'usd',
        unit_amount: amount,
        billing_scheme: 'per_unit',
        transform_quantity: null,
        tiers_mode: null,
        recurring: {
          interval: 'month',
          interval_count: 1,
          usage_type: amount === 1 ? 'metered' : 'licensed',
          ...(amount === 1 ? { meter: 'mtr_http' } : {}),
        },
      });
  }
  if (method === 'GET' && path === '/v1/billing/meters/mtr_http')
    return send({
      id: 'mtr_http',
      livemode: false,
      event_name: 'agent_drive_usage',
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
      status: 'active',
    });
  if (method === 'POST' && path === '/v1/customers')
    return send({
      id: customerId,
      object: 'customer',
      livemode: false,
      metadata: { accountId: form.get('metadata[accountId]') },
    });
  if (method === 'GET' && path === `/v1/customers/${customerId}`)
    return send({ id: customerId, livemode: false, metadata: { accountId } });
  if (method === 'POST' && path === '/v1/checkout/sessions') {
    if (checkoutOutage) {
      checkoutOutage = false;
      return send({ error: { type: 'api_error', message: 'Simulated provider outage' } }, 503);
    }
    return send(checkout());
  }
  if (method === 'GET' && path === '/v1/checkout/sessions/cs_http') return send(checkout());
  if (method === 'GET' && path === `/v1/subscriptions/${subscriptionId}`)
    return send(subscription());
  if (method === 'POST' && path === `/v1/subscriptions/${subscriptionId}`) {
    if (declineUpgrade) {
      declineUpgrade = false;
      return send(
        { error: { type: 'card_error', code: 'card_declined', message: 'Simulated decline' } },
        402,
      );
    }
    basePrice = form.get('items[0][price]')!;
    return send(subscription());
  }
  if (method === 'POST' && path === '/v1/billing_portal/sessions')
    return send({ id: 'bps_http', url: 'https://billing.example.test/simulated' });
  if (method === 'POST' && path === '/v1/billing/meter_events') {
    if (meterOutage) {
      meterOutage = false;
      return send({ error: { type: 'api_error', message: 'Simulated meter outage' } }, 503);
    }
    return send({ object: 'billing.meter_event', identifier: form.get('identifier') });
  }
  if (method === 'POST' && path === '/emails') {
    if (emailOutage) {
      emailOutage = false;
      return send({ message: 'Simulated email outage' }, 503);
    }
    return send({ id: 'email_http' });
  }
  if (method === 'GET' && path === '/v1/checkout/sessions')
    return send({
      object: 'list',
      data: checkoutStatus === 'open' ? [checkout()] : [],
      has_more: false,
    });
  if (method === 'POST' && path === '/v1/checkout/sessions/cs_http/expire') {
    checkoutStatus = 'expired';
    return send(checkout());
  }
  if (method === 'GET' && path === '/v1/subscriptions')
    return send({ object: 'list', data: [subscription()], has_more: false });
  if (method === 'DELETE' && path === `/v1/subscriptions/${subscriptionId}`) {
    subscriptionStatus = 'canceled';
    return send(subscription());
  }
  unexpected.push(`${method} ${path}`);
  send({ error: { type: 'invalid_request_error', message: 'Unhandled simulation request' } }, 400);
});

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  await pool.query('INSERT INTO accounts (id,name) VALUES ($1,$2)', [
    accountId,
    `http-simulation-${accountId}`,
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  transport.port = (server.address() as { port: number }).port;
  for (const [key, value] of Object.entries({
    STRIPE_SECRET_KEY: 'sk_test_http_simulation',
    STRIPE_WEBHOOK_SECRET: 'whsec_http_simulation',
    STRIPE_DEVELOPER_PRICE_ID: 'price_developer_http',
    STRIPE_TEAM_PRICE_ID: 'price_team_http',
    STRIPE_USAGE_PRICE_ID: 'price_usage_http',
    STRIPE_METER_EVENT_NAME: 'agent_drive_usage',
    AGENT_DRIVE_PUBLIC_URL: 'https://drive.example.test',
    S3_LOGS_BUCKET: 'http-simulation-logs',
    S3_LOGS_PREFIX: 'access/',
    BILLING_DRIVE_MONTH_CENTS: '200',
    BILLING_STORAGE_GIB_MONTH_CENTS: '5',
    BILLING_EGRESS_GIB_CENTS: '15',
    BILLING_OPERATIONS_1000_CENTS: '1',
    RESEND_API_KEY: 're_http_simulation',
    EMAIL_FROM: 'Agent Drive <billing@example.test>',
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    if (input !== 'https://api.resend.com/emails') throw new Error('Unexpected external fetch');
    return nativeFetch(`http://127.0.0.1:${transport.port}/emails`, init);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.query('DELETE FROM stripe_events WHERE id = ANY($1::text[])', [eventIds]);
  await pool.query('DELETE FROM accounts WHERE id=$1', [accountId]);
  await pool.end();
});

function signedEvent(type: string, object: unknown, created: number, livemode = false) {
  const id = `evt_${randomUUID().replaceAll('-', '')}`;
  eventIds.push(id);
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    created,
    livemode,
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_http_simulation',
  });
  return { payload, signature, id };
}

const billingRow = async () =>
  (
    await pool.query(
      'SELECT plan,subscription_status,checkout_session_id,checkout_created_at FROM billing_accounts WHERE account_id=$1',
      [accountId],
    )
  ).rows[0];
const posts = (path: string) =>
  requests.filter((request) => request.method === 'POST' && request.path === path);

it('runs checkout recovery, signed activation, decline/recovery, metering, email and cancellation through real HTTP', async () => {
  await expect(createCheckout(accountId, 'developer')).rejects.toMatchObject({ statusCode: 503 });
  expect(await billingRow()).toMatchObject({ plan: 'free', checkout_session_id: null });
  expect(await createCheckout(accountId, 'developer')).toEqual({ url: checkout().url });
  expect(await createCheckout(accountId, 'developer')).toEqual({ url: checkout().url });
  const checkouts = posts('/v1/checkout/sessions');
  expect(checkouts).toHaveLength(2);
  expect(checkouts[0]!.idempotency).toBeTruthy();
  expect(checkouts[1]!.idempotency).toBe(checkouts[0]!.idempotency);
  expect(posts('/v1/customers')).toHaveLength(1);
  const form = new URLSearchParams(checkouts[1]!.body);
  expect(Object.fromEntries(form)).toMatchObject({
    customer: customerId,
    mode: 'subscription',
    client_reference_id: accountId,
    'line_items[0][price]': 'price_developer_http',
    'line_items[0][quantity]': '1',
    'line_items[1][price]': 'price_usage_http',
    'subscription_data[metadata][accountId]': accountId,
    success_url: 'https://drive.example.test/console/billing?checkout=success',
    cancel_url: 'https://drive.example.test/console/billing?checkout=cancelled',
  });
  expect(form.has('line_items[1][quantity]')).toBe(false);
  const reservedAt: Date = (await billingRow()).checkout_created_at;
  expect(Number(form.get('subscription_data[billing_cycle_anchor]'))).toBe(
    Date.UTC(reservedAt.getUTCFullYear(), reservedAt.getUTCMonth() + 1, 1) / 1000,
  );
  const now = Math.floor(Date.now() / 1000);
  const activation = signedEvent(
    'checkout.session.completed',
    {
      id: 'cs_http',
      customer: customerId,
      subscription: subscriptionId,
      mode: 'subscription',
      client_reference_id: accountId,
    },
    now,
  );
  await expect(
    processStripeWebhook(`${activation.payload} `, activation.signature),
  ).rejects.toMatchObject({ code: 'unauthorized' });
  const live = signedEvent('customer.subscription.updated', subscription(), now, true);
  await expect(processStripeWebhook(live.payload, live.signature)).rejects.toMatchObject({
    code: 'unauthorized',
  });
  expect(await billingRow()).toMatchObject({ plan: 'free' });
  await processStripeWebhook(activation.payload, activation.signature);
  const callsAfterActivation = requests.length;
  await processStripeWebhook(activation.payload, activation.signature);
  expect(requests).toHaveLength(callsAfterActivation);
  expect(await billingRow()).toMatchObject({
    plan: 'developer',
    subscription_status: 'active',
    checkout_session_id: null,
  });
  const stale = signedEvent('customer.subscription.deleted', subscription(), now - 1);
  await processStripeWebhook(stale.payload, stale.signature);
  expect(requests).toHaveLength(callsAfterActivation);
  await expect(createCheckout(accountId, 'team')).rejects.toMatchObject({
    code: 'payment_required',
  });
  expect(await billingRow()).toMatchObject({ plan: 'developer' });
  expect(await createCheckout(accountId, 'team')).toEqual({ updated: true });
  expect(await billingRow()).toMatchObject({ plan: 'team' });
  expect(
    Object.fromEntries(new URLSearchParams(posts(`/v1/subscriptions/${subscriptionId}`)[1]!.body)),
  ).toMatchObject({
    'items[0][id]': 'si_base_http',
    'items[0][price]': 'price_team_http',
    payment_behavior: 'error_if_incomplete',
    proration_behavior: 'create_prorations',
  });
  subscriptionStatus = 'past_due';
  const failedInvoice = signedEvent(
    'invoice.payment_failed',
    {
      id: 'in_http',
      customer: customerId,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: subscriptionId },
      },
    },
    now + 1,
  );
  await processStripeWebhook(failedInvoice.payload, failedInvoice.signature);
  expect(await billingRow()).toMatchObject({ subscription_status: 'past_due' });
  expect(await createCheckout(accountId, 'team')).toEqual(await createPortal(accountId));
  expect(posts('/v1/checkout/sessions')).toHaveLength(2);
  expect(
    Object.fromEntries(new URLSearchParams(posts('/v1/billing_portal/sessions')[0]!.body)),
  ).toEqual({
    customer: customerId,
    return_url: 'https://drive.example.test/console/billing',
  });
  const meter = { id: randomUUID(), customer: customerId, cents: '55', timestamp: now };
  await expect(sendMeterReport(meter)).rejects.toMatchObject({ statusCode: 503 });
  await sendMeterReport(meter);
  for (const request of posts('/v1/billing/meter_events')) {
    expect(request.idempotency).toBe(meter.id);
    expect(Object.fromEntries(new URLSearchParams(request.body))).toMatchObject({
      identifier: meter.id,
      event_name: 'agent_drive_usage',
      'payload[value]': '55',
      'payload[stripe_customer_id]': customerId,
      timestamp: String(now),
    });
  }
  expect(posts('/v1/billing/meter_events')).toHaveLength(2);
  const email = {
    idempotencyKey: `billing-notification/${randomUUID()}`,
    to: 'owner@example.test',
    subject: 'Agent Drive billing threshold reached',
    text: 'Review https://drive.example.test/console/billing',
  };
  await expect(sendBillingEmail(email)).rejects.toThrow('status 503');
  await sendBillingEmail(email);
  expect(posts('/emails')).toHaveLength(2);
  for (const request of posts('/emails')) {
    expect(request.idempotency).toBe(email.idempotencyKey);
    expect(JSON.parse(request.body)).toEqual({
      from: 'Agent Drive <billing@example.test>',
      to: [email.to],
      subject: email.subject,
      text: email.text,
    });
  }
  expect(await closeStripeBillingForDeletion(accountId, customerId)).toBe(true);
  expect(checkoutStatus).toBe('expired');
  expect(subscriptionStatus).toBe('canceled');
  const cancellation = requests.find((request) => request.method === 'DELETE');
  expect(cancellation?.idempotency).toBe(`delete-subscription/${accountId}/${subscriptionId}`);
  const deleted = signedEvent('customer.subscription.deleted', subscription(), now + 2);
  await processStripeWebhook(deleted.payload, deleted.signature);
  expect(await billingRow()).toMatchObject({ plan: 'free', subscription_status: 'canceled' });
  expect(unexpected).toEqual([]);
});

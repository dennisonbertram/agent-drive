import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../api/handler';

const stripeMocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  priceRetrieve: vi.fn(),
  meterRetrieve: vi.fn(),
  subscriptionRetrieve: vi.fn(),
  subscriptionUpdate: vi.fn(),
  checkoutCreate: vi.fn(),
  checkoutRetrieve: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class StripeMock {
    webhooks = { constructEvent: stripeMocks.constructEvent };
    prices = { retrieve: stripeMocks.priceRetrieve };
    billing = { meters: { retrieve: stripeMocks.meterRetrieve } };
    subscriptions = {
      retrieve: stripeMocks.subscriptionRetrieve,
      update: stripeMocks.subscriptionUpdate,
    };
    checkout = {
      sessions: { create: stripeMocks.checkoutCreate, retrieve: stripeMocks.checkoutRetrieve },
    };
  },
}));

import { createCheckout, processStripeWebhook } from './providers';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const accountId = randomUUID();
const stripeCustomerId = `cus_${randomUUID().replaceAll('-', '')}`;
const checkoutAccountId = randomUUID();
const checkoutCustomerId = `cus_${randomUUID().replaceAll('-', '')}`;
const quotaAccountId = randomUUID();
const quotaCustomerId = `cus_${randomUUID().replaceAll('-', '')}`;
const tierAccountId = randomUUID();
const tierCustomerId = `cus_${randomUUID().replaceAll('-', '')}`;
const tierSubscriptionId = `sub_${randomUUID().replaceAll('-', '')}`;
const s3Bucket = process.env.S3_BUCKET ?? 'agent-drive-local';
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});
let realStripe: typeof import('stripe').default;
const activeEventId = `evt_active_${randomUUID().replaceAll('-', '')}`;
const staleEventId = `evt_stale_${randomUUID().replaceAll('-', '')}`;
const duplicateTime = 1_800_000_000;
const planPrices = {
  price_developer_fixture: {
    id: 'price_developer_fixture',
    active: true,
    livemode: false,
    currency: 'usd',
    unit_amount: 2000,
    billing_scheme: 'per_unit',
    transform_quantity: null,
    tiers_mode: null,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  },
  price_team_fixture: {
    id: 'price_team_fixture',
    active: true,
    livemode: false,
    currency: 'usd',
    unit_amount: 20000,
    billing_scheme: 'per_unit',
    transform_quantity: null,
    tiers_mode: null,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  },
  price_usage_fixture: {
    id: 'price_usage_fixture',
    active: true,
    livemode: false,
    currency: 'usd',
    unit_amount: 1,
    billing_scheme: 'per_unit',
    transform_quantity: null,
    tiers_mode: null,
    recurring: {
      interval: 'month',
      interval_count: 1,
      usage_type: 'metered',
      meter: 'mtr_usage_fixture',
    },
  },
};

beforeAll(async () => {
  realStripe = (await vi.importActual<typeof import('stripe')>('stripe')).default;
  for (const [name, value] of Object.entries({
    STRIPE_SECRET_KEY: 'sk_test_webhook_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_webhook_fixture',
    STRIPE_DEVELOPER_PRICE_ID: 'price_developer_fixture',
    STRIPE_TEAM_PRICE_ID: 'price_team_fixture',
    STRIPE_USAGE_PRICE_ID: 'price_usage_fixture',
    STRIPE_METER_EVENT_NAME: 'agent_drive_usage',
    AGENT_DRIVE_PUBLIC_URL: 'https://billing.example.test',
    S3_LOGS_BUCKET: 'billing-access-logs',
    S3_LOGS_PREFIX: 'production/',
    BILLING_DRIVE_MONTH_CENTS: '200',
    BILLING_STORAGE_GIB_MONTH_CENTS: '5',
    BILLING_EGRESS_GIB_CENTS: '15',
    BILLING_OPERATIONS_1000_CENTS: '1',
  }))
    vi.stubEnv(name, value);
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const staleAccounts = await pool.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE name LIKE 'stripe-webhook-%' OR name LIKE 'stripe-checkout-%'
         OR name LIKE 'stripe-quota-%' OR name LIKE 'stripe-tier-%'`,
  );
  if (staleAccounts.rowCount) {
    const staleIds = staleAccounts.rows.map(({ id }) => id);
    await pool.query(
      `DELETE FROM file_events WHERE drive_id IN (
        SELECT id FROM drives WHERE account_id = ANY($1::uuid[])
      )`,
      [staleIds],
    );
    await pool.query(
      `DELETE FROM versions WHERE drive_id IN (
        SELECT id FROM drives WHERE account_id = ANY($1::uuid[])
      )`,
      [staleIds],
    );
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [staleIds]);
  }
  await pool.query('INSERT INTO accounts (id, name) VALUES ($1,$2)', [
    accountId,
    `stripe-webhook-${randomUUID()}`,
  ]);
  await pool.query(
    `INSERT INTO billing_accounts (account_id, stripe_customer_id)
     VALUES ($1,$2)`,
    [accountId, stripeCustomerId],
  );
  await pool.query('INSERT INTO accounts (id, name) VALUES ($1,$2)', [
    checkoutAccountId,
    `stripe-checkout-${randomUUID()}`,
  ]);
  await pool.query('INSERT INTO billing_accounts (account_id, stripe_customer_id) VALUES ($1,$2)', [
    checkoutAccountId,
    checkoutCustomerId,
  ]);
  await pool.query('INSERT INTO accounts (id, name) VALUES ($1,$2)', [
    quotaAccountId,
    `stripe-quota-${randomUUID()}`,
  ]);
  await pool.query(
    `INSERT INTO billing_accounts (account_id, plan, stripe_customer_id)
     VALUES ($1,'free',$2)`,
    [quotaAccountId, quotaCustomerId],
  );
  await pool.query('INSERT INTO accounts (id, name) VALUES ($1,$2)', [
    tierAccountId,
    `stripe-tier-${randomUUID()}`,
  ]);
  await pool.query(
    `INSERT INTO billing_accounts
       (account_id,plan,subscription_status,stripe_customer_id,stripe_subscription_id)
     VALUES ($1,'developer','active',$2,$3)`,
    [tierAccountId, tierCustomerId, tierSubscriptionId],
  );
  stripeMocks.priceRetrieve.mockImplementation(
    async (id: string) => planPrices[id as keyof typeof planPrices],
  );
  stripeMocks.meterRetrieve.mockResolvedValue({
    event_name: 'agent_drive_usage',
    livemode: false,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
    status: 'active',
  });
  stripeMocks.subscriptionRetrieve.mockImplementation(async (id: string) => ({
    id,
    customer: stripeCustomerId,
    metadata: { accountId },
    status: id === 'sub_old_fixture' ? 'canceled' : 'active',
    items: {
      data: [
        { id: 'si_base_fixture', price: { id: 'price_developer_fixture' }, quantity: 1 },
        { id: 'si_usage_fixture', price: { id: 'price_usage_fixture' }, quantity: 1 },
      ],
    },
  }));
});

it('verifies a real Stripe signature and reconciles modern invoice subscription linkage', async () => {
  const event = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'apps/web/src/billing/fixtures/invoice.payment.succeeded.modern.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  event.id = `evt_invoice_${randomUUID().replaceAll('-', '')}`;
  event.created = duplicateTime + 100;
  const data = event.data as { object: Record<string, unknown> };
  data.object.customer = stripeCustomerId;
  const parent = data.object.parent as { subscription_details: { subscription: string } };
  parent.subscription_details.subscription = 'sub_developer_fixture';
  const payload = JSON.stringify(event);
  stripeMocks.constructEvent.mockImplementation((body: string, signature: string, secret: string) =>
    realStripe.webhooks.constructEvent(body, signature, secret),
  );
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_webhook_fixture',
  });
  await expect(processStripeWebhook(payload, signature)).resolves.toEqual({ received: true });
});

it('upgrades the same Free drive after a signed Developer webhook clears its storage allowance', async () => {
  const managerToken = `adk_${randomBytes(32).toString('base64url')}`;
  const managerAgent = await pool.query<{ id: string }>(
    'INSERT INTO agents (account_id, name) VALUES ($1,$2) RETURNING id',
    [quotaAccountId, `quota-manager-${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
     VALUES ($1,$2,'quota-manager',$3,'{}'::uuid[],ARRAY['manage']::text[])`,
    [
      quotaAccountId,
      managerAgent.rows[0]!.id,
      createHash('sha256').update(managerToken).digest('hex'),
    ],
  );
  const callApi = (token: string, path: string, method: string, body?: unknown) =>
    handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const driveResponse = await callApi(managerToken, '/drives', 'POST', {
    name: `free-default-${randomUUID()}`,
  });
  expect(driveResponse.status).toBe(200);
  const drive = (await driveResponse.json()) as { id: string };
  expect(
    (
      await pool.query<{ quota_bytes: string }>(
        'SELECT quota_bytes::text FROM drives WHERE id=$1',
        [drive.id],
      )
    ).rows[0]!.quota_bytes,
  ).toBe(String(Number.MAX_SAFE_INTEGER));
  const writeToken = `adk_${randomBytes(32).toString('base64url')}`;
  await pool.query(
    `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
     VALUES ($1,$2,'quota-writer',$3,ARRAY[$4]::uuid[],ARRAY['write']::text[])`,
    [
      quotaAccountId,
      managerAgent.rows[0]!.id,
      createHash('sha256').update(writeToken).digest('hex'),
      drive.id,
    ],
  );
  const file = await pool.query<{ id: string }>(
    `INSERT INTO files (drive_id,path) VALUES ($1,'/synthetic-limit.bin') RETURNING id`,
    [drive.id],
  );
  const version = await pool.query<{ id: string }>(
    `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,$4,'opaque-wrapped-key',$5) RETURNING id`,
    [
      file.rows[0]!.id,
      drive.id,
      `objects/quota-fixture/${randomUUID()}`,
      String(5n * 1024n ** 3n),
      managerAgent.rows[0]!.id,
    ],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [
    file.rows[0]!.id,
    version.rows[0]!.id,
  ]);

  const blocked = await callApi(writeToken, `/drives/${drive.id}/put`, 'POST', {
    path: '/tiny.bin',
    ciphertextSize: 1,
    wrappedKey: 'opaque-wrapped-key',
  });
  expect(blocked.status).toBe(402);
  expect((await blocked.json()).error.upgradeUrl).toContain('/console/billing');

  const event = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'apps/web/src/billing/fixtures/customer.subscription.updated.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  event.id = `evt_quota_${randomUUID().replaceAll('-', '')}`;
  event.created = Math.floor(Date.now() / 1000);
  const eventData = event.data as { object: Record<string, unknown> };
  eventData.object.id = 'sub_quota_fixture';
  eventData.object.customer = quotaCustomerId;
  eventData.object.metadata = { accountId: quotaAccountId };
  stripeMocks.subscriptionRetrieve.mockImplementation(async (id: string) => ({
    id,
    customer: id === 'sub_quota_fixture' ? quotaCustomerId : stripeCustomerId,
    metadata: { accountId: id === 'sub_quota_fixture' ? quotaAccountId : accountId },
    status: 'active',
    items: {
      data: [
        { id: 'si_quota_base', price: { id: 'price_developer_fixture' }, quantity: 1 },
        { id: 'si_quota_usage', price: { id: 'price_usage_fixture' }, quantity: 1 },
      ],
    },
  }));
  stripeMocks.constructEvent.mockImplementation((body: string, signature: string, secret: string) =>
    realStripe.webhooks.constructEvent(body, signature, secret),
  );
  const payload = JSON.stringify(event);
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_webhook_fixture',
  });
  await processStripeWebhook(payload, signature);

  const accepted = await callApi(writeToken, `/drives/${drive.id}/put`, 'POST', {
    path: '/tiny.bin',
    ciphertextSize: 1,
    wrappedKey: 'opaque-wrapped-key',
  });
  expect(accepted.status).toBe(201);
  const intent = (await accepted.json()) as { intentId: string; uploadUrl: string };
  const upload = await fetch(intent.uploadUrl, { method: 'PUT', body: new Uint8Array([1]) });
  expect(upload.ok).toBe(true);
  const committed = await callApi(writeToken, `/drives/${drive.id}/commit`, 'POST', {
    intentId: intent.intentId,
  });
  expect(committed.status).toBe(201);
  expect(
    (
      await pool.query<{ plan: string }>('SELECT plan FROM billing_accounts WHERE account_id=$1', [
        quotaAccountId,
      ])
    ).rows[0]!.plan,
  ).toBe('developer');
});

afterAll(async () => {
  await pool.query('DELETE FROM stripe_events WHERE id = ANY($1::text[])', [
    [activeEventId, staleEventId],
  ]);
  const objects = await pool.query<{ object_key: string }>(
    `SELECT v.object_key FROM versions v JOIN drives d ON d.id = v.drive_id
      WHERE d.account_id = $1`,
    [quotaAccountId],
  );
  await Promise.all(
    objects.rows.map((row) =>
      storage.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: row.object_key })),
    ),
  );
  await pool.query(
    'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
    [quotaAccountId],
  );
  await pool.query(
    'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
    [quotaAccountId],
  );
  await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [
    [accountId, checkoutAccountId, quotaAccountId, tierAccountId],
  ]);
  await pool.end();
  storage.destroy();
  vi.unstubAllEnvs();
});

it('reconciles signed subscription events from current Stripe state and ignores stale subscriptions', async () => {
  stripeMocks.constructEvent.mockReturnValue({
    id: activeEventId,
    created: duplicateTime,
    livemode: false,
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_developer_fixture', customer: stripeCustomerId } },
  });
  await processStripeWebhook('active fixture body', 'valid-fixture-signature');
  await processStripeWebhook('active fixture body', 'valid-fixture-signature');
  let billing = await pool.query(
    `SELECT plan, subscription_status, stripe_subscription_id
       FROM billing_accounts WHERE account_id = $1`,
    [accountId],
  );
  expect(billing.rows[0]).toEqual({
    plan: 'developer',
    subscription_status: 'active',
    stripe_subscription_id: 'sub_developer_fixture',
  });
  expect(
    (await pool.query('SELECT id FROM stripe_events WHERE id = $1', [activeEventId])).rows,
  ).toHaveLength(1);

  stripeMocks.constructEvent.mockReturnValue({
    id: staleEventId,
    created: duplicateTime + 10,
    livemode: false,
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_old_fixture', customer: stripeCustomerId } },
  });
  await processStripeWebhook('stale fixture body', 'valid-fixture-signature');
  billing = await pool.query(
    `SELECT plan, subscription_status, stripe_subscription_id
       FROM billing_accounts WHERE account_id = $1`,
    [accountId],
  );
  expect(billing.rows[0]).toEqual({
    plan: 'developer',
    subscription_status: 'active',
    stripe_subscription_id: 'sub_developer_fixture',
  });
  expect(
    (await pool.query('SELECT id FROM stripe_events WHERE id = $1', [staleEventId])).rows,
  ).toHaveLength(1);
});

it('uses a persisted checkout idempotency key for concurrent session creation', async () => {
  let releaseSession: (session: { id: string; url: string }) => void = () => undefined;
  const sessionPromise = new Promise<{ id: string; url: string }>((resolveSession) => {
    releaseSession = resolveSession;
  });
  stripeMocks.checkoutCreate.mockReturnValue(sessionPromise);

  const first = createCheckout(checkoutAccountId, 'developer');
  await vi.waitFor(() => expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1));
  const second = createCheckout(checkoutAccountId, 'developer');
  await vi.waitFor(() => expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(2));
  releaseSession({ id: 'cs_fixture', url: 'https://checkout.example.test/session' });
  expect(await Promise.all([first, second])).toEqual([
    { url: 'https://checkout.example.test/session' },
    { url: 'https://checkout.example.test/session' },
  ]);

  const [firstParams, firstOptions] = stripeMocks.checkoutCreate.mock.calls[0]!;
  const [secondParams, secondOptions] = stripeMocks.checkoutCreate.mock.calls[1]!;
  expect(firstParams).toMatchObject({
    mode: 'subscription',
    customer: checkoutCustomerId,
    client_reference_id: checkoutAccountId,
    line_items: [
      { price: 'price_developer_fixture', quantity: 1 },
      { price: 'price_usage_fixture' },
    ],
    subscription_data: {
      proration_behavior: 'create_prorations',
      metadata: { accountId: checkoutAccountId, plan: 'developer' },
      billing_cycle_anchor: expect.any(Number),
    },
    success_url: 'https://billing.example.test/console/billing?checkout=success',
    cancel_url: 'https://billing.example.test/console/billing?checkout=cancelled',
  });
  expect(secondParams).toEqual(firstParams);
  expect(firstOptions.idempotencyKey).toEqual(expect.any(String));
  expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey);
  expect(
    (
      await pool.query('SELECT checkout_session_id FROM billing_accounts WHERE account_id = $1', [
        checkoutAccountId,
      ])
    ).rows[0].checkout_session_id,
  ).toBe('cs_fixture');
});

it('updates the existing base item for a paid-tier change and makes repeated targets a no-op', async () => {
  let tier: 'developer' | 'team' = 'developer';
  const subscription = () => ({
    id: tierSubscriptionId,
    customer: tierCustomerId,
    status: 'active',
    items: {
      data: [
        {
          id: 'si_tier_base',
          price: { id: tier === 'developer' ? 'price_developer_fixture' : 'price_team_fixture' },
          quantity: 1,
        },
        { id: 'si_tier_usage', price: { id: 'price_usage_fixture' }, quantity: 1 },
      ],
    },
  });
  stripeMocks.subscriptionRetrieve.mockImplementation(async () => subscription());
  stripeMocks.subscriptionUpdate.mockImplementation(async () => {
    tier = 'team';
    return subscription();
  });

  await expect(createCheckout(tierAccountId, 'team')).resolves.toEqual({ updated: true });
  expect(stripeMocks.subscriptionUpdate).toHaveBeenCalledTimes(1);
  expect(stripeMocks.subscriptionUpdate).toHaveBeenCalledWith(
    tierSubscriptionId,
    {
      items: [{ id: 'si_tier_base', price: 'price_team_fixture', quantity: 1 }],
      proration_behavior: 'create_prorations',
      payment_behavior: 'error_if_incomplete',
    },
    { idempotencyKey: expect.stringMatching(/^tier-change\//u) },
  );
  await expect(createCheckout(tierAccountId, 'team')).resolves.toEqual({ updated: true });
  expect(stripeMocks.subscriptionUpdate).toHaveBeenCalledTimes(1);
  expect(
    (
      await pool.query<{ plan: string }>('SELECT plan FROM billing_accounts WHERE account_id=$1', [
        tierAccountId,
      ])
    ).rows[0]!.plan,
  ).toBe('team');
});

import { describe, expect, it, vi } from 'vitest';
import { goLive } from '../../scripts/stripe-go-live.mjs';

type FakeInput = Record<string, unknown>;
type FakeObject = { id: string } & Record<string, unknown>;

function paginate<T>(items: T[]) {
  return {
    data: items,
    has_more: false,
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function fakeStripe() {
  const state = {
    meters: [] as FakeObject[],
    products: [] as FakeObject[],
    prices: [] as FakeObject[],
    webhooks: [] as FakeObject[],
  };
  const created: string[] = [];
  const deletedWebhooks: string[] = [];
  const params = {
    meters: [] as FakeInput[],
    products: [] as FakeInput[],
    prices: [] as FakeInput[],
    webhooks: [] as FakeInput[],
  };
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${String(++sequence).padStart(8, '0')}`;
  const client = {
    billing: {
      meters: {
        list: (options?: { status?: string }) =>
          paginate(state.meters.filter((m) => !options?.status || m.status === options.status)),
        create: async (input: FakeInput) => {
          created.push('meter');
          params.meters.push(input);
          const meter = { id: nextId('mtr'), status: 'active', ...input };
          state.meters.push(meter);
          return meter;
        },
      },
    },
    products: {
      list: (options?: { active?: boolean }) =>
        paginate(
          state.products.filter(
            (p) => options?.active === undefined || p.active === options.active,
          ),
        ),
      create: async (input: FakeInput) => {
        created.push('product');
        params.products.push(input);
        const product = { id: nextId('prod'), active: true, ...input };
        state.products.push(product);
        return product;
      },
    },
    prices: {
      list: (options?: { lookup_keys?: string[] }) =>
        paginate(
          state.prices.filter(
            (p) =>
              !options?.lookup_keys?.length || options.lookup_keys.includes(p.lookup_key as string),
          ),
        ),
      create: async (input: FakeInput) => {
        created.push('price');
        params.prices.push(input);
        const price = {
          id: nextId('price'),
          active: true,
          transform_quantity: null,
          tiers_mode: null,
          ...input,
        };
        state.prices.push(price);
        return price;
      },
    },
    webhookEndpoints: {
      list: () => paginate(state.webhooks),
      create: async (input: FakeInput) => {
        created.push('webhook');
        params.webhooks.push(input);
        const endpoint = { id: nextId('we'), secret: 'whsec_fake_signing_secret', ...input };
        state.webhooks.push(endpoint);
        return endpoint;
      },
      del: async (id: string) => {
        deletedWebhooks.push(id);
        const index = state.webhooks.findIndex((endpoint) => endpoint.id === id);
        if (index >= 0) state.webhooks.splice(index, 1);
        return { id, deleted: true };
      },
    },
  };
  return { client, state, created, deletedWebhooks, params };
}

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

describe('stripe go-live provisioning', () => {
  it('creates the meter, products, prices and webhook matching billing validation', async () => {
    const fake = fakeStripe();
    const log = vi.fn();
    await goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log });

    expect(fake.created).toEqual([
      'meter',
      'product',
      'price',
      'product',
      'price',
      'product',
      'price',
      'webhook',
    ]);
    expect(fake.params.meters).toEqual([
      {
        display_name: expect.any(String),
        event_name: 'agent_drive_usage',
        default_aggregation: { formula: 'sum' },
        customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
        value_settings: { event_payload_key: 'value' },
      },
    ]);
    expect(fake.params.products).toEqual([
      {
        name: 'Agent Drive Developer',
        metadata: { app: 'agent-drive', price_lookup_key: 'agent_drive_developer_monthly' },
        statement_descriptor: 'AGENT DRIVE',
      },
      {
        name: 'Agent Drive Team',
        metadata: { app: 'agent-drive', price_lookup_key: 'agent_drive_team_monthly' },
        statement_descriptor: 'AGENT DRIVE',
      },
      {
        name: 'Agent Drive Usage',
        metadata: { app: 'agent-drive', price_lookup_key: 'agent_drive_usage_monthly' },
        statement_descriptor: 'AGENT DRIVE',
      },
    ]);
    const meterId = fake.state.meters[0]!.id;
    expect(fake.params.prices).toEqual([
      {
        product: fake.state.products[0]!.id,
        currency: 'usd',
        unit_amount: 2000,
        billing_scheme: 'per_unit',
        lookup_key: 'agent_drive_developer_monthly',
        metadata: { app: 'agent-drive' },
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      },
      {
        product: fake.state.products[1]!.id,
        currency: 'usd',
        unit_amount: 20000,
        billing_scheme: 'per_unit',
        lookup_key: 'agent_drive_team_monthly',
        metadata: { app: 'agent-drive' },
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      },
      {
        product: fake.state.products[2]!.id,
        currency: 'usd',
        unit_amount: 1,
        billing_scheme: 'per_unit',
        lookup_key: 'agent_drive_usage_monthly',
        metadata: { app: 'agent-drive' },
        recurring: {
          interval: 'month',
          interval_count: 1,
          usage_type: 'metered',
          meter: meterId,
        },
      },
    ]);
    expect(fake.params.webhooks).toEqual([
      {
        url: 'https://agentdrive.xyz/api/stripe/webhook',
        enabled_events: WEBHOOK_EVENTS,
      },
    ]);
    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).not.toContain('sk_live_unit_fixture');
    expect(printed).not.toContain('whsec_fake_signing_secret');
  });

  it('finds existing objects and creates nothing on a repeated run', async () => {
    const fake = fakeStripe();
    await goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined });
    const firstRun = fake.created.length;

    await expect(
      goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined }),
    ).rejects.toThrow(/already exists/iu);
    expect(fake.created).toHaveLength(firstRun);
    expect(fake.deletedWebhooks).toEqual([]);
  });

  it('recreates only the webhook endpoint with --replace-webhook', async () => {
    const fake = fakeStripe();
    await goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined });
    const existingEndpoint = fake.state.webhooks[0]!.id;
    const firstRun = fake.created.length;

    await goLive({
      client: fake.client,
      secretKey: 'sk_live_unit_fixture',
      replaceWebhook: true,
      log: () => undefined,
    });

    expect(fake.deletedWebhooks).toEqual([existingEndpoint]);
    expect(fake.created).toHaveLength(firstRun + 1);
    expect(fake.created.at(-1)).toBe('webhook');
    expect(fake.state.webhooks[0]!.id).not.toBe(existingEndpoint);
  });

  it('refuses to proceed when a matching webhook endpoint exists without --replace-webhook', async () => {
    const fake = fakeStripe();
    fake.state.webhooks.push({
      id: 'we_existing',
      url: 'https://agentdrive.xyz/api/stripe/webhook',
    });

    await expect(
      goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined }),
    ).rejects.toThrow(/already exists.*--replace-webhook/su);

    expect(fake.created).toEqual([]);
    expect(fake.deletedWebhooks).toEqual([]);
  });

  it('refuses keys that are not live-mode unless --test is passed', async () => {
    for (const secretKey of ['sk_test_unit', 'rk_live_unit', 'whsec_unit', 'pk_live_unit'])
      await expect(
        goLive({ client: fakeStripe().client, secretKey, log: () => undefined }),
      ).rejects.toThrow(/sk_live_/u);

    await expect(
      goLive({
        client: fakeStripe().client,
        secretKey: 'sk_live_unit_fixture',
        test: true,
        log: () => undefined,
      }),
    ).rejects.toThrow(/sk_test_/u);

    const fake = fakeStripe();
    await expect(
      goLive({
        client: fake.client,
        secretKey: 'sk_test_unit_fixture',
        test: true,
        log: () => undefined,
      }),
    ).resolves.toMatchObject({ mode: 'test' });
    expect(fake.created).toEqual([
      'meter',
      'product',
      'price',
      'product',
      'price',
      'product',
      'price',
      'webhook',
    ]);
  });

  it('previews a dry run without creating anything', async () => {
    const fake = fakeStripe();
    const log = vi.fn();
    await goLive({
      client: fake.client,
      secretKey: 'sk_live_unit_fixture',
      dryRun: true,
      applyVercel: true,
      vercelEnvAdd: async () => {
        throw new Error('vercel must not run during a dry run');
      },
      log,
    });

    expect(fake.created).toEqual([]);
    expect(fake.deletedWebhooks).toEqual([]);
    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toMatch(/dry run/iu);
    expect(printed).toMatch(/would create/iu);
  });

  it('pipes each production env value to vercel env add only with --apply-vercel', async () => {
    const fake = fakeStripe();
    const envCalls: [string, string][] = [];
    await goLive({
      client: fake.client,
      secretKey: 'sk_live_unit_fixture',
      applyVercel: true,
      vercelEnvAdd: async (name: string, value: string) => {
        envCalls.push([name, value]);
      },
      log: () => undefined,
    });

    expect(envCalls.map(([name]) => name)).toEqual([
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_DEVELOPER_PRICE_ID',
      'STRIPE_TEAM_PRICE_ID',
      'STRIPE_USAGE_PRICE_ID',
      'STRIPE_METER_EVENT_NAME',
    ]);
    expect(envCalls.find(([name]) => name === 'STRIPE_SECRET_KEY')).toBeUndefined();
    expect(envCalls.find(([name]) => name === 'STRIPE_DEVELOPER_PRICE_ID')![1]).toBe(
      fake.state.prices[0]!.id,
    );
    expect(envCalls.find(([name]) => name === 'STRIPE_METER_EVENT_NAME')![1]).toBe(
      'agent_drive_usage',
    );

    const second = fakeStripe();
    const vercel = vi.fn();
    await goLive({
      client: second.client,
      secretKey: 'sk_live_unit_fixture',
      vercelEnvAdd: vercel,
      log: () => undefined,
    });
    expect(vercel).not.toHaveBeenCalled();
  });

  it('never touches a webhook endpoint belonging to another product on a shared account', async () => {
    const fake = fakeStripe();
    fake.state.webhooks.push({ id: 'we_freepi', url: 'https://freepi.example.com/hooks/stripe' });

    await goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined });
    expect(fake.state.webhooks.map((endpoint) => endpoint.id)).toContain('we_freepi');

    await goLive({
      client: fake.client,
      secretKey: 'sk_live_unit_fixture',
      replaceWebhook: true,
      log: () => undefined,
    });
    expect(fake.deletedWebhooks).not.toContain('we_freepi');
    expect(fake.state.webhooks.map((endpoint) => endpoint.id)).toContain('we_freepi');
    expect(fake.state.webhooks.map((endpoint) => endpoint.url)).toContain(
      'https://agentdrive.xyz/api/stripe/webhook',
    );
  });

  it('reuses only exact Agent Drive product names or objects tagged app=agent-drive', async () => {
    const fake = fakeStripe();
    fake.state.products.push(
      { id: 'prod_freepi', name: 'FreePi Team', active: true, metadata: { app: 'freepi' } },
      {
        id: 'prod_tagged',
        name: 'Renamed Agent Drive product',
        active: true,
        metadata: { app: 'agent-drive', price_lookup_key: 'agent_drive_team_monthly' },
      },
    );

    await goLive({ client: fake.client, secretKey: 'sk_live_unit_fixture', log: () => undefined });

    const teamPrice = fake.state.prices.find(
      (price) => price.lookup_key === 'agent_drive_team_monthly',
    )!;
    expect(teamPrice.product).toBe('prod_tagged');
    const developerPrice = fake.state.prices.find(
      (price) => price.lookup_key === 'agent_drive_developer_monthly',
    )!;
    expect(developerPrice.product).not.toBe('prod_freepi');
    expect(developerPrice.product).not.toBe('prod_tagged');
    const created = fake.state.products.find((product) => product.id === developerPrice.product)!;
    expect(created.name).toBe('Agent Drive Developer');
    expect(created.metadata).toEqual({
      app: 'agent-drive',
      price_lookup_key: 'agent_drive_developer_monthly',
    });
  });
});

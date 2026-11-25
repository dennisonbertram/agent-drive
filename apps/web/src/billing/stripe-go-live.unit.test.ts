import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { goLive, parseArgs } from '../../scripts/stripe-go-live.mjs';

type FakeInput = Record<string, unknown>;
type FakeObject = { id: string } & Record<string, unknown>;

const WEBHOOK_URL = 'https://agentdrive.xyz/api/stripe/webhook';

function paginate<T>(items: T[]) {
  return {
    data: items,
    has_more: false,
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function linkedRepo(projectName = 'agent-drive') {
  const dir = mkdtempSync(join(tmpdir(), 'stripe-go-live-'));
  mkdirSync(join(dir, '.vercel'));
  writeFileSync(join(dir, '.vercel', 'project.json'), JSON.stringify({ projectName }));
  return dir;
}

function fakeStripe() {
  const state = {
    meters: [] as FakeObject[],
    products: [] as FakeObject[],
    prices: [] as FakeObject[],
    webhooks: [] as FakeObject[],
  };
  const created: string[] = [];
  const events: string[] = [];
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
          events.push('create:meter');
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
      retrieve: async (id: string) => {
        const product = state.products.find((p) => p.id === id);
        if (!product) throw new Error(`No such product: ${id}`);
        return product;
      },
      create: async (input: FakeInput) => {
        created.push('product');
        events.push('create:product');
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
        events.push('create:price');
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
        events.push('create:webhook');
        params.webhooks.push(input);
        const endpoint = {
          id: nextId('we'),
          secret: 'whsec_fake_signing_secret',
          status: 'enabled',
          ...input,
        };
        state.webhooks.push(endpoint);
        return endpoint;
      },
      update: async (id: string, input: FakeInput) => {
        events.push(`update:webhook:${id}`);
        const endpoint = state.webhooks.find((candidate) => candidate.id === id);
        if (!endpoint) throw new Error(`No such webhook endpoint: ${id}`);
        Object.assign(endpoint, input);
        if (input.disabled === true) endpoint.status = 'disabled';
        return endpoint;
      },
      del: async (id: string) => {
        events.push(`del:webhook:${id}`);
        const index = state.webhooks.findIndex((endpoint) => endpoint.id === id);
        if (index >= 0) state.webhooks.splice(index, 1);
        return { id, deleted: true };
      },
    },
  };
  return { client, state, created, events, params };
}

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

const LIVE = 'sk_live_unit_fixture';

describe('stripe go-live provisioning', () => {
  it('creates the meter, products, prices and webhook matching billing validation', async () => {
    const fake = fakeStripe();
    const log = vi.fn();
    await goLive({ client: fake.client, secretKey: LIVE, log });

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
        url: WEBHOOK_URL,
        enabled_events: WEBHOOK_EVENTS,
        metadata: { app: 'agent-drive' },
      },
    ]);
    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).not.toContain(LIVE);
    expect(printed).not.toContain('whsec_fake_signing_secret');
  });

  it('finds existing objects and creates nothing on a repeated run', async () => {
    const fake = fakeStripe();
    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    const firstRun = fake.created.length;

    await expect(
      goLive({ client: fake.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/already exists/iu);
    expect(fake.created).toHaveLength(firstRun);
    expect(fake.state.webhooks).toHaveLength(1);
  });

  it('creates a replacement endpoint with --replace-webhook and disables the old one only after env writes', async () => {
    const fake = fakeStripe();
    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    const oldEndpoint = fake.state.webhooks[0]!.id;
    const firstRun = fake.created.length;

    const envCalls: [string, string][] = [];
    await goLive({
      client: fake.client,
      secretKey: LIVE,
      replaceWebhook: true,
      applyVercel: true,
      repoRoot: linkedRepo(),
      vercelEnvAdd: async (name: string, value: string) => {
        envCalls.push([name, value]);
      },
      log: () => undefined,
    });

    expect(envCalls.map(([name]) => name)).toHaveLength(5);
    expect(fake.created).toHaveLength(firstRun + 1);
    expect(fake.created.at(-1)).toBe('webhook');
    // The old endpoint was disabled after every env write succeeded, never deleted.
    const newEndpoint = fake.state.webhooks.find((endpoint) => endpoint.id !== oldEndpoint)!;
    expect(newEndpoint.status).toBe('enabled');
    expect(fake.state.webhooks.find((endpoint) => endpoint.id === oldEndpoint)!.status).toBe(
      'disabled',
    );
    expect(fake.events.filter((event) => event.startsWith('del:'))).toEqual([]);
    expect(fake.events.indexOf('create:webhook')).toBeLessThan(
      fake.events.indexOf(`update:webhook:${oldEndpoint}`),
    );
  });

  it('leaves the old endpoint enabled when --replace-webhook runs without --apply-vercel', async () => {
    const fake = fakeStripe();
    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    const oldEndpoint = fake.state.webhooks[0]!.id;
    const firstRun = fake.created.length;

    const log = vi.fn();
    await goLive({
      client: fake.client,
      secretKey: LIVE,
      replaceWebhook: true,
      log,
    });

    expect(fake.created).toHaveLength(firstRun + 1);
    expect(fake.created.at(-1)).toBe('webhook');
    expect(fake.state.webhooks).toHaveLength(2);
    expect(fake.state.webhooks.find((endpoint) => endpoint.id === oldEndpoint)!.status).toBe(
      'enabled',
    );
    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toContain(oldEndpoint);
  });

  it('resumes replacement after a failed env write: a rerun replaces the just-created endpoint', async () => {
    const fake = fakeStripe();
    const repoRoot = linkedRepo();
    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    const original = fake.state.webhooks[0]!.id;

    const log = vi.fn();
    let calls = 0;
    await expect(
      goLive({
        client: fake.client,
        secretKey: LIVE,
        replaceWebhook: true,
        applyVercel: true,
        repoRoot,
        vercelEnvAdd: async () => {
          if (++calls === 3) throw new Error('vercel env add failed');
        },
        log,
      }),
    ).rejects.toThrow(/Failed to set Vercel production env STRIPE_TEAM_PRICE_ID/iu);

    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toContain('written: STRIPE_WEBHOOK_SECRET, STRIPE_DEVELOPER_PRICE_ID');
    expect(printed).toContain(
      'not written: STRIPE_TEAM_PRICE_ID, STRIPE_USAGE_PRICE_ID, STRIPE_METER_EVENT_NAME',
    );
    expect(printed).toContain('--replace-webhook');
    expect(printed).not.toContain('whsec_fake_signing_secret');
    // Failure leaves both endpoints enabled and deletes nothing.
    expect(fake.state.webhooks.every((endpoint) => endpoint.status === 'enabled')).toBe(true);
    expect(fake.events.filter((event) => event.startsWith('del:'))).toEqual([]);
    const failedEndpoint = fake.state.webhooks.find((endpoint) => endpoint.id !== original)!.id;

    await goLive({
      client: fake.client,
      secretKey: LIVE,
      replaceWebhook: true,
      applyVercel: true,
      repoRoot,
      vercelEnvAdd: async () => undefined,
      log: () => undefined,
    });
    const enabled = fake.state.webhooks.filter((endpoint) => endpoint.status === 'enabled');
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.id).not.toBe(original);
    expect(enabled[0]!.id).not.toBe(failedEndpoint);
  });

  it('refuses to proceed when a matching webhook endpoint exists without --replace-webhook', async () => {
    const fake = fakeStripe();
    fake.state.webhooks.push({
      id: 'we_existing',
      url: WEBHOOK_URL,
      status: 'enabled',
      metadata: { app: 'agent-drive' },
    });

    await expect(
      goLive({ client: fake.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/already exists.*--replace-webhook/su);

    expect(fake.created).toEqual([]);
  });

  it('stops on an untagged or foreign webhook endpoint at the fixed URL', async () => {
    for (const metadata of [undefined, { app: 'freepi' }]) {
      const fake = fakeStripe();
      fake.state.webhooks.push({ id: 'we_foreign', url: WEBHOOK_URL, status: 'enabled', metadata });
      await expect(
        goLive({
          client: fake.client,
          secretKey: LIVE,
          replaceWebhook: true,
          log: () => undefined,
        }),
      ).rejects.toThrow(/Stripe dashboard/iu);
      expect(fake.created).toEqual([]);
      expect(fake.state.webhooks[0]!.status).toBe('enabled');
    }
  });

  it('ignores a disabled endpoint at the webhook URL and creates a fresh one', async () => {
    const fake = fakeStripe();
    fake.state.webhooks.push({
      id: 'we_disabled',
      url: WEBHOOK_URL,
      status: 'disabled',
      metadata: { app: 'agent-drive' },
    });

    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    expect(fake.state.webhooks).toHaveLength(2);
    expect(fake.state.webhooks.at(-1)!.id).not.toBe('we_disabled');
  });

  it('refuses keys that are not live-mode unless --test is passed', async () => {
    for (const secretKey of ['sk_test_unit', 'rk_live_unit', 'whsec_unit', 'pk_live_unit'])
      await expect(
        goLive({ client: fakeStripe().client, secretKey, log: () => undefined }),
      ).rejects.toThrow(/sk_live_/u);

    await expect(
      goLive({
        client: fakeStripe().client,
        secretKey: LIVE,
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

  it('rejects --test together with --apply-vercel before touching anything', async () => {
    const fake = fakeStripe();
    const vercel = vi.fn();
    await expect(
      goLive({
        client: fake.client,
        secretKey: 'sk_test_unit_fixture',
        test: true,
        applyVercel: true,
        vercelEnvAdd: vercel,
        log: () => undefined,
      }),
    ).rejects.toThrow(/--test.*--apply-vercel/su);
    expect(fake.created).toEqual([]);
    expect(vercel).not.toHaveBeenCalled();
  });

  it('verifies the linked Vercel project before any Stripe write with --apply-vercel', async () => {
    const missing = fakeStripe();
    await expect(
      goLive({
        client: missing.client,
        secretKey: LIVE,
        applyVercel: true,
        repoRoot: mkdtempSync(join(tmpdir(), 'stripe-go-live-unlinked-')),
        vercelEnvAdd: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow(/project\.json/iu);
    expect(missing.created).toEqual([]);

    const wrong = fakeStripe();
    await expect(
      goLive({
        client: wrong.client,
        secretKey: LIVE,
        applyVercel: true,
        repoRoot: linkedRepo('freepi'),
        vercelEnvAdd: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow(/agent-drive/iu);
    expect(wrong.created).toEqual([]);
  });

  it('previews a dry run without creating anything', async () => {
    const fake = fakeStripe();
    const log = vi.fn();
    await goLive({
      client: fake.client,
      secretKey: LIVE,
      dryRun: true,
      applyVercel: true,
      vercelEnvAdd: async () => {
        throw new Error('vercel must not run during a dry run');
      },
      log,
    });

    expect(fake.created).toEqual([]);
    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toMatch(/dry run/iu);
    expect(printed).toMatch(/would create/iu);
  });

  it('pipes each production env value to vercel env add only with --apply-vercel', async () => {
    const fake = fakeStripe();
    const envCalls: [string, string][] = [];
    await goLive({
      client: fake.client,
      secretKey: LIVE,
      applyVercel: true,
      repoRoot: linkedRepo(),
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
      secretKey: LIVE,
      vercelEnvAdd: vercel,
      log: () => undefined,
    });
    expect(vercel).not.toHaveBeenCalled();
  });

  it('never touches a webhook endpoint belonging to another product on a shared account', async () => {
    const fake = fakeStripe();
    fake.state.webhooks.push({ id: 'we_freepi', url: 'https://freepi.example.com/hooks/stripe' });

    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });
    expect(fake.state.webhooks.map((endpoint) => endpoint.id)).toContain('we_freepi');

    await goLive({
      client: fake.client,
      secretKey: LIVE,
      replaceWebhook: true,
      applyVercel: true,
      repoRoot: linkedRepo(),
      vercelEnvAdd: async () => undefined,
      log: () => undefined,
    });
    expect(fake.events.filter((event) => event.includes('we_freepi'))).toEqual([]);
    expect(fake.state.webhooks.find((endpoint) => endpoint.id === 'we_freepi')!.status).not.toBe(
      'disabled',
    );
    expect(fake.state.webhooks.map((endpoint) => endpoint.url)).toContain(WEBHOOK_URL);
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

    await goLive({ client: fake.client, secretKey: LIVE, log: () => undefined });

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

  it('stops when a product uses an Agent Drive name but is tagged with a different app', async () => {
    const fake = fakeStripe();
    fake.state.products.push({
      id: 'prod_squatter',
      name: 'Agent Drive Team',
      active: true,
      metadata: { app: 'freepi' },
    });

    await expect(
      goLive({ client: fake.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/different app|freepi/su);
    expect(
      fake.state.prices.filter((price) => price.lookup_key === 'agent_drive_team_monthly'),
    ).toEqual([]);
  });

  it('stops on ambiguous product matches', async () => {
    const fake = fakeStripe();
    fake.state.products.push(
      { id: 'prod_one', name: 'Agent Drive Team', active: true },
      { id: 'prod_two', name: 'Agent Drive Team', active: true },
    );

    await expect(
      goLive({ client: fake.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/[Mm]ore than one product/);
    expect(
      fake.state.prices.filter((price) => price.lookup_key === 'agent_drive_team_monthly'),
    ).toEqual([]);
  });

  it('reuses a found price only when it and its product belong to Agent Drive', async () => {
    const base = {
      active: true,
      currency: 'usd',
      unit_amount: 20000,
      billing_scheme: 'per_unit',
      transform_quantity: null,
      tiers_mode: null,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      lookup_key: 'agent_drive_team_monthly',
      product: 'prod_team',
    };

    // Price tagged with a different app.
    const taggedPrice = fakeStripe();
    taggedPrice.state.products.push({
      id: 'prod_team',
      name: 'Agent Drive Team',
      active: true,
      metadata: { app: 'agent-drive' },
    });
    taggedPrice.state.prices.push({ id: 'price_foreign', ...base, metadata: { app: 'freepi' } });
    await expect(
      goLive({ client: taggedPrice.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/freepi/iu);

    // Product tagged with a different app.
    const taggedProduct = fakeStripe();
    taggedProduct.state.products.push({
      id: 'prod_team',
      name: 'Agent Drive Team',
      active: true,
      metadata: { app: 'freepi' },
    });
    taggedProduct.state.prices.push({ id: 'price_x', ...base });
    await expect(
      goLive({ client: taggedProduct.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/not the "Agent Drive Team" Agent Drive product/iu);

    // Product with a different name.
    const wrongName = fakeStripe();
    wrongName.state.products.push({ id: 'prod_team', name: 'FreePi Team', active: true });
    wrongName.state.prices.push({ id: 'price_x', ...base });
    await expect(
      goLive({ client: wrongName.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/not the "Agent Drive Team" Agent Drive product/iu);

    // Ambiguous: two prices carry the lookup key.
    const ambiguous = fakeStripe();
    ambiguous.state.prices.push({ id: 'price_a', ...base }, { id: 'price_b', ...base });
    await expect(
      goLive({ client: ambiguous.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/[Mm]ore than one price/);

    // Untagged price on the exact-name untagged product is reused.
    const owned = fakeStripe();
    owned.state.products.push({ id: 'prod_team', name: 'Agent Drive Team', active: true });
    owned.state.prices.push({ id: 'price_reused', ...base });
    const log = vi.fn();
    await goLive({ client: owned.client, secretKey: LIVE, log });
    const teamPrice = owned.state.prices.find(
      (price) => price.lookup_key === 'agent_drive_team_monthly',
    )!;
    expect(teamPrice.id).toBe('price_reused');
    expect(owned.created.filter((kind) => kind === 'price')).toHaveLength(2);
  });

  it('rejects a meter that pre-aggregates events (event_time_window set)', async () => {
    const fake = fakeStripe();
    fake.state.meters.push({
      id: 'mtr_windowed',
      status: 'active',
      event_name: 'agent_drive_usage',
      event_time_window: 'day',
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    });

    await expect(
      goLive({ client: fake.client, secretKey: LIVE, log: () => undefined }),
    ).rejects.toThrow(/event_time_window/iu);
    expect(fake.created).toEqual([]);
  });
});

describe('parseArgs', () => {
  it('names unknown options but never echoes positional arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow('Unknown option: --bogus');
    expect(() => parseArgs(['sk_live_leaked_positional'])).toThrow('Unexpected argument.');
    expect(() => parseArgs(['--meter-event-name'])).toThrow('--meter-event-name requires a value.');
    expect(parseArgs(['--meter-event-name', 'custom_event', '--dry-run'])).toMatchObject({
      meterEventName: 'custom_event',
      dryRun: true,
    });
  });
});

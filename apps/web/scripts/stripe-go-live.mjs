// Creates the live-mode Stripe objects billing expects (meter, products, prices, webhook
// endpoint) and, with --apply-vercel, sets the production STRIPE_* environment variables in
// the linked Vercel project — except STRIPE_SECRET_KEY, which the Vercel Stripe integration
// provisions itself. The secret key is read from STRIPE_SECRET_KEY only; it is never taken
// from argv, printed, or written to disk. Safe to re-run: existing objects are reused.
// The Stripe account may be shared with other products, so everything this script creates is
// tagged metadata.app=agent-drive (meters do not support metadata), existing objects are
// reused only by exact Agent Drive names or that tag, and --replace-webhook can only delete
// the endpoint whose URL is exactly this app's webhook URL.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

const DEFAULT_URL = 'https://agentdrive.xyz';
const DEFAULT_METER_EVENT_NAME = 'agent_drive_usage';
const APP_METADATA_KEY = 'app';
const APP_METADATA_VALUE = 'agent-drive';
const APP_STATEMENT_DESCRIPTOR = 'AGENT DRIVE';
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];
const PRICES = [
  {
    productName: 'Agent Drive Developer',
    lookupKey: 'agent_drive_developer_monthly',
    unitAmount: 2000,
    usageType: 'licensed',
  },
  {
    productName: 'Agent Drive Team',
    lookupKey: 'agent_drive_team_monthly',
    unitAmount: 20000,
    usageType: 'licensed',
  },
  {
    productName: 'Agent Drive Usage',
    lookupKey: 'agent_drive_usage_monthly',
    unitAmount: 1,
    usageType: 'metered',
  },
];

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function defaultVercelEnvAdd(name, value) {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  await new Promise((resolve, reject) => {
    const child = spawn('vercel', ['env', 'add', name, 'production', '--force'], {
      cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vercel env add ${name} production exited with code ${code}.`));
    });
    child.stdin.end(value);
  });
}

function meterProblems(meter, eventName) {
  const problems = [];
  if (meter.event_name !== eventName) problems.push('event_name');
  if (meter.default_aggregation?.formula !== 'sum') problems.push('default_aggregation.formula');
  if (meter.customer_mapping?.type !== 'by_id') problems.push('customer_mapping.type');
  if (meter.customer_mapping?.event_payload_key !== 'stripe_customer_id')
    problems.push('customer_mapping.event_payload_key');
  if (meter.value_settings?.event_payload_key !== 'value')
    problems.push('value_settings.event_payload_key');
  if (meter.status !== 'active') problems.push('status');
  return problems;
}

function priceProblems(price, spec, meterId) {
  const problems = [];
  if (price.active !== true) problems.push('active');
  if (price.currency !== 'usd') problems.push('currency');
  if (price.unit_amount !== spec.unitAmount) problems.push('unit_amount');
  if (price.billing_scheme !== 'per_unit') problems.push('billing_scheme');
  if (price.transform_quantity !== null) problems.push('transform_quantity');
  if (price.tiers_mode !== null) problems.push('tiers_mode');
  if (price.recurring?.interval !== 'month') problems.push('recurring.interval');
  else if (price.recurring.interval_count !== 1) problems.push('recurring.interval_count');
  if (price.recurring?.usage_type !== spec.usageType) problems.push('recurring.usage_type');
  if (spec.usageType === 'metered' && meterId && price.recurring?.meter !== meterId)
    problems.push('recurring.meter');
  return problems;
}

/**
 * @param {object} options
 * @param {any} options.client Stripe client for the target mode (real or injected fake).
 * @param {string} options.secretKey The key, used only to check the required mode.
 * @param {boolean} [options.test] Require an sk_test_ key instead of sk_live_.
 * @param {string} [options.url] Public origin; the endpoint is <url>/api/stripe/webhook.
 * @param {string} [options.meterEventName]
 * @param {boolean} [options.dryRun] Report what would be created without creating.
 * @param {boolean} [options.replaceWebhook] Recreate a matching existing webhook endpoint.
 * @param {boolean} [options.applyVercel] Pipe each STRIPE_* value to `vercel env add`.
 * @param {(name: string, value: string) => Promise<void>} [options.vercelEnvAdd]
 * @param {(line: string) => void} [options.log]
 */
export async function goLive({
  client,
  secretKey,
  test = false,
  url = DEFAULT_URL,
  meterEventName = DEFAULT_METER_EVENT_NAME,
  dryRun = false,
  replaceWebhook = false,
  applyVercel = false,
  vercelEnvAdd = defaultVercelEnvAdd,
  log = (line) => console.log(line),
} = {}) {
  const required = test ? 'sk_test_' : 'sk_live_';
  if (!secretKey?.startsWith(required))
    throw new Error(
      `STRIPE_SECRET_KEY must start with ${required}${test ? ' when --test is passed' : ''}.` +
        (test ? '' : ' Pass --test to provision a test-mode sandbox instead.'),
    );
  const webhookUrl = new URL('/api/stripe/webhook', url).toString();
  const report = { mode: test ? 'test' : 'live', dryRun, steps: [], env: [] };
  const step = (line) => {
    report.steps.push(line);
    log(`  ${line}`);
  };

  log(`Stripe go-live (${report.mode} mode${dryRun ? ', dry run' : ''})`);

  const existingEndpoint = (await collect(client.webhookEndpoints.list({ limit: 100 }))).find(
    (endpoint) => endpoint.url === webhookUrl,
  );
  if (existingEndpoint && !replaceWebhook)
    throw new Error(
      `A webhook endpoint for ${webhookUrl} already exists (${existingEndpoint.id}). ` +
        'Stripe returns the signing secret only when the endpoint is created; re-run with ' +
        '--replace-webhook to delete that endpoint and create a new one, or copy its secret ' +
        'from the Stripe dashboard and set STRIPE_WEBHOOK_SECRET yourself.',
    );

  let meter = (await collect(client.billing.meters.list({ status: 'active', limit: 100 }))).find(
    (candidate) => candidate.event_name === meterEventName,
  );
  if (meter) {
    const problems = meterProblems(meter, meterEventName);
    if (problems.length)
      throw new Error(
        `Billing meter ${meter.id} for event ${meterEventName} does not match the required ` +
          `configuration (${problems.join(', ')}). Meters cannot be reconfigured; fix it in the ` +
          'Stripe dashboard or pass --meter-event-name for a different event.',
      );
    step(`meter ${meter.id} (existing)`);
  } else if (dryRun) {
    step(`would create meter for event ${meterEventName}`);
  } else {
    meter = await client.billing.meters.create({
      display_name: 'Agent Drive usage',
      event_name: meterEventName,
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    });
    step(`meter ${meter.id} (created)`);
  }

  const products = await collect(client.products.list({ active: true, limit: 100 }));
  const prices = {};
  for (const spec of PRICES) {
    const existing = (await collect(client.prices.list({ lookup_keys: [spec.lookupKey] }))).find(
      (price) => price.lookup_key === spec.lookupKey,
    );
    if (existing) {
      const problems = priceProblems(existing, spec, meter?.id);
      if (problems.length)
        throw new Error(
          `Price ${existing.id} with lookup_key ${spec.lookupKey} does not match the ` +
            `required configuration (${problems.join(', ')}). Prices cannot be edited; ` +
            'retire it in Stripe and re-run to create a replacement.',
        );
      prices[spec.lookupKey] = existing;
      step(`price ${existing.id} ${spec.lookupKey} (existing)`);
      continue;
    }
    const product = products.find(
      (candidate) =>
        candidate.name === spec.productName ||
        (candidate.metadata?.[APP_METADATA_KEY] === APP_METADATA_VALUE &&
          candidate.metadata?.price_lookup_key === spec.lookupKey),
    );
    if (dryRun) {
      step(
        `would ${product ? 'reuse' : 'create'} product "${spec.productName}" and create price ` +
          `${spec.lookupKey} ($${spec.unitAmount / 100}/unit, ${spec.usageType})`,
      );
      continue;
    }
    const productId =
      product?.id ??
      (
        await client.products.create({
          name: spec.productName,
          metadata: { [APP_METADATA_KEY]: APP_METADATA_VALUE, price_lookup_key: spec.lookupKey },
          statement_descriptor: APP_STATEMENT_DESCRIPTOR,
        })
      ).id;
    if (!product) step(`product ${productId} "${spec.productName}" (created)`);
    const price = await client.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: spec.unitAmount,
      billing_scheme: 'per_unit',
      lookup_key: spec.lookupKey,
      metadata: { [APP_METADATA_KEY]: APP_METADATA_VALUE },
      recurring: {
        interval: 'month',
        interval_count: 1,
        usage_type: spec.usageType,
        ...(spec.usageType === 'metered' ? { meter: meter.id } : {}),
      },
    });
    prices[spec.lookupKey] = price;
    step(`price ${price.id} ${spec.lookupKey} (created)`);
  }

  let webhookSecret = null;
  let endpoint = null;
  if (existingEndpoint) {
    if (dryRun) step(`would delete webhook ${existingEndpoint.id} and create a replacement`);
    else {
      if (existingEndpoint.url !== webhookUrl)
        throw new Error(`Refusing to delete webhook ${existingEndpoint.id} for a different URL.`);
      await client.webhookEndpoints.del(existingEndpoint.id);
      step(`webhook ${existingEndpoint.id} (deleted for replacement)`);
    }
  }
  if (dryRun) {
    if (!existingEndpoint) step(`would create webhook ${webhookUrl}`);
  } else {
    endpoint = await client.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
    });
    webhookSecret = endpoint.secret ?? null;
    step(`webhook ${endpoint.id} for ${webhookUrl} (created)`);
  }

  if (applyVercel && !dryRun) {
    if (!webhookSecret)
      throw new Error('The webhook signing secret is unavailable; cannot set Vercel env vars.');
    const env = {
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_DEVELOPER_PRICE_ID: prices.agent_drive_developer_monthly.id,
      STRIPE_TEAM_PRICE_ID: prices.agent_drive_team_monthly.id,
      STRIPE_USAGE_PRICE_ID: prices.agent_drive_usage_monthly.id,
      STRIPE_METER_EVENT_NAME: meterEventName,
    };
    for (const [name, value] of Object.entries(env)) {
      await vercelEnvAdd(name, value);
      report.env.push(name);
      step(`vercel production env ${name} (set)`);
    }
    step('STRIPE_SECRET_KEY is managed by the Vercel Stripe integration (unchanged)');
  } else if (applyVercel) {
    for (const name of [
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_DEVELOPER_PRICE_ID',
      'STRIPE_TEAM_PRICE_ID',
      'STRIPE_USAGE_PRICE_ID',
      'STRIPE_METER_EVENT_NAME',
    ])
      step(`would set vercel production env ${name}`);
    step('STRIPE_SECRET_KEY is managed by the Vercel Stripe integration (unchanged)');
  }

  if (!dryRun) {
    log('Summary:');
    log(`  meter: ${meter.id}`);
    log(`  developer price: ${prices.agent_drive_developer_monthly.id}`);
    log(`  team price: ${prices.agent_drive_team_monthly.id}`);
    log(`  usage price: ${prices.agent_drive_usage_monthly.id}`);
    log(`  webhook endpoint: ${endpoint.id}`);
    if (webhookSecret && !applyVercel)
      log(
        '  webhook signing secret was not stored; retrieve it in the Stripe dashboard or ' +
          're-run with --replace-webhook --apply-vercel to store it in Vercel.',
      );
    log('  redeploy production for the new STRIPE_* variables to take effect.');
  }
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--test') options.test = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace-webhook') options.replaceWebhook = true;
    else if (arg === '--apply-vercel') options.applyVercel = true;
    else if (arg === '--url') options.url = argv[++index];
    else if (arg === '--meter-event-name') options.meterEventName = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.url === undefined && argv.includes('--url'))
    throw new Error('--url requires a value.');
  if (options.meterEventName === undefined && argv.includes('--meter-event-name'))
    throw new Error('--meter-event-name requires a value.');
  return options;
}

const USAGE = `Usage: STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-go-live.mjs [options]

Options:
  --test                 require an sk_test_ key instead of sk_live_
  --url URL              public origin for the webhook endpoint (default ${DEFAULT_URL})
  --meter-event-name N   billing meter event name (default ${DEFAULT_METER_EVENT_NAME})
  --replace-webhook      delete the webhook endpoint matching <url>/api/stripe/webhook and recreate it
  --apply-vercel         pipe STRIPE_* values (except STRIPE_SECRET_KEY, managed by the Vercel
                         Stripe integration) on stdin to 'vercel env add ... production --force'
  --dry-run              list what would be created without creating anything
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey)
      throw new Error(
        'STRIPE_SECRET_KEY must be set in the environment. It is read from the ' +
          'environment only; never pass it as an argument.',
      );
    const client = new Stripe(secretKey);
    await goLive({ client, secretKey, ...options });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

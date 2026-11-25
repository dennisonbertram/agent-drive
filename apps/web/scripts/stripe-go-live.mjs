// Creates the live-mode Stripe objects billing expects (meter, products, prices, webhook
// endpoint) and, with --apply-vercel, sets the production STRIPE_* environment variables in
// the linked Vercel project — except STRIPE_SECRET_KEY, which the Vercel Stripe integration
// provisions itself. The secret key is read from STRIPE_SECRET_KEY only; it is never taken
// from argv, printed, passed to the vercel child's environment, or written to disk.
// Safe to re-run: existing objects are reused. The Stripe account may be shared with other
// products, so everything this script creates is tagged metadata.app=agent-drive (meters do
// not support metadata), existing objects are reused only by exact Agent Drive names or that
// tag, and --replace-webhook only ever disables endpoints tagged app=agent-drive.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

const WEBHOOK_URL = 'https://agentdrive.xyz/api/stripe/webhook';
const DEFAULT_METER_EVENT_NAME = 'agent_drive_usage';
const APP_METADATA_KEY = 'app';
const APP_METADATA_VALUE = 'agent-drive';
const APP_STATEMENT_DESCRIPTOR = 'AGENT DRIVE';
const EXPECTED_VERCEL_PROJECT = 'agent-drive';
// `vercel` must run from the repository root, where `vercel link` writes .vercel/project.json.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERCEL_ENV_NAMES = [
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_DEVELOPER_PRICE_ID',
  'STRIPE_TEAM_PRICE_ID',
  'STRIPE_USAGE_PRICE_ID',
  'STRIPE_METER_EVENT_NAME',
];
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

async function defaultVercelEnvAdd(name, value, repoRoot) {
  await new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    // The Stripe secret key must not reach the vercel child's environment.
    delete childEnv.STRIPE_SECRET_KEY;
    const child = spawn('vercel', ['env', 'add', name, 'production', '--force'], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    // An early vercel exit makes stdin fail with EPIPE; route it through the same failure path.
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vercel env add ${name} production exited with code ${code}.`));
    });
    child.stdin.end(value);
  });
}

async function verifyVercelLink(repoRoot) {
  const linkPath = path.join(repoRoot, '.vercel', 'project.json');
  let project;
  try {
    project = JSON.parse(await readFile(linkPath, 'utf8'));
  } catch {
    throw new Error(
      `Cannot verify the Vercel project link: ${linkPath} is missing or unreadable. ` +
        'Link the repository root to the agent-drive project (vercel link) before using --apply-vercel.',
    );
  }
  if (project?.projectName !== EXPECTED_VERCEL_PROJECT)
    throw new Error(
      `${linkPath} names project "${project?.projectName}", not "${EXPECTED_VERCEL_PROJECT}". ` +
        'Refusing to write production environment variables into the wrong Vercel project.',
    );
}

function meterProblems(meter, eventName) {
  const problems = [];
  if (meter.event_name !== eventName) problems.push('event_name');
  if (meter.event_time_window !== null && meter.event_time_window !== undefined)
    problems.push('event_time_window');
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

function foreignAppTag(metadata) {
  const tag = metadata?.[APP_METADATA_KEY];
  return tag !== undefined && tag !== APP_METADATA_VALUE;
}

/**
 * @param {object} options
 * @param {any} options.client Stripe client for the target mode (real or injected fake).
 * @param {string} options.secretKey The key, used only to check the required mode.
 * @param {boolean} [options.test] Require an sk_test_ key instead of sk_live_.
 * @param {string} [options.meterEventName]
 * @param {boolean} [options.dryRun] Report what would be created without creating.
 * @param {boolean} [options.replaceWebhook] Replace the tagged endpoint at the fixed webhook URL.
 * @param {boolean} [options.applyVercel] Pipe each STRIPE_* value to `vercel env add`.
 * @param {(name: string, value: string) => Promise<void>} [options.vercelEnvAdd]
 * @param {string} [options.repoRoot] Repo root holding .vercel/project.json (vercel cwd).
 * @param {(line: string) => void} [options.log]
 */
export async function goLive({
  client,
  secretKey,
  test = false,
  meterEventName = DEFAULT_METER_EVENT_NAME,
  dryRun = false,
  replaceWebhook = false,
  applyVercel = false,
  vercelEnvAdd,
  repoRoot = REPO_ROOT,
  log = (line) => console.log(line),
} = {}) {
  const required = test ? 'sk_test_' : 'sk_live_';
  if (!secretKey?.startsWith(required))
    throw new Error(
      `STRIPE_SECRET_KEY must start with ${required}${test ? ' when --test is passed' : ''}.` +
        (test ? '' : ' Pass --test to provision a test-mode sandbox instead.'),
    );
  if (test && applyVercel)
    throw new Error(
      '--test cannot be combined with --apply-vercel: test-mode objects must not be ' +
        'written to the production Vercel project.',
    );
  // Single-operator tool: idempotency across concurrent invocations is intentionally not enforced.
  if (applyVercel && !dryRun) await verifyVercelLink(repoRoot);
  const envAdd = vercelEnvAdd ?? ((name, value) => defaultVercelEnvAdd(name, value, repoRoot));
  const report = { mode: test ? 'test' : 'live', dryRun, steps: [], env: [] };
  const step = (line) => {
    report.steps.push(line);
    log(`  ${line}`);
  };

  log(`Stripe go-live (${report.mode} mode${dryRun ? ', dry run' : ''})`);

  const endpoints = await collect(client.webhookEndpoints.list({ limit: 100 }));
  const atUrl = endpoints.filter(
    (endpoint) => endpoint.url === WEBHOOK_URL && endpoint.status !== 'disabled',
  );
  const foreign = atUrl.filter(
    (endpoint) => endpoint.metadata?.[APP_METADATA_KEY] !== APP_METADATA_VALUE,
  );
  if (foreign.length)
    throw new Error(
      `Webhook endpoint(s) ${foreign.map((endpoint) => endpoint.id).join(', ')} already exist ` +
        `for ${WEBHOOK_URL} but are not tagged metadata.app=${APP_METADATA_VALUE}. This script ` +
        'only manages endpoints it tags; remove them in the Stripe dashboard and re-run.',
    );
  const existingEndpoints = atUrl;
  if (existingEndpoints.length && !replaceWebhook)
    throw new Error(
      `A webhook endpoint for ${WEBHOOK_URL} already exists ` +
        `(${existingEndpoints.map((endpoint) => endpoint.id).join(', ')}). ` +
        'Stripe returns the signing secret only when the endpoint is created; re-run with ' +
        '--replace-webhook to create a replacement and disable the old one once the new secret ' +
        'is stored in Vercel, or copy its secret from the Stripe dashboard and set ' +
        'STRIPE_WEBHOOK_SECRET yourself.',
    );

  const meters = (
    await collect(client.billing.meters.list({ status: 'active', limit: 100 }))
  ).filter((candidate) => candidate.event_name === meterEventName);
  if (meters.length > 1)
    throw new Error(
      `More than one active billing meter emits event ${meterEventName} ` +
        `(${meters.map((meter) => meter.id).join(', ')}). Remove the duplicates in the Stripe ` +
        'dashboard or pass --meter-event-name for a different event.',
    );
  let meter = meters[0];
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
    const matched = (await collect(client.prices.list({ lookup_keys: [spec.lookupKey] }))).filter(
      (price) => price.lookup_key === spec.lookupKey,
    );
    if (matched.length > 1)
      throw new Error(
        `More than one price carries lookup_key ${spec.lookupKey} ` +
          `(${matched.map((price) => price.id).join(', ')}). Resolve the duplicates in the ` +
          'Stripe dashboard and re-run.',
      );
    const existing = matched[0];
    if (existing) {
      const priceTag = existing.metadata?.[APP_METADATA_KEY];
      if (priceTag !== undefined && priceTag !== APP_METADATA_VALUE)
        throw new Error(
          `Price ${existing.id} with lookup_key ${spec.lookupKey} is tagged ` +
            `metadata.app=${priceTag}, so it belongs to a different app. Resolve the lookup key ` +
            'conflict in the Stripe dashboard and re-run.',
        );
      const productId =
        typeof existing.product === 'string' ? existing.product : existing.product?.id;
      const product =
        products.find((candidate) => candidate.id === productId) ??
        (productId ? await client.products.retrieve(productId) : null);
      if (!product || product.name !== spec.productName || foreignAppTag(product.metadata))
        throw new Error(
          `Price ${existing.id} with lookup_key ${spec.lookupKey} belongs to product ` +
            `${productId} ("${product?.name ?? 'unknown'}"), which is not the "${spec.productName}" ` +
            'Agent Drive product. Reconcile it in the Stripe dashboard and re-run.',
        );
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
    const foreignNamed = products.filter(
      (candidate) => candidate.name === spec.productName && foreignAppTag(candidate.metadata),
    );
    if (foreignNamed.length)
      throw new Error(
        `Product ${foreignNamed.map((candidate) => candidate.id).join(', ')} is named ` +
          `"${spec.productName}" but tagged metadata.app=${foreignNamed[0].metadata[APP_METADATA_KEY]}, ` +
          'so it belongs to a different app. Resolve the name conflict in the Stripe dashboard ' +
          'and re-run.',
      );
    const candidates = products.filter(
      (candidate) =>
        candidate.name === spec.productName ||
        (candidate.metadata?.[APP_METADATA_KEY] === APP_METADATA_VALUE &&
          candidate.metadata?.price_lookup_key === spec.lookupKey),
    );
    if (candidates.length > 1)
      throw new Error(
        `More than one product matches "${spec.productName}" ` +
          `(${candidates.map((candidate) => candidate.id).join(', ')}). Remove the ambiguous ` +
          'products in the Stripe dashboard and re-run.',
      );
    const product = candidates[0];
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
  if (dryRun) {
    if (existingEndpoints.length)
      step(
        `would create a replacement webhook for ${WEBHOOK_URL}, set the Vercel env vars, then ` +
          `disable ${existingEndpoints.map((existing) => existing.id).join(', ')}`,
      );
    else step(`would create webhook ${WEBHOOK_URL}`);
  } else {
    endpoint = await client.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: WEBHOOK_EVENTS,
      metadata: { [APP_METADATA_KEY]: APP_METADATA_VALUE },
    });
    webhookSecret = endpoint.secret ?? null;
    step(`webhook ${endpoint.id} for ${WEBHOOK_URL} (created)`);
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
    const written = [];
    for (const name of VERCEL_ENV_NAMES) {
      try {
        await envAdd(name, env[name]);
      } catch {
        const notWritten = VERCEL_ENV_NAMES.filter((pending) => !written.includes(pending));
        log(`Failed to write Vercel production env ${name}; see the vercel output above.`);
        log(`  written: ${written.length ? written.join(', ') : '(none)'}`);
        log(`  not written: ${notWritten.join(', ')}`);
        log(
          'Both webhook endpoints were left enabled, so production keeps working with the ' +
            'previous endpoint.',
        );
        log(
          'Recovery: fix the vercel error, then re-run this script with --replace-webhook — ' +
            'it replaces the endpoint just created and retries every env write.',
        );
        throw new Error(`Failed to set Vercel production env ${name}.`);
      }
      written.push(name);
      report.env.push(name);
      step(`vercel production env ${name} (set)`);
    }
    step('STRIPE_SECRET_KEY is managed by the Vercel Stripe integration (unchanged)');
    // The old endpoint is disabled — never deleted — only once production holds the new secret.
    for (const old of existingEndpoints) {
      await client.webhookEndpoints.update(old.id, { disabled: true });
      step(`webhook ${old.id} (disabled; delete it in the Stripe dashboard after the redeploy)`);
    }
  } else if (applyVercel) {
    for (const name of VERCEL_ENV_NAMES) step(`would set vercel production env ${name}`);
    step('STRIPE_SECRET_KEY is managed by the Vercel Stripe integration (unchanged)');
    if (existingEndpoints.length)
      step(
        `would then disable webhook ${existingEndpoints.map((existing) => existing.id).join(', ')}`,
      );
  }

  if (!dryRun) {
    log('Summary:');
    log(`  meter: ${meter.id}`);
    log(`  developer price: ${prices.agent_drive_developer_monthly.id}`);
    log(`  team price: ${prices.agent_drive_team_monthly.id}`);
    log(`  usage price: ${prices.agent_drive_usage_monthly.id}`);
    log(`  webhook endpoint: ${endpoint.id}`);
    if (existingEndpoints.length) {
      if (applyVercel)
        log(
          `  replaced endpoint(s) ${existingEndpoints
            .map((existing) => existing.id)
            .join(', ')} were disabled; delete them in the Stripe dashboard after the redeploy.`,
        );
      else
        log(
          `  replaced endpoint(s) ${existingEndpoints
            .map((existing) => existing.id)
            .join(', ')} are still enabled; set STRIPE_WEBHOOK_SECRET from the Stripe ` +
            'dashboard, then disable them there.',
        );
    }
    if (webhookSecret && !applyVercel)
      log(
        '  webhook signing secret was not stored; retrieve it in the Stripe dashboard or ' +
          're-run with --replace-webhook --apply-vercel to store it in Vercel.',
      );
    log('  redeploy production for the new STRIPE_* variables to take effect.');
  }
  return report;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--test') options.test = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace-webhook') options.replaceWebhook = true;
    else if (arg === '--apply-vercel') options.applyVercel = true;
    else if (arg === '--meter-event-name') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--'))
        throw new Error('--meter-event-name requires a value.');
      options.meterEventName = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else throw new Error('Unexpected argument.');
  }
  return options;
}

const USAGE = `Usage: STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-go-live.mjs [options]

Options:
  --test                 require an sk_test_ key instead of sk_live_ (cannot be combined
                         with --apply-vercel)
  --meter-event-name N   billing meter event name (default ${DEFAULT_METER_EVENT_NAME})
  --replace-webhook      create a replacement for the tagged endpoint at ${WEBHOOK_URL};
                         after every Vercel env write succeeds the old endpoint is disabled
                         (never deleted) so the operator can remove it after the redeploy
  --apply-vercel         pipe STRIPE_* values (except STRIPE_SECRET_KEY, managed by the Vercel
                         Stripe integration) on stdin to 'vercel env add ... production --force',
                         run from the repository root; requires .vercel/project.json to link
                         the ${EXPECTED_VERCEL_PROJECT} project
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

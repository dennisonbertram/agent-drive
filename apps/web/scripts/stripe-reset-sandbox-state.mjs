// One-time helper for the sandbox-to-live Stripe cutover. Production checkout was developed
// against a Vercel-provisioned Stripe sandbox, so billing_accounts can hold sandbox customer,
// subscription, and checkout pointers that the live-mode webhook can never match. This script
// clears those pointers in a single transaction. Pending meter reports are never deleted: they
// are parked as abandoned (aged past the 23-hour retry window with an explanatory last_error)
// so the owner can review and remove them manually. --dry-run is the default and only lists
// what would change; --apply requires --confirm-sandbox-only. Reads DATABASE_URL from the
// environment only; the URL is never printed.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const ABANDONED_NOTE =
  'Abandoned by stripe:reset-sandbox-state before the Stripe go-live; this pending sandbox ' +
  'report was never delivered to the live account. Delete the row manually after owner review.';

const NULLABLE_FIELDS = [
  'stripe_customer_id',
  'stripe_subscription_id',
  'subscription_status',
  'checkout_idempotency_key',
  'checkout_session_id',
  'checkout_created_at',
];

const DIRTY_WHERE = NULLABLE_FIELDS.map((field) => `${field} IS NOT NULL`)
  .concat("plan <> 'free'")
  .join(' OR ');

/**
 * @param {object} options
 * @param {string} [options.databaseUrl] Postgres connection string (DATABASE_URL).
 * @param {boolean} [options.apply] Write the reset; without it this is a dry run.
 * @param {boolean} [options.confirmSandboxOnly] Required together with apply.
 * @param {(line: string) => void} [options.log]
 */
export async function resetSandboxState({
  databaseUrl,
  apply = false,
  confirmSandboxOnly = false,
  log = (line) => console.log(line),
} = {}) {
  if (apply && !confirmSandboxOnly)
    throw new Error(
      'Refusing to modify billing state: --apply requires --confirm-sandbox-only. This script ' +
        'is only for the one-time sandbox-to-live cutover; run it without --apply first and ' +
        'have the owner approve the listed rows.',
    );
  if (!databaseUrl) throw new Error('DATABASE_URL must be set in the environment.');

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const accounts = await client.query(
        `SELECT ba.account_id, a.name, ba.plan, ba.stripe_customer_id, ba.stripe_subscription_id,
                ba.subscription_status, ba.checkout_idempotency_key, ba.checkout_session_id,
                ba.checkout_created_at
           FROM billing_accounts ba JOIN accounts a ON a.id = ba.account_id
          WHERE ${DIRTY_WHERE}
          ORDER BY a.name, ba.account_id`,
      );
      const reports = await client.query(
        `SELECT r.id, r.account_id, a.name AS account_name, r.stripe_customer_id,
                r.cents::text AS cents, r.period_start, r.created_at
           FROM billing_meter_reports r JOIN accounts a ON a.id = r.account_id
          WHERE r.reported_at IS NULL
          ORDER BY a.name, r.account_id, r.created_at`,
      );

      log(
        `Stripe sandbox reset (${apply ? 'applying' : 'dry run'}): ${accounts.rowCount} billing ` +
          `account(s), ${reports.rowCount} pending meter report(s)`,
      );
      const reportsByAccount = new Map();
      for (const report of reports.rows) {
        const list = reportsByAccount.get(report.account_id) ?? [];
        list.push(report);
        reportsByAccount.set(report.account_id, list);
      }
      const seen = new Set();
      const printReport = (report) =>
        log(
          `    pending meter report ${report.id}: ${report.cents} cents for ` +
            `${report.stripe_customer_id} (created ${report.created_at.toISOString?.() ?? report.created_at}) -> abandoned`,
        );
      for (const account of accounts.rows) {
        seen.add(account.account_id);
        log(`  account ${account.account_id} "${account.name}"`);
        if (account.plan !== 'free') log(`    plan: ${account.plan} -> free`);
        for (const field of NULLABLE_FIELDS) {
          const value = account[field];
          if (value !== null && value !== undefined)
            log(`    ${field}: ${value instanceof Date ? value.toISOString() : value} -> NULL`);
        }
        for (const report of reportsByAccount.get(account.account_id) ?? []) printReport(report);
      }
      for (const report of reports.rows) {
        if (seen.has(report.account_id)) continue;
        seen.add(report.account_id);
        log(`  account ${report.account_id} "${report.account_name}"`);
        printReport(report);
      }
      if (reports.rowCount)
        log(
          '  Pending meter reports are parked as abandoned, never deleted; delete them ' +
            'manually in the database after owner review.',
        );

      if (apply) {
        const nulled = await client.query(
          `UPDATE billing_accounts
              SET stripe_customer_id = NULL, stripe_subscription_id = NULL,
                  subscription_status = NULL, checkout_idempotency_key = NULL,
                  checkout_session_id = NULL, checkout_created_at = NULL
            WHERE ${NULLABLE_FIELDS.map((field) => `${field} IS NOT NULL`).join(' OR ')}`,
        );
        const freed = await client.query(
          "UPDATE billing_accounts SET plan = 'free' WHERE plan <> 'free'",
        );
        const abandoned = await client.query(
          `UPDATE billing_meter_reports
              SET first_attempt_at = clock_timestamp() - interval '24 hours',
                  lease_until = NULL, last_error = $1
            WHERE reported_at IS NULL`,
          [ABANDONED_NOTE],
        );
        await client.query('COMMIT');
        log(
          `Applied: ${nulled.rowCount} billing row(s) cleared, ${freed.rowCount} plan(s) ` +
            `set to free, ${abandoned.rowCount} meter report(s) abandoned.`,
        );
      } else {
        await client.query('ROLLBACK');
        log('Dry run only; re-run with --apply --confirm-sandbox-only to apply.');
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The transaction may already be closed; the original error is what matters.
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const USAGE = `Usage: DATABASE_URL=postgres://... node scripts/stripe-reset-sandbox-state.mjs [options]

Options:
  --dry-run               list the rows that would be reset (default)
  --apply                 clear the sandbox pointers in one transaction
  --confirm-sandbox-only  required together with --apply; confirms the target is the
                          pre-live sandbox deployment, never a live one
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      if (arg === '--apply') options.apply = true;
      else if (arg === '--dry-run') options.dryRun = true;
      else if (arg === '--confirm-sandbox-only') options.confirmSandboxOnly = true;
      else if (arg === '--help' || arg === '-h') options.help = true;
      else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
      else throw new Error('Unexpected argument.');
    }
    if (options.help) {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (options.apply && options.dryRun)
      throw new Error('--apply and --dry-run are mutually exclusive.');
    await resetSandboxState({ databaseUrl: process.env.DATABASE_URL, ...options });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

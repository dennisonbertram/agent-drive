import { getPool } from '../db/client';
import {
  attestMeterReportAccepted,
  inspectBillingReconciliation,
  inspectMeterReport,
  recoverCheckoutSession,
  replayMeterReport,
} from './reconcile';
import { findCheckoutRecoverySession } from './providers';

type Options = {
  accountId?: string;
  reportId?: string;
  retryReport: boolean;
  attestAccepted: boolean;
  providerRequestId?: string;
  providerLogVerified: boolean;
  recoverCheckout: boolean;
  apply: boolean;
  operatorId?: string;
  help: boolean;
};

function parseArgs(args: string[]): Options {
  const options: Options = {
    retryReport: false,
    attestAccepted: false,
    providerLogVerified: false,
    recoverCheckout: false,
    apply: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--retry-report') options.retryReport = true;
    else if (arg === '--attest-accepted') options.attestAccepted = true;
    else if (arg === '--provider-log-verified') options.providerLogVerified = true;
    else if (arg === '--recover-checkout') options.recoverCheckout = true;
    else if (arg === '--apply') options.apply = true;
    else if (
      ['--account-id', '--report-id', '--provider-request-id', '--operator-id'].includes(arg)
    ) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--account-id') options.accountId = value;
      if (arg === '--report-id') options.reportId = value;
      if (arg === '--provider-request-id') options.providerRequestId = value;
      if (arg === '--operator-id') options.operatorId = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function help() {
  console.log(`Billing reconciliation (dry-run by default)

List blocked work:
  pnpm --filter @agent-drive/web billing:reconcile -- [--account-id <uuid>]

Replay one report while it remains inside the 23-hour Stripe idempotency window:
  pnpm --filter @agent-drive/web billing:reconcile -- --report-id <uuid> --retry-report [--apply]

Record an operator attestation after verifying the exact successful request in Stripe request logs:
  pnpm --filter @agent-drive/web billing:reconcile -- --report-id <uuid> --attest-accepted \\
    --provider-request-id <req_id> --provider-log-verified [--apply]

Recover a checkout reservation only when Stripe returns one unique matching session:
  pnpm --filter @agent-drive/web billing:reconcile -- --account-id <uuid> --recover-checkout [--apply]

For --apply, set BILLING_OPERATOR_ID or pass --operator-id <approved-operator-id>.
The operator attestation path records that a person checked the Stripe request log; this command
does not fetch request logs or claim independent provider verification. Ambiguous work stays blocked.`);
}

function requireUuid(value: string | undefined, option: string) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
    throw new Error(`${option} must be a UUID.`);
  return value;
}

async function run() {
  const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== '--'));
  if (options.help) return help();
  const actions = [options.retryReport, options.attestAccepted, options.recoverCheckout].filter(
    Boolean,
  ).length;
  if (actions > 1) throw new Error('Choose one reconciliation action at a time.');
  if (options.attestAccepted && (!options.providerRequestId || !options.providerLogVerified))
    throw new Error(
      '--attest-accepted requires --provider-request-id and --provider-log-verified.',
    );
  if (!options.attestAccepted && (options.providerRequestId || options.providerLogVerified))
    throw new Error('Provider request log flags are only valid with --attest-accepted.');

  if (options.retryReport || options.attestAccepted) {
    const reportId = requireUuid(options.reportId, '--report-id');
    const operatorId = options.operatorId ?? process.env.BILLING_OPERATOR_ID;
    if (options.apply && !operatorId)
      throw new Error('Set BILLING_OPERATOR_ID or pass --operator-id before applying changes.');
    if (options.attestAccepted) {
      const row = await inspectMeterReport(reportId);
      if (!row) throw new Error('No unresolved meter report was found with that ID.');
      if (row.status === 'reported') {
        console.log(
          JSON.stringify({ mode: 'read-only', status: 'already-reported', report: row }, null, 2),
        );
        return;
      }
      if (!options.apply) {
        console.log(
          JSON.stringify(
            {
              mode: 'dry-run',
              action: 'operator-confirmed meter-event acceptance attestation',
              operatorId: operatorId ?? '(set BILLING_OPERATOR_ID before applying)',
              providerRequestId: options.providerRequestId,
              report: row,
              requiredVerification:
                'Confirm Stripe request logs show this exact meter event UUID, customer ID, cents value, and timestamp succeeded. A request ID alone or an aggregate amount is insufficient.',
              databaseChanges: ['set reported_at', 'append operator reconciliation audit record'],
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        JSON.stringify(
          await attestMeterReportAccepted(reportId, options.providerRequestId!, operatorId!),
          null,
          2,
        ),
      );
      return;
    }
    if (!options.apply) {
      const report = await inspectMeterReport(reportId);
      if (!report) throw new Error('No unresolved meter report was found with that ID.');
      if (report.status === 'reported') {
        console.log(
          JSON.stringify({ mode: 'read-only', status: 'already-reported', report }, null, 2),
        );
        return;
      }
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            action:
              'replay meter report with its original report UUID as Stripe identifier and idempotency key',
            operatorId: operatorId ?? '(set BILLING_OPERATOR_ID before applying)',
            report,
            appliesOnlyWhen: 'unreported, unleased, and inside the existing 23-hour retry window',
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(JSON.stringify(await replayMeterReport(reportId, operatorId!), null, 2));
    return;
  }

  if (options.recoverCheckout) {
    const accountId = requireUuid(options.accountId, '--account-id');
    const operatorId = options.operatorId ?? process.env.BILLING_OPERATOR_ID;
    if (options.apply && !operatorId)
      throw new Error('Set BILLING_OPERATOR_ID or pass --operator-id before applying changes.');
    const state = await inspectBillingReconciliation(accountId);
    const checkout = state.checkouts[0];
    if (!checkout)
      throw new Error('No unresolved checkout reservation was found for that account.');
    const candidate = await findCheckoutRecoverySession({
      accountId,
      customerId: checkout.stripeCustomerId ?? '',
      idempotencyKey: checkout.idempotencyKey,
      plan: await getPool()
        .query<{ plan: string }>('SELECT plan FROM billing_accounts WHERE account_id=$1', [
          accountId,
        ])
        .then((result) => result.rows[0]?.plan ?? ''),
      reservedAt: checkout.reservedAt ?? new Date(0),
    });
    if (!options.apply) {
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            action: 'recover checkout reservation',
            operatorId: operatorId ?? '(set BILLING_OPERATOR_ID before applying)',
            checkout,
            matchingSession: candidate
              ? { id: candidate.id, status: candidate.status, created: candidate.created }
              : null,
            databaseChanges: candidate
              ? ['attach unique Stripe session ID', 'append reconciliation audit record']
              : [],
            resultIfUnmatched:
              'No database changes; account erasure remains blocked for operator investigation.',
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(JSON.stringify(await recoverCheckoutSession(accountId, operatorId!), null, 2));
    return;
  }

  const accountId = options.accountId ? requireUuid(options.accountId, '--account-id') : undefined;
  const state = await inspectBillingReconciliation(accountId);
  console.log(JSON.stringify({ mode: 'read-only', ...state }, null, 2));
}

void run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Billing reconciliation failed.');
    process.exitCode = 1;
  })
  .finally(() =>
    getPool()
      .end()
      .catch(() => undefined),
  );

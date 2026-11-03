import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { billingSummary, recordTransfer } from './ledger';
import { parseS3Transfer } from './s3-log';
import { getPool, withTransaction } from '../db/client';
import {
  emailConfigured,
  meterDeliveryConfigured,
  sendBillingEmail,
  sendMeterReport,
} from './providers';
import { billingOrigin } from './policy';

const limit = 100;
const maxLogLineBytes = 1024 * 1024;

function logsClient() {
  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: !!process.env.S3_ENDPOINT,
  };
  if (process.env.S3_ENDPOINT) config.endpoint = process.env.S3_ENDPOINT;
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    config.credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  return new S3Client(config);
}

export async function ingestLogs() {
  if (process.env.S3_EGRESS_METERING === 'none') {
    console.log('Egress metering skipped: storage provider does not charge for egress.');
    return;
  }
  const bucket = process.env.S3_LOGS_BUCKET;
  const prefix = process.env.S3_LOGS_PREFIX;
  if (!bucket || !prefix) {
    console.log('S3 log source is not configured; leaving egress metering pending.');
    return;
  }
  const client = logsClient();
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.ETag) continue;
      const known = await getPool().query(
        'SELECT 1 FROM billing_log_objects WHERE object_key = $1 AND etag = $2',
        [object.Key, object.ETag],
      );
      if (known.rowCount) continue;
      const data = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
      if (!data.Body) throw new Error('S3 log object body is unavailable.');
      const decoder = new TextDecoder();
      let pending = '';
      for await (const chunk of data.Body as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/u, '');
          const transfer = parseS3Transfer(line);
          if (transfer) await recordTransfer(transfer);
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
        if (Buffer.byteLength(pending, 'utf8') > maxLogLineBytes)
          throw new Error(`S3 log object ${object.Key} contains an oversized line.`);
      }
      pending += decoder.decode();
      if (pending) {
        if (Buffer.byteLength(pending, 'utf8') > maxLogLineBytes)
          throw new Error(`S3 log object ${object.Key} contains an oversized line.`);
        const transfer = parseS3Transfer(pending.replace(/\r$/u, ''));
        if (transfer) await recordTransfer(transfer);
      }
      await getPool().query(
        'INSERT INTO billing_log_objects (object_key, etag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [object.Key, object.ETag],
      );
    }
    token = page.NextContinuationToken;
  } while (token);
}

export async function refreshPeriods() {
  let cursor: string | null = null;
  do {
    const result: { rows: Array<{ id: string }> } = await getPool().query<{ id: string }>(
      'SELECT id FROM accounts WHERE deleting_at IS NULL AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 100',
      [cursor],
    );
    for (const row of result.rows) {
      await billingSummary(row.id);
      const prior = await getPool().query<{ period_start: Date }>(
        `SELECT period_start FROM billing_periods WHERE account_id=$1 AND period_start >= date_trunc('month',now()) - interval '1 month' AND period_start < date_trunc('month',now()) ORDER BY period_start`,
        [row.id],
      );
      for (const period of prior.rows) await billingSummary(row.id, period.period_start);
    }
    cursor = result.rows.at(-1)?.id ?? null;
    if (result.rows.length < limit) break;
  } while (cursor);
}

export type MaintenanceProviders = {
  meterDeliveryConfigured: () => boolean;
  emailConfigured: () => boolean;
  sendMeterReport: typeof sendMeterReport;
  sendBillingEmail: typeof sendBillingEmail;
};

const defaultProviders: MaintenanceProviders = {
  meterDeliveryConfigured,
  emailConfigured,
  sendMeterReport,
  sendBillingEmail,
};

export async function drainOutboxes(providers: MaintenanceProviders = defaultProviders) {
  await getPool().query(
    `UPDATE billing_meter_reports
        SET last_error = 'Automatic retry paused after the 23-hour idempotency window; operator reconciliation required.'
      WHERE reported_at IS NULL AND first_attempt_at <= now() - interval '23 hours'`,
  );
  if (!providers.meterDeliveryConfigured()) {
    await getPool().query(
      `UPDATE billing_meter_reports
          SET last_error = 'Stripe meter reporting is not configured; report remains pending.'
        WHERE reported_at IS NULL AND first_attempt_at IS NULL`,
    );
  } else {
    const meters = await getPool().query(
      `UPDATE billing_meter_reports SET first_attempt_at=COALESCE(first_attempt_at,now()), lease_until=now()+interval '1 hour'
       WHERE id IN (SELECT id FROM billing_meter_reports WHERE reported_at IS NULL
         AND (first_attempt_at IS NULL OR first_attempt_at > now()-interval '23 hours')
         AND (lease_until IS NULL OR lease_until < now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100)
     RETURNING id, stripe_customer_id, cents, created_at, period_start, first_attempt_at`,
    );
    for (const row of meters.rows) {
      try {
        await providers.sendMeterReport({
          id: row.id,
          customer: row.stripe_customer_id,
          cents: String(row.cents),
          timestamp: Math.min(
            Math.floor(new Date(row.created_at).getTime() / 1000),
            Math.floor(
              (Date.UTC(
                new Date(row.period_start).getUTCFullYear(),
                new Date(row.period_start).getUTCMonth() + 1,
                1,
              ) -
                1000) /
                1000,
            ),
          ),
        });
        await getPool().query(
          'UPDATE billing_meter_reports SET reported_at = now(), lease_until = NULL, last_error = NULL WHERE id = $1',
          [row.id],
        );
      } catch (error) {
        await getPool().query(
          'UPDATE billing_meter_reports SET lease_until = NULL, last_error = $2 WHERE id = $1',
          [
            row.id,
            error instanceof Error
              ? `${error.name}: Stripe meter delivery failed.`
              : 'Stripe meter delivery failed.',
          ],
        );
      }
    }
  }
  await getPool().query(
    `UPDATE billing_notifications
      SET last_error = 'Automatic retry paused after the 24-hour idempotency window; operator reconciliation required.'
      WHERE sent_at IS NULL AND first_attempt_at <= now() - interval '24 hours'`,
  );
  if (!providers.emailConfigured()) {
    await getPool().query(
      `UPDATE billing_notifications
          SET last_error = 'Resend notifications are not configured; notification remains pending.'
        WHERE sent_at IS NULL AND first_attempt_at IS NULL`,
    );
  } else {
    const notifications = await getPool().query(
      `UPDATE billing_notifications SET first_attempt_at=COALESCE(first_attempt_at,now()), lease_until=now()+interval '1 hour'
       WHERE id IN (SELECT id FROM billing_notifications WHERE sent_at IS NULL
         AND (first_attempt_at IS NULL OR first_attempt_at > now()-interval '24 hours')
         AND EXISTS (SELECT 1 FROM accounts a
                      WHERE a.id=billing_notifications.account_id AND a.deleting_at IS NULL)
         AND (lease_until IS NULL OR lease_until < now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100)
     RETURNING id, account_id, email, threshold_cents`,
    );
    for (const row of notifications.rows) {
      await withTransaction(async (client) => {
        const account = await client.query(
          'SELECT id FROM accounts WHERE id=$1 AND deleting_at IS NULL FOR UPDATE',
          [row.account_id],
        );
        if (!account.rowCount) {
          await client.query('DELETE FROM billing_notifications WHERE id=$1', [row.id]);
          return;
        }
        try {
          await providers.sendBillingEmail({
            idempotencyKey: `billing-notification/${row.id}`,
            to: row.email,
            subject: 'Agent Drive billing threshold reached',
            text: `Your Agent Drive billing threshold of ${row.threshold_cents} cents was reached. Review billing at ${billingOrigin()}/console/billing.`,
          });
          await client.query(
            'UPDATE billing_notifications SET sent_at = now(), lease_until = NULL, last_error = NULL WHERE id = $1',
            [row.id],
          );
        } catch (error) {
          await client.query(
            'UPDATE billing_notifications SET lease_until = NULL, last_error = $2 WHERE id = $1',
            [
              row.id,
              error instanceof Error
                ? `${error.name}: Resend delivery failed.`
                : 'Resend delivery failed.',
            ],
          );
        }
      });
    }
  }
}

export async function runBillingMaintenance() {
  const failures: string[] = [];
  try {
    await ingestLogs();
  } catch {
    console.error('S3 log ingestion failed; queued billing deliveries will still be attempted.');
    failures.push('S3 log ingestion');
  }
  try {
    await refreshPeriods();
  } catch {
    console.error(
      'Billing period refresh failed; queued billing deliveries will still be attempted.',
    );
    failures.push('billing period refresh');
  }
  await drainOutboxes();
  const pending = await getPool().query<{ meters: string; notifications: string }>(
    `SELECT
       (SELECT count(*)::text FROM billing_meter_reports WHERE reported_at IS NULL) AS meters,
       (SELECT count(*)::text FROM billing_notifications WHERE sent_at IS NULL) AS notifications`,
  );
  console.log(
    `Billing maintenance completed; pending meter reports: ${pending.rows[0]!.meters}; pending email notifications: ${pending.rows[0]!.notifications}.`,
  );
  if (failures.length)
    throw new Error(`Maintenance reconciliation required for ${failures.join(' and ')}.`);
}

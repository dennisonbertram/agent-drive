import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
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
const logListPageSize = 250;
const logPagesPerCursor = 2;
const logObjectsPerRun = 100;
const maxObjectBytesPerRun = 4 * 1024 * 1024;
const maxLogBytesPerRun = 24 * 1024 * 1024;
const maxLogRunMs = 210_000;

type MeterClaim = {
  id: string;
  lease_until: string;
  stripe_customer_id: string;
  cents: number;
  created_at: Date;
  period_start: Date;
};

type NotificationClaim = {
  id: string;
  lease_until: string;
  account_id: string;
  email: string;
  threshold_cents: number;
};

async function ownsMeterClaim(claim: MeterClaim) {
  const result = await getPool().query(
    `SELECT 1 FROM billing_meter_reports
      WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
        AND reported_at IS NULL AND first_attempt_at > clock_timestamp()-interval '23 hours'`,
    [claim.id, claim.lease_until],
  );
  return !!result.rowCount;
}

async function ownsNotificationClaim(client: PoolClient, claim: NotificationClaim) {
  const result = await client.query(
    `SELECT 1 FROM billing_notifications
      WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
        AND sent_at IS NULL AND first_attempt_at > clock_timestamp()-interval '24 hours'`,
    [claim.id, claim.lease_until],
  );
  return !!result.rowCount;
}

function logsClient() {
  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: process.env.S3_REGION ?? 'us-east-1',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
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
  const sourceHash = createHash('sha256').update(`${bucket}\0${prefix}`).digest('hex');
  const leaseOwner = randomUUID();
  const lease = await getPool().query(
    `INSERT INTO billing_log_ingest_leases (source_hash,owner_token,lease_until)
     VALUES ($1,$2,clock_timestamp()+interval '5 minutes')
     ON CONFLICT (source_hash) DO UPDATE
       SET owner_token=EXCLUDED.owner_token, lease_until=EXCLUDED.lease_until
       WHERE billing_log_ingest_leases.lease_until IS NULL
          OR billing_log_ingest_leases.lease_until <= clock_timestamp()
     RETURNING source_hash`,
    [sourceHash, leaseOwner],
  );
  if (!lease.rowCount) {
    client.destroy();
    return;
  }
  const startedAt = Date.now();
  let bytesRead = 0;
  let objectsRead = 0;
  const attemptedObjects = new Set<string>();
  try {
    const budget = () =>
      bytesRead < maxLogBytesPerRun &&
      objectsRead < logObjectsPerRun &&
      Date.now() - startedAt < maxLogRunMs;

    // Resume a partially consumed object before advancing either list cursor.
    const pending = await getPool().query<{ object_key: string; etag: string }>(
      `SELECT p.object_key, p.etag FROM billing_log_object_progress p
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_log_processed_objects o
           WHERE o.source_hash=p.source_hash AND o.object_key=p.object_key AND o.etag=p.etag
        )
          AND NOT EXISTS (
            SELECT 1 FROM billing_log_objects o
             WHERE o.object_key=p.object_key AND o.etag=p.etag
          )
          AND p.source_hash=$1
        ORDER BY p.updated_at, p.object_key LIMIT 2`,
      [sourceHash],
    );
    for (const object of pending.rows) {
      if (!budget()) break;
      attemptedObjects.add(`${object.object_key}\0${object.etag}`);
      const result = await ingestLogObject(
        client,
        bucket,
        sourceHash,
        leaseOwner,
        object.object_key,
        object.etag,
        budget,
        (count) => {
          bytesRead += count;
        },
      );
      objectsRead += 1;
      if (result === 'missing') {
        await deleteLogProgress(sourceHash, leaseOwner, object.object_key, object.etag);
      }
    }

    // The deployed bucket uses SimplePrefix keys, so today's date prefix gets
    // a bounded pass before historical cursors. The rolling sweep catches late
    // delivery and older key layouts that sort before this day's high-water.
    const todayPrefix = `${prefix}${new Date().toISOString().slice(0, 10)}`;
    let tailPages = 0;
    while (tailPages < logPagesPerCursor && budget()) {
      const cursor = await getPool().query<{ last_key: string | null }>(
        `SELECT last_key FROM billing_log_scan_state
          WHERE source_hash=$1 AND cursor_kind='tail'`,
        [sourceHash],
      );
      const startAfter = cursor.rows[0]?.last_key ?? undefined;
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: todayPrefix,
          StartAfter: startAfter,
          MaxKeys: logListPageSize,
        }),
      );
      tailPages += 1;
      const scanned = await processLogPage(
        client,
        bucket,
        sourceHash,
        leaseOwner,
        page.Contents ?? [],
        attemptedObjects,
        budget,
        (count) => {
          bytesRead += count;
        },
        () => {
          objectsRead += 1;
        },
      );
      if (scanned.lastKey !== null && scanned.lastKey !== startAfter)
        await saveLogCursor(sourceHash, leaseOwner, 'tail', scanned.lastKey);
      if (scanned.lastKey === null || scanned.lastKey === startAfter) break;
    }

    for (const cursorKind of ['forward', 'sweep'] as const) {
      let pages = 0;
      while (pages < logPagesPerCursor && budget()) {
        const cursor = await getPool().query<{ last_key: string | null }>(
          'SELECT last_key FROM billing_log_scan_state WHERE source_hash=$1 AND cursor_kind=$2',
          [sourceHash, cursorKind],
        );
        const startAfter = cursor.rows[0]?.last_key ?? undefined;
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            StartAfter: startAfter,
            MaxKeys: logListPageSize,
          }),
        );
        pages += 1;
        const scanned = await processLogPage(
          client,
          bucket,
          sourceHash,
          leaseOwner,
          page.Contents ?? [],
          attemptedObjects,
          budget,
          (count) => {
            bytesRead += count;
          },
          () => {
            objectsRead += 1;
          },
          startAfter ?? null,
        );
        if (scanned.lastKey !== null && scanned.lastKey !== startAfter)
          await saveLogCursor(sourceHash, leaseOwner, cursorKind, scanned.lastKey);
        if (!scanned.hasObjects) {
          if (cursorKind === 'sweep') await saveLogCursor(sourceHash, leaseOwner, cursorKind, null);
          break;
        }
        // An incomplete object is independently resumable; listing can continue.
        if (objectsRead >= logObjectsPerRun) break;
      }
    }
  } finally {
    try {
      await getPool().query(
        `UPDATE billing_log_ingest_leases SET owner_token=NULL, lease_until=NULL
          WHERE source_hash=$1 AND owner_token=$2`,
        [sourceHash, leaseOwner],
      );
    } finally {
      client.destroy();
    }
  }
}

async function processLogPage(
  client: S3Client,
  bucket: string,
  sourceHash: string,
  leaseOwner: string,
  listed: Array<{ Key?: string | undefined; ETag?: string | undefined }>,
  attemptedObjects: Set<string>,
  canRead: () => boolean,
  accountBytes: (count: number) => void,
  accountObject: () => void,
  initialLastKey: string | null = null,
) {
  const candidates = listed.filter(
    (object): object is typeof object & { Key: string; ETag: string } =>
      !!object.Key && !!object.ETag,
  );
  const keys = candidates.map(({ Key }) => Key);
  const markers = keys.length
    ? await getPool().query<{ object_key: string; etag: string }>(
        `SELECT object_key, etag FROM billing_log_processed_objects
          WHERE source_hash=$1 AND object_key=ANY($2::text[])
         UNION
         SELECT object_key, etag FROM billing_log_objects WHERE object_key=ANY($2::text[])`,
        [sourceHash, keys],
      )
    : { rows: [] as Array<{ object_key: string; etag: string }> };
  const processed = new Map(markers.rows.map((marker) => [marker.object_key, marker.etag]));
  let lastKey = initialLastKey;
  for (const object of candidates) {
    if (!canRead()) break;
    lastKey = object.Key;
    if (
      processed.get(object.Key) !== object.ETag &&
      !attemptedObjects.has(`${object.Key}\0${object.ETag}`)
    ) {
      attemptedObjects.add(`${object.Key}\0${object.ETag}`);
      const result = await ingestLogObject(
        client,
        bucket,
        sourceHash,
        leaseOwner,
        object.Key,
        object.ETag,
        canRead,
        accountBytes,
      );
      if (result === 'missing') {
        await deleteLogProgress(sourceHash, leaseOwner, object.Key, object.ETag);
      }
      accountObject();
    }
  }
  return { lastKey, hasObjects: candidates.length > 0 };
}

async function saveLogCursor(
  sourceHash: string,
  leaseOwner: string,
  cursorKind: 'tail' | 'forward' | 'sweep',
  lastKey: string | null,
) {
  const updated = await getPool().query(
    `WITH owned AS (
       SELECT source_hash FROM billing_log_ingest_leases
        WHERE source_hash=$1 AND owner_token=$4 AND lease_until > clock_timestamp()
        FOR UPDATE
     )
     INSERT INTO billing_log_scan_state (source_hash,cursor_kind,last_key)
     SELECT source_hash,$2,$3 FROM owned
     ON CONFLICT (source_hash,cursor_kind) DO UPDATE
       SET last_key=EXCLUDED.last_key, updated_at=clock_timestamp()
     RETURNING source_hash`,
    [sourceHash, cursorKind, lastKey, leaseOwner],
  );
  if (!updated.rowCount) throw new Error('S3 log ingest lease expired.');
}

async function ownsLogIngestLease(sourceHash: string, leaseOwner: string) {
  const owned = await getPool().query(
    `SELECT 1 FROM billing_log_ingest_leases
      WHERE source_hash=$1 AND owner_token=$2 AND lease_until > clock_timestamp()`,
    [sourceHash, leaseOwner],
  );
  return !!owned.rowCount;
}

async function deleteLogProgress(
  sourceHash: string,
  leaseOwner: string,
  objectKey: string,
  etag: string,
) {
  await getPool().query(
    `WITH owned AS (
       SELECT source_hash FROM billing_log_ingest_leases
        WHERE source_hash=$1 AND owner_token=$4 AND lease_until > clock_timestamp()
        FOR UPDATE
     )
     DELETE FROM billing_log_object_progress p USING owned
      WHERE p.source_hash=owned.source_hash AND p.object_key=$2 AND p.etag=$3`,
    [sourceHash, objectKey, etag, leaseOwner],
  );
}

async function ingestLogObject(
  client: S3Client,
  bucket: string,
  sourceHash: string,
  leaseOwner: string,
  objectKey: string,
  etag: string,
  canRead: () => boolean,
  accountBytes: (count: number) => void,
): Promise<'complete' | 'partial' | 'missing'> {
  await getPool().query(
    `WITH owned AS (
       SELECT source_hash FROM billing_log_ingest_leases
        WHERE source_hash=$1 AND owner_token=$4 AND lease_until > clock_timestamp()
        FOR UPDATE
     )
     INSERT INTO billing_log_object_progress (source_hash,object_key,etag,byte_offset)
     SELECT source_hash,$2,$3,0 FROM owned
     ON CONFLICT (source_hash,object_key,etag) DO NOTHING`,
    [sourceHash, objectKey, etag, leaseOwner],
  );
  const progress = await getPool().query<{ byte_offset: string; discarding_line: boolean }>(
    'SELECT byte_offset::text, discarding_line FROM billing_log_object_progress WHERE source_hash=$1 AND object_key=$2 AND etag=$3',
    [sourceHash, objectKey, etag],
  );
  if (!progress.rows[0] || !(await ownsLogIngestLease(sourceHash, leaseOwner)))
    throw new Error('S3 log ingest lease expired.');
  let safeOffset = BigInt(progress.rows[0]?.byte_offset ?? '0');
  const startingOffset = safeOffset;
  let discardingLine = progress.rows[0].discarding_line;
  const startingDiscardingLine = discardingLine;
  let request;
  try {
    request = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        IfMatch: etag,
        Range: `bytes=${safeOffset}-${safeOffset + BigInt(maxObjectBytesPerRun) - 1n}`,
      }),
    );
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 412) return 'missing';
    throw error;
  }
  if (!request.Body) throw new Error('S3 log object body is unavailable.');
  const contentRangeTotal = /\/(\d+)$/u.exec(request.ContentRange ?? '')?.[1];
  const totalBytes = BigInt(
    contentRangeTotal ?? String(Number(request.ContentLength ?? 0) + Number(safeOffset)),
  );

  let pending = '';
  let pendingBytes = 0;
  let discardCheckpointBytes = 0;
  let discardedLine = false;
  const decoder = new TextDecoder();
  let linesSinceCheckpoint = 0;
  let objectBytesRead = 0;
  const checkpoint = async () => {
    const updated = await getPool().query(
      `WITH owned AS (
         SELECT source_hash FROM billing_log_ingest_leases
          WHERE source_hash=$1 AND owner_token=$4 AND lease_until > clock_timestamp()
          FOR UPDATE
       )
       UPDATE billing_log_object_progress p
          SET byte_offset=$5, discarding_line=$6, updated_at=clock_timestamp()
        FROM owned
        WHERE p.source_hash=owned.source_hash AND p.object_key=$2 AND p.etag=$3
        RETURNING p.object_key`,
      [sourceHash, objectKey, etag, leaseOwner, safeOffset.toString(), discardingLine],
    );
    if (!updated.rowCount) throw new Error('S3 log ingest lease expired.');
    linesSinceCheckpoint = 0;
    discardCheckpointBytes = 0;
  };
  const processLine = async (line: string, lineBytes: number) => {
    if (lineBytes <= maxLogLineBytes) {
      const transfer = parseS3Transfer(line.replace(/\r$/u, ''));
      if (transfer) await recordTransfer(transfer);
    }
    safeOffset += BigInt(lineBytes + 1);
    linesSinceCheckpoint += 1;
    if (linesSinceCheckpoint >= 100) await checkpoint();
  };

  let stoppedEarly = false;
  const cancelBody = async () => {
    const body = request.Body as { cancel?: () => Promise<void>; destroy?: () => void };
    try {
      if (body.cancel) await body.cancel();
      else body.destroy?.();
    } catch {
      body.destroy?.();
    }
  };
  try {
    for await (const chunk of request.Body as AsyncIterable<Uint8Array>) {
      objectBytesRead += chunk.byteLength;
      accountBytes(chunk.byteLength);
      const decoded = decoder.decode(chunk, { stream: true });
      let rest = pending + decoded;
      pending = '';
      let newline = rest.indexOf('\n');
      while (newline >= 0) {
        const segment = rest.slice(0, newline);
        const segmentBytes = Buffer.byteLength(segment, 'utf8');
        if (discardingLine || segmentBytes > maxLogLineBytes) {
          safeOffset += BigInt(segmentBytes + 1);
          discardingLine = false;
          discardedLine = true;
          linesSinceCheckpoint += 1;
          if (linesSinceCheckpoint >= 100) await checkpoint();
        } else {
          await processLine(segment, segmentBytes);
        }
        rest = rest.slice(newline + 1);
        newline = rest.indexOf('\n');
        if (!canRead() || objectBytesRead >= maxObjectBytesPerRun) {
          stoppedEarly = true;
          break;
        }
      }
      if (newline >= 0) {
        pending = rest.slice(newline + 1);
        pendingBytes = Buffer.byteLength(pending, 'utf8');
      } else if (discardingLine || Buffer.byteLength(rest, 'utf8') > maxLogLineBytes) {
        const discardedBytes = Buffer.byteLength(rest, 'utf8');
        safeOffset += BigInt(discardedBytes);
        discardCheckpointBytes += discardedBytes;
        discardingLine = true;
        if (discardCheckpointBytes >= 512 * 1024) {
          await checkpoint();
          discardCheckpointBytes = 0;
        }
        pendingBytes = 0;
      } else {
        pending = rest;
        pendingBytes = Buffer.byteLength(pending, 'utf8');
      }
      if (!canRead() || objectBytesRead >= maxObjectBytesPerRun) {
        stoppedEarly = true;
        break;
      }
    }
  } catch (error) {
    await cancelBody();
    throw error;
  }
  if (stoppedEarly) await cancelBody();

  const decoderTail = decoder.decode();
  if (decoderTail && discardingLine) {
    const discardedBytes = Buffer.byteLength(decoderTail, 'utf8');
    safeOffset += BigInt(discardedBytes);
    discardCheckpointBytes += discardedBytes;
  } else if (decoderTail) {
    pending += decoderTail;
    pendingBytes += Buffer.byteLength(decoderTail, 'utf8');
  }
  if (
    (objectBytesRead < maxObjectBytesPerRun && canRead()) ||
    (totalBytes > 0n && safeOffset >= totalBytes)
  ) {
    if (discardingLine) {
      discardedLine = true;
    } else if (pendingBytes > 0) {
      const transfer = parseS3Transfer(pending.replace(/\r$/u, ''));
      if (transfer) await recordTransfer(transfer);
      safeOffset += BigInt(pendingBytes);
      linesSinceCheckpoint += 1;
    }
    await checkpoint();
    const marked = await getPool().query(
      `WITH owned AS (
         SELECT source_hash FROM billing_log_ingest_leases
          WHERE source_hash=$1 AND owner_token=$4 AND lease_until > clock_timestamp()
          FOR UPDATE
       )
       INSERT INTO billing_log_processed_objects (source_hash,object_key,etag)
       SELECT source_hash,$2,$3 FROM owned ON CONFLICT DO NOTHING RETURNING object_key`,
      [sourceHash, objectKey, etag, leaseOwner],
    );
    if (!marked.rowCount) {
      const stillOwns = await ownsLogIngestLease(sourceHash, leaseOwner);
      if (!stillOwns) throw new Error('S3 log ingest lease expired.');
    }
    await deleteLogProgress(sourceHash, leaseOwner, objectKey, etag);
    if (discardedLine) console.warn('Skipped an oversized line in an S3 access log object.');
    return 'complete';
  }
  if (safeOffset > startingOffset || discardingLine !== startingDiscardingLine) await checkpoint();
  return 'partial';
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
      WHERE reported_at IS NULL AND first_attempt_at <= clock_timestamp() - interval '23 hours'
        AND (lease_until IS NULL OR lease_until < clock_timestamp())`,
  );
  if (!providers.meterDeliveryConfigured()) {
    await getPool().query(
      `UPDATE billing_meter_reports
          SET last_error = 'Stripe meter reporting is not configured; report remains pending.'
        WHERE reported_at IS NULL AND first_attempt_at IS NULL
          AND (lease_until IS NULL OR lease_until < clock_timestamp())`,
    );
  } else {
    const meters = await getPool().query<MeterClaim>(
      `UPDATE billing_meter_reports SET first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),
           lease_until=clock_timestamp()+interval '1 hour'
       WHERE id IN (SELECT id FROM billing_meter_reports WHERE reported_at IS NULL
         AND (first_attempt_at IS NULL OR first_attempt_at > clock_timestamp()-interval '23 hours')
         AND (lease_until IS NULL OR lease_until < clock_timestamp())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100)
     RETURNING id, lease_until::text AS lease_until, stripe_customer_id, cents, created_at, period_start`,
    );
    for (const row of meters.rows) {
      if (!(await ownsMeterClaim(row))) continue;
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
          `UPDATE billing_meter_reports
              SET reported_at = clock_timestamp(), lease_until = NULL, last_error = NULL
            WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
              AND reported_at IS NULL AND first_attempt_at > clock_timestamp()-interval '23 hours'`,
          [row.id, row.lease_until],
        );
      } catch (error) {
        await getPool().query(
          `UPDATE billing_meter_reports SET lease_until = NULL, last_error = $3
            WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
              AND reported_at IS NULL AND first_attempt_at > clock_timestamp()-interval '23 hours'`,
          [
            row.id,
            row.lease_until,
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
      WHERE sent_at IS NULL AND first_attempt_at <= clock_timestamp() - interval '24 hours'
        AND (lease_until IS NULL OR lease_until < clock_timestamp())`,
  );
  if (!providers.emailConfigured()) {
    await getPool().query(
      `UPDATE billing_notifications
          SET last_error = 'Resend notifications are not configured; notification remains pending.'
        WHERE sent_at IS NULL AND first_attempt_at IS NULL
          AND (lease_until IS NULL OR lease_until < clock_timestamp())`,
    );
  } else {
    const notifications = await getPool().query<NotificationClaim>(
      `UPDATE billing_notifications SET first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),
           lease_until=clock_timestamp()+interval '1 hour'
       WHERE id IN (SELECT id FROM billing_notifications WHERE sent_at IS NULL
         AND (first_attempt_at IS NULL OR first_attempt_at > clock_timestamp()-interval '24 hours')
         AND EXISTS (SELECT 1 FROM accounts a
                      WHERE a.id=billing_notifications.account_id AND a.deleting_at IS NULL)
         AND (lease_until IS NULL OR lease_until < clock_timestamp())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100)
     RETURNING id, lease_until::text AS lease_until, account_id, email, threshold_cents`,
    );
    for (const row of notifications.rows) {
      await withTransaction(async (client) => {
        const account = await client.query(
          'SELECT id FROM accounts WHERE id=$1 AND deleting_at IS NULL FOR UPDATE',
          [row.account_id],
        );
        if (!account.rowCount) {
          await client.query(
            `DELETE FROM billing_notifications
              WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
                AND sent_at IS NULL AND first_attempt_at > clock_timestamp()-interval '24 hours'`,
            [row.id, row.lease_until],
          );
          return;
        }
        if (!(await ownsNotificationClaim(client, row))) return;
        try {
          await providers.sendBillingEmail({
            idempotencyKey: `billing-notification/${row.id}`,
            to: row.email,
            subject: 'Agent Drive billing threshold reached',
            text: `Your Agent Drive billing threshold of ${row.threshold_cents} cents was reached. Review billing at ${billingOrigin()}/console/billing.`,
          });
          await client.query(
            `UPDATE billing_notifications
                SET sent_at=clock_timestamp(), lease_until=NULL, last_error=NULL
              WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
                AND sent_at IS NULL AND first_attempt_at > clock_timestamp()-interval '24 hours'`,
            [row.id, row.lease_until],
          );
        } catch (error) {
          await client.query(
            `UPDATE billing_notifications SET lease_until=NULL, last_error=$3
              WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()
                AND sent_at IS NULL AND first_attempt_at > clock_timestamp()-interval '24 hours'`,
            [
              row.id,
              row.lease_until,
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

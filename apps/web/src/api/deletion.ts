import { createHash } from 'node:crypto';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getPool, withTransaction } from '../db/client';
import { queueBillingDeliveries, billingState } from '../billing/ledger';
import { closeStripeBillingForDeletion } from '../billing/providers';
import { drainOutboxes } from '../billing/maintenance';
import { storageBucket, storageClient } from './storage';
import { consoleIdentityDeletionConfigured, deleteConsoleIdentity } from '../console/identity';

const batchSize = 100;
let versionListingSupported = true;

function isUnimplemented(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === 'NotImplemented' || candidate.$metadata?.httpStatusCode === 501;
}

type Adapters = {
  objectStore?: S3Client;
  closeBilling?: typeof closeStripeBillingForDeletion;
  deleteIdentity?: typeof deleteConsoleIdentity;
  drainBilling?: typeof drainOutboxes;
  jobIds?: string[];
};

type DeletionJob = {
  id: string;
  kind: string;
  target_id: string;
  account_id: string;
  lease_until: string;
  completed_at: Date | null;
};

async function renewClaim(job: Pick<DeletionJob, 'id' | 'lease_until'>) {
  const claim = await getPool().query<{ lease_until: string }>(
    `UPDATE deletion_jobs SET lease_until=clock_timestamp()+interval '10 minutes'
      WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
        AND lease_until > clock_timestamp()
      RETURNING lease_until::text AS lease_until`,
    [job.id, job.lease_until],
  );
  if (!claim.rows[0]) throw new Error('Deletion claim expired.');
  job.lease_until = claim.rows[0].lease_until;
}

async function assertSweepClaim(job: Pick<DeletionJob, 'id' | 'lease_until'>) {
  const claim = await getPool().query(
    `SELECT 1 FROM deletion_jobs
      WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NOT NULL
        AND lease_until > clock_timestamp()`,
    [job.id, job.lease_until],
  );
  if (!claim.rowCount) throw new Error('Deletion claim expired.');
}

export async function purgePrefix(store: S3Client, prefix: string) {
  let removed = 0;
  while (removed < batchSize) {
    let useVersions = versionListingSupported;
    let objects: Array<{ Key: string; VersionId?: string | undefined }>;
    let isTruncated: boolean;
    if (useVersions) {
      try {
        const listed = await store.send(
          new ListObjectVersionsCommand({
            Bucket: storageBucket(),
            Prefix: prefix,
            MaxKeys: batchSize,
          }),
        );
        objects = [
          ...(listed.Versions ?? []).map((entry) => ({
            Key: entry.Key!,
            VersionId: entry.VersionId,
          })),
          ...(listed.DeleteMarkers ?? []).map((entry) => ({
            Key: entry.Key!,
            VersionId: entry.VersionId,
          })),
        ].filter((entry) => entry.Key);
        isTruncated = !!listed.IsTruncated;
      } catch (error) {
        if (!isUnimplemented(error)) throw error;
        versionListingSupported = false;
        useVersions = false;
        const listed = await store.send(
          new ListObjectsV2Command({
            Bucket: storageBucket(),
            Prefix: prefix,
            MaxKeys: batchSize,
          }),
        );
        objects = (listed.Contents ?? []).flatMap((entry) =>
          entry.Key ? [{ Key: entry.Key }] : [],
        );
        isTruncated = !!listed.IsTruncated;
      }
    } else {
      const listed = await store.send(
        new ListObjectsV2Command({
          Bucket: storageBucket(),
          Prefix: prefix,
          MaxKeys: batchSize,
        }),
      );
      objects = (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [{ Key: entry.Key }] : []));
      isTruncated = !!listed.IsTruncated;
    }
    if (!objects.length) return true;
    const batch = objects.slice(0, batchSize - removed);
    const deleted = await store.send(
      new DeleteObjectsCommand({
        Bucket: storageBucket(),
        Delete: { Objects: batch, Quiet: true },
      }),
    );
    if (deleted.Errors?.length) throw new Error('Object deletion was incomplete.');
    removed += batch.length;
    if (isTruncated || removed >= batchSize) {
      if (useVersions) {
        const check = await store.send(
          new ListObjectVersionsCommand({ Bucket: storageBucket(), Prefix: prefix, MaxKeys: 1 }),
        );
        if (!check.Versions?.length && !check.DeleteMarkers?.length) return true;
      } else {
        const check = await store.send(
          new ListObjectsV2Command({ Bucket: storageBucket(), Prefix: prefix, MaxKeys: 1 }),
        );
        if (!check.Contents?.length) return true;
      }
      return false;
    }
  }
  return false;
}

function safeError(error: unknown) {
  void error;
  return 'Deletion cleanup is retryable.';
}

async function purgeDrive(store: S3Client, job: DeletionJob) {
  const active = await getPool().query(
    `SELECT 1 FROM drives d JOIN accounts a ON a.id=d.account_id
      WHERE d.id=$1 AND d.account_id=$2 AND d.deleting_at IS NOT NULL
        AND a.deleting_at IS NULL`,
    [job.target_id, job.account_id],
  );
  const target = await getPool().query<{ account_id: string }>(
    'SELECT account_id FROM drives WHERE id=$1',
    [job.target_id],
  );
  if (target.rows[0] && target.rows[0].account_id !== job.account_id)
    throw new Error('Deletion target ownership does not match.');
  if (target.rowCount && !active.rowCount)
    throw new Error('Deletion target is not marked for deletion.');
  await renewClaim(job);
  const objectEmpty = await purgePrefix(store, `objects/${job.account_id}/${job.target_id}/`);
  await renewClaim(job);
  const stagingEmpty = await purgePrefix(store, `staging/${job.account_id}/${job.target_id}/`);
  if (!objectEmpty || !stagingEmpty) return false;
  if (!target.rowCount) return true;
  await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT d.id FROM drives d JOIN accounts a ON a.id=d.account_id
        WHERE d.id=$1 AND d.account_id=$2 AND d.deleting_at IS NOT NULL
          AND a.deleting_at IS NULL FOR UPDATE OF a,d`,
      [job.target_id, job.account_id],
    );
    if (!locked.rowCount) throw new Error('Deletion target is not marked for deletion.');
    const claim = await client.query(
      `SELECT 1 FROM deletion_jobs
        WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
          AND lease_until > clock_timestamp() FOR UPDATE`,
      [job.id, job.lease_until],
    );
    if (!claim.rowCount) throw new Error('Deletion claim expired.');
    const state = await billingState(client, job.account_id);
    await queueBillingDeliveries(client, state);
    await client.query(
      `UPDATE billing_egress_events SET drive_id=NULL, object_key='deleted'
        WHERE drive_id=$1`,
      [job.target_id],
    );
    await client.query('DELETE FROM file_events WHERE drive_id = $1', [job.target_id]);
    await client.query('DELETE FROM drives WHERE id = $1 AND account_id = $2', [
      job.target_id,
      job.account_id,
    ]);
    await client.query(
      'UPDATE api_keys SET drive_ids = array_remove(drive_ids, $1::uuid) WHERE account_id = $2',
      [job.target_id, job.account_id],
    );
  });
  return true;
}

async function purgeAccount(store: S3Client, job: DeletionJob, adapters: Adapters) {
  const targetId = job.target_id;
  if (job.account_id !== targetId) throw new Error('Deletion target ownership does not match.');
  const account = await getPool().query<{
    external_clerk_user_id: string | null;
    deleting_at: Date | null;
  }>('SELECT external_clerk_user_id, deleting_at FROM accounts WHERE id = $1', [targetId]);
  if (!account.rows[0]) {
    await renewClaim(job);
    const objectsEmpty = await purgePrefix(store, `objects/${targetId}/`);
    await renewClaim(job);
    const stagingEmpty = await purgePrefix(store, `staging/${targetId}/`);
    return objectsEmpty && stagingEmpty;
  }
  if (!account.rows[0].deleting_at) throw new Error('Deletion target is not marked for deletion.');
  const ambiguous = await getPool().query(
    `SELECT 1 FROM billing_accounts
      WHERE account_id=$1 AND checkout_idempotency_key IS NOT NULL
        AND checkout_session_id IS NULL LIMIT 1`,
    [targetId],
  );
  if (ambiguous.rowCount) throw new Error('Billing reconciliation is required.');
  const periods = await getPool().query<{ period_start: Date }>(
    'SELECT period_start FROM billing_periods WHERE account_id=$1 ORDER BY period_start',
    [targetId],
  );
  await withTransaction(async (client) => {
    const periodStarts = [undefined, ...periods.rows.map((row) => row.period_start)];
    for (const periodStart of periodStarts) {
      const state = await billingState(client, targetId, periodStart, { allowDeleting: true });
      await queueBillingDeliveries(client, state, { notify: false });
    }
  });
  await renewClaim(job);
  await (adapters.drainBilling ?? drainOutboxes)();
  const pending = await getPool().query(
    'SELECT 1 FROM billing_meter_reports WHERE account_id = $1 AND reported_at IS NULL LIMIT 1',
    [targetId],
  );
  if (pending.rowCount) throw new Error('Billing deliveries remain pending.');
  await renewClaim(job);
  const billingJob = await getPool().query<{ billing_closed_at: Date | null }>(
    `SELECT billing_closed_at FROM deletion_jobs
      WHERE id=$1 AND kind=$2 AND target_id=$3 AND lease_until=$4::timestamptz
        AND completed_at IS NULL AND lease_until > clock_timestamp()`,
    [job.id, 'account', targetId, job.lease_until],
  );
  const billing = await getPool().query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM billing_accounts WHERE account_id = $1',
    [targetId],
  );
  if (!billingJob.rows[0]) throw new Error('Deletion claim expired.');
  if (!billingJob.rows[0].billing_closed_at && billing.rows[0]?.stripe_customer_id) {
    await renewClaim(job);
    const closed = await (adapters.closeBilling ?? closeStripeBillingForDeletion)(
      targetId,
      billing.rows[0].stripe_customer_id,
    );
    if (!closed) throw new Error('Stripe billing remains open.');
    const checkpoint = await getPool().query(
      `UPDATE deletion_jobs SET billing_closed_at=now()
        WHERE id=$1 AND kind=$2 AND target_id=$3 AND lease_until=$4::timestamptz
          AND completed_at IS NULL AND lease_until > clock_timestamp()
        RETURNING id`,
      [job.id, 'account', targetId, job.lease_until],
    );
    if (!checkpoint.rowCount) throw new Error('Deletion claim expired.');
  }
  const identity = account.rows[0].external_clerk_user_id;
  const synthetic =
    !!identity &&
    /^e2e_[a-zA-Z0-9_-]+$/u.test(identity) &&
    ['development', 'test'].includes(process.env.NODE_ENV ?? '');
  if (identity && !synthetic) {
    if (!consoleIdentityDeletionConfigured() && !adapters.deleteIdentity)
      throw new Error('Console identity deletion is not configured.');
    await renewClaim(job);
    const recorded = await getPool().query(
      `SELECT identity_deleted_at FROM deletion_jobs
        WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
          AND lease_until > clock_timestamp()`,
      [job.id, job.lease_until],
    );
    if (!recorded.rows[0]) throw new Error('Deletion claim expired.');
    if (!recorded.rows[0].identity_deleted_at) {
      await renewClaim(job);
      await (adapters.deleteIdentity ?? deleteConsoleIdentity)(identity);
      const checkpoint = await getPool().query(
        `UPDATE deletion_jobs SET identity_deleted_at=now()
          WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
            AND lease_until > clock_timestamp()
          RETURNING id`,
        [job.id, job.lease_until],
      );
      if (!checkpoint.rowCount) throw new Error('Deletion claim expired.');
    }
  }
  await renewClaim(job);
  const objectsEmpty = await purgePrefix(store, `objects/${targetId}/`);
  await renewClaim(job);
  const stagingEmpty = await purgePrefix(store, `staging/${targetId}/`);
  if (!objectsEmpty || !stagingEmpty) return false;
  const accountRemoved = await withTransaction(async (client) => {
    if (identity) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identity]);
    }
    const locked = await client.query(
      'SELECT id FROM accounts WHERE id=$1 AND deleting_at IS NOT NULL FOR UPDATE',
      [targetId],
    );
    if (!locked.rowCount) return;
    const claim = await client.query(
      `SELECT 1 FROM deletion_jobs
        WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
          AND lease_until > clock_timestamp() FOR UPDATE`,
      [job.id, job.lease_until],
    );
    if (!claim.rowCount) throw new Error('Deletion claim expired.');
    const periods = await client.query<{ period_start: Date }>(
      'SELECT period_start FROM billing_periods WHERE account_id=$1 ORDER BY period_start',
      [targetId],
    );
    for (const periodStart of [undefined, ...periods.rows.map((row) => row.period_start)]) {
      const state = await billingState(client, targetId, periodStart, { allowDeleting: true });
      const quote = await queueBillingDeliveries(client, state, { notify: false });
      await client.query(
        `INSERT INTO deletion_billing_receipts (account_id,period_start,statement)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (account_id,period_start) DO UPDATE SET statement=EXCLUDED.statement`,
        [
          targetId,
          state.start,
          JSON.stringify({
            plan: state.account.plan,
            periodStart: state.start.toISOString(),
            periodEnd: state.end.toISOString(),
            baseCents: String(state.period.base_cents),
            overageCents: quote.overageCents.toString(),
            totalCents: quote.totalCents.toString(),
            peakDrives: String(state.period.peak_drives),
            peakStorageBytes: String(state.period.peak_storage_bytes),
            observedEgressBytes: state.current.egressBytes.toString(),
            authorizedEgressBytes: String(state.period.authorized_egress_bytes),
            operations: state.current.operations.toString(),
            rates: state.rates
              ? Object.fromEntries(
                  Object.entries(state.rates).map(([name, value]) => [name, String(value)]),
                )
              : null,
          }),
        ],
      );
    }
    const pendingReports = await client.query(
      'SELECT 1 FROM billing_meter_reports WHERE account_id=$1 AND reported_at IS NULL LIMIT 1',
      [targetId],
    );
    if (pendingReports.rowCount) return false;
    if (identity) {
      const hash = createHash('sha256').update(identity).digest('hex');
      await client.query(
        `INSERT INTO console_user_tombstones (external_user_hash)
         VALUES ($1) ON CONFLICT (external_user_hash) DO NOTHING`,
        [hash],
      );
    }
    await client.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [targetId],
    );
    await client.query('DELETE FROM shares WHERE account_id=$1', [targetId]);
    await client.query('DELETE FROM audit_events WHERE account_id = $1', [targetId]);
    await client.query('DELETE FROM drives WHERE account_id = $1', [targetId]);
    await client.query('DELETE FROM accounts WHERE id = $1', [targetId]);
    return true;
  });
  return accountRemoved;
}

async function processJob(job: DeletionJob, adapters: Adapters) {
  const store = adapters.objectStore ?? storageClient();
  const done =
    job.kind === 'drive' ? await purgeDrive(store, job) : await purgeAccount(store, job, adapters);
  if (done) {
    const completed = await getPool().query(
      `UPDATE deletion_jobs SET completed_at=now(),lease_until=NULL,last_error=NULL
        WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
          AND lease_until > clock_timestamp()
        RETURNING id`,
      [job.id, job.lease_until],
    );
    if (!completed.rowCount) throw new Error('Deletion claim expired.');
  } else {
    const released = await getPool().query(
      `UPDATE deletion_jobs SET lease_until=NULL,last_attempt_at=now(),
          not_before=GREATEST(not_before,now()+interval '30 seconds')
        WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NULL
          AND lease_until > clock_timestamp()
        RETURNING id`,
      [job.id, job.lease_until],
    );
    if (!released.rowCount) throw new Error('Deletion claim expired.');
  }
}

export async function runDeletionMaintenance(adapters: Adapters = {}) {
  const jobs = await getPool().query<DeletionJob>(
    `WITH active_jobs AS (
       SELECT id FROM deletion_jobs
        WHERE completed_at IS NULL AND not_before <= now()
          AND ($1::uuid[] IS NULL OR id=ANY($1::uuid[]))
          AND (lease_until IS NULL OR lease_until < clock_timestamp())
        ORDER BY last_attempt_at NULLS FIRST, requested_at, id
        FOR UPDATE SKIP LOCKED LIMIT 8
     ), sweep_jobs AS (
       SELECT id FROM deletion_jobs
        WHERE completed_at IS NOT NULL
          AND ($1::uuid[] IS NULL OR id=ANY($1::uuid[]))
          AND (last_swept_at IS NULL OR last_swept_at < now()-interval '1 minute')
          AND (lease_until IS NULL OR lease_until < clock_timestamp())
        ORDER BY last_attempt_at NULLS FIRST, requested_at, id
        FOR UPDATE SKIP LOCKED LIMIT 2
     )
     UPDATE deletion_jobs SET lease_until=clock_timestamp()+interval '10 minutes',
         last_attempt_at=clock_timestamp()
      WHERE id IN (SELECT id FROM active_jobs UNION ALL SELECT id FROM sweep_jobs)
     RETURNING id, kind, target_id, account_id, lease_until::text AS lease_until, completed_at`,
    [adapters.jobIds ?? null],
  );
  for (const job of jobs.rows) {
    try {
      if (job.completed_at) {
        if (job.kind === 'account') {
          if (job.target_id !== job.account_id) throw new Error('Deletion target is invalid.');
          const target = await getPool().query('SELECT 1 FROM accounts WHERE id=$1', [
            job.account_id,
          ]);
          if (target.rowCount) throw new Error('Deletion target unexpectedly exists.');
        } else if (job.kind === 'drive') {
          const target = await getPool().query('SELECT 1 FROM drives WHERE id=$1', [job.target_id]);
          if (target.rowCount) throw new Error('Deletion target unexpectedly exists.');
        } else {
          throw new Error('Deletion target is invalid.');
        }
        const store = adapters.objectStore ?? storageClient();
        const prefixes =
          job.kind === 'drive'
            ? [
                `objects/${job.account_id}/${job.target_id}/`,
                `staging/${job.account_id}/${job.target_id}/`,
              ]
            : [`objects/${job.target_id}/`, `staging/${job.target_id}/`];
        let empty = true;
        for (const prefix of prefixes) {
          await assertSweepClaim(job);
          empty = (await purgePrefix(store, prefix)) && empty;
        }
        if (empty) {
          const swept = await getPool().query(
            `UPDATE deletion_jobs SET last_swept_at=now(),lease_until=NULL,last_error=NULL
              WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NOT NULL
                AND lease_until > clock_timestamp()
              RETURNING id`,
            [job.id, job.lease_until],
          );
          if (!swept.rowCount) throw new Error('Deletion claim expired.');
        } else {
          const rescheduled = await getPool().query(
            `UPDATE deletion_jobs SET completed_at=NULL,lease_until=NULL,
                last_attempt_at=now(),not_before=GREATEST(not_before,now()+interval '30 seconds'),
                last_error='Deletion cleanup is retryable.'
              WHERE id=$1 AND lease_until=$2::timestamptz AND completed_at IS NOT NULL
                AND lease_until > clock_timestamp()
              RETURNING id`,
            [job.id, job.lease_until],
          );
          if (!rescheduled.rowCount) throw new Error('Deletion claim expired.');
        }
      } else {
        await processJob(job, adapters);
      }
    } catch (error) {
      await getPool().query(
        `UPDATE deletion_jobs SET completed_at=CASE WHEN completed_at IS NOT NULL THEN NULL ELSE completed_at END,
            lease_until=NULL,last_attempt_at=now(),
            not_before=GREATEST(not_before,now()+interval '30 seconds'),last_error=$3
          WHERE id=$1 AND lease_until=$2::timestamptz AND lease_until > clock_timestamp()`,
        [job.id, job.lease_until, safeError(error)],
      );
    }
  }
}

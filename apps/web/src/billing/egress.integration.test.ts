import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getPool } from '../db/client';
import { ingestLogs } from './maintenance';
import { recordTransfer } from './ledger';
import { parseS3Transfer } from './s3-log';
import { runDeletionMaintenance } from '../api/deletion';

const accountId = randomUUID();
let driveId = '';
let objectKey = '';
let deletionJobId = '';

beforeAll(async () => {
  vi.stubEnv('S3_BUCKET', 'agent-drive-egress-fixture');
  const pool = getPool();
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const agent = (
    await pool.query('INSERT INTO accounts (id,name) VALUES ($1,$2) RETURNING id', [
      accountId,
      `egress-${randomUUID()}`,
    ])
  ).rows[0]!.id as string;
  const agentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      agent,
      'egress-fixture-agent',
    ])
  ).rows[0]!.id as string;
  driveId = (
    await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
      agent,
      'egress-fixture-drive',
    ])
  ).rows[0]!.id as string;
  const fileId = (
    await pool.query('INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id', [
      driveId,
      '/egress-fixture.bin',
    ])
  ).rows[0]!.id as string;
  objectKey = `objects/${accountId}/${randomUUID()}`;
  await pool.query(
    `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,2048,'synthetic-wrapped-key',$4)`,
    [fileId, driveId, objectKey, agentId],
  );
});

afterAll(async () => {
  if (deletionJobId)
    await getPool().query('DELETE FROM deletion_jobs WHERE id=$1', [deletionJobId]);
  await getPool().query('DELETE FROM versions WHERE drive_id = $1', [driveId]);
  await getPool().query('DELETE FROM accounts WHERE id = $1', [accountId]);
  vi.unstubAllEnvs();
});

it('replays actual S3 log events without double-counting response bytes', async () => {
  const log = `owner agent-drive-egress-fixture [30/Oct/2026:10:00:00 +0000] 192.0.2.3 requester REPLAY-${accountId} REST.GET.OBJECT ${encodeURIComponent(objectKey)} "GET /${objectKey}?X-Amz-Signature=synthetic HTTP/1.1" 206 - 713 2048 17 4 "-" "fixture" -`;
  const transfer = parseS3Transfer(log);
  expect(transfer).not.toBeNull();
  if (!transfer) throw new Error('Expected a valid synthetic S3 log event.');

  await recordTransfer(transfer);
  await recordTransfer(transfer);

  const result = await getPool().query(
    'SELECT count(*)::int AS events, sum(bytes_sent)::text AS bytes FROM billing_egress_events WHERE account_id = $1',
    [accountId],
  );
  expect(result.rows[0]).toEqual({ events: 1, bytes: '713' });
});

it('uses bounded cursors for new and late old-named logs and retains only hashed paths after drive purge', async () => {
  const previousLogsBucket = process.env.S3_LOGS_BUCKET;
  const previousLogsPrefix = process.env.S3_LOGS_PREFIX;
  const logsBucket = `synthetic-access-logs-${randomUUID()}`;
  const logPrefix = 'access/';
  const todayPrefix = `${logPrefix}${new Date().toISOString().slice(0, 10)}`;
  const currentLogKey = `${todayPrefix}-current.log`;
  const legacyObjectKey = `${logPrefix}legacy/${randomUUID()}.log`;
  const sourceHash = createHash('sha256').update(`${logsBucket}\0${logPrefix}`).digest('hex');
  vi.stubEnv('S3_LOGS_BUCKET', logsBucket);
  vi.stubEnv('S3_LOGS_PREFIX', logPrefix);
  const currentLog = `owner ${process.env.S3_BUCKET} [30/Oct/2026:10:00:00 +0000] 192.0.2.3 requester SCAN-CURRENT REST.GET.OBJECT ${encodeURIComponent(objectKey)} "GET /${objectKey} HTTP/1.1" 200 - 19 2048 17 4 "-" "fixture" -`;
  const lateKey = objectKey;
  const lateLog = `owner ${process.env.S3_BUCKET} [30/Oct/2026:10:01:00 +0000] 192.0.2.3 requester SCAN-LATE REST.GET.OBJECT ${encodeURIComponent(lateKey)} "GET /${lateKey} HTTP/1.1" 206 - 23 2048 17 4 "-" "fixture" -`;
  const legacyLog = `owner ${process.env.S3_BUCKET} [30/Oct/2026:09:59:00 +0000] 192.0.2.3 requester SCAN-LEGACY REST.GET.OBJECT ${encodeURIComponent(objectKey)} "GET /${objectKey} HTTP/1.1" 200 - 7 2048 17 4 "-" "fixture" -`;
  const logObjects = new Map<string, { etag: string; body: string }>([
    [
      `${logPrefix}middle-large.log`,
      { etag: 'large-etag', body: `${'x'.repeat(500_000)}\n`.repeat(9) },
    ],
    [
      `${logPrefix}middle-overlong.log`,
      { etag: 'overlong-etag', body: `${'x'.repeat(4_500_000)}\n${lateLog}\n` },
    ],
    [legacyObjectKey, { etag: 'legacy-etag', body: `${legacyLog}\n` }],
    [currentLogKey, { etag: 'current-etag', body: `${currentLog}\n` }],
  ]);
  const ranges: string[] = [];
  const downloadedKeys: string[] = [];
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
    if (command instanceof ListObjectsV2Command) {
      const { Prefix, StartAfter } = command.input;
      if (Prefix?.startsWith('objects/') || Prefix?.startsWith('staging/'))
        return { Contents: [] } as never;
      return {
        Contents: [...logObjects.entries()]
          .filter(([key]) => key.startsWith(Prefix ?? '') && (!StartAfter || key > StartAfter))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([Key, value]) => ({ Key, ETag: value.etag, Size: Buffer.byteLength(value.body) })),
      } as never;
    }
    if (command instanceof ListObjectVersionsCommand) {
      const error = new Error('Synthetic storage does not implement version listing.');
      error.name = 'NotImplemented';
      Object.assign(error, { $metadata: { httpStatusCode: 501 } });
      throw error;
    }
    if (command instanceof GetObjectCommand) {
      const item = logObjects.get(command.input.Key ?? '');
      if (!item) throw new Error('Synthetic log object was not found.');
      downloadedKeys.push(command.input.Key ?? '');
      if (command.input.Range) ranges.push(command.input.Range);
      const offset = Number(/^bytes=(\d+)-/u.exec(command.input.Range ?? '')?.[1] ?? 0);
      if (offset >= Buffer.byteLength(item.body)) {
        const error = new Error('Synthetic range starts at or beyond end of object.');
        Object.assign(error, { $metadata: { httpStatusCode: 416 } });
        throw error;
      }
      return {
        Body: Readable.from([Buffer.from(item.body).subarray(offset)]),
        ContentLength: Buffer.byteLength(item.body) - offset,
      } as never;
    }
    if (command instanceof HeadObjectCommand) {
      const item = logObjects.get(command.input.Key ?? '');
      if (!item) throw new Error('Synthetic log object was not found.');
      return { ContentLength: Buffer.byteLength(item.body), ETag: item.etag } as never;
    }
    throw new Error('Unexpected S3 command in synthetic egress test.');
  });
  try {
    await getPool().query('INSERT INTO billing_log_objects (object_key,etag) VALUES ($1,$2)', [
      legacyObjectKey,
      'legacy-etag',
    ]);
    await Promise.all([ingestLogs(), ingestLogs()]);
    expect(downloadedKeys[0]).toBe(currentLogKey);
    const progress = await getPool().query(
      'SELECT 1 FROM billing_log_object_progress WHERE source_hash=$1',
      [sourceHash],
    );
    expect(progress.rowCount).toBe(2);
    await getPool().query('UPDATE drives SET deleting_at=clock_timestamp() WHERE id=$1', [driveId]);
    deletionJobId = randomUUID();
    await getPool().query(
      `INSERT INTO deletion_jobs (id,kind,target_id,account_id,not_before)
       VALUES ($1,'drive',$2,$3,clock_timestamp())`,
      [deletionJobId, driveId, accountId],
    );
    const deletionStore = new S3Client({ region: 'us-east-1' });
    await runDeletionMaintenance({ objectStore: deletionStore, jobIds: [deletionJobId] });
    deletionStore.destroy();
    logObjects.set(`${logPrefix}late-old.log`, { etag: 'late-etag', body: lateLog });
    await ingestLogs();
    await ingestLogs();
    expect(ranges.some((range) => Number(/^bytes=(\d+)-/u.exec(range)?.[1] ?? 0) > 0)).toBe(true);

    const result = await getPool().query<{ id: string; object_key: string; bytes: string }>(
      `SELECT id, object_key, bytes_sent::text AS bytes FROM billing_egress_events
        WHERE id IN ($1,$2) ORDER BY id`,
      [`${process.env.S3_BUCKET}:SCAN-CURRENT`, `${process.env.S3_BUCKET}:SCAN-LATE`],
    );
    expect(result.rows).toEqual([
      {
        id: `${process.env.S3_BUCKET}:SCAN-CURRENT`,
        object_key: 'deleted',
        bytes: '19',
      },
      {
        id: `${process.env.S3_BUCKET}:SCAN-LATE`,
        object_key: 'deleted',
        bytes: '23',
      },
    ]);
    expect(
      (
        await getPool().query('SELECT 1 FROM billing_egress_events WHERE id=$1', [
          `${process.env.S3_BUCKET}:SCAN-LEGACY`,
        ])
      ).rowCount,
    ).toBe(0);

    const emptyObjectKey = `${logPrefix}empty.log`;
    logObjects.set(emptyObjectKey, { etag: 'empty-etag', body: '' });
    await getPool().query(
      `INSERT INTO billing_log_object_progress
       (source_hash,object_key,etag,byte_offset,discarding_line) VALUES ($1,$2,$3,0,false)`,
      [sourceHash, emptyObjectKey, 'empty-etag'],
    );
    await ingestLogs();
    expect(
      (
        await getPool().query(
          `SELECT 1 FROM billing_log_processed_objects
            WHERE source_hash=$1 AND object_key=$2 AND etag='empty-etag'`,
          [sourceHash, emptyObjectKey],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await getPool().query(
          `SELECT 1 FROM billing_log_object_progress
            WHERE source_hash=$1 AND object_key=$2 AND etag='empty-etag'`,
          [sourceHash, emptyObjectKey],
        )
      ).rowCount,
    ).toBe(0);

    const staleObjectKey = `${logPrefix}stale-progress.log`;
    const staleLog = `owner ${process.env.S3_BUCKET} [30/Oct/2026:10:02:00 +0000] 192.0.2.3 requester SCAN-STALE REST.GET.OBJECT ${encodeURIComponent(objectKey)} "GET /${objectKey} HTTP/1.1" 200 - 11 2048 17 4 "-" "fixture" -`;
    logObjects.set(staleObjectKey, { etag: 'stale-etag', body: staleLog });
    await getPool().query(
      `INSERT INTO billing_log_object_progress
       (source_hash,object_key,etag,byte_offset,discarding_line) VALUES ($1,$2,$3,9999,false)`,
      [sourceHash, staleObjectKey, 'stale-etag'],
    );
    await ingestLogs();
    expect(
      (
        await getPool().query('SELECT 1 FROM billing_egress_events WHERE id=$1', [
          `${process.env.S3_BUCKET}:SCAN-STALE`,
        ])
      ).rowCount,
    ).toBe(1);
  } finally {
    await getPool().query('DELETE FROM billing_log_object_progress WHERE source_hash=$1', [
      sourceHash,
    ]);
    await getPool().query('DELETE FROM billing_log_processed_objects WHERE source_hash=$1', [
      sourceHash,
    ]);
    await getPool().query('DELETE FROM billing_log_scan_state WHERE source_hash=$1', [sourceHash]);
    await getPool().query('DELETE FROM billing_log_ingest_leases WHERE source_hash=$1', [
      sourceHash,
    ]);
    await getPool().query('DELETE FROM billing_log_objects WHERE object_key=$1 AND etag=$2', [
      legacyObjectKey,
      'legacy-etag',
    ]);
    send.mockRestore();
    vi.stubEnv('S3_LOGS_BUCKET', previousLogsBucket ?? '');
    vi.stubEnv('S3_LOGS_PREFIX', previousLogsPrefix ?? '');
  }
});

it('drops late attribution and egress events when account data is erased', async () => {
  const erasedAccountId = randomUUID();
  await getPool().query('INSERT INTO accounts (id,name) VALUES ($1,$2)', [
    erasedAccountId,
    `erasure-${randomUUID()}`,
  ]);
  const erasedObjectKey = `objects/${erasedAccountId}/${randomUUID()}`;
  await getPool().query(
    `INSERT INTO billing_egress_attributions (object_key_hash,account_id)
     VALUES ($1,$2)`,
    [createHash('sha256').update(erasedObjectKey).digest('hex'), erasedAccountId],
  );
  await getPool().query('DELETE FROM accounts WHERE id=$1', [erasedAccountId]);
  await recordTransfer({
    bucket: process.env.S3_BUCKET!,
    requestId: `ERASED-${erasedAccountId}`,
    objectKey: erasedObjectKey,
    bytes: 9n,
    occurredAt: new Date(),
  });
  const retained = await getPool().query(
    'SELECT 1 FROM billing_egress_attributions WHERE object_key_hash=$1',
    [createHash('sha256').update(erasedObjectKey).digest('hex')],
  );
  const event = await getPool().query('SELECT 1 FROM billing_egress_events WHERE id=$1', [
    `${process.env.S3_BUCKET}:ERASED-${erasedAccountId}`,
  ]);
  expect(retained.rowCount).toBe(0);
  expect(event.rowCount).toBe(0);
});

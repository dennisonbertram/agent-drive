import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getPool } from '../db/client';
import { recordTransfer } from './ledger';
import { parseS3Transfer } from './s3-log';

const accountId = randomUUID();
let driveId = '';
let objectKey = '';

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

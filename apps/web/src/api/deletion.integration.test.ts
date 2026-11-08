import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleApiRequest, handleConsoleApiRequest, handlePublicShareRequest } from './handler';
import { runDeletionMaintenance } from './deletion';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const bucket = `agent-drive-deletion-${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const root = 'http://agent-drive.test';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
let previousBucket: string | undefined;
let bucketCreated = false;
const fixtureAccountIds: string[] = [];
const fixtureIdentityHashes: string[] = [];

async function consoleRequest(userId: string, path: string, method = 'GET', body?: unknown) {
  return handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, {
      method,
      headers: {
        origin: root,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    userId,
    true,
  );
}

async function bearerRequest(path: string, key: string, method = 'GET') {
  return handleApiRequest(
    new Request(`${root}/api/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${key}` },
    }),
  );
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function clearBucket() {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
        MaxKeys: 1000,
      }),
    );
    const objects = [
      ...(page.Versions ?? []).map((version) => ({
        Key: version.Key!,
        VersionId: version.VersionId,
      })),
      ...(page.DeleteMarkers ?? []).map((marker) => ({
        Key: marker.Key!,
        VersionId: marker.VersionId,
      })),
    ];
    if (objects.length)
      await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
      );
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
}

async function createConsoleFixture(userId: string) {
  const account = await pool.query(
    `INSERT INTO accounts (name,external_clerk_user_id)
     VALUES ($1,$2) RETURNING id`,
    [`deletion-${randomUUID()}`, userId],
  );
  const accountId = account.rows[0]!.id as string;
  fixtureAccountIds.push(accountId);
  fixtureIdentityHashes.push(tokenHash(userId));
  const consoleAgent = await pool.query(
    `INSERT INTO agents (account_id,name) VALUES ($1,'__console__') RETURNING id`,
    [accountId],
  );
  const agent = await pool.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `agent-${randomUUID()}`],
  );
  const drive = await pool.query(
    'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `drive-${randomUUID()}`],
  );
  const key = token();
  const keyRow = await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'deletion-regression',$3,$4::uuid[],ARRAY['read','write','delete','manage']::text[])
     RETURNING id`,
    [accountId, agent.rows[0]!.id, tokenHash(key), [drive.rows[0]!.id]],
  );
  return {
    accountId,
    consoleAgentId: consoleAgent.rows[0]!.id as string,
    agentId: agent.rows[0]!.id as string,
    driveId: drive.rows[0]!.id as string,
    key,
    keyId: keyRow.rows[0]!.id as string,
  };
}

async function putVersionedObject(key: string, body: string) {
  return s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

beforeAll(async () => {
  previousBucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = bucket;
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  bucketCreated = true;
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
});

afterAll(async () => {
  try {
    if (bucketCreated) {
      await clearBucket();
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
  } finally {
    if (fixtureAccountIds.length) {
      await pool.query('DELETE FROM deletion_jobs WHERE account_id=ANY($1::uuid[])', [
        fixtureAccountIds,
      ]);
      await pool.query(
        `DELETE FROM file_events WHERE drive_id IN
           (SELECT id FROM drives WHERE account_id=ANY($1::uuid[]))`,
        [fixtureAccountIds],
      );
      await pool.query(`DELETE FROM audit_events WHERE account_id=ANY($1::uuid[])`, [
        fixtureAccountIds,
      ]);
      await pool.query('DELETE FROM billing_meter_reports WHERE account_id=ANY($1::uuid[])', [
        fixtureAccountIds,
      ]);
      await pool.query('DELETE FROM deletion_billing_receipts WHERE account_id=ANY($1::uuid[])', [
        fixtureAccountIds,
      ]);
      await pool.query('DELETE FROM billing_accounts WHERE account_id=ANY($1::uuid[])', [
        fixtureAccountIds,
      ]);
      await pool.query(
        `DELETE FROM versions WHERE drive_id IN
           (SELECT id FROM drives WHERE account_id=ANY($1::uuid[]))`,
        [fixtureAccountIds],
      );
      await pool.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])', [fixtureAccountIds]);
    }
    if (fixtureIdentityHashes.length)
      await pool.query(
        'DELETE FROM console_user_tombstones WHERE external_user_hash=ANY($1::text[])',
        [fixtureIdentityHashes],
      );
    if (previousBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = previousBucket;
    await s3.destroy();
    await pool.end();
  }
});

describe('deletion lifecycle', () => {
  it('queues through the owner route and purges versioned drive data without touching neighbors', async () => {
    const userId = `e2e_${randomUUID()}`;
    const foreignUserId = `e2e_foreign_${randomUUID()}`;
    const fixture = await createConsoleFixture(userId);
    const neighbor = await pool.query(
      'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
      [fixture.accountId, `neighbor-${randomUUID()}`],
    );
    const neighborDriveId = neighbor.rows[0]!.id as string;
    await pool.query('UPDATE api_keys SET drive_ids=array_append(drive_ids,$2::uuid) WHERE id=$1', [
      fixture.keyId,
      neighborDriveId,
    ]);
    const path = `/deleted-${randomUUID()}.bin`;
    const file = await pool.query('INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id', [
      fixture.driveId,
      path,
    ]);
    const fileId = file.rows[0]!.id as string;
    const firstVersionId = randomUUID();
    const secondVersionId = randomUUID();
    const firstObjectKey = `objects/${fixture.accountId}/${fixture.driveId}/${firstVersionId}`;
    const secondObjectKey = `objects/${fixture.accountId}/${fixture.driveId}/${secondVersionId}`;
    await pool.query(
      `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,5,'wrapped',$5),($6,$2,$3,$7,6,'wrapped',$5)`,
      [
        firstVersionId,
        fileId,
        fixture.driveId,
        firstObjectKey,
        fixture.agentId,
        secondVersionId,
        secondObjectKey,
      ],
    );
    await pool.query('UPDATE files SET current_version_id=$2,deleted_at=now() WHERE id=$1', [
      fileId,
      secondVersionId,
    ]);
    const shareId = randomUUID().replaceAll('-', '').slice(0, 22);
    await pool.query(
      `INSERT INTO shares (id,account_id,drive_id,file_id,version_id,agent_id,api_key_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')`,
      [
        shareId,
        fixture.accountId,
        fixture.driveId,
        fileId,
        secondVersionId,
        fixture.agentId,
        fixture.keyId,
      ],
    );
    const stagingKey = `staging/${fixture.accountId}/${fixture.driveId}/${randomUUID()}`;
    await pool.query(
      `INSERT INTO upload_intents
         (api_key_id,account_id,agent_id,drive_id,path,staging_key,ciphertext_size,wrapped_key,
          conditional_mode,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,7,'wrapped','unconditional',now()+interval '1 hour')`,
      [fixture.keyId, fixture.accountId, fixture.agentId, fixture.driveId, path, stagingKey],
    );
    await pool.query(
      `INSERT INTO file_events (drive_id,file_id,operation,path,version_id,agent_id)
       VALUES ($1,$2,'delete',$3,$4,$5)`,
      [fixture.driveId, fileId, path, secondVersionId, fixture.agentId],
    );
    await putVersionedObject(firstObjectKey, 'older ciphertext');
    await putVersionedObject(secondObjectKey, 'new ciphertext');
    await putVersionedObject(secondObjectKey, 'replayed ciphertext');
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: secondObjectKey }));
    await putVersionedObject(stagingKey, 'uncommitted ciphertext');
    const neighborKey = `objects/${fixture.accountId}/${neighborDriveId}/${randomUUID()}`;
    await putVersionedObject(neighborKey, 'neighbor survives');

    const wrongConfirmation = await consoleRequest(userId, `drives/${fixture.driveId}`, 'DELETE', {
      confirmation: 'not the drive name',
    });
    expect(wrongConfirmation.status).toBe(400);
    await createConsoleFixture(foreignUserId);
    const forbidden = await consoleRequest(foreignUserId, `drives/${fixture.driveId}`, 'DELETE', {
      confirmation: (await pool.query('SELECT name FROM drives WHERE id=$1', [fixture.driveId]))
        .rows[0]!.name,
    });
    expect(forbidden.status).toBe(404);
    const bearerDelete = await bearerRequest(
      `console/drives/${fixture.driveId}`,
      fixture.key,
      'DELETE',
    );
    expect(bearerDelete.status).toBe(404);

    const queued = await consoleRequest(userId, `drives/${fixture.driveId}`, 'DELETE', {
      confirmation: (await pool.query('SELECT name FROM drives WHERE id=$1', [fixture.driveId]))
        .rows[0]!.name,
    });
    expect(queued.status).toBe(202);
    const deletion = (await json(queued)).deletion as { id: string; status: string };
    expect(deletion.status).toBe('pending');
    await pool.query('UPDATE deletion_jobs SET not_before=now() WHERE id=$1', [deletion.id]);

    const oldKey = await bearerRequest(`drives/${fixture.driveId}/list`, fixture.key);
    expect(oldKey.status).toBe(403);
    const oldShare = await handlePublicShareRequest(shareId);
    expect(oldShare.status).toBe(404);

    const failedStore = {
      send: vi.fn().mockRejectedValue(new Error('private storage endpoint detail')),
    } as unknown as S3Client;
    await runDeletionMaintenance({ objectStore: failedStore, jobIds: [deletion.id] });
    expect((await pool.query('SELECT 1 FROM drives WHERE id=$1', [fixture.driveId])).rowCount).toBe(
      1,
    );
    const failed = await pool.query('SELECT last_error FROM deletion_jobs WHERE id=$1', [
      deletion.id,
    ]);
    expect(failed.rows[0]!.last_error).toBe('Deletion cleanup is retryable.');
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({ objectStore: s3, jobIds: [deletion.id] });

    for (const prefix of [
      `objects/${fixture.accountId}/${fixture.driveId}/`,
      `staging/${fixture.accountId}/${fixture.driveId}/`,
    ]) {
      const versions = await s3.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }),
      );
      expect([...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])]).toHaveLength(0);
    }
    expect((await pool.query('SELECT 1 FROM drives WHERE id=$1', [fixture.driveId])).rowCount).toBe(
      0,
    );
    for (const table of ['files', 'versions', 'shares', 'upload_intents', 'file_events']) {
      expect(
        (await pool.query(`SELECT 1 FROM ${table} WHERE drive_id=$1`, [fixture.driveId])).rowCount,
      ).toBe(0);
    }
    expect(
      (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: neighborKey }))).ContentLength,
    ).toBe('neighbor survives'.length);

    const liveTargetKey = `objects/${fixture.accountId}/${fixture.driveId}/${randomUUID()}`;
    await pool.query('INSERT INTO drives (id,account_id,name) VALUES ($1,$2,$3)', [
      fixture.driveId,
      fixture.accountId,
      `unexpected-${randomUUID()}`,
    ]);
    await putVersionedObject(liveTargetKey, 'must not purge a live drive');
    await pool.query(
      `UPDATE deletion_jobs SET last_swept_at=now()-interval '2 minutes' WHERE id=$1`,
      [deletion.id],
    );
    await runDeletionMaintenance({ objectStore: s3, jobIds: [deletion.id] });
    expect((await pool.query('SELECT 1 FROM drives WHERE id=$1', [fixture.driveId])).rowCount).toBe(
      1,
    );
    expect(
      (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: liveTargetKey }))).ContentLength,
    ).toBe('must not purge a live drive'.length);
    expect(
      (await pool.query('SELECT completed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.completed_at,
    ).toBeNull();
    await pool.query('DELETE FROM drives WHERE id=$1', [fixture.driveId]);
    await pool.query(
      `UPDATE deletion_jobs SET completed_at=now(),last_swept_at=now()-interval '2 minutes',
         lease_until=NULL WHERE id=$1`,
      [deletion.id],
    );

    for (let version = 0; version < 101; version += 1)
      await putVersionedObject(stagingKey, `late presigned PUT replay ${version}`);
    await putVersionedObject(
      `objects/${fixture.accountId}/${fixture.driveId}/${randomUUID()}`,
      'late copied object replay',
    );
    const repeated = await consoleRequest(userId, `drives/${fixture.driveId}`, 'DELETE', {
      confirmation: 'previously confirmed drive',
    });
    expect(repeated.status).toBe(202);
    expect(((await json(repeated)).deletion as { status: string }).status).toBe('complete');
    await pool.query(
      `UPDATE deletion_jobs SET last_swept_at=now()-interval '2 minutes' WHERE id=$1`,
      [deletion.id],
    );
    await runDeletionMaintenance({ objectStore: s3, jobIds: [deletion.id] });
    expect(
      (await pool.query('SELECT completed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.completed_at,
    ).toBeNull();
    expect(
      (await pool.query('SELECT last_error FROM deletion_jobs WHERE id=$1', [deletion.id])).rows[0]!
        .last_error,
    ).toBe('Deletion cleanup is retryable.');
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({ objectStore: s3, jobIds: [deletion.id] });
    for (const prefix of [
      `objects/${fixture.accountId}/${fixture.driveId}/`,
      `staging/${fixture.accountId}/${fixture.driveId}/`,
    ]) {
      const replay = await s3.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }),
      );
      expect([...(replay.Versions ?? []), ...(replay.DeleteMarkers ?? [])]).toHaveLength(0);
    }
    expect(
      (await pool.query('SELECT completed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.completed_at,
    ).not.toBeNull();
    expect((await pool.query('SELECT 1 FROM drives WHERE id=$1', [neighborDriveId])).rowCount).toBe(
      1,
    );
    expect(
      (await pool.query('SELECT drive_ids FROM api_keys WHERE id=$1', [fixture.keyId])).rows[0]!
        .drive_ids,
    ).toContain(neighborDriveId);
    expect(
      (await pool.query('SELECT drive_ids FROM api_keys WHERE id=$1', [fixture.keyId])).rows[0]!
        .drive_ids,
    ).not.toContain(fixture.driveId);
  });

  it('uses exact microsecond cursors and isolates deletion and audit pages by account', async () => {
    const userId = `e2e_audit_${randomUUID()}`;
    const foreignUserId = `e2e_audit_foreign_${randomUUID()}`;
    const owner = await createConsoleFixture(userId);
    const foreign = await createConsoleFixture(foreignUserId);
    const timestampBase = '2099-02-03 04:05:06.';
    const auditIds: string[] = [];
    const deletionIds: string[] = [];
    for (const micros of ['123001', '123201', '123401', '123601']) {
      const audit = await pool.query(
        `INSERT INTO audit_events (account_id,agent_id,action,outcome,http_status,created_at)
         VALUES ($1,$2,'cursor.test','success',200,$3::timestamptz) RETURNING id`,
        [owner.accountId, owner.consoleAgentId, `${timestampBase}${micros}+00`],
      );
      auditIds.push(audit.rows[0]!.id as string);
      const deletion = await pool.query(
        `INSERT INTO deletion_jobs (kind,target_id,account_id,not_before,requested_at)
         VALUES ('drive',$1,$2,now(),$3::timestamptz) RETURNING id`,
        [randomUUID(), owner.accountId, `${timestampBase}${micros}+00`],
      );
      deletionIds.push(deletion.rows[0]!.id as string);
    }
    const foreignDeletion = await pool.query(
      `INSERT INTO deletion_jobs (kind,target_id,account_id,not_before,requested_at)
       VALUES ('drive',$1,$2,now(),'2099-02-03 04:05:06.999999+00') RETURNING id`,
      [randomUUID(), foreign.accountId],
    );
    await pool.query(
      `INSERT INTO audit_events (account_id,agent_id,action,outcome,http_status,created_at)
       VALUES ($1,$2,'foreign.test','success',200,'2099-02-03 04:05:06.999999+00')`,
      [foreign.accountId, foreign.consoleAgentId],
    );

    const auditSeen: string[] = [];
    let auditCursor: string | null = null;
    do {
      const query = auditCursor
        ? `audit?limit=2&cursor=${encodeURIComponent(auditCursor)}`
        : 'audit?limit=2';
      const page = await json(await consoleRequest(userId, query));
      auditSeen.push(...(page.items as Array<{ id: string }>).map((item) => item.id));
      auditCursor = page.nextCursor as string | null;
    } while (auditCursor);
    expect(auditSeen.filter((id) => auditIds.includes(id))).toEqual([...auditIds].reverse());
    expect(new Set(auditSeen).size).toBe(auditSeen.length);
    expect(auditSeen).not.toContain(
      (
        await pool.query(
          `SELECT id FROM audit_events WHERE account_id=$1 AND action='foreign.test'`,
          [foreign.accountId],
        )
      ).rows[0]!.id,
    );

    const deletionSeen: string[] = [];
    let deletionCursor: string | null = null;
    do {
      const query = deletionCursor
        ? `deletions?limit=2&cursor=${encodeURIComponent(deletionCursor)}`
        : 'deletions?limit=2';
      const page = await json(await consoleRequest(userId, query));
      deletionSeen.push(...(page.items as Array<{ id: string }>).map((item) => item.id));
      deletionCursor = page.nextCursor as string | null;
    } while (deletionCursor);
    expect(deletionSeen.filter((id) => deletionIds.includes(id))).toEqual(
      [...deletionIds].reverse(),
    );
    expect(new Set(deletionSeen).size).toBe(deletionSeen.length);
    expect(deletionSeen).not.toContain(foreignDeletion.rows[0]!.id);
  });

  it('rejects a copy whose drive is marked while its row lock is pending', async () => {
    const userId = `e2e_copy_race_${randomUUID()}`;
    const fixture = await createConsoleFixture(userId);
    const fileId = randomUUID();
    const versionId = randomUUID();
    const sourceKey = `objects/${fixture.accountId}/${fixture.driveId}/${versionId}`;
    await pool.query(
      `INSERT INTO files (id,drive_id,path,current_version_id)
       VALUES ($1,$2,'/source.bin',$3)`,
      [fileId, fixture.driveId, versionId],
    );
    await pool.query(
      `INSERT INTO versions
         (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,7,'wrapped',$5)`,
      [versionId, fileId, fixture.driveId, sourceKey, fixture.agentId],
    );
    await putVersionedObject(sourceKey, 'source bytes');
    const machineCount = async () =>
      Number(
        (
          await pool.query('SELECT count(*)::int AS count FROM machines WHERE agent_id=$1', [
            fixture.agentId,
          ])
        ).rows[0]!.count,
      );
    const machinesBefore = await machineCount();
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('UPDATE drives SET deleting_at=now() WHERE id=$1', [fixture.driveId]);
    const request = handleApiRequest(
      new Request(`${root}/api/v1/drives/${fixture.driveId}/copy`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${fixture.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ path: '/source.bin', destinationPath: '/copy.bin' }),
      }),
    );
    try {
      await vi.waitFor(
        async () => {
          const blocked = await pool.query(
            `SELECT 1 FROM pg_stat_activity
              WHERE wait_event_type='Lock'
                AND query LIKE '%deleting_at IS NULL FOR UPDATE%'`,
          );
          expect(blocked.rowCount).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
      await client.query('COMMIT');
      const response = await request;
      expect(response.status).toBe(404);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM versions WHERE drive_id=$1', [
          fixture.driveId,
        ])
      ).rows[0]!.count,
    ).toBe(1);
    expect(await machineCount()).toBe(machinesBefore);
    const objects = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: `objects/${fixture.accountId}/${fixture.driveId}/`,
      }),
    );
    expect(
      [...(objects.Versions ?? []), ...(objects.DeleteMarkers ?? [])].map((v) => v.Key),
    ).toEqual([sourceKey]);
  });

  it('blocks ambiguous and pending account billing state, then finalizes without resurrecting identity', async () => {
    const userId = `clerk_paid_${randomUUID()}`;
    const fixture = await createConsoleFixture(userId);
    const stripeCustomerId = `cus_${randomUUID().replaceAll('-', '')}`;
    const privateEmail = `private-${randomUUID()}@example.test`;
    const privateAgentName = `private-agent-${randomUUID()}`;
    const privateDriveName = `private-drive-${randomUUID()}`;
    const privateFilePath = `/private-file-${randomUUID()}.bin`;
    const fileId = randomUUID();
    const versionId = randomUUID();
    const objectKey = `objects/${fixture.accountId}/${fixture.driveId}/${versionId}`;
    const stagingKey = `staging/${fixture.accountId}/${fixture.driveId}/${randomUUID()}`;
    await pool.query('UPDATE agents SET name=$2 WHERE id=$1', [fixture.agentId, privateAgentName]);
    await pool.query('UPDATE drives SET name=$2 WHERE id=$1', [fixture.driveId, privateDriveName]);
    await pool.query(
      'INSERT INTO files (id,drive_id,path,current_version_id) VALUES ($1,$2,$3,$4)',
      [fileId, fixture.driveId, privateFilePath, versionId],
    );
    await pool.query(
      `INSERT INTO versions
         (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,7,'wrapped',$5)`,
      [versionId, fileId, fixture.driveId, objectKey, fixture.agentId],
    );
    await putVersionedObject(objectKey, 'paid account ciphertext');
    await putVersionedObject(stagingKey, 'paid account staging');
    await pool.query(
      `INSERT INTO billing_accounts
         (account_id,plan,stripe_customer_id,checkout_idempotency_key)
       VALUES ($1,'developer',$2,'checkout-ambiguous')
       ON CONFLICT (account_id) DO UPDATE SET
         plan='developer',stripe_customer_id=$2,
         checkout_idempotency_key='checkout-ambiguous',checkout_session_id=NULL`,
      [fixture.accountId, stripeCustomerId],
    );
    await pool.query('UPDATE billing_accounts SET alert_email=$2 WHERE account_id=$1', [
      fixture.accountId,
      privateEmail,
    ]);
    const queued = await consoleRequest(userId, 'account', 'DELETE', {
      confirmation: 'DELETE MY ACCOUNT',
    });
    expect(queued.status).toBe(202);
    const deletion = (await json(queued)).deletion as { id: string };
    await pool.query('UPDATE deletion_jobs SET not_before=now() WHERE id=$1', [deletion.id]);
    await pool.query(
      `INSERT INTO billing_meter_reports (account_id,period_start,stripe_customer_id,cents)
       VALUES ($1,date_trunc('month',now()),$2,1)`,
      [fixture.accountId, stripeCustomerId],
    );
    const closeBilling = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider response must not leak'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const drainBilling = vi.fn(async () => undefined);
    const deleteIdentity = vi
      .fn()
      .mockRejectedValueOnce(new Error('identity provider detail'))
      .mockResolvedValue(undefined);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(closeBilling).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(1);
    await pool.query(
      `UPDATE billing_accounts SET checkout_session_id='cs_known'
        WHERE account_id=$1`,
      [fixture.accountId],
    );
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(closeBilling).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(1);
    await pool.query(
      `UPDATE billing_meter_reports SET reported_at=now()
        WHERE account_id=$1 AND reported_at IS NULL`,
      [fixture.accountId],
    );
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(closeBilling).toHaveBeenCalledWith(fixture.accountId, stripeCustomerId);
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(1);
    expect(
      (await pool.query('SELECT billing_closed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.billing_closed_at,
    ).toBeNull();

    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(deleteIdentity).not.toHaveBeenCalled();
    expect(closeBilling).toHaveBeenCalledTimes(2);
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(1);
    expect(
      (await pool.query('SELECT billing_closed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.billing_closed_at,
    ).toBeNull();
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(deleteIdentity).toHaveBeenCalledOnce();
    expect(closeBilling).toHaveBeenCalledTimes(3);
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(1);
    expect((await pool.query('SELECT 1 FROM files WHERE id=$1', [fileId])).rowCount).toBe(1);
    expect(
      (await pool.query('SELECT billing_closed_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.billing_closed_at,
    ).not.toBeNull();
    expect(
      (await pool.query('SELECT identity_deleted_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.identity_deleted_at,
    ).toBeNull();

    const failedStore = {
      send: vi.fn().mockRejectedValue(new Error('private storage endpoint detail')),
    } as unknown as S3Client;
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: failedStore,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(deleteIdentity).toHaveBeenCalledTimes(2);
    expect(closeBilling).toHaveBeenCalledTimes(3);
    expect(
      (await pool.query('SELECT identity_deleted_at FROM deletion_jobs WHERE id=$1', [deletion.id]))
        .rows[0]!.identity_deleted_at,
    ).not.toBeNull();
    expect(
      (await pool.query('SELECT last_error FROM deletion_jobs WHERE id=$1', [deletion.id])).rows[0]!
        .last_error,
    ).toBe('Deletion cleanup is retryable.');
    expect((await pool.query('SELECT 1 FROM files WHERE id=$1', [fileId])).rowCount).toBe(1);
    expect(
      (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }))).ContentLength,
    ).toBe('paid account ciphertext'.length);
    await pool.query('UPDATE deletion_jobs SET not_before=now(),lease_until=NULL WHERE id=$1', [
      deletion.id,
    ]);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling,
      drainBilling,
      deleteIdentity,
      jobIds: [deletion.id],
    });
    expect(deleteIdentity).toHaveBeenCalledTimes(2);
    expect(closeBilling).toHaveBeenCalledTimes(3);
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [fixture.accountId])).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT 1 FROM console_user_tombstones WHERE external_user_hash=$1', [
          tokenHash(userId),
        ])
      ).rowCount,
    ).toBe(1);
    expect((await bearerRequest('whoami', fixture.key)).status).toBe(401);
    expect((await consoleRequest(userId, 'deletions')).status).toBe(401);
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE external_clerk_user_id=$1', [userId]))
        .rowCount,
    ).toBe(0);
    expect((await pool.query('SELECT 1 FROM files WHERE id=$1', [fileId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM versions WHERE id=$1', [versionId])).rowCount).toBe(0);
    for (const prefix of [`objects/${fixture.accountId}/`, `staging/${fixture.accountId}/`]) {
      const remaining = await s3.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }),
      );
      expect([...(remaining.Versions ?? []), ...(remaining.DeleteMarkers ?? [])]).toHaveLength(0);
    }
    const receipt = await pool.query<{ statement: Record<string, unknown> }>(
      `SELECT statement FROM deletion_billing_receipts
        WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1`,
      [fixture.accountId],
    );
    expect(receipt.rowCount).toBe(1);
    expect(receipt.rows[0]!.statement.plan).toBe('developer');
    expect(receipt.rows[0]!.statement.totalCents).toBe('2000');
    const receiptJson = JSON.stringify(receipt.rows[0]!.statement);
    for (const privateValue of [
      userId,
      stripeCustomerId,
      privateEmail,
      privateAgentName,
      privateDriveName,
      privateFilePath,
    ]) {
      expect(receiptJson).not.toContain(privateValue);
    }

    const freeUserId = `e2e_free_${randomUUID()}`;
    const free = await createConsoleFixture(freeUserId);
    const freeQueued = await consoleRequest(freeUserId, 'account', 'DELETE', {
      confirmation: 'DELETE MY ACCOUNT',
    });
    const freeJobId = ((await json(freeQueued)).deletion as { id: string }).id;
    await pool.query('UPDATE deletion_jobs SET not_before=now() WHERE id=$1', [freeJobId]);
    const freeCloseBilling = vi.fn(async () => true);
    await runDeletionMaintenance({
      objectStore: s3,
      closeBilling: freeCloseBilling,
      drainBilling,
      jobIds: [freeJobId],
    });
    expect(freeCloseBilling).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT 1 FROM accounts WHERE id=$1', [free.accountId])).rowCount,
    ).toBe(0);
  });
});

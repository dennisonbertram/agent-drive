import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PLANS } from '../billing/policy';
import { getPool } from '../db/client';
import { copyObject, deleteObject, objectInfo } from './storage';
import { handleApiRequest, handlePublicShareRequest } from './handler';
import { MAX_QUERY_LENGTH } from './validation';
import { cleanupExpiredUploads } from './upload-cleanup';
import type { RecentFileEvent } from './contract';
import {
  decryptWithFileKey,
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from '../../../../packages/agent-drive/src/crypto.js';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
let driveId = '';
let otherDriveId = '';
let quotaDriveId = '';
let manageToken = '';
let writeToken = '';
let writeOnlyToken = '';
let deleteOnlyToken = '';
let readToken = '';
let shareToken = '';
let writeAgentId = '';
let otherAgentId = '';
let otherToken = '';
let revokedKeyId = '';
let revokedToken = '';
let writeKeyId = '';
let copyToken = '';
let copyAgentId = '';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function request(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
  headers?: HeadersInit,
) {
  return handleApiRequest(
    new Request(
      `${root}${path}`,
      (() => {
        const init: RequestInit = {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        return init;
      })(),
    ),
  );
}

// The integration fixture intentionally inspects JSON responses without modeling every route payload.
async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as Record<string, any>;
}

async function fixture(
  accountName: string,
  agentName: string,
  driveName: string,
  scopes: string[],
  driveIds: string[] = [],
) {
  const account = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `${accountName}-${randomUUID()}`,
  ]);
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  const agent = await pool.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, agentName],
  );
  const agentId = agent.rows[0].id as string;
  const drive = await pool.query(
    'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, driveName],
  );
  const id = drive.rows[0].id as string;
  const token = key();
  const ids = driveIds.length ? driveIds : [id];
  const keyRow = await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[]) RETURNING id`,
    [accountId, agentId, 'integration', tokenHash(token), ids, scopes],
  );
  return { accountId, agentId, driveId: id, token, keyId: keyRow.rows[0].id as string };
}

async function operationBudgetFixture(label: string) {
  const reader = await fixture(label, `${label}-agent`, `${label}-drive`, ['read']);
  const path = `/${label}-${randomUUID()}.bin`;
  const fileId = (
    await pool.query<{ id: string }>(
      'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
      [reader.driveId, path],
    )
  ).rows[0]!.id;
  const versionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions
         (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,1,'opaque-wrapped-key',$4) RETURNING id`,
      [fileId, reader.driveId, `objects/${label}/${randomUUID()}`, reader.agentId],
    )
  ).rows[0]!.id;
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  await pool.query(
    `INSERT INTO billing_accounts (account_id,plan,spend_cap_cents)
     VALUES ($1,'free',0)
     ON CONFLICT (account_id) DO UPDATE SET plan='free', spend_cap_cents=0`,
    [reader.accountId],
  );
  return { ...reader, fileId, versionId, path };
}

async function uploadCommit(
  token: string,
  id: string,
  path: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const intentResponse = await request(
    `/drives/${id}/put`,
    token,
    'POST',
    {
      path,
      ciphertextSize: bytes.length,
      wrappedKey: 'opaque-wrapped-key',
      machineName: 'ignored',
      tags: ['phase1'],
      userId: 'user-1',
      ...extra,
    },
    { 'x-agent-drive-machine': 'integration-machine' },
  );
  expect(intentResponse.status).toBe(201);
  const intent = await json(intentResponse);
  const upload = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes) as BodyInit,
  });
  expect(upload.ok).toBe(true);
  const commitResponse = await request(`/drives/${id}/commit`, token, 'POST', {
    intentId: intent.intentId,
  });
  return {
    response: commitResponse,
    body: await json(commitResponse),
    intentId: intent.intentId as string,
    uploadUrl: intent.uploadUrl as string,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const first = await fixture('phase1-a', 'writer', 'drive', ['read', 'write', 'delete']);
  driveId = first.driveId;
  writeToken = first.token;
  writeKeyId = first.keyId;
  writeAgentId = first.agentId;
  copyAgentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      first.accountId,
      'copy-attribution-agent',
    ])
  ).rows[0].id as string;
  copyToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'copy-attribution',$3,$4::uuid[],ARRAY['read','write']::text[])`,
    [first.accountId, copyAgentId, tokenHash(copyToken), [driveId]],
  );
  shareToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'share integration',$3,$4::uuid[],ARRAY['read','share','delete']::text[])`,
    [first.accountId, first.agentId, tokenHash(shareToken), [driveId]],
  );
  writeOnlyToken = key();
  deleteOnlyToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'write-only',$3,$4::uuid[],ARRAY['write']::text[]),
            ($1,$2,'delete-only',$5,$4::uuid[],ARRAY['delete']::text[])`,
    [
      first.accountId,
      first.agentId,
      tokenHash(writeOnlyToken),
      [driveId],
      tokenHash(deleteOnlyToken),
    ],
  );
  readToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'read-only integration',$3,$4::uuid[],ARRAY['read']::text[])`,
    [first.accountId, first.agentId, tokenHash(readToken), [driveId]],
  );
  const quotaDrive = await pool.query(
    'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,4) RETURNING id',
    [first.accountId, `quota-${randomUUID()}`],
  );
  quotaDriveId = quotaDrive.rows[0].id as string;
  await pool.query(
    'UPDATE api_keys SET drive_ids = array_append(drive_ids, $1::uuid) WHERE token_hash = $2',
    [quotaDriveId, tokenHash(writeToken)],
  );
  const manager = await fixture('phase1-manager', 'manager', 'manage', ['manage']);
  manageToken = manager.token;
  const other = await fixture('phase1-b', 'other', 'other-drive', ['read', 'write', 'delete']);
  otherDriveId = other.driveId;
  otherAgentId = other.agentId;
  otherToken = other.token;
  const revoked = await fixture('phase1-revoked', 'revoked', 'revoked-drive', ['read'], [driveId]);
  revokedKeyId = revoked.keyId;
  revokedToken = revoked.token;
  await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [revokedKeyId]);
});

afterAll(async () => {
  for (const id of accountIds) {
    const artifacts = await pool.query(
      `SELECT object_key AS key FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)
       UNION SELECT staging_key AS key FROM upload_intents WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)`,
      [id],
    );
    for (const artifact of artifacts.rows) await deleteObject(artifact.key).catch(() => undefined);
    await pool.query('DELETE FROM audit_events WHERE account_id = $1', [id]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }
  await pool.end();
});

describe('Phase 1 core API', () => {
  it('supports encrypted-object upload, versions, immutable bytes, restore, copy, move, search and recent', async () => {
    const firstBytes = Buffer.from('ciphertext-one');
    const first = await uploadCommit(writeToken, driveId, '/folder/file.bin', firstBytes, {
      tags: ['first'],
    });
    expect(first.response.status).toBe(201);
    const firstVersion = first.body.version.id as string;
    const firstEventCount = await pool.query(
      'SELECT count(*)::int AS count FROM file_events WHERE version_id = $1',
      [firstVersion],
    );
    const get = await request(`/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin`, writeToken);
    const getBody = await json(get);
    expect(get.status).toBe(200);
    expect(await (await fetch(getBody.downloadUrl)).text()).toBe('ciphertext-one');
    const reusedUpload = await fetch(first.uploadUrl, {
      method: 'PUT',
      body: Buffer.from('tampered-bytes'),
    });
    expect(reusedUpload.ok).toBe(true);
    const repeatedCommit = await request(`/drives/${driveId}/commit`, writeToken, 'POST', {
      intentId: first.intentId,
    });
    expect(repeatedCommit.status).toBe(200);
    expect((await json(repeatedCommit)).version.id).toBe(firstVersion);
    const retryEventCount = await pool.query(
      'SELECT count(*)::int AS count FROM file_events WHERE version_id = $1',
      [firstVersion],
    );
    expect(firstEventCount.rows[0].count).toBe(1);
    expect(retryEventCount.rows[0].count).toBe(1);
    const immutable = await json(
      await request(
        `/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin&versionId=${firstVersion}`,
        writeToken,
      ),
    );
    expect(await (await fetch(immutable.downloadUrl)).text()).toBe('ciphertext-one');
    const overwrite = await uploadCommit(
      writeToken,
      driveId,
      '/folder/file.bin',
      Buffer.from('ciphertext-two'),
      { ifVersionId: firstVersion },
    );
    expect(overwrite.response.status).toBe(201);
    const old = await request(
      `/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin&versionId=${firstVersion}`,
      writeToken,
    );
    expect(await (await fetch((await json(old)).downloadUrl)).text()).toBe('ciphertext-one');
    const copied = await request(`/drives/${driveId}/copy`, writeToken, 'POST', {
      path: '/folder/file.bin',
      destinationPath: '/copy.bin',
    });
    expect(copied.status).toBe(201);
    const recentBeforeMove = (await json(
      await request(`/drives/${driveId}/recent?limit=100`, writeToken),
    )) as { items: RecentFileEvent[] };
    expect(recentBeforeMove.items.some((event) => event.operation === 'put')).toBe(true);
    expect(recentBeforeMove.items.some((event) => event.operation === 'copy')).toBe(true);
    const recentSince = (await pool.query('SELECT clock_timestamp()::text AS since')).rows[0]
      .since as string;
    const moved = await request(
      `/drives/${driveId}/move`,
      writeToken,
      'POST',
      {
        path: '/copy.bin',
        destinationPath: '/moved.bin',
        userId: 'move-user',
      },
      { 'x-agent-drive-machine': 'move-machine' },
    );
    expect(moved.status).toBe(200);
    expect(
      (await json(await request(`/drives/${driveId}/search?q=moved`, writeToken))).items.length,
    ).toBeGreaterThan(0);
    const versions = await json(
      await request(`/drives/${driveId}/versions?path=%2Ffolder%2Ffile.bin&limit=1`, writeToken),
    );
    expect(versions.items).toHaveLength(1);
    expect(versions.nextCursor).toEqual(expect.any(String));
    const nextVersions = await json(
      await request(
        `/drives/${driveId}/versions?path=%2Ffolder%2Ffile.bin&limit=1&cursor=${encodeURIComponent(versions.nextCursor)}`,
        writeToken,
      ),
    );
    expect(nextVersions.items).toHaveLength(1);
    expect(
      (
        await request(
          `/drives/${driveId}/delete`,
          writeToken,
          'POST',
          { path: '/folder/file.bin', userId: 'delete-user' },
          { 'x-agent-drive-machine': 'delete-machine' },
        )
      ).status,
    ).toBe(200);
    const recentPage = (await json(
      await request(
        `/drives/${driveId}/recent?since=${encodeURIComponent(recentSince)}&limit=1`,
        writeToken,
      ),
    )) as { items: RecentFileEvent[]; nextCursor: string | null };
    expect(recentPage.items).toHaveLength(1);
    expect(recentPage.nextCursor).toEqual(expect.any(String));
    const recentCursor = recentPage.nextCursor;
    if (recentCursor === null) throw new Error('Expected a recent events cursor.');
    const nextRecentPage = (await json(
      await request(
        `/drives/${driveId}/recent?since=${encodeURIComponent(recentSince)}&limit=1&cursor=${encodeURIComponent(recentCursor)}`,
        writeToken,
      ),
    )) as { items: RecentFileEvent[]; nextCursor: string | null };
    expect(nextRecentPage.items).toHaveLength(1);
    expect(nextRecentPage.nextCursor).toBeNull();
    const recentEvents = [...recentPage.items, ...nextRecentPage.items];
    const moveEvent = recentEvents.find((event) => event.operation === 'move');
    const deleteEvent = recentEvents.find((event) => event.operation === 'delete');
    if (!moveEvent || !deleteEvent) throw new Error('Expected move and delete events.');
    expect(moveEvent).toMatchObject({
      path: '/moved.bin',
      previousPath: '/copy.bin',
      agentId: writeAgentId,
      userId: 'move-user',
    });
    expect(moveEvent.machineId).toEqual(expect.any(String));
    expect(moveEvent.versionId).toEqual(expect.any(String));
    expect(deleteEvent).toMatchObject({
      path: '/folder/file.bin',
      agentId: writeAgentId,
      userId: 'delete-user',
    });
    expect(deleteEvent.previousPath).toBeNull();
    expect(deleteEvent.machineId).toEqual(expect.any(String));
    expect(deleteEvent.versionId).toEqual(expect.any(String));
    expect(JSON.stringify(recentEvents)).not.toContain('opaque-wrapped-key');
    expect(JSON.stringify(recentEvents)).not.toContain('objects/');
    expect(
      (await request(`/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin`, writeToken)).status,
    ).toBe(404);
    expect(
      (
        await request(`/drives/${driveId}/restore`, writeToken, 'POST', {
          path: '/folder/file.bin',
          versionId: firstVersion,
        })
      ).status,
    ).toBe(201);
    const restoredRecent = (await json(
      await request(`/drives/${driveId}/recent?limit=100`, writeToken),
    )) as { items: RecentFileEvent[] };
    expect(restoredRecent.items.some((event) => event.operation === 'restore')).toBe(true);
    await uploadCommit(writeToken, driveId, '/folder/second.bin', Buffer.from('second'));
    const listed = await json(
      await request(`/drives/${driveId}/list?prefix=%2Ffolder&limit=1`, writeToken),
    );
    expect(listed.items).toHaveLength(1);
    expect(listed.nextCursor).toEqual(expect.any(String));
    const next = await json(
      await request(
        `/drives/${driveId}/list?prefix=%2Ffolder&limit=1&cursor=${encodeURIComponent(listed.nextCursor)}`,
        writeToken,
      ),
    );
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it('resumes recent from latestCursor with author names; the seq cursor is authoritative and never skips a late-committing event', async () => {
    type Tail = {
      items: (RecentFileEvent & { agentName: string | null })[];
      nextCursor: string | null;
      latestCursor: string | null;
    };
    const tail = async (query: string) =>
      (await json(await request(`/drives/${driveId}/recent?${query}`, writeToken))) as Tail;
    const paths = (page: Tail) => page.items.map((event) => event.path);
    let latest: Tail = await tail('limit=100');
    while (latest.nextCursor) {
      latest = await tail(`limit=100&cursor=${encodeURIComponent(latest.nextCursor)}`);
    }
    const cursor0 = latest.latestCursor ?? '';
    expect(cursor0).not.toBe('');
    const since = new Date().toISOString();
    for (const name of ['a', 'b', 'c'])
      await uploadCommit(writeToken, driveId, `/tail/${name}.bin`, Buffer.from(name));
    const agentName = (await pool.query('SELECT name FROM agents WHERE id = $1', [writeAgentId]))
      .rows[0].name as string;
    const first = await tail(`limit=1&cursor=${encodeURIComponent(cursor0)}`);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ agentId: writeAgentId, agentName, path: '/tail/a.bin' });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.latestCursor).toBe(first.nextCursor);
    // the cursor wins over a since that is later than every event
    const future = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    const rest = await tail(
      `cursor=${encodeURIComponent(first.latestCursor ?? '')}&since=${future}`,
    );
    expect(paths(rest)).toEqual(['/tail/b.bin', '/tail/c.bin']);
    expect(rest.nextCursor).toBeNull();
    const end = rest.latestCursor ?? '';
    expect(await tail(`cursor=${encodeURIComponent(end)}`)).toEqual({
      items: [],
      nextCursor: null,
      latestCursor: end,
    });
    await uploadCommit(writeToken, driveId, '/tail/d.bin', Buffer.from('d'));
    const afterPut = await tail(`cursor=${encodeURIComponent(end)}`);
    expect(paths(afterPut)).toEqual(['/tail/d.bin']);
    // without a cursor, since still filters by created_at
    expect(paths(await tail(`since=${encodeURIComponent(since)}&limit=100`))).toContain(
      '/tail/a.bin',
    );

    // late commit: an older transaction takes the drive lock after a newer one committed
    const fileId = (
      await pool.query('SELECT id FROM files WHERE drive_id = $1 AND path = $2', [
        driveId,
        '/tail/a.bin',
      ])
    ).rows[0].id as string;
    const insert = (client: PoolClient, path: string) =>
      client.query(
        `INSERT INTO file_events (drive_id, file_id, operation, path, agent_id)
         VALUES ($1, $2, 'put', $3, $4)`,
        [driveId, fileId, path, writeAgentId],
      );
    const tx1 = await pool.connect();
    const tx2 = await pool.connect();
    let seen: Tail;
    try {
      await tx1.query('BEGIN');
      await tx1.query('SELECT now()'); // tx1 starts first (older created_at) but does not lock
      await tx2.query('BEGIN');
      await tx2.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [driveId]);
      await insert(tx2, '/tail/newer-tx.bin');
      await tx2.query('COMMIT');
      seen = await tail(`cursor=${encodeURIComponent(afterPut.latestCursor ?? '')}`);
      expect(paths(seen)).toEqual(['/tail/newer-tx.bin']);
      await tx1.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [driveId]);
      await insert(tx1, '/tail/older-tx.bin');
      await tx1.query('COMMIT');
    } finally {
      tx1.release();
      tx2.release();
    }
    expect(paths(await tail(`cursor=${encodeURIComponent(seen.latestCursor ?? '')}`))).toEqual([
      '/tail/older-tx.bin',
    ]);
  });

  it('migration 0015 numbers existing events by (created_at, id) and continues the sequence', async () => {
    const sqlText = readFileSync(
      resolve(__dirname, '../../drizzle/0015_typical_doctor_spectrum.sql'),
      'utf8',
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA mig0015');
      await client.query('SET LOCAL search_path = mig0015');
      await client.query(
        'CREATE TABLE file_events (id uuid PRIMARY KEY, drive_id uuid NOT NULL, created_at timestamptz NOT NULL)',
      );
      const drive = randomUUID();
      // inserted out of (created_at, id) order
      const rows: [string, string][] = [
        ['00000000-0000-4000-8000-000000000003', '2025-01-02T00:00:00Z'],
        ['00000000-0000-4000-8000-000000000002', '2025-01-01T00:00:00Z'],
        ['00000000-0000-4000-8000-000000000001', '2025-01-01T00:00:00Z'],
      ];
      for (const [id, at] of rows)
        await client.query('INSERT INTO file_events VALUES ($1, $2, $3)', [id, drive, at]);
      for (const statement of sqlText.split('--> statement-breakpoint'))
        await client.query(statement);
      const ordered = await client.query('SELECT id FROM file_events ORDER BY seq');
      expect(ordered.rows.map((row) => row.id.slice(-1))).toEqual(['1', '2', '3']);
      await client.query(
        'INSERT INTO file_events (id, drive_id, created_at) VALUES ($1, $2, now())',
        [randomUUID(), drive],
      );
      const max = await client.query('SELECT seq::int AS seq FROM file_events ORDER BY seq DESC');
      expect(max.rows.map((row) => row.seq)).toEqual([4, 3, 2, 1]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('ignores since when a cursor is sent, even if since is invalid', async () => {
    const first = (await json(await request(`/drives/${driveId}/recent?limit=1`, writeToken))) as {
      latestCursor: string | null;
    };
    const cursor = encodeURIComponent(first.latestCursor ?? '');
    const ok = await request(
      `/drives/${driveId}/recent?cursor=${cursor}&since=not-a-date`,
      writeToken,
    );
    expect(ok.status).toBe(200);
    const bad = await request(`/drives/${driveId}/recent?since=not-a-date`, writeToken);
    expect(bad.status).toBe(400);
  });

  it('creates, scopes, expires, revokes, and audits encrypted shares without storing file keys', async () => {
    const driveKey = generateDriveKey();
    const plaintextA = new TextEncoder().encode('share A bytes');
    const encryptedA = await encryptFile(plaintextA, driveKey);
    const uploadedA = await uploadCommit(
      writeToken,
      driveId,
      '/sharing/a.txt',
      Buffer.from(encryptedA.ciphertext),
      { wrappedKey: encryptedA.wrappedKey },
    );
    const fileKeyA = await unwrapFileKey(encryptedA.wrappedKey, driveKey);
    const plaintextB = new TextEncoder().encode('different file B');
    const encryptedB = await encryptFile(plaintextB, driveKey);
    await uploadCommit(writeToken, driveId, '/sharing/b.txt', Buffer.from(encryptedB.ciphertext), {
      wrappedKey: encryptedB.wrappedKey,
    });
    expect(await decryptWithFileKey(new Uint8Array(encryptedA.ciphertext), fileKeyA)).toEqual(
      plaintextA,
    );
    await expect(
      decryptWithFileKey(new Uint8Array(encryptedB.ciphertext), fileKeyA),
    ).rejects.toMatchObject({ code: 'decryption_failed' });

    expect(
      (
        await request(`/drives/${driveId}/shares`, readToken, 'POST', {
          path: '/sharing/a.txt',
        })
      ).status,
    ).toBe(403);
    expect((await request(`/drives/${otherDriveId}/shares`, shareToken, 'GET')).status).toBe(403);
    for (const expiresAt of [
      new Date(Date.now() + 30_000).toISOString(),
      new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
    ]) {
      expect(
        (
          await request(`/drives/${driveId}/shares`, shareToken, 'POST', {
            path: '/sharing/a.txt',
            expiresAt,
          })
        ).status,
      ).toBe(400);
    }
    expect((await handlePublicShareRequest('invalid')).status).toBe(404);

    const createdResponse = await request(`/drives/${driveId}/shares`, shareToken, 'POST', {
      path: '/sharing/a.txt',
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    const shareId = created.id as string;
    const publicResponse = await handlePublicShareRequest(shareId);
    expect(publicResponse.status).toBe(200);
    const publicBody = await json(publicResponse);
    expect(publicBody.name).toBe('a.txt');
    expect(new URL(publicBody.downloadUrl as string).searchParams.get('X-Amz-Expires')).toBe('60');
    const listed = await json(await request(`/drives/${driveId}/shares`, shareToken));
    expect(listed.items.some((item: { id: string }) => item.id === shareId)).toBe(true);
    const downloaded = await fetch(publicBody.downloadUrl as string);
    expect(
      await decryptWithFileKey(new Uint8Array(await downloaded.arrayBuffer()), fileKeyA),
    ).toEqual(plaintextA);

    const revokedOnce = await request(`/drives/${driveId}/shares/${shareId}`, shareToken, 'DELETE');
    const revokedAt = (await json(revokedOnce)).revokedAt;
    const revokedTwice = await request(
      `/drives/${driveId}/shares/${shareId}`,
      shareToken,
      'DELETE',
    );
    expect((await json(revokedTwice)).revokedAt).toBe(revokedAt);
    const revoked = await handlePublicShareRequest(shareId);
    expect(revoked.status).toBe(410);
    expect((await json(revoked)).error.code).toBe('share_revoked');

    const expiring = await json(
      await request(`/drives/${driveId}/shares`, shareToken, 'POST', {
        path: '/sharing/a.txt',
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      }),
    );
    await pool.query(
      `UPDATE shares
          SET created_at = now() - interval '2 seconds',
              expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [expiring.id],
    );
    const expired = await handlePublicShareRequest(expiring.id as string);
    expect(expired.status).toBe(410);
    expect((await json(expired)).error.code).toBe('share_expired');

    const unavailable = await json(
      await request(`/drives/${driveId}/shares`, shareToken, 'POST', { path: '/sharing/a.txt' }),
    );
    await request(`/drives/${driveId}/delete`, shareToken, 'POST', { path: '/sharing/a.txt' });
    const trashed = await handlePublicShareRequest(unavailable.id as string);
    expect(trashed.status).toBe(410);
    expect((await json(trashed)).error.code).toBe('share_unavailable');
    const trashedShare = (
      await json(await request(`/drives/${driveId}/shares`, shareToken))
    ).items.find((item: { id: string }) => item.id === unavailable.id);
    expect(trashedShare).toMatchObject({ status: 'unavailable' });
    const missing = await handlePublicShareRequest(randomUUID().replaceAll('-', '_').slice(0, 22));
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.message).toBe('This share link does not exist.');

    const stored = await pool.query(
      `SELECT (SELECT COALESCE(json_agg(shares), '[]'::json) FROM shares WHERE drive_id = $1) AS shares,
              (SELECT COALESCE(json_agg(audit_events), '[]'::json) FROM audit_events
                WHERE account_id = (SELECT account_id FROM drives WHERE id = $1)
                  AND action LIKE 'share.%') AS events`,
      [driveId],
    );
    expect(
      (stored.rows[0].events as Array<{ action: string; outcome: string }>).some(
        (event) => event.action === 'share.access' && event.outcome === 'success',
      ),
    ).toBe(true);
    expect(JSON.stringify(stored.rows[0]).includes(fileKeyA)).toBe(false);
    expect(JSON.stringify(stored.rows[0]).includes(driveKey)).toBe(false);
    void uploadedA;
  });

  it('allows write-only commits and delete-only deletes without granting read', async () => {
    const written = await uploadCommit(
      writeOnlyToken,
      driveId,
      '/write-only.bin',
      Buffer.from('write-only-data'),
    );
    expect(written.response.status).toBe(201);
    expect(
      (await request(`/drives/${driveId}/get?path=%2Fwrite-only.bin`, writeOnlyToken)).status,
    ).toBe(403);
    await uploadCommit(writeToken, driveId, '/delete-only.bin', Buffer.from('delete-me'));
    expect(
      (
        await request(`/drives/${driveId}/delete`, deleteOnlyToken, 'POST', {
          path: '/delete-only.bin',
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/drives/${driveId}/get?path=%2Fdelete-only.bin`, deleteOnlyToken)).status,
    ).toBe(403);
    const scopedDrives = await json(await request('/drives?limit=1', readToken));
    expect(scopedDrives.items.map((drive: { id: string }) => drive.id)).toContain(driveId);
  });

  it('limits writes, moves, copies, deletes and restores to write_paths while reads stay drive-wide', async () => {
    const owner = await fixture('wp', 'wp-agent', 'wp-drive', ['manage']);
    const create = (writePaths: unknown) =>
      request('/keys', owner.token, 'POST', {
        agentId: owner.agentId,
        label: 'limited',
        driveIds: [owner.driveId],
        scopes: ['read', 'write', 'delete'],
        writePaths,
      });
    for (const bad of [['/'], ['inbox'], ['/a/'], Array.from({ length: 17 }, (_, i) => `/p${i}`)])
      expect((await create(bad)).status).toBe(400);
    const created = await json(await create(['/inbox/x', '/inbox/x']));
    expect(created.write_paths).toEqual(['/inbox/x']);
    const token = created.token as string;
    expect((await json(await request('/whoami', token))).writePaths).toEqual(['/inbox/x']);
    const listed = await json(await request('/keys', owner.token));
    expect(listed.items.find((k: { id: string }) => k.id === created.id).write_paths).toEqual([
      '/inbox/x',
    ]);

    const denied = async (response: Response) => {
      expect(response.status).toBe(403);
      expect((await json(response)).error.message).toBe(
        'The API key may only write under /inbox/x.',
      );
    };
    const bytes = Buffer.from('limited');
    expect(
      (await uploadCommit(token, owner.driveId, '/inbox/x/a.txt', bytes)).response.status,
    ).toBe(201);
    expect((await uploadCommit(token, owner.driveId, '/inbox/x', bytes)).response.status).toBe(201);
    for (const path of ['/inbox/xy/a.txt', '/outputs/a.txt'])
      await denied(
        await request(`/drives/${owner.driveId}/put`, token, 'POST', {
          path,
          ciphertextSize: 1,
          wrappedKey: 'opaque-wrapped-key',
        }),
      );
    const post = (op: string, body: Record<string, unknown>) =>
      request(`/drives/${owner.driveId}/${op}`, token, 'POST', body);
    // A file outside the prefix, written by an unrestricted key of the same drive.
    const wide = key();
    await pool.query(
      `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
       VALUES ($1,$2,'wide',$3,$4::uuid[],ARRAY['read','write','delete']::text[])`,
      [owner.accountId, owner.agentId, tokenHash(wide), [owner.driveId]],
    );
    await uploadCommit(wide, owner.driveId, '/outputs/o.txt', bytes);
    await denied(await post('move', { path: '/inbox/x/a.txt', destinationPath: '/outputs/m.txt' }));
    await denied(await post('move', { path: '/outputs/o.txt', destinationPath: '/inbox/x/m.txt' }));
    expect(
      (await post('move', { path: '/inbox/x/a.txt', destinationPath: '/inbox/x/b.txt' })).status,
    ).toBe(200);
    expect(
      (await post('copy', { path: '/outputs/o.txt', destinationPath: '/inbox/x/c.txt' })).status,
    ).toBe(201);
    await denied(await post('copy', { path: '/inbox/x/c.txt', destinationPath: '/outputs/c.txt' }));
    await denied(await post('delete', { path: '/outputs/o.txt' }));
    expect((await post('delete', { path: '/inbox/x/c.txt' })).status).toBe(200);
    await request(`/drives/${owner.driveId}/delete`, wide, 'POST', { path: '/outputs/o.txt' });
    await denied(await post('restore', { path: '/outputs/o.txt' }));
    // Reads are not path-limited.
    await uploadCommit(wide, owner.driveId, '/outputs/r.txt', bytes);
    expect(
      (await request(`/drives/${owner.driveId}/get?path=%2Foutputs%2Fr.txt`, token)).status,
    ).toBe(200);
  });

  it('blocks writes at the spend cap while preserving reads and audits rate-limit responses', async () => {
    await uploadCommit(
      writeToken,
      driveId,
      '/spend-cap-readable.bin',
      Buffer.from('read remains available'),
    );
    const restoreSource = await uploadCommit(
      writeToken,
      driveId,
      '/spend-cap-restore.bin',
      Buffer.from('restore is still a write'),
    );
    const stagedResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/spend-cap-commit.bin',
      ciphertextSize: 1,
      wrappedKey: 'opaque',
    });
    const staged = await json(stagedResponse);
    const stagedUpload = await fetch(staged.uploadUrl as string, {
      method: 'PUT',
      body: new Uint8Array([42]),
    });
    expect(stagedUpload.ok).toBe(true);
    const accountId = (await pool.query('SELECT account_id FROM drives WHERE id = $1', [driveId]))
      .rows[0].account_id as string;
    await pool.query(
      `INSERT INTO billing_accounts (account_id, spend_cap_cents)
       VALUES ($1, 0)
       ON CONFLICT (account_id) DO UPDATE SET spend_cap_cents = 0`,
      [accountId],
    );
    const read = await request(`/drives/${driveId}/get?path=%2Fspend-cap-readable.bin`, writeToken);
    expect(read.status).toBe(200);
    const blocked = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/spend-cap-blocked.bin',
      ciphertextSize: 1,
      wrappedKey: 'opaque',
    });
    expect(blocked.status).toBe(402);
    expect(
      (
        await request(`/drives/${driveId}/copy`, writeToken, 'POST', {
          path: '/spend-cap-readable.bin',
          destinationPath: '/spend-cap-copy.bin',
        })
      ).status,
    ).toBe(402);
    expect(
      (
        await request(`/drives/${driveId}/commit`, writeToken, 'POST', {
          intentId: staged.intentId,
        })
      ).status,
    ).toBe(402);
    expect(
      (
        await request(`/drives/${driveId}/delete`, writeToken, 'POST', {
          path: '/spend-cap-restore.bin',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/drives/${driveId}/restore`, writeToken, 'POST', {
          path: '/spend-cap-restore.bin',
          versionId: (restoreSource.body.version as Record<string, unknown>).id,
        })
      ).status,
    ).toBe(402);
    await pool.query('UPDATE billing_accounts SET spend_cap_cents = NULL WHERE account_id = $1', [
      accountId,
    ]);

    const rateToken = key();
    const rateKey = (
      await pool.query(
        `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
         VALUES ($1,$2,'rate-limit-integration',$3,$4::uuid[],ARRAY['read']::text[])
         RETURNING id`,
        [accountId, writeAgentId, tokenHash(rateToken), [driveId]],
      )
    ).rows[0].id as string;
    vi.stubEnv('API_KEY_REQUESTS_PER_MINUTE', '1');
    try {
      expect((await request('/whoami', rateToken)).status).toBe(200);
      const limited = await request('/whoami', rateToken);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
      const audit = await pool.query(
        `SELECT action, outcome, error_code, http_status FROM audit_events
          WHERE api_key_id = $1 AND error_code = 'rate_limited' AND http_status = 429
          ORDER BY created_at DESC LIMIT 1`,
        [rateKey],
      );
      expect(audit.rows[0]).toMatchObject({
        action: 'whoami.read',
        outcome: 'failure',
        error_code: 'rate_limited',
        http_status: 429,
      });
    } finally {
      vi.unstubAllEnvs();
    }
    await pool.query('DELETE FROM api_keys WHERE id = $1', [rateKey]);
  });

  it('enforces the free retained-version allowance and serializes cross-drive reservations', async () => {
    const overLimit = await fixture('phase6-free-overage', 'writer', 'drive', ['read', 'write']);
    await pool.query('UPDATE drives SET quota_bytes = $2 WHERE id = $1', [
      overLimit.driveId,
      (6n * 1024n ** 3n).toString(),
    ]);
    const syntheticFile = (
      await pool.query('INSERT INTO files (drive_id, path) VALUES ($1,$2) RETURNING id', [
        overLimit.driveId,
        '/synthetic-retained.bin',
      ])
    ).rows[0].id as string;
    const freeAllowance = (5n * 1024n ** 3n).toString();
    await pool.query(
      `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
       VALUES ($1,$2,$3,$4,'synthetic-metadata',$5)`,
      [
        syntheticFile,
        overLimit.driveId,
        `synthetic/${randomUUID()}`,
        freeAllowance,
        overLimit.agentId,
      ],
    );
    const rejected = await request(`/drives/${overLimit.driveId}/put`, overLimit.token, 'POST', {
      path: '/blocked-by-retained-versions.bin',
      ciphertextSize: 1,
      wrappedKey: 'opaque',
    });
    expect(rejected.status).toBe(402);
    expect((await json(rejected)).error.upgradeUrl).toContain('/console/billing');

    const reserving = await fixture('phase6-reservations', 'writer', 'first-drive', [
      'read',
      'write',
    ]);
    const secondDriveId = (
      await pool.query('INSERT INTO drives (account_id, name) VALUES ($1,$2) RETURNING id', [
        reserving.accountId,
        `second-drive-${randomUUID()}`,
      ])
    ).rows[0].id as string;
    await pool.query(
      'UPDATE api_keys SET drive_ids = array_append(drive_ids, $1::uuid) WHERE token_hash = $2',
      [secondDriveId, tokenHash(reserving.token)],
    );
    const reservationFile = (
      await pool.query('INSERT INTO files (drive_id, path) VALUES ($1,$2) RETURNING id', [
        reserving.driveId,
        '/synthetic-near-limit.bin',
      ])
    ).rows[0].id as string;
    const almostFiveGiB = (5n * 1024n ** 3n - 256n * 1024n ** 2n).toString();
    await pool.query(
      `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
       VALUES ($1,$2,$3,$4,'synthetic-metadata',$5)`,
      [
        reservationFile,
        reserving.driveId,
        `synthetic/${randomUUID()}`,
        almostFiveGiB,
        reserving.agentId,
      ],
    );
    const size = 200 * 1024 * 1024;
    const results = await Promise.all([
      request(`/drives/${reserving.driveId}/put`, reserving.token, 'POST', {
        path: '/reservation-a.bin',
        ciphertextSize: size,
        wrappedKey: 'opaque',
      }),
      request(`/drives/${secondDriveId}/put`, reserving.token, 'POST', {
        path: '/reservation-b.bin',
        ciphertextSize: size,
        wrappedKey: 'opaque',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 402]);
    const pending = await pool.query(
      'SELECT COALESCE(sum(ciphertext_size),0)::text AS bytes FROM upload_intents WHERE account_id = $1 AND committed_version_id IS NULL',
      [reserving.accountId],
    );
    expect(pending.rows[0].bytes).toBe(String(size));
  });

  it('treats percent and underscore in list prefixes literally', async () => {
    await uploadCommit(writeToken, driveId, '/literal%_marker/file.bin', Buffer.from('literal'));
    await uploadCommit(writeToken, driveId, '/literalXXmarker/other.bin', Buffer.from('wildcard'));
    const result = await json(
      await request(
        `/drives/${driveId}/list?prefix=${encodeURIComponent('/literal%_marker')}`,
        writeToken,
      ),
    );
    expect(result.items.map((item: { path: string }) => item.path)).toEqual([
      '/literal%_marker/file.bin',
    ]);
  });

  it('attributes a derived version to its current agent, machine, and user', async () => {
    await uploadCommit(writeToken, driveId, '/attribution-source.bin', Buffer.from('source'));
    const copied = await request(
      `/drives/${driveId}/copy`,
      copyToken,
      'POST',
      {
        path: '/attribution-source.bin',
        destinationPath: '/attributed-copy.bin',
        userId: 'actor-user',
      },
      { 'x-agent-drive-machine': 'copy-machine' },
    );
    expect(copied.status).toBe(201);
    const versionId = (await json(copied)).version.id as string;
    const version = await pool.query(
      `SELECT v.agent_id,v.machine_id,v.user_id,m.name FROM versions v
       JOIN machines m ON m.id = v.machine_id WHERE v.id = $1`,
      [versionId],
    );
    expect(version.rows[0]).toMatchObject({
      agent_id: copyAgentId,
      user_id: 'actor-user',
      name: 'copy-machine',
    });
    const recent = (await json(
      await request(`/drives/${driveId}/recent?limit=100`, copyToken),
    )) as { items: RecentFileEvent[] };
    expect(
      recent.items.find(
        (event) => event.operation === 'copy' && event.path === '/attributed-copy.bin',
      ),
    ).toMatchObject({
      versionId,
      agentId: copyAgentId,
      machineId: expect.any(String),
      userId: 'actor-user',
    });
  });

  it('uses an ETag precondition when copying a staged upload', async () => {
    const intentResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/etag-precondition.bin',
      ciphertextSize: 5,
      wrappedKey: 'opaque',
    });
    const intent = await json(intentResponse);
    await fetch(intent.uploadUrl, { method: 'PUT', body: Buffer.from('bytes') });
    const staged = await pool.query('SELECT staging_key FROM upload_intents WHERE id = $1', [
      intent.intentId,
    ]);
    const sourceKey = staged.rows[0].staging_key as string;
    const info = await objectInfo(sourceKey);
    await expect(
      copyObject(sourceKey, `test-etag/${randomUUID()}`, '"deliberately-wrong"'),
    ).rejects.toThrow();
    expect(info.etag).toEqual(expect.any(String));
  });

  it('allows only one conditional writer from the same base version', async () => {
    const initial = await uploadCommit(writeToken, driveId, '/concurrent.bin', Buffer.from('base'));
    const baseVersionId = initial.body.version.id as string;
    const prepare = async (bytes: string) => {
      const intentResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
        path: '/concurrent.bin',
        ciphertextSize: Buffer.byteLength(bytes),
        wrappedKey: 'opaque',
        ifVersionId: baseVersionId,
      });
      const intent = await json(intentResponse);
      const upload = await fetch(intent.uploadUrl, { method: 'PUT', body: Buffer.from(bytes) });
      expect(upload.ok).toBe(true);
      return intent.intentId as string;
    };
    const [firstIntent, secondIntent] = await Promise.all([
      prepare('writer-a'),
      prepare('writer-b'),
    ]);
    const commits = await Promise.all(
      [firstIntent, secondIntent].map((intentId) =>
        request(`/drives/${driveId}/commit`, writeToken, 'POST', { intentId }),
      ),
    );
    expect(commits.map((item) => item.status).sort()).toEqual([201, 409]);
  });

  it('rejects an upload intent that would exceed an explicit drive quota', async () => {
    const intent = await request(`/drives/${quotaDriveId}/put`, writeToken, 'POST', {
      path: '/too-large.bin',
      ciphertextSize: 5,
      wrappedKey: 'opaque',
    });
    expect(intent.status).toBe(413);
    expect((await json(intent)).error.code).toBe('quota_exceeded');
  });

  it('enforces scopes, tenants, revocation, validation, management and immutable staging', async () => {
    expect(
      (
        await request(`/drives/${driveId}/put`, readToken, 'POST', {
          path: '/nope',
          ciphertextSize: 1,
          wrappedKey: 'x',
        })
      ).status,
    ).toBe(403);
    expect((await request(`/drives/${otherDriveId}/get?path=%2Fnope`, writeToken)).status).toBe(
      403,
    );
    for (const [operation, body] of [
      ['put', { path: '/denied', ciphertextSize: 1, wrappedKey: 'x' }],
      ['copy', { path: '/nope', destinationPath: '/copy' }],
      ['restore', { path: '/nope' }],
    ] as const) {
      expect(
        (await request(`/drives/${otherDriveId}/${operation}`, writeToken, 'POST', body)).status,
      ).toBe(403);
    }
    expect((await request('/whoami', key())).status).toBe(401);
    expect((await request('/whoami', otherToken)).status).toBe(200);
    const invalid = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/../bad',
      ciphertextSize: 1,
      wrappedKey: 'x',
    });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.code).toBe('validation_error');
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect((await request('/whoami/attacker-text', writeToken)).status).toBe(404);
    expect((await request(`/drives/${driveId}/list/extra`, writeToken)).status).toBe(404);
    expect((await request('/whoami', key(), 'GET')).status).toBe(401);
    expect((await request('/whoami', revokedToken)).status).toBe(401);
    expect((await request('/whoami', writeToken)).status).toBe(200);
  });

  it('rejects query strings larger than the configured maximum', async () => {
    const result = await request(`/whoami?${'x'.repeat(MAX_QUERY_LENGTH + 1)}`, writeToken);
    expect(result.status).toBe(400);
    expect((await json(result)).error.code).toBe('validation_error');
  });

  it('creates and revokes a key through HTTP management routes', async () => {
    const manager = await json(await request('/whoami', manageToken));
    const agent = await request('/agents', manageToken, 'POST', {
      name: `api-agent-${randomUUID()}`,
    });
    expect(agent.status).toBe(200);
    const agentId = (await json(agent)).id as string;
    const agentsPage = await json(await request('/agents?limit=1', manageToken));
    expect(agentsPage.items).toHaveLength(1);
    expect(agentsPage.nextCursor).toEqual(expect.any(String));
    const agentsNext = await json(
      await request(
        `/agents?limit=1&cursor=${encodeURIComponent(agentsPage.nextCursor)}`,
        manageToken,
      ),
    );
    expect(agentsNext.items).toHaveLength(1);
    const drive = await request('/drives', manageToken, 'POST', {
      name: `api-drive-${randomUUID()}`,
    });
    expect(drive.status).toBe(200);
    const driveId = (await json(drive)).id as string;
    const created = await request('/keys', manageToken, 'POST', {
      agentId,
      label: 'api-created',
      driveIds: [driveId, driveId],
      scopes: ['read'],
    });
    expect(created.status).toBe(201);
    const keysPage = await json(await request('/keys?limit=1', manageToken));
    expect(keysPage.items).toHaveLength(1);
    expect(keysPage.nextCursor).toEqual(expect.any(String));
    const key = await json(created);
    expect(key.drive_ids).toEqual([driveId]);
    const storedKey = await pool.query('SELECT account_id FROM api_keys WHERE id = $1', [key.id]);
    expect(storedKey.rows[0].account_id).toBe(manager.accountId);
    const otherAgentGrant = await request('/keys', manageToken, 'POST', {
      agentId: otherAgentId,
      label: 'cross-account-agent',
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(otherAgentGrant.status).toBe(404);
    const otherDriveGrant = await request('/keys', manageToken, 'POST', {
      agentId,
      label: 'cross-account-drive',
      driveIds: [otherDriveId],
      scopes: ['read'],
    });
    expect(otherDriveGrant.status).toBe(404);
    const revoked = await request(`/keys/${key.id}`, manageToken, 'DELETE');
    expect(revoked.status).toBe(200);
    expect((await request('/whoami', key.token)).status).toBe(401);
  });

  it('records drive key backup status without accepting key material', async () => {
    const path = `/drives/${driveId}/key-backup`;
    expect((await request(path, readToken, 'POST', { method: 'file' })).status).toBe(403);
    expect((await request(path, writeToken, 'POST', {})).status).toBe(400);
    expect((await request(path, writeToken, 'POST', { method: 'cloud' })).status).toBe(400);
    const withKey = await request(path, writeToken, 'POST', { method: 'file', driveKey: 'x' });
    expect(withKey.status).toBe(400);
    const emptyName = await request(path, writeToken, 'POST', { method: 'file', '': 'x' });
    expect(emptyName.status).toBe(400);
    const foreign = await request(`/drives/${otherDriveId}/key-backup`, writeToken, 'POST', {
      method: 'file',
    });
    expect(foreign.status).toBe(404);
    const ok = await request(path, writeToken, 'POST', { method: 'env' });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body.keyBackupMethod).toBe('env');
    expect(Date.parse(body.keyBackupAt)).not.toBeNaN();
    const listed = await json(await request('/drives', writeToken));
    const row = listed.items.find((item: { id: string }) => item.id === driveId);
    expect(row.key_backup_method).toBe('env');
    expect(row.key_backup_at).toBe(body.keyBackupAt);
    const events = await pool.query(
      "SELECT outcome FROM audit_events WHERE api_key_id = $1 AND action = 'drive.key_backup'",
      [writeKeyId],
    );
    expect(events.rows.some((event) => event.outcome === 'success')).toBe(true);
  });

  it('records safe success and failure audit events', async () => {
    await request('/whoami', writeToken);
    await request('/whoami/extra', writeToken);
    const events = await pool.query(
      'SELECT action, outcome, error_code, http_status FROM audit_events WHERE api_key_id = $1',
      [writeKeyId],
    );
    expect(events.rows.some((row) => row.outcome === 'success')).toBe(true);
    expect(events.rows.some((row) => row.outcome === 'failure')).toBe(true);
    expect(events.rows.some((row) => row.action === 'unknown')).toBe(true);
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['token', 'wrapped_key', 'signed_url', 'request_body']),
    );
    expect(JSON.stringify(events.rows)).not.toContain(writeToken);
  });

  it('cleans expired staged uploads without deleting committed objects', async () => {
    const committed = await uploadCommit(
      writeToken,
      driveId,
      '/cleanup-retained.bin',
      Buffer.from('retained-ciphertext'),
    );
    const finalObject = await pool.query('SELECT object_key FROM versions WHERE id = $1', [
      committed.body.version.id,
    ]);
    const committedIntent = await pool.query(
      'SELECT staging_key FROM upload_intents WHERE id = $1',
      [committed.intentId],
    );
    expect(finalObject.rows[0].object_key).toMatch(/^objects\//u);

    const stagedResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/cleanup-expired.bin',
      ciphertextSize: 13,
      wrappedKey: 'opaque',
    });
    const stagedIntent = await json(stagedResponse);
    const upload = await fetch(stagedIntent.uploadUrl, {
      method: 'PUT',
      body: Buffer.from('staged-object'),
    });
    expect(upload.ok).toBe(true);
    const abandonedIntent = await pool.query(
      'SELECT staging_key FROM upload_intents WHERE id = $1',
      [stagedIntent.intentId],
    );
    await pool.query(
      "UPDATE upload_intents SET expires_at = now() - interval '61 seconds' WHERE id = $1",
      [committed.intentId],
    );
    await pool.query(
      "UPDATE upload_intents SET expires_at = now() - interval '61 seconds' WHERE id = $1",
      [stagedIntent.intentId],
    );
    const owner = await pool.query('SELECT account_id FROM drives WHERE id = $1', [driveId]);
    const removed = await cleanupExpiredUploads(2, owner.rows[0].account_id as string);
    expect(removed).toBe(2);
    const remaining = await pool.query('SELECT id FROM upload_intents WHERE id = ANY($1::uuid[])', [
      [committed.intentId, stagedIntent.intentId],
    ]);
    expect(remaining.rows).toHaveLength(0);
    await expect(objectInfo(abandonedIntent.rows[0].staging_key)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    expect((await objectInfo(finalObject.rows[0].object_key)).size).toBe(
      Buffer.byteLength('retained-ciphertext'),
    );
    expect(committedIntent.rows[0].staging_key).toMatch(/^staging\//u);
  });

  it('limits data reads at the operation boundary without blocking controls or deletion', async () => {
    const reader = await fixture('phase6-read-budget', 'read-budget-agent', 'read-budget-drive', [
      'read',
      'manage',
      'delete',
    ]);
    const fileId = (
      await pool.query<{ id: string }>(
        'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
        [reader.driveId, '/operation-budget.bin'],
      )
    ).rows[0]!.id;
    const versionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO versions
           (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
         VALUES ($1,$2,$3,1,'opaque-wrapped-key',$4) RETURNING id`,
        [fileId, reader.driveId, `objects/read-budget/${randomUUID()}`, reader.agentId],
      )
    ).rows[0]!.id;
    await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
    await pool.query(
      `INSERT INTO billing_accounts (account_id,plan,spend_cap_cents)
       VALUES ($1,'free',0)
       ON CONFLICT (account_id) DO UPDATE SET plan='free', spend_cap_cents=0`,
      [reader.accountId],
    );

    const freePlan = PLANS.free as unknown as { operations: bigint };
    const originalOperationsLimit = freePlan.operations;
    freePlan.operations = 1n;
    try {
      const allowed = await request(
        `/drives/${reader.driveId}/get?path=%2Foperation-budget.bin`,
        reader.token,
      );
      expect(allowed.status).toBe(200);

      const blocked = await request(
        `/drives/${reader.driveId}/get?path=%2Foperation-budget.bin`,
        reader.token,
      );
      expect(blocked.status).toBe(402);
      expect((await json(blocked)).error).toMatchObject({
        code: 'payment_required',
        upgradeUrl: expect.stringContaining('/console/billing'),
      });

      const managed = await request('/agents', reader.token, 'POST', {
        name: `read-budget-managed-${randomUUID()}`,
      });
      expect(managed.status).toBe(200);
      expect(
        (
          await request(`/drives/${reader.driveId}/delete`, reader.token, 'POST', {
            path: '/operation-budget.bin',
          })
        ).status,
      ).toBe(200);
    } finally {
      freePlan.operations = originalOperationsLimit;
    }
  });

  it('admits only one simultaneous read into the final operation slot', async () => {
    const reader = await operationBudgetFixture('phase6-read-race');
    const freePlan = PLANS.free as unknown as { operations: bigint };
    const originalOperationsLimit = freePlan.operations;
    freePlan.operations = 1n;

    const appPool = getPool();
    const queryDescriptor = Object.getOwnPropertyDescriptor(appPool, 'query');
    const originalQuery = appPool.query;
    let releaseCompletion: () => void = () => {};
    const completionGate = new Promise<void>((resolveGate) => {
      releaseCompletion = resolveGate;
    });
    let completionBlocked = false;
    let blockNextCompletion = true;
    const interceptedQuery = async (...args: unknown[]) => {
      if (
        blockNextCompletion &&
        typeof args[0] === 'string' &&
        args[0].includes('UPDATE audit_events SET outcome = $2')
      ) {
        blockNextCompletion = false;
        completionBlocked = true;
        await completionGate;
      }
      return Reflect.apply(originalQuery, appPool, args);
    };
    appPool.query = interceptedQuery as typeof appPool.query;

    let firstRequest: Promise<Response> | undefined;
    try {
      const first = request(
        `/drives/${reader.driveId}/get?path=${encodeURIComponent(reader.path)}`,
        reader.token,
      );
      firstRequest = first;
      await vi.waitFor(() => expect(completionBlocked).toBe(true));

      const pendingAtBarrier = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_events
          WHERE account_id = $1 AND outcome = 'pending'`,
        [reader.accountId],
      );
      expect(pendingAtBarrier.rows[0]!.count).toBe(1);

      const secondResponse = await request(
        `/drives/${reader.driveId}/get?path=${encodeURIComponent(reader.path)}`,
        reader.token,
      );
      expect(secondResponse.status).toBe(402);
      expect((await json(secondResponse)).error).toMatchObject({
        code: 'payment_required',
        upgradeUrl: expect.stringContaining('/console/billing'),
      });

      releaseCompletion();
      expect((await first).status).toBe(200);
      const remaining = await pool.query<{ outcome: string; count: number }>(
        `SELECT outcome, count(*)::int AS count FROM audit_events
          WHERE account_id = $1 GROUP BY outcome`,
        [reader.accountId],
      );
      expect(remaining.rows).toEqual(
        expect.arrayContaining([
          { outcome: 'success', count: 1 },
          { outcome: 'failure', count: 1 },
        ]),
      );
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_events WHERE account_id = $1 AND outcome = 'pending'",
            [reader.accountId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      releaseCompletion();
      if (firstRequest) await firstRequest.catch(() => undefined);
      if (queryDescriptor) Object.defineProperty(appPool, 'query', queryDescriptor);
      else Reflect.deleteProperty(appPool, 'query');
      freePlan.operations = originalOperationsLimit;
    }
  });

  it('releases a read slot when an admitted data request fails', async () => {
    const reader = await operationBudgetFixture('phase6-read-failure');
    const freePlan = PLANS.free as unknown as { operations: bigint };
    const originalOperationsLimit = freePlan.operations;
    freePlan.operations = 1n;

    try {
      const failed = await request(
        `/drives/${reader.driveId}/get?path=%2Fmissing-file.bin`,
        reader.token,
      );
      expect(failed.status).toBe(404);
      const failure = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_events
          WHERE account_id = $1 AND outcome = 'failure'`,
        [reader.accountId],
      );
      expect(failure.rows[0]!.count).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_events WHERE account_id = $1 AND outcome = 'pending'",
            [reader.accountId],
          )
        ).rows,
      ).toHaveLength(0);

      const admitted = await request(
        `/drives/${reader.driveId}/get?path=${encodeURIComponent(reader.path)}`,
        reader.token,
      );
      expect(admitted.status).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_events WHERE account_id = $1 AND outcome = 'pending'",
            [reader.accountId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      freePlan.operations = originalOperationsLimit;
    }
  });

  it('charges public-share reads against the same operation allowance as authenticated reads', async () => {
    const reader = await operationBudgetFixture('phase6-public-read');
    const shareId = randomUUID().replaceAll('-', '').slice(0, 22);
    await pool.query(
      `INSERT INTO shares
         (id,account_id,drive_id,file_id,version_id,agent_id,api_key_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '1 day')`,
      [
        shareId,
        reader.accountId,
        reader.driveId,
        reader.fileId,
        reader.versionId,
        reader.agentId,
        reader.keyId,
      ],
    );
    const freePlan = PLANS.free as unknown as { operations: bigint };
    const originalOperationsLimit = freePlan.operations;
    freePlan.operations = 1n;

    try {
      const authenticated = await request(
        `/drives/${reader.driveId}/get?path=${encodeURIComponent(reader.path)}`,
        reader.token,
      );
      expect(authenticated.status).toBe(200);

      const publicShare = await handlePublicShareRequest(shareId, true);
      expect(publicShare.status).toBe(402);
      expect((await json(publicShare)).error).toMatchObject({
        code: 'payment_required',
        upgradeUrl: expect.stringContaining('/console/billing'),
      });
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_events WHERE account_id = $1 AND outcome = 'pending'",
            [reader.accountId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      freePlan.operations = originalOperationsLimit;
    }
  });
});

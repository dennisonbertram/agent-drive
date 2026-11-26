import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../db/client';
import { handleApiRequest, handleConsoleApiRequest } from './handler';

const pool = getPool();
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
let accountId = '';
let driveId = '';
let unscopedDriveId = '';
let agentId = '';
let token = '';
let targetKeyToken = '';
let fileId = '';
const shareIds = Array.from({ length: 105 }, () => randomBytes(16).toString('base64url'));
const lateShareId = randomBytes(16).toString('base64url');
const userId = `synthetic-share-counts-${randomUUID()}`;

async function request(path: string) {
  return handleApiRequest(
    new Request(`${root}${path}`, { headers: { authorization: `Bearer ${token}` } }),
  );
}

async function consoleRequest(path: string, method = 'GET') {
  return handleConsoleApiRequest(
    new Request(`http://agent-drive.test/api/console/${path}`, {
      method,
      ...(method === 'GET' ? {} : { headers: { origin: 'http://agent-drive.test' } }),
    }),
    userId,
  );
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  accountId = (
    await pool.query<{ id: string }>(
      'INSERT INTO accounts (name,external_clerk_user_id) VALUES ($1,$2) RETURNING id',
      [`share-counts-${randomUUID()}`, userId],
    )
  ).rows[0]!.id;
  accountIds.push(accountId);
  agentId = (
    await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'counted-agent'],
    )
  ).rows[0]!.id;
  driveId = (
    await pool.query<{ id: string }>(
      'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'counted-drive'],
    )
  ).rows[0]!.id;
  unscopedDriveId = (
    await pool.query<{ id: string }>(
      'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'unscoped-drive'],
    )
  ).rows[0]!.id;
  targetKeyToken = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'integration',$3,$4::uuid[],'{manage,read,share}')`,
    [accountId, agentId, tokenHash(targetKeyToken), [driveId]],
  );
  const managerId = (
    await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'manager-agent'],
    )
  ).rows[0]!.id;
  token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'manager',$3,$4::uuid[],'{manage,read,share}')`,
    [accountId, managerId, tokenHash(token), [driveId]],
  );
  fileId = (
    await pool.query<{ id: string }>(
      'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
      [driveId, '/one.bin'],
    )
  ).rows[0]!.id;
  const versionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,1,'opaque-wrapped-key',$4) RETURNING id`,
      [fileId, driveId, `objects/share-counts/${randomUUID()}`, agentId],
    )
  ).rows[0]!.id;
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  const otherFileId = (
    await pool.query<{ id: string }>(
      'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
      [driveId, '/other.bin'],
    )
  ).rows[0]!.id;
  const otherVersionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,1,'opaque-wrapped-key',$4) RETURNING id`,
      [otherFileId, driveId, `objects/share-counts-other/${randomUUID()}`, agentId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO shares (id,account_id,drive_id,file_id,version_id,agent_id,expires_at)
     SELECT id,$2,$3,$4,$5,$6,now() + interval '1 day'
       FROM unnest($1::text[]) AS id`,
    [shareIds, accountId, driveId, fileId, versionId, agentId],
  );
  // The only active share for this file sits beyond the drive-wide first page.
  await pool.query(
    `INSERT INTO shares (id,account_id,drive_id,file_id,version_id,agent_id,expires_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + interval '1 day',now() + interval '1 second')`,
    [lateShareId, accountId, driveId, fileId, versionId, agentId],
  );
  await pool.query(
    `INSERT INTO shares (id,account_id,drive_id,file_id,version_id,agent_id,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + interval '1 day')`,
    [
      randomBytes(16).toString('base64url'),
      accountId,
      driveId,
      otherFileId,
      otherVersionId,
      agentId,
    ],
  );
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes,revoked_at)
     SELECT $1,$2,'revoked-' || n,md5(random()::text),ARRAY[$3]::uuid[],'{read}',now()
       FROM generate_series(1,3) n`,
    [accountId, agentId, driveId],
  );
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM agents WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('authoritative agent key counts and file-scoped share pages', () => {
  it('returns account-scoped active key counts and paginates shares for one file', async () => {
    const agentsResponse = await request('/agents?limit=100');
    expect(agentsResponse.status).toBe(200);
    const agents = (await agentsResponse.json()) as {
      items: { id: string; active_key_count?: number; total_key_count?: number }[];
    };
    expect(agents.items.find((agent) => agent.id === agentId)?.active_key_count).toBe(1);
    expect(agents.items.find((agent) => agent.id === agentId)?.total_key_count).toBe(4);

    const unscoped = await request(
      `/drives/${unscopedDriveId}/shares?path=${encodeURIComponent('/one.bin')}&countOnly=1`,
    );
    expect(unscoped.status).toBe(403);

    const allShares = await request(`/drives/${driveId}/shares?limit=1`);
    expect(allShares.status).toBe(200);
    expect((await allShares.json()).nextCursor).toEqual(expect.any(String));

    const first = await request(
      `/drives/${driveId}/shares?path=${encodeURIComponent('/one.bin')}&limit=100`,
    );
    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      items: { path: string }[];
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(100);
    expect(page.items.every((item) => item.path === '/one.bin')).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));

    const late = await request(
      `/drives/${driveId}/shares?path=${encodeURIComponent('/one.bin')}&limit=100&cursor=${encodeURIComponent(page.nextCursor!)}`,
    );
    const lateBody = await late.json();
    expect(late.status, JSON.stringify(lateBody)).toBe(200);
    expect(lateBody.items).toHaveLength(6);

    const count = await request(
      `/drives/${driveId}/shares?path=${encodeURIComponent('/one.bin')}&countOnly=1`,
    );
    expect(await count.json()).toEqual({ count: 106 });

    const revoked = await consoleRequest(`agents/${agentId}/revoke`, 'POST');
    const revokedBody = await revoked.json();
    expect(revoked.status, JSON.stringify(revokedBody)).toBe(200);
    expect(revokedBody).toMatchObject({ id: agentId, revokedKeys: 1 });
    const afterRevoke = (await (await request('/agents?limit=100')).json()) as {
      items: { id: string; active_key_count: number; total_key_count: number }[];
    };
    expect(afterRevoke.items.find((agent) => agent.id === agentId)).toMatchObject({
      active_key_count: 0,
      total_key_count: 4,
    });
  });
});

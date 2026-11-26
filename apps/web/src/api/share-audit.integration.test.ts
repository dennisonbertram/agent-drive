import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handlePublicShareRequest } from './handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const accountIds: string[] = [];

function shareId() {
  return randomUUID().replaceAll('-', '_').slice(0, 22);
}

async function addShare(
  accountId: string,
  driveId: string,
  fileId: string,
  versionId: string,
  agentId: string,
) {
  const id = shareId();
  await pool.query(
    `INSERT INTO shares (id, account_id, drive_id, file_id, version_id, agent_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')`,
    [id, accountId, driveId, fileId, versionId, agentId],
  );
  return id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('public share audit volume', () => {
  it('keeps invalid share bursts out of audit_events and audits an active access', async () => {
    const account = await pool.query<{ id: string }>(
      'INSERT INTO accounts (name) VALUES ($1) RETURNING id',
      [`share-audit-${randomUUID()}`],
    );
    const accountId = account.rows[0]!.id;
    accountIds.push(accountId);
    const agent = await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id, name) VALUES ($1, $2) RETURNING id',
      [accountId, 'synthetic-share-audit'],
    );
    const agentId = agent.rows[0]!.id;
    const drive = await pool.query<{ id: string }>(
      'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
      [accountId, 'synthetic-share-audit'],
    );
    const driveId = drive.rows[0]!.id;
    const file = await pool.query<{ id: string }>(
      'INSERT INTO files (drive_id, path) VALUES ($1, $2) RETURNING id',
      [driveId, '/synthetic.txt'],
    );
    const fileId = file.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
       VALUES ($1, $2, $3, 1, 'synthetic', $4) RETURNING id`,
      [fileId, driveId, `synthetic/${randomUUID()}`, agentId],
    );
    const versionId = version.rows[0]!.id;
    await pool.query('UPDATE files SET current_version_id = $2 WHERE id = $1', [fileId, versionId]);

    const activeShareId = await addShare(accountId, driveId, fileId, versionId, agentId);
    const revokedShareId = await addShare(accountId, driveId, fileId, versionId, agentId);
    await pool.query('UPDATE shares SET revoked_at = now() WHERE id = $1', [revokedShareId]);
    const expiredShareId = await addShare(accountId, driveId, fileId, versionId, agentId);
    await pool.query(
      `UPDATE shares SET created_at = now() - interval '2 seconds', expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [expiredShareId],
    );
    const unavailableShareId = await addShare(accountId, driveId, fileId, versionId, agentId);

    const active = await handlePublicShareRequest(activeShareId, true);
    expect(active.status).toBe(200);
    const validAudit = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
        WHERE account_id = $1 AND action = 'share.access' AND outcome = 'success'`,
      [accountId],
    );
    expect(validAudit.rows[0]!.count).toBe(1);
    await pool.query('UPDATE files SET deleted_at = now() WHERE id = $1', [fileId]);

    const invalidIds = [
      'malformed-synthetic-id',
      shareId(),
      revokedShareId,
      expiredShareId,
      unavailableShareId,
    ];
    const before = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events WHERE action = 'share.access'`,
    );
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        handlePublicShareRequest(invalidIds[index % invalidIds.length]!),
      ),
    );
    expect(responses).toHaveLength(100);
    expect(
      responses.every(
        (response, index) => response.status === (index % invalidIds.length < 2 ? 404 : 410),
      ),
    ).toBe(true);
    const after = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events WHERE action = 'share.access'`,
    );
    expect(after.rows[0]!.count - before.rows[0]!.count).toBe(0);
  });
});

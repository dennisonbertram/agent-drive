import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockBillingAccount } from '../billing/ledger';
import { commitPut, putConflict } from './versions';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const accountIds: string[] = [];

async function fixture(quotaBytes = 1_000_000) {
  const account = await pool.query<{ id: string }>(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id',
    [`versions-${randomUUID()}`],
  );
  const accountId = account.rows[0]!.id;
  accountIds.push(accountId);
  const agent = await pool.query<{ id: string }>(
    "INSERT INTO agents (account_id, name) VALUES ($1, 'writer') RETURNING id",
    [accountId],
  );
  const drive = await pool.query<{ id: string }>(
    'INSERT INTO drives (account_id, name, quota_bytes) VALUES ($1, $2, $3) RETURNING id',
    [accountId, `drive-${randomUUID()}`, quotaBytes],
  );
  return { accountId, agentId: agent.rows[0]!.id, driveId: drive.rows[0]!.id };
}

type Mode = Parameters<typeof putConflict>[3];

// Holds the locks the caller of commitPut is required to hold.
async function locked<T>(
  f: { accountId: string; driveId: string },
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockBillingAccount(client, f.accountId);
    await client.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [f.driveId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function put(
  client: PoolClient,
  f: { accountId: string; driveId: string; agentId: string },
  path: string,
  mode: Mode,
  size = 10,
) {
  const versionId = randomUUID();
  return commitPut(client, {
    accountId: f.accountId,
    driveId: f.driveId,
    path,
    objectKey: `objects/${f.accountId}/${f.driveId}/${versionId}`,
    ciphertextSize: size,
    wrappedKey: 'opaque-wrapped-key',
    agentId: f.agentId,
    machineId: null,
    userId: 'user-1',
    tags: ['trace'],
    description: 'd',
    mode,
  });
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))',
      [accountIds],
    );
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('commitPut', () => {
  it('creates the file, version and put event on a fresh path', async () => {
    const f = await fixture();
    const row = await locked(f, (c) => put(c, f, '/a.bin', 'create'));
    expect(row.path).toBe('/a.bin');
    expect(Number(row.ciphertext_size)).toBe(10);
    expect(row.tags).toEqual(['trace']);
    const file = await pool.query(
      'SELECT current_version_id, deleted_at FROM files WHERE drive_id = $1 AND path = $2',
      [f.driveId, '/a.bin'],
    );
    expect(file.rows[0].current_version_id).toBe(row.id);
    const events = await pool.query(
      'SELECT operation, version_id, agent_id, user_id FROM file_events WHERE drive_id = $1',
      [f.driveId],
    );
    expect(events.rows).toEqual([
      { operation: 'put', version_id: row.id, agent_id: f.agentId, user_id: 'user-1' },
    ]);
  });

  it('writes a second version unconditionally and with a matching base version', async () => {
    const f = await fixture();
    const first = await locked(f, (c) => put(c, f, '/a.bin', 'unconditional'));
    const second = await locked(f, (c) => put(c, f, '/a.bin', { baseVersionId: first.id }));
    expect(second.id).not.toBe(first.id);
    const file = await pool.query('SELECT current_version_id FROM files WHERE drive_id = $1', [
      f.driveId,
    ]);
    expect(file.rows[0].current_version_id).toBe(second.id);
  });

  it('rejects create on an existing path with state exists', async () => {
    const f = await fixture();
    const first = await locked(f, (c) => put(c, f, '/a.bin', 'create'));
    await expect(locked(f, (c) => put(c, f, '/a.bin', 'create'))).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      details: { state: 'exists', currentVersionId: first.id },
    });
  });

  it('rejects a stale base version with state changed, and a missing file with absent', async () => {
    const f = await fixture();
    const first = await locked(f, (c) => put(c, f, '/a.bin', 'create'));
    await locked(f, (c) => put(c, f, '/a.bin', 'unconditional'));
    await expect(
      locked(f, (c) => put(c, f, '/a.bin', { baseVersionId: first.id })),
    ).rejects.toMatchObject({ details: { state: 'changed' } });
    await expect(
      locked(f, (c) => put(c, f, '/missing.bin', { baseVersionId: first.id })),
    ).rejects.toMatchObject({ details: { state: 'absent', currentVersionId: null } });
  });

  it('rejects create and base-version writes on a trashed file with state trashed', async () => {
    const f = await fixture();
    const first = await locked(f, (c) => put(c, f, '/a.bin', 'create'));
    await pool.query('UPDATE files SET deleted_at = now() WHERE drive_id = $1', [f.driveId]);
    await expect(locked(f, (c) => put(c, f, '/a.bin', 'create'))).rejects.toMatchObject({
      details: { state: 'trashed', currentVersionId: first.id },
    });
    await expect(
      locked(f, (c) => put(c, f, '/a.bin', { baseVersionId: first.id })),
    ).rejects.toMatchObject({ details: { state: 'trashed' } });
  });

  it('rejects a write over the drive quota with quota_exceeded', async () => {
    const f = await fixture(15);
    await locked(f, (c) => put(c, f, '/a.bin', 'create', 10));
    await expect(locked(f, (c) => put(c, f, '/b.bin', 'create', 10))).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });
});

describe('putConflict', () => {
  it('reports the same states as commitPut without writing', async () => {
    const f = await fixture();
    const versionCount = async () =>
      (await pool.query('SELECT count(*)::int AS n FROM versions WHERE drive_id=$1', [f.driveId]))
        .rows[0].n as number;
    await locked(f, (c) => putConflict(c, f.driveId, '/a.bin', 'create'));
    await locked(f, (c) => putConflict(c, f.driveId, '/a.bin', 'unconditional'));
    await expect(
      locked(f, (c) => putConflict(c, f.driveId, '/a.bin', { baseVersionId: randomUUID() })),
    ).rejects.toMatchObject({ details: { state: 'absent' } });
    expect(await versionCount()).toBe(0);
    const first = await locked(f, (c) => put(c, f, '/a.bin', 'create'));
    await expect(
      locked(f, (c) => putConflict(c, f.driveId, '/a.bin', 'create')),
    ).rejects.toMatchObject({ details: { state: 'exists', currentVersionId: first.id } });
    await expect(
      locked(f, (c) => putConflict(c, f.driveId, '/a.bin', { baseVersionId: randomUUID() })),
    ).rejects.toMatchObject({ details: { state: 'changed' } });
    await pool.query('UPDATE files SET deleted_at = now() WHERE drive_id = $1', [f.driveId]);
    await expect(
      locked(f, (c) => putConflict(c, f.driveId, '/a.bin', 'create')),
    ).rejects.toMatchObject({ details: { state: 'trashed' } });
    expect(await versionCount()).toBe(1);
  });
});

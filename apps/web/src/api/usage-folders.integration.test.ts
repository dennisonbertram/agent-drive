import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleConsoleApiRequest } from './handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const root = 'http://agent-drive.test';
const accountIds: string[] = [];
const userIds: string[] = [];

async function call(userId: string, path: string) {
  return handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, {
      method: 'GET',
      headers: { origin: root },
    }),
    userId,
    true,
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function fixture(driveName = 'folders-drive') {
  const userId = `user_${randomUUID()}`;
  const account = await pool.query(
    'INSERT INTO accounts (name, external_clerk_user_id) VALUES ($1, $2) RETURNING id',
    [`folders-${randomUUID()}`, userId],
  );
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  userIds.push(userId);
  await pool.query("INSERT INTO agents (account_id, name) VALUES ($1, '__console__')", [accountId]);
  const agent = await pool.query(
    'INSERT INTO agents (account_id, name) VALUES ($1, $2) RETURNING id',
    [accountId, `agent-${randomUUID()}`],
  );
  const drive = await pool.query(
    'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
    [accountId, `${driveName}-${randomUUID()}`],
  );
  return {
    userId,
    accountId,
    agentId: agent.rows[0].id as string,
    driveId: drive.rows[0].id as string,
  };
}

async function addFile(
  target: { driveId: string; agentId: string },
  path: string,
  sizes: number[],
  deleted = false,
) {
  const file = await pool.query('INSERT INTO files (drive_id, path) VALUES ($1, $2) RETURNING id', [
    target.driveId,
    path,
  ]);
  const fileId = file.rows[0].id as string;
  for (const [index, size] of sizes.entries()) {
    const version = await pool.query(
      `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
       VALUES ($1, $2, $3, $4, 'wrapped', $5) RETURNING id`,
      [fileId, target.driveId, `objects/${randomUUID()}`, size, target.agentId],
    );
    if (index === sizes.length - 1)
      await pool.query('UPDATE files SET current_version_id = $2 WHERE id = $1', [
        fileId,
        version.rows[0].id,
      ]);
  }
  if (deleted) await pool.query('UPDATE files SET deleted_at = now() WHERE id = $1', [fileId]);
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM billing_accounts WHERE account_id = ANY($1::uuid[])', [
      accountIds,
    ]);
    await pool.query(
      `DELETE FROM versions WHERE drive_id IN
         (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))`,
      [accountIds],
    );
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  if (userIds.length)
    await pool.query(
      "DELETE FROM console_user_tombstones WHERE external_user_hash = ANY(SELECT encode(sha256(convert_to(u, 'UTF8')), 'hex') FROM unnest($1::text[]) u)",
      [userIds],
    );
  await pool.end();
});

describe('console usage folders', () => {
  it('groups every stored version by the segment below the prefix, Trash included', async () => {
    const f = await fixture();
    await addFile(f, '/a/x', [10]);
    await addFile(f, '/a/b/y', [8, 12]); // two versions count toward bytes, once toward files
    await addFile(f, '/c', [5]);
    await addFile(f, '/trashed', [8], true);
    await addFile(f, '/z/g', [1]);

    const res = await call(
      f.userId,
      `usage/folders?drive=${f.driveId}&prefix=${encodeURIComponent('/')}`,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.prefix).toBe('/');
    expect(body.totalBytes).toBe(44);
    expect(body.directBytes).toBe(13);
    expect(body.directFiles).toBe(2);
    expect(body.folders).toEqual([
      { name: 'a', path: '/a', bytes: 30, files: 2 },
      { name: 'z', path: '/z', bytes: 1, files: 1 },
    ]);

    const nested = await call(
      f.userId,
      `usage/folders?drive=${f.driveId}&prefix=${encodeURIComponent('/a')}`,
    );
    expect(nested.status).toBe(200);
    const inner = await json(nested);
    expect(inner.prefix).toBe('/a');
    expect(inner.totalBytes).toBe(30);
    expect(inner.folders).toEqual([{ name: 'b', path: '/a/b', bytes: 20, files: 1 }]);
    expect(inner.directBytes).toBe(10);
    expect(inner.directFiles).toBe(1);
  });

  it('returns 404 not_found for a drive the account does not own', async () => {
    const owner = await fixture('owner-drive');
    const stranger = await fixture('stranger-drive');
    const res = await call(
      stranger.userId,
      `usage/folders?drive=${owner.driveId}&prefix=${encodeURIComponent('/')}`,
    );
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('not_found');
  });

  it('matches LIKE wildcards in the prefix literally', async () => {
    const f = await fixture();
    await addFile(f, '/w%/f', [3]);
    await addFile(f, '/wX/f', [99]);

    const res = await call(
      f.userId,
      `usage/folders?drive=${f.driveId}&prefix=${encodeURIComponent('/w%')}`,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.totalBytes).toBe(3);
    expect(body.folders).toEqual([]);
    expect(body.directBytes).toBe(3);
    expect(body.directFiles).toBe(1);
  });

  it('rejects a non-canonical prefix and an empty drive parameter', async () => {
    const f = await fixture();
    for (const bad of ['a', '/a//b', '/a/../b', '/a/']) {
      const res = await call(
        f.userId,
        `usage/folders?drive=${f.driveId}&prefix=${encodeURIComponent(bad)}`,
      );
      expect(res.status, bad).toBe(400);
      expect((await json(res)).error.code).toBe('validation_error');
    }
    const noDrive = await call(f.userId, `usage/folders?prefix=${encodeURIComponent('/')}`);
    expect(noDrive.status).toBe(400);
    expect((await json(noDrive)).error.code).toBe('validation_error');
  });

  it('reports an empty folder', async () => {
    const f = await fixture();
    await addFile(f, '/a/x', [10]);
    const res = await call(
      f.userId,
      `usage/folders?drive=${f.driveId}&prefix=${encodeURIComponent('/b')}`,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.totalBytes).toBe(0);
    expect(body.folders).toEqual([]);
    expect(body.directBytes).toBe(0);
    expect(body.directFiles).toBe(0);
  });

  it('rejects an empty prefix but treats an omitted prefix as /', async () => {
    const f = await fixture();
    await addFile(f, '/a/x', [10]);

    const empty = await call(f.userId, `usage/folders?drive=${f.driveId}&prefix=`);
    expect(empty.status).toBe(400);
    expect((await json(empty)).error.code).toBe('validation_error');

    const omitted = await call(f.userId, `usage/folders?drive=${f.driveId}`);
    expect(omitted.status).toBe(200);
    const body = await json(omitted);
    expect(body.prefix).toBe('/');
    expect(body.totalBytes).toBe(10);
  });

  it('aggregates every file stored directly at the prefix into one bucket', async () => {
    const f = await fixture();
    // A flat folder must collapse to a single direct bucket, not one row per file.
    for (let index = 0; index < 40; index += 1) await addFile(f, `/f${index}`, [index + 1]);
    await addFile(f, '/sub/x', [5]);

    const res = await call(f.userId, `usage/folders?drive=${f.driveId}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.folders).toEqual([{ name: 'sub', path: '/sub', bytes: 5, files: 1 }]);
    expect(body.directFiles).toBe(40);
    expect(body.directBytes).toBe((40 * 41) / 2);
    expect(body.totalBytes).toBe((40 * 41) / 2 + 5);
  });

  it('caps the folder list at 200 largest and aggregates the rest into moreFolders', async () => {
    const f = await fixture();
    // Sizes rank the folders: d004..d204 (sizes 5..205) fit, d000..d003 spill into moreFolders.
    for (let index = 0; index < 205; index += 1)
      await addFile(f, `/d${String(index).padStart(3, '0')}/x`, [index + 1]);
    await addFile(f, '/loose', [7]);

    const res = await call(f.userId, `usage/folders?drive=${f.driveId}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.folders).toHaveLength(200);
    expect(body.folders[0]).toEqual({ name: 'd204', path: '/d204', bytes: 205, files: 1 });
    const names = (body.folders as { name: string }[]).map((row) => row.name);
    expect(names).not.toContain('d004');
    expect(body.moreFolders).toEqual({ count: 5, bytes: 1 + 2 + 3 + 4 + 5 });
    expect(body.directFiles).toBe(1);
    expect(body.directBytes).toBe(7);
    expect(body.totalBytes).toBe((205 * 206) / 2 + 7);
  });

  it('keeps a drive pending deletion in the account total and marks it deleting', async () => {
    const f = await fixture();
    await addFile(f, '/a/x', [10]);
    const gone = await pool.query(
      'INSERT INTO drives (account_id, name, deleting_at) VALUES ($1, $2, now()) RETURNING id',
      [f.accountId, `gone-${randomUUID()}`],
    );
    const goneId = gone.rows[0].id as string;
    await addFile({ driveId: goneId, agentId: f.agentId }, '/b/y', [20]);

    const res = await call(f.userId, 'usage');
    expect(res.status).toBe(200);
    const body = await json(res);
    const rows = body.drives as { id: string; deleting: boolean; storageBytes: number }[];
    expect(rows.find((row) => row.id === goneId)).toMatchObject({
      deleting: true,
      storageBytes: 20,
    });
    expect(rows.find((row) => row.id === f.driveId)).toMatchObject({ deleting: false });
    expect(body.storageBytes).toBe(30);

    const folders = await call(f.userId, `usage/folders?drive=${goneId}`);
    expect(folders.status).toBe(404);
  });
});

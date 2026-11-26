import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPool } from '../db/client';
import { handleConsoleApiRequest } from './handler';

const pool = getPool();
const db = drizzle(pool);
const accountIds: string[] = [];
const userId = `synthetic-browse-${randomUUID()}`;
let ownedDriveId = '';
let foreignDriveId = '';

function request(path: string) {
  return handleConsoleApiRequest(
    new Request(`http://agent-drive.test/api/console/${path}`),
    userId,
  );
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const account = await pool.query<{ id: string }>(
    'INSERT INTO accounts (name, external_clerk_user_id) VALUES ($1, $2) RETURNING id',
    ['Synthetic browse account', userId],
  );
  const accountId = account.rows[0]!.id;
  accountIds.push(accountId);
  await pool.query('INSERT INTO agents (account_id, name) VALUES ($1, $2) RETURNING id', [
    accountId,
    '__console__',
  ]);
  const drives = await pool.query<{ id: string; name: string }>(
    `INSERT INTO drives (account_id, name)
     SELECT $1, 'synthetic-browse-' || lpad(n::text, 5, '0')
       FROM generate_series(1, 2500) n
     RETURNING id, name`,
    [accountId],
  );
  ownedDriveId = drives.rows[0]!.id;
  const foreignAccount = await pool.query<{ id: string }>(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id',
    [`Synthetic foreign ${randomUUID()}`],
  );
  accountIds.push(foreignAccount.rows[0]!.id);
  const foreignDrive = await pool.query<{ id: string }>(
    'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
    [foreignAccount.rows[0]!.id, 'synthetic-foreign'],
  );
  foreignDriveId = foreignDrive.rows[0]!.id;
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

afterEach(() => vi.restoreAllMocks());

describe('console browse authentication', () => {
  it('bounds account and drive browse auth while preserving owner checks', async () => {
    const spy = vi.spyOn(pool, 'query');
    const session = await request('session');
    expect(session.status).toBe(200);
    const drives = await request('drives?limit=5');
    expect(drives.status).toBe(200);
    expect((await drives.json()).items).toHaveLength(5);

    const browseAuthQueries = spy.mock.calls
      .map(([query]) => (typeof query === 'string' ? query : query.text))
      .filter(
        (query) => query.includes('FROM accounts a') && query.includes("g.name = '__console__'"),
      );
    expect(browseAuthQueries).toHaveLength(2);
    expect(browseAuthQueries.every((query) => !query.includes('ARRAY(SELECT d.id'))).toBe(true);

    const ownerList = await request(`drives/${ownedDriveId}/list`);
    expect(ownerList.status).toBe(200);
    const foreignList = await request(`drives/${foreignDriveId}/list`);
    expect(foreignList.status).toBe(403);
    expect((await foreignList.json()).error.code).toBe('permission_denied');

    const scopedAuthQuery = spy.mock.calls
      .map(([query]) => (typeof query === 'string' ? query : query.text))
      .filter(
        (query) => query.includes('FROM accounts a') && query.includes("g.name = '__console__'"),
      )
      .at(-1);
    expect(scopedAuthQuery).toContain('d.id = $3::uuid');
  });
});

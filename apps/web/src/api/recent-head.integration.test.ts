import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest } from './handler';
import { encodeCursor } from './validation';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
let driveId = '';
let agentId = '';
let readToken = '';
let emptyDriveId = '';
let emptyToken = '';
let writeOnlyToken = '';
let foreignToken = '';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function request(path: string, token?: string) {
  return handleApiRequest(
    new Request(`${root}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

// The integration fixture intentionally inspects JSON responses without modeling every route payload.
async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as Record<string, any>;
}

async function fixture(label: string, scopes: string[], driveIds?: string[]) {
  const accountId = (
    await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `${label}-${randomUUID()}`,
    ])
  ).rows[0].id as string;
  accountIds.push(accountId);
  const agentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      accountId,
      `${label}-agent`,
    ])
  ).rows[0].id as string;
  const drive = await pool.query(
    'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `${label}-drive`],
  );
  const id = drive.rows[0].id as string;
  const token = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[])`,
    [accountId, agentId, 'recent-head', tokenHash(token), driveIds ?? [id], scopes],
  );
  return { accountId, agentId, driveId: id, token };
}

async function fileEvent(drive: string, agent: string, path: string) {
  const fileId = (
    await pool.query('INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id', [drive, path])
  ).rows[0].id as string;
  return (
    await pool.query<{ id: string; seq: string }>(
      `INSERT INTO file_events (drive_id, file_id, operation, path, agent_id)
       VALUES ($1, $2, 'put', $3, $4) RETURNING id, seq::text AS seq`,
      [drive, fileId, path, agent],
    )
  ).rows[0]!;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const main = await fixture('recent-head-main', ['read', 'write', 'delete']);
  driveId = main.driveId;
  agentId = main.agentId;
  readToken = main.token;
  const empty = await fixture('recent-head-empty', ['read']);
  emptyDriveId = empty.driveId;
  emptyToken = empty.token;
  const writeOnly = await fixture('recent-head-write-only', ['write'], [driveId]);
  writeOnlyToken = writeOnly.token;
  // A read key in another account that is not scoped to the main drive.
  const foreign = await fixture('recent-head-foreign', ['read']);
  foreignToken = foreign.token;
  for (const name of ['a', 'b', 'c'])
    await fileEvent(driveId, agentId, `/head-fixture/${name}.bin`);
});

afterAll(async () => {
  for (const id of accountIds) {
    await pool.query('DELETE FROM audit_events WHERE account_id = $1', [id]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }
  await pool.end();
});

describe('recent head cursor', () => {
  it('returns an empty page with latestCursor null for a drive without events', async () => {
    const head = await json(
      await request(`/drives/${emptyDriveId}/recent?head=1&limit=1`, emptyToken),
    );
    expect(head).toEqual({ items: [], nextCursor: null, latestCursor: null });
  });

  it('returns the newest committed event cursor and resumes with only newer events', async () => {
    const tail = (
      await pool.query(
        'SELECT id, seq::text AS seq FROM file_events WHERE drive_id = $1 ORDER BY seq DESC LIMIT 1',
        [driveId],
      )
    ).rows[0] as { id: string; seq: string };
    const head = await json(await request(`/drives/${driveId}/recent?head=1&limit=1`, readToken));
    expect(head.items).toEqual([]);
    expect(head.nextCursor).toBeNull();
    const decoded = JSON.parse(
      Buffer.from(head.latestCursor, 'base64url').toString('utf8'),
    ) as unknown;
    expect(decoded).toEqual({ value: tail.seq, id: tail.id });
    const cursor = encodeURIComponent(head.latestCursor as string);
    const nothingNew = await json(
      await request(`/drives/${driveId}/recent?cursor=${cursor}`, readToken),
    );
    expect(nothingNew).toEqual({ items: [], nextCursor: null, latestCursor: head.latestCursor });
    const added = await fileEvent(driveId, agentId, `/head-fixture/${randomUUID()}.bin`);
    const next = await json(await request(`/drives/${driveId}/recent?cursor=${cursor}`, readToken));
    expect(next.items.map((event: { id: string }) => event.id)).toEqual([added.id]);
    expect(next.nextCursor).toBeNull();
  });

  it('requires read access to the drive, same as a paged recent', async () => {
    expect((await request(`/drives/${driveId}/recent?head=1&limit=1`)).status).toBe(401);
    expect((await request(`/drives/${driveId}/recent?head=1&limit=1`, writeOnlyToken)).status).toBe(
      403,
    );
    expect((await request(`/drives/${driveId}/recent?head=1&limit=1`, foreignToken)).status).toBe(
      403,
    );
    expect(
      (await request(`/drives/${emptyDriveId}/recent?head=1&limit=1`, emptyToken)).status,
    ).toBe(200);
  });

  it('rejects invalid or ambiguous head parameters', async () => {
    const cursor = encodeURIComponent(
      encodeCursor({ value: '1', id: '00000000-0000-4000-8000-000000000001' }),
    );
    for (const query of [
      'head=0',
      'head=yes',
      'head',
      `head=1&cursor=${cursor}`,
      'head=1&since=2020-01-01T00:00:00.000Z',
      'head=1&limit=2',
      'head=1&limit=abc',
    ]) {
      expect((await request(`/drives/${driveId}/recent?${query}`, readToken)).status).toBe(400);
    }
    for (const query of ['head=1', 'head=1&limit=1']) {
      expect((await request(`/drives/${driveId}/recent?${query}`, readToken)).status).toBe(200);
    }
  });

  it('leaves plain recent pagination unchanged', async () => {
    const page = await json(await request(`/drives/${driveId}/recent?limit=1`, readToken));
    expect(page.items).toHaveLength(1);
    expect(page.items[0].path).toBe('/head-fixture/a.bin');
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.latestCursor).toEqual(page.nextCursor);
  });
});

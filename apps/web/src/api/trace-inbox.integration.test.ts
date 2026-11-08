import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest, handleConsoleApiRequest } from './handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const root = 'http://agent-drive.test';
const accountIds: string[] = [];
const userIds: string[] = [];

const b64 = (bytes: Buffer) => bytes.toString('base64url');
const point = () => b64(Buffer.concat([Buffer.from([4]), randomBytes(64)]));
const wrapped = () => b64(Buffer.concat([Buffer.from([1]), randomBytes(12 + 16 + 48)]));
const inboxBody = () => ({ keyId: randomUUID(), publicKey: point(), wrappedPrivateKey: wrapped() });
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response) => (await response.json()) as Record<string, any>;

function init(method: string, body: unknown, headers: Record<string, string>) {
  return {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const consoleCall = (userId: string, path: string, method = 'GET', body?: unknown) =>
  handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, init(method, body, { origin: root })),
    userId,
  );
const bearerCall = (token: string, path: string, method = 'GET', body?: unknown) =>
  handleApiRequest(
    new Request(`${root}/api/v1/${path}`, init(method, body, { authorization: `Bearer ${token}` })),
  );

async function fixture() {
  const userId = `user_${randomUUID()}`;
  const account = await pool.query(
    'INSERT INTO accounts (name, external_clerk_user_id) VALUES ($1, $2) RETURNING id',
    [`trace-${randomUUID()}`, userId],
  );
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  userIds.push(userId);
  await pool.query("INSERT INTO agents (account_id, name) VALUES ($1, '__console__')", [accountId]);
  const agent = await pool.query(
    "INSERT INTO agents (account_id, name) VALUES ($1, 'reader') RETURNING id",
    [accountId],
  );
  const drive = await pool.query(
    'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
    [accountId, `drive-${randomUUID()}`],
  );
  const otherDrive = await pool.query(
    'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
    [accountId, `drive-${randomUUID()}`],
  );
  const driveId = drive.rows[0].id as string;
  const otherDriveId = otherDrive.rows[0].id as string;
  const makeKey = async (scopes: string[], driveIds: string[]) => {
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await pool.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1, $2, 'trace', $3, $4::uuid[], $5::text[])`,
      [accountId, agent.rows[0].id, tokenHash(token), driveIds, scopes],
    );
    return token;
  };
  return { userId, accountId, driveId, otherDriveId, makeKey };
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
    // Drives first so the webhook tokens' RESTRICT on agents never blocks the account delete.
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM billing_accounts WHERE account_id = ANY($1::uuid[])', [
      accountIds,
    ]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  if (userIds.length)
    await pool.query(
      "DELETE FROM console_user_tombstones WHERE external_user_hash = ANY(SELECT encode(sha256(convert_to(u, 'UTF8')), 'hex') FROM unnest($1::text[]) u)",
      [userIds],
    );
  await pool.end();
});

describe('trace inbox', () => {
  it('returns null, creates once, then 409s', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    expect(await json(await consoleCall(f.userId, path))).toEqual({ inbox: null });
    const body = inboxBody();
    const created = await consoleCall(f.userId, path, 'POST', body);
    expect(created.status).toBe(201);
    expect((await json(created)).inbox).toMatchObject({
      keyId: body.keyId,
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
    });
    expect((await consoleCall(f.userId, path, 'POST', inboxBody())).status).toBe(409);
    expect((await json(await consoleCall(f.userId, path))).inbox.keyId).toBe(body.keyId);
  });

  it('validates the body', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    expect((await consoleCall(f.userId, path, 'POST', { ...inboxBody(), extra: 1 })).status).toBe(
      400,
    );
    expect(
      (await consoleCall(f.userId, path, 'POST', { ...inboxBody(), publicKey: 'short' })).status,
    ).toBe(400);
    expect(
      (await consoleCall(f.userId, path, 'POST', { ...inboxBody(), keyId: 'nope' })).status,
    ).toBe(400);
  });

  it('serves bearer reads with the read scope, charges one operation, and rejects other keys', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    const body = inboxBody();
    expect((await consoleCall(f.userId, path, 'POST', body)).status).toBe(201);
    const reader = await f.makeKey(['read'], [f.driveId]);
    const response = await bearerCall(reader, path);
    expect(response.status).toBe(200);
    expect((await json(response)).inbox.keyId).toBe(body.keyId);
    const audit = await pool.query(
      "SELECT outcome FROM audit_events WHERE account_id = $1 AND action = 'drive.trace_inbox.read'",
      [f.accountId],
    );
    expect(audit.rows).toEqual([{ outcome: 'success' }]);
    expect((await bearerCall(await f.makeKey(['write'], [f.driveId]), path)).status).toBe(403);
    expect((await bearerCall(await f.makeKey(['read'], [f.otherDriveId]), path)).status).toBe(403);
    expect((await bearerCall(reader, path, 'POST', inboxBody())).status).toBe(404);
    expect((await bearerCall(reader, `drives/${f.driveId}/webhook-token`)).status).toBe(404);
  });
});

describe('webhook token', () => {
  it('requires an inbox first', async () => {
    const f = await fixture();
    const res = await consoleCall(f.userId, `drives/${f.driveId}/webhook-token`, 'POST');
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toContain('Create the trace inbox first.');
  });

  it('creates a token shown once, hashed at rest, and never returned by GET', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', inboxBody());
    expect(await json(await consoleCall(f.userId, tokenPath))).toEqual({ token: null });
    const created = await consoleCall(f.userId, tokenPath, 'POST');
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.token).toMatch(/^adw_[0-9a-f]{64}$/u);
    expect(body.url).toContain(`/api/webhooks/openrouter/${f.driveId}`);
    const row = await pool.query('SELECT * FROM drive_webhook_tokens WHERE id = $1', [body.id]);
    expect(row.rows[0].token_hash).toBe(tokenHash(body.token));
    const text = await (await consoleCall(f.userId, tokenPath)).text();
    expect(JSON.parse(text).token).toEqual({ id: body.id, createdAt: expect.any(String) });
    expect(text).not.toContain(body.token);
    expect(text).not.toContain(row.rows[0].token_hash);
  });

  it('replaces the active token, revokes on DELETE, and reuses one openrouter agent', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', inboxBody());
    const first = await json(await consoleCall(f.userId, tokenPath, 'POST'));
    const second = await json(await consoleCall(f.userId, tokenPath, 'POST'));
    expect(second.id).not.toBe(first.id);
    const rows = await pool.query(
      'SELECT id, revoked_at FROM drive_webhook_tokens WHERE drive_id = $1',
      [f.driveId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((r) => r.id === first.id).revoked_at).not.toBeNull();
    expect(rows.rows.filter((r) => r.revoked_at === null)).toHaveLength(1);
    const agents = await pool.query(
      "SELECT count(*)::int AS n FROM agents WHERE account_id = $1 AND name = 'openrouter'",
      [f.accountId],
    );
    expect(agents.rows[0].n).toBe(1);
    const revoked = await consoleCall(f.userId, tokenPath, 'DELETE');
    expect(revoked.status).toBe(200);
    expect((await json(revoked)).revokedAt).toEqual(expect.any(String));
    expect((await consoleCall(f.userId, tokenPath, 'DELETE')).status).toBe(404);
    expect(await json(await consoleCall(f.userId, tokenPath))).toEqual({ token: null });
  });

  it('cascades when the drive is deleted', async () => {
    const f = await fixture();
    await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', inboxBody());
    await consoleCall(f.userId, `drives/${f.driveId}/webhook-token`, 'POST');
    await pool.query('DELETE FROM drives WHERE id = $1', [f.driveId]);
    for (const table of ['drive_trace_inboxes', 'drive_webhook_tokens']) {
      const left = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE drive_id = $1`, [
        f.driveId,
      ]);
      expect(left.rows[0].n).toBe(0);
    }
  });
});

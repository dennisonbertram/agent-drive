import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest, handleConsoleApiRequest } from './handler';
import { inboxRecordDigest } from './trace-webhook';
import { decodeBase64Url, generateDriveKey } from '../../../../packages/agent-drive/src/crypto.js';
import {
  answerTraceInboxChallenge,
  createTraceInbox,
} from '../../../../packages/agent-drive/src/trace-inbox.js';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const root = 'http://agent-drive.test';
const accountIds: string[] = [];
const userIds: string[] = [];

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
const consoleCall = (
  userId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  reverified = true,
) =>
  handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, init(method, body, { origin: root })),
    userId,
    reverified,
  );
const bearerCall = (token: string, path: string, method = 'GET', body?: unknown) =>
  handleApiRequest(
    new Request(`${root}/api/v1/${path}`, init(method, body, { authorization: `Bearer ${token}` })),
  );

async function challenge(
  f: Awaited<ReturnType<typeof fixture>>,
  action: 'enroll' | 'issue-token',
  inbox: Awaited<ReturnType<typeof createTraceInbox>>,
  reverified = true,
) {
  const response = await consoleCall(
    f.userId,
    `drives/${f.driveId}/trace-inbox/challenge`,
    'POST',
    { action, inbox },
    reverified,
  );
  const value = await json(response.clone());
  return {
    response,
    proof:
      response.status === 201
        ? {
            challengeId: value.challengeId as string,
            proof: await answerTraceInboxChallenge({
              driveId: f.driveId,
              driveKey: f.driveKey,
              record: inbox,
              envelope: value.envelope as string,
            }),
          }
        : undefined,
  };
}

async function enrollInbox(
  f: Awaited<ReturnType<typeof fixture>>,
  inbox: Awaited<ReturnType<typeof createTraceInbox>>,
) {
  const issued = await challenge(f, 'enroll', inbox);
  if (!issued.proof) return issued.response;
  return consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
    ...inbox,
    ...issued.proof,
  });
}

async function createWebhookToken(
  f: Awaited<ReturnType<typeof fixture>>,
  inbox: Awaited<ReturnType<typeof createTraceInbox>>,
  reverified = true,
  extra: Record<string, unknown> = {},
) {
  const issued = await challenge(f, 'issue-token', inbox, reverified);
  if (!issued.proof) return issued.response;
  return consoleCall(
    f.userId,
    `drives/${f.driveId}/webhook-token`,
    'POST',
    { ...inbox, ...issued.proof, ...extra },
    reverified,
  );
}

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
  const driveKey = generateDriveKey();
  const makeKey = async (scopes: string[], driveIds: string[]) => {
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await pool.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1, $2, 'trace', $3, $4::uuid[], $5::text[])`,
      [accountId, agent.rows[0].id, tokenHash(token), driveIds, scopes],
    );
    return token;
  };
  return { userId, accountId, driveId, otherDriveId, driveKey, makeKey };
}

const inboxBody = (f: Awaited<ReturnType<typeof fixture>>) =>
  createTraceInbox(f.driveId, f.driveKey);

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
  it('issues a one-time enroll challenge encrypted to the exact candidate record', async () => {
    const f = await fixture();
    const inbox = await createTraceInbox(f.driveId, f.driveKey);
    const path = `drives/${f.driveId}/trace-inbox/challenge`;
    const response = await consoleCall(f.userId, path, 'POST', { action: 'enroll', inbox });
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body).toMatchObject({
      challengeId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      envelope: expect.any(String),
    });
    expect(body).not.toHaveProperty('proof');
    expect(decodeBase64Url(body.envelope as string)[0]).toBe(3);
    const stored = await pool.query(
      'SELECT actor_user_id, drive_id, action, inbox_record_hash, challenge_hash, expires_at FROM drive_trace_inbox_challenges WHERE id = $1',
      [body.challengeId],
    );
    expect(stored.rows[0]).toMatchObject({
      actor_user_id: f.userId,
      drive_id: f.driveId,
      action: 'enroll',
      inbox_record_hash: inboxRecordDigest(inbox.keyId, inbox.publicKey, inbox.wrappedPrivateKey),
    });
    expect(stored.rows[0].challenge_hash).not.toContain(body.envelope);
    expect(new Date(stored.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null, creates once, then 409s', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    expect(await json(await consoleCall(f.userId, path))).toEqual({ inbox: null });
    const body = await createTraceInbox(f.driveId, f.driveKey);
    const created = await enrollInbox(f, body);
    expect(created.status).toBe(201);
    expect((await json(created)).inbox).toMatchObject({
      keyId: body.keyId,
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
    });
    expect((await enrollInbox(f, await createTraceInbox(f.driveId, f.driveKey))).status).toBe(409);
    expect((await json(await consoleCall(f.userId, path))).inbox.keyId).toBe(body.keyId);
  });

  it('returns exactly the Clerk strict reverification response when not reverified', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    const expected = reverificationErrorResponse('strict');
    const res = await consoleCall(
      f.userId,
      path,
      'POST',
      await createTraceInbox(f.driveId, f.driveKey),
      false,
    );
    expect(res.status).toBe(expected.status);
    expect(await res.text()).toBe(await expected.text());
    // Nothing was enrolled.
    expect(await json(await consoleCall(f.userId, path))).toEqual({ inbox: null });
    // Reads stay ordinary session routes.
    expect((await consoleCall(f.userId, path, 'GET', undefined, false)).status).toBe(200);
  });

  it('does not issue an enrollment challenge without strict reverification', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const expected = reverificationErrorResponse('strict');
    const response = await consoleCall(
      f.userId,
      `drives/${f.driveId}/trace-inbox/challenge`,
      'POST',
      { action: 'enroll', inbox },
      false,
    );
    expect(response.status).toBe(expected.status);
    expect(await response.text()).toBe(await expected.text());
    const rows = await pool.query(
      'SELECT 1 FROM drive_trace_inbox_challenges WHERE drive_id = $1',
      [f.driveId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('consumes a proof challenge once, even when two enrollment requests race', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const issued = await challenge(f, 'enroll', inbox);
    expect(issued.proof).toBeDefined();
    const body = { ...inbox, ...issued.proof };
    const results = await Promise.all([
      consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', body),
      consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', body),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM drive_trace_inboxes WHERE drive_id = $1', [
          f.driveId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM drive_trace_inbox_challenges WHERE id = $1',
          [issued.proof!.challengeId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('rejects a proof challenge bound to another actor and leaves inbox state unchanged', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const issued = await challenge(f, 'enroll', inbox);
    await pool.query('UPDATE drive_trace_inbox_challenges SET actor_user_id = $1 WHERE id = $2', [
      `other-${f.userId}`,
      issued.proof!.challengeId,
    ]);
    const response = await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
      ...inbox,
      ...issued.proof,
    });
    expect(response.status).toBe(409);
    expect((await json(response)).error.message).toContain('proof expired or no longer matches');
    expect(await json(await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`))).toEqual({
      inbox: null,
    });
  });

  it('rejects an altered candidate record without consuming the valid proof', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const issued = await challenge(f, 'enroll', inbox);
    const altered = await inboxBody(f);
    const rejected = await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
      ...altered,
      ...issued.proof,
    });
    expect(rejected.status).toBe(409);
    const retry = await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
      ...inbox,
      ...issued.proof,
    });
    expect(retry.status).toBe(201);
  });

  it('rejects expired challenge proofs', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const issued = await challenge(f, 'enroll', inbox);
    await pool.query(
      "UPDATE drive_trace_inbox_challenges SET expires_at = now() - interval '1 second' WHERE id = $1",
      [issued.proof!.challengeId],
    );
    const response = await consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
      ...inbox,
      ...issued.proof,
    });
    expect(response.status).toBe(409);
  });

  it('checks challenge expiry after waiting for the drive lock', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    const issued = await challenge(f, 'enroll', inbox);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [f.driveId]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const request = consoleCall(f.userId, `drives/${f.driveId}/trace-inbox`, 'POST', {
        ...inbox,
        ...issued.proof,
      });
      let blocked = false;
      for (let i = 0; i < 100; i += 1) {
        const waiting = await pool.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [holderPid],
        );
        if (waiting.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      await pool.query(
        `UPDATE drive_trace_inbox_challenges
            SET expires_at = clock_timestamp() - interval '1 second'
          WHERE id = $1`,
        [issued.proof!.challengeId],
      );
      await holder.query('COMMIT');
      expect((await request).status).toBe(409);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('validates the body', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    const inbox = await inboxBody(f);
    expect((await consoleCall(f.userId, path, 'POST', { ...inbox, extra: 1 })).status).toBe(400);
    expect(
      (await consoleCall(f.userId, path, 'POST', { ...inbox, publicKey: 'short' })).status,
    ).toBe(400);
    expect((await consoleCall(f.userId, path, 'POST', { ...inbox, keyId: 'nope' })).status).toBe(
      400,
    );
  });

  it('serves bearer reads with the read scope, charges one operation, and rejects other keys', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/trace-inbox`;
    const body = await createTraceInbox(f.driveId, f.driveKey);
    expect((await enrollInbox(f, body)).status).toBe(201);
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
    expect(
      (await bearerCall(reader, path, 'POST', await createTraceInbox(f.driveId, f.driveKey)))
        .status,
    ).toBe(404);
    expect(
      (
        await bearerCall(reader, `drives/${f.driveId}/trace-inbox/challenge`, 'POST', {
          action: 'enroll',
          inbox: await createTraceInbox(f.driveId, f.driveKey),
        })
      ).status,
    ).toBe(404);
    expect((await bearerCall(reader, `drives/${f.driveId}/webhook-token`)).status).toBe(404);
  });
});

describe('webhook token', () => {
  it('requires an inbox first', async () => {
    const f = await fixture();
    const candidate = await inboxBody(f);
    const { response: res } = await challenge(f, 'issue-token', candidate);
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toContain('Create the trace inbox first.');
  });

  it('returns exactly the Clerk strict reverification response when not reverified', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/webhook-token`;
    await enrollInbox(f, await inboxBody(f));
    const expected = reverificationErrorResponse('strict');
    const res = await consoleCall(f.userId, path, 'POST', undefined, false);
    expect(res.status).toBe(expected.status);
    expect(await res.text()).toBe(await expected.text());
    const rows = await pool.query('SELECT 1 FROM drive_webhook_tokens WHERE drive_id = $1', [
      f.driveId,
    ]);
    expect(rows.rowCount).toBe(0);
    // GET and DELETE keep ordinary session auth.
    expect((await consoleCall(f.userId, path, 'GET', undefined, false)).status).toBe(200);
    expect((await consoleCall(f.userId, path, 'DELETE', undefined, false)).status).toBe(404);
  });

  it('binds each issued token to the exact inbox record', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const body = await inboxBody(f);
    await enrollInbox(f, body);
    const created = await json(await createWebhookToken(f, body));
    const row = (await pool.query('SELECT * FROM drive_webhook_tokens WHERE id = $1', [created.id]))
      .rows[0];
    expect(row.inbox_key_id).toBe(body.keyId);
    expect(row.inbox_record_hash).toBe(
      inboxRecordDigest(body.keyId, body.publicKey, body.wrappedPrivateKey),
    );
  });

  it('rejects a token change when the active token is not the one the page saw', async () => {
    const f = await fixture();
    const body = await inboxBody(f);
    await enrollInbox(f, body);
    // Add with expectedTokenId null succeeds when there is no active token.
    const first = await json(await createWebhookToken(f, body, true, { expectedTokenId: null }));
    // A second tab that still expects "none" must not replace the token it never saw.
    const stale = await createWebhookToken(f, body, true, { expectedTokenId: null });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.message).toBe('This changed in another tab.');
    const active = await pool.query(
      'SELECT id FROM drive_webhook_tokens WHERE drive_id = $1 AND revoked_at IS NULL',
      [f.driveId],
    );
    expect(active.rows).toEqual([{ id: first.id }]);
    // Replacing the token it did see works, and the old one is revoked.
    const second = await createWebhookToken(f, body, true, { expectedTokenId: first.id });
    expect(second.status).toBe(201);
    const bad = await createWebhookToken(f, body, true, { expectedTokenId: 7 });
    expect(bad.status).toBe(400);
  });

  it('refuses token issuance when the verified inbox record changed under the same keyId', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const verified = await inboxBody(f);
    await enrollInbox(f, verified);
    const active = await json(await createWebhookToken(f, verified));
    const changed = await inboxBody(f);
    await pool.query(
      `UPDATE drive_trace_inboxes
          SET public_key = $1, wrapped_private_key = $2
        WHERE drive_id = $3`,
      [changed.publicKey, changed.wrappedPrivateKey, f.driveId],
    );

    // This is the exact snapshot the browser verified before the stored record changed.
    const res = await createWebhookToken(f, verified);
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toContain('trace inbox changed');
    const rows = await pool.query(
      'SELECT id, revoked_at FROM drive_webhook_tokens WHERE drive_id = $1',
      [f.driveId],
    );
    expect(rows.rows).toEqual([{ id: active.id, revoked_at: null }]);
    expect((await json(await consoleCall(f.userId, tokenPath))).token.status).toBe('stale');
  });

  it('rejects a record change between the challenge and token transaction without revoking the active token', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    const active = await json(await createWebhookToken(f, inbox));
    const issued = await challenge(f, 'issue-token', inbox);
    const changed = await inboxBody(f);
    await pool.query(
      'UPDATE drive_trace_inboxes SET key_id = $1, public_key = $2, wrapped_private_key = $3 WHERE drive_id = $4',
      [changed.keyId, changed.publicKey, changed.wrappedPrivateKey, f.driveId],
    );
    const response = await consoleCall(f.userId, `drives/${f.driveId}/webhook-token`, 'POST', {
      ...inbox,
      ...issued.proof,
    });
    expect(response.status).toBe(409);
    const tokens = await pool.query(
      'SELECT id, revoked_at FROM drive_webhook_tokens WHERE drive_id = $1',
      [f.driveId],
    );
    expect(tokens.rows).toEqual([{ id: active.id, revoked_at: null }]);
  });

  it('locks the inbox until token rotation commits', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    const active = await json(await createWebhookToken(f, inbox));
    const issued = await challenge(f, 'issue-token', inbox);
    const changed = await inboxBody(f);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'UPDATE drive_trace_inboxes SET key_id = $1, public_key = $2, wrapped_private_key = $3 WHERE drive_id = $4',
        [changed.keyId, changed.publicKey, changed.wrappedPrivateKey, f.driveId],
      );
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const rotating = consoleCall(f.userId, `drives/${f.driveId}/webhook-token`, 'POST', {
        ...inbox,
        ...issued.proof,
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const blocked = await pool.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (blocked.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      await holder.query('COMMIT');
      const response = await rotating;
      expect(response.status).toBe(409);
      const rows = await pool.query(
        'SELECT id, revoked_at FROM drive_webhook_tokens WHERE drive_id = $1',
        [f.driveId],
      );
      expect(rows.rows).toEqual([{ id: active.id, revoked_at: null }]);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('does not let a legacy request issue a token for an existing inbox', async () => {
    const f = await fixture();
    const path = `drives/${f.driveId}/webhook-token`;
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    const active = await json(await createWebhookToken(f, inbox));

    const noBody = await consoleCall(f.userId, path, 'POST');
    const keyIdOnly = await consoleCall(f.userId, path, 'POST', { keyId: inbox.keyId });
    expect(noBody.status).toBe(400);
    expect((await json(noBody)).error.message).toContain('update the client');
    expect(keyIdOnly.status).toBe(400);
    expect((await json(keyIdOnly)).error.message).toContain('update the client');
    const rows = await pool.query(
      'SELECT id, revoked_at FROM drive_webhook_tokens WHERE drive_id = $1',
      [f.driveId],
    );
    expect(rows.rows).toEqual([{ id: active.id, revoked_at: null }]);
  });

  it('409s a token request that names a different keyId than the stored record', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const body = await inboxBody(f);
    await enrollInbox(f, body);
    const altered = { ...body, keyId: randomUUID() };
    const { response: res } = await challenge(f, 'issue-token', altered);
    expect(res.status).toBe(409);
    expect((await json(res)).error.message).toContain('trace inbox changed');
    const rows = await pool.query('SELECT 1 FROM drive_webhook_tokens WHERE drive_id = $1', [
      f.driveId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('creates a token shown once, hashed at rest, and never returned by GET', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    expect(await json(await consoleCall(f.userId, tokenPath))).toEqual({ token: null });
    const created = await createWebhookToken(f, inbox);
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.token).toMatch(/^adw_[0-9a-f]{64}$/u);
    expect(body.url).toContain(`/api/webhooks/openrouter/${f.driveId}`);
    expect((await json(await consoleCall(f.userId, tokenPath))).token.status).toBe('active');
    const row = await pool.query('SELECT * FROM drive_webhook_tokens WHERE id = $1', [body.id]);
    expect(row.rows[0].token_hash).toBe(tokenHash(body.token));
    const text = await (await consoleCall(f.userId, tokenPath)).text();
    expect(JSON.parse(text).token).toEqual({
      id: body.id,
      createdAt: expect.any(String),
      status: 'active',
    });
    expect(text).not.toContain(body.token);
    expect(text).not.toContain(row.rows[0].token_hash);
  });

  it('replaces the active token, revokes on DELETE, and reuses one openrouter agent', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    const first = await json(await createWebhookToken(f, inbox));
    const second = await json(await createWebhookToken(f, inbox));
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

  it('DELETE waits for a concurrent rotation and then revokes the new token', async () => {
    const f = await fixture();
    const tokenPath = `drives/${f.driveId}/webhook-token`;
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    const first = await json(await createWebhookToken(f, inbox));
    // Play the rotation by hand: hold the drive lock, revoke A, insert B, and commit only after
    // DELETE is observed waiting on that lock.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [f.driveId]);
      await holder.query('UPDATE drive_webhook_tokens SET revoked_at = now() WHERE id = $1', [
        first.id,
      ]);
      const agent = await holder.query(
        "SELECT id FROM agents WHERE account_id = $1 AND name = 'openrouter'",
        [f.accountId],
      );
      await holder.query(
        `INSERT INTO drive_webhook_tokens (drive_id, account_id, agent_id, token_hash)
         VALUES ($1, $2, $3, $4)`,
        [f.driveId, f.accountId, agent.rows[0].id, tokenHash(randomUUID())],
      );
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const deleting = consoleCall(f.userId, tokenPath, 'DELETE');
      for (let i = 0; i < 100; i += 1) {
        const blocked = await pool.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (blocked.rowCount) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await holder.query('COMMIT');
      const res = await deleting;
      expect(res.status).toBe(200);
    } finally {
      holder.release();
    }
    const active = await pool.query(
      'SELECT 1 FROM drive_webhook_tokens WHERE drive_id = $1 AND revoked_at IS NULL',
      [f.driveId],
    );
    expect(active.rowCount).toBe(0);
  });

  it('cascades when the drive is deleted', async () => {
    const f = await fixture();
    const inbox = await inboxBody(f);
    await enrollInbox(f, inbox);
    await createWebhookToken(f, inbox);
    await pool.query('DELETE FROM drives WHERE id = $1', [f.driveId]);
    for (const table of ['drive_trace_inboxes', 'drive_webhook_tokens']) {
      const left = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE drive_id = $1`, [
        f.driveId,
      ]);
      expect(left.rows[0].n).toBe(0);
    }
  });
});

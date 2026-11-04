import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest, handleConsoleApiRequest } from './handler';
import { cleanupDeviceAuthorizations } from './upload-cleanup';
import { handleOAuthRequest, startDeviceAuthorization } from './device';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const origin = 'http://localhost:3100';
process.env.AGENT_DRIVE_PUBLIC_URL = origin;
const suffix = randomUUID().replaceAll('-', '_');
const ownerUser = `device_owner_${suffix}`;
const otherUser = `device_other_${suffix}`;
const accountIds: string[] = [];
// A valid-shaped ECDH P-256 public key: 0x04 followed by 64 bytes, base64url without padding.
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const deviceTokenGrant = 'urn:ietf:params:oauth:grant-type:device_code';
let ownerAccountId = '';
let otherAccountId = '';
let driveId = '';
let otherDriveId = '';
let ipCounter = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;

function oauth(path: string, body: Record<string, unknown>, ip = nextIp(), form = false) {
  return handleOAuthRequest(
    new Request(`${origin}/api/oauth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'x-forwarded-for': `${ip}, 10.0.0.1`,
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
    }),
  );
}

function consoleCall(userId: string, path: string, method = 'GET', body?: unknown) {
  const headers = new Headers();
  if (method !== 'GET') headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleConsoleApiRequest(new Request(`${origin}/api/console${path}`, init), userId);
}

async function start(extra: Record<string, unknown> = {}, ip = nextIp()) {
  const response = await oauth(
    'device_authorization',
    { client_name: 'claude-code', machine: 'laptop', public_key: publicKey, ...extra },
    ip,
  );
  expect(response.status).toBe(200);
  return json(response);
}

const poll = (deviceCode: string) =>
  oauth('token', { grant_type: deviceTokenGrant, device_code: deviceCode });
const allowPoll = (deviceCode: string) =>
  pool.query(
    "UPDATE device_authorizations SET last_polled_at = now() - interval '1 minute' WHERE device_code_hash = $1",
    [createHash('sha256').update(deviceCode).digest('hex')],
  );

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  ownerAccountId = (await json(await consoleCall(ownerUser, '/session'))).account.id;
  otherAccountId = (await json(await consoleCall(otherUser, '/session'))).account.id;
  accountIds.push(ownerAccountId, otherAccountId);
  driveId = (
    await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
      ownerAccountId,
      'owner-drive',
    ])
  ).rows[0].id;
  otherDriveId = (
    await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
      otherAccountId,
      'other-drive',
    ])
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM device_authorizations WHERE account_id = ANY($1::uuid[])', [
    accountIds,
  ]);
  await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  await pool.end();
});

describe('device authorization', () => {
  it('runs the full approve flow and issues the key exactly once', async () => {
    const started = await start();
    expect(started).toMatchObject({
      expires_in: 600,
      interval: 5,
      verification_uri: `${origin}/connect`,
    });
    expect(started.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.verification_uri_complete).toBe(`${origin}/connect?code=${started.user_code}`);
    const stored = await pool.query(
      'SELECT device_code_hash FROM device_authorizations WHERE user_code = $1 ORDER BY created_at DESC',
      [started.user_code],
    );
    expect(stored.rows[0].device_code_hash).toBe(
      createHash('sha256').update(started.device_code).digest('hex'),
    );

    const pending = await poll(started.device_code);
    expect(pending.status).toBe(400);
    expect((await json(pending)).error).toBe('authorization_pending');
    const fast = await poll(started.device_code);
    expect(fast.status).toBe(400);
    expect((await json(fast)).error).toBe('slow_down');
    expect(
      (
        await pool.query(
          'SELECT interval_seconds FROM device_authorizations WHERE user_code = $1',
          [started.user_code],
        )
      ).rows[0].interval_seconds,
    ).toBe(10);

    const info = await json(await consoleCall(ownerUser, `/device/${started.user_code}`));
    expect(info).toMatchObject({
      user_code: started.user_code,
      client_name: 'claude-code',
      machine: 'laptop',
      public_key: publicKey,
    });

    const sealed = { [driveId]: { epk: 'AAAA', iv: 'BBBB', ct: 'CCCC' } };
    const approve = await consoleCall(ownerUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read', 'write'],
      sealedDriveKeys: sealed,
    });
    expect(approve.status).toBe(200);
    expect(await json(approve)).toEqual({ status: 'approved' });

    await allowPoll(started.device_code);
    const issued = await poll(started.device_code);
    expect(issued.status).toBe(200);
    const token = await json(issued);
    expect(token).toMatchObject({
      token_type: 'Bearer',
      scope: 'read write',
      api_url: `${origin}/api`,
      account_id: ownerAccountId,
      agent_name: 'claude-code',
      drive_ids: [driveId],
      new_drive_id: null,
      sealed_drive_keys: sealed,
    });
    expect(token.access_token).toMatch(/^adk_/);
    const keyRow = await pool.query(
      'SELECT label, scopes, drive_ids FROM api_keys WHERE id = (SELECT api_key_id FROM device_authorizations WHERE user_code = $1)',
      [started.user_code],
    );
    expect(keyRow.rows[0]).toMatchObject({
      label: 'claude-code on laptop',
      scopes: ['read', 'write'],
      drive_ids: [driveId],
    });

    const whoami = await handleApiRequest(
      new Request(`${origin}/api/v1/whoami`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
    );
    expect(whoami.status).toBe(200);
    expect(await json(whoami)).toMatchObject({
      accountId: ownerAccountId,
      agentId: token.agent_id,
      scopes: ['read', 'write'],
      driveIds: [driveId],
    });

    await allowPoll(started.device_code);
    const again = await poll(started.device_code);
    expect(again.status).toBe(400);
    expect((await json(again)).error).toBe('invalid_grant');
    const info2 = await consoleCall(ownerUser, `/device/${started.user_code}`);
    expect(info2.status).toBe(404);
  });

  it('issues one key when two polls race', async () => {
    const started = await start({ client_name: `race-${suffix}` });
    await consoleCall(ownerUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
    });
    await allowPoll(started.device_code);
    const results = await Promise.all([poll(started.device_code), poll(started.device_code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const count = await pool.query(
      'SELECT count(*)::int AS n FROM api_keys WHERE agent_id = (SELECT agent_id FROM device_authorizations WHERE user_code = $1)',
      [started.user_code],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('accepts form-encoded bodies and rejects bad input and grant types', async () => {
    const form = await oauth(
      'device_authorization',
      { client_name: 'form-agent', public_key: publicKey },
      nextIp(),
      true,
    );
    expect(form.status).toBe(200);
    expect(form.headers.get('cache-control')).toBe('no-store');
    for (const body of [
      { client_name: '', public_key: publicKey },
      { client_name: 'x'.repeat(65), public_key: publicKey },
      { client_name: 'ok', public_key: 'not-a-key' },
      { client_name: 'ok' },
      { client_name: 'ok', public_key: publicKey, machine: 'm'.repeat(129) },
    ]) {
      const bad = await oauth('device_authorization', body);
      expect(bad.status).toBe(400);
      expect((await json(bad)).error).toBe('invalid_request');
    }
    const grant = await oauth('token', { grant_type: 'password', device_code: 'x' });
    expect((await json(grant)).error).toBe('unsupported_grant_type');
    const unknown = await poll('does-not-exist');
    expect((await json(unknown)).error).toBe('invalid_grant');
  });

  it('reports access_denied after a deny', async () => {
    const started = await start();
    const denied = await consoleCall(ownerUser, `/device/${started.user_code}/deny`, 'POST', {});
    expect(denied.status).toBe(200);
    expect(await json(denied)).toEqual({ status: 'denied' });
    await allowPoll(started.device_code);
    expect((await json(await poll(started.device_code))).error).toBe('access_denied');
  });

  it('reports expired_token and refuses to approve expired requests', async () => {
    const started = await start();
    await pool.query(
      "UPDATE device_authorizations SET expires_at = now() - interval '1 second' WHERE user_code = $1",
      [started.user_code],
    );
    expect((await consoleCall(ownerUser, `/device/${started.user_code}`)).status).toBe(404);
    const approve = await consoleCall(ownerUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(approve.status).toBe(404);
    expect((await json(await poll(started.device_code))).error).toBe('expired_token');

    const approved = await start();
    await consoleCall(ownerUser, `/device/${approved.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
    });
    await pool.query(
      "UPDATE device_authorizations SET expires_at = now() - interval '1 second', last_polled_at = NULL WHERE user_code = $1",
      [approved.user_code],
    );
    expect((await json(await poll(approved.device_code))).error).toBe('expired_token');
  });

  it('validates approval input', async () => {
    const started = await start();
    const path = `/device/${started.user_code}/approve`;
    const manage = await consoleCall(ownerUser, path, 'POST', {
      driveIds: [driveId],
      scopes: ['read', 'manage'],
    });
    expect(manage.status).toBe(400);
    const none = await consoleCall(ownerUser, path, 'POST', { scopes: ['read'] });
    expect(none.status).toBe(400);
    const noScopes = await consoleCall(ownerUser, path, 'POST', {
      driveIds: [driveId],
      scopes: [],
    });
    expect(noScopes.status).toBe(400);
    const foreign = await consoleCall(ownerUser, path, 'POST', {
      driveIds: [otherDriveId],
      scopes: ['read'],
    });
    expect(foreign.status).toBe(404);
    const strayKeys = await consoleCall(ownerUser, path, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
      sealedDriveKeys: { [randomUUID()]: { epk: 'a', iv: 'b', ct: 'c' } },
    });
    expect(strayKeys.status).toBe(400);
    const row = await pool.query('SELECT status FROM device_authorizations WHERE user_code = $1', [
      started.user_code,
    ]);
    expect(row.rows[0].status).toBe('pending');
  });

  it('creates a new drive and returns new_drive_id', async () => {
    const started = await start({ client_name: `new-drive-agent-${suffix}` });
    const approve = await consoleCall(ownerUser, `/device/${started.user_code}/approve`, 'POST', {
      newDriveName: `agent-drive-${suffix}`,
      scopes: ['read', 'write', 'delete', 'share'],
    });
    expect(approve.status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token.new_drive_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token.drive_ids).toEqual([token.new_drive_id]);
    const drive = await pool.query('SELECT account_id, name FROM drives WHERE id = $1', [
      token.new_drive_id,
    ]);
    expect(drive.rows[0]).toEqual({ account_id: ownerAccountId, name: `agent-drive-${suffix}` });
  });

  it('keeps one console account from deciding on another, and audits without an actor', async () => {
    const started = await start();
    const unauth = await handleConsoleApiRequest(
      new Request(`${origin}/api/console/device/${started.user_code}`),
      null,
    );
    expect(unauth.status).toBe(401);
    const approve = await consoleCall(otherUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(approve.status).toBe(404);
    await consoleCall(otherUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [otherDriveId],
      scopes: ['read'],
    });
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token.account_id).toBe(otherAccountId);

    const audit = await pool.query(
      `SELECT action, api_key_id, user_id FROM audit_events
        WHERE action IN ('device.authorize','device.token') AND api_key_id IS NULL AND user_id IS NULL`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['device.authorize', 'device.token']),
    );
    const consoleAudit = await pool.query(
      "SELECT DISTINCT action FROM audit_events WHERE account_id = $1 AND action LIKE 'console.device.%'",
      [ownerAccountId],
    );
    expect(consoleAudit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'console.device.read',
        'console.device.approve',
        'console.device.deny',
      ]),
    );
  });

  async function approveFor(user: string, drive: string) {
    const started = await start({ client_name: `agent-${randomUUID()}` });
    const approve = await consoleCall(user, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [drive],
      scopes: ['read'],
    });
    expect(approve.status).toBe(200);
    const agentId = (
      await pool.query('SELECT agent_id FROM device_authorizations WHERE user_code = $1', [
        started.user_code,
      ])
    ).rows[0].agent_id as string;
    return { started, agentId };
  }
  const liveKeys = async (agentId: string) =>
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM api_keys WHERE agent_id = $1 AND revoked_at IS NULL',
        [agentId],
      )
    ).rows[0].n as number;

  it('denies an approved request when the agent is revoked before redemption', async () => {
    const { started, agentId } = await approveFor(ownerUser, driveId);
    const revoked = await consoleCall(ownerUser, `/agents/${agentId}/revoke`, 'POST');
    expect(revoked.status).toBe(200);
    await allowPoll(started.device_code);
    const result = await poll(started.device_code);
    expect(result.status).toBe(400);
    expect((await json(result)).error).toBe('access_denied');
    expect(await liveKeys(agentId)).toBe(0);
    const total = await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE agent_id = $1', [
      agentId,
    ]);
    expect(total.rows[0].n).toBe(0);
  });

  it('never yields a working key when revoke and redeem race', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { started, agentId } = await approveFor(ownerUser, driveId);
      await allowPoll(started.device_code);
      const [revoked, redeemed] = await Promise.all([
        consoleCall(ownerUser, `/agents/${agentId}/revoke`, 'POST'),
        poll(started.device_code),
      ]);
      expect(revoked.status).toBe(200);
      expect([200, 400]).toContain(redeemed.status);
      expect(await liveKeys(agentId)).toBe(0);
    }
  });

  it('limits failed console lookups per account and bounds total attempts', async () => {
    const user = `device_limit_${suffix}`;
    const session = await json(await consoleCall(user, '/session'));
    accountIds.push(session.account.id);
    for (let i = 0; i < 10; i += 1) {
      const miss = await consoleCall(user, '/device/BBBB-CCCC');
      expect(miss.status).toBe(404);
    }
    const limited = await consoleCall(user, '/device/BBBB-CCCC');
    expect(limited.status).toBe(429);
    expect((await json(limited)).error.code).toBe('rate_limited');
    // A real pending code is also refused while the window is exhausted.
    const started = await start();
    const real = await consoleCall(user, `/device/${started.user_code}`);
    expect(real.status).toBe(429);
    const approve = await consoleCall(user, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(approve.status).toBe(429);
    // Other accounts are unaffected, and the window passing restores access.
    expect((await consoleCall(ownerUser, `/device/${started.user_code}`)).status).toBe(200);
    await pool.query(
      "UPDATE device_console_limits SET window_start = now() - interval '11 minutes' WHERE account_id = $1",
      [session.account.id],
    );
    expect((await consoleCall(user, `/device/${started.user_code}`)).status).toBe(200);
    // Successful lookups still count toward the 30 per window total.
    for (let i = 0; i < 29; i += 1)
      expect((await consoleCall(user, `/device/${started.user_code}`)).status).toBe(200);
    expect((await consoleCall(user, `/device/${started.user_code}`)).status).toBe(429);
  });

  it('commits the key and its audit row together, so a failed audit can be retried', async () => {
    const { started } = await approveFor(ownerUser, driveId);
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_token_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER test_fail_token_audit BEFORE INSERT ON audit_events
      FOR EACH ROW WHEN (NEW.action = 'device.token' AND NEW.outcome = 'success')
      EXECUTE FUNCTION test_fail_token_audit()`);
    try {
      await allowPoll(started.device_code);
      const failed = await poll(started.device_code);
      expect(failed.status).toBe(500);
    } finally {
      await pool.query('DROP TRIGGER test_fail_token_audit ON audit_events');
      await pool.query('DROP FUNCTION test_fail_token_audit()');
    }
    const row = await pool.query(
      'SELECT status, api_key_id FROM device_authorizations WHERE user_code = $1',
      [started.user_code],
    );
    expect(row.rows[0]).toMatchObject({ status: 'approved', api_key_id: null });
    await allowPoll(started.device_code);
    const retry = await poll(started.device_code);
    expect(retry.status).toBe(200);
    expect((await json(retry)).access_token).toMatch(/^adk_/);
  });

  it('rate limits starts per IP', async () => {
    const ip = '198.51.100.77';
    await pool.query('DELETE FROM device_authorizations WHERE ip_hash = $1', [
      createHash('sha256').update(ip).digest('hex'),
    ]);
    for (let i = 0; i < 20; i += 1) await start({}, ip);
    const limited = await oauth(
      'device_authorization',
      { client_name: 'x', public_key: publicKey },
      ip,
    );
    expect(limited.status).toBe(429);
    expect(await json(limited)).toEqual({ error: 'slow_down' });
  });

  it('retries user code generation on collision', async () => {
    await pool.query("DELETE FROM device_authorizations WHERE user_code = 'BCDF-GHJK'");
    const first = await start();
    const codes = [first.user_code as string, first.user_code as string, 'BCDF-GHJK'];
    const created = await startDeviceAuthorization(
      { clientName: 'collide', machine: null, publicKey },
      { ip: nextIp(), origin },
      () => codes.shift()!,
    );
    expect(created.user_code).toBe('BCDF-GHJK');
    expect(codes).toEqual([]);
    await pool.query("DELETE FROM device_authorizations WHERE user_code = 'BCDF-GHJK'");
  });

  it('cleanup deletes rows older than 24 hours only', async () => {
    const old = await start();
    const recent = await start();
    await pool.query(
      "UPDATE device_authorizations SET created_at = now() - interval '25 hours' WHERE user_code = $1",
      [old.user_code],
    );
    await cleanupDeviceAuthorizations();
    const rows = await pool.query(
      'SELECT user_code FROM device_authorizations WHERE user_code = ANY($1::text[])',
      [[old.user_code, recent.user_code]],
    );
    expect(rows.rows.map((r) => r.user_code)).toEqual([recent.user_code]);
  });
});

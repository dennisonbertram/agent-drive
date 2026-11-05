import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

function oauth(
  path: string,
  body: Record<string, unknown>,
  ip = nextIp(),
  form = false,
  bearer?: string,
) {
  return handleOAuthRequest(
    new Request(`${origin}/api/oauth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'x-forwarded-for': `${ip}, 10.0.0.1`,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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

async function start(extra: Record<string, unknown> = {}, ip = nextIp(), bearer?: string) {
  const response = await oauth(
    'device_authorization',
    { client_name: 'claude-code', machine: 'laptop', public_key: publicKey, ...extra },
    ip,
    false,
    bearer,
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
    for (const writePaths of [
      ['/'],
      ['inbox'],
      ['/a/'],
      'x',
      Array.from({ length: 17 }, (_, i) => `/p${i}`),
    ]) {
      const bad = await consoleCall(ownerUser, path, 'POST', {
        driveIds: [driveId],
        scopes: ['read'],
        writePaths,
      });
      expect(bad.status).toBe(400);
    }
    const row = await pool.query('SELECT status FROM device_authorizations WHERE user_code = $1', [
      started.user_code,
    ]);
    expect(row.rows[0].status).toBe('pending');
  });

  it('carries writePaths from approval to the issued key', async () => {
    const started = await start({ client_name: `paths-agent-${suffix}` });
    const approve = await consoleCall(ownerUser, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [driveId],
      scopes: ['read', 'write'],
      writePaths: ['/inbox/x', '/inbox/x'],
    });
    expect(approve.status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token.write_paths).toEqual(['/inbox/x']);
    const stored = await pool.query('SELECT write_paths FROM api_keys WHERE token_hash = $1', [
      createHash('sha256').update(token.access_token).digest('hex'),
    ]);
    expect(stored.rows[0].write_paths).toEqual(['/inbox/x']);
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

describe('one-click connect (contract v2)', () => {
  // Each test gets its own account: the free plan allows only 3 drives.
  let user = ownerUser;
  let account = ownerAccountId;
  let drive = driveId;
  beforeEach(async () => {
    user = `device_v2_${randomUUID()}`;
    account = (await json(await consoleCall(user, '/session'))).account.id;
    accountIds.push(account);
    drive = (
      await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
        account,
        'owner-drive',
      ])
    ).rows[0].id;
  });
  const approveEmpty = (code: string) => consoleCall(user, `/device/${code}/approve`, 'POST', {});
  async function login(extra: Record<string, unknown>, bearer?: string) {
    const started = await start(extra, nextIp(), bearer);
    expect((await approveEmpty(started.user_code)).status).toBe(200);
    await allowPoll(started.device_code);
    const issued = await poll(started.device_code);
    expect(issued.status).toBe(200);
    return { started, token: await json(issued) };
  }

  const whoami = (key: string) =>
    handleApiRequest(
      new Request(`${origin}/api/v1/whoami`, { headers: { authorization: `Bearer ${key}` } }),
    );

  it('reconnects only drives the previous key holds, and GET lists them', async () => {
    const name = `known-${suffix}`;
    const first = (await login({ client_name: name })).token;
    const held = first.drive_ids[0];
    const started = await start(
      { client_name: name, known_drive_ids: [held, held, drive] },
      nextIp(),
      first.access_token,
    );
    const info = await json(await consoleCall(user, `/device/${started.user_code}`));
    expect(info.drives).toEqual([{ id: held, name }]);
    expect(info.creates_drive).toBe(false);
    expect((await approveEmpty(started.user_code)).status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token).toMatchObject({ drive_ids: [held], new_drive_id: null });
    expect(token.scope).toBe('read write delete share');
    expect((await whoami(first.access_token)).status).toBe(401);
    expect((await whoami(token.access_token)).status).toBe(200);
  });

  it("an empty-body reconnect keeps the previous key's scopes and write paths", async () => {
    const name = `limited-${suffix}`;
    const first = await start({ client_name: name }, nextIp());
    const explicit = await consoleCall(user, `/device/${first.user_code}/approve`, 'POST', {
      newDriveName: `limited-drive-${suffix}`,
      scopes: ['read'],
      writePaths: ['/inbox/x'],
    });
    expect(explicit.status).toBe(200);
    await allowPoll(first.device_code);
    const original = await json(await poll(first.device_code));
    expect(original.write_paths).toEqual(['/inbox/x']);
    const held = original.drive_ids[0];
    const again = await start(
      { client_name: name, known_drive_ids: [held] },
      nextIp(),
      original.access_token,
    );
    const info = await json(await consoleCall(user, `/device/${again.user_code}`));
    expect(info).toMatchObject({ scopes: ['read'], write_paths: ['/inbox/x'] });
    expect((await approveEmpty(again.user_code)).status).toBe(200);
    await allowPoll(again.device_code);
    const token = await json(await poll(again.device_code));
    expect(token).toMatchObject({ drive_ids: [held], scope: 'read', write_paths: ['/inbox/x'] });
    expect((await whoami(original.access_token)).status).toBe(401);
    const me = await json(await whoami(token.access_token));
    expect(me).toMatchObject({ scopes: ['read'], writePaths: ['/inbox/x'] });
  });

  it('a restricted key that reconnects with no known drives keeps its scopes and write paths', async () => {
    const name = `lost-${suffix}`;
    const first = await start({ client_name: name }, nextIp());
    expect(
      (
        await consoleCall(user, `/device/${first.user_code}/approve`, 'POST', {
          newDriveName: `lost-drive-${suffix}`,
          scopes: ['read'],
          writePaths: ['/inbox/x'],
        })
      ).status,
    ).toBe(200);
    await allowPoll(first.device_code);
    const original = await json(await poll(first.device_code));
    const again = await start(
      { client_name: name, known_drive_ids: [] },
      nextIp(),
      original.access_token,
    );
    const info = await json(await consoleCall(user, `/device/${again.user_code}`));
    expect(info).toMatchObject({
      creates_drive: true,
      scopes: ['read'],
      write_paths: ['/inbox/x'],
    });
    expect((await approveEmpty(again.user_code)).status).toBe(200);
    await allowPoll(again.device_code);
    const token = await json(await poll(again.device_code));
    expect(token.new_drive_id).toBeTruthy();
    expect(token).toMatchObject({ scope: 'read', write_paths: ['/inbox/x'] });
  });

  it('ignores known_drive_ids without proof, so a known id grants nothing', async () => {
    const started = await start({ client_name: `attack-${suffix}`, known_drive_ids: [drive] });
    const info = await json(await consoleCall(user, `/device/${started.user_code}`));
    expect(info).toMatchObject({ drives: [], creates_drive: true });
    expect((await approveEmpty(started.user_code)).status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token.drive_ids).not.toContain(drive);
    expect(token.new_drive_id).toBeTruthy();
    const stored = await pool.query(
      'SELECT previous_api_key_id FROM device_authorizations WHERE user_code = $1',
      [started.user_code],
    );
    expect(stored.rows[0].previous_api_key_id).toBeNull();
  });

  it('ignores invalid and revoked bearers, and keys of another agent or account', async () => {
    await pool.query('DELETE FROM drives WHERE id = $1', [drive]); // free-plan drive quota
    const victim = (await login({ client_name: `victim-${suffix}` })).token;
    const held = victim.drive_ids[0];
    // Another agent in the same account.
    const sameAccountOtherAgent = victim.access_token;
    // Another account's key.
    const otherUserId = `device_v2_${randomUUID()}`;
    const otherAcct = (await json(await consoleCall(otherUserId, '/session'))).account.id;
    accountIds.push(otherAcct);
    const outsiderKey = `adk_${randomUUID().replaceAll('-', '')}`;
    const outsiderDrive = (
      await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
        otherAcct,
        'outsider',
      ])
    ).rows[0].id;
    const outsiderAgent = (
      await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
        otherAcct,
        `attacker-${suffix}`,
      ])
    ).rows[0].id;
    await pool.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1,$2,'x',$3,$4::uuid[],ARRAY['read'])`,
      [
        otherAcct,
        outsiderAgent,
        createHash('sha256').update(outsiderKey).digest('hex'),
        [outsiderDrive],
      ],
    );
    const revokedKey = (await login({ client_name: `gone-${suffix}` })).token;
    await pool.query('DELETE FROM drives WHERE id = $1', [revokedKey.drive_ids[0]]);
    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE token_hash = $1', [
      createHash('sha256').update(revokedKey.access_token).digest('hex'),
    ]);
    for (const [bearer, ids] of [
      [sameAccountOtherAgent, [held]], // key belongs to agent "victim", request is "attacker"
      [outsiderKey, [held, outsiderDrive]],
      [revokedKey.access_token, revokedKey.drive_ids],
      ['adk_not_a_real_key', [held]],
    ] as const) {
      const started = await start(
        { client_name: `attacker-${suffix}`, known_drive_ids: [...ids] },
        nextIp(),
        bearer,
      );
      const info = await json(await consoleCall(user, `/device/${started.user_code}`));
      expect(info).toMatchObject({ drives: [], creates_drive: true });
      expect((await approveEmpty(started.user_code)).status).toBe(200);
      await allowPoll(started.device_code);
      const token = await json(await poll(started.device_code));
      expect(token.drive_ids).toEqual([token.new_drive_id]);
      await pool.query('DELETE FROM drives WHERE id = $1', [token.new_drive_id]);
    }
    expect((await whoami(victim.access_token)).status).toBe(200);
    expect((await whoami(revokedKey.access_token)).status).toBe(401);
  });

  it('filters unknown, foreign, and deleting known ids, then creates a named drive', async () => {
    const deleting = (
      await pool.query(
        'INSERT INTO drives (account_id,name,deleting_at) VALUES ($1,$2,now()) RETURNING id',
        [account, `deleting-${suffix}`],
      )
    ).rows[0].id;
    const name = `fresh-${suffix}`;
    const started = await start({
      client_name: name,
      known_drive_ids: [randomUUID(), otherDriveId, deleting],
    });
    const info = await json(await consoleCall(user, `/device/${started.user_code}`));
    expect(info).toMatchObject({ drives: [], creates_drive: true });
    expect((await approveEmpty(started.user_code)).status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token.new_drive_id).toBeTruthy();
    expect(token.drive_ids).toEqual([token.new_drive_id]);
    const drive = await pool.query('SELECT name FROM drives WHERE id = $1', [token.new_drive_id]);
    expect(drive.rows[0].name).toBe(name);
  });

  it('resolves drive name collisions with (machine), then a counter', async () => {
    const name = `collide-${suffix}`;
    const names: string[] = [];
    await pool.query('DELETE FROM drives WHERE id = $1', [drive]);
    for (let i = 0; i < 3; i += 1) {
      const { token } = await login({ client_name: name, machine: 'box' });
      names.push(
        (await pool.query('SELECT name FROM drives WHERE id = $1', [token.new_drive_id])).rows[0]
          .name,
      );
    }
    expect(names).toEqual([name, `${name} (box)`, `${name} 2`]);
  });

  it('applies the four default scopes and an empty body is accepted', async () => {
    const { token } = await login({ client_name: `defaults-${suffix}` });
    expect(token.scope).toBe('read write delete share');
  });

  it('grants delegate only on explicit choice and keeps it out of the defaults', async () => {
    const chosen = await start({ client_name: `del-${suffix}` }, nextIp());
    expect(
      (await consoleCall(user, `/device/${chosen.user_code}/approve`, 'POST', { delegate: true }))
        .status,
    ).toBe(200);
    await allowPoll(chosen.device_code);
    const first = await json(await poll(chosen.device_code));
    expect(first.scope).toBe('read write delete share delegate');
    expect((await json(await whoami(first.access_token))).scopes).toContain('delegate');
    // delegate is never inherited: every approval needs an explicit tick.
    const held = first.drive_ids[0];
    const reconnect = async (key: string, body: Record<string, unknown>) => {
      const again = await start(
        { client_name: `del-${suffix}`, known_drive_ids: [held] },
        nextIp(),
        key,
      );
      expect(
        (await consoleCall(user, `/device/${again.user_code}/approve`, 'POST', body)).status,
      ).toBe(200);
      await allowPoll(again.device_code);
      return json(await poll(again.device_code));
    };
    const unticked = await reconnect(first.access_token, {});
    expect(unticked.scope).toBe('read write delete share');
    const ticked = await reconnect(unticked.access_token, { delegate: true });
    expect(ticked.scope).toBe('read write delete share delegate');
    const falsy = await reconnect(ticked.access_token, { delegate: false });
    expect(falsy.scope).toBe('read write delete share');
    // Reconnect of a read-only key with delegate ticked: previous scopes plus delegate.
    const ro = await start({ client_name: `ro-${suffix}` }, nextIp());
    await consoleCall(user, `/device/${ro.user_code}/approve`, 'POST', {
      newDriveName: `ro-drive-${suffix}`,
      scopes: ['read'],
    });
    await allowPoll(ro.device_code);
    const roKey = await json(await poll(ro.device_code));
    const back = await start(
      { client_name: `ro-${suffix}`, known_drive_ids: roKey.drive_ids },
      nextIp(),
      roKey.access_token,
    );
    expect(
      (await consoleCall(user, `/device/${back.user_code}/approve`, 'POST', { delegate: true }))
        .status,
    ).toBe(200);
    await allowPoll(back.device_code);
    const backKey = await json(await poll(back.device_code));
    expect(backKey.scope).toBe('read delegate');
    // delegate next to explicit fields is an explicit body and still needs scopes.
    const explicit = await start({ client_name: `ex-${suffix}` }, nextIp());
    const rejected = await consoleCall(user, `/device/${explicit.user_code}/approve`, 'POST', {
      delegate: true,
      driveIds: [drive],
    });
    expect(rejected.status).toBe(400);
    // Wrong types and unknown keys are not defaults.
    const bad = await consoleCall(user, `/device/${explicit.user_code}/approve`, 'POST', {
      delegate: 'yes',
    });
    expect(bad.status).toBe(400);
  });

  it('revokes exactly the proven previous key, not same-label or same-name keys', async () => {
    const name = `repeat-${suffix}`;
    await pool.query('DELETE FROM drives WHERE id = $1', [drive]); // free-plan drive quota
    const first = (await login({ client_name: name, machine: 'a' })).token;
    // Same name and hostname on a second machine, and a manual key with the same label.
    const twin = (await login({ client_name: name, machine: 'a' })).token;
    expect((await whoami(first.access_token)).status).toBe(200);
    const manual = `adk_${randomUUID().replaceAll('-', '')}`;
    await pool.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1,$2,$3,$4,$5::uuid[],ARRAY['read'])`,
      [
        account,
        first.agent_id,
        `${name} on a`,
        createHash('sha256').update(manual).digest('hex'),
        [],
      ],
    );
    const second = (await login({ client_name: name, machine: 'a' }, first.access_token)).token;
    expect((await whoami(first.access_token)).status).toBe(401);
    expect((await whoami(twin.access_token)).status).toBe(200);
    expect((await whoami(manual)).status).toBe(200);
    expect((await whoami(second.access_token)).status).toBe(200);
  });

  it('denies a reconnect whose previous key was revoked after approval', async () => {
    const name = `revoked-${suffix}`;
    const first = (await login({ client_name: name })).token;
    const started = await start(
      { client_name: name, known_drive_ids: first.drive_ids },
      nextIp(),
      first.access_token,
    );
    expect((await approveEmpty(started.user_code)).status).toBe(200);
    const previousId = (
      await pool.query(
        'SELECT previous_api_key_id AS id FROM device_authorizations WHERE user_code=$1',
        [started.user_code],
      )
    ).rows[0].id;
    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [previousId]);
    const before = (
      await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE account_id=$1', [account])
    ).rows[0].n;
    await allowPoll(started.device_code);
    const result = await poll(started.device_code);
    expect(result.status).toBe(400);
    expect(await json(result)).toMatchObject({
      error: 'access_denied',
      error_description: 'The previous key was revoked; run agent-drive login again.',
    });
    const after = (
      await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE account_id=$1', [account])
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('issues only one key when two approved requests cite the same previous key', async () => {
    const name = `twice-${suffix}`;
    await pool.query('DELETE FROM drives WHERE id = $1', [drive]); // free-plan drive quota
    const first = (await login({ client_name: name })).token;
    const extra = { client_name: name, known_drive_ids: first.drive_ids };
    const a = await start(extra, nextIp(), first.access_token);
    const b = await start(extra, nextIp(), first.access_token);
    expect((await approveEmpty(a.user_code)).status).toBe(200);
    expect((await approveEmpty(b.user_code)).status).toBe(200);
    await allowPoll(a.device_code);
    await allowPoll(b.device_code);
    const one = await poll(a.device_code);
    const two = await poll(b.device_code);
    expect(one.status).toBe(200);
    expect(two.status).toBe(400);
    expect((await json(two)).error).toBe('access_denied');
  });

  it('allocates names around drives that are pending deletion', async () => {
    const name = `pending-${suffix}`;
    await pool.query('INSERT INTO drives (account_id,name,deleting_at) VALUES ($1,$2,now())', [
      account,
      name,
    ]);
    const { token } = await login({ client_name: name, machine: 'box' });
    expect(
      (await pool.query('SELECT name FROM drives WHERE id = $1', [token.new_drive_id])).rows[0]
        .name,
    ).toBe(`${name} (box)`);
  });

  it('requires scopes in any non-empty approve body', async () => {
    const started = await start({ client_name: `legacy-${suffix}` });
    const response = await consoleCall(user, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [drive],
    });
    expect(response.status).toBe(400);
  });

  it('validates known_drive_ids', async () => {
    const tooMany = Array.from({ length: 21 }, () => randomUUID());
    for (const bad of [tooMany, ['not-a-uuid'], 'x', [5]]) {
      const response = await oauth('device_authorization', {
        client_name: 'v',
        public_key: publicKey,
        known_drive_ids: bad,
      });
      expect(response.status).toBe(400);
      expect((await json(response)).error).toBe('invalid_request');
    }
    const form = await oauth(
      'device_authorization',
      { client_name: 'v', public_key: publicKey, known_drive_ids: `${drive},${randomUUID()}` },
      nextIp(),
      true,
    );
    expect(form.status).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT requested_drive_ids FROM device_authorizations WHERE user_code=$1',
          [(await json(form)).user_code],
        )
      ).rows[0].requested_drive_ids,
    ).toHaveLength(2);
  });

  it('names the missing scope', async () => {
    const started = await start({ client_name: `ro-${suffix}` });
    await consoleCall(user, `/device/${started.user_code}/approve`, 'POST', {
      driveIds: [drive],
      scopes: ['read'],
    });
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    const response = await handleApiRequest(
      new Request(`${origin}/api/v1/drives/${drive}/put`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.access_token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({
      code: 'permission_denied',
      message: 'The API key lacks the "write" scope.',
    });
  });
});

describe('grant by an existing agent (handoff a)', () => {
  const blob = { epk: 'AAAA', iv: 'BBBB', ct: 'CCCC' };
  type Granter = { user: string; account: string; token: string; keyId: string; drive: string };

  // An approved agent holding all scopes plus delegate on its own new drive.
  async function makeGranter(): Promise<Granter> {
    const user = `device_grant_${randomUUID()}`;
    const account = (await json(await consoleCall(user, '/session'))).account.id as string;
    accountIds.push(account);
    const started = await start({ client_name: `granter-${randomUUID().slice(0, 8)}` });
    expect(
      (await consoleCall(user, `/device/${started.user_code}/approve`, 'POST', { delegate: true }))
        .status,
    ).toBe(200);
    await allowPoll(started.device_code);
    const issued = await json(await poll(started.device_code));
    const who = await json(await agentCall(issued.access_token, '/whoami'));
    return {
      user,
      account,
      token: issued.access_token,
      keyId: who.keyId,
      drive: issued.drive_ids[0],
    };
  }

  function agentCall(token: string, path: string, method = 'GET', body?: unknown) {
    return handleApiRequest(
      new Request(`${origin}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  const offer = (g: Granter, code: string, over: Record<string, unknown> = {}) =>
    agentCall(g.token, `/device/${code}/grant`, 'POST', {
      driveId: g.drive,
      scopes: ['read', 'write'],
      writePaths: ['/inbox/b'],
      sealedDriveKey: blob,
      ...over,
    });
  const page = async (g: Granter, code: string) =>
    json(await consoleCall(g.user, `/device/${code}`));
  const approveWith = (g: Granter, code: string, body: Record<string, unknown>) =>
    consoleCall(g.user, `/device/${code}/approve`, 'POST', body);

  it('shows the request to a delegate key, and refuses others', async () => {
    const g = await makeGranter();
    const started = await start({ client_name: 'newbot', machine: 'box' });
    const read = await agentCall(g.token, `/device/${started.user_code}`);
    expect(read.status).toBe(200);
    expect(await json(read)).toMatchObject({
      user_code: started.user_code,
      client_name: 'newbot',
      machine: 'box',
      public_key: publicKey,
    });
    expect((await agentCall(g.token, '/device/BBBB-CCCC')).status).toBe(404);
    // A key without delegate is refused before it touches the budget.
    const plain = await start({ client_name: `plain-${suffix}` });
    await consoleCall(g.user, `/device/${plain.user_code}/approve`, 'POST', {});
    await allowPoll(plain.device_code);
    const plainKey = (await json(await poll(plain.device_code))).access_token;
    expect((await agentCall(plainKey, `/device/${started.user_code}`)).status).toBe(403);
    expect(
      (await agentCall(plainKey, `/device/${started.user_code}/grant`, 'POST', {})).status,
    ).toBe(403);
    // Expired requests are not found.
    await pool.query('UPDATE device_authorizations SET expires_at = now() WHERE user_code = $1', [
      started.user_code,
    ]);
    expect((await agentCall(g.token, `/device/${started.user_code}`)).status).toBe(404);
  });

  it('records an offer within the granter, replaces it, and applies it on a defaults approval', async () => {
    const g = await makeGranter();
    const started = await start({ client_name: 'newbot', machine: 'box' });
    const first = await offer(g, started.user_code);
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ status: 'offered', revision: 1 });
    expect(await json(await offer(g, started.user_code))).toEqual({
      status: 'offered',
      revision: 2,
    });
    const shown = await page(g, started.user_code);
    expect(shown.offerRevision).toBe(2);
    expect(shown.offer).toMatchObject({
      drive: { id: g.drive },
      scopes: ['read', 'write'],
      writePaths: ['/inbox/b'],
      revision: 2,
    });
    expect(shown.offer.agentName).toMatch(/^granter-/);
    const stored = await pool.query(
      'SELECT sealed_key, api_key_id FROM device_offers WHERE account_id = $1',
      [g.account],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].api_key_id).toBe(g.keyId);

    expect((await approveWith(g, started.user_code, { offerRevision: 2 })).status).toBe(200);
    await allowPoll(started.device_code);
    const token = await json(await poll(started.device_code));
    expect(token).toMatchObject({
      scope: 'read write',
      write_paths: ['/inbox/b'],
      drive_ids: [g.drive],
      new_drive_id: null,
      sealed_drive_keys: { [g.drive]: blob },
    });
  });

  it('refuses offers wider than the granting key and never takes delegate from an offer', async () => {
    const g = await makeGranter();
    const started = await start({ client_name: 'newbot' });
    for (const over of [
      { scopes: ['read', 'delegate'] },
      { scopes: ['manage'] },
      { driveId: otherDriveId },
      { sealedDriveKey: { epk: 'no spaces', iv: 'BBBB', ct: 'CCCC' } },
    ])
      expect((await offer(g, started.user_code, over)).status).toBeGreaterThanOrEqual(400);
    // A key limited to /inbox cannot offer writes elsewhere or without a path.
    const narrow = await start({ client_name: 'narrow' });
    await consoleCall(g.user, `/device/${narrow.user_code}/approve`, 'POST', {
      driveIds: [g.drive],
      scopes: ['read', 'write', 'delegate'],
      writePaths: ['/inbox'],
    });
    await allowPoll(narrow.device_code);
    const narrowKey = (await json(await poll(narrow.device_code))).access_token;
    const target = await start({ client_name: 'target' });
    const withNarrow = (over: Record<string, unknown>) =>
      agentCall(narrowKey, `/device/${target.user_code}/grant`, 'POST', {
        driveId: g.drive,
        scopes: ['read', 'write'],
        writePaths: ['/inbox/x'],
        sealedDriveKey: blob,
        ...over,
      });
    expect((await withNarrow({ writePaths: ['/other'] })).status).toBe(403);
    expect((await withNarrow({ writePaths: [] })).status).toBe(403);
    expect((await withNarrow({})).status).toBe(200);
    // The human's tick adds delegate; the offer alone never does.
    const plain = await start({ client_name: 'plain' });
    await offer(g, plain.user_code);
    expect(
      (await approveWith(g, plain.user_code, { offerRevision: 1, delegate: true })).status,
    ).toBe(200);
    await allowPoll(plain.device_code);
    expect((await json(await poll(plain.device_code))).scope).toBe('read write delegate');
    const noTick = await start({ client_name: 'notick' });
    await offer(g, noTick.user_code);
    await approveWith(g, noTick.user_code, { offerRevision: 1 });
    await allowPoll(noTick.device_code);
    expect((await json(await poll(noTick.device_code))).scope).toBe('read write');
  });

  it('answers 409 when the page was loaded before the offer or an earlier offer', async () => {
    const g = await makeGranter();
    const started = await start({ client_name: 'newbot' });
    // Page loaded with no offer (revision 0), then the grant lands.
    expect((await page(g, started.user_code)).offerRevision).toBe(0);
    await offer(g, started.user_code);
    const stale = await approveWith(g, started.user_code, { offerRevision: 0 });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.message).toBe('The request changed; reload the page.');
    // An approve that sends no revision is also 0. The explicit form is checked the same way.
    expect((await approveWith(g, started.user_code, {})).status).toBe(409);
    expect(
      (
        await approveWith(g, started.user_code, {
          offerRevision: 0,
          driveIds: [g.drive],
          scopes: ['read'],
        })
      ).status,
    ).toBe(409);
    await offer(g, started.user_code, { writePaths: ['/inbox/c'] });
    expect((await approveWith(g, started.user_code, { offerRevision: 1 })).status).toBe(409);
    expect((await approveWith(g, started.user_code, { offerRevision: 2 })).status).toBe(200);
  });

  it('keeps a foreign account offer out of the slot and out of sight', async () => {
    const a = await makeGranter();
    const b = await makeGranter();
    const started = await start({ client_name: 'newbot' });
    expect(await json(await offer(b, started.user_code))).toEqual({
      status: 'offered',
      revision: 1,
    });
    expect((await page(a, started.user_code)).offer).toBeNull();
    expect((await page(a, started.user_code)).offerRevision).toBe(0);
    // A's page, loaded before its own offer, still approves defaults: B's offer does not count.
    expect(await json(await offer(a, started.user_code))).toEqual({
      status: 'offered',
      revision: 1,
    });
    expect((await page(a, started.user_code)).offer).toMatchObject({ drive: { id: a.drive } });
    expect((await approveWith(a, started.user_code, { offerRevision: 1 })).status).toBe(200);
    await allowPoll(started.device_code);
    expect((await json(await poll(started.device_code))).drive_ids).toEqual([a.drive]);
  });

  it('rejects an offer whose key was revoked, at approval and at token exchange', async () => {
    const g = await makeGranter();
    const early = await start({ client_name: 'early' });
    await offer(g, early.user_code);
    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [g.keyId]);
    const refused = await approveWith(g, early.user_code, { offerRevision: 1 });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.message).toBe(
      "The offering agent's key no longer allows this; ask it to grant again, or deny.",
    );
    const h = await makeGranter();
    const late = await start({ client_name: 'late' });
    await offer(h, late.user_code);
    expect((await approveWith(h, late.user_code, { offerRevision: 1 })).status).toBe(200);
    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [h.keyId]);
    await allowPoll(late.device_code);
    const denied = await poll(late.device_code);
    expect(denied.status).toBe(400);
    expect(await json(denied)).toEqual({
      error: 'access_denied',
      error_description: 'The offer was withdrawn; run agent-drive login again.',
    });
    const row = await pool.query(
      'SELECT status, api_key_id FROM device_authorizations WHERE user_code = $1',
      [late.user_code],
    );
    expect(row.rows[0]).toEqual({ status: 'denied', api_key_id: null });
    // Narrowed instead of revoked: the key no longer holds what it offered.
    const k = await makeGranter();
    const narrowed = await start({ client_name: 'narrowed' });
    await offer(k, narrowed.user_code);
    await pool.query("UPDATE api_keys SET scopes = ARRAY['read','write'] WHERE id = $1", [k.keyId]);
    expect((await approveWith(k, narrowed.user_code, { offerRevision: 1 })).status).toBe(409);
  });

  for (const route of ['GET', 'POST'] as const) {
    it(`shares the console attempt budget on ${route} (10 not_found, then 30 attempts)`, async () => {
      const call = (g: Granter, code: string) =>
        route === 'GET' ? agentCall(g.token, `/device/${code}`) : offer(g, code);
      const g = await makeGranter();
      const started = await start({ client_name: 'newbot' });
      for (let i = 0; i < 10; i += 1) expect((await call(g, 'BBBB-CCCC')).status).toBe(404);
      const limited = await call(g, started.user_code);
      expect(limited.status).toBe(429);
      expect((await json(limited)).error.code).toBe('rate_limited');
      // The other route is refused too: one budget per account.
      const other =
        route === 'GET'
          ? offer(g, started.user_code)
          : agentCall(g.token, `/device/${started.user_code}`);
      expect((await other).status).toBe(429);

      const h = await makeGranter();
      const second = await start({ client_name: 'newbot' });
      // makeGranter's console approve already used one of the 30 attempts.
      for (let i = 0; i < 29; i += 1) expect((await call(h, second.user_code)).status).toBe(200);
      expect((await call(h, second.user_code)).status).toBe(429);
    });
  }
});

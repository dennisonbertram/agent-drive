import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
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
// A real P-256 public point (uncompressed, 65 bytes): the API rejects off-curve values.
const point = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return b64(ecdh.getPublicKey());
};
const wrapped = (n = 48) => b64(Buffer.concat([Buffer.from([1]), randomBytes(12 + 16 + n)]));
const kdf = (iterations = 600000) => ({
  name: 'PBKDF2-SHA256',
  iterations,
  salt: b64(randomBytes(16)),
});
const createBody = () => ({
  id: randomUUID(),
  publicKey: point(),
  wrappedPrivateKey: wrapped(),
  kdf: kdf(),
});
// The wrap is opaque to the server: credential id, AES-GCM iv and wrapped PKCS8, base64url.
const passkey = (overrides: Record<string, unknown> = {}) =>
  ({
    credentialId: b64(randomBytes(32)),
    iv: b64(randomBytes(12)),
    ciphertext: b64(randomBytes(138)),
    ...overrides,
  }) as { credentialId: string; iv: string; ciphertext: string };
const enrollBody = (keyId: string, generation = 1, wrap = passkey()) => ({
  expectedKeyId: keyId,
  expectedGeneration: generation,
  passkey: wrap,
});

async function call(
  userId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  reverified = true,
  origin: string | null = root,
) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (method !== 'GET' && origin !== null) headers.set('origin', origin);
  return handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    userId,
    reverified,
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function fixture(drives = 1) {
  const userId = `user_${randomUUID()}`;
  const account = await pool.query(
    'INSERT INTO accounts (name, external_clerk_user_id) VALUES ($1, $2) RETURNING id',
    [`vault-${randomUUID()}`, userId],
  );
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  userIds.push(userId);
  await pool.query("INSERT INTO agents (account_id, name) VALUES ($1, '__console__')", [accountId]);
  const driveIds: string[] = [];
  for (let i = 0; i < drives; i += 1) {
    const drive = await pool.query(
      'INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id',
      [accountId, `drive-${randomUUID()}`],
    );
    driveIds.push(drive.rows[0].id);
  }
  return { userId, accountId, driveIds };
}

async function setup(f: { userId: string }) {
  const body = createBody();
  const res = await call(f.userId, 'account-key', 'POST', body);
  expect(res.status).toBe(201);
  return body;
}

const storedWrap = async (accountId: string) =>
  (await pool.query('SELECT passkey_wrap FROM account_keys WHERE account_id = $1', [accountId]))
    .rows[0]?.passkey_wrap as unknown;

/**
 * Holds a row lock inside a transaction on its own connection, so a request must pause inside the
 * vault transaction (after authentication) on exactly that lock. Waiting is keyed on this
 * connection's backend pid, never on "any blocked backend".
 */
async function held(
  lockSql: string,
  params: unknown[],
  work: (client: PoolClient) => Promise<void>,
) {
  const client = await pool.connect();
  await client.query('BEGIN');
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  await client.query(lockSql, params);
  return {
    client,
    /** depth 1: n backends wait on the holder; depth 2: n backends wait on those waiters. */
    async waitForBlocked(n = 1, depth = 1) {
      const direct = 'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))';
      const sql =
        depth === 1
          ? `SELECT count(*)::int AS n FROM (${direct}) w`
          : `SELECT count(*)::int AS n FROM pg_stat_activity a
              WHERE pg_blocking_pids(a.pid) && ARRAY(${direct})`;
      for (let i = 0; i < 200; i += 1) {
        const r = await pool.query(sql, [pid]);
        if (r.rows[0].n >= n) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      await client.query('ROLLBACK');
      client.release();
      throw new Error('The request never blocked on the held lock.');
    },
    async finish() {
      try {
        await work(client);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const keyLock = 'SELECT id FROM account_keys WHERE account_id = $1 FOR UPDATE';
const noop = async () => undefined;

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM deletion_jobs WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
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

describe('account key passkey: enrollment', () => {
  it('reads null before enrolling, enrolls once, and returns the wrap on every read', async () => {
    const f = await fixture();
    const body = await setup(f);
    const before = await json(await call(f.userId, 'account-key'));
    expect(before.accountKey.passkey).toBeNull();

    const wrap = passkey();
    const res = await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, wrap));
    expect(res.status).toBe(200);
    const record = (await json(res)).accountKey;
    expect(record.passkey).toEqual(wrap);
    expect(record).toMatchObject({
      id: body.id,
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
      wrapGeneration: 1,
      kdf: body.kdf,
    });
    const read = await json(await call(f.userId, 'account-key'));
    expect(read.accountKey.passkey).toEqual(wrap);
    expect(await storedWrap(f.accountId)).toEqual(wrap);
  });

  it('accepts boundary sizes: credential id 1..1023 bytes, ciphertext 48..272 bytes', async () => {
    const f = await fixture();
    const body = await setup(f);
    const valid = [
      passkey({ credentialId: b64(randomBytes(1)) }),
      passkey({ credentialId: b64(randomBytes(1023)), ciphertext: b64(randomBytes(272)) }),
      passkey({ ciphertext: b64(randomBytes(48)) }),
    ];
    for (const wrap of valid) {
      const res = await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, wrap));
      expect(res.status, JSON.stringify(wrap).slice(0, 60)).toBe(200);
      expect((await json(res)).accountKey.passkey).toEqual(wrap);
      // Free the slot for the next boundary wrap; this simulates nothing a client can do.
      await pool.query('UPDATE account_keys SET passkey_wrap = NULL WHERE account_id = $1', [
        f.accountId,
      ]);
    }
  });

  it('rejects malformed bodies and passkey shapes with 400 and stores nothing', async () => {
    const f = await fixture();
    const body = await setup(f);
    const good = enrollBody(body.id);
    const wrap = passkey();
    const bad: Record<string, unknown>[] = [
      { ...good, extra: 1 },
      { expectedKeyId: body.id, expectedGeneration: 1 },
      { ...good, expectedKeyId: 'x' },
      { ...good, expectedGeneration: 0 },
      { ...good, expectedGeneration: 1.5 },
      { ...good, expectedGeneration: '1' },
      { ...good, passkey: 'x' },
      { ...good, passkey: [wrap] },
      { ...good, passkey: { ...wrap, extra: 1 } },
      { ...good, passkey: { iv: wrap.iv, ciphertext: wrap.ciphertext } },
      { ...good, passkey: { credentialId: wrap.credentialId, ciphertext: wrap.ciphertext } },
      { ...good, passkey: { credentialId: wrap.credentialId, iv: wrap.iv } },
      { ...good, passkey: { ...wrap, credentialId: 42 } },
      { ...good, passkey: { ...wrap, credentialId: '' } },
      { ...good, passkey: { ...wrap, credentialId: `${wrap.credentialId}=` } },
      // 'AB' decodes to one byte but re-encodes to 'AA': non-canonical base64url.
      { ...good, passkey: { ...wrap, credentialId: 'AB' } },
      { ...good, passkey: { ...wrap, credentialId: `${wrap.credentialId}+` } },
      { ...good, passkey: { ...wrap, credentialId: b64(randomBytes(1024)) } },
      { ...good, passkey: { ...wrap, iv: b64(randomBytes(11)) } },
      { ...good, passkey: { ...wrap, iv: b64(randomBytes(13)) } },
      { ...good, passkey: { ...wrap, iv: `${wrap.iv}=` } },
      { ...good, passkey: { ...wrap, ciphertext: b64(randomBytes(47)) } },
      { ...good, passkey: { ...wrap, ciphertext: b64(randomBytes(273)) } },
      { ...good, passkey: { ...wrap, ciphertext: `${wrap.ciphertext}=` } },
      { ...good, passkey: { ...wrap, ciphertext: `+${(wrap.ciphertext as string).slice(1)}` } },
    ];
    for (const b of bad) {
      const res = await call(f.userId, 'account-key/passkey', 'POST', b);
      expect(res.status, JSON.stringify(b).slice(0, 90)).toBe(400);
    }
    expect(await storedWrap(f.accountId)).toBeNull();
  });

  it('returns the exact Clerk strict reverification response and stores nothing', async () => {
    const f = await fixture();
    const body = await setup(f);
    const expected = reverificationErrorResponse('strict');
    const res = await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id), false);
    expect(res.status).toBe(expected.status);
    expect(await res.text()).toBe(await expected.text());
    expect(await storedWrap(f.accountId)).toBeNull();
  });

  it('requires a same-origin request', async () => {
    const f = await fixture();
    const body = await setup(f);
    for (const origin of [null, 'https://attacker.test']) {
      const res = await call(
        f.userId,
        'account-key/passkey',
        'POST',
        enrollBody(body.id),
        true,
        origin,
      );
      expect(res.status).toBe(403);
    }
    expect(await storedWrap(f.accountId)).toBeNull();
  });

  it('404s when no key exists and 409s on stale key id or generation', async () => {
    const f = await fixture();
    const missing = await call(f.userId, 'account-key/passkey', 'POST', {
      expectedKeyId: randomUUID(),
      expectedGeneration: 1,
      passkey: passkey(),
    });
    expect(missing.status).toBe(404);

    const body = await setup(f);
    const wrongKey = await call(
      f.userId,
      'account-key/passkey',
      'POST',
      enrollBody(randomUUID(), 1),
    );
    expect(wrongKey.status).toBe(409);
    const wrongGeneration = await call(
      f.userId,
      'account-key/passkey',
      'POST',
      enrollBody(body.id, 2),
    );
    expect(wrongGeneration.status).toBe(409);
    expect(await storedWrap(f.accountId)).toBeNull();
  });

  it('refuses a second enrollment and keeps the first wrap: no silent replacement', async () => {
    const f = await fixture();
    const body = await setup(f);
    const first = passkey();
    expect(
      (await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, first))).status,
    ).toBe(200);
    const second = passkey();
    const res = await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, second));
    expect(res.status).toBe(409);
    expect(await storedWrap(f.accountId)).toEqual(first);
    const read = await json(await call(f.userId, 'account-key'));
    expect(read.accountKey.passkey).toEqual(first);
  });

  it('a passphrase change preserves the wrap; a reset drops it with the old record', async () => {
    const f = await fixture();
    const body = await setup(f);
    const wrap = passkey();
    expect(
      (await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, wrap))).status,
    ).toBe(200);
    const next = { wrappedPrivateKey: wrapped(60), kdf: kdf(700000) };
    const patched = await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 1,
      ...next,
    });
    expect(patched.status).toBe(200);
    const changed = (await json(patched)).accountKey;
    expect(changed.wrapGeneration).toBe(2);
    expect(changed.passkey).toEqual(wrap);
    // Still enrolled at the new generation: enrolling again is a lockout, not a replacement.
    const again = await call(
      f.userId,
      'account-key/passkey',
      'POST',
      enrollBody(body.id, 2, passkey()),
    );
    expect(again.status).toBe(409);
    expect((await json(await call(f.userId, 'account-key'))).accountKey.passkey).toEqual(wrap);

    const reset = await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: body.id,
      confirmation: 'RESET',
    });
    expect(reset.status).toBe(200);
    const fresh = createBody();
    expect((await call(f.userId, 'account-key', 'POST', fresh)).status).toBe(201);
    const reread = await json(await call(f.userId, 'account-key'));
    expect(reread.accountKey.id).toBe(fresh.id);
    expect(reread.accountKey.passkey).toBeNull();
    // The new record can enroll its own passkey.
    expect(
      (await call(f.userId, 'account-key/passkey', 'POST', enrollBody(fresh.id, 1, passkey())))
        .status,
    ).toBe(200);
  });

  it('keeps wraps tenant-separated: another owner never sees or inherits it', async () => {
    const a = await fixture();
    const b = await fixture();
    const keyA = await setup(a);
    const keyB = await setup(b);
    const wrapA = passkey();
    expect(
      (await call(a.userId, 'account-key/passkey', 'POST', enrollBody(keyA.id, 1, wrapA))).status,
    ).toBe(200);

    const readB = await json(await call(b.userId, 'account-key'));
    expect(readB.accountKey.id).toBe(keyB.id);
    expect(readB.accountKey.passkey).toBeNull();
    expect(await storedWrap(b.accountId)).toBeNull();
    // B cannot enroll by naming A's key id; B's own id works and the two wraps stay distinct.
    expect(
      (await call(b.userId, 'account-key/passkey', 'POST', enrollBody(keyA.id, 1, passkey())))
        .status,
    ).toBe(409);
    const wrapB = passkey();
    expect(
      (await call(b.userId, 'account-key/passkey', 'POST', enrollBody(keyB.id, 1, wrapB))).status,
    ).toBe(200);
    expect((await json(await call(a.userId, 'account-key'))).accountKey.passkey).toEqual(wrapA);
    expect((await json(await call(b.userId, 'account-key'))).accountKey.passkey).toEqual(wrapB);
    const rows = await pool.query(
      'SELECT account_id, passkey_wrap FROM account_keys WHERE account_id = ANY($1::uuid[])',
      [[a.accountId, b.accountId]],
    );
    for (const row of rows.rows)
      expect(row.passkey_wrap).toEqual(row.account_id === a.accountId ? wrapA : wrapB);
  });

  it('never exposes the wrap through the bearer account-key response', async () => {
    const f = await fixture();
    const body = await setup(f);
    const wrap = passkey();
    expect(
      (await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, wrap))).status,
    ).toBe(200);
    const agent = await pool.query(
      "SELECT id FROM agents WHERE account_id = $1 AND name = '__console__'",
      [f.accountId],
    );
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await pool.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, scopes)
       VALUES ($1, $2, 'passkey-bearer-check', $3, '{read}')`,
      [f.accountId, agent.rows[0].id, createHash('sha256').update(token).digest('hex')],
    );
    const res = await handleApiRequest(
      new Request('http://api.test/api/v1/account-key', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const bearerKey = JSON.parse(text) as Record<string, unknown>;
    expect(bearerKey).toMatchObject({ keyId: body.id, publicKey: body.publicKey, format: 1 });
    expect('passkey' in bearerKey).toBe(false);
    expect(text).not.toContain('passkey');
    expect(text).not.toContain(wrap.credentialId as string);
    expect(text).not.toContain(wrap.ciphertext as string);
    // A bearer key can never reach the enrollment route at all.
    const write = await handleApiRequest(
      new Request('http://api.test/api/v1/account-key/passkey', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(enrollBody(body.id)),
      }),
    );
    expect(write.status).toBe(404);
    expect(await storedWrap(f.accountId)).toEqual(wrap);
  });

  it('two concurrent enrollments: exactly one succeeds', async () => {
    const f = await fixture();
    const body = await setup(f);
    const hold = await held(keyLock, [f.accountId], noop);
    const enroll = () =>
      call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, passkey()));
    const both = Promise.all([enroll(), enroll()]);
    await hold.waitForBlocked(1, 1);
    await hold.waitForBlocked(1, 2);
    await hold.finish();
    expect((await both).map((r) => r.status).sort()).toEqual([200, 409]);
    const wrap = await storedWrap(f.accountId);
    expect(wrap).not.toBeNull();
  });
});

describe('account key passkey: audit', () => {
  it('records the action and never the wrap material', async () => {
    const f = await fixture();
    const body = await setup(f);
    const wrap = passkey();
    expect(
      (await call(f.userId, 'account-key/passkey', 'POST', enrollBody(body.id, 1, wrap))).status,
    ).toBe(200);
    const rows = await pool.query(
      'SELECT * FROM audit_events WHERE account_id = $1 AND action LIKE $2',
      [f.accountId, '%account_key%'],
    );
    expect(rows.rows.map((r) => r.action)).toContain('console.account_key.passkey');
    const text = JSON.stringify(rows.rows);
    for (const secret of [wrap.credentialId, wrap.iv, wrap.ciphertext])
      expect(text).not.toContain(secret);
  });
});

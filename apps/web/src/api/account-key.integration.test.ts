import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
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

const b64 = (bytes: Buffer) => bytes.toString('base64url');
const point = () => b64(Buffer.concat([Buffer.from([4]), randomBytes(64)]));
const wrapped = (n = 48) => b64(Buffer.concat([Buffer.from([1]), randomBytes(12 + 16 + n)]));
const kdf = (iterations = 600000) => ({
  name: 'PBKDF2-SHA256',
  iterations,
  salt: b64(randomBytes(16)),
});
const sealed = () => ({
  epk: point(),
  iv: b64(randomBytes(12)),
  ct: b64(randomBytes(59)),
});
const createBody = () => ({
  id: randomUUID(),
  publicKey: point(),
  wrappedPrivateKey: wrapped(),
  kdf: kdf(),
});

async function call(
  userId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  reverified = true,
) {
  return handleConsoleApiRequest(
    new Request(`${root}/api/console/${path}`, {
      method,
      headers: {
        origin: root,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
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

/** Hold a transaction's lock so a request started now must wait; waits until it does. */
async function held(accountId: string, work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  return {
    client,
    async waitForBlocked() {
      for (let i = 0; i < 100; i += 1) {
        const r = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        if (r.rows[0].n > 0) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
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

describe('account key: reverification', () => {
  it('returns exactly the Clerk strict reverification response when not reverified', async () => {
    const f = await fixture();
    const expected = reverificationErrorResponse('strict');
    const expectedBody = await expected.text();
    const create = createBody();
    const cases: [string, string, unknown][] = [
      ['account-key', 'POST', create],
      [
        'account-key',
        'PATCH',
        {
          expectedKeyId: randomUUID(),
          expectedGeneration: 1,
          wrappedPrivateKey: wrapped(),
          kdf: kdf(),
        },
      ],
      ['account-key', 'DELETE', { expectedKeyId: randomUUID(), confirmation: 'RESET' }],
      ['account', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' }],
    ];
    for (const [path, method, body] of cases) {
      const res = await call(f.userId, path, method, body, false);
      expect(res.status, `${method} ${path}`).toBe(expected.status);
      expect(await res.text(), `${method} ${path}`).toBe(expectedBody);
    }
    const rows = await pool.query('SELECT 1 FROM account_keys WHERE account_id = $1', [
      f.accountId,
    ]);
    expect(rows.rowCount).toBe(0);
    const account = await pool.query('SELECT deleting_at FROM accounts WHERE id = $1', [
      f.accountId,
    ]);
    expect(account.rows[0].deleting_at).toBeNull();
  });

  it('allows the same calls when reverified, and reads and slots need no reverification', async () => {
    const f = await fixture();
    const body = await setup(f);
    const read = await call(f.userId, 'account-key', 'GET', undefined, false);
    expect(read.status).toBe(200);
    expect((await json(read)).accountKey.id).toBe(body.id);
    const slots = await call(f.userId, 'account-key/slots', 'GET', undefined, false);
    expect(slots.status).toBe(200);
    const put = await call(
      f.userId,
      `drives/${f.driveIds[0]}/account-key`,
      'POST',
      { keyId: body.id, expectedRevision: null, sealed: sealed() },
      false,
    );
    expect(put.status).toBe(200);
  });
});

describe('account key: record routes', () => {
  it('reads null, creates, reads back, rejects a second create', async () => {
    const f = await fixture();
    const empty = await call(f.userId, 'account-key');
    expect(await json(empty)).toEqual({ accountKey: null });
    const body = await setup(f);
    const read = await json(await call(f.userId, 'account-key'));
    expect(read.accountKey).toMatchObject({
      id: body.id,
      accountId: f.accountId,
      format: 1,
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
      wrapGeneration: 1,
      kdf: body.kdf,
    });
    const again = await call(f.userId, 'account-key', 'POST', createBody());
    expect(again.status).toBe(409);
    const still = await json(await call(f.userId, 'account-key'));
    expect(still.accountKey.id).toBe(body.id);
  });

  it('rejects malformed create bodies with 400', async () => {
    const f = await fixture();
    const good = createBody();
    const bad: Record<string, unknown>[] = [
      { ...good, extra: 1 },
      { ...good, id: 'not-a-uuid' },
      { ...good, publicKey: b64(randomBytes(65)).replace(/^./, 'A') },
      { ...good, publicKey: b64(Buffer.concat([Buffer.from([4]), randomBytes(63)])) },
      { ...good, publicKey: `${good.publicKey}=` },
      { ...good, wrappedPrivateKey: b64(Buffer.concat([Buffer.from([2]), randomBytes(76)])) },
      { ...good, wrappedPrivateKey: wrapped(31) },
      { ...good, wrappedPrivateKey: wrapped(257) },
      { ...good, wrappedPrivateKey: b64(Buffer.from([1])) },
      { ...good, kdf: kdf(599999) },
      { ...good, kdf: kdf(2000001) },
      { ...good, kdf: { ...kdf(), iterations: 600000.5 } },
      { ...good, kdf: { ...kdf(), name: 'PBKDF2-SHA512' } },
      { ...good, kdf: { ...kdf(), salt: b64(randomBytes(15)) } },
      { ...good, kdf: { ...kdf(), extra: true } },
      { id: good.id },
    ];
    for (const body of bad) {
      const res = await call(f.userId, 'account-key', 'POST', body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await json(await call(f.userId, 'account-key'))).accountKey).toBeNull();
  });

  it('PATCH bumps the generation, keeps the public key, and 409s on stale expectations', async () => {
    const f = await fixture();
    const body = await setup(f);
    const next = { wrappedPrivateKey: wrapped(60), kdf: kdf(700000) };
    const stale = await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 2,
      ...next,
    });
    expect(stale.status).toBe(409);
    const wrongKey = await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: randomUUID(),
      expectedGeneration: 1,
      ...next,
    });
    expect(wrongKey.status).toBe(409);
    const ok = await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 1,
      ...next,
    });
    expect(ok.status).toBe(200);
    const record = (await json(ok)).accountKey;
    expect(record).toMatchObject({
      id: body.id,
      publicKey: body.publicKey,
      wrapGeneration: 2,
      wrappedPrivateKey: next.wrappedPrivateKey,
      kdf: next.kdf,
    });
    const unknown = await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 2,
      publicKey: point(),
      ...next,
    });
    expect(unknown.status).toBe(400);
    const none = await fixture();
    const missing = await call(none.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 1,
      ...next,
    });
    expect(missing.status).toBe(404);
  });

  it('DELETE resets: stale id 409, no key 404, otherwise deletes the key and all slots', async () => {
    const f = await fixture(2);
    const none = await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: randomUUID(),
      confirmation: 'RESET',
    });
    expect(none.status).toBe(404);
    const body = await setup(f);
    for (const driveId of f.driveIds)
      await call(f.userId, `drives/${driveId}/account-key`, 'POST', {
        keyId: body.id,
        expectedRevision: null,
        sealed: sealed(),
      });
    const stale = await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: randomUUID(),
      confirmation: 'RESET',
    });
    expect(stale.status).toBe(409);
    const noConfirm = await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: body.id,
      confirmation: 'reset',
    });
    expect(noConfirm.status).toBe(400);
    await pool.query(
      "UPDATE drives SET key_backup_at = now(), key_backup_method = 'file' WHERE id = $1",
      [f.driveIds[0]],
    );
    const ok = await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: body.id,
      confirmation: 'RESET',
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ deletedSlots: 2 });
    expect(
      (await pool.query('SELECT 1 FROM account_key_slots WHERE account_id = $1', [f.accountId]))
        .rowCount,
    ).toBe(0);
    const drive = await pool.query(
      'SELECT key_backup_at, key_backup_method FROM drives WHERE id = $1',
      [f.driveIds[0]],
    );
    expect(drive.rows[0].key_backup_method).toBe('file');
    expect(drive.rows[0].key_backup_at).not.toBeNull();
    const second = await call(f.userId, 'account-key', 'POST', createBody());
    expect(second.status).toBe(201);
  });
});

describe('account key: slot routes', () => {
  it('creates, replaces by revision, lists, deletes, and never touches key_backup_*', async () => {
    const f = await fixture(3);
    const body = await setup(f);
    const [d0, d1, d2] = f.driveIds as [string, string, string];
    const path = (d: string) => `drives/${d}/account-key`;
    const s1 = sealed();
    const created = await call(f.userId, path(d0), 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: s1,
    });
    expect(created.status).toBe(200);
    expect(await json(created)).toEqual({ revision: 1 });
    expect(
      (
        await call(f.userId, path(d0), 'POST', {
          keyId: body.id,
          expectedRevision: null,
          sealed: sealed(),
        })
      ).status,
    ).toBe(409);
    const s2 = sealed();
    expect(
      (await call(f.userId, path(d0), 'POST', { keyId: body.id, expectedRevision: 5, sealed: s2 }))
        .status,
    ).toBe(409);
    const replaced = await call(f.userId, path(d0), 'POST', {
      keyId: body.id,
      expectedRevision: 1,
      sealed: s2,
    });
    expect(await json(replaced)).toEqual({ revision: 2 });
    expect(
      (await call(f.userId, path(d1), 'POST', { keyId: body.id, expectedRevision: 1, sealed: s2 }))
        .status,
    ).toBe(409);
    await call(f.userId, path(d1), 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    await call(f.userId, path(d2), 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: sealed(),
    });

    const list = await json(await call(f.userId, 'account-key/slots'));
    expect(list.items).toHaveLength(3);
    const first = list.items.find((i: { driveId: string }) => i.driveId === d0);
    expect(first).toEqual({ driveId: d0, keyId: body.id, format: 1, sealed: s2, revision: 2 });
    const paged = await json(await call(f.userId, 'account-key/slots?limit=2'));
    expect(paged.items).toHaveLength(2);
    expect(paged.nextCursor).toBeTruthy();
    const rest = await json(
      await call(
        f.userId,
        `account-key/slots?limit=2&cursor=${encodeURIComponent(paged.nextCursor)}`,
      ),
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();

    expect(
      (await call(f.userId, path(d0), 'DELETE', { keyId: body.id, expectedRevision: 1 })).status,
    ).toBe(409);
    expect(
      (await call(f.userId, path(d0), 'DELETE', { keyId: randomUUID(), expectedRevision: 2 }))
        .status,
    ).toBe(409);
    expect(
      (await call(f.userId, path(d0), 'DELETE', { keyId: body.id, expectedRevision: 2 })).status,
    ).toBe(200);
    expect(
      (await call(f.userId, path(d0), 'DELETE', { keyId: body.id, expectedRevision: 2 })).status,
    ).toBe(404);
    const drives = await pool.query(
      'SELECT key_backup_at, key_backup_method FROM drives WHERE id = ANY($1::uuid[])',
      [f.driveIds],
    );
    for (const row of drives.rows) {
      expect(row.key_backup_at).toBeNull();
      expect(row.key_backup_method).toBeNull();
    }
  });

  it('rejects a stale key id, missing key, foreign or deleting drives, and bad bodies', async () => {
    const f = await fixture(2);
    const other = await fixture(1);
    const path = (d: string) => `drives/${d}/account-key`;
    const put = { keyId: randomUUID(), expectedRevision: null, sealed: sealed() };
    expect((await call(f.userId, path(f.driveIds[0]!), 'POST', put)).status).toBe(409);
    const body = await setup(f);
    expect((await call(f.userId, path(f.driveIds[0]!), 'POST', put)).status, 'stale key id').toBe(
      409,
    );
    const good = { keyId: body.id, expectedRevision: null, sealed: sealed() };
    expect((await call(f.userId, path(other.driveIds[0]!), 'POST', good)).status).toBe(404);
    expect((await call(f.userId, path(randomUUID()), 'POST', good)).status).toBe(404);
    await pool.query('UPDATE drives SET deleting_at = now() WHERE id = $1', [f.driveIds[1]]);
    expect((await call(f.userId, path(f.driveIds[1]!), 'POST', good)).status).toBe(404);
    const live = path(f.driveIds[0]!);
    const s = sealed();
    const bad: Record<string, unknown>[] = [
      { ...good, extra: 1 },
      { ...good, keyId: 'x' },
      { ...good, expectedRevision: 0 },
      { ...good, expectedRevision: 1.5 },
      { ...good, expectedRevision: '1' },
      { keyId: good.keyId, sealed: s },
      { ...good, sealed: { ...s, extra: 'x' } },
      { ...good, sealed: { epk: s.epk, iv: s.iv } },
      { ...good, sealed: { ...s, epk: b64(randomBytes(65)).replace(/^./, 'A') } },
      { ...good, sealed: { ...s, epk: b64(Buffer.concat([Buffer.from([4]), randomBytes(63)])) } },
      { ...good, sealed: { ...s, iv: b64(randomBytes(13)) } },
      { ...good, sealed: { ...s, ct: b64(randomBytes(58)) } },
      { ...good, sealed: { ...s, ct: `${s.ct}=` } },
      { ...good, sealed: 'x' },
    ];
    for (const b of bad) {
      expect((await call(f.userId, live, 'POST', b)).status, JSON.stringify(b).slice(0, 90)).toBe(
        400,
      );
    }
    expect(
      (await call(f.userId, live, 'DELETE', { keyId: body.id, expectedRevision: 1, extra: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await pool.query('SELECT 1 FROM account_key_slots WHERE account_id = $1', [f.accountId]))
        .rowCount,
    ).toBe(0);
  });

  it('the database rejects a slot whose account key belongs to another account', async () => {
    const a = await fixture(1);
    const b = await fixture(1);
    const keyB = await setup(b);
    await expect(
      pool.query(
        `INSERT INTO account_key_slots (drive_id, account_id, account_key_id, format, sealed)
         VALUES ($1, $2, $3, 1, $4::jsonb)`,
        [a.driveIds[0], a.accountId, keyB.id, JSON.stringify(sealed())],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await setup(a);
    const keyA = (
      await pool.query('SELECT id FROM account_keys WHERE account_id = $1', [a.accountId])
    ).rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO account_key_slots (drive_id, account_id, account_key_id, format, sealed)
         VALUES ($1, $2, $3, 1, $4::jsonb)`,
        [b.driveIds[0], a.accountId, keyA, JSON.stringify(sealed())],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('account key: deletion hooks', () => {
  it('drive deletion removes its slot and leaves the others', async () => {
    const f = await fixture(2);
    const body = await setup(f);
    for (const d of f.driveIds)
      await call(f.userId, `drives/${d}/account-key`, 'POST', {
        keyId: body.id,
        expectedRevision: null,
        sealed: sealed(),
      });
    const name = (await pool.query('SELECT name FROM drives WHERE id = $1', [f.driveIds[0]]))
      .rows[0].name;
    const res = await call(f.userId, `drives/${f.driveIds[0]}`, 'DELETE', { confirmation: name });
    expect(res.status).toBe(202);
    const left = await pool.query('SELECT drive_id FROM account_key_slots WHERE account_id = $1', [
      f.accountId,
    ]);
    expect(left.rows.map((r) => r.drive_id)).toEqual([f.driveIds[1]]);
  });

  it('account deletion removes the key and its slots', async () => {
    const f = await fixture(1);
    const body = await setup(f);
    await call(f.userId, `drives/${f.driveIds[0]}/account-key`, 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    const res = await call(f.userId, 'account', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(202);
    for (const table of ['account_keys', 'account_key_slots'])
      expect(
        (await pool.query(`SELECT 1 FROM ${table} WHERE account_id = $1`, [f.accountId])).rowCount,
        table,
      ).toBe(0);
  });
});

describe('account key: races (two connections)', () => {
  it('two concurrent PATCHes: exactly one succeeds', async () => {
    const f = await fixture();
    const body = await setup(f);
    const hold = await held(f.accountId, async () => undefined);
    const patch = () =>
      call(f.userId, 'account-key', 'PATCH', {
        expectedKeyId: body.id,
        expectedGeneration: 1,
        wrappedPrivateKey: wrapped(),
        kdf: kdf(),
      });
    const both = Promise.all([patch(), patch()]);
    await hold.waitForBlocked();
    await hold.finish();
    const statuses = (await both).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const row = await pool.query('SELECT wrap_generation FROM account_keys WHERE account_id = $1', [
      f.accountId,
    ]);
    expect(row.rows[0].wrap_generation).toBe(2);
  });

  it('a delayed reset after another tab reset and recreated: 409 and the new key survives', async () => {
    const f = await fixture(1);
    const old = await setup(f);
    const fresh = createBody();
    const hold = await held(f.accountId, async (client) => {
      await client.query('DELETE FROM account_keys WHERE account_id = $1', [f.accountId]);
      await client.query(
        `INSERT INTO account_keys (id, account_id, format, public_key, wrapped_private_key, kdf_name, kdf_iterations, kdf_salt)
         VALUES ($1, $2, 1, $3, $4, 'PBKDF2-SHA256', 600000, $5)`,
        [fresh.id, f.accountId, fresh.publicKey, fresh.wrappedPrivateKey, fresh.kdf.salt],
      );
    });
    const delayed = call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: old.id,
      confirmation: 'RESET',
    });
    await hold.waitForBlocked();
    await hold.finish();
    expect((await delayed).status).toBe(409);
    const row = await pool.query('SELECT id FROM account_keys WHERE account_id = $1', [
      f.accountId,
    ]);
    expect(row.rows.map((r) => r.id)).toEqual([fresh.id]);
  });

  it('a slot delete after a replacement: 409 and the replacement survives', async () => {
    const f = await fixture(1);
    const body = await setup(f);
    const path = `drives/${f.driveIds[0]}/account-key`;
    await call(f.userId, path, 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    const replacement = sealed();
    const hold = await held(f.accountId, async (client) => {
      await client.query(
        'UPDATE account_key_slots SET sealed = $2::jsonb, revision = revision + 1 WHERE drive_id = $1',
        [f.driveIds[0], JSON.stringify(replacement)],
      );
    });
    const del = call(f.userId, path, 'DELETE', { keyId: body.id, expectedRevision: 1 });
    await hold.waitForBlocked();
    await hold.finish();
    expect((await del).status).toBe(409);
    const row = await pool.query(
      'SELECT revision, sealed FROM account_key_slots WHERE drive_id = $1',
      [f.driveIds[0]],
    );
    expect(row.rows[0].revision).toBe(2);
    expect(row.rows[0].sealed).toEqual(replacement);
  });

  it('a slot insert against drive deletion leaves no slot, in either order', async () => {
    // Deletion commits first while the slot write waits.
    const a = await fixture(1);
    const keyA = await setup(a);
    const hold = await held(a.accountId, async (client) => {
      await client.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [a.driveIds[0]]);
      await client.query('UPDATE drives SET deleting_at = now() WHERE id = $1', [a.driveIds[0]]);
      await client.query('DELETE FROM account_key_slots WHERE drive_id = $1', [a.driveIds[0]]);
    });
    const put = call(a.userId, `drives/${a.driveIds[0]}/account-key`, 'POST', {
      keyId: keyA.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    await hold.waitForBlocked();
    await hold.finish();
    expect((await put).status).toBe(404);
    expect(
      (await pool.query('SELECT 1 FROM account_key_slots WHERE account_id = $1', [a.accountId]))
        .rowCount,
    ).toBe(0);

    // The slot write commits first, then the real deletion removes it.
    const b = await fixture(1);
    const keyB = await setup(b);
    expect(
      (
        await call(b.userId, `drives/${b.driveIds[0]}/account-key`, 'POST', {
          keyId: keyB.id,
          expectedRevision: null,
          sealed: sealed(),
        })
      ).status,
    ).toBe(200);
    const name = (await pool.query('SELECT name FROM drives WHERE id = $1', [b.driveIds[0]]))
      .rows[0].name;
    expect(
      (await call(b.userId, `drives/${b.driveIds[0]}`, 'DELETE', { confirmation: name })).status,
    ).toBe(202);
    expect(
      (await pool.query('SELECT 1 FROM account_key_slots WHERE account_id = $1', [b.accountId]))
        .rowCount,
    ).toBe(0);

    // Real endpoints racing: whatever the order, no slot row remains.
    const c = await fixture(1);
    const keyC = await setup(c);
    const nameC = (await pool.query('SELECT name FROM drives WHERE id = $1', [c.driveIds[0]]))
      .rows[0].name;
    await Promise.all([
      call(c.userId, `drives/${c.driveIds[0]}/account-key`, 'POST', {
        keyId: keyC.id,
        expectedRevision: null,
        sealed: sealed(),
      }),
      call(c.userId, `drives/${c.driveIds[0]}`, 'DELETE', { confirmation: nameC }),
    ]);
    expect(
      (await pool.query('SELECT 1 FROM account_key_slots WHERE account_id = $1', [c.accountId]))
        .rowCount,
    ).toBe(0);
  });

  it('a slot insert against account deletion leaves no key or slot, in either order', async () => {
    const a = await fixture(1);
    const keyA = await setup(a);
    const hold = await held(a.accountId, async (client) => {
      await client.query('UPDATE accounts SET deleting_at = now() WHERE id = $1', [a.accountId]);
      await client.query('DELETE FROM account_keys WHERE account_id = $1', [a.accountId]);
    });
    const put = call(a.userId, `drives/${a.driveIds[0]}/account-key`, 'POST', {
      keyId: keyA.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    await hold.waitForBlocked();
    await hold.finish();
    expect((await put).status).toBe(409);
    for (const table of ['account_keys', 'account_key_slots'])
      expect(
        (await pool.query(`SELECT 1 FROM ${table} WHERE account_id = $1`, [a.accountId])).rowCount,
        table,
      ).toBe(0);

    const c = await fixture(1);
    const keyC = await setup(c);
    await Promise.all([
      call(c.userId, `drives/${c.driveIds[0]}/account-key`, 'POST', {
        keyId: keyC.id,
        expectedRevision: null,
        sealed: sealed(),
      }),
      call(c.userId, 'account', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' }),
    ]);
    for (const table of ['account_keys', 'account_key_slots'])
      expect(
        (await pool.query(`SELECT 1 FROM ${table} WHERE account_id = $1`, [c.accountId])).rowCount,
        table,
      ).toBe(0);
  });
});

describe('account key: audit', () => {
  it('records each action and nothing from the request', async () => {
    const f = await fixture(1);
    const body = await setup(f);
    const path = `drives/${f.driveIds[0]}/account-key`;
    await call(f.userId, 'account-key');
    await call(f.userId, 'account-key/slots');
    await call(f.userId, path, 'POST', {
      keyId: body.id,
      expectedRevision: null,
      sealed: sealed(),
    });
    await call(f.userId, path, 'DELETE', { keyId: body.id, expectedRevision: 1 });
    await call(f.userId, 'account-key', 'PATCH', {
      expectedKeyId: body.id,
      expectedGeneration: 1,
      wrappedPrivateKey: wrapped(),
      kdf: kdf(),
    });
    await call(f.userId, 'account-key', 'DELETE', {
      expectedKeyId: body.id,
      confirmation: 'RESET',
    });
    const rows = await pool.query(
      'SELECT * FROM audit_events WHERE account_id = $1 AND action LIKE $2',
      [f.accountId, '%account_key%'],
    );
    expect(new Set(rows.rows.map((r) => r.action))).toEqual(
      new Set([
        'console.account_key.create',
        'console.account_key.read',
        'console.account_key.slots',
        'console.drive.account_key.put',
        'console.drive.account_key.delete',
        'console.account_key.update',
        'console.account_key.reset',
      ]),
    );
    const text = JSON.stringify(rows.rows);
    for (const secret of [body.publicKey, body.wrappedPrivateKey, body.kdf.salt])
      expect(text).not.toContain(secret);
  });
});

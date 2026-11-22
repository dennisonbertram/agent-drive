import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest } from './handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
const b64 = (bytes: Buffer) => bytes.toString('base64url');
const point = () => b64(Buffer.concat([Buffer.from([4]), randomBytes(64)]));
const wrapped = (n = 48) => b64(Buffer.concat([Buffer.from([1]), randomBytes(12 + 16 + n)]));
const sealedSlot = () => ({ epk: point(), iv: b64(randomBytes(12)), ct: b64(randomBytes(59)) });

async function request(path: string, token: string, method = 'GET', body?: unknown) {
  return handleApiRequest(
    new Request(`${root}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

// The integration fixture intentionally inspects JSON responses without modeling every route payload.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function fixture(opts: { scopes: string[]; drives?: number; agentOnly?: boolean }) {
  const account = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `slot-${randomUUID()}`,
  ]);
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  const agent = await pool.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, 'slot-agent'],
  );
  const driveIds: string[] = [];
  for (let i = 0; i < (opts.drives ?? 1); i += 1) {
    const drive = await pool.query(
      'INSERT INTO drives (account_id,name,agent_only) VALUES ($1,$2,$3) RETURNING id',
      [accountId, `drive-${randomUUID()}`, opts.agentOnly === true],
    );
    driveIds.push(drive.rows[0].id as string);
  }
  const token = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[])`,
    [accountId, agent.rows[0].id, 'integration', tokenHash(token), driveIds, opts.scopes],
  );
  return { accountId, driveIds, token };
}

async function createAccountKey(accountId: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO account_keys (id, account_id, format, public_key, wrapped_private_key, kdf_name, kdf_iterations, kdf_salt)
     VALUES ($1, $2, 1, $3, $4, 'PBKDF2-SHA256', 600000, $5)`,
    [id, accountId, point(), wrapped(), b64(randomBytes(16))],
  );
  return id;
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('bearer GET /account-key', () => {
  it('returns the account public key to any valid key, and accountKey: null without one', async () => {
    const f = await fixture({ scopes: ['read'] });
    const empty = await json(await request('/account-key', f.token));
    expect(empty).toEqual({ accountKey: null });
    const keyId = await createAccountKey(f.accountId);
    const read = await json(await request('/account-key', f.token));
    expect(read.keyId).toBe(keyId);
    expect(read.format).toBe(1);
    expect(typeof read.publicKey).toBe('string');
    // Never exposes the wrapped private key or the kdf parameters.
    expect(read.wrappedPrivateKey).toBeUndefined();
    expect(read.kdf).toBeUndefined();
  });
});

describe('bearer POST /drives/:id/account-key-slot', () => {
  it('inserts once, returns exists on repeats, and records the audit action', async () => {
    const f = await fixture({ scopes: ['write'] });
    const keyId = await createAccountKey(f.accountId);
    const path = `/drives/${f.driveIds[0]}/account-key-slot`;
    const created = await request(path, f.token, 'POST', { keyId, sealed: sealedSlot() });
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({ status: 'created' });
    const again = await request(path, f.token, 'POST', { keyId, sealed: sealedSlot() });
    expect(again.status).toBe(200);
    expect(await json(again)).toEqual({ status: 'exists' });
    const rows = await pool.query(
      'SELECT account_key_id FROM account_key_slots WHERE drive_id = $1',
      [f.driveIds[0]],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].account_key_id).toBe(keyId);
    const audit = await pool.query(
      `SELECT 1 FROM audit_events WHERE account_id = $1 AND action = 'drive.account_key_slot.put'`,
      [f.accountId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('requires write on that drive', async () => {
    const reader = await fixture({ scopes: ['read'] });
    const keyId = await createAccountKey(reader.accountId);
    const res = await request(
      `/drives/${reader.driveIds[0]}/account-key-slot`,
      reader.token,
      'POST',
      { keyId, sealed: sealedSlot() },
    );
    expect(res.status).toBe(403);
    // A write key scoped to drive A cannot slot drive B in the same account.
    const scoped = await fixture({ scopes: ['write'], drives: 1 });
    const scopedKey = await createAccountKey(scoped.accountId);
    const anotherDrive = (
      await pool.query('INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id', [
        scoped.accountId,
        `drive-${randomUUID()}`,
      ])
    ).rows[0].id as string;
    const denied = await request(`/drives/${anotherDrive}/account-key-slot`, scoped.token, 'POST', {
      keyId: scopedKey,
      sealed: sealedSlot(),
    });
    expect(denied.status).toBe(403);
  });

  it('rejects agent-only drives, stale key ids, missing keys, and bad bodies', async () => {
    const agentOnly = await fixture({ scopes: ['write'], agentOnly: true });
    const keyId = await createAccountKey(agentOnly.accountId);
    const res = await request(
      `/drives/${agentOnly.driveIds[0]}/account-key-slot`,
      agentOnly.token,
      'POST',
      { keyId, sealed: sealedSlot() },
    );
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: { code: 'conflict' } });
    expect(
      (
        await pool.query('SELECT 1 FROM account_key_slots WHERE drive_id = $1', [
          agentOnly.driveIds[0],
        ])
      ).rowCount,
    ).toBe(0);

    const f = await fixture({ scopes: ['write'] });
    // Stale key id while the account has a different key.
    const live = await createAccountKey(f.accountId);
    const stale = await request(`/drives/${f.driveIds[0]}/account-key-slot`, f.token, 'POST', {
      keyId: randomUUID(),
      sealed: sealedSlot(),
    });
    expect(stale.status).toBe(409);
    // No account key at all on another account.
    const none = await fixture({ scopes: ['write'] });
    const noKey = await request(
      `/drives/${none.driveIds[0]}/account-key-slot`,
      none.token,
      'POST',
      { keyId: randomUUID(), sealed: sealedSlot() },
    );
    expect(noKey.status).toBe(409);
    // The drive-scope check runs before existence: an unscoped drive id is denied, whether it
    // is unknown or belongs to another account.
    expect(
      (
        await request(`/drives/${randomUUID()}/account-key-slot`, f.token, 'POST', {
          keyId: live,
          sealed: sealedSlot(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/drives/${none.driveIds[0]}/account-key-slot`, f.token, 'POST', {
          keyId: live,
          sealed: sealedSlot(),
        })
      ).status,
    ).toBe(403);
    const good = { keyId: live, sealed: sealedSlot() };
    const s = good.sealed;
    const bad: Record<string, unknown>[] = [
      { ...good, extra: 1 },
      { ...good, keyId: 'not-a-uuid' },
      { sealed: s },
      { keyId: live },
      { ...good, sealed: { ...s, epk: b64(randomBytes(65)).replace(/^./, 'A') } },
      { ...good, sealed: { epk: s.epk, iv: s.iv } },
      { ...good, sealed: 'x' },
    ];
    for (const body of bad) {
      expect(
        (await request(`/drives/${f.driveIds[0]}/account-key-slot`, f.token, 'POST', body)).status,
        JSON.stringify(body).slice(0, 80),
      ).toBe(400);
    }
  });
});

describe('bearer drive create/list agentOnly', () => {
  it('creates an agent-only drive, lists it, and re-creating by name keeps the flag', async () => {
    const f = await fixture({ scopes: ['manage'] });
    const name = `only-${randomUUID()}`;
    const created = await json(
      await request('/drives', f.token, 'POST', { name, agentOnly: true }),
    );
    expect(created.agentOnly).toBe(true);
    expect(created.created).toBe(true);
    const listed = await json(await request('/drives', f.token));
    const row = listed.items.find((d: { id: string }) => d.id === created.id);
    expect(row.agentOnly).toBe(true);
    const again = await json(await request('/drives', f.token, 'POST', { name }));
    expect(again.created).toBe(false);
    expect(again.agentOnly).toBe(true);
    const normal = await json(
      await request('/drives', f.token, 'POST', { name: `n-${randomUUID()}` }),
    );
    expect(normal.agentOnly).toBe(false);
  });

  it('rejects a non-boolean agentOnly', async () => {
    const f = await fixture({ scopes: ['manage'] });
    const res = await request('/drives', f.token, 'POST', {
      name: `x-${randomUUID()}`,
      agentOnly: 'yes',
    });
    expect(res.status).toBe(400);
  });
});

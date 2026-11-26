import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '../billing/policy';
import { getPool } from '../db/client';
import { encryptedSize } from '../../../../packages/agent-drive/src/crypto-format.ts';
import {
  AgentDriveClient,
  StreamSizeLimitError,
} from '../../../../packages/agent-drive/src/client.js';
import { handleApiRequest } from './handler';

const pool = getPool();
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
let accountId = '';
let driveId = '';
let token = '';
let smallVersionId = '';
let largeVersionId = '';
let rangeVersionId = '';
const path = '/bounded-read.bin';

function request(query: string) {
  return handleApiRequest(
    new Request(`${root}/drives/${driveId}/get?path=${encodeURIComponent(path)}&${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  accountId = (
    await pool.query<{ id: string }>('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `bounded-read-${randomUUID()}`,
    ])
  ).rows[0]!.id;
  accountIds.push(accountId);
  const agentId = (
    await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'bounded-reader'],
    )
  ).rows[0]!.id;
  driveId = (
    await pool.query<{ id: string }>(
      'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
      [accountId, 'bounded-read-drive'],
    )
  ).rows[0]!.id;
  token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'bounded read',$3,$4::uuid[],'{read}')`,
    [accountId, agentId, tokenHash(token), [driveId]],
  );
  const fileId = (
    await pool.query<{ id: string }>(
      'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
      [driveId, path],
    )
  ).rows[0]!.id;
  smallVersionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,'opaque-wrapped-key',$5) RETURNING id`,
      [fileId, driveId, `objects/bounded-read/${randomUUID()}`, encryptedSize(6), agentId],
    )
  ).rows[0]!.id;
  largeVersionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,'opaque-wrapped-key',$5) RETURNING id`,
      [fileId, driveId, `objects/bounded-read/${randomUUID()}`, encryptedSize(8), agentId],
    )
  ).rows[0]!.id;
  rangeVersionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO versions (file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,'opaque-wrapped-key',$5) RETURNING id`,
      [fileId, driveId, `objects/bounded-read/${randomUUID()}`, 16 * 1024 * 1024 + 256, agentId],
    )
  ).rows[0]!.id;
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, largeVersionId]);
  await pool.query(
    `INSERT INTO billing_accounts (account_id,plan,spend_cap_cents)
     VALUES ($1,'free',0)
     ON CONFLICT (account_id) DO UPDATE SET plan='free', spend_cap_cents=0`,
    [accountId],
  );
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM agents WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('server-side bounded GET', () => {
  const freePlan = PLANS.free as unknown as { operations: bigint };

  it('admits an in-limit bounded GET into a one-operation allowance', async () => {
    const original = freePlan.operations;
    freePlan.operations = 1n;
    try {
      const allowed = await request(
        `versionId=${smallVersionId}&metadataOnly=1&maxPlaintextBytes=6&authorizeIfWithinLimit=1`,
      );
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).downloadUrl).toEqual(expect.any(String));

      const next = await request(
        `versionId=${smallVersionId}&metadataOnly=1&maxPlaintextBytes=6&authorizeIfWithinLimit=1`,
      );
      expect(next.status).toBe(402);
      expect((await next.json()).error.code).toBe('payment_required');
    } finally {
      freePlan.operations = original;
    }
  });

  it('authorizes a pinned closed range and reserves exactly its ciphertext bytes', async () => {
    const before = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );
    const result = await request(
      `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=${encodeURIComponent('bytes=0-19')}`,
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ id: smallVersionId, downloadRange: 'bytes=0-19' });
    expect(body.downloadUrl).toEqual(expect.any(String));
    const signed = new URL(body.downloadUrl);
    expect(signed.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('range');

    const after = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );
    expect(
      BigInt(after.rows[0]!.authorized_egress_bytes) -
        BigInt(before.rows[0]?.authorized_egress_bytes ?? '0'),
    ).toBe(20n);
  });

  it('accepts the per-request ciphertext ceiling and rejects one byte over it', async () => {
    const maximumRangeBytes = 8 * 1024 * 1024 + 128;
    const accepted = await request(
      `versionId=${rangeVersionId}&metadataOnly=1&authorizeRange=1&range=${encodeURIComponent(`bytes=0-${maximumRangeBytes - 1}`)}`,
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).downloadRange).toBe(`bytes=0-${maximumRangeBytes - 1}`);

    const rejected = await request(
      `versionId=${rangeVersionId}&metadataOnly=1&authorizeRange=1&range=${encodeURIComponent(`bytes=0-${maximumRangeBytes}`)}`,
    );
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe('validation_error');
  });

  it.each([
    [
      'requires metadata-only opt-in',
      () => `versionId=${smallVersionId}&authorizeRange=1&range=bytes%3D0-19`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'requires range authorization opt-in',
      () => `versionId=${smallVersionId}&metadataOnly=1&range=bytes%3D0-19`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'requires a range value',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'requires an explicit version',
      () => 'metadataOnly=1&authorizeRange=1&range=bytes%3D0-19',
      'Range authorization requires metadataOnly=1',
    ],
    [
      'requires a closed range',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D0-`,
      'range must be one closed byte range',
    ],
    [
      'rejects suffix ranges',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D-10`,
      'range must be one closed byte range',
    ],
    [
      'rejects multiple ranges',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D0-9%2C20-29`,
      'range must be one closed byte range',
    ],
    [
      'rejects reversed ranges',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D20-19`,
      'range end must be greater than or equal to start',
    ],
    [
      'rejects ranges beyond the selected version',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D0-47`,
      'range must fit within the selected version',
    ],
    [
      'rejects duplicate range parameters',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D0-9&range=bytes%3D10-19`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'rejects duplicate range opt-ins',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&authorizeRange=1&range=bytes%3D0-9`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'rejects duplicate version pins',
      () => `versionId=${smallVersionId}&versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&range=bytes%3D0-9`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'rejects duplicate metadata-only flags',
      () => `versionId=${smallVersionId}&metadataOnly=1&metadataOnly=1&authorizeRange=1&range=bytes%3D0-9`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'rejects plaintext caps on range authorization',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&maxPlaintextBytes=6&range=bytes%3D0-9`,
      'Range authorization requires metadataOnly=1',
    ],
    [
      'rejects whole-download authorization on range requests',
      () => `versionId=${smallVersionId}&metadataOnly=1&authorizeRange=1&authorizeIfWithinLimit=1&maxPlaintextBytes=6&range=bytes%3D0-9`,
      'Range authorization requires metadataOnly=1',
    ],
  ])('%s', async (_label, makeQuery, expectedMessage) => {
    const before = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );
    const result = await request(makeQuery());
    expect(result.status).toBe(400);
    const error = (await result.json()).error;
    expect(error.code).toBe('validation_error');
    expect(error.message).toContain(expectedMessage);
    const after = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );
    expect(after.rows[0]?.authorized_egress_bytes ?? '0').toBe(
      before.rows[0]?.authorized_egress_bytes ?? '0',
    );
  });

  it('returns metadata without signing or fetching storage when the selected version exceeds the cap', async () => {
    const metadataOnly = await request('metadataOnly=1');
    expect(metadataOnly.status).toBe(200);
    expect((await metadataOnly.json()).downloadUrl).toBeUndefined();

    const metadataOnlyWithCap = await request('metadataOnly=1&maxPlaintextBytes=9007199254740991');
    expect(metadataOnlyWithCap.status).toBe(200);
    expect((await metadataOnlyWithCap.json()).downloadUrl).toBeUndefined();

    const largeBound = await request(
      'metadataOnly=1&maxPlaintextBytes=9007199254740991&authorizeIfWithinLimit=1',
    );
    expect(largeBound.status).toBe(200);
    expect((await largeBound.json()).downloadUrl).toEqual(expect.any(String));

    const result = await request(
      `versionId=${largeVersionId}&metadataOnly=1&maxPlaintextBytes=7&authorizeIfWithinLimit=1`,
    );
    expect(result.status).toBe(200);
    const metadata = await result.json();
    expect(metadata).toMatchObject({ id: largeVersionId, path, ciphertextSize: encryptedSize(8) });
    expect(metadata).not.toHaveProperty('downloadUrl');
    const authorizedBeforeClient = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );

    const fetchCalls: string[] = [];
    const clientApiUrl = 'http://localhost/api/v1';
    const client = new AgentDriveClient({
      apiUrl: clientApiUrl,
      apiKey: token,
      fetch: async (input, init) => {
        fetchCalls.push(String(input));
        if (String(input).startsWith(clientApiUrl))
          return handleApiRequest(new Request(input, init));
        throw new Error('oversized bounded reads must not request ciphertext');
      },
    });
    await expect(
      client.getStream(driveId, path, {
        versionId: largeVersionId,
        maxPlaintextBytes: 7,
      }),
    ).rejects.toBeInstanceOf(StreamSizeLimitError);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain(`versionId=${largeVersionId}`);
    const authorizedAfterClient = await pool.query<{ authorized_egress_bytes: string }>(
      'SELECT authorized_egress_bytes FROM billing_periods WHERE account_id=$1 ORDER BY period_start DESC LIMIT 1',
      [accountId],
    );
    expect(authorizedAfterClient.rows[0]?.authorized_egress_bytes).toBe(
      authorizedBeforeClient.rows[0]?.authorized_egress_bytes,
    );
  });
});

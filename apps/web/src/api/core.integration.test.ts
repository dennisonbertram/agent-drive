import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteObject } from './storage';
import { handleApiRequest } from './handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
let driveId = '';
let otherDriveId = '';
let quotaDriveId = '';
let manageToken = '';
let writeToken = '';
let readToken = '';
let otherToken = '';
let revokedKeyId = '';
let revokedToken = '';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function request(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
  headers?: HeadersInit,
) {
  return handleApiRequest(
    new Request(
      `${root}${path}`,
      (() => {
        const init: RequestInit = {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        return init;
      })(),
    ),
  );
}

// The integration fixture intentionally inspects JSON responses without modeling every route payload.
async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as Record<string, any>;
}

async function fixture(
  accountName: string,
  agentName: string,
  driveName: string,
  scopes: string[],
  driveIds: string[] = [],
) {
  const account = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `${accountName}-${randomUUID()}`,
  ]);
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  const agent = await pool.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, agentName],
  );
  const agentId = agent.rows[0].id as string;
  const drive = await pool.query(
    'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, driveName],
  );
  const id = drive.rows[0].id as string;
  const token = key();
  const ids = driveIds.length ? driveIds : [id];
  const keyRow = await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[]) RETURNING id`,
    [accountId, agentId, 'integration', tokenHash(token), ids, scopes],
  );
  return { accountId, agentId, driveId: id, token, keyId: keyRow.rows[0].id as string };
}

async function uploadCommit(
  token: string,
  id: string,
  path: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const intentResponse = await request(
    `/drives/${id}/put`,
    token,
    'POST',
    {
      path,
      ciphertextSize: bytes.length,
      wrappedKey: 'opaque-wrapped-key',
      machineName: 'ignored',
      tags: ['phase1'],
      userId: 'user-1',
      ...extra,
    },
    { 'x-agent-drive-machine': 'integration-machine' },
  );
  expect(intentResponse.status).toBe(201);
  const intent = await json(intentResponse);
  const upload = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes) as BodyInit,
  });
  expect(upload.ok).toBe(true);
  const commitResponse = await request(`/drives/${id}/commit`, token, 'POST', {
    intentId: intent.intentId,
  });
  return {
    response: commitResponse,
    body: await json(commitResponse),
    intentId: intent.intentId as string,
    uploadUrl: intent.uploadUrl as string,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const first = await fixture('phase1-a', 'writer', 'drive', ['read', 'write', 'delete']);
  driveId = first.driveId;
  writeToken = first.token;
  readToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'read-only integration',$3,$4::uuid[],ARRAY['read']::text[])`,
    [first.accountId, first.agentId, tokenHash(readToken), [driveId]],
  );
  const quotaDrive = await pool.query(
    'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,4) RETURNING id',
    [first.accountId, `quota-${randomUUID()}`],
  );
  quotaDriveId = quotaDrive.rows[0].id as string;
  await pool.query(
    'UPDATE api_keys SET drive_ids = array_append(drive_ids, $1::uuid) WHERE token_hash = $2',
    [quotaDriveId, tokenHash(writeToken)],
  );
  const manager = await fixture('phase1-manager', 'manager', 'manage', ['manage']);
  manageToken = manager.token;
  const other = await fixture('phase1-b', 'other', 'other-drive', ['read', 'write', 'delete']);
  otherDriveId = other.driveId;
  otherToken = other.token;
  const revoked = await fixture('phase1-revoked', 'revoked', 'revoked-drive', ['read'], [driveId]);
  revokedKeyId = revoked.keyId;
  revokedToken = revoked.token;
  await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [revokedKeyId]);
});

afterAll(async () => {
  for (const id of accountIds) {
    const artifacts = await pool.query(
      `SELECT object_key AS key FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)
       UNION SELECT staging_key AS key FROM upload_intents WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)`,
      [id],
    );
    for (const artifact of artifacts.rows) await deleteObject(artifact.key).catch(() => undefined);
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }
  await pool.end();
});

describe('Phase 1 core API', () => {
  it('supports encrypted-object upload, versions, immutable bytes, restore, copy, move, search and recent', async () => {
    const firstBytes = Buffer.from('ciphertext-one');
    const first = await uploadCommit(writeToken, driveId, '/folder/file.bin', firstBytes, {
      tags: ['first'],
    });
    expect(first.response.status).toBe(201);
    const firstVersion = first.body.version.id as string;
    const get = await request(`/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin`, writeToken);
    const getBody = await json(get);
    expect(get.status).toBe(200);
    expect(await (await fetch(getBody.downloadUrl)).text()).toBe('ciphertext-one');
    const reusedUpload = await fetch(first.uploadUrl, {
      method: 'PUT',
      body: Buffer.from('tampered-bytes'),
    });
    expect(reusedUpload.ok).toBe(true);
    const repeatedCommit = await request(`/drives/${driveId}/commit`, writeToken, 'POST', {
      intentId: first.intentId,
    });
    expect(repeatedCommit.status).toBe(200);
    expect((await json(repeatedCommit)).version.id).toBe(firstVersion);
    const immutable = await json(
      await request(
        `/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin&versionId=${firstVersion}`,
        writeToken,
      ),
    );
    expect(await (await fetch(immutable.downloadUrl)).text()).toBe('ciphertext-one');
    const overwrite = await uploadCommit(
      writeToken,
      driveId,
      '/folder/file.bin',
      Buffer.from('ciphertext-two'),
      { ifVersionId: firstVersion },
    );
    expect(overwrite.response.status).toBe(201);
    const old = await request(
      `/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin&versionId=${firstVersion}`,
      writeToken,
    );
    expect(await (await fetch((await json(old)).downloadUrl)).text()).toBe('ciphertext-one');
    const copied = await request(`/drives/${driveId}/copy`, writeToken, 'POST', {
      path: '/folder/file.bin',
      destinationPath: '/copy.bin',
    });
    expect(copied.status).toBe(201);
    const moved = await request(`/drives/${driveId}/move`, writeToken, 'POST', {
      path: '/copy.bin',
      destinationPath: '/moved.bin',
    });
    expect(moved.status).toBe(200);
    expect(
      (await json(await request(`/drives/${driveId}/search?q=moved`, writeToken))).length,
    ).toBeGreaterThan(0);
    expect(
      (await json(await request(`/drives/${driveId}/recent`, writeToken))).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await json(
          await request(`/drives/${driveId}/versions?path=%2Ffolder%2Ffile.bin`, writeToken),
        )
      ).length,
    ).toBe(2);
    expect(
      (await request(`/drives/${driveId}/delete`, writeToken, 'POST', { path: '/folder/file.bin' }))
        .status,
    ).toBe(200);
    expect(
      (await request(`/drives/${driveId}/get?path=%2Ffolder%2Ffile.bin`, writeToken)).status,
    ).toBe(404);
    expect(
      (
        await request(`/drives/${driveId}/restore`, writeToken, 'POST', {
          path: '/folder/file.bin',
          versionId: firstVersion,
        })
      ).status,
    ).toBe(201);
    const listed = await json(
      await request(`/drives/${driveId}/list?prefix=%2Ffolder`, writeToken),
    );
    expect(listed.items[0].path).toBe('/folder/file.bin');
  });

  it('allows only one conditional writer from the same base version', async () => {
    const initial = await uploadCommit(writeToken, driveId, '/concurrent.bin', Buffer.from('base'));
    const baseVersionId = initial.body.version.id as string;
    const prepare = async (bytes: string) => {
      const intentResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
        path: '/concurrent.bin',
        ciphertextSize: Buffer.byteLength(bytes),
        wrappedKey: 'opaque',
        ifVersionId: baseVersionId,
      });
      const intent = await json(intentResponse);
      const upload = await fetch(intent.uploadUrl, { method: 'PUT', body: Buffer.from(bytes) });
      expect(upload.ok).toBe(true);
      return intent.intentId as string;
    };
    const [firstIntent, secondIntent] = await Promise.all([
      prepare('writer-a'),
      prepare('writer-b'),
    ]);
    const commits = await Promise.all(
      [firstIntent, secondIntent].map((intentId) =>
        request(`/drives/${driveId}/commit`, writeToken, 'POST', { intentId }),
      ),
    );
    expect(commits.map((item) => item.status).sort()).toEqual([201, 409]);
  });

  it('returns the typed quota error when a commit would exceed the drive quota', async () => {
    const result = await uploadCommit(
      writeToken,
      quotaDriveId,
      '/too-large.bin',
      Buffer.from('12345'),
    );
    expect(result.response.status).toBe(413);
    expect(result.body.error.code).toBe('quota_exceeded');
  });

  it('enforces scopes, tenants, revocation, validation, management and immutable staging', async () => {
    expect(
      (
        await request(`/drives/${driveId}/put`, readToken, 'POST', {
          path: '/nope',
          ciphertextSize: 1,
          wrappedKey: 'x',
        })
      ).status,
    ).toBe(403);
    expect((await request(`/drives/${otherDriveId}/get?path=%2Fnope`, writeToken)).status).toBe(
      403,
    );
    expect((await request('/whoami', key())).status).toBe(401);
    expect((await request('/whoami', otherToken)).status).toBe(200);
    const invalid = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/../bad',
      ciphertextSize: 1,
      wrappedKey: 'x',
    });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.code).toBe('validation_error');
    expect((await request('/whoami', key(), 'GET')).status).toBe(401);
    expect((await request('/whoami', revokedToken)).status).toBe(401);
    expect((await request('/whoami', writeToken)).status).toBe(200);
    const managerCreates = await request('/keys', manageToken, 'POST', {
      agentId: (await json(await request('/whoami', writeToken))).agentId,
      label: 'scoped',
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(managerCreates.status).toBe(404);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyObject, deleteObject, objectInfo } from './storage';
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
let writeOnlyToken = '';
let deleteOnlyToken = '';
let readToken = '';
let otherToken = '';
let revokedKeyId = '';
let revokedToken = '';
let writeKeyId = '';
let copyToken = '';
let copyAgentId = '';

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
  writeKeyId = first.keyId;
  copyAgentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      first.accountId,
      'copy-attribution-agent',
    ])
  ).rows[0].id as string;
  copyToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'copy-attribution',$3,$4::uuid[],ARRAY['read','write']::text[])`,
    [first.accountId, copyAgentId, tokenHash(copyToken), [driveId]],
  );
  writeOnlyToken = key();
  deleteOnlyToken = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'write-only',$3,$4::uuid[],ARRAY['write']::text[]),
            ($1,$2,'delete-only',$5,$4::uuid[],ARRAY['delete']::text[])`,
    [
      first.accountId,
      first.agentId,
      tokenHash(writeOnlyToken),
      [driveId],
      tokenHash(deleteOnlyToken),
    ],
  );
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
      (await json(await request(`/drives/${driveId}/search?q=moved`, writeToken))).items.length,
    ).toBeGreaterThan(0);
    expect(
      (await json(await request(`/drives/${driveId}/recent`, writeToken))).items.length,
    ).toBeGreaterThan(0);
    const versions = await json(
      await request(`/drives/${driveId}/versions?path=%2Ffolder%2Ffile.bin&limit=1`, writeToken),
    );
    expect(versions.items).toHaveLength(1);
    expect(versions.nextCursor).toEqual(expect.any(String));
    const nextVersions = await json(
      await request(
        `/drives/${driveId}/versions?path=%2Ffolder%2Ffile.bin&limit=1&cursor=${encodeURIComponent(versions.nextCursor)}`,
        writeToken,
      ),
    );
    expect(nextVersions.items).toHaveLength(1);
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
    await uploadCommit(writeToken, driveId, '/folder/second.bin', Buffer.from('second'));
    const listed = await json(
      await request(`/drives/${driveId}/list?prefix=%2Ffolder&limit=1`, writeToken),
    );
    expect(listed.items).toHaveLength(1);
    expect(listed.nextCursor).toEqual(expect.any(String));
    const next = await json(
      await request(
        `/drives/${driveId}/list?prefix=%2Ffolder&limit=1&cursor=${encodeURIComponent(listed.nextCursor)}`,
        writeToken,
      ),
    );
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it('allows write-only commits and delete-only deletes without granting read', async () => {
    const written = await uploadCommit(
      writeOnlyToken,
      driveId,
      '/write-only.bin',
      Buffer.from('write-only-data'),
    );
    expect(written.response.status).toBe(201);
    expect(
      (await request(`/drives/${driveId}/get?path=%2Fwrite-only.bin`, writeOnlyToken)).status,
    ).toBe(403);
    await uploadCommit(writeToken, driveId, '/delete-only.bin', Buffer.from('delete-me'));
    expect(
      (
        await request(`/drives/${driveId}/delete`, deleteOnlyToken, 'POST', {
          path: '/delete-only.bin',
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/drives/${driveId}/get?path=%2Fdelete-only.bin`, deleteOnlyToken)).status,
    ).toBe(403);
    const scopedDrives = await json(await request('/drives?limit=1', readToken));
    expect(scopedDrives.items.map((drive: { id: string }) => drive.id)).toContain(driveId);
  });

  it('treats percent and underscore in list prefixes literally', async () => {
    await uploadCommit(writeToken, driveId, '/literal%_marker/file.bin', Buffer.from('literal'));
    await uploadCommit(writeToken, driveId, '/literalXXmarker/other.bin', Buffer.from('wildcard'));
    const result = await json(
      await request(
        `/drives/${driveId}/list?prefix=${encodeURIComponent('/literal%_marker')}`,
        writeToken,
      ),
    );
    expect(result.items.map((item: { path: string }) => item.path)).toEqual([
      '/literal%_marker/file.bin',
    ]);
  });

  it('attributes a derived version to its current agent, machine, and user', async () => {
    await uploadCommit(writeToken, driveId, '/attribution-source.bin', Buffer.from('source'));
    const copied = await request(
      `/drives/${driveId}/copy`,
      copyToken,
      'POST',
      {
        path: '/attribution-source.bin',
        destinationPath: '/attributed-copy.bin',
        userId: 'actor-user',
      },
      { 'x-agent-drive-machine': 'copy-machine' },
    );
    expect(copied.status).toBe(201);
    const versionId = (await json(copied)).version.id as string;
    const version = await pool.query(
      `SELECT v.agent_id,v.machine_id,v.user_id,m.name FROM versions v
       JOIN machines m ON m.id = v.machine_id WHERE v.id = $1`,
      [versionId],
    );
    expect(version.rows[0]).toMatchObject({
      agent_id: copyAgentId,
      user_id: 'actor-user',
      name: 'copy-machine',
    });
  });

  it('uses an ETag precondition when copying a staged upload', async () => {
    const intentResponse = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/etag-precondition.bin',
      ciphertextSize: 5,
      wrappedKey: 'opaque',
    });
    const intent = await json(intentResponse);
    await fetch(intent.uploadUrl, { method: 'PUT', body: Buffer.from('bytes') });
    const staged = await pool.query('SELECT staging_key FROM upload_intents WHERE id = $1', [
      intent.intentId,
    ]);
    const sourceKey = staged.rows[0].staging_key as string;
    const info = await objectInfo(sourceKey);
    await expect(
      copyObject(sourceKey, `test-etag/${randomUUID()}`, '"deliberately-wrong"'),
    ).rejects.toThrow();
    expect(info.etag).toEqual(expect.any(String));
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
    for (const [operation, body] of [
      ['put', { path: '/denied', ciphertextSize: 1, wrappedKey: 'x' }],
      ['copy', { path: '/nope', destinationPath: '/copy' }],
      ['restore', { path: '/nope' }],
    ] as const) {
      expect(
        (await request(`/drives/${otherDriveId}/${operation}`, writeToken, 'POST', body)).status,
      ).toBe(403);
    }
    expect((await request('/whoami', key())).status).toBe(401);
    expect((await request('/whoami', otherToken)).status).toBe(200);
    const invalid = await request(`/drives/${driveId}/put`, writeToken, 'POST', {
      path: '/../bad',
      ciphertextSize: 1,
      wrappedKey: 'x',
    });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.code).toBe('validation_error');
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect((await request('/whoami/attacker-text', writeToken)).status).toBe(404);
    expect((await request(`/drives/${driveId}/list/extra`, writeToken)).status).toBe(404);
    expect((await request('/whoami', key(), 'GET')).status).toBe(401);
    expect((await request('/whoami', revokedToken)).status).toBe(401);
    expect((await request('/whoami', writeToken)).status).toBe(200);
  });

  it('creates and revokes a key through HTTP management routes', async () => {
    const manager = await json(await request('/whoami', manageToken));
    const agent = await request('/agents', manageToken, 'POST', {
      name: `api-agent-${randomUUID()}`,
    });
    expect(agent.status).toBe(200);
    const agentId = (await json(agent)).id as string;
    const agentsPage = await json(await request('/agents?limit=1', manageToken));
    expect(agentsPage.items).toHaveLength(1);
    expect(agentsPage.nextCursor).toEqual(expect.any(String));
    const agentsNext = await json(
      await request(
        `/agents?limit=1&cursor=${encodeURIComponent(agentsPage.nextCursor)}`,
        manageToken,
      ),
    );
    expect(agentsNext.items).toHaveLength(1);
    const drive = await request('/drives', manageToken, 'POST', {
      name: `api-drive-${randomUUID()}`,
    });
    expect(drive.status).toBe(200);
    const driveId = (await json(drive)).id as string;
    const created = await request('/keys', manageToken, 'POST', {
      agentId,
      label: 'api-created',
      driveIds: [driveId],
      scopes: ['read'],
    });
    expect(created.status).toBe(201);
    const keysPage = await json(await request('/keys?limit=1', manageToken));
    expect(keysPage.items).toHaveLength(1);
    expect(keysPage.nextCursor).toEqual(expect.any(String));
    const key = await json(created);
    const storedKey = await pool.query('SELECT account_id FROM api_keys WHERE id = $1', [key.id]);
    expect(storedKey.rows[0].account_id).toBe(manager.accountId);
    const revoked = await request(`/keys/${key.id}`, manageToken, 'DELETE');
    expect(revoked.status).toBe(200);
    expect((await request('/whoami', key.token)).status).toBe(401);
  });

  it('records safe success and failure audit events', async () => {
    await request('/whoami', writeToken);
    await request('/whoami/extra', writeToken);
    const events = await pool.query(
      'SELECT action, outcome, error_code, http_status FROM audit_events WHERE api_key_id = $1',
      [writeKeyId],
    );
    expect(events.rows.some((row) => row.outcome === 'success')).toBe(true);
    expect(events.rows.some((row) => row.outcome === 'failure')).toBe(true);
    expect(events.rows.some((row) => row.action === 'unknown')).toBe(true);
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(['token', 'wrapped_key', 'signed_url', 'request_body']),
    );
    expect(JSON.stringify(events.rows)).not.toContain(writeToken);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TransactionCommitUnknownError, withTransaction } from '../db/client';
import { deleteObject } from './storage';
import { handleApiRequest } from './handler';

vi.mock('../db/client', async (original) => {
  const actual = await original<typeof import('../db/client')>();
  return { ...actual, withTransaction: vi.fn(actual.withTransaction) };
});

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const accountIds: string[] = [];
const root = 'http://agent-drive.test/api/v1';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const makeToken = () =>
  `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function request(path: string, token: string, body?: unknown) {
  return handleApiRequest(
    new Request(`${root}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as Record<string, any>;
}

async function fixture(quotaBytes = 1_000_000) {
  const account = await pool.query<{ id: string }>(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id',
    [`mount-rename-${randomUUID()}`],
  );
  const accountId = account.rows[0]!.id;
  accountIds.push(accountId);
  const agent = await pool.query<{ id: string }>(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `rename-agent-${randomUUID()}`],
  );
  const agentId = agent.rows[0]!.id;
  const drive = await pool.query<{ id: string }>(
    'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,$3) RETURNING id',
    [accountId, `rename-drive-${randomUUID()}`, quotaBytes],
  );
  const driveId = drive.rows[0]!.id;
  const token = makeToken();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'rename-test',$3,$4::uuid[],ARRAY['read','write','delete']::text[])`,
    [accountId, agentId, tokenHash(token), [driveId]],
  );
  return { accountId, agentId, driveId, token };
}

async function scopedToken(
  value: { accountId: string; agentId: string; driveId: string },
  scopes: string[],
  writePaths: string[],
) {
  const token = makeToken();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes,write_paths)
     VALUES ($1,$2,'rename-scoped-test',$3,$4::uuid[],$5::text[],$6::text[])`,
    [value.accountId, value.agentId, tokenHash(token), [value.driveId], scopes, writePaths],
  );
  return token;
}

async function uploadCommit(
  token: string,
  driveId: string,
  path: string,
  bytes: Buffer,
  extra = {},
) {
  const intentResponse = await request(`/drives/${driveId}/put`, token, {
    path,
    ciphertextSize: bytes.length,
    wrappedKey: 'synthetic-wrapped-key',
    ...extra,
  });
  expect(intentResponse.status).toBe(201);
  const intent = await json(intentResponse);
  const uploaded = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
  });
  expect(uploaded.ok).toBe(true);
  const commit = await request(`/drives/${driveId}/commit`, token, {
    intentId: intent.intentId,
  });
  expect([200, 201]).toContain(commit.status);
  return { ...(await json(commit)).version, intentId: intent.intentId } as {
    id: string;
    intentId: string;
  };
}

async function seedLegacyFile(
  driveId: string,
  agentId: string,
  path: string,
): Promise<{ fileId: string; versionId: string }> {
  const fileId = randomUUID();
  const versionId = randomUUID();
  await pool.query('INSERT INTO files (id,drive_id,path) VALUES ($1,$2,$3)', [
    fileId,
    driveId,
    path,
  ]);
  await pool.query(
    `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,$4,13,'synthetic-wrapped-key',$5)`,
    [versionId, fileId, driveId, `objects/mount-rename-legacy/${versionId}`, agentId],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  return { fileId, versionId };
}

async function getBytes(token: string, driveId: string, path: string, versionId?: string) {
  const query = new URLSearchParams({ path, ...(versionId ? { versionId } : {}) });
  const response = await handleApiRequest(
    new Request(`${root}/drives/${driveId}/get?${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  if (!response.ok) return { response, bytes: undefined };
  const body = await json(response);
  return { response, bytes: Buffer.from(await (await fetch(body.downloadUrl)).arrayBuffer()) };
}

const rename = (driveId: string, token: string, body: Record<string, unknown>) =>
  request(`/drives/${driveId}/rename`, token, body);

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterAll(async () => {
  for (const accountId of accountIds) {
    const artifacts = await pool.query<{ key: string }>(
      `SELECT object_key AS key FROM versions
        WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)
       UNION SELECT staging_key AS key FROM upload_intents
        WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)`,
      [accountId],
    );
    for (const artifact of artifacts.rows) await deleteObject(artifact.key).catch(() => undefined);
    await pool.query('DELETE FROM audit_events WHERE account_id = $1', [accountId]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [accountId],
    );
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [accountId],
    );
    await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  }
  await pool.end();
});

describe('mount editor rename API', () => {
  it('atomically moves a committed temp file when the destination is absent', async () => {
    const f = await fixture();
    const bytes = Buffer.from('editor temp content');
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-41', bytes);
    const operationId = randomUUID();

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-41',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId,
    });

    expect(response.status).toBe(200);
    const result = await json(response);
    expect(result).toMatchObject({ path: '/notes.txt', versionId: source.id });
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-41')).response.status).toBe(404);
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(bytes);
    const rows = await pool.query(
      'SELECT path,current_version_id,deleted_at FROM files WHERE drive_id=$1 AND id=$2',
      [f.driveId, result.id],
    );
    expect(rows.rows).toEqual([
      { path: '/notes.txt', current_version_id: source.id, deleted_at: null },
    ]);
  });
  it('replaces only the expected live destination, preserving target history and trashing the temp', async () => {
    const f = await fixture();
    const priorBytes = Buffer.from('prior target version');
    const nextBytes = Buffer.from('committed editor temp');
    const prior = await uploadCommit(f.token, f.driveId, '/notes.txt', priorBytes, {
      tags: ['work', 'pinned'],
      description: 'Keep this remote document metadata',
    });
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-42', nextBytes);

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-42',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: prior.id,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(200);
    const result = await json(response);
    expect(result).toMatchObject({ path: '/notes.txt', versionId: expect.any(String) });
    expect(result.versionId).not.toBe(prior.id);
    expect(result.versionId).not.toBe(source.id);
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(nextBytes);
    expect((await getBytes(f.token, f.driveId, '/notes.txt', prior.id)).bytes).toEqual(priorBytes);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-42')).response.status).toBe(404);
    const trashedSource = await pool.query(
      'SELECT deleted_at FROM files WHERE drive_id=$1 AND path=$2',
      [f.driveId, '/.editor-tmp-42'],
    );
    expect(trashedSource.rows[0]?.deleted_at).not.toBeNull();
    const preservedMetadata = await pool.query(
      'SELECT tags,description FROM versions WHERE id=$1',
      [result.versionId],
    );
    expect(preservedMetadata.rows[0]).toEqual({
      tags: ['work', 'pinned'],
      description: 'Keep this remote document metadata',
    });
    const renameEvents = await pool.query(
      `SELECT operation,path FROM file_events
        WHERE drive_id=$1 AND (version_id=$3 OR (version_id=$2 AND operation='delete'))
        ORDER BY seq`,
      [f.driveId, source.id, result.versionId],
    );
    expect(renameEvents.rows).toEqual([
      { operation: 'put', path: '/notes.txt' },
      { operation: 'delete', path: '/.editor-tmp-42' },
    ]);
    const versions = await json(
      await handleApiRequest(
        new Request(`${root}/drives/${f.driveId}/versions?path=%2Fnotes.txt&limit=10`, {
          headers: { authorization: `Bearer ${f.token}` },
        }),
      ),
    );
    expect(versions.items.map((version: { id: string }) => version.id)).toEqual(
      expect.arrayContaining([prior.id, result.versionId]),
    );
  });

  it('rejects stale source or destination versions without changing either path', async () => {
    const f = await fixture();
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-43', Buffer.from('one'));
    const target = await uploadCommit(f.token, f.driveId, '/notes.txt', Buffer.from('target one'));
    const newerSource = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-43',
      Buffer.from('source two'),
      { ifVersionId: source.id },
    );

    const staleSource = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-43',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });
    expect(staleSource.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-43')).bytes).toEqual(
      Buffer.from('source two'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(
      Buffer.from('target one'),
    );

    const newerTarget = await uploadCommit(
      f.token,
      f.driveId,
      '/notes.txt',
      Buffer.from('target two'),
      { ifVersionId: target.id },
    );
    const staleTarget = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-43',
      destinationPath: '/notes.txt',
      ifSourceVersionId: newerSource.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });
    expect(staleTarget.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-43')).bytes).toEqual(
      Buffer.from('source two'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(
      Buffer.from('target two'),
    );
    expect(newerTarget.id).not.toBe(target.id);
  });

  it('replays an acknowledged operation id after the destination advances and rejects a changed payload', async () => {
    const f = await fixture();
    const prior = await uploadCommit(f.token, f.driveId, '/notes.txt', Buffer.from('old'));
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-44', Buffer.from('new'));
    const body = {
      path: '/.editor-tmp-44',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: prior.id,
      operationId: randomUUID(),
    };
    const first = await rename(f.driveId, f.token, body);
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    const advance = await uploadCommit(
      f.token,
      f.driveId,
      '/notes.txt',
      Buffer.from('newer unrelated edit'),
      { ifVersionId: firstBody.versionId },
    );
    const replay = await rename(f.driveId, f.token, body);
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual(firstBody);
    const versionCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM versions WHERE drive_id=$1',
      [f.driveId],
    );
    expect(versionCount.rows[0]!.count).toBe(4);
    expect(advance.id).not.toBe(firstBody.versionId);

    const changedPayload = await rename(f.driveId, f.token, {
      ...body,
      destinationPath: '/different.txt',
    });
    expect(changedPayload.status).toBe(409);

    const otherAgent = await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [f.accountId, `different-rename-agent-${randomUUID()}`],
    );
    const otherAgentToken = makeToken();
    await pool.query(
      `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
       VALUES ($1,$2,'other-rename-agent',$3,$4::uuid[],ARRAY['read','write','delete']::text[])`,
      [f.accountId, otherAgent.rows[0]!.id, tokenHash(otherAgentToken), [f.driveId]],
    );
    const otherAgentReplay = await rename(f.driveId, otherAgentToken, body);
    expect(otherAgentReplay.status).toBe(409);
    expect(await json(otherAgentReplay)).not.toEqual(firstBody);
  });

  it('replays the committed result after the commit acknowledgement is lost', async () => {
    const f = await fixture();
    const prior = await uploadCommit(f.token, f.driveId, '/notes.txt', Buffer.from('before'));
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-47', Buffer.from('after'));
    const body = {
      path: '/.editor-tmp-47',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: prior.id,
      operationId: randomUUID(),
    };
    const actual = await vi.importActual<typeof import('../db/client')>('../db/client');
    vi.mocked(withTransaction).mockImplementation(async (callback) => {
      const result = await actual.withTransaction(callback);
      const value = result as { result?: { versionId?: unknown }; replay?: unknown } | null;
      if (value?.result?.versionId && value.replay === false)
        throw new TransactionCommitUnknownError(new Error('lost commit acknowledgement'));
      return result;
    });
    try {
      const first = await rename(f.driveId, f.token, body);
      expect(first.status).toBe(500);
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
      const replay = await rename(f.driveId, f.token, body);
      expect(replay.status).toBe(200);
      const result = await json(replay);
      expect(result.path).toBe('/notes.txt');
      expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(
        Buffer.from('after'),
      );
      expect((await getBytes(f.token, f.driveId, '/.editor-tmp-47')).response.status).toBe(404);
      const versions = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM versions WHERE drive_id=$1',
        [f.driveId],
      );
      expect(versions.rows[0]!.count).toBe(3);
    } finally {
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
    }
  });

  it('checks write paths on both paths and requires delete scope before consuming a source', async () => {
    const f = await fixture();
    const source = await uploadCommit(f.token, f.driveId, '/inbox/.editor-tmp', Buffer.from('new'));
    const target = await uploadCommit(f.token, f.driveId, '/outputs/notes.txt', Buffer.from('old'));
    const sourceOnly = await scopedToken(f, ['read', 'write', 'delete'], ['/inbox']);
    const destinationOnly = await scopedToken(f, ['read', 'write', 'delete'], ['/outputs']);
    const body = {
      path: '/inbox/.editor-tmp',
      destinationPath: '/outputs/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    };
    expect((await rename(f.driveId, sourceOnly, body)).status).toBe(403);
    expect((await rename(f.driveId, destinationOnly, body)).status).toBe(403);
    expect((await getBytes(f.token, f.driveId, body.path)).bytes).toEqual(Buffer.from('new'));
    expect((await getBytes(f.token, f.driveId, body.destinationPath)).bytes).toEqual(
      Buffer.from('old'),
    );

    const writeOnly = await scopedToken(f, ['read', 'write'], ['/inbox', '/outputs']);
    expect(
      (await rename(f.driveId, writeOnly, { ...body, operationId: randomUUID() })).status,
    ).toBe(403);
    expect((await getBytes(f.token, f.driveId, body.path)).bytes).toEqual(Buffer.from('new'));
  });

  it('fails quota checks without losing the source or changing the destination', async () => {
    const f = await fixture(8);
    const source = await uploadCommit(f.token, f.driveId, '/.editor-tmp-45', Buffer.from('1234'));
    const target = await uploadCommit(f.token, f.driveId, '/notes.txt', Buffer.from('5678'));
    const before = await pool.query(
      'SELECT current_version_id,deleted_at FROM files WHERE drive_id=$1 AND path=$2',
      [f.driveId, '/notes.txt'],
    );

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-45',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe('quota_exceeded');
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-45')).bytes).toEqual(
      Buffer.from('1234'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).bytes).toEqual(Buffer.from('5678'));
    const after = await pool.query(
      'SELECT current_version_id,deleted_at FROM files WHERE drive_id=$1 AND path=$2',
      [f.driveId, '/notes.txt'],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('rejects same-path and trashed-destination requests without changing file state', async () => {
    const f = await fixture();
    const source = await uploadCommit(f.token, f.driveId, '/same.bin', Buffer.from('source'));
    const samePath = await rename(f.driveId, f.token, {
      path: '/same.bin',
      destinationPath: '/same.bin',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: source.id,
      operationId: randomUUID(),
    });
    expect([400, 409]).toContain(samePath.status);
    expect((await getBytes(f.token, f.driveId, '/same.bin')).bytes).toEqual(Buffer.from('source'));

    const target = await uploadCommit(
      f.token,
      f.driveId,
      '/trashed-target.txt',
      Buffer.from('old'),
    );
    const temp = await uploadCommit(f.token, f.driveId, '/.editor-tmp-46', Buffer.from('new'));
    expect(
      (
        await request(`/drives/${f.driveId}/delete`, f.token, {
          path: '/trashed-target.txt',
        })
      ).status,
    ).toBe(200);
    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-46',
      destinationPath: '/trashed-target.txt',
      ifSourceVersionId: temp.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });
    expect(response.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-46')).bytes).toEqual(
      Buffer.from('new'),
    );
    const destination = await pool.query<{ deleted_at: Date | null; current_version_id: string }>(
      'SELECT deleted_at,current_version_id FROM files WHERE drive_id=$1 AND path=$2',
      [f.driveId, '/trashed-target.txt'],
    );
    expect(destination.rows[0]!.deleted_at).not.toBeNull();
    expect(destination.rows[0]!.current_version_id).toBe(target.id);
  });

  it('does not rename a file onto an explicit directory path', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-directory-collision',
      Buffer.from('keep this file'),
    );
    await pool.query('INSERT INTO drive_directories (drive_id,path) VALUES ($1,$2)', [
      f.driveId,
      '/notes.txt',
    ]);

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-directory-collision',
      destinationPath: '/notes.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-directory-collision')).bytes).toEqual(
      Buffer.from('keep this file'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes.txt')).response.status).toBe(404);
  });

  it('rejects a file that would shadow an explicit directory but allows children within one', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-shadow',
      Buffer.from('keep this file'),
    );
    await pool.query('INSERT INTO drive_directories (drive_id,path) VALUES ($1,$2),($1,$3)', [
      f.driveId,
      '/shadow/child',
      '/folder',
    ]);

    const shadowing = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-shadow',
      destinationPath: '/shadow',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(shadowing.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-shadow')).bytes).toEqual(
      Buffer.from('keep this file'),
    );

    const nestedSource = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-nested',
      Buffer.from('nested file'),
    );
    const nested = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-nested',
      destinationPath: '/folder/notes.txt',
      ifSourceVersionId: nestedSource.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(nested.status).toBe(200);
    expect((await getBytes(f.token, f.driveId, '/folder/notes.txt')).bytes).toEqual(
      Buffer.from('nested file'),
    );
  });

  it('does not rename a file onto an implicit folder made by live descendants', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-implicit',
      Buffer.from('source'),
    );
    await uploadCommit(f.token, f.driveId, '/notes/child.txt', Buffer.from('child'));

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-implicit',
      destinationPath: '/notes',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-implicit')).bytes).toEqual(
      Buffer.from('source'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes/child.txt')).bytes).toEqual(
      Buffer.from('child'),
    );
  });

  it('does not replace a file that is also an implicit folder', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-replace',
      Buffer.from('source'),
    );
    const target = await uploadCommit(f.token, f.driveId, '/notes', Buffer.from('target'));
    await uploadCommit(f.token, f.driveId, '/notes/child.txt', Buffer.from('child'));

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-replace',
      destinationPath: '/notes',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/.editor-tmp-replace')).bytes).toEqual(
      Buffer.from('source'),
    );
    expect((await getBytes(f.token, f.driveId, '/notes')).bytes).toEqual(Buffer.from('target'));
    expect((await getBytes(f.token, f.driveId, '/notes/child.txt')).bytes).toEqual(
      Buffer.from('child'),
    );
  });

  it('rechecks live file namespace conflicts before committing a staged replacement', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-race',
      Buffer.from('source'),
    );
    const target = await uploadCommit(f.token, f.driveId, '/notes', Buffer.from('target'));
    const actual = await vi.importActual<typeof import('../db/client')>('../db/client');
    vi.mocked(withTransaction).mockImplementationOnce(async (callback) => {
      const prepared = await actual.withTransaction(callback);
      await pool.query('INSERT INTO files (drive_id,path) VALUES ($1,$2)', [
        f.driveId,
        '/notes/created-during-copy.txt',
      ]);
      return prepared;
    });
    try {
      const response = await rename(f.driveId, f.token, {
        path: '/.editor-tmp-race',
        destinationPath: '/notes',
        ifSourceVersionId: source.id,
        ifDestinationVersionId: target.id,
        operationId: randomUUID(),
      });

      expect(response.status).toBe(409);
      expect((await getBytes(f.token, f.driveId, '/.editor-tmp-race')).bytes).toEqual(
        Buffer.from('source'),
      );
      expect((await getBytes(f.token, f.driveId, '/notes')).bytes).toEqual(Buffer.from('target'));
    } finally {
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
    }
  });

  it('does not rename a file beneath another live file and escapes literal path wildcards', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-ancestor',
      Buffer.from('source'),
    );
    await uploadCommit(f.token, f.driveId, '/notes', Buffer.from('parent file'));

    const beneathFile = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-ancestor',
      destinationPath: '/notes/child.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(beneathFile.status).toBe(409);

    const wildcardSource = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-tmp-wildcard',
      Buffer.from('wildcard source'),
    );
    await uploadCommit(f.token, f.driveId, '/notesXdraftY/child.txt', Buffer.from('other folder'));
    const literalPath = await rename(f.driveId, f.token, {
      path: '/.editor-tmp-wildcard',
      destinationPath: '/notes_draft%',
      ifSourceVersionId: wildcardSource.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(literalPath.status).toBe(200);
  });

  it('moves a legacy collided file away while allowing a file inside an explicit folder', async () => {
    const f = await fixture();
    await pool.query('INSERT INTO drive_directories (drive_id,path) VALUES ($1,$2)', [
      f.driveId,
      '/notes',
    ]);
    const collided = await seedLegacyFile(f.driveId, f.agentId, '/notes');
    const nested = await seedLegacyFile(f.driveId, f.agentId, '/notes/legacy.txt');

    const moveCollided = await rename(f.driveId, f.token, {
      path: '/notes',
      destinationPath: '/moved-notes',
      ifSourceVersionId: collided.versionId,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(moveCollided.status).toBe(200);
    expect(await json(moveCollided)).toMatchObject({ id: collided.fileId, path: '/moved-notes' });

    const moveNested = await rename(f.driveId, f.token, {
      path: '/notes/legacy.txt',
      destinationPath: '/moved-child.txt',
      ifSourceVersionId: nested.versionId,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(moveNested.status).toBe(200);
    expect(await json(moveNested)).toMatchObject({ id: nested.fileId, path: '/moved-child.txt' });

    const paths = await pool.query<{ path: string }>(
      'SELECT path FROM files WHERE drive_id=$1 AND id = ANY($2::uuid[]) ORDER BY path',
      [f.driveId, [collided.fileId, nested.fileId]],
    );
    expect(paths.rows.map((row) => row.path)).toEqual(['/moved-child.txt', '/moved-notes']);
  });

  it('keeps the existing move route write-only and create-only at an occupied destination', async () => {
    const f = await fixture();
    const writeOnly = await scopedToken(f, ['write'], ['/legacy']);
    const first = await uploadCommit(
      f.token,
      f.driveId,
      '/legacy/source.txt',
      Buffer.from('legacy move'),
    );
    const moved = await request(`/drives/${f.driveId}/move`, writeOnly, {
      path: '/legacy/source.txt',
      destinationPath: '/legacy/moved.txt',
    });
    expect(moved.status).toBe(200);
    expect((await getBytes(f.token, f.driveId, '/legacy/source.txt')).response.status).toBe(404);
    expect((await getBytes(f.token, f.driveId, '/legacy/moved.txt')).bytes).toEqual(
      Buffer.from('legacy move'),
    );

    const conflictSource = await uploadCommit(
      f.token,
      f.driveId,
      '/legacy/another.txt',
      Buffer.from('keep source'),
    );
    const occupied = await request(`/drives/${f.driveId}/move`, writeOnly, {
      path: '/legacy/another.txt',
      destinationPath: '/legacy/moved.txt',
    });
    expect(occupied.status).toBe(409);
    expect((await getBytes(f.token, f.driveId, '/legacy/another.txt')).bytes).toEqual(
      Buffer.from('keep source'),
    );
    expect((await getBytes(f.token, f.driveId, '/legacy/moved.txt')).bytes).toEqual(
      Buffer.from('legacy move'),
    );
    expect(first.id).not.toBe(conflictSource.id);
  });

  it('guards opted-in mount creates at intent and commit while preserving flat create-only clients', async () => {
    const f = await fixture();

    const child = await seedLegacyFile(f.driveId, f.agentId, '/implicit/child.txt');
    const trashedParent = await seedLegacyFile(f.driveId, f.agentId, '/implicit');
    await pool.query('UPDATE files SET deleted_at=now() WHERE id=$1', [trashedParent.fileId]);
    const aboveImplicit = await request(`/drives/${f.driveId}/put`, f.token, {
      path: '/implicit',
      ciphertextSize: 3,
      wrappedKey: 'synthetic-wrapped-key',
      ifVersionId: null,
      allowTrashedCreate: true,
    });
    expect(aboveImplicit.status).toBe(409);
    expect((await json(aboveImplicit)).error.code).toBe('conflict');
    expect(child.versionId).toBeTruthy();

    const ancestor = await seedLegacyFile(f.driveId, f.agentId, '/blocked');
    const trashedChild = await seedLegacyFile(f.driveId, f.agentId, '/blocked/child.txt');
    await pool.query('UPDATE files SET deleted_at=now() WHERE id=$1', [trashedChild.fileId]);
    const belowFile = await request(`/drives/${f.driveId}/put`, f.token, {
      path: '/blocked/child.txt',
      ciphertextSize: 3,
      wrappedKey: 'synthetic-wrapped-key',
      ifVersionId: null,
      allowTrashedCreate: true,
    });
    expect(belowFile.status).toBe(409);
    expect((await json(belowFile)).error.code).toBe('conflict');

    const raceIntent = await request(`/drives/${f.driveId}/put`, f.token, {
      path: '/late/child.txt',
      ciphertextSize: 4,
      wrappedKey: 'synthetic-wrapped-key',
      ifVersionId: null,
      allowTrashedCreate: true,
    });
    expect(raceIntent.status).toBe(201);
    const race = await json(raceIntent);
    const storedMarker = await pool.query<{ base_version_id: string }>(
      'SELECT base_version_id FROM upload_intents WHERE id=$1',
      [race.intentId],
    );
    expect(storedMarker.rows[0]?.base_version_id).toBe('00000000-0000-0000-0000-000000000000');
    const uploaded = await fetch(race.uploadUrl, { method: 'PUT', body: Buffer.from('race') });
    expect(uploaded.ok).toBe(true);
    await seedLegacyFile(f.driveId, f.agentId, '/late');
    const racedCommit = await request(`/drives/${f.driveId}/commit`, f.token, {
      intentId: race.intentId,
    });
    expect(racedCommit.status).toBe(409);
    const racedVersion = await pool.query<{ id: string }>(
      'SELECT id FROM versions WHERE drive_id=$1 AND file_id=(SELECT id FROM files WHERE drive_id=$1 AND path=$2)',
      [f.driveId, '/late/child.txt'],
    );
    expect(racedVersion.rows).toEqual([]);

    const flatIntent = await request(`/drives/${f.driveId}/put`, f.token, {
      path: '/blocked/legacy-flat.txt',
      ciphertextSize: 4,
      wrappedKey: 'synthetic-wrapped-key',
      ifVersionId: null,
    });
    expect(flatIntent.status).toBe(201);
    const flat = await json(flatIntent);
    const flatUpload = await fetch(flat.uploadUrl, { method: 'PUT', body: Buffer.from('flat') });
    expect(flatUpload.ok).toBe(true);
    const flatCommit = await request(`/drives/${f.driveId}/commit`, f.token, {
      intentId: flat.intentId,
    });
    expect(flatCommit.status).toBe(201);
    expect(ancestor.versionId).toBeTruthy();
  });
});

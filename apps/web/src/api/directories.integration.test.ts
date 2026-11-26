import { createHash, randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../db/client';
import { handleApiRequest } from './handler';

const pool = getPool();
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function fixture(options: { quotaBytes?: number } = {}) {
  const accountId = (
    await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `directories-${randomUUID()}`,
    ])
  ).rows[0]!.id as string;
  accountIds.push(accountId);
  const agentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      accountId,
      `directories-agent-${randomUUID()}`,
    ])
  ).rows[0]!.id as string;
  const driveId = (
    await pool.query(
      'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,$3) RETURNING id',
      [accountId, `directories-drive-${randomUUID()}`, options.quotaBytes ?? 1],
    )
  ).rows[0]!.id as string;
  const issue = async (scopes: string[], writePaths: string[] = []) => {
    const apiToken = token();
    await pool.query(
      `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes,write_paths)
       VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[],$7::text[])`,
      [
        accountId,
        agentId,
        'directory-integration',
        tokenHash(apiToken),
        [driveId],
        scopes,
        writePaths,
      ],
    );
    return apiToken;
  };
  return { accountId, agentId, driveId, issue };
}

async function request(path: string, apiToken: string, method = 'GET', body?: unknown) {
  return handleApiRequest(
    new Request(`${root}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const mkdir = (driveId: string, apiToken: string, path: string) =>
  request(`/drives/${driveId}/mkdir`, apiToken, 'POST', { path });
const rmdir = (driveId: string, apiToken: string, path: string) =>
  request(`/drives/${driveId}/rmdir`, apiToken, 'POST', { path });
const list = (driveId: string, apiToken: string, query = '') =>
  request(`/drives/${driveId}/list${query ? `?${query}` : ''}`, apiToken);

async function seedFile(driveId: string, agentId: string, path: string, deleted = false) {
  const fileId = randomUUID();
  const versionId = randomUUID();
  await pool.query('INSERT INTO files (id,drive_id,path,deleted_at) VALUES ($1,$2,$3,$4)', [
    fileId,
    driveId,
    path,
    deleted ? new Date() : null,
  ]);
  await pool.query(
    `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,$4,7,'synthetic-wrapped-key',$5)`,
    [versionId, fileId, driveId, `objects/directories/${versionId}`, agentId],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  return { fileId, versionId };
}

async function body(response: Response) {
  return (await response.json()) as {
    items?: { kind?: string; path: string; directory_id?: string }[];
    nextCursor?: string | null;
    path?: string;
    error?: { code?: string };
  };
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: 'apps/web/drizzle' });
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query(
      `DELETE FROM file_events
        WHERE drive_id IN (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))`,
      [accountIds],
    );
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('persistent drive directories', () => {
  it('creates explicit empty directories, requires existing parents, and keeps root implicit', async () => {
    const f = await fixture();
    const write = await f.issue(['read', 'write']);

    expect((await mkdir(f.driveId, write, '/')).status).toBe(400);
    expect((await mkdir(f.driveId, write, '/a/b')).status).toBe(404);
    expect((await mkdir(f.driveId, write, '/a')).status).toBe(201);
    expect((await mkdir(f.driveId, write, '/a/b')).status).toBe(201);
    expect((await mkdir(f.driveId, write, '/a')).status).toBe(409);

    const rootListing = await body(await list(f.driveId, write, 'delimiter=%2F'));
    expect(rootListing.items).toHaveLength(1);
    expect(rootListing.items![0]).toMatchObject({ kind: 'folder', path: '/a' });
    expect(rootListing.items![0]!.directory_id).toEqual(expect.any(String));
    expect(rootListing.items![0]).not.toHaveProperty('duplicate');
    const nested = await body(await list(f.driveId, write, 'prefix=%2Fa&delimiter=%2F'));
    expect(nested.items).toEqual([expect.objectContaining({ kind: 'folder', path: '/a/b' })]);
  });

  it('enforces write and delete scopes plus write-path restrictions on directory changes', async () => {
    const f = await fixture();
    const writer = await f.issue(['write'], ['/allowed']);
    const reader = await f.issue(['read']);
    const deleter = await f.issue(['delete'], ['/allowed']);

    expect((await mkdir(f.driveId, reader, '/allowed')).status).toBe(403);
    expect((await mkdir(f.driveId, writer, '/outside')).status).toBe(403);
    expect((await mkdir(f.driveId, writer, '/allowed')).status).toBe(201);
    expect((await rmdir(f.driveId, writer, '/allowed')).status).toBe(403);
    expect((await rmdir(f.driveId, deleter, '/allowed')).status).toBe(200);
    expect((await rmdir(f.driveId, deleter, '/outside')).status).toBe(403);
  });

  it('rejects noncanonical paths and never permits root removal', async () => {
    const f = await fixture();
    const write = await f.issue(['read', 'write', 'delete']);
    for (const path of [
      '/',
      '/a/',
      '/a//b',
      '/a/../b',
      '/a/./b',
      '/a\\b',
      `/${'x'.repeat(1024)}`,
    ]) {
      expect((await mkdir(f.driveId, write, path)).status).toBe(400);
      expect((await rmdir(f.driveId, write, path)).status).toBe(400);
    }
    expect((await rmdir(f.driveId, write, '/')).status).toBe(400);
  });

  it('removes only an explicitly stored empty directory and leaves children untouched on conflict', async () => {
    const f = await fixture();
    const writeDelete = await f.issue(['read', 'write', 'delete']);
    await mkdir(f.driveId, writeDelete, '/box');
    await mkdir(f.driveId, writeDelete, '/box/empty-child');
    await seedFile(f.driveId, f.agentId, '/box/child.txt');

    expect((await rmdir(f.driveId, writeDelete, '/box')).status).toBe(409);
    expect((await rmdir(f.driveId, writeDelete, '/box/empty-child')).status).toBe(200);
    expect((await rmdir(f.driveId, writeDelete, '/box')).status).toBe(409);
    expect((await rmdir(f.driveId, writeDelete, '/box/child.txt')).status).toBe(404);
    const remaining = await pool.query('SELECT path FROM files WHERE drive_id=$1', [f.driveId]);
    expect(remaining.rows.map((row) => row.path)).toEqual(['/box/child.txt']);
  });

  it('rejects collisions with file paths and pre-existing implicit directories without rewriting them', async () => {
    const f = await fixture();
    const write = await f.issue(['read', 'write']);
    await seedFile(f.driveId, f.agentId, '/taken');
    await seedFile(f.driveId, f.agentId, '/virtual/child.txt');
    await seedFile(f.driveId, f.agentId, '/trashed', true);

    expect((await mkdir(f.driveId, write, '/taken')).status).toBe(409);
    expect((await mkdir(f.driveId, write, '/virtual')).status).toBe(409);
    expect((await mkdir(f.driveId, write, '/trashed')).status).toBe(409);
    expect((await mkdir(f.driveId, write, '/taken/child')).status).toBe(409);
    const files = await pool.query('SELECT path FROM files WHERE drive_id=$1 ORDER BY path', [
      f.driveId,
    ]);
    expect(files.rows.map((row) => row.path)).toEqual(['/taken', '/trashed', '/virtual/child.txt']);
    const directories = await pool.query('SELECT path FROM drive_directories WHERE drive_id=$1', [
      f.driveId,
    ]);
    expect(directories.rows).toEqual([]);
  });

  it('rejects explicit directories beneath live file ancestors even when descendants imply the parent', async () => {
    const f = await fixture();
    const write = await f.issue(['read', 'write']);
    await seedFile(f.driveId, f.agentId, '/notes');
    await seedFile(f.driveId, f.agentId, '/notes/old.txt');
    await seedFile(f.driveId, f.agentId, '/top');
    await seedFile(f.driveId, f.agentId, '/top/notes/old.txt');
    await seedFile(f.driveId, f.agentId, '/plain/old.txt');

    expect((await mkdir(f.driveId, write, '/notes/drafts')).status).toBe(409);
    expect((await mkdir(f.driveId, write, '/top/notes/drafts')).status).toBe(409);
    expect((await mkdir(f.driveId, write, '/plain/drafts')).status).toBe(201);

    const directories = await pool.query<{ path: string }>(
      'SELECT path FROM drive_directories WHERE drive_id=$1 ORDER BY path',
      [f.driveId],
    );
    expect(directories.rows).toEqual([{ path: '/plain/drafts' }]);
  });

  it('prevents new put, move and copy destinations from shadowing explicit directories', async () => {
    const f = await fixture({ quotaBytes: 100 });
    const write = await f.issue(['read', 'write', 'delete']);
    await mkdir(f.driveId, write, '/explicit');
    await seedFile(f.driveId, f.agentId, '/nested/existing.txt');
    await mkdir(f.driveId, write, '/nested/child-directory');
    expect(
      (
        await request(`/drives/${f.driveId}/delete`, write, 'POST', {
          path: '/nested/existing.txt',
        })
      ).status,
    ).toBe(200);
    await seedFile(f.driveId, f.agentId, '/source.txt');

    const intent = await request(`/drives/${f.driveId}/put`, write, 'POST', {
      path: '/explicit',
      ciphertextSize: 1,
      wrappedKey: 'synthetic-wrapped-key',
    });
    expect(intent.status).toBe(409);
    const ancestorIntent = await request(`/drives/${f.driveId}/put`, write, 'POST', {
      path: '/nested',
      ciphertextSize: 1,
      wrappedKey: 'synthetic-wrapped-key',
    });
    expect(ancestorIntent.status).toBe(409);
    const intents = await pool.query(
      'SELECT id FROM upload_intents WHERE drive_id=$1 AND path=$2',
      [f.driveId, '/explicit'],
    );
    expect(intents.rows).toEqual([]);

    expect(
      (
        await request(`/drives/${f.driveId}/move`, write, 'POST', {
          path: '/source.txt',
          destinationPath: '/explicit',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/drives/${f.driveId}/copy`, write, 'POST', {
          path: '/source.txt',
          destinationPath: '/explicit',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/drives/${f.driveId}/move`, write, 'POST', {
          path: '/source.txt',
          destinationPath: '/nested',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/drives/${f.driveId}/move`, write, 'POST', {
          path: '/source.txt',
          destinationPath: '/nested/child.txt',
        })
      ).status,
    ).toBe(200);
    const file = await pool.query('SELECT path FROM files WHERE drive_id=$1 AND path=$2', [
      f.driveId,
      '/nested/child.txt',
    ]);
    expect(file.rows).toHaveLength(1);
  });

  it('keeps explicit-only ancestors visible and counts their immediate children and bytes', async () => {
    const f = await fixture();
    const readWriteDelete = await f.issue(['read', 'write', 'delete']);
    await seedFile(f.driveId, f.agentId, '/a/file.txt');
    await mkdir(f.driveId, readWriteDelete, '/a/b');

    expect(
      (
        await request(`/drives/${f.driveId}/delete`, readWriteDelete, 'POST', {
          path: '/a/file.txt',
        })
      ).status,
    ).toBe(200);

    const rootListing = await body(await list(f.driveId, readWriteDelete, 'delimiter=%2F'));
    expect(rootListing.items).toEqual([
      expect.objectContaining({ kind: 'folder', path: '/a', items: 1, ciphertext_size: '0' }),
    ]);
    expect(rootListing.items![0]!.directory_id).toBeUndefined();

    const nested = await body(await list(f.driveId, readWriteDelete, 'prefix=%2Fa&delimiter=%2F'));
    expect(nested.items).toEqual([
      expect.objectContaining({
        kind: 'folder',
        path: '/a/b',
        directory_id: expect.any(String),
        items: 0,
        ciphertext_size: '0',
      }),
    ]);

    expect((await mkdir(f.driveId, readWriteDelete, '/a/c')).status).toBe(201);
    const withSiblingDirectory = await body(
      await list(f.driveId, readWriteDelete, 'prefix=%2Fa&delimiter=%2F'),
    );
    expect(withSiblingDirectory.items!.map((item) => item.path)).toEqual(['/a/b', '/a/c']);
    const withDirectoryAncestor = await body(
      await list(f.driveId, readWriteDelete, 'delimiter=%2F'),
    );
    expect(withDirectoryAncestor.items).toEqual([
      expect.objectContaining({ kind: 'folder', path: '/a', items: 2, ciphertext_size: '0' }),
    ]);

    await seedFile(f.driveId, f.agentId, '/a/live.txt');
    const withSibling = await body(await list(f.driveId, readWriteDelete, 'delimiter=%2F'));
    expect(withSibling.items![0]).toMatchObject({ items: 3, ciphertext_size: '7' });
  });

  it('merges explicit empty and implicit folders once, with stable cursors and existing file filters', async () => {
    const f = await fixture();
    const write = await f.issue(['read', 'write']);
    const otherAgentId = (
      await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
        f.accountId,
        `directory-filter-${randomUUID()}`,
      ])
    ).rows[0]!.id as string;
    const other = await f.issue(['read']);

    await mkdir(f.driveId, write, '/empty');
    await mkdir(f.driveId, write, '/mixed');
    await mkdir(f.driveId, write, '/mixed/sub');
    await mkdir(f.driveId, write, '/filtered-empty');
    await seedFile(f.driveId, f.agentId, '/mixed/a.txt');
    await seedFile(f.driveId, otherAgentId, '/mixed/sub/b.txt');
    await seedFile(f.driveId, f.agentId, '/legacy');
    await seedFile(f.driveId, f.agentId, '/legacy/child.txt');

    const rootListing = await body(await list(f.driveId, write, 'delimiter=%2F'));
    const labels = rootListing.items!.map((item) => `${item.kind}:${item.path}`);
    expect(labels).toEqual([
      'folder:/empty',
      'folder:/filtered-empty',
      'file:/legacy',
      'folder:/legacy',
      'folder:/mixed',
    ]);
    expect(
      rootListing.items!.filter((item) => item.path === '/mixed' && item.kind === 'folder'),
    ).toHaveLength(1);
    expect(rootListing.items!.find((item) => item.path === '/empty')!.directory_id).toEqual(
      expect.any(String),
    );
    expect(rootListing.items!.find((item) => item.path === '/mixed')).toMatchObject({
      items: 2,
      ciphertext_size: '14',
    });

    const mixed = await body(await list(f.driveId, write, 'prefix=%2Fmixed&delimiter=%2F'));
    expect(mixed.items!.map((item) => `${item.kind}:${item.path}`)).toEqual([
      'file:/mixed/a.txt',
      'folder:/mixed/sub',
    ]);
    expect(mixed.items![1]).toMatchObject({ items: 1, ciphertext_size: '7' });

    const filtered = await body(
      await list(f.driveId, other, `delimiter=%2F&agentId=${otherAgentId}`),
    );
    expect(filtered.items!.map((item) => `${item.kind}:${item.path}`)).toEqual([
      'folder:/empty',
      'folder:/filtered-empty',
      'folder:/mixed',
    ]);
    expect(filtered.items!.find((item) => item.path === '/mixed')!.directory_id).toEqual(
      expect.any(String),
    );

    for (const sort of ['path', 'modified']) {
      const expected = (await body(await list(f.driveId, write, `delimiter=%2F&sort=${sort}`)))
        .items!;
      const walked: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const query = `delimiter=%2F&sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await body(await list(f.driveId, write, query));
        expect(page.items).toHaveLength(1);
        walked.push(`${page.items![0]!.kind}:${page.items![0]!.path}`);
        cursor = page.nextCursor ?? null;
        if (!cursor) break;
      }
      expect(walked).toEqual(expected.map((item) => `${item.kind}:${item.path}`));
      expect(new Set(walked).size).toBe(walked.length);
    }
  });

  it('does not charge empty directory metadata against ciphertext storage quota', async () => {
    const f = await fixture({ quotaBytes: 1 });
    const write = await f.issue(['read', 'write']);
    for (const name of ['one', 'two', 'three', 'four']) {
      expect((await mkdir(f.driveId, write, `/${name}`)).status).toBe(201);
    }
    const usage = await pool.query(
      `SELECT (SELECT COALESCE(SUM(ciphertext_size),0) FROM versions WHERE drive_id=$1)::text AS bytes,
              (SELECT count(*) FROM drive_directories WHERE drive_id=$1)::int AS directories`,
      [f.driveId],
    );
    expect(usage.rows[0]).toEqual({ bytes: '0', directories: 4 });
  });
});

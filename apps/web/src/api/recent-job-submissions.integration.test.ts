import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest } from './handler';
import { encodeCursor } from './validation';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const root = 'http://agent-drive.test/api/v1';
const accountIds: string[] = [];
let driveId = '';
let agentId = '';
let token = '';
let foreignDriveId = '';
let foreignAgentId = '';
let foreignToken = '';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  return handleApiRequest(
    new Request(
      `${root}${path}`,
      (() => {
        const init: RequestInit = {
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
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

async function fixture(label: string, scopes: string[], driveIds?: string[]) {
  const accountId = (
    await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      `${label}-${randomUUID()}`,
    ])
  ).rows[0].id as string;
  accountIds.push(accountId);
  const agentId = (
    await pool.query('INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id', [
      accountId,
      `${label}-agent`,
    ])
  ).rows[0].id as string;
  const drive = await pool.query(
    'INSERT INTO drives (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `${label}-drive`],
  );
  const id = drive.rows[0].id as string;
  const token = key();
  await pool.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::text[])`,
    [accountId, agentId, 'job-submissions', tokenHash(token), driveIds ?? [id], scopes],
  );
  return { accountId, agentId, driveId: id, token };
}

async function seedFile(drive: string, agent: string, path: string, trashed = false) {
  const fileId = randomUUID();
  const versionId = randomUUID();
  await pool.query('INSERT INTO files (id,drive_id,path,deleted_at) VALUES ($1,$2,$3,$4)', [
    fileId,
    drive,
    path,
    trashed ? new Date() : null,
  ]);
  await pool.query(
    `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,$4,64,'synthetic-wrapped-key',$5)`,
    [versionId, fileId, drive, `objects/job-submissions/${versionId}`, agent],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  return { fileId, versionId };
}

async function lastEventId(drive: string) {
  return (
    await pool.query<{ id: string }>(
      'SELECT id FROM file_events WHERE drive_id = $1 ORDER BY file_events.seq DESC LIMIT 1',
      [drive],
    )
  ).rows[0]!.id;
}

/** A normal API move: the same event the native mount, CLI and dashboard submissions record. */
async function move(drive: string, path: string, destinationPath: string) {
  const response = await request(`/drives/${drive}/move`, token, 'POST', {
    path,
    destinationPath,
  });
  expect(response.status).toBe(200);
  return lastEventId(drive);
}

/** The guarded rename the CLI and dashboard Submit actions use. */
async function submitByRename(
  drive: string,
  path: string,
  destinationPath: string,
  versionId: string,
) {
  const response = await request(`/drives/${drive}/rename`, token, 'POST', {
    path,
    destinationPath,
    ifSourceVersionId: versionId,
    ifDestinationVersionId: null,
    operationId: randomUUID(),
  });
  expect(response.status).toBe(200);
  return lastEventId(drive);
}

async function submissions(drive: string, query = '', bearer: string | undefined = token) {
  const response = await request(`/drives/${drive}/recent?jobSubmissions=1${query}`, bearer);
  return { response, body: await json(response) };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const main = await fixture('job-submissions-main', ['read', 'write', 'delete']);
  driveId = main.driveId;
  agentId = main.agentId;
  token = main.token;
  const foreign = await fixture('job-submissions-foreign', ['read', 'write', 'delete']);
  foreignDriveId = foreign.driveId;
  foreignAgentId = foreign.agentId;
  foreignToken = foreign.token;
});

afterAll(async () => {
  for (const id of accountIds) {
    await pool.query('DELETE FROM audit_events WHERE account_id = $1', [id]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
      [id],
    );
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }
  await pool.end();
});

describe('recent jobSubmissions feed', () => {
  it('lists only request.md moves that landed on submitted.md in the same job directory', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    const eventId = await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);

    const { response, body } = await submissions(driveId);
    expect(response.status).toBe(200);
    const item = body.items.find((entry: { id: string }) => entry.id === eventId);
    expect(item).toMatchObject({
      id: eventId,
      operation: 'move',
      path: `/jobs/${jobId}/submitted.md`,
      previousPath: `/jobs/${jobId}/request.md`,
      versionId: draft.versionId,
      agentId,
    });
  });

  it('includes guarded renames recorded by the CLI and dashboard Submit actions', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    const eventId = await submitByRename(
      driveId,
      `/jobs/${jobId}/request.md`,
      `/jobs/${jobId}/submitted.md`,
      draft.versionId,
    );

    const { body } = await submissions(driveId);
    expect(body.items.map((entry: { id: string }) => entry.id)).toContain(eventId);
  });

  it('keeps the original version even after the submitted file moves to a newer version', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    const eventId = await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);
    const nextVersionId = randomUUID();
    await pool.query(
      `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,32,'synthetic-wrapped-key',$5)`,
      [nextVersionId, draft.fileId, driveId, `objects/job-submissions/${nextVersionId}`, agentId],
    );
    await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [
      draft.fileId,
      nextVersionId,
    ]);

    const { body } = await submissions(driveId);
    const item = body.items.find((entry: { id: string }) => entry.id === eventId);
    expect(item?.versionId).toBe(draft.versionId);
    expect(item?.versionId).not.toBe(nextVersionId);
  });

  it('excludes non-move writes, different sources and foreign moves at submitted.md', async () => {
    const exclusions: string[] = [];
    // A direct write at submitted.md (put, copy or restore) is not a submission.
    const putJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const direct = await seedFile(driveId, agentId, `/jobs/${putJob}/submitted.md`);
    exclusions.push(
      (
        await pool.query<{ id: string }>(
          `INSERT INTO file_events (drive_id, file_id, operation, path, version_id, agent_id)
           VALUES ($1, $2, 'put', $3, $4, $5) RETURNING id`,
          [driveId, direct.fileId, `/jobs/${putJob}/submitted.md`, direct.versionId, agentId],
        )
      ).rows[0]!.id,
    );
    // A move from a different name inside the same job directory is not a submission.
    const notesJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${notesJob}/notes.md`);
    exclusions.push(
      await move(driveId, `/jobs/${notesJob}/notes.md`, `/jobs/${notesJob}/submitted.md`),
    );
    // A move from outside the job directory is not a submission.
    const outsideJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/inbox/${outsideJob}/request.md`);
    exclusions.push(
      await move(driveId, `/inbox/${outsideJob}/request.md`, `/jobs/${outsideJob}/submitted.md`),
    );
    // A move to a different destination is not a submission.
    const draftJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${draftJob}/request.md`);
    exclusions.push(
      await move(driveId, `/jobs/${draftJob}/request.md`, `/jobs/${draftJob}/notes.md`),
    );
    // A move event without a pinned version is not a submission.
    const nullJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const unversioned = await seedFile(driveId, agentId, `/jobs/${nullJob}/submitted.md`);
    exclusions.push(
      (
        await pool.query<{ id: string }>(
          `INSERT INTO file_events (drive_id, file_id, operation, path, previous_path, version_id, agent_id)
           VALUES ($1, $2, 'move', $3, $4, NULL, $5) RETURNING id`,
          [
            driveId,
            unversioned.fileId,
            `/jobs/${nullJob}/submitted.md`,
            `/jobs/${nullJob}/request.md`,
            agentId,
          ],
        )
      ).rows[0]!.id,
    );

    const { body } = await submissions(driveId);
    const ids = body.items.map((entry: { id: string }) => entry.id);
    for (const id of exclusions) expect(ids).not.toContain(id);
  });

  it('excludes a submission whose source file left the submitted path or was trashed', async () => {
    const movedJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${movedJob}/request.md`);
    const movedEvent = await move(
      driveId,
      `/jobs/${movedJob}/request.md`,
      `/jobs/${movedJob}/submitted.md`,
    );
    await move(driveId, `/jobs/${movedJob}/submitted.md`, `/jobs/${movedJob}/withdrawn.md`);

    const trashedJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const trashedDraft = await seedFile(driveId, agentId, `/jobs/${trashedJob}/request.md`);
    const trashedEvent = await move(
      driveId,
      `/jobs/${trashedJob}/request.md`,
      `/jobs/${trashedJob}/submitted.md`,
    );
    await pool.query('UPDATE files SET deleted_at = now() WHERE id = $1', [trashedDraft.fileId]);

    const { body } = await submissions(driveId);
    const ids = body.items.map((entry: { id: string }) => entry.id);
    expect(ids).not.toContain(movedEvent);
    expect(ids).not.toContain(trashedEvent);
  });

  it('excludes jobs with a worker receipt file, even a trashed one', async () => {
    const liveReceiptJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${liveReceiptJob}/request.md`);
    const liveReceiptEvent = await move(
      driveId,
      `/jobs/${liveReceiptJob}/request.md`,
      `/jobs/${liveReceiptJob}/submitted.md`,
    );
    await seedFile(driveId, agentId, `/jobs/.agent-drive/claims/${liveReceiptJob}.json`);

    const trashedReceiptJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${trashedReceiptJob}/request.md`);
    const trashedReceiptEvent = await move(
      driveId,
      `/jobs/${trashedReceiptJob}/request.md`,
      `/jobs/${trashedReceiptJob}/submitted.md`,
    );
    await seedFile(driveId, agentId, `/jobs/.agent-drive/claims/${trashedReceiptJob}.json`, true);

    const { body } = await submissions(driveId);
    const ids = body.items.map((entry: { id: string }) => entry.id);
    expect(ids).not.toContain(liveReceiptEvent);
    expect(ids).not.toContain(trashedReceiptEvent);
  });

  it('pages qualifying submissions in commit order and never crosses drives', async () => {
    const paged = await fixture('job-submissions-paged', ['read', 'write', 'delete']);
    const eventIds: string[] = [];
    for (const name of ['alpha', 'beta', 'gamma']) {
      const jobId = `job-${name}`;
      await seedFile(paged.driveId, paged.agentId, `/jobs/${jobId}/request.md`);
      const response = await request(`/drives/${paged.driveId}/move`, paged.token, 'POST', {
        path: `/jobs/${jobId}/request.md`,
        destinationPath: `/jobs/${jobId}/submitted.md`,
      });
      expect(response.status).toBe(200);
      eventIds.push(await lastEventId(paged.driveId));
    }
    // The same submission shape on another drive is never reported here.
    const foreignJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(foreignDriveId, foreignAgentId, `/jobs/${foreignJob}/request.md`);
    const foreignMove = await request(`/drives/${foreignDriveId}/move`, foreignToken, 'POST', {
      path: `/jobs/${foreignJob}/request.md`,
      destinationPath: `/jobs/${foreignJob}/submitted.md`,
    });
    expect(foreignMove.status).toBe(200);

    const first = await submissions(paged.driveId, '&limit=2', paged.token);
    expect(first.response.status).toBe(200);
    expect(first.body.items.map((entry: { id: string }) => entry.id)).toEqual(eventIds.slice(0, 2));
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await submissions(
      paged.driveId,
      `&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      paged.token,
    );
    expect(second.body.items.map((entry: { id: string }) => entry.id)).toEqual(eventIds.slice(2));
    expect(second.body.nextCursor).toBeNull();
    const foreignItems = await submissions(foreignDriveId, '&limit=50', foreignToken);
    const foreignIds = foreignItems.body.items.map((entry: { id: string }) => entry.id);
    for (const id of eventIds) expect(foreignIds).not.toContain(id);
  });

  it('requires read access to the drive, same as a paged recent', async () => {
    expect((await request(`/drives/${driveId}/recent?jobSubmissions=1`)).status).toBe(401);
    const writeOnly = await fixture('job-submissions-write-only', ['write'], [driveId]);
    expect(
      (await request(`/drives/${driveId}/recent?jobSubmissions=1`, writeOnly.token)).status,
    ).toBe(403);
    expect((await request(`/drives/${driveId}/recent?jobSubmissions=1`, foreignToken)).status).toBe(
      403,
    );
    expect((await request(`/drives/${driveId}/recent?jobSubmissions=1`, token)).status).toBe(200);
  });

  it('rejects invalid values and ambiguous combinations', async () => {
    const cursor = encodeURIComponent(
      encodeCursor({ value: '1', id: '00000000-0000-4000-8000-000000000001' }),
    );
    for (const query of [
      'jobSubmissions=0',
      'jobSubmissions=yes',
      'jobSubmissions',
      'jobSubmissions=1&head=1',
      'jobSubmissions=1&head=1&limit=1',
    ]) {
      expect((await request(`/drives/${driveId}/recent?${query}`, token)).status).toBe(400);
    }
    for (const query of [
      'jobSubmissions=1',
      `jobSubmissions=1&cursor=${cursor}`,
      'jobSubmissions=1&limit=1',
      'jobSubmissions=1&since=2020-01-01T00:00:00.000Z',
    ]) {
      expect((await request(`/drives/${driveId}/recent?${query}`, token)).status).toBe(200);
    }
  });

  it('leaves plain recent and head unchanged', async () => {
    const plain = await json(await request(`/drives/${driveId}/recent?limit=50`, token));
    const moveEvents = plain.items.filter(
      (entry: { operation: string }) => entry.operation === 'move',
    );
    expect(moveEvents.length).toBeGreaterThan(0);
    const head = await json(await request(`/drives/${driveId}/recent?head=1&limit=1`, token));
    expect(head.items).toEqual([]);
    expect(head.latestCursor).toEqual(expect.any(String));
  });
});

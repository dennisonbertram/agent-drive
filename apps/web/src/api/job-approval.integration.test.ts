import { createHash, randomUUID } from 'node:crypto';
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
    [accountId, agentId, 'job-approval', tokenHash(token), driveIds ?? [id], scopes],
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
    [versionId, fileId, drive, `objects/job-approval/${versionId}`, agent],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  return { fileId, versionId };
}

/** A new current version on an existing file: the rows a plain put commits. */
async function seedVersion(fileId: string, drive: string, agent: string) {
  const versionId = randomUUID();
  await pool.query(
    `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
     VALUES ($1,$2,$3,$4,32,'synthetic-wrapped-key',$5)`,
    [versionId, fileId, drive, `objects/job-approval/${versionId}`, agent],
  );
  await pool.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
  return versionId;
}

async function move(drive: string, path: string, destinationPath: string) {
  const response = await request(`/drives/${drive}/move`, token, 'POST', {
    path,
    destinationPath,
  });
  expect(response.status).toBe(200);
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
}

async function approval(drive: string, jobId: string, query = '', bearer?: string | null) {
  const response = await request(
    `/drives/${drive}/get?path=${encodeURIComponent(`/jobs/${jobId}/submitted.md`)}&metadataOnly=1&jobApproval=1${query}`,
    bearer === undefined ? token : (bearer ?? undefined),
  );
  return { response, body: await json(response) };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
  const main = await fixture('job-approval-main', ['read', 'write', 'delete']);
  driveId = main.driveId;
  agentId = main.agentId;
  token = main.token;
  const foreign = await fixture('job-approval-foreign', ['read', 'write', 'delete']);
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

describe('get jobApproval mode', () => {
  it('returns the version the live file was submitted at, marked jobApproval', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    await submitByRename(
      driveId,
      `/jobs/${jobId}/request.md`,
      `/jobs/${jobId}/submitted.md`,
      draft.versionId,
    );

    const { response, body } = await approval(driveId, jobId);
    expect(response.status).toBe(200);
    expect(body.jobApproval).toBe(true);
    expect(body.id).toBe(draft.versionId);
    expect(body.path).toBe(`/jobs/${jobId}/submitted.md`);
    expect(body.downloadUrl).toBeUndefined();
  });

  it('resolves the newest qualifying submission after re-approval, never a newer unapproved write', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draftA = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    // Approval A: a genuine guarded rename submission.
    await submitByRename(
      driveId,
      `/jobs/${jobId}/request.md`,
      `/jobs/${jobId}/submitted.md`,
      draftA.versionId,
    );
    // Back-to-draft: the file returns to request.md and gains a newer draft version.
    await move(driveId, `/jobs/${jobId}/submitted.md`, `/jobs/${jobId}/request.md`);
    const draftB = await seedVersion(draftA.fileId, driveId, agentId);
    // Approval B: the newer draft is submitted again.
    await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);
    // An unapproved newer write C lands on submitted.md without any submission.
    const unapproved = await seedVersion(draftA.fileId, driveId, agentId);
    await pool.query(
      `INSERT INTO file_events (drive_id, file_id, operation, path, version_id, agent_id)
       VALUES ($1, $2, 'put', $3, $4, $5)`,
      [driveId, draftA.fileId, `/jobs/${jobId}/submitted.md`, unapproved, agentId],
    );

    const { response, body } = await approval(driveId, jobId);
    expect(response.status).toBe(200);
    expect(body.jobApproval).toBe(true);
    expect(body.id).toBe(draftB);
    expect(body.id).not.toBe(draftA.versionId);
    expect(body.id).not.toBe(unapproved);
  });

  it('returns 404 when the file was never submitted by a qualifying move', async () => {
    // A file that merely appears at submitted.md (a put) has no approval.
    const putJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${putJob}/submitted.md`);
    expect((await approval(driveId, putJob)).response.status).toBe(404);

    // A submitted file that left the path has no approval at that path.
    const movedJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${movedJob}/request.md`);
    await move(driveId, `/jobs/${movedJob}/request.md`, `/jobs/${movedJob}/submitted.md`);
    await move(driveId, `/jobs/${movedJob}/submitted.md`, `/jobs/${movedJob}/withdrawn.md`);
    expect((await approval(driveId, movedJob)).response.status).toBe(404);

    // A submitted file in the trash has no approval.
    const trashedJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const trashed = await seedFile(driveId, agentId, `/jobs/${trashedJob}/request.md`);
    await move(driveId, `/jobs/${trashedJob}/request.md`, `/jobs/${trashedJob}/submitted.md`);
    await pool.query('UPDATE files SET deleted_at = now() WHERE id = $1', [trashed.fileId]);
    expect((await approval(driveId, trashedJob)).response.status).toBe(404);

    // A different file recreated at the path inherits no earlier approval.
    const replacedJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const original = await seedFile(driveId, agentId, `/jobs/${replacedJob}/request.md`);
    await move(driveId, `/jobs/${replacedJob}/request.md`, `/jobs/${replacedJob}/submitted.md`);
    await pool.query('DELETE FROM file_events WHERE file_id = $1', [original.fileId]);
    await pool.query('DELETE FROM versions WHERE file_id = $1', [original.fileId]);
    await pool.query('DELETE FROM files WHERE id = $1', [original.fileId]);
    await seedFile(driveId, agentId, `/jobs/${replacedJob}/submitted.md`);
    expect((await approval(driveId, replacedJob)).response.status).toBe(404);

    // A job that never existed is absent.
    expect((await approval(driveId, 'job-never')).response.status).toBe(404);
  });

  it('rejects unsupported values, paths and parameter combinations', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);
    const get = (path: string, query: string) =>
      request(`/drives/${driveId}/get?path=${encodeURIComponent(path)}${query}`, token);

    for (const query of [
      '&jobApproval=0',
      '&jobApproval=yes',
      '&jobApproval',
      '&metadataOnly=1&jobApproval=1&jobApproval=1',
      '&jobApproval=1',
      '&metadataOnly=0&jobApproval=1',
      `&metadataOnly=1&jobApproval=1&versionId=${draft.versionId}`,
      '&metadataOnly=1&jobApproval=1&range=bytes=0-1',
      '&metadataOnly=1&jobApproval=1&authorizeRange=1',
      '&metadataOnly=1&jobApproval=1&maxPlaintextBytes=1024',
      '&metadataOnly=1&jobApproval=1&authorizeIfWithinLimit=1',
    ]) {
      expect((await get(`/jobs/${jobId}/submitted.md`, query)).status).toBe(400);
    }
    for (const path of [
      `/jobs/${jobId}/request.md`,
      `/jobs/${jobId}/notes.md`,
      '/other/submitted.md',
      '/jobs/bad id/submitted.md',
      `/jobs/${jobId}/submitted.md/extra`,
    ]) {
      expect((await get(path, '&metadataOnly=1&jobApproval=1')).status).toBe(400);
    }
    expect((await get(`/jobs/${jobId}/submitted.md`, '&metadataOnly=1&jobApproval=1')).status).toBe(
      200,
    );
  });

  it('requires read access to the drive, same as a metadata get', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);

    expect((await approval(driveId, jobId, '', null)).response.status).toBe(401);
    const writeOnly = await fixture('job-approval-write-only', ['write'], [driveId]);
    expect((await approval(driveId, jobId, '', writeOnly.token)).response.status).toBe(403);
    expect((await approval(driveId, jobId, '', foreignToken)).response.status).toBe(403);
    expect((await approval(driveId, jobId)).response.status).toBe(200);
    // The same submission shape on a foreign drive is never answered here.
    const foreignJob = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await seedFile(foreignDriveId, foreignAgentId, `/jobs/${foreignJob}/request.md`);
    expect((await approval(foreignDriveId, foreignJob)).response.status).toBe(403);
  });

  it('leaves ordinary metadata gets unmarked and unchanged', async () => {
    const jobId = `job-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const draft = await seedFile(driveId, agentId, `/jobs/${jobId}/request.md`);
    await move(driveId, `/jobs/${jobId}/request.md`, `/jobs/${jobId}/submitted.md`);

    const response = await request(
      `/drives/${driveId}/get?path=${encodeURIComponent(`/jobs/${jobId}/submitted.md`)}&metadataOnly=1`,
      token,
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.id).toBe(draft.versionId);
    expect(body.jobApproval).toBeUndefined();
  });
});

import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TransactionCommitUnknownError, withTransaction } from '../db/client';
import { enforceOperationBudget } from '../billing/ledger';
import { ApiError } from './errors';
import { deleteObject } from './storage';
import { handleApiRequest } from './handler';

vi.mock('../db/client', async (original) => {
  const actual = await original<typeof import('../db/client')>();
  return { ...actual, withTransaction: vi.fn(actual.withTransaction) };
});

vi.mock('../billing/ledger', async (original) => {
  const actual = await original<typeof import('../billing/ledger')>();
  return { ...actual, enforceOperationBudget: vi.fn(actual.enforceOperationBudget) };
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
    [`mount-rename-budget-${randomUUID()}`],
  );
  const accountId = account.rows[0]!.id;
  accountIds.push(accountId);
  const agent = await pool.query<{ id: string }>(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `rename-budget-agent-${randomUUID()}`],
  );
  const agentId = agent.rows[0]!.id;
  const drive = await pool.query<{ id: string }>(
    'INSERT INTO drives (account_id,name,quota_bytes) VALUES ($1,$2,$3) RETURNING id',
    [accountId, `rename-budget-drive-${randomUUID()}`, quotaBytes],
  );
  const driveId = drive.rows[0]!.id;
  const token = makeToken();
  const key = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'rename-budget-test',$3,$4::uuid[],ARRAY['read','write','delete']::text[])
     RETURNING id`,
    [accountId, agentId, tokenHash(token), [driveId]],
  );
  return { accountId, agentId, apiKeyId: key.rows[0]!.id, driveId, token };
}

async function uploadCommit(token: string, driveId: string, path: string, bytes: Buffer) {
  const intentResponse = await request(`/drives/${driveId}/put`, token, {
    path,
    ciphertextSize: bytes.length,
    wrappedKey: 'synthetic-wrapped-key',
  });
  expect(intentResponse.status).toBe(201);
  const intent = await json(intentResponse);
  const uploaded = await fetch(intent.uploadUrl, { method: 'PUT', body: new Uint8Array(bytes) });
  expect(uploaded.ok).toBe(true);
  const committed = await request(`/drives/${driveId}/commit`, token, {
    intentId: intent.intentId,
  });
  expect([200, 201]).toContain(committed.status);
  return { ...(await json(committed)).version, intentId: intent.intentId } as {
    id: string;
    intentId: string;
  };
}

async function makePendingIntent(f: Awaited<ReturnType<typeof fixture>>, size: number) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO upload_intents
       (id,api_key_id,account_id,agent_id,drive_id,path,staging_key,ciphertext_size,
        wrapped_key,conditional_mode,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'synthetic-wrapped-key','unconditional',now()+interval '10 minutes')`,
    [
      id,
      f.apiKeyId,
      f.accountId,
      f.agentId,
      f.driveId,
      `/pending-${id}`,
      `staging/${f.accountId}/${f.driveId}/${id}`,
      size,
    ],
  );
}

async function getBytes(token: string, driveId: string, path: string) {
  const query = new URLSearchParams({ path });
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
  vi.mocked(withTransaction).mockReset();
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

describe('mount rename operation accounting and quota reservations', () => {
  it('returns a matched receipt without charging another operation, while separate writes still count', async () => {
    const f = await fixture();
    const source = await uploadCommit(f.token, f.driveId, '/.editor-temp-a', Buffer.from('one'));
    const body = {
      path: '/.editor-temp-a',
      destinationPath: '/one.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    };

    const first = await rename(f.driveId, f.token, body);
    expect(first.status).toBe(200);
    const beforeReplay = await pool.query<{ operations: number }>(
      `SELECT count(*)::int AS operations FROM audit_events
        WHERE account_id=$1 AND outcome='success' AND action <> 'drive.rename.replay'`,
      [f.accountId],
    );
    const actualLedger =
      await vi.importActual<typeof import('../billing/ledger')>('../billing/ledger');
    vi.mocked(enforceOperationBudget).mockRejectedValue(
      new ApiError('payment_required', 'Synthetic exhausted operation budget.'),
    );
    try {
      const replay = await rename(f.driveId, f.token, body);
      expect(replay.status).toBe(200);
      expect(await json(replay)).toEqual(await json(first));
    } finally {
      vi.mocked(enforceOperationBudget).mockImplementation(actualLedger.enforceOperationBudget);
    }
    const afterReplay = await pool.query<{ operations: number; replay: number }>(
      `SELECT count(*) FILTER (WHERE outcome='success' AND action <> 'drive.rename.replay')::int AS operations,
              count(*) FILTER (WHERE action='drive.rename.replay' AND outcome='success')::int AS replay
         FROM audit_events WHERE account_id=$1`,
      [f.accountId],
    );
    expect(afterReplay.rows[0]).toEqual({
      operations: beforeReplay.rows[0]!.operations,
      replay: 1,
    });

    const anotherSource = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-temp-b',
      Buffer.from('two'),
    );
    const beforeAnotherWrite = await pool.query<{ operations: number }>(
      `SELECT count(*)::int AS operations FROM audit_events
        WHERE account_id=$1 AND outcome='success' AND action <> 'drive.rename.replay'`,
      [f.accountId],
    );
    const anotherWrite = await rename(f.driveId, f.token, {
      path: '/.editor-temp-b',
      destinationPath: '/two.txt',
      ifSourceVersionId: anotherSource.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    expect(anotherWrite.status).toBe(200);
    const afterWrite = await pool.query<{ operations: number }>(
      `SELECT count(*)::int AS operations FROM audit_events
        WHERE account_id=$1 AND outcome='success' AND action <> 'drive.rename.replay'`,
      [f.accountId],
    );
    expect(afterWrite.rows[0]!.operations).toBe(beforeAnotherWrite.rows[0]!.operations + 1);
  });

  it('does not bill two concurrent requests for one operation id twice', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-temp-concurrent',
      Buffer.from('one'),
    );
    const body = {
      path: '/.editor-temp-concurrent',
      destinationPath: '/concurrent.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    };
    const actual = await vi.importActual<typeof import('../db/client')>('../db/client');
    let pendingReservations = 0;
    let releaseReservations: () => void = () => {};
    const bothReserved = new Promise<void>((resolveBoth) => {
      releaseReservations = resolveBoth;
    });
    let resumeFirst: () => void = () => {};
    const firstCanContinue = new Promise<void>((resolveFirst) => {
      resumeFirst = resolveFirst;
    });
    vi.mocked(withTransaction).mockImplementation(async (callback) => {
      const result = await actual.withTransaction(callback);
      if (typeof result === 'string') {
        pendingReservations += 1;
        if (pendingReservations === 1) await firstCanContinue;
        if (pendingReservations === 2) releaseReservations();
      }
      return result;
    });
    try {
      const first = rename(f.driveId, f.token, body);
      await vi.waitFor(() => expect(pendingReservations).toBe(1));
      const second = rename(f.driveId, f.token, body);
      await vi.waitFor(() => expect(pendingReservations).toBe(2));
      await bothReserved;
      resumeFirst();
      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(await json(firstResponse)).toEqual(await json(secondResponse));
      const audited = await pool.query<{ action: string; outcome: string; count: number }>(
        `SELECT action,outcome,count(*)::int AS count FROM audit_events
          WHERE account_id=$1 AND action IN ('drive.rename','drive.rename.replay')
          GROUP BY action,outcome ORDER BY action,outcome`,
        [f.accountId],
      );
      expect(audited.rows).toEqual([
        { action: 'drive.rename', outcome: 'success', count: 1 },
        { action: 'drive.rename.replay', outcome: 'success', count: 1 },
      ]);
    } finally {
      resumeFirst();
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
    }
  });

  it("does not return another agent's receipt", async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-temp-c',
      Buffer.from('secret result'),
    );
    const body = {
      path: '/.editor-temp-c',
      destinationPath: '/three.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    };
    const first = await rename(f.driveId, f.token, body);
    expect(first.status).toBe(200);
    const otherAgent = await pool.query<{ id: string }>(
      'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
      [f.accountId, `other-rename-agent-${randomUUID()}`],
    );
    const otherToken = makeToken();
    await pool.query(
      `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
       VALUES ($1,$2,'other-rename-agent',$3,$4::uuid[],ARRAY['read','write','delete']::text[])`,
      [f.accountId, otherAgent.rows[0]!.id, tokenHash(otherToken), [f.driveId]],
    );
    const replay = await rename(f.driveId, otherToken, body);
    expect(replay.status).toBe(409);
    expect(await json(replay)).not.toEqual(await json(first));
  });

  it('counts a rename once when the mutation commits but its acknowledgement is lost', async () => {
    const f = await fixture();
    const source = await uploadCommit(
      f.token,
      f.driveId,
      '/.editor-temp-lost-ack',
      Buffer.from('new destination contents'),
    );
    const target = await uploadCommit(
      f.token,
      f.driveId,
      '/lost-ack.txt',
      Buffer.from('previous destination contents'),
    );
    const body = {
      path: '/.editor-temp-lost-ack',
      destinationPath: '/lost-ack.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
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

      const operations = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_events
          WHERE account_id=$1 AND action='drive.rename' AND outcome='success'`,
        [f.accountId],
      );
      expect(operations.rows[0]!.count).toBe(1);
      const audit = await pool.query<{ action: string; outcome: string; count: number }>(
        `SELECT action,outcome,count(*)::int AS count FROM audit_events
          WHERE account_id=$1 AND action IN ('drive.rename','drive.rename.replay')
          GROUP BY action,outcome ORDER BY action,outcome`,
        [f.accountId],
      );
      expect(audit.rows).toEqual([
        { action: 'drive.rename', outcome: 'success', count: 1 },
        { action: 'drive.rename.replay', outcome: 'success', count: 1 },
      ]);
    } finally {
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
    }
  });

  it('rejects replacement during prepare when active uploads reserve the remaining drive quota', async () => {
    const f = await fixture(100);
    const source = await uploadCommit(f.token, f.driveId, '/.editor-temp-d', Buffer.alloc(40, 1));
    const target = await uploadCommit(f.token, f.driveId, '/target.txt', Buffer.alloc(20, 2));
    await makePendingIntent(f, 30);

    const response = await rename(f.driveId, f.token, {
      path: '/.editor-temp-d',
      destinationPath: '/target.txt',
      ifSourceVersionId: source.id,
      ifDestinationVersionId: target.id,
      operationId: randomUUID(),
    });

    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe('quota_exceeded');
    expect((await getBytes(f.token, f.driveId, '/.editor-temp-d')).bytes).toEqual(
      Buffer.alloc(40, 1),
    );
    expect((await getBytes(f.token, f.driveId, '/target.txt')).bytes).toEqual(Buffer.alloc(20, 2));
    const successfulRenames = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
        WHERE account_id=$1 AND action='drive.rename' AND outcome='success'`,
      [f.accountId],
    );
    expect(successfulRenames.rows[0]!.count).toBe(0);
  });

  it('rechecks active upload reservations at commit after prepare', async () => {
    const f = await fixture(100);
    const source = await uploadCommit(f.token, f.driveId, '/.editor-temp-e', Buffer.alloc(40, 3));
    const target = await uploadCommit(f.token, f.driveId, '/target.txt', Buffer.alloc(20, 4));
    const actual = await vi.importActual<typeof import('../db/client')>('../db/client');
    let insertedReservation = false;
    vi.mocked(withTransaction).mockImplementation(async (callback) => {
      const result = await actual.withTransaction(callback);
      const prepared = result as { source?: unknown; destinationFileId?: string } | null;
      if (prepared?.source && prepared.destinationFileId && !insertedReservation) {
        insertedReservation = true;
        await makePendingIntent(f, 30);
      }
      return result;
    });
    try {
      const response = await rename(f.driveId, f.token, {
        path: '/.editor-temp-e',
        destinationPath: '/target.txt',
        ifSourceVersionId: source.id,
        ifDestinationVersionId: target.id,
        operationId: randomUUID(),
      });
      expect(insertedReservation).toBe(true);
      expect(response.status).toBe(413);
      expect((await json(response)).error.code).toBe('quota_exceeded');
      expect((await getBytes(f.token, f.driveId, '/.editor-temp-e')).bytes).toEqual(
        Buffer.alloc(40, 3),
      );
      expect((await getBytes(f.token, f.driveId, '/target.txt')).bytes).toEqual(
        Buffer.alloc(20, 4),
      );
      const versions = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM versions WHERE drive_id=$1',
        [f.driveId],
      );
      expect(versions.rows[0]!.count).toBe(2);
      const successfulRenames = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_events
          WHERE account_id=$1 AND action='drive.rename' AND outcome='success'`,
        [f.accountId],
      );
      expect(successfulRenames.rows[0]!.count).toBe(0);
    } finally {
      vi.mocked(withTransaction).mockImplementation(actual.withTransaction);
    }
  });
});

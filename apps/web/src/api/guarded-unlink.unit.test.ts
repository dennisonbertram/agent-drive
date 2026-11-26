import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Result = { rows: Row[]; rowCount: number };
  const ids = {
    account: '00000000-0000-4000-8000-000000000001',
    drive: '00000000-0000-4000-8000-000000000002',
    key: '00000000-0000-4000-8000-000000000003',
    agent: '00000000-0000-4000-8000-000000000004',
    machine: '00000000-0000-4000-8000-000000000005',
    file: '00000000-0000-4000-8000-000000000006',
    version: '00000000-0000-4000-8000-000000000007',
    newerVersion: '00000000-0000-4000-8000-000000000008',
    audit: '00000000-0000-4000-8000-000000000009',
  };
  const state = {
    scopes: ['delete'],
    driveIds: [ids.drive],
    writePaths: [] as string[],
    file: null as Row | null,
    updateAttempts: 0,
    events: [] as unknown[][],
    sql: [] as string[],
    openTransactions: 0,
  };
  const one = (row: Row): Result => ({ rows: [row], rowCount: 1 });
  const none = (): Result => ({ rows: [], rowCount: 0 });
  const query = async (text: string, params: unknown[] = []): Promise<Result> => {
    const sql = text.replace(/\s+/g, ' ');
    state.sql.push(sql);
    if (sql.includes('FROM api_keys k'))
      return one({
        id: ids.key,
        account_id: ids.account,
        agent_id: ids.agent,
        scopes: state.scopes,
        write_paths: state.writePaths,
        drive_ids: state.driveIds,
      });
    if (sql.includes('FROM drives d JOIN accounts'))
      return one({ id: ids.drive, account_id: ids.account, name: 'test', quota_bytes: '1000' });
    if (sql.includes('INSERT INTO audit_events')) return one({ id: ids.audit });
    if (sql.includes('UPDATE audit_events')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT id FROM drives WHERE id = $1 AND account_id = $2'))
      return one({ id: ids.drive });
    if (sql.includes('INSERT INTO machines')) return one({ id: ids.machine });
    if (sql.includes('FROM files') && sql.includes('FOR UPDATE')) {
      if (!state.file || params[0] !== ids.drive || params[1] !== state.file.path) return none();
      return one({ ...state.file });
    }
    if (sql.includes('UPDATE files SET deleted_at = now()')) {
      state.updateAttempts += 1;
      if (
        !state.file ||
        state.file.drive_id !== params[0] ||
        state.file.path !== params[1] ||
        (params[2] !== null && state.file.current_version_id !== params[2]) ||
        state.file.deleted_at !== null
      )
        return none();
      state.file.deleted_at = new Date('2026-01-01T00:00:00.000Z');
      return one({ ...state.file });
    }
    if (sql.includes('INSERT INTO file_events')) {
      state.events.push([sql, ...params]);
      return { rows: [], rowCount: 1 };
    }
    return none();
  };
  const client = { query, release: () => undefined };
  const pool = { query, connect: async () => client };
  const transaction: typeof import('../db/client').withTransaction = async (callback) => {
    state.openTransactions += 1;
    try {
      return await callback(client as never);
    } finally {
      state.openTransactions -= 1;
    }
  };
  return { ids, state, pool, transaction };
});

vi.mock('../db/client', async (original) => {
  const actual = await original<typeof import('../db/client')>();
  return {
    ...actual,
    getPool: () => harness.pool,
    withTransaction: vi.fn(harness.transaction),
  };
});

vi.mock('../billing/ledger', async (original) => {
  const actual = await original<typeof import('../billing/ledger')>();
  return {
    ...actual,
    lockBillingAccount: vi.fn(async () => ({})),
    enforceKeyRateLimit: vi.fn(async () => undefined),
  };
});

import { TransactionCommitUnknownError, withTransaction } from '../db/client';
import { handleApiRequest } from './handler';

const { ids, state } = harness;

const unlink = (body: unknown, driveId = ids.drive) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1/drives/${driveId}/unlink`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const legacyDelete = (body: unknown, driveId = ids.drive) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1/drives/${driveId}/delete`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const errorBody = async (response: Response) =>
  (await response.json()) as { error?: { code?: string } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withTransaction).mockImplementation(harness.transaction);
  state.scopes = ['delete'];
  state.driveIds = [ids.drive];
  state.writePaths = [];
  state.file = {
    id: ids.file,
    drive_id: ids.drive,
    path: '/docs/item.txt',
    current_version_id: ids.version,
    deleted_at: null,
  };
  state.updateAttempts = 0;
  state.events = [];
  state.sql = [];
  state.openTransactions = 0;
});

describe('guarded unlink endpoint', () => {
  it('preserves the legacy delete route, scope, path restriction, and response', async () => {
    state.scopes = ['write'];
    let response = await legacyDelete({ path: '/docs/item.txt' });
    expect(response.status).toBe(403);
    expect(state.updateAttempts).toBe(0);

    state.scopes = ['delete'];
    state.writePaths = ['/allowed'];
    response = await legacyDelete({ path: '/docs/item.txt' });
    expect(response.status).toBe(403);
    expect(state.updateAttempts).toBe(0);

    state.writePaths = [];
    response = await legacyDelete({ path: '/docs/item.txt' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: ids.file,
      path: '/docs/item.txt',
      deleted_at: '2026-01-01T00:00:00.000Z',
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.[0]).toContain("'delete'");
  });

  it('requires delete scope, a scoped drive, and a permitted exact path', async () => {
    state.scopes = ['write'];
    let response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error?.code).toBe('permission_denied');

    state.scopes = ['delete'];
    state.driveIds = [];
    response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(403);

    state.driveIds = [ids.drive];
    state.writePaths = ['/allowed'];
    response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(403);
    expect(state.updateAttempts).toBe(0);
  });

  it('unlinks only the exact current version under the billing, drive, and file locks', async () => {
    const response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ids.file, path: '/docs/item.txt' });
    expect(state.file?.deleted_at).toBeInstanceOf(Date);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.[0]).toContain("'delete'");
    const driveLock = state.sql.findIndex((sql) => sql.includes('SELECT id FROM drives'));
    const fileLock = state.sql.findIndex(
      (sql) => sql.includes('FROM files') && sql.includes('FOR UPDATE'),
    );
    const update = state.sql.findIndex((sql) =>
      sql.includes('UPDATE files SET deleted_at = now()'),
    );
    expect(driveLock).toBeGreaterThanOrEqual(0);
    expect(fileLock).toBeGreaterThan(driveLock);
    expect(update).toBeGreaterThan(fileLock);
  });

  it('returns conflict for a stale version and not found for an already absent target', async () => {
    state.file!.current_version_id = ids.newerVersion;
    let response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(409);
    expect((await errorBody(response)).error?.code).toBe('conflict');
    expect(state.file?.deleted_at).toBeNull();
    expect(state.updateAttempts).toBe(0);

    state.file = null;
    response = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(response.status).toBe(404);
    expect((await errorBody(response)).error?.code).toBe('not_found');
  });

  it('preserves a newer file when retrying after a lost unlink acknowledgement', async () => {
    vi.mocked(withTransaction).mockImplementationOnce(async (callback) => {
      await harness.transaction(callback);
      throw new TransactionCommitUnknownError(new Error('lost commit acknowledgement'));
    });
    const first = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(first.status).toBe(500);
    expect(state.file?.deleted_at).toBeInstanceOf(Date);

    state.file!.current_version_id = ids.newerVersion;
    state.file!.deleted_at = null;
    const retry = await unlink({ path: '/docs/item.txt', ifVersionId: ids.version });
    expect(retry.status).toBe(409);
    expect(state.file?.current_version_id).toBe(ids.newerVersion);
    expect(state.file?.deleted_at).toBeNull();
    expect(state.updateAttempts).toBe(1);
  });

  it('requires a valid version guard instead of accepting unconditional unlink', async () => {
    const response = await unlink({ path: '/docs/item.txt' });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error?.code).toBe('validation_error');
    expect(state.updateAttempts).toBe(0);
  });
});

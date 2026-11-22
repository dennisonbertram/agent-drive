import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Result = { rows: Row[]; rowCount: number };
  const ids = {
    account: '00000000-0000-4000-8000-000000000001',
    drive: '00000000-0000-4000-8000-000000000002',
    key: '00000000-0000-4000-8000-000000000003',
    agent: '00000000-0000-4000-8000-000000000004',
    intent: '00000000-0000-4000-8000-000000000005',
    machine: '00000000-0000-4000-8000-000000000006',
    file: '00000000-0000-4000-8000-000000000007',
    sourceVersion: '00000000-0000-4000-8000-000000000008',
    committedVersion: '00000000-0000-4000-8000-000000000009',
    otherFile: '00000000-0000-4000-8000-00000000000a',
    audit: '00000000-0000-4000-8000-00000000000b',
  };
  const state = {
    openTransactions: 0,
    intent: undefined as Row | undefined,
    sourceRow: undefined as Row | undefined,
    versionRow: undefined as Row | undefined,
    filesByPath: new Map<string, Row[]>(),
    copyCalls: [] as { source: string; target: string; etag: string | undefined; depth: number }[],
    deletedKeys: [] as string[],
    commitPutDepths: [] as number[],
  };
  const query = async (text: string, params: unknown[] = []): Promise<Result> => {
    const sql = text.replace(/\s+/g, ' ');
    const one = (row: Row) => ({ rows: [row], rowCount: 1 });
    if (sql.includes('FROM api_keys'))
      return one({
        id: ids.key,
        account_id: ids.account,
        agent_id: ids.agent,
        scopes: ['read', 'write', 'delete'],
        write_paths: [],
        drive_ids: [ids.drive],
      });
    if (sql.includes('FROM drives d JOIN accounts'))
      return one({
        id: ids.drive,
        account_id: ids.account,
        name: 'drive',
        quota_bytes: '999999999999999',
      });
    if (sql.includes('INSERT INTO audit_events')) return one({ id: ids.audit });
    if (sql.includes('UPDATE audit_events')) return { rows: [], rowCount: 1 };
    if (sql.includes('DELETE FROM upload_intents')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM upload_intents'))
      return state.intent ? { rows: [state.intent], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO machines')) return one({ id: ids.machine });
    if (sql.includes('quota_bytes FROM drives')) return one({ quota_bytes: '999999999999999' });
    if (sql.includes('SUM(ciphertext_size)')) return one({ used: '0' });
    if (sql.includes('FROM files f JOIN versions v'))
      return state.sourceRow ? { rows: [state.sourceRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes('FROM versions v JOIN files f'))
      return state.versionRow ? one(state.versionRow) : { rows: [], rowCount: 0 };
    if (sql.includes('FROM files WHERE drive_id')) {
      const rows = state.filesByPath.get(String(params[1])) ?? [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM drives WHERE id')) return one({ id: ids.drive });
    if (
      sql.includes('INSERT INTO files') ||
      sql.includes('UPDATE files') ||
      sql.includes('INSERT INTO versions') ||
      sql.includes('INSERT INTO file_events') ||
      sql.includes('UPDATE upload_intents')
    )
      return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const pool = { query };
  const client = { query };
  const transaction: typeof import('../db/client').withTransaction = async (callback) => {
    state.openTransactions += 1;
    try {
      return await callback(client as never);
    } finally {
      state.openTransactions -= 1;
    }
  };
  const defaults = {
    copyObject: (async (source: string, target: string, etag?: string) => {
      state.copyCalls.push({ source, target, etag, depth: state.openTransactions });
    }) as unknown as typeof import('./storage').copyObject,
    deleteObject: (async (key: string) => {
      state.deletedKeys.push(key);
    }) as unknown as typeof import('./storage').deleteObject,
    objectInfo: (async () => ({
      size: 5,
      etag: '"etag-1"',
    })) as unknown as typeof import('./storage').objectInfo,
    putConflict: (async () => undefined) as unknown as typeof import('./versions').putConflict,
    checkDriveQuota: (async () =>
      undefined) as unknown as typeof import('./versions').checkDriveQuota,
    commitPut: (async (_client: unknown, input: Record<string, unknown>) => {
      state.commitPutDepths.push(state.openTransactions);
      return {
        id: input.versionId ?? ids.sourceVersion,
        file_id: ids.file,
        drive_id: ids.drive,
        object_key: input.objectKey,
        ciphertext_size: 5,
        wrapped_key: 'wrapped',
        agent_id: ids.agent,
        machine_id: ids.machine,
        user_id: null,
        tags: [],
        description: null,
        created_at: new Date(0),
        path: input.path,
      };
    }) as unknown as typeof import('./versions').commitPut,
  };
  return { ids, state, pool, client, transaction, defaults };
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
    enforceWriteBudget: vi.fn(async () => ({})),
    enforceOperationBudget: vi.fn(async () => undefined),
    enforceKeyRateLimit: vi.fn(async () => undefined),
  };
});

vi.mock('./storage', async (original) => {
  const actual = await original<typeof import('./storage')>();
  return {
    ...actual,
    copyObject: vi.fn(harness.defaults.copyObject),
    deleteObject: vi.fn(harness.defaults.deleteObject),
    objectInfo: vi.fn(harness.defaults.objectInfo),
    presignedDownload: vi.fn(async () => 'https://example.test/download'),
    presignedUpload: vi.fn(async () => 'https://example.test/upload'),
  };
});

vi.mock('./versions', async (original) => {
  const actual = await original<typeof import('./versions')>();
  return {
    ...actual,
    putConflict: vi.fn(harness.defaults.putConflict),
    checkDriveQuota: vi.fn(harness.defaults.checkDriveQuota),
    commitPut: vi.fn(harness.defaults.commitPut),
  };
});

import { TransactionCommitUnknownError, withTransaction } from '../db/client';
import { ApiError } from './errors';
import { handleApiRequest } from './handler';
import { copyObject, deleteObject, objectInfo } from './storage';
import { checkDriveQuota, commitPut, putConflict } from './versions';

const { ids, state } = harness;

const request = (operation: string, body: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1/drives/${ids.drive}/${operation}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const commit = () => request('commit', { intentId: ids.intent });
const copy = () => request('copy', { path: '/source.bin', destinationPath: '/dest.bin' });
const restore = () => request('restore', { path: '/source.bin' });

const errorCode = async (response: Response) =>
  ((await response.json()) as { error?: { code?: string } }).error?.code;

const deletedObjectKeys = () => state.deletedKeys.filter((key) => key.startsWith('objects/'));

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [
    withTransaction,
    copyObject,
    deleteObject,
    objectInfo,
    putConflict,
    checkDriveQuota,
    commitPut,
  ])
    vi.mocked(mock).mockReset();
  vi.mocked(withTransaction).mockImplementation(harness.transaction);
  vi.mocked(copyObject).mockImplementation(harness.defaults.copyObject);
  vi.mocked(deleteObject).mockImplementation(harness.defaults.deleteObject);
  vi.mocked(objectInfo).mockImplementation(harness.defaults.objectInfo);
  vi.mocked(putConflict).mockImplementation(harness.defaults.putConflict);
  vi.mocked(checkDriveQuota).mockImplementation(harness.defaults.checkDriveQuota);
  vi.mocked(commitPut).mockImplementation(harness.defaults.commitPut);
  state.openTransactions = 0;
  state.copyCalls = [];
  state.deletedKeys = [];
  state.commitPutDepths = [];
  state.filesByPath = new Map();
  state.intent = {
    id: ids.intent,
    api_key_id: ids.key,
    account_id: ids.account,
    agent_id: ids.agent,
    machine_id: ids.machine,
    drive_id: ids.drive,
    path: '/file.bin',
    staging_key: `staging/${ids.account}/${ids.drive}/${ids.intent}`,
    ciphertext_size: 5,
    wrapped_key: 'wrapped',
    conditional_mode: 'unconditional',
    base_version_id: null,
    user_id: null,
    tags: [],
    description: null,
    expires_at: new Date(Date.now() + 600_000),
    committed_version_id: null,
  };
  state.sourceRow = {
    id: ids.sourceVersion,
    file_id: ids.file,
    drive_id: ids.drive,
    path: '/source.bin',
    deleted_at: null,
    current_version_id: ids.sourceVersion,
    object_key: `objects/${ids.account}/${ids.drive}/${ids.sourceVersion}`,
    ciphertext_size: 5,
    wrapped_key: 'wrapped',
    agent_id: ids.agent,
    machine_id: ids.machine,
    user_id: null,
    tags: [],
    description: null,
    created_at: new Date(0),
  };
  state.versionRow = {
    id: ids.committedVersion,
    file_id: ids.file,
    drive_id: ids.drive,
    path: '/file.bin',
    object_key: `objects/${ids.account}/${ids.drive}/${ids.committedVersion}`,
    ciphertext_size: 5,
    wrapped_key: 'wrapped',
    agent_id: ids.agent,
    machine_id: ids.machine,
    user_id: null,
    tags: [],
    description: null,
    created_at: new Date(0),
  };
});

describe('commitIntent', () => {
  it('copies the staged object outside the locked transaction', async () => {
    const response = await commit();
    expect(response.status).toBe(201);
    expect(state.copyCalls).toHaveLength(1);
    expect(state.copyCalls[0]!.depth).toBe(0);
    expect(state.copyCalls[0]!.source).toBe(state.intent!.staging_key);
    expect(state.copyCalls[0]!.target).toMatch(/^objects\//);
    expect(state.copyCalls[0]!.etag).toBe('"etag-1"');
    expect(state.commitPutDepths).toEqual([1]);
    expect(state.deletedKeys).toEqual([state.intent!.staging_key]);
  });

  it('runs a single transaction on the success path', async () => {
    const response = await commit();
    expect(response.status).toBe(201);
    // One transaction reserves the operation; the commit itself runs exactly one.
    expect(withTransaction).toHaveBeenCalledTimes(2);
  });

  it('returns 201 without waiting for the staging delete', async () => {
    vi.mocked(deleteObject).mockImplementationOnce(() => new Promise<void>(() => undefined));
    const response = await commit();
    expect(response.status).toBe(201);
  });

  it('maps a staging ETag precondition failure to a conflict and skips commitPut', async () => {
    vi.mocked(copyObject).mockRejectedValueOnce(
      Object.assign(new Error('precondition'), { name: 'PreconditionFailed' }),
    );
    const response = await commit();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('conflict');
    expect(commitPut).not.toHaveBeenCalled();
    expect(deletedObjectKeys()).toEqual([]);
  });

  it('deletes the copied object when the final transaction fails', async () => {
    vi.mocked(commitPut).mockRejectedValueOnce(
      new ApiError('conflict', 'The file changed since the conditional write was prepared.'),
    );
    const response = await commit();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('conflict');
    expect(deletedObjectKeys()).toHaveLength(1);
    expect(state.deletedKeys).not.toContain(state.intent!.staging_key);
  });

  it('returns the committed version and removes the orphaned copy on a concurrent commit', async () => {
    vi.mocked(copyObject).mockImplementationOnce(async (source, target, etag) => {
      state.copyCalls.push({ source, target, etag, depth: state.openTransactions });
      state.intent!.committed_version_id = ids.committedVersion;
    });
    const response = await commit();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version?: { id?: string } };
    expect(body.version?.id).toBe(ids.committedVersion);
    expect(commitPut).not.toHaveBeenCalled();
    expect(deletedObjectKeys()).toHaveLength(1);
  });

  it('returns the committed version when a concurrent commit removed the staged object', async () => {
    vi.mocked(copyObject).mockImplementationOnce(async (source, target, etag) => {
      state.copyCalls.push({ source, target, etag, depth: state.openTransactions });
      state.intent!.committed_version_id = ids.committedVersion;
      throw Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
    });
    const response = await commit();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version?: { id?: string } };
    expect(body.version?.id).toBe(ids.committedVersion);
    expect(commitPut).not.toHaveBeenCalled();
  });

  it('keeps the copied object when the commit acknowledgement is lost', async () => {
    let transactions = 0;
    vi.mocked(withTransaction).mockImplementation(async (callback) => {
      transactions += 1;
      if (transactions === 2) {
        await harness.transaction(callback);
        throw new TransactionCommitUnknownError(new Error('lost commit acknowledgement'));
      }
      return harness.transaction(callback);
    });
    const response = await commit();
    expect(response.status).toBe(500);
    expect(deletedObjectKeys()).toEqual([]);
  });

  it('deletes the copied object when the commit acknowledgement is lost on the committed branch', async () => {
    let transactions = 0;
    vi.mocked(copyObject).mockImplementationOnce(async (source, target, etag) => {
      state.copyCalls.push({ source, target, etag, depth: state.openTransactions });
      state.intent!.committed_version_id = ids.committedVersion;
    });
    vi.mocked(withTransaction).mockImplementation(async (callback) => {
      transactions += 1;
      if (transactions === 2) {
        await harness.transaction(callback);
        throw new TransactionCommitUnknownError(new Error('lost commit acknowledgement'));
      }
      return harness.transaction(callback);
    });
    const response = await commit();
    expect(response.status).toBe(500);
    expect(commitPut).not.toHaveBeenCalled();
    expect(deletedObjectKeys()).toHaveLength(1);
  });

  it('deletes the copy when the final transaction conflicts', async () => {
    vi.mocked(putConflict).mockRejectedValueOnce(
      new ApiError('conflict', 'The file already exists.', 409, { state: 'exists' }),
    );
    const response = await commit();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('conflict');
    expect(state.copyCalls).toHaveLength(1);
    expect(deletedObjectKeys()).toHaveLength(1);
  });

  it('deletes the copy when the quota check fails after the copy', async () => {
    vi.mocked(checkDriveQuota).mockRejectedValueOnce(
      new ApiError('quota_exceeded', 'The drive quota would be exceeded.'),
    );
    const response = await commit();
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('quota_exceeded');
    expect(state.copyCalls).toHaveLength(1);
    expect(deletedObjectKeys()).toHaveLength(1);
  });
});

describe('derivedVersion', () => {
  it('copies the source object outside the locked transaction', async () => {
    const response = await copy();
    expect(response.status).toBe(201);
    expect(state.copyCalls).toHaveLength(1);
    expect(state.copyCalls[0]!.depth).toBe(0);
    expect(state.copyCalls[0]!.source).toBe(state.sourceRow!.object_key);
    expect(state.copyCalls[0]!.target).toMatch(/^objects\//);
  });

  it('undeletes the current version without copying', async () => {
    state.sourceRow = { ...state.sourceRow!, deleted_at: new Date(0) };
    const response = await restore();
    expect(response.status).toBe(200);
    expect(copyObject).not.toHaveBeenCalled();
  });

  it('deletes the copied object when the destination appears in the final transaction', async () => {
    vi.mocked(copyObject).mockImplementationOnce(async (source, target, etag) => {
      state.copyCalls.push({ source, target, etag, depth: state.openTransactions });
      state.filesByPath.set('/dest.bin', [{ id: ids.otherFile }]);
    });
    const response = await copy();
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('conflict');
    expect(deletedObjectKeys()).toHaveLength(1);
  });
});

import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { ApiError } from './errors';

// Database rows are intentionally untyped at this boundary, like in handler.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = QueryResultRow & Record<string, any>;

export type PutMode = 'unconditional' | 'create' | { baseVersionId: string };

export type CommitPutInput = {
  accountId: string;
  driveId: string;
  path: string;
  objectKey: string;
  ciphertextSize: number;
  wrappedKey: string;
  agentId: string;
  machineId: string | null;
  userId: string | null;
  tags: string[];
  description: string | null;
  mode: PutMode;
  // Optional: callers that embed the version id in objectKey pass it so the two stay in step.
  versionId?: string;
};

const trashedMessage = 'The file is in the trash. Restore it, or write with overwrite.';

/**
 * Looks up the file at a path (locking it) and throws the 409 for the requested mode.
 * The caller holds the billing-account lock and the drive row lock.
 */
export async function putConflict(
  client: PoolClient,
  driveId: string,
  path: string,
  mode: PutMode,
): Promise<Row | undefined> {
  const fileResult = await client.query(
    'SELECT id, current_version_id, deleted_at FROM files WHERE drive_id = $1 AND path = $2 FOR UPDATE',
    [driveId, path],
  );
  const file = fileResult.rows[0] as Row | undefined;
  const currentVersionId = (file?.current_version_id as string | undefined) ?? null;
  if (mode === 'create' && file) {
    if (file.deleted_at)
      throw new ApiError('conflict', trashedMessage, 409, { state: 'trashed', currentVersionId });
    throw new ApiError('conflict', 'The file already exists.', 409, {
      state: 'exists',
      currentVersionId,
    });
  }
  if (typeof mode === 'object') {
    if (!file)
      throw new ApiError('conflict', 'There is no file at this path.', 409, {
        state: 'absent',
        currentVersionId: null,
      });
    if (file.deleted_at)
      throw new ApiError('conflict', trashedMessage, 409, { state: 'trashed', currentVersionId });
    if (file.current_version_id !== mode.baseVersionId)
      throw new ApiError(
        'conflict',
        'The file changed since the conditional write was prepared.',
        409,
        { state: 'changed', currentVersionId },
      );
  }
  return file;
}

/** Throws quota_exceeded if adding `size` bytes of versions would exceed the drive quota. */
export async function checkDriveQuota(client: PoolClient, driveId: string, size: number) {
  const used = await client.query(
    'SELECT COALESCE(SUM(ciphertext_size),0)::bigint AS used FROM versions WHERE drive_id = $1',
    [driveId],
  );
  const quota = await client.query('SELECT quota_bytes FROM drives WHERE id = $1', [driveId]);
  if (Number(used.rows[0].used) + size > Number(quota.rows[0].quota_bytes)) {
    throw new ApiError('quota_exceeded', 'The drive quota would be exceeded.');
  }
}

/**
 * Records a new version of a file: conflict checks, drive quota, files and versions rows and the
 * 'put' event. The caller holds lockBillingAccount and the drive row FOR UPDATE, has run
 * enforceWriteBudget, and has already placed the object at input.objectKey.
 * Returns the new versions row joined with files.path.
 */
export async function commitPut(client: PoolClient, input: CommitPutInput): Promise<Row> {
  const file = await putConflict(client, input.driveId, input.path, input.mode);
  await checkDriveQuota(client, input.driveId, input.ciphertextSize);
  const versionId = input.versionId ?? randomUUID();
  const fileId = (file?.id as string | undefined) ?? randomUUID();
  if (!file) {
    await client.query(
      'INSERT INTO files (id, drive_id, path, current_version_id) VALUES ($1,$2,$3,$4)',
      [fileId, input.driveId, input.path, versionId],
    );
  } else {
    await client.query(
      'UPDATE files SET current_version_id = $1, deleted_at = NULL WHERE id = $2',
      [versionId, fileId],
    );
  }
  await client.query(
    `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id,machine_id,user_id,tags,description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      versionId,
      fileId,
      input.driveId,
      input.objectKey,
      input.ciphertextSize,
      input.wrappedKey,
      input.agentId,
      input.machineId,
      input.userId,
      input.tags,
      input.description,
    ],
  );
  await client.query(
    `INSERT INTO file_events
      (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
     VALUES ($1, $2, 'put', $3, $4, $5, $6, $7)`,
    [input.driveId, fileId, input.path, versionId, input.agentId, input.machineId, input.userId],
  );
  const version = await client.query(
    'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
    [versionId],
  );
  return version.rows[0] as Row;
}

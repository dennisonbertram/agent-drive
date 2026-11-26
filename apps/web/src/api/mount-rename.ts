import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { TransactionCommitUnknownError, withTransaction } from '../db/client';
import { checkDriveQuota } from './versions';
import { enforceWriteBudget, lockBillingAccount } from '../billing/ledger';
import { copyObject, deleteObject } from './storage';
import { ApiError } from './errors';
import { canonicalPath, jsonBody, onlyFields, uuid, withinWritePaths } from './validation';

// Database rows are intentionally untyped at this boundary, like in handler.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = QueryResultRow & Record<string, any>;

export type RenameAuth = {
  accountId: string;
  agentId: string;
  scopes: string[];
  writePaths: string[];
  driveIds: string[];
  userId?: string;
};

type RenameInput = {
  path: string;
  destinationPath: string;
  ifSourceVersionId: string;
  ifDestinationVersionId: string | null;
  operationId: string;
  fingerprint: string;
};

type RenameResult = { id: string; path: string; versionId: string };

type SourceVersion = {
  fileId: string;
  versionId: string;
  objectKey: string;
  ciphertextSize: number;
  wrappedKey: string;
};

function requireScope(auth: RenameAuth, scope: string, driveId: string) {
  if (!auth.scopes.includes(scope))
    throw new ApiError('permission_denied', `The API key lacks the "${scope}" scope.`);
  if (!auth.driveIds.includes(driveId))
    throw new ApiError('permission_denied', 'The API key is not scoped to this drive.');
}

async function parseInput(request: Request, auth: RenameAuth, driveId: string) {
  requireScope(auth, 'write', driveId);
  const body = await jsonBody(request);
  onlyFields(body, [
    'path',
    'destinationPath',
    'ifSourceVersionId',
    'ifDestinationVersionId',
    'operationId',
  ]);
  const path = canonicalPath(body.path);
  const destinationPath = canonicalPath(body.destinationPath, 'destinationPath');
  const ifSourceVersionId = uuid(
    typeof body.ifSourceVersionId === 'string' ? body.ifSourceVersionId : undefined,
    'ifSourceVersionId',
  );
  if (!Object.hasOwn(body, 'ifDestinationVersionId'))
    throw new ApiError('validation_error', 'ifDestinationVersionId is required.');
  const ifDestinationVersionId =
    body.ifDestinationVersionId === null
      ? null
      : uuid(
          typeof body.ifDestinationVersionId === 'string' ? body.ifDestinationVersionId : undefined,
          'ifDestinationVersionId',
        );
  const operationId = uuid(
    typeof body.operationId === 'string' ? body.operationId : undefined,
    'operationId',
  );
  if (path === destinationPath)
    throw new ApiError('validation_error', 'The source and destination paths must differ.');
  if (
    !withinWritePaths(auth.writePaths, path) ||
    !withinWritePaths(auth.writePaths, destinationPath)
  )
    throw new ApiError(
      'permission_denied',
      `The API key may only write under ${auth.writePaths.join(', ')}.`,
    );
  if (ifDestinationVersionId !== null) requireScope(auth, 'delete', driveId);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ path, destinationPath, ifSourceVersionId, ifDestinationVersionId }))
    .digest('hex');
  return {
    path,
    destinationPath,
    ifSourceVersionId,
    ifDestinationVersionId,
    operationId,
    fingerprint,
  } satisfies RenameInput;
}

function checkReceipt(
  row: Row | undefined,
  auth: RenameAuth,
  input: RenameInput,
): RenameResult | undefined {
  if (!row) return undefined;
  if (row.agent_id !== auth.agentId || row.request_fingerprint !== input.fingerprint)
    throw new ApiError('conflict', 'The operation id was already used for a different request.');
  return {
    id: row.result_file_id as string,
    path: row.result_path as string,
    versionId: row.result_version_id as string,
  };
}

async function findReceipt(
  client: PoolClient,
  driveId: string,
  auth: RenameAuth,
  input: RenameInput,
) {
  const result = await client.query(
    `SELECT agent_id, request_fingerprint, result_file_id, result_path, result_version_id
       FROM mount_rename_operations WHERE drive_id = $1 AND operation_id = $2 FOR UPDATE`,
    [driveId, input.operationId],
  );
  return checkReceipt(result.rows[0] as Row | undefined, auth, input);
}

async function lockDrive(client: PoolClient, accountId: string, driveId: string) {
  const locked = await client.query(
    'SELECT id, quota_bytes FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
    [driveId, accountId],
  );
  const row = locked.rows[0] as Row | undefined;
  if (!row) throw new ApiError('not_found', 'Drive not found.');
  return row;
}

async function explicitDirectoryCollision(
  client: PoolClient,
  driveId: string,
  sourcePath: string,
  destinationPath: string,
) {
  const result = await client.query(
    `SELECT path FROM drive_directories
      WHERE drive_id = $1
        AND (path = $2 OR path = $3 OR left(path, char_length($3) + 1) = $3 || '/')
      FOR UPDATE`,
    [driveId, sourcePath, destinationPath],
  );
  if (result.rowCount)
    throw new ApiError(
      'conflict',
      'The source or destination conflicts with an explicit directory.',
    );
}

async function currentSource(client: PoolClient, driveId: string, path: string) {
  const result = await client.query(
    `SELECT f.id AS file_id, f.current_version_id, f.deleted_at,
            v.id AS version_id, v.object_key, v.ciphertext_size, v.wrapped_key
       FROM files f JOIN versions v ON v.id = f.current_version_id
      WHERE f.drive_id = $1 AND f.path = $2 FOR UPDATE OF f`,
    [driveId, path],
  );
  return result.rows[0] as Row | undefined;
}

async function currentDestination(client: PoolClient, driveId: string, path: string) {
  const result = await client.query(
    `SELECT f.id, f.current_version_id, f.deleted_at, v.tags, v.description
       FROM files f LEFT JOIN versions v ON v.id = f.current_version_id
      WHERE f.drive_id = $1 AND f.path = $2 FOR UPDATE OF f`,
    [driveId, path],
  );
  return result.rows[0] as Row | undefined;
}

function assertSourceVersion(source: Row | undefined, expected: string) {
  if (!source || source.deleted_at)
    throw new ApiError('conflict', 'The source is missing or in the trash.');
  if (source.current_version_id !== expected)
    throw new ApiError('conflict', 'The source changed since the rename was prepared.', 409, {
      state: 'changed',
      currentVersionId: source.current_version_id as string | null,
    });
}

function assertDestinationVersion(destination: Row | undefined, expected: string | null) {
  if (expected === null) {
    if (destination)
      throw new ApiError('conflict', 'The destination already exists.', 409, {
        state: destination.deleted_at ? 'trashed' : 'exists',
        currentVersionId: destination.current_version_id as string | null,
      });
    return;
  }
  if (!destination || destination.deleted_at)
    throw new ApiError('conflict', 'The expected destination is missing or in the trash.', 409, {
      state: destination?.deleted_at ? 'trashed' : 'absent',
      currentVersionId: destination?.current_version_id as string | null,
    });
  if (destination.current_version_id !== expected)
    throw new ApiError('conflict', 'The destination changed since the rename was prepared.', 409, {
      state: 'changed',
      currentVersionId: destination.current_version_id as string,
    });
}

async function insertReceipt(
  client: PoolClient,
  driveId: string,
  auth: RenameAuth,
  input: RenameInput,
  result: RenameResult,
) {
  await client.query(
    `INSERT INTO mount_rename_operations
       (drive_id, operation_id, agent_id, request_fingerprint,
        result_file_id, result_path, result_version_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      driveId,
      input.operationId,
      auth.agentId,
      input.fingerprint,
      result.id,
      result.path,
      result.versionId,
    ],
  );
}

async function moveToAbsentDestination(
  request: Request,
  auth: RenameAuth,
  driveId: string,
  input: RenameInput,
  machineId: (client: PoolClient, request: Request) => Promise<string | null>,
) {
  return withTransaction(async (client) => {
    await lockBillingAccount(client, auth.accountId);
    await enforceWriteBudget(client, auth.accountId);
    await lockDrive(client, auth.accountId, driveId);
    const prior = await findReceipt(client, driveId, auth, input);
    if (prior) return prior;
    await explicitDirectoryCollision(client, driveId, input.path, input.destinationPath);
    const source = await currentSource(client, driveId, input.path);
    assertSourceVersion(source, input.ifSourceVersionId);
    const destination = await currentDestination(client, driveId, input.destinationPath);
    assertDestinationVersion(destination, null);
    const changed = await client.query(
      `UPDATE files SET path = $1
        WHERE id = $2 AND drive_id = $3 AND path = $4 AND deleted_at IS NULL
          AND current_version_id = $5
        RETURNING id, path, current_version_id`,
      [input.destinationPath, source!.file_id, driveId, input.path, input.ifSourceVersionId],
    );
    const moved = changed.rows[0] as Row | undefined;
    if (!moved) throw new ApiError('conflict', 'The source changed during rename.');
    const machine = await machineId(client, request);
    await client.query(
      `INSERT INTO file_events
         (drive_id, file_id, operation, path, previous_path, version_id, agent_id, machine_id, user_id)
       VALUES ($1,$2,'move',$3,$4,$5,$6,$7,$8)`,
      [
        driveId,
        moved.id,
        moved.path,
        input.path,
        moved.current_version_id,
        auth.agentId,
        machine,
        auth.userId ?? null,
      ],
    );
    const result = {
      id: moved.id as string,
      path: moved.path as string,
      versionId: moved.current_version_id as string,
    };
    await insertReceipt(client, driveId, auth, input, result);
    return result;
  });
}

async function prepareReplacement(auth: RenameAuth, driveId: string, input: RenameInput) {
  return withTransaction(async (client) => {
    await lockBillingAccount(client, auth.accountId);
    const drive = await lockDrive(client, auth.accountId, driveId);
    const prior = await findReceipt(client, driveId, auth, input);
    if (prior) return { result: prior };
    await explicitDirectoryCollision(client, driveId, input.path, input.destinationPath);
    const source = await currentSource(client, driveId, input.path);
    assertSourceVersion(source, input.ifSourceVersionId);
    const destination = await currentDestination(client, driveId, input.destinationPath);
    assertDestinationVersion(destination, input.ifDestinationVersionId);
    const size = Number(source!.ciphertext_size);
    await enforceWriteBudget(client, auth.accountId, {
      bytes: BigInt(size),
      reserveOnly: true,
    });
    await checkDriveQuota(client, driveId, size, Number(drive.quota_bytes));
    return {
      result: undefined,
      source: {
        fileId: source!.file_id as string,
        versionId: source!.version_id as string,
        objectKey: source!.object_key as string,
        ciphertextSize: size,
        wrappedKey: source!.wrapped_key as string,
      } satisfies SourceVersion,
      destinationFileId: destination!.id as string,
      destinationMetadata: {
        tags: (destination!.tags as string[] | null) ?? [],
        description: (destination!.description as string | null) ?? null,
      },
    };
  });
}

async function commitReplacement(
  request: Request,
  auth: RenameAuth,
  driveId: string,
  input: RenameInput,
  source: SourceVersion,
  destinationMetadata: { tags: string[]; description: string | null },
  destinationFileId: string,
  versionId: string,
  objectKey: string,
  machineId: (client: PoolClient, request: Request) => Promise<string | null>,
  markObjectReferenced: () => void,
) {
  return withTransaction(async (client) => {
    await lockBillingAccount(client, auth.accountId);
    const drive = await lockDrive(client, auth.accountId, driveId);
    const prior = await findReceipt(client, driveId, auth, input);
    if (prior) return { result: prior, replay: true };
    await explicitDirectoryCollision(client, driveId, input.path, input.destinationPath);
    const currentSourceRow = await currentSource(client, driveId, input.path);
    assertSourceVersion(currentSourceRow, input.ifSourceVersionId);
    const destination = await currentDestination(client, driveId, input.destinationPath);
    assertDestinationVersion(destination, input.ifDestinationVersionId);
    if (currentSourceRow!.file_id !== source.fileId || destination!.id !== destinationFileId)
      throw new ApiError('conflict', 'The source or destination changed during rename.');
    await enforceWriteBudget(client, auth.accountId, { bytes: BigInt(source.ciphertextSize) });
    await checkDriveQuota(client, driveId, source.ciphertextSize, Number(drive.quota_bytes));
    const machine = await machineId(client, request);
    markObjectReferenced();
    const file = await client.query(
      `UPDATE files SET current_version_id = $1
        WHERE id = $2 AND drive_id = $3 AND deleted_at IS NULL
          AND current_version_id = $4
        RETURNING id, path`,
      [versionId, destinationFileId, driveId, input.ifDestinationVersionId],
    );
    if (!file.rows[0]) throw new ApiError('conflict', 'The destination changed during rename.');
    await client.query(
      `INSERT INTO versions
         (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id,machine_id,user_id,tags,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        versionId,
        destinationFileId,
        driveId,
        objectKey,
        source.ciphertextSize,
        source.wrappedKey,
        auth.agentId,
        machine,
        auth.userId ?? null,
        destinationMetadata.tags,
        destinationMetadata.description,
      ],
    );
    const trashed = await client.query(
      `UPDATE files SET deleted_at = now()
        WHERE id = $1 AND drive_id = $2 AND deleted_at IS NULL
          AND current_version_id = $3
        RETURNING id`,
      [source.fileId, driveId, input.ifSourceVersionId],
    );
    if (!trashed.rowCount) throw new ApiError('conflict', 'The source changed during rename.');
    await client.query(
      `INSERT INTO file_events
         (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
       VALUES ($1,$2,'put',$3,$4,$5,$6,$7)`,
      [
        driveId,
        destinationFileId,
        input.destinationPath,
        versionId,
        auth.agentId,
        machine,
        auth.userId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO file_events
         (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
       VALUES ($1,$2,'delete',$3,$4,$5,$6,$7)`,
      [
        driveId,
        source.fileId,
        input.path,
        input.ifSourceVersionId,
        auth.agentId,
        machine,
        auth.userId ?? null,
      ],
    );
    const result = {
      id: destinationFileId,
      path: input.destinationPath,
      versionId,
    };
    await insertReceipt(client, driveId, auth, input, result);
    return { result, replay: false };
  });
}

export async function renameFile(
  request: Request,
  auth: RenameAuth,
  driveId: string,
  machineId: (client: PoolClient, request: Request) => Promise<string | null>,
) {
  const input = await parseInput(request, auth, driveId);
  if (input.ifDestinationVersionId === null) {
    const result = await moveToAbsentDestination(request, auth, driveId, input, machineId);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }

  const prepared = await prepareReplacement(auth, driveId, input);
  if (prepared.result)
    return Response.json(prepared.result, { headers: { 'Cache-Control': 'no-store' } });
  const source = prepared.source!;
  const versionId = randomUUID();
  const objectKey = `objects/${auth.accountId}/${driveId}/${versionId}`;
  let copyReferenced = false;
  try {
    await copyObject(source.objectKey, objectKey);
    const committed = await commitReplacement(
      request,
      auth,
      driveId,
      input,
      source,
      {
        tags: prepared.destinationMetadata!.tags,
        description: prepared.destinationMetadata!.description,
      },
      prepared.destinationFileId!,
      versionId,
      objectKey,
      machineId,
      () => {
        copyReferenced = true;
      },
    );
    if (committed.replay) {
      await deleteObject(objectKey).catch(() => undefined);
      return Response.json(committed.result, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json(committed.result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof TransactionCommitUnknownError && copyReferenced))
      await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

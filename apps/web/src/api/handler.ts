import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { getPool, withTransaction } from '../db/client';
import { ApiError, errorFromDatabase, responseForError } from './errors';
import {
  boundedSize,
  canonicalPath,
  decodeCursor,
  encodeCursor,
  escapedLike,
  jsonBody,
  optionalString,
  page,
  prefix,
  stringField,
  tags,
  uuid,
} from './validation';
import {
  copyObject,
  deleteObject,
  objectSize,
  presignedDownload,
  presignedUpload,
} from './storage';

type Auth = {
  keyId: string;
  accountId: string;
  agentId: string;
  scopes: string[];
  driveIds: string[];
};
type RequestContext = { auth?: Auth; action: string; status: number; errorCode?: string };
// Database rows are intentionally untyped at this boundary; all externally visible fields are selected explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = QueryResultRow & Record<string, any>;

const scopeNames = new Set(['read', 'write', 'delete', 'share', 'manage']);

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function bearer(request: Request) {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ') || value.length <= 7) {
    throw new ApiError('unauthorized', 'A bearer API key is required.');
  }
  return value.slice(7);
}

async function authenticate(request: Request): Promise<Auth> {
  const result = await getPool().query(
    `SELECT id, account_id, agent_id, scopes, drive_ids
       FROM api_keys
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(bearer(request))],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new ApiError('unauthorized', 'The API key is invalid or revoked.');
  return {
    keyId: row.id,
    accountId: row.account_id,
    agentId: row.agent_id,
    scopes: row.scopes ?? [],
    driveIds: row.drive_ids ?? [],
  };
}

function need(auth: Auth, scope: string, driveId?: string) {
  if (!auth.scopes.includes(scope))
    throw new ApiError('permission_denied', 'The API key lacks this scope.');
  if (driveId && !auth.driveIds.includes(driveId)) {
    throw new ApiError('permission_denied', 'The API key is not scoped to this drive.');
  }
}

function manage(auth: Auth) {
  need(auth, 'manage');
}

async function machineId(client: PoolClient, auth: Auth, request: Request) {
  const name = request.headers.get('x-agent-drive-machine') ?? 'unknown';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._:@-]{0,127}$/u.test(name)) {
    throw new ApiError('validation_error', 'The machine name is invalid.');
  }
  const result = await client.query(
    `INSERT INTO machines (account_id, agent_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, agent_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [auth.accountId, auth.agentId, name],
  );
  return result.rows[0].id as string;
}

function response(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function rowVersion(row: Row) {
  return {
    id: row.id,
    path: row.path,
    ciphertextSize: Number(row.ciphertext_size),
    wrappedKey: row.wrapped_key,
    agentId: row.agent_id,
    machineId: row.machine_id,
    userId: row.user_id,
    tags: row.tags ?? [],
    description: row.description,
    createdAt: row.created_at,
  };
}

function errorStatus(error: unknown) {
  return error instanceof ApiError ? error.status : 500;
}

function actionFor(pathname: string) {
  const parts = pathname
    .replace(/^\/api\/v1\/?/, '')
    .split('/')
    .filter(Boolean);
  if (parts.length === 0) return 'unknown';
  if (parts[0] === 'drives' && parts[2]) return `drives.${parts[2]}`;
  return parts[0] ?? 'unknown';
}

async function audit(context: RequestContext) {
  await getPool().query(
    `INSERT INTO audit_events
      (api_key_id, account_id, agent_id, action, outcome, error_code, http_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.auth?.keyId ?? null,
      context.auth?.accountId ?? null,
      context.auth?.agentId ?? null,
      context.action,
      context.status >= 400 ? 'failure' : 'success',
      context.errorCode ?? null,
      context.status,
    ],
  );
}

async function ensureDrive(auth: Auth, driveId: string) {
  need(auth, 'read', driveId);
  const result = await getPool().query(
    'SELECT id, account_id, name, quota_bytes FROM drives WHERE id = $1',
    [driveId],
  );
  if (!result.rows[0]) throw new ApiError('not_found', 'Drive not found.');
  if (result.rows[0].account_id !== auth.accountId) {
    throw new ApiError('permission_denied', 'The API key is not authorized for this drive.');
  }
  return result.rows[0] as Row;
}

async function controlPlane(request: Request, auth: Auth, parts: string[]) {
  const method = request.method;
  if (parts[0] === 'whoami' && method === 'GET') {
    const drives = auth.scopes.includes('manage')
      ? await getPool().query(
          'SELECT id, name, quota_bytes FROM drives WHERE account_id = $1 ORDER BY name, id LIMIT 100',
          [auth.accountId],
        )
      : await getPool().query(
          'SELECT id, name, quota_bytes FROM drives WHERE account_id = $1 AND id = ANY($2::uuid[]) ORDER BY name, id LIMIT 100',
          [auth.accountId, auth.driveIds],
        );
    return response({
      accountId: auth.accountId,
      agentId: auth.agentId,
      keyId: auth.keyId,
      scopes: auth.scopes,
      drives: drives.rows,
    });
  }
  if (parts[0] === 'agents' && method === 'GET') {
    manage(auth);
    return response(
      (
        await getPool().query(
          'SELECT id, name, created_at FROM agents WHERE account_id = $1 ORDER BY name, id LIMIT 100',
          [auth.accountId],
        )
      ).rows,
    );
  }
  if (parts[0] === 'agents' && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const name = stringField(body, 'name', { required: true, max: 128 })!;
    const result = await getPool().query(
      `INSERT INTO agents (account_id, name) VALUES ($1, $2)
       ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, created_at`,
      [auth.accountId, name],
    );
    return response(result.rows[0], 200);
  }
  if (parts[0] === 'drives' && parts.length === 1 && method === 'GET') {
    manage(auth);
    return response(
      (
        await getPool().query(
          'SELECT id, name, quota_bytes, created_at FROM drives WHERE account_id = $1 ORDER BY name, id LIMIT 100',
          [auth.accountId],
        )
      ).rows,
    );
  }
  if (parts[0] === 'drives' && parts.length === 1 && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const name = stringField(body, 'name', { required: true, max: 128 })!;
    const quota =
      body.quotaBytes === undefined ? 5_368_709_120 : boundedSize(body.quotaBytes, 'quotaBytes');
    const result = await getPool().query(
      `INSERT INTO drives (account_id, name, quota_bytes) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, quota_bytes, created_at`,
      [auth.accountId, name, quota],
    );
    return response(result.rows[0], 200);
  }
  if (parts[0] === 'keys' && parts.length === 1 && method === 'GET') {
    manage(auth);
    return response(
      (
        await getPool().query(
          'SELECT id, agent_id, label, drive_ids, scopes, revoked_at, created_at FROM api_keys WHERE account_id = $1 ORDER BY created_at, id LIMIT 100',
          [auth.accountId],
        )
      ).rows,
    );
  }
  if (parts[0] === 'keys' && parts.length === 1 && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const agentId = uuid(stringField(body, 'agentId', { required: true }), 'agentId');
    const label = stringField(body, 'label', { required: true, max: 128 })!;
    const drives = Array.isArray(body.driveIds)
      ? body.driveIds.map((value) => uuid(typeof value === 'string' ? value : undefined, 'driveId'))
      : [];
    if (!Array.isArray(body.driveIds) || drives.length > 100)
      throw new ApiError('validation_error', 'driveIds must be an array of UUIDs.');
    if (
      !Array.isArray(body.scopes) ||
      body.scopes.length === 0 ||
      body.scopes.some((value) => typeof value !== 'string' || !scopeNames.has(value))
    ) {
      throw new ApiError('validation_error', 'scopes must be a non-empty list of valid scopes.');
    }
    const scopes = [...new Set(body.scopes as string[])];
    const agent = await getPool().query('SELECT id FROM agents WHERE id = $1 AND account_id = $2', [
      agentId,
      auth.accountId,
    ]);
    if (!agent.rows[0]) throw new ApiError('not_found', 'Agent not found.');
    const driveCheck = await getPool().query(
      'SELECT count(*)::int AS count FROM drives WHERE account_id = $1 AND id = ANY($2::uuid[])',
      [auth.accountId, drives],
    );
    if (Number(driveCheck.rows[0].count) !== drives.length)
      throw new ApiError('not_found', 'One or more drives were not found.');
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const result = await getPool().query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6::text[])
       RETURNING id, agent_id, label, drive_ids, scopes, created_at`,
      [auth.accountId, agentId, label, hashToken(token), drives, scopes],
    );
    return response({ ...result.rows[0], token }, 201);
  }
  if (parts[0] === 'keys' && parts.length === 2 && method === 'DELETE') {
    manage(auth);
    const keyId = uuid(parts[1], 'key id');
    const result = await getPool().query(
      'UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND account_id = $2 RETURNING id, revoked_at',
      [keyId, auth.accountId],
    );
    if (!result.rows[0]) throw new ApiError('not_found', 'API key not found.');
    return response(result.rows[0]);
  }
  return undefined;
}

async function putIntent(request: Request, auth: Auth, driveId: string) {
  need(auth, 'write', driveId);
  const body = await jsonBody(request);
  const path = canonicalPath(body.path);
  const ciphertextSize = boundedSize(body.ciphertextSize, 'ciphertextSize');
  const wrappedKey = stringField(body, 'wrappedKey', { required: true, max: 16_384 })!;
  const description = optionalString(body, 'description', 2_048);
  const userId = optionalString(body, 'userId', 256);
  const fileTags = tags(body);
  const mode = !Object.prototype.hasOwnProperty.call(body, 'ifVersionId')
    ? 'unconditional'
    : body.ifVersionId === null
      ? 'create'
      : 'version';
  const baseVersionId =
    mode === 'version'
      ? uuid(typeof body.ifVersionId === 'string' ? body.ifVersionId : undefined, 'ifVersionId')
      : null;
  const drive = await ensureDrive(
    { ...auth, scopes: ['read', 'write'], driveIds: [driveId] },
    driveId,
  );
  const machine = await withTransaction((client) => machineId(client, auth, request));
  const id = randomUUID();
  const stagingKey = `staging/${auth.accountId}/${driveId}/${id}`;
  const result = await getPool().query(
    `INSERT INTO upload_intents
      (id, api_key_id, account_id, agent_id, machine_id, drive_id, path, staging_key, ciphertext_size,
       wrapped_key, conditional_mode, base_version_id, user_id, tags, description, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now() + interval '10 minutes')
     RETURNING id, expires_at`,
    [
      id,
      auth.keyId,
      auth.accountId,
      auth.agentId,
      machine,
      drive.id,
      path,
      stagingKey,
      ciphertextSize,
      wrappedKey,
      mode,
      baseVersionId,
      userId ?? null,
      fileTags,
      description ?? null,
    ],
  );
  try {
    const uploadUrl = await presignedUpload(stagingKey, ciphertextSize);
    return response(
      { intentId: id, uploadUrl, expiresAt: result.rows[0].expires_at, ciphertextSize },
      201,
    );
  } catch (error) {
    await getPool().query('DELETE FROM upload_intents WHERE id = $1', [id]);
    throw error;
  }
}

async function commitIntent(request: Request, auth: Auth, driveId: string) {
  need(auth, 'write', driveId);
  const body = await jsonBody(request);
  const intentId = uuid(stringField(body, 'intentId', { required: true }), 'intentId');
  const intent = await getPool().query(
    `SELECT * FROM upload_intents WHERE id = $1 AND drive_id = $2 AND api_key_id = $3`,
    [intentId, driveId, auth.keyId],
  );
  const source = intent.rows[0] as Row | undefined;
  if (!source) throw new ApiError('not_found', 'Upload intent not found.');
  if (source.committed_version_id) {
    const result = await getPool().query(
      `SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1`,
      [source.committed_version_id],
    );
    return response({ version: rowVersion(result.rows[0] as Row) });
  }
  if (new Date(source.expires_at).getTime() < Date.now())
    throw new ApiError('conflict', 'The upload intent has expired.');
  let size: number;
  try {
    size = await objectSize(source.staging_key);
  } catch {
    throw new ApiError('conflict', 'The staged ciphertext is not available.');
  }
  if (size !== Number(source.ciphertext_size))
    throw new ApiError('conflict', 'Uploaded ciphertext size does not match the intent.');
  const versionId = randomUUID();
  const finalKey = `objects/${source.account_id}/${driveId}/${versionId}`;
  let copied = false;
  try {
    const result = await withTransaction(async (client) => {
      await client.query('SELECT id FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE', [
        driveId,
        auth.accountId,
      ]);
      const lockedIntentResult = await client.query(
        'SELECT * FROM upload_intents WHERE id = $1 FOR UPDATE',
        [intentId],
      );
      const lockedIntent = lockedIntentResult.rows[0] as Row | undefined;
      if (!lockedIntent) throw new ApiError('not_found', 'Upload intent not found.');
      if (lockedIntent.committed_version_id) {
        const existingVersion = await client.query(
          'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
          [lockedIntent.committed_version_id],
        );
        return { version: existingVersion.rows[0] as Row, idempotent: true };
      }
      const fileResult = await client.query(
        'SELECT id, current_version_id, deleted_at FROM files WHERE drive_id = $1 AND path = $2 FOR UPDATE',
        [driveId, source.path],
      );
      const file = fileResult.rows[0] as Row | undefined;
      if (lockedIntent.conditional_mode === 'create' && file)
        throw new ApiError('conflict', 'The file already exists.');
      if (
        lockedIntent.conditional_mode === 'version' &&
        (!file || file.current_version_id !== lockedIntent.base_version_id)
      ) {
        throw new ApiError(
          'conflict',
          'The file changed since the conditional write was prepared.',
        );
      }
      const used = await client.query(
        'SELECT COALESCE(SUM(ciphertext_size),0)::bigint AS used FROM versions WHERE drive_id = $1',
        [driveId],
      );
      const quota = await client.query('SELECT quota_bytes FROM drives WHERE id = $1', [driveId]);
      if (
        Number(used.rows[0].used) + Number(lockedIntent.ciphertext_size) >
        Number(quota.rows[0].quota_bytes)
      ) {
        throw new ApiError('quota_exceeded', 'The drive quota would be exceeded.');
      }
      await copyObject(lockedIntent.staging_key, finalKey);
      copied = true;
      const fileId = file?.id ?? randomUUID();
      if (!file) {
        await client.query(
          'INSERT INTO files (id, drive_id, path, current_version_id) VALUES ($1,$2,$3,$4)',
          [fileId, driveId, lockedIntent.path, versionId],
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
          driveId,
          finalKey,
          lockedIntent.ciphertext_size,
          lockedIntent.wrapped_key,
          lockedIntent.agent_id,
          lockedIntent.machine_id,
          lockedIntent.user_id,
          lockedIntent.tags,
          lockedIntent.description,
        ],
      );
      await client.query('UPDATE upload_intents SET committed_version_id = $1 WHERE id = $2', [
        versionId,
        intentId,
      ]);
      const version = await client.query(
        'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
        [versionId],
      );
      return { version: version.rows[0] as Row, idempotent: false };
    });
    if (result.idempotent) return response({ version: rowVersion(result.version) });
    await deleteObject(source.staging_key).catch(() => undefined);
    return response({ version: rowVersion(result.version) }, 201);
  } catch (error) {
    if (copied) await deleteObject(finalKey).catch(() => undefined);
    throw error;
  }
}

async function fileEndpoint(
  request: Request,
  auth: Auth,
  driveId: string,
  operation: string,
  url: URL,
) {
  const drive = await ensureDrive(auth, driveId);
  if (operation === 'put' && request.method === 'POST') return putIntent(request, auth, drive.id);
  if (operation === 'commit' && request.method === 'POST')
    return commitIntent(request, auth, drive.id);
  if (operation === 'get' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const path = canonicalPath(url.searchParams.get('path'));
    const versionParam = url.searchParams.get('versionId');
    const versionId = versionParam ? uuid(versionParam, 'versionId') : undefined;
    const result = await getPool().query(
      `SELECT v.*, f.path FROM files f JOIN versions v ON v.id = COALESCE($3::uuid, f.current_version_id)
       WHERE f.drive_id = $1 AND f.path = $2 AND f.deleted_at IS NULL AND v.file_id = f.id`,
      [driveId, path, versionId ?? null],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new ApiError('not_found', 'File not found.');
    return response({ ...rowVersion(row), downloadUrl: await presignedDownload(row.object_key) });
  }
  if (operation === 'list' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const { limit, cursor } = page(url);
    const p = prefix(url.searchParams.get('prefix'));
    const decoded = decodeCursor<{ path: string; id: string }>(cursor);
    const params: unknown[] = [driveId, `${p}%`];
    let clause = `f.drive_id = $1 AND f.deleted_at IS NULL AND f.path LIKE $2`;
    if (decoded) {
      params.push(decoded.path, decoded.id);
      clause += ` AND (f.path, f.id) > ($3, $4::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT f.id, f.path, v.id AS version_id, v.ciphertext_size, v.agent_id, v.machine_id, v.user_id, v.tags, v.description, v.created_at
       FROM files f JOIN versions v ON v.id = f.current_version_id WHERE ${clause} ORDER BY f.path, f.id LIMIT $${params.length}`,
      params,
    );
    const items = rows.rows.slice(0, limit);
    return response({
      items,
      nextCursor:
        rows.rows.length > limit
          ? encodeCursor({ path: items.at(-1).path, id: items.at(-1).id })
          : null,
    });
  }
  if (operation === 'versions' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const path = canonicalPath(url.searchParams.get('path'));
    const rows = await getPool().query(
      `SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE f.drive_id = $1 AND f.path = $2 ORDER BY v.created_at DESC, v.id DESC LIMIT 100`,
      [driveId, path],
    );
    return response(rows.rows.map(rowVersion));
  }
  if (operation === 'recent' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const sinceValue = url.searchParams.get('since');
    const since = sinceValue ? new Date(sinceValue) : new Date(0);
    if (Number.isNaN(since.getTime()))
      throw new ApiError('validation_error', 'since must be an ISO timestamp.');
    const rows = await getPool().query(
      `SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.drive_id = $1 AND v.created_at > $2 ORDER BY v.created_at, v.id LIMIT 100`,
      [driveId, since],
    );
    return response(rows.rows.map(rowVersion));
  }
  if (operation === 'search' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const q = url.searchParams.get('q') ?? '';
    const pattern = escapedLike(q);
    const tag = url.searchParams.get('tag');
    const agentId = url.searchParams.get('agentId');
    const machine = url.searchParams.get('machine');
    const user = url.searchParams.get('user');
    const params: unknown[] = [driveId, pattern];
    let where = `f.drive_id = $1 AND f.deleted_at IS NULL AND f.path ILIKE $2 ESCAPE '\\'`;
    if (tag) {
      params.push(tag);
      where += ` AND $${params.length} = ANY(v.tags)`;
    }
    if (agentId) {
      params.push(uuid(agentId, 'agentId'));
      where += ` AND v.agent_id = $${params.length}`;
    }
    if (machine) {
      params.push(machine);
      where += ` AND v.machine_id IN (SELECT id FROM machines WHERE name = $${params.length})`;
    }
    if (user) {
      params.push(user);
      where += ` AND v.user_id = $${params.length}`;
    }
    params.push(100);
    const rows = await getPool().query(
      `SELECT v.*, f.path FROM files f JOIN versions v ON v.id = f.current_version_id WHERE ${where} ORDER BY f.path, f.id LIMIT $${params.length}`,
      params,
    );
    return response(rows.rows.map(rowVersion));
  }
  if (operation === 'move' && request.method === 'POST') {
    need(auth, 'write', driveId);
    const body = await jsonBody(request);
    const from = canonicalPath(body.path);
    const to = canonicalPath(body.destinationPath, 'destinationPath');
    const result = await getPool().query(
      `UPDATE files SET path = $1 WHERE drive_id = $2 AND path = $3 AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM files WHERE drive_id = $2 AND path = $1) RETURNING id, path`,
      [to, driveId, from],
    );
    if (!result.rows[0])
      throw new ApiError('conflict', 'The source is missing or the destination exists.');
    return response(result.rows[0]);
  }
  if (operation === 'delete' && request.method === 'POST') {
    need(auth, 'delete', driveId);
    const body = await jsonBody(request);
    const path = canonicalPath(body.path);
    const result = await getPool().query(
      'UPDATE files SET deleted_at = now() WHERE drive_id = $1 AND path = $2 AND deleted_at IS NULL RETURNING id, path, deleted_at',
      [driveId, path],
    );
    if (!result.rows[0]) throw new ApiError('not_found', 'File not found.');
    return response(result.rows[0]);
  }
  if (operation === 'copy' && request.method === 'POST')
    return derivedVersion(request, auth, driveId, false);
  if (operation === 'restore' && request.method === 'POST')
    return derivedVersion(request, auth, driveId, true);
  throw new ApiError('not_found', 'Endpoint not found.');
}

async function derivedVersion(request: Request, auth: Auth, driveId: string, restore: boolean) {
  need(auth, 'write', driveId);
  const body = await jsonBody(request);
  const sourcePath = canonicalPath(body.path);
  const destinationPath = restore
    ? sourcePath
    : canonicalPath(body.destinationPath, 'destinationPath');
  const requestedVersion =
    body.versionId === undefined
      ? undefined
      : uuid(typeof body.versionId === 'string' ? body.versionId : undefined, 'versionId');
  const machine = await withTransaction((client) => machineId(client, auth, request));
  let copiedKey: string | undefined;
  let result: Row;
  try {
    result = await withTransaction(async (client) => {
      await client.query('SELECT id FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE', [
        driveId,
        auth.accountId,
      ]);
      const source = await client.query(
        `SELECT f.*, v.* FROM files f JOIN versions v ON v.id = COALESCE($3::uuid, f.current_version_id)
       WHERE f.drive_id = $1 AND f.path = $2 AND v.file_id = f.id ${restore ? '' : 'AND f.deleted_at IS NULL'} FOR UPDATE`,
        [driveId, sourcePath, requestedVersion ?? null],
      );
      const row = source.rows[0] as Row | undefined;
      if (!row) throw new ApiError('not_found', 'Source file or version not found.');
      const existing = await client.query(
        'SELECT id FROM files WHERE drive_id = $1 AND path = $2',
        [driveId, destinationPath],
      );
      if (existing.rows[0] && (!restore || existing.rows[0].id !== row.file_id))
        throw new ApiError('conflict', 'The destination exists.');
      const used = await client.query(
        'SELECT COALESCE(SUM(ciphertext_size),0)::bigint AS used FROM versions WHERE drive_id = $1',
        [driveId],
      );
      const quota = await client.query('SELECT quota_bytes FROM drives WHERE id = $1', [driveId]);
      if (
        Number(used.rows[0].used) + Number(row.ciphertext_size) >
        Number(quota.rows[0].quota_bytes)
      )
        throw new ApiError('quota_exceeded', 'The drive quota would be exceeded.');
      const fileId = existing.rows[0]?.id ?? randomUUID();
      const versionId = randomUUID();
      const objectKey = `objects/${auth.accountId}/${driveId}/${versionId}`;
      await copyObject(row.object_key, objectKey);
      copiedKey = objectKey;
      if (!existing.rows[0])
        await client.query(
          'INSERT INTO files (id,drive_id,path,current_version_id) VALUES ($1,$2,$3,$4)',
          [fileId, driveId, destinationPath, versionId],
        );
      else
        await client.query(
          'UPDATE files SET current_version_id = $1, deleted_at = NULL WHERE id = $2',
          [versionId, fileId],
        );
      await client.query(
        `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id,machine_id,user_id,tags,description)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          versionId,
          fileId,
          driveId,
          objectKey,
          row.ciphertext_size,
          row.wrapped_key,
          auth.agentId,
          machine,
          row.user_id,
          row.tags,
          row.description,
        ],
      );
      const output = await client.query(
        'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
        [versionId],
      );
      return output.rows[0] as Row;
    });
  } catch (error) {
    if (copiedKey) await deleteObject(copiedKey).catch(() => undefined);
    throw error;
  }
  return response({ version: rowVersion(result) }, 201);
}

export async function handleApiRequest(request: Request) {
  const url = new URL(request.url);
  const context: RequestContext = { action: actionFor(url.pathname), status: 500 };
  let output: Response;
  try {
    context.auth = await authenticate(request);
    const relative = url.pathname
      .replace(/^\/api\/v1\/?/, '')
      .split('/')
      .filter(Boolean);
    const control = await controlPlane(request, context.auth, relative);
    if (control) output = control;
    else if (relative[0] === 'drives' && relative.length >= 3) {
      uuid(relative[1], 'drive id');
      output = await fileEndpoint(request, context.auth, relative[1]!, relative[2]!, url);
    } else {
      throw new ApiError('not_found', 'Endpoint not found.');
    }
    context.status = output.status;
  } catch (error) {
    const mapped = error instanceof ApiError ? error : errorFromDatabase(error);
    output = responseForError(mapped);
    context.status = errorStatus(mapped);
    context.errorCode = mapped.code;
  }
  try {
    await audit(context);
  } catch {
    return responseForError(
      new ApiError('internal_error', 'The audit record could not be written.'),
    );
  }
  return output;
}

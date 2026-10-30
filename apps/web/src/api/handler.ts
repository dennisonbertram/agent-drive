import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { getPool, withTransaction } from '../db/client';
import { ApiError, errorFromDatabase, responseForError } from './errors';
import {
  boundedSize,
  canonicalPath,
  decodeCursor,
  escapeLikeLiteral,
  encodeCursor,
  escapedLike,
  jsonBody,
  optionalString,
  page,
  prefix,
  queryValue,
  stringField,
  secureTransportAllowed,
  tags,
  uuid,
} from './validation';
import {
  copyObject,
  deleteObject,
  objectInfo,
  presignedDownload,
  presignedUpload,
} from './storage';
import { cleanupExpiredUploads } from './upload-cleanup';

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
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
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

function actionFor(method: string, parts: string[]) {
  if (parts.length === 1 && parts[0] === 'whoami' && method === 'GET') return 'whoami.read';
  if (parts.length === 1 && parts[0] === 'agents' && method === 'GET') return 'agents.list';
  if (parts.length === 1 && parts[0] === 'agents' && method === 'POST') return 'agents.create';
  if (parts.length === 1 && parts[0] === 'drives' && method === 'GET') return 'drives.list';
  if (parts.length === 1 && parts[0] === 'drives' && method === 'POST') return 'drives.create';
  if (parts.length === 1 && parts[0] === 'keys' && method === 'GET') return 'keys.list';
  if (parts.length === 1 && parts[0] === 'keys' && method === 'POST') return 'keys.create';
  if (parts.length === 2 && parts[0] === 'keys' && method === 'DELETE') return 'keys.revoke';
  const actions: Record<string, string> = {
    'POST:put': 'drive.put',
    'POST:commit': 'drive.commit',
    'GET:get': 'drive.get',
    'GET:list': 'drive.list',
    'POST:move': 'drive.move',
    'POST:copy': 'drive.copy',
    'POST:delete': 'drive.delete',
    'POST:restore': 'drive.restore',
    'GET:versions': 'drive.versions',
    'GET:recent': 'drive.recent',
    'GET:search': 'drive.search',
  };
  if (parts.length === 3 && parts[0] === 'drives')
    return actions[`${method}:${parts[2]}`] ?? 'unknown';
  return 'unknown';
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
  if (!auth.driveIds.includes(driveId)) {
    throw new ApiError('permission_denied', 'The API key is not scoped to this drive.');
  }
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

function collection(
  rows: Row[],
  limit: number,
  valueOf: (row: Row) => string,
  idOf: (row: Row) => string = (row) => row.id,
) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor({ value: valueOf(last), id: idOf(last) }) : null,
  };
}

function appendFileFilters(url: URL, params: unknown[], includeQuery: boolean) {
  const clauses: string[] = [];
  if (includeQuery) {
    const q = queryValue(url, 'q', 128);
    params.push(escapedLike(q ?? ''));
    clauses.push(`f.path ILIKE $${params.length} ESCAPE '\\'`);
  }
  const tag = queryValue(url, 'tag', 64);
  const agentId = queryValue(url, 'agentId', 64);
  const machine = queryValue(url, 'machine', 128);
  const user = queryValue(url, 'user', 256);
  if (tag) {
    params.push(tag);
    clauses.push(`$${params.length} = ANY(v.tags)`);
  }
  if (agentId) {
    params.push(uuid(agentId, 'agentId'));
    clauses.push(`v.agent_id = $${params.length}`);
  }
  if (machine) {
    params.push(machine);
    clauses.push(`v.machine_id IN (SELECT id FROM machines WHERE name = $${params.length})`);
  }
  if (user) {
    params.push(user);
    clauses.push(`v.user_id = $${params.length}`);
  }
  return clauses.map((clause) => ` AND ${clause}`).join('');
}

async function controlPlane(request: Request, auth: Auth, parts: string[]) {
  const method = request.method;
  if (parts.length === 1 && parts[0] === 'whoami' && method === 'GET') {
    return response({
      accountId: auth.accountId,
      agentId: auth.agentId,
      keyId: auth.keyId,
      scopes: auth.scopes,
      driveIds: auth.scopes.includes('manage') ? null : auth.driveIds,
    });
  }
  if (parts.length === 1 && parts[0] === 'agents' && method === 'GET') {
    manage(auth);
    const { limit, cursor } = page(new URL(request.url));
    const decoded = decodeCursor(cursor, 'name');
    const params: unknown[] = [auth.accountId];
    let where = 'account_id = $1';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ' AND (name, id) > ($2, $3::uuid)';
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, name, created_at FROM agents WHERE ${where} ORDER BY name, id LIMIT $${params.length}`,
      params,
    );
    return response(collection(rows.rows as Row[], limit, (row) => row.name));
  }
  if (parts.length === 1 && parts[0] === 'agents' && method === 'POST') {
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
  if (parts.length === 1 && parts[0] === 'drives' && method === 'GET') {
    if (!auth.scopes.includes('manage')) need(auth, 'read');
    const { limit, cursor } = page(new URL(request.url));
    const decoded = decodeCursor(cursor, 'name');
    const params: unknown[] = [
      auth.accountId,
      auth.scopes.includes('manage') ? null : auth.driveIds,
    ];
    let where = 'account_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ' AND (name, id) > ($3, $4::uuid)';
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, name, quota_bytes, created_at FROM drives WHERE ${where} ORDER BY name, id LIMIT $${params.length}`,
      params,
    );
    return response(collection(rows.rows as Row[], limit, (row) => row.name));
  }
  if (parts[0] === 'drives' && parts.length === 1 && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const name = stringField(body, 'name', { required: true, max: 128 })!;
    const quota =
      body.quotaBytes === undefined ? 5_368_709_120 : boundedSize(body.quotaBytes, 'quotaBytes');
    const result = await getPool().query(
      `INSERT INTO drives (account_id, name, quota_bytes) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, name) DO NOTHING
       RETURNING id, name, quota_bytes, created_at`,
      [auth.accountId, name, quota],
    );
    if (result.rows[0]) return response({ ...result.rows[0], created: true }, 200);
    const existing = await getPool().query(
      'SELECT id, name, quota_bytes, created_at FROM drives WHERE account_id = $1 AND name = $2',
      [auth.accountId, name],
    );
    if (!existing.rows[0]) throw new ApiError('internal_error', 'The drive could not be created.');
    return response({ ...existing.rows[0], created: false }, 200);
  }
  if (parts.length === 1 && parts[0] === 'keys' && method === 'GET') {
    manage(auth);
    const { limit, cursor } = page(new URL(request.url));
    const decoded = decodeCursor(cursor, 'timestamp');
    const params: unknown[] = [auth.accountId];
    let where = 'account_id = $1';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ' AND (created_at, id) > ($2::timestamptz, $3::uuid)';
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, agent_id, label, drive_ids, scopes, revoked_at, created_at,
              created_at::text AS cursor_created_at
         FROM api_keys WHERE ${where} ORDER BY created_at, id LIMIT $${params.length}`,
      params,
    );
    return response(collection(rows.rows as Row[], limit, (row) => row.cursor_created_at));
  }
  if (parts.length === 1 && parts[0] === 'keys' && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const agentId = uuid(stringField(body, 'agentId', { required: true }), 'agentId');
    const label = stringField(body, 'label', { required: true, max: 128 })!;
    if (!Array.isArray(body.driveIds) || body.driveIds.length > 100)
      throw new ApiError('validation_error', 'driveIds must be an array of UUIDs.');
    const drives = [
      ...new Set(
        body.driveIds.map((value) =>
          uuid(typeof value === 'string' ? value : undefined, 'driveId'),
        ),
      ),
    ];
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
  if (parts.length === 2 && parts[0] === 'keys' && method === 'DELETE') {
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
  const drive = await ensureDrive(auth, driveId);
  await cleanupExpiredUploads();
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
  let staged: { size: number; etag: string | undefined };
  try {
    staged = await objectInfo(source.staging_key);
  } catch {
    throw new ApiError('conflict', 'The staged ciphertext is not available.');
  }
  if (staged.size !== Number(source.ciphertext_size) || !staged.etag)
    throw new ApiError('conflict', 'Uploaded ciphertext size does not match the intent.');
  const stagedEtag = staged.etag;
  const versionId = randomUUID();
  const finalKey = `objects/${source.account_id}/${driveId}/${versionId}`;
  let copied = false;
  try {
    const result = await withTransaction(async (client) => {
      const lockedIntentResult = await client.query(
        `SELECT * FROM upload_intents
          WHERE id = $1 AND drive_id = $2 AND api_key_id = $3
          FOR UPDATE`,
        [intentId, driveId, auth.keyId],
      );
      const lockedIntent = lockedIntentResult.rows[0] as Row | undefined;
      if (!lockedIntent) throw new ApiError('not_found', 'Upload intent not found.');
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE',
        [driveId, auth.accountId],
      );
      if (!lockedDrive.rows[0]) throw new ApiError('not_found', 'Drive not found.');
      if (lockedIntent.committed_version_id) {
        const existingVersion = await client.query(
          'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
          [lockedIntent.committed_version_id],
        );
        return { version: existingVersion.rows[0] as Row, idempotent: true };
      }
      if (new Date(lockedIntent.expires_at).getTime() < Date.now())
        throw new ApiError('conflict', 'The upload intent has expired.');
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
      try {
        await copyObject(lockedIntent.staging_key, finalKey, stagedEtag);
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && '$metadata' in error
            ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
            : undefined;
        const name =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name: unknown }).name)
            : '';
        if (status === 412 || name === 'PreconditionFailed')
          throw new ApiError('conflict', 'The staged ciphertext changed before commit.');
        throw error;
      }
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
      await client.query(
        `INSERT INTO file_events
          (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
         VALUES ($1, $2, 'put', $3, $4, $5, $6, $7)`,
        [
          driveId,
          fileId,
          lockedIntent.path,
          versionId,
          lockedIntent.agent_id,
          lockedIntent.machine_id,
          lockedIntent.user_id,
        ],
      );
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
    const decoded = decodeCursor(cursor, 'path');
    const params: unknown[] = [driveId, `${escapeLikeLiteral(p)}%`];
    let clause = `f.drive_id = $1 AND f.deleted_at IS NULL AND f.path LIKE $2 ESCAPE '\\'`;
    clause += appendFileFilters(url, params, true);
    if (decoded) {
      params.push(decoded.value, decoded.id);
      clause += ` AND (f.path, f.id) > ($${params.length - 1}, $${params.length}::uuid)`;
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
          ? encodeCursor({ value: items.at(-1).path, id: items.at(-1).id })
          : null,
    });
  }
  if (operation === 'versions' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const path = canonicalPath(url.searchParams.get('path'));
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'timestamp');
    const params: unknown[] = [driveId, path];
    let cursorClause = '';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      cursorClause = ` AND (v.created_at, v.id) < ($3::timestamptz, $4::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT v.*, f.path, v.created_at::text AS cursor_created_at
         FROM versions v JOIN files f ON f.id = v.file_id
        WHERE f.drive_id = $1 AND f.path = $2${cursorClause}
        ORDER BY v.created_at DESC, v.id DESC LIMIT $${params.length}`,
      params,
    );
    const output = collection(rows.rows as Row[], limit, (row) => row.cursor_created_at);
    return response({ ...output, items: output.items.map(rowVersion) });
  }
  if (operation === 'recent' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const sinceValue = queryValue(url, 'since', 128);
    const since = sinceValue ?? new Date(0).toISOString();
    if (Number.isNaN(Date.parse(since)))
      throw new ApiError('validation_error', 'since must be an ISO timestamp.');
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'timestamp');
    const params: unknown[] = [driveId, since];
    let cursorClause = '';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      cursorClause = ` AND (created_at, id) > ($3::timestamptz, $4::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, operation, path, previous_path, version_id, agent_id, machine_id, user_id,
              created_at, created_at::text AS cursor_created_at
         FROM file_events
        WHERE drive_id = $1 AND created_at > $2${cursorClause}
        ORDER BY created_at, id LIMIT $${params.length}`,
      params,
    );
    const output = collection(rows.rows as Row[], limit, (row) => row.cursor_created_at);
    return response({
      ...output,
      items: output.items.map((row) => ({
        id: row.id,
        operation: row.operation,
        path: row.path,
        previousPath: row.previous_path,
        versionId: row.version_id,
        agentId: row.agent_id,
        machineId: row.machine_id,
        userId: row.user_id,
        createdAt: row.created_at,
      })),
    });
  }
  if (operation === 'search' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const params: unknown[] = [driveId];
    let where = 'f.drive_id = $1 AND f.deleted_at IS NULL';
    where += appendFileFilters(url, params, true);
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'path');
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ` AND (f.path, f.id) > ($${params.length - 1}, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT v.*, f.path, f.id AS file_id FROM files f JOIN versions v ON v.id = f.current_version_id WHERE ${where} ORDER BY f.path, f.id LIMIT $${params.length}`,
      params,
    );
    const output = collection(
      rows.rows as Row[],
      limit,
      (row) => row.path,
      (row) => row.file_id,
    );
    return response({ ...output, items: output.items.map(rowVersion) });
  }
  if (operation === 'move' && request.method === 'POST') {
    need(auth, 'write', driveId);
    const body = await jsonBody(request);
    const from = canonicalPath(body.path);
    const to = canonicalPath(body.destinationPath, 'destinationPath');
    const userId = optionalString(body, 'userId', 256) ?? null;
    const moved = await withTransaction(async (client) => {
      await client.query('SELECT id FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE', [
        driveId,
        auth.accountId,
      ]);
      const machine = await machineId(client, auth, request);
      const result = await client.query(
        `UPDATE files SET path = $1 WHERE drive_id = $2 AND path = $3 AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM files WHERE drive_id = $2 AND path = $1)
         RETURNING id, path, current_version_id`,
        [to, driveId, from],
      );
      const file = result.rows[0] as Row | undefined;
      if (!file) throw new ApiError('conflict', 'The source is missing or the destination exists.');
      await client.query(
        `INSERT INTO file_events
          (drive_id, file_id, operation, path, previous_path, version_id, agent_id, machine_id, user_id)
         VALUES ($1, $2, 'move', $3, $4, $5, $6, $7, $8)`,
        [driveId, file.id, to, from, file.current_version_id, auth.agentId, machine, userId],
      );
      return { id: file.id, path: file.path };
    });
    return response(moved);
  }
  if (operation === 'delete' && request.method === 'POST') {
    need(auth, 'delete', driveId);
    const body = await jsonBody(request);
    const path = canonicalPath(body.path);
    const userId = optionalString(body, 'userId', 256) ?? null;
    const deleted = await withTransaction(async (client) => {
      await client.query('SELECT id FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE', [
        driveId,
        auth.accountId,
      ]);
      const machine = await machineId(client, auth, request);
      const result = await client.query(
        `UPDATE files SET deleted_at = now()
          WHERE drive_id = $1 AND path = $2 AND deleted_at IS NULL
          RETURNING id, path, current_version_id, deleted_at`,
        [driveId, path],
      );
      const file = result.rows[0] as Row | undefined;
      if (!file) throw new ApiError('not_found', 'File not found.');
      await client.query(
        `INSERT INTO file_events
          (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
         VALUES ($1, $2, 'delete', $3, $4, $5, $6, $7)`,
        [driveId, file.id, file.path, file.current_version_id, auth.agentId, machine, userId],
      );
      return { id: file.id, path: file.path, deleted_at: file.deleted_at };
    });
    return response(deleted);
  }
  if (operation === 'copy' && request.method === 'POST')
    return derivedVersion(request, auth, driveId, false);
  if (operation === 'restore' && request.method === 'POST')
    return derivedVersion(request, auth, driveId, true);
  throw new ApiError('not_found', 'Endpoint not found.');
}

async function derivedVersion(request: Request, auth: Auth, driveId: string, restore: boolean) {
  need(auth, 'read', driveId);
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
  const userId = optionalString(body, 'userId', 256) ?? null;
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
          userId,
          row.tags,
          row.description,
        ],
      );
      await client.query(
        `INSERT INTO file_events
          (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          driveId,
          fileId,
          restore ? 'restore' : 'copy',
          destinationPath,
          versionId,
          auth.agentId,
          machine,
          userId,
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
  const rawPath = url.pathname;
  const validBase =
    rawPath.startsWith('/api/v1/') && !rawPath.includes('//') && !rawPath.endsWith('/');
  const relative = validBase ? rawPath.slice('/api/v1/'.length).split('/') : [];
  const context: RequestContext = { action: actionFor(request.method, relative), status: 500 };
  let output: Response;
  try {
    if (!secureTransportAllowed(url.protocol, process.env.NODE_ENV)) {
      throw new ApiError('permission_denied', 'HTTPS is required for API requests.');
    }
    if (!validBase || url.search.length > 8192) {
      throw new ApiError(
        url.search.length > 8192 ? 'validation_error' : 'not_found',
        url.search.length > 8192 ? 'The query string is too long.' : 'Endpoint not found.',
      );
    }
    context.auth = await authenticate(request);
    const control = await controlPlane(request, context.auth, relative);
    if (control) output = control;
    else if (relative[0] === 'drives' && relative.length === 3) {
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

import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  MAX_QUERY_LENGTH,
  optionalString,
  page,
  isoMicros,
  listDelimiter,
  listSort,
  prefix,
  type ListSort,
  queryValue,
  stringField,
  secureTransportAllowed,
  tags,
  uuid,
  withinWritePaths,
  writePaths,
  assertDelegation,
} from './validation';
import {
  copyObject,
  deleteObject,
  objectInfo,
  presignedDownload,
  presignedUpload,
} from './storage';
import { cleanupExpiredUploads } from './upload-cleanup';
import { bearerDeviceEndpoint, consoleDeviceEndpoint } from './device';
import {
  authorizeDownload,
  billingState,
  billingSummary,
  enforceKeyRateLimit,
  enforceOperationBudget,
  enforceWriteBudget,
  lockBillingAccount,
  queueBillingDeliveries,
} from '../billing/ledger';
import {
  checkoutConfigured,
  createCheckout,
  createPortal,
  egressMeteringConfigured,
  emailConfigured,
} from '../billing/providers';

type Auth = {
  keyId: string | null;
  accountId: string;
  agentId: string;
  scopes: string[];
  writePaths: string[];
  driveIds: string[];
  userId?: string;
  accountName?: string;
};
type RequestContext = {
  auth?: Auth;
  accountId?: string | null;
  action: string;
  status: number;
  errorCode?: string;
  auditId?: string;
};
// Database rows are intentionally untyped at this boundary; all externally visible fields are selected explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = QueryResultRow & Record<string, any>;

const scopeNames = new Set(['read', 'write', 'delete', 'share', 'manage', 'delegate']);
const DEFAULT_DRIVE_QUOTA_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const quotaControlledActions = new Set([
  'drives.create',
  'drive.put',
  'drive.commit',
  'drive.get',
  'drive.list',
  'drive.versions',
  'drive.recent',
  'drive.search',
  'drive.trash',
  'drive.move',
  'drive.copy',
  'drive.restore',
  'share.create',
]);
// Reads the console user makes just by looking at a page. GET audit?consoleReads=0 hides them.
const consoleReadActions = [
  'drive.get',
  'drive.versions',
  'drive.recent',
  'drive.search',
  'drive.trash',
];

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
    `SELECT k.id, k.account_id, k.agent_id, k.scopes, k.write_paths, k.drive_ids
       FROM api_keys k
       JOIN accounts a ON a.id=k.account_id AND a.deleting_at IS NULL
      WHERE k.token_hash = $1 AND k.revoked_at IS NULL`,
    [hashToken(bearer(request))],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new ApiError('unauthorized', 'The API key is invalid or revoked.');
  return {
    keyId: row.id,
    accountId: row.account_id,
    agentId: row.agent_id,
    scopes: row.scopes ?? [],
    writePaths: row.write_paths ?? [],
    driveIds: row.drive_ids ?? [],
  };
}

async function authenticateConsole(userId: string): Promise<Auth> {
  if (!userId || userId.length > 256 || /[\u0000-\u001f\u007f]/u.test(userId)) {
    throw new ApiError('unauthorized', 'The console session is invalid.');
  }
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    const userHash = hashToken(userId);
    if (
      (
        await client.query('SELECT 1 FROM console_user_tombstones WHERE external_user_hash = $1', [
          userHash,
        ])
      ).rowCount
    )
      throw new ApiError('unauthorized', 'The console session is invalid.');
    const existing = await client.query(
      'SELECT id, name, deleting_at FROM accounts WHERE external_clerk_user_id = $1',
      [userId],
    );
    if (existing.rows[0]?.deleting_at) {
      const agent = await client.query(
        "SELECT id FROM agents WHERE account_id = $1 AND name = '__console__'",
        [existing.rows[0].id],
      );
      if (!agent.rows[0])
        throw new ApiError('unauthorized', 'The console session is no longer valid.');
      return {
        keyId: null,
        accountId: existing.rows[0].id as string,
        accountName: existing.rows[0].name as string,
        agentId: agent.rows[0]?.id as string,
        scopes: [...scopeNames],
        writePaths: [],
        driveIds: [],
        userId,
      };
    }
    const account = await client.query(
      `INSERT INTO accounts (name, external_clerk_user_id)
       VALUES ('Personal workspace', $1)
       ON CONFLICT (external_clerk_user_id) WHERE external_clerk_user_id IS NOT NULL
       DO UPDATE SET external_clerk_user_id = EXCLUDED.external_clerk_user_id
       RETURNING id, name`,
      [userId],
    );
    const accountId = account.rows[0].id as string;
    const agent = await client.query(
      `INSERT INTO agents (account_id, name) VALUES ($1, '__console__')
       ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [accountId],
    );
    const drives = await client.query('SELECT id FROM drives WHERE account_id = $1 ORDER BY id', [
      accountId,
    ]);
    return {
      keyId: null,
      accountId,
      accountName: account.rows[0].name as string,
      agentId: agent.rows[0].id as string,
      scopes: [...scopeNames],
      writePaths: [],
      driveIds: drives.rows.map((row) => row.id as string),
      userId,
    };
  });
}

function need(auth: Auth, scope: string, driveId?: string) {
  if (!auth.scopes.includes(scope))
    throw new ApiError('permission_denied', `The API key lacks the "${scope}" scope.`);
  if (driveId && !auth.driveIds.includes(driveId)) {
    throw new ApiError('permission_denied', 'The API key is not scoped to this drive.');
  }
}

function needWritePath(auth: Auth, path: string) {
  if (!withinWritePaths(auth.writePaths, path))
    throw new ApiError(
      'permission_denied',
      `The API key may only write under ${auth.writePaths.join(', ')}.`,
    );
}

function manage(auth: Auth) {
  need(auth, 'manage');
}

function driveQuota(value: unknown, fallback: bigint) {
  if (value === undefined) return Number(fallback);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError('validation_error', 'quotaBytes must be a positive safe integer.');
  }
  return value;
}

function billingFlags() {
  return {
    checkoutConfigured: checkoutConfigured(),
    egressMeteringConfigured: egressMeteringConfigured(),
    egressNotMetered: process.env.S3_EGRESS_METERING === 'none',
    emailConfigured: emailConfigured(),
  };
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

function deletionJobOutput(row: Row) {
  return {
    deletion: {
      id: row.id,
      kind: row.kind,
      targetId: row.target_id,
      status: row.completed_at ? 'complete' : row.last_error ? 'blocked' : 'pending',
      requestedAt: row.requested_at,
      notBefore: row.not_before,
      completedAt: row.completed_at,
      lastError: row.last_error,
    },
  };
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

function actionFor(method: string, parts: string[], bearer = false) {
  if (bearer && parts[0] === 'device' && parts.length === 2 && method === 'GET')
    return 'device.read';
  if (bearer && parts[0] === 'device' && parts.length === 3 && parts[2] === 'grant')
    return 'device.grant';
  if (parts[0] === 'device' && parts.length === 2 && method === 'GET') return 'console.device.read';
  if (parts[0] === 'device' && parts.length === 3 && method === 'POST' && parts[2] === 'approve')
    return 'console.device.approve';
  if (parts[0] === 'device' && parts.length === 3 && method === 'POST' && parts[2] === 'deny')
    return 'console.device.deny';
  if (parts.length === 1 && parts[0] === 'deletions' && method === 'GET')
    return 'console.deletions.list';
  if (parts.length === 1 && parts[0] === 'audit' && method === 'GET') return 'console.audit.list';
  if (parts.length === 1 && parts[0] === 'account' && method === 'DELETE')
    return 'console.account.delete';
  if (parts.length === 2 && parts[0] === 'drives' && method === 'DELETE')
    return 'console.drive.delete';
  if (parts.length === 1 && parts[0] === 'session' && method === 'GET')
    return 'console.session.read';
  if (parts.length === 1 && parts[0] === 'usage' && method === 'GET') return 'console.usage.read';
  if (parts[0] === 'billing') {
    if (parts.length === 1 && method === 'GET') return 'billing.read';
    if (parts.length === 2 && parts[1] === 'statements' && method === 'GET')
      return 'billing.statements.list';
    if (parts.length === 2 && parts[1] === 'settings' && method === 'PATCH')
      return 'billing.settings.update';
    if (parts.length === 2 && parts[1] === 'checkout' && method === 'POST')
      return 'billing.checkout';
    if (parts.length === 2 && parts[1] === 'portal' && method === 'POST') return 'billing.portal';
  }
  if (parts.length === 1 && parts[0] === 'whoami' && method === 'GET') return 'whoami.read';
  if (parts.length === 1 && parts[0] === 'agents' && method === 'GET') return 'agents.list';
  if (parts.length === 1 && parts[0] === 'agents' && method === 'POST') return 'agents.create';
  if (parts.length === 1 && parts[0] === 'drives' && method === 'GET') return 'drives.list';
  if (parts.length === 1 && parts[0] === 'drives' && method === 'POST') return 'drives.create';
  if (parts.length === 1 && parts[0] === 'keys' && method === 'GET') return 'keys.list';
  if (parts.length === 1 && parts[0] === 'keys' && method === 'POST') return 'keys.create';
  if (parts.length === 2 && parts[0] === 'keys' && method === 'DELETE') return 'keys.revoke';
  if (parts.length === 3 && parts[0] === 'agents' && parts[2] === 'revoke' && method === 'POST')
    return 'agents.revoke';
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
    'GET:trash': 'drive.trash',
  };
  if (parts.length === 3 && parts[0] === 'drives' && parts[2] === 'shares')
    return `share.${method === 'POST' ? 'create' : method === 'GET' ? 'list' : 'unknown'}`;
  if (parts.length === 4 && parts[0] === 'drives' && parts[2] === 'shares') return 'share.revoke';
  if (parts.length === 3 && parts[0] === 'drives' && parts[2] === 'key-backup' && method === 'POST')
    return 'drive.key_backup';
  if (parts.length === 3 && parts[0] === 'drives')
    return actions[`${method}:${parts[2]}`] ?? 'unknown';
  return 'unknown';
}

async function audit(
  context: RequestContext,
  client: PoolClient | ReturnType<typeof getPool> = getPool(),
  pending = false,
) {
  const outcome = pending ? 'pending' : context.status >= 400 ? 'failure' : 'success';
  if (context.auditId && !pending) {
    const updated = await client.query(
      `UPDATE audit_events SET outcome = $2, error_code = $3, http_status = $4
       WHERE id = $1 AND outcome = 'pending'`,
      [context.auditId, outcome, context.errorCode ?? null, context.status],
    );
    if (updated.rowCount !== 1) throw new Error('The reserved audit event was not found.');
    return context.auditId;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO audit_events
      (api_key_id, account_id, agent_id, user_id, action, outcome, error_code, http_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      context.auth?.keyId ?? null,
      context.auth?.accountId ?? context.accountId ?? null,
      context.auth?.agentId ?? null,
      context.auth?.userId ?? null,
      context.action,
      outcome,
      context.errorCode ?? null,
      pending ? 102 : context.status,
    ],
  );
  return inserted.rows[0]!.id;
}

async function reserveOperation(context: RequestContext) {
  const accountId = context.auth?.accountId ?? context.accountId;
  if (!accountId) throw new Error('An account is required to reserve an operation.');
  context.auditId = await withTransaction(async (client) => {
    await enforceOperationBudget(client, accountId);
    return audit(context, client, true);
  });
}

async function ensureDrive(auth: Auth, driveId: string) {
  if (!auth.driveIds.includes(driveId)) {
    throw new ApiError('permission_denied', 'The API key is not scoped to this drive.');
  }
  const result = await getPool().query(
    `SELECT d.id, d.account_id, d.name, d.quota_bytes
       FROM drives d JOIN accounts a ON a.id = d.account_id
      WHERE d.id = $1 AND d.deleting_at IS NULL AND a.deleting_at IS NULL`,
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

// Microsecond-exact ISO text for cursors (Date.parse accepts it; created_at::text does not parse).
const isoText = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Flat sort=modified reuses the 'timestamp' cursor; a path cursor must not reach the SQL cast.
function decodeModifiedCursor(cursor: string | undefined) {
  const decoded = decodeCursor(cursor, 'timestamp');
  if (decoded && !isoMicros(decoded.value))
    throw new ApiError('validation_error', 'cursor is invalid.');
  return decoded;
}

// Immediate children of `base` (files and folders). Filters apply to files before grouping.
// ponytail: each page re-aggregates every live file under the prefix (O(files in the subtree));
// add a (drive_id, path text_pattern_ops) WHERE deleted_at IS NULL index if EXPLAIN shows root
// listings over ~300 ms. Migration 0020 adds it; this query does not depend on it.
async function listChildren(
  url: URL,
  driveId: string,
  p: string,
  sort: ListSort,
  limit: number,
  cursor: string | undefined,
) {
  const base = p || '/';
  const bind = createHash('sha256')
    .update(`${driveId}\0${base}\0${sort}`)
    .digest('base64url')
    .slice(0, 16);
  const decoded = decodeCursor(cursor, 'child', sort);
  if (decoded && decoded.bind !== bind)
    throw new ApiError('validation_error', 'cursor is invalid.');
  const params: unknown[] = [driveId, `${escapeLikeLiteral(base)}%`, base];
  const filters = appendFileFilters(url, params, true);
  let outer = '';
  if (decoded) {
    if (sort === 'modified') {
      params.push(decoded.value, decoded.id);
      const [v, k] = [params.length - 1, params.length];
      outer = `WHERE created_at < $${v}::timestamptz OR (created_at = $${v}::timestamptz AND key COLLATE "C" > $${k})`;
    } else {
      params.push(decoded.id);
      outer = `WHERE key COLLATE "C" > $${params.length}`;
    }
  }
  params.push(limit + 1);
  const rows = await getPool().query(
    `WITH live AS (
       SELECT f.id, f.path, substr(f.path, length($3::text) + 1) AS rest, v.id AS version_id,
              v.ciphertext_size, v.agent_id, v.machine_id, v.user_id, v.tags, v.description, v.created_at
         FROM files f JOIN versions v ON v.id = f.current_version_id
        WHERE f.drive_id = $1 AND f.deleted_at IS NULL AND f.path LIKE $2 ESCAPE '\\'${filters}
     ), kids AS (
       SELECT 'file' AS kind, id, path, version_id, ciphertext_size, agent_id, machine_id, user_id,
              tags, description, created_at, NULL::bigint AS items, path AS key
         FROM live WHERE strpos(rest, '/') = 0
       UNION ALL
       SELECT 'folder', NULL, $3 || split_part(rest, '/', 1), NULL, sum(ciphertext_size)::bigint,
              NULL, NULL, NULL, NULL, NULL, max(created_at),
              count(DISTINCT split_part(rest, '/', 2) ||
                CASE WHEN split_part(rest, '/', 3) <> '' THEN '/' ELSE '' END),
              $3 || split_part(rest, '/', 1) || '/'
         FROM live WHERE strpos(rest, '/') > 0 GROUP BY split_part(rest, '/', 1)
     )
     SELECT *, ${isoText('created_at')} AS cursor_created_at FROM kids ${outer}
      ORDER BY ${sort === 'modified' ? 'created_at DESC, ' : ''}key COLLATE "C" LIMIT $${params.length}`,
    params,
  );
  const page = rows.rows.slice(0, limit);
  const last = rows.rows[limit - 1];
  return {
    items: page.map((r) =>
      r.kind === 'folder'
        ? {
            kind: r.kind,
            path: r.path,
            items: Number(r.items),
            ciphertext_size: r.ciphertext_size,
            created_at: r.created_at,
          }
        : {
            kind: r.kind,
            id: r.id,
            path: r.path,
            version_id: r.version_id,
            ciphertext_size: r.ciphertext_size,
            agent_id: r.agent_id,
            machine_id: r.machine_id,
            user_id: r.user_id,
            tags: r.tags,
            description: r.description,
            created_at: r.created_at,
          },
    ),
    nextCursor:
      rows.rows.length > limit
        ? encodeCursor(
            sort === 'modified'
              ? { k: last.key, t: last.cursor_created_at, b: bind }
              : { k: last.key, b: bind },
          )
        : null,
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
  if (parts[0] === 'device') return bearerDeviceEndpoint(request, auth, parts);
  if (parts.length === 1 && parts[0] === 'whoami' && method === 'GET') {
    return response({
      accountId: auth.accountId,
      agentId: auth.agentId,
      keyId: auth.keyId,
      scopes: auth.scopes,
      writePaths: auth.writePaths,
      driveIds: auth.scopes.includes('manage') ? null : auth.driveIds,
      ...billingFlags(),
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
      `SELECT id, name, quota_bytes, created_at, key_backup_at, key_backup_method FROM drives WHERE deleting_at IS NULL AND ${where} ORDER BY name, id LIMIT $${params.length}`,
      params,
    );
    return response(collection(rows.rows as Row[], limit, (row) => row.name));
  }
  if (
    parts.length === 3 &&
    parts[0] === 'drives' &&
    parts[2] === 'key-backup' &&
    method === 'POST'
  ) {
    const driveId = uuid(parts[1], 'drive id');
    need(auth, 'write');
    const body = await jsonBody(request);
    const unknown = Object.keys(body).find((name) => name !== 'method');
    if (unknown !== undefined)
      throw new ApiError('validation_error', `Unknown field: ${unknown.slice(0, 64)}.`);
    const backupMethod = body.method;
    if (backupMethod !== 'file' && backupMethod !== 'stdout' && backupMethod !== 'env')
      throw new ApiError('validation_error', 'method must be "file", "stdout", or "env".');
    const result = await getPool().query(
      `UPDATE drives SET key_backup_at = now(), key_backup_method = $3
        WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL AND id = ANY($4::uuid[])
        RETURNING key_backup_at, key_backup_method`,
      [driveId, auth.accountId, backupMethod, auth.driveIds],
    );
    if (!result.rows[0]) throw new ApiError('not_found', 'Drive not found.');
    return response({
      keyBackupAt: result.rows[0].key_backup_at,
      keyBackupMethod: result.rows[0].key_backup_method,
    });
  }
  if (parts[0] === 'drives' && parts.length === 1 && method === 'POST') {
    manage(auth);
    const body = await jsonBody(request);
    const name = stringField(body, 'name', { required: true, max: 128 })!;
    const result = await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      const existing = await client.query(
        'SELECT id, name, quota_bytes, created_at FROM drives WHERE account_id = $1 AND deleting_at IS NULL AND name = $2',
        [auth.accountId, name],
      );
      if (existing.rows[0]) return { ...existing.rows[0], created: false };
      await enforceWriteBudget(client, auth.accountId, { drives: 1n });
      const quota = driveQuota(body.quotaBytes, DEFAULT_DRIVE_QUOTA_BYTES);
      const created = await client.query(
        `INSERT INTO drives (account_id, name, quota_bytes) VALUES ($1, $2, $3)
         RETURNING id, name, quota_bytes, created_at`,
        [auth.accountId, name, quota],
      );
      return { ...created.rows[0], created: true };
    });
    return response(result, 200);
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
      `SELECT id, agent_id, label, drive_ids, scopes, write_paths, issued_by_agent_id, revoked_at, created_at,
              created_at::text AS cursor_created_at
         FROM api_keys WHERE ${where} ORDER BY created_at, id LIMIT $${params.length}`,
      params,
    );
    return response(collection(rows.rows as Row[], limit, (row) => row.cursor_created_at));
  }
  if (parts.length === 1 && parts[0] === 'keys' && method === 'POST') {
    const delegated = !auth.scopes.includes('manage');
    const body = await jsonBody(request);
    if (delegated) {
      // A delegate key creates a new agent; it never attaches keys to an existing identity.
      if (!auth.scopes.includes('delegate'))
        throw new ApiError('permission_denied', 'The API key needs the delegate scope.');
      if (body.agentId !== undefined)
        throw new ApiError('validation_error', 'agentId is not allowed; pass agentName.');
    }
    const agentName = delegated
      ? stringField(body, 'agentName', { required: true, max: 64 })!
      : undefined;
    const agentId = delegated
      ? undefined
      : uuid(stringField(body, 'agentId', { required: true }), 'agentId');
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
    const paths = writePaths(body);
    if (delegated) assertDelegation(auth, { driveIds: drives, scopes, writePaths: paths });
    if (agentId) {
      const agent = await getPool().query(
        'SELECT id FROM agents WHERE id = $1 AND account_id = $2',
        [agentId, auth.accountId],
      );
      if (!agent.rows[0]) throw new ApiError('not_found', 'Agent not found.');
    }
    const driveCheck = await getPool().query(
      'SELECT count(*)::int AS count FROM drives WHERE account_id = $1 AND deleting_at IS NULL AND id = ANY($2::uuid[])',
      [auth.accountId, drives],
    );
    if (Number(driveCheck.rows[0].count) !== drives.length)
      throw new ApiError('not_found', 'One or more drives were not found.');
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const row = await withTransaction(async (client) => {
      let keyAgentId = agentId;
      if (agentName) {
        try {
          keyAgentId = (
            await client.query(
              'INSERT INTO agents (account_id, name) VALUES ($1, $2) RETURNING id',
              [auth.accountId, agentName],
            )
          ).rows[0].id as string;
        } catch (error) {
          if ((error as { code?: string }).code === '23505')
            throw new ApiError(
              'conflict',
              `An agent named "${agentName}" already exists; choose another name.`,
            );
          throw error;
        }
      }
      const result = await client.query(
        `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes, write_paths, issued_by_agent_id)
         VALUES ($1, $2, $3, $4, $5::uuid[], $6::text[], $7::text[], $8)
         RETURNING id, agent_id, label, drive_ids, scopes, write_paths, issued_by_agent_id, created_at`,
        [
          auth.accountId,
          keyAgentId,
          label,
          hashToken(token),
          drives,
          scopes,
          paths,
          delegated ? auth.agentId : null,
        ],
      );
      return result.rows[0];
    });
    return response({ ...row, token }, 201);
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

async function consoleEndpoint(request: Request, auth: Auth, parts: string[], url: URL) {
  if (parts.length === 1 && parts[0] === 'deletions' && request.method === 'GET') {
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'timestamp');
    const params: unknown[] = [auth.accountId];
    let clause = 'account_id = $1';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      clause += ` AND (requested_at, id) < ($2::timestamptz, $3::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, kind, target_id, status, requested_at, requested_at_text, not_before, completed_at, last_error
         FROM (
           SELECT id, kind, target_id, requested_at, not_before, completed_at, last_error,
             requested_at::text AS requested_at_text,
             CASE WHEN completed_at IS NOT NULL THEN 'complete'
                  WHEN last_error IS NOT NULL THEN 'blocked' ELSE 'pending' END AS status,
             account_id
           FROM deletion_jobs WHERE ${clause}
         ) jobs ORDER BY requested_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const items = rows.rows.slice(0, limit).map((row) => ({
      id: row.id,
      kind: row.kind,
      targetId: row.target_id,
      status: row.status,
      requestedAt: row.requested_at,
      notBefore: row.not_before,
      completedAt: row.completed_at,
      lastError: row.last_error,
    }));
    return response({
      items,
      nextCursor:
        rows.rows.length > limit
          ? encodeCursor({
              value: rows.rows[limit - 1].requested_at_text,
              id: rows.rows[limit - 1].id,
            })
          : null,
    });
  }
  if (parts.length === 1 && parts[0] === 'audit' && request.method === 'GET') {
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'timestamp');
    const params: unknown[] = [auth.accountId];
    let clause = 'e.account_id = $1';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      clause += ` AND (e.created_at, e.id) < ($2::timestamptz, $3::uuid)`;
    }
    // ponytail: filter runs after the (account_id, created_at) index; a page can scan many console reads
    if (url.searchParams.get('consoleReads') === '0') {
      params.push(consoleReadActions);
      clause += ` AND NOT (e.user_id IS NOT NULL AND (e.action LIKE '%.list' OR e.action LIKE '%.read'
        OR e.action = ANY($${params.length}::text[])))`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT e.id, e.action, e.outcome, e.http_status, e.error_code, e.created_at,
              e.created_at::text AS created_at_text,
              a.name AS agent_name, k.label AS key_label, e.user_id
         FROM audit_events e
         LEFT JOIN agents a ON a.id = e.agent_id
         LEFT JOIN api_keys k ON k.id = e.api_key_id
        WHERE ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT $${params.length}`,
      params,
    );
    return response({
      items: rows.rows.slice(0, limit).map((row) => ({
        id: row.id,
        action: row.action,
        outcome: row.outcome,
        httpStatus: row.http_status,
        errorCode: row.error_code,
        createdAt: row.created_at,
        agentName: row.agent_name,
        keyLabel: row.key_label,
        userId: row.user_id,
      })),
      nextCursor:
        rows.rows.length > limit
          ? encodeCursor({
              value: rows.rows[limit - 1].created_at_text,
              id: rows.rows[limit - 1].id,
            })
          : null,
    });
  }
  if (parts.length === 2 && parts[0] === 'drives' && request.method === 'DELETE') {
    const driveId = uuid(parts[1], 'drive id');
    const body = await jsonBody(request);
    const confirmation = stringField(body, 'confirmation', { required: true, max: 128 });
    const existing = await getPool().query(
      'SELECT * FROM deletion_jobs WHERE kind=$1 AND target_id=$2 AND account_id=$3',
      ['drive', driveId, auth.accountId],
    );
    if (existing.rows[0]) return response(deletionJobOutput(existing.rows[0]), 202);
    return response(
      await withTransaction(async (client) => {
        await lockBillingAccount(client, auth.accountId);
        const retry = await client.query(
          'SELECT * FROM deletion_jobs WHERE kind=$1 AND target_id=$2 AND account_id=$3',
          ['drive', driveId, auth.accountId],
        );
        if (retry.rows[0]) return deletionJobOutput(retry.rows[0]);
        const state = await billingState(client, auth.accountId);
        await queueBillingDeliveries(client, state);
        const drive = await client.query(
          'SELECT id, name FROM drives WHERE id = $1 AND account_id = $2 FOR UPDATE',
          [driveId, auth.accountId],
        );
        if (!drive.rows[0]) throw new ApiError('not_found', 'Drive not found.');
        if (confirmation !== drive.rows[0].name)
          throw new ApiError('validation_error', 'The drive name confirmation is incorrect.');
        await client.query(
          'UPDATE drives SET deleting_at = COALESCE(deleting_at, now()) WHERE id = $1',
          [driveId],
        );
        await client.query(
          'UPDATE shares SET revoked_at = COALESCE(revoked_at, now()) WHERE drive_id = $1',
          [driveId],
        );
        await client.query(
          'UPDATE api_keys SET drive_ids = array_remove(drive_ids, $1::uuid) WHERE account_id = $2',
          [driveId, auth.accountId],
        );
        const job = await client.query(
          `INSERT INTO deletion_jobs (kind,target_id,account_id,not_before)
         SELECT 'drive',$1,$2,GREATEST(now()+interval '10 minutes',
           COALESCE((SELECT max(expires_at) FROM upload_intents WHERE drive_id=$1 AND committed_version_id IS NULL), now()+interval '10 minutes'))
         RETURNING *`,
          [driveId, auth.accountId],
        );
        return deletionJobOutput(job.rows[0]);
      }),
      202,
    );
  }
  if (parts.length === 1 && parts[0] === 'account' && request.method === 'DELETE') {
    const body = await jsonBody(request);
    const confirmation = stringField(body, 'confirmation', { required: true, max: 64 });
    if (confirmation !== 'DELETE MY ACCOUNT')
      throw new ApiError('validation_error', 'The account confirmation is incorrect.');
    return response(
      await withTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [auth.userId]);
        const existing = await client.query(
          'SELECT * FROM deletion_jobs WHERE kind = $1 AND target_id = $2',
          ['account', auth.accountId],
        );
        if (existing.rows[0]) return deletionJobOutput(existing.rows[0]);
        await lockBillingAccount(client, auth.accountId);
        const state = await billingState(client, auth.accountId);
        await queueBillingDeliveries(client, state);
        await client.query(
          'UPDATE accounts SET deleting_at = COALESCE(deleting_at, now()) WHERE id = $1',
          [auth.accountId],
        );
        await client.query(
          'UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = $1',
          [auth.accountId],
        );
        await client.query(
          'UPDATE shares SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = $1',
          [auth.accountId],
        );
        await client.query('DELETE FROM billing_notifications WHERE account_id = $1', [
          auth.accountId,
        ]);
        const job = await client.query(
          `INSERT INTO deletion_jobs (kind,target_id,account_id,not_before)
         SELECT 'account',$1,$1,GREATEST(now()+interval '10 minutes',
           COALESCE((SELECT max(expires_at) FROM upload_intents WHERE account_id=$1 AND committed_version_id IS NULL), now()+interval '10 minutes'))
         RETURNING *`,
          [auth.accountId],
        );
        return deletionJobOutput(job.rows[0]);
      }),
      202,
    );
  }
  if (parts.length === 1 && parts[0] === 'billing' && request.method === 'GET') {
    return response({ ...(await billingSummary(auth.accountId)), ...billingFlags() });
  }
  if (
    parts.length === 2 &&
    parts[0] === 'billing' &&
    parts[1] === 'settings' &&
    request.method === 'PATCH'
  ) {
    const body = await jsonBody(request);
    const parseCents = (value: unknown, field: string) => {
      if (value === null) return null;
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 1_000_000_000
      )
        throw new ApiError('validation_error', `${field} must be a nonnegative integer of cents.`);
      return value;
    };
    const spendCapCents = parseCents(body.spendCapCents, 'spendCapCents');
    const alertThresholdCents = parseCents(body.alertThresholdCents, 'alertThresholdCents');
    const alertEmail =
      body.alertEmail === null
        ? null
        : stringField(body, 'alertEmail', { required: true, max: 254 });
    if (alertEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(alertEmail))
      throw new ApiError('validation_error', 'alertEmail must be a valid email address.');
    if (alertThresholdCents !== null && !alertEmail)
      throw new ApiError('validation_error', 'alertEmail is required with alertThresholdCents.');
    await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      await client.query(
        `UPDATE billing_accounts
            SET spend_cap_cents = $2, alert_threshold_cents = $3, alert_email = $4
          WHERE account_id = $1`,
        [auth.accountId, spendCapCents, alertThresholdCents, alertEmail],
      );
    });
    return response({ ...(await billingSummary(auth.accountId)), ...billingFlags() });
  }
  if (
    parts.length === 2 &&
    parts[0] === 'billing' &&
    parts[1] === 'checkout' &&
    request.method === 'POST'
  ) {
    const body = await jsonBody(request);
    const plan = stringField(body, 'plan', { required: true, max: 16 });
    if (plan !== 'developer' && plan !== 'team')
      throw new ApiError('validation_error', 'plan must be developer or team.');
    return response(await createCheckout(auth.accountId, plan));
  }
  if (
    parts.length === 2 &&
    parts[0] === 'billing' &&
    parts[1] === 'portal' &&
    request.method === 'POST'
  ) {
    return response(await createPortal(auth.accountId));
  }
  if (
    parts.length === 2 &&
    parts[0] === 'billing' &&
    parts[1] === 'statements' &&
    request.method === 'GET'
  ) {
    const rows = await getPool().query(
      `SELECT period_start, statement FROM billing_periods
        WHERE account_id = $1 AND statement IS NOT NULL
        ORDER BY period_start DESC`,
      [auth.accountId],
    );
    return response({
      items: rows.rows.map((row) => ({ periodStart: row.period_start, statement: row.statement })),
    });
  }
  if (parts.length === 1 && parts[0] === 'session' && request.method === 'GET') {
    return response({
      account: { id: auth.accountId, name: auth.accountName ?? 'Personal workspace' },
      userId: auth.userId,
    });
  }
  if (parts.length === 1 && parts[0] === 'usage' && request.method === 'GET') {
    const billing = await billingSummary(auth.accountId);
    const observedEgressConfigured = egressMeteringConfigured();
    const driveUsage = await getPool().query(
      `WITH version_usage AS (
         SELECT v.drive_id, COALESCE(SUM(v.ciphertext_size), 0)::bigint AS storage_bytes,
                COUNT(*)::int AS versions
           FROM versions v JOIN drives owned ON owned.id = v.drive_id
          WHERE owned.account_id = $1
          GROUP BY v.drive_id
       ), live_usage AS (
         SELECT f.drive_id, COUNT(*)::int AS live_files
           FROM files f JOIN drives owned ON owned.id = f.drive_id
          WHERE owned.account_id = $1 AND f.deleted_at IS NULL
          GROUP BY f.drive_id
       )
       SELECT d.id, d.name, d.quota_bytes,
              COALESCE(vu.storage_bytes, 0)::bigint AS storage_bytes,
              COALESCE(lu.live_files, 0)::int AS live_files,
              COALESCE((SELECT sum(e.bytes_sent) FROM billing_egress_events e
                WHERE e.drive_id = d.id AND e.occurred_at >= $2 AND e.occurred_at < $3), 0)::text AS egress_bytes,
              COALESCE(vu.versions, 0)::int AS versions
         FROM drives d
         LEFT JOIN version_usage vu ON vu.drive_id = d.id
         LEFT JOIN live_usage lu ON lu.drive_id = d.id
        WHERE d.account_id = $1
        ORDER BY d.name, d.id`,
      [auth.accountId, billing.periodStart, billing.periodEnd],
    );
    const agentUsage = await getPool().query(
      `WITH version_usage AS (
         SELECT v.agent_id, COALESCE(SUM(v.ciphertext_size), 0)::bigint AS storage_bytes,
                COUNT(*)::int AS versions
           FROM versions v JOIN drives owned ON owned.id = v.drive_id
          WHERE owned.account_id = $1
          GROUP BY v.agent_id
       ), operation_usage AS (
         SELECT e.agent_id, COUNT(*)::int AS operations
           FROM audit_events e
          WHERE e.account_id = $1 AND e.agent_id IS NOT NULL
            AND e.created_at >= $2 AND e.created_at < $3 AND e.outcome = 'success'
          GROUP BY e.agent_id
       ), egress_usage AS (
         SELECT agent_id, COALESCE(sum(bytes_sent),0)::text AS egress_bytes
           FROM billing_egress_events
          WHERE account_id = $1 AND occurred_at >= $2 AND occurred_at < $3
          GROUP BY agent_id
       )
       SELECT a.id, a.name,
              COALESCE(vu.storage_bytes, 0)::bigint AS storage_bytes,
              COALESCE(vu.versions, 0)::int AS versions,
              COALESCE(ou.operations, 0)::int AS operations,
              eu.egress_bytes
         FROM agents a
         LEFT JOIN version_usage vu ON vu.agent_id = a.id
         LEFT JOIN operation_usage ou ON ou.agent_id = a.id
         LEFT JOIN egress_usage eu ON eu.agent_id = a.id
        WHERE a.account_id = $1
        ORDER BY a.name, a.id`,
      [auth.accountId, billing.periodStart, billing.periodEnd],
    );
    const drives = (driveUsage.rows as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      quotaBytes: Number(row.quota_bytes),
      storageBytes: Number(row.storage_bytes),
      liveFiles: Number(row.live_files),
      versions: Number(row.versions),
      egressBytes: observedEgressConfigured ? String(row.egress_bytes) : null,
    }));
    const agents = (agentUsage.rows as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      storageBytes: Number(row.storage_bytes),
      versions: Number(row.versions),
      operations: Number(row.operations),
      egressBytes: observedEgressConfigured ? String(row.egress_bytes ?? 0) : null,
    }));
    return response({
      plan: billing.plan,
      limits: {
        storageBytes: billing.limits.storageBytes,
        operations: billing.limits.operations,
        drives: billing.limits.drives,
      },
      drives,
      agents,
      storageBytes: drives.reduce((total, drive) => total + drive.storageBytes, 0),
      operations: Number(billing.operations),
      egressBytes: observedEgressConfigured ? billing.egressBytes : null,
      egressMeteringConfigured: observedEgressConfigured,
      egressNotMetered: process.env.S3_EGRESS_METERING === 'none',
      cost: billing.overageConfigured ? billing.totalCents : null,
    });
  }
  if (
    parts.length === 3 &&
    parts[0] === 'agents' &&
    parts[2] === 'revoke' &&
    request.method === 'POST'
  ) {
    const agentId = uuid(parts[1], 'agent id');
    const result = await withTransaction(async (client) => {
      const agent = await client.query(
        'SELECT id FROM agents WHERE id = $1 AND account_id = $2 FOR UPDATE',
        [agentId, auth.accountId],
      );
      if (!agent.rows[0]) throw new ApiError('not_found', 'Agent not found.');
      const revoked = await client.query(
        `UPDATE api_keys
            SET revoked_at = COALESCE(revoked_at, now())
          WHERE agent_id = $1 AND account_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [agentId, auth.accountId],
      );
      // Approved but unredeemed device logins would otherwise still mint a key afterwards.
      await client.query(
        `UPDATE device_authorizations SET status = 'denied'
          WHERE agent_id = $1 AND account_id = $2 AND status = 'approved'`,
        [agentId, auth.accountId],
      );
      return revoked.rowCount ?? 0;
    });
    return response({ id: agentId, revokedKeys: result });
  }
  if (
    parts.length === 3 &&
    parts[0] === 'drives' &&
    parts[2] === 'trash' &&
    request.method === 'GET'
  ) {
    const driveId = uuid(parts[1], 'drive id');
    await ensureDrive(auth, driveId);
    need(auth, 'read', driveId);
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'path');
    const params: unknown[] = [driveId];
    let where = 'drive_id = $1 AND deleted_at IS NOT NULL';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ` AND (path, id) > ($${params.length - 1}, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT id, path, deleted_at
         FROM files
        WHERE ${where}
        ORDER BY path, id
        LIMIT $${params.length}`,
      params,
    );
    const output = collection(rows.rows as Row[], limit, (row) => row.path);
    return response({
      nextCursor: output.nextCursor,
      items: output.items.map((row) => ({
        id: row.id,
        path: row.path,
        deletedAt: row.deleted_at,
      })),
    });
  }
  return undefined;
}

async function shareEndpoint(
  request: Request,
  auth: Auth,
  driveId: string,
  operation: string,
  url: URL,
) {
  await ensureDrive(auth, driveId);
  need(auth, 'share', driveId);
  if (operation === 'shares' && request.method === 'POST') {
    need(auth, 'read', driveId);
    const body = await jsonBody(request);
    const path = canonicalPath(body.path);
    const versionId =
      body.versionId === undefined
        ? undefined
        : uuid(typeof body.versionId === 'string' ? body.versionId : undefined, 'versionId');
    const expiryInput =
      body.expiresAt === undefined
        ? undefined
        : stringField(body, 'expiresAt', { required: true, max: 64 })!;
    if (
      expiryInput !== undefined &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(expiryInput)
    ) {
      throw new ApiError('validation_error', 'expiresAt must be an ISO timestamp.');
    }
    const requestedExpiry =
      expiryInput === undefined
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : new Date(expiryInput);
    const now = Date.now();
    if (
      Number.isNaN(requestedExpiry.getTime()) ||
      requestedExpiry.getTime() < now + 60 * 1000 ||
      requestedExpiry.getTime() > now + 30 * 24 * 60 * 60 * 1000
    ) {
      throw new ApiError(
        'validation_error',
        'expiresAt must be between 60 seconds and 30 days from now.',
      );
    }
    const id = randomBytes(16).toString('base64url');
    const userId = auth.userId ?? optionalString(body, 'userId', 256) ?? null;
    const { file, result } = await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id=$1 AND account_id=$2 AND deleting_at IS NULL FOR UPDATE',
        [driveId, auth.accountId],
      );
      if (!lockedDrive.rowCount) throw new ApiError('not_found', 'Drive not found.');
      const source = await client.query(
        `SELECT f.id AS file_id, f.path, v.id AS version_id, v.wrapped_key
           FROM files f
           JOIN versions v ON v.id = COALESCE($3::uuid, f.current_version_id)
          WHERE f.drive_id = $1 AND f.path = $2 AND f.deleted_at IS NULL AND v.file_id = f.id`,
        [driveId, path, versionId ?? null],
      );
      const file = source.rows[0] as Row | undefined;
      if (!file) throw new ApiError('not_found', 'File not found.');
      const result = await client.query(
        `INSERT INTO shares
          (id, account_id, drive_id, file_id, version_id, agent_id, api_key_id, user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, expires_at, created_at`,
        [
          id,
          auth.accountId,
          driveId,
          file.file_id,
          file.version_id,
          auth.agentId,
          auth.keyId,
          userId,
          requestedExpiry,
        ],
      );
      return { file, result };
    });
    return response(
      {
        id: result.rows[0].id,
        path: file.path,
        versionId: file.version_id,
        wrappedKey: file.wrapped_key,
        expiresAt: result.rows[0].expires_at,
        createdAt: result.rows[0].created_at,
      },
      201,
    );
  }
  if (operation === 'shares' && request.method === 'GET') {
    const { limit, cursor } = page(url);
    const decoded = decodeCursor(cursor, 'share');
    const params: unknown[] = [driveId];
    let where = 's.drive_id = $1';
    if (decoded) {
      params.push(decoded.value, decoded.id);
      where += ` AND (s.created_at, s.id) > ($${params.length - 1}::timestamptz, $${params.length})`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT s.id, f.path, s.version_id, s.expires_at, s.revoked_at, s.created_at,
              s.created_at::text AS cursor_created_at,
              CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked'
                   WHEN s.expires_at <= now() THEN 'expired'
                   WHEN f.deleted_at IS NOT NULL THEN 'unavailable'
                   ELSE 'active' END AS status
         FROM shares s JOIN files f ON f.id = s.file_id
        WHERE ${where}
        ORDER BY s.created_at, s.id
        LIMIT $${params.length}`,
      params,
    );
    const output = collection(rows.rows as Row[], limit, (row) => row.cursor_created_at);
    return response({
      items: output.items.map((row) => ({
        id: row.id,
        path: row.path,
        versionId: row.version_id,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        status: row.status,
      })),
      nextCursor: output.nextCursor,
    });
  }
  if (operation === 'shares' && request.method === 'DELETE') {
    throw new ApiError('not_found', 'Share not found.');
  }
  throw new ApiError('not_found', 'Endpoint not found.');
}

async function revokeShare(request: Request, auth: Auth, driveId: string, shareId: string) {
  await ensureDrive(auth, driveId);
  need(auth, 'share', driveId);
  const result = await getPool().query(
    `UPDATE shares
        SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1 AND drive_id = $2 AND account_id = $3
      RETURNING id, revoked_at`,
    [shareId, driveId, auth.accountId],
  );
  if (!result.rows[0]) throw new ApiError('not_found', 'Share not found.');
  return response({ id: result.rows[0].id, revokedAt: result.rows[0].revoked_at });
}

async function putIntent(request: Request, auth: Auth, driveId: string) {
  need(auth, 'write', driveId);
  const body = await jsonBody(request);
  const path = canonicalPath(body.path);
  needWritePath(auth, path);
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
  const id = randomUUID();
  const stagingKey = `staging/${auth.accountId}/${driveId}/${id}`;
  const result = await withTransaction(async (client) => {
    await lockBillingAccount(client, auth.accountId);
    const lockedDrive = await client.query(
      'SELECT id, quota_bytes FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
      [driveId, auth.accountId],
    );
    if (!lockedDrive.rows[0]) throw new ApiError('not_found', 'Drive not found.');
    await enforceWriteBudget(client, auth.accountId, {
      bytes: BigInt(ciphertextSize),
      reserveOnly: true,
    });
    const used = await client.query<{ bytes: string }>(
      `SELECT (
         (SELECT COALESCE(sum(ciphertext_size),0) FROM versions WHERE drive_id = $1) +
         (SELECT COALESCE(sum(ciphertext_size),0) FROM upload_intents
           WHERE drive_id = $1 AND committed_version_id IS NULL AND expires_at > now())
       )::text AS bytes`,
      [driveId],
    );
    const usedBytes = BigInt(used.rows[0]!.bytes);
    const quotaBytes = BigInt(lockedDrive.rows[0].quota_bytes);
    if (usedBytes + BigInt(ciphertextSize) > quotaBytes) {
      throw new ApiError('quota_exceeded', 'The drive quota would be exceeded.');
    }
    const machine = await machineId(client, auth, request);
    return client.query(
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
  });
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
      await lockBillingAccount(client, auth.accountId);
      const lockedIntentResult = await client.query(
        `SELECT * FROM upload_intents
          WHERE id = $1 AND drive_id = $2 AND api_key_id = $3
          FOR UPDATE`,
        [intentId, driveId, auth.keyId],
      );
      const lockedIntent = lockedIntentResult.rows[0] as Row | undefined;
      if (!lockedIntent) throw new ApiError('not_found', 'Upload intent not found.');
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
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
      await enforceWriteBudget(client, auth.accountId, {
        bytes: BigInt(lockedIntent.ciphertext_size),
        excludeIntentId: intentId,
      });
      if (new Date(lockedIntent.expires_at).getTime() < Date.now())
        throw new ApiError('conflict', 'The upload intent has expired.');
      const fileResult = await client.query(
        'SELECT id, current_version_id, deleted_at FROM files WHERE drive_id = $1 AND path = $2 FOR UPDATE',
        [driveId, source.path],
      );
      const file = fileResult.rows[0] as Row | undefined;
      const currentVersionId = (file?.current_version_id as string | undefined) ?? null;
      const trashedMessage = 'The file is in the trash. Restore it, or write with overwrite.';
      if (lockedIntent.conditional_mode === 'create' && file) {
        if (file.deleted_at)
          throw new ApiError('conflict', trashedMessage, 409, {
            state: 'trashed',
            currentVersionId,
          });
        throw new ApiError('conflict', 'The file already exists.', 409, {
          state: 'exists',
          currentVersionId,
        });
      }
      if (lockedIntent.conditional_mode === 'version') {
        if (!file)
          throw new ApiError('conflict', 'There is no file at this path.', 409, {
            state: 'absent',
            currentVersionId: null,
          });
        if (file.deleted_at)
          throw new ApiError('conflict', trashedMessage, 409, {
            state: 'trashed',
            currentVersionId,
          });
        if (file.current_version_id !== lockedIntent.base_version_id)
          throw new ApiError(
            'conflict',
            'The file changed since the conditional write was prepared.',
            409,
            { state: 'changed', currentVersionId },
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
    if (url.searchParams.get('metadataOnly') === '1') return response(rowVersion(row));
    const downloadUrl = await authorizeDownload(auth.accountId, BigInt(row.ciphertext_size), () =>
      presignedDownload(row.object_key),
    );
    return response({ ...rowVersion(row), downloadUrl });
  }
  if (operation === 'list' && request.method === 'GET') {
    need(auth, 'read', driveId);
    const { limit, cursor } = page(url);
    const p = prefix(url.searchParams.get('prefix'));
    const sort = listSort(url.searchParams.get('sort'));
    if (listDelimiter(url.searchParams.get('delimiter')))
      return response(await listChildren(url, driveId, p, sort, limit, cursor));
    const decoded =
      sort === 'modified' ? decodeModifiedCursor(cursor) : decodeCursor(cursor, 'path');
    const params: unknown[] = [driveId, `${escapeLikeLiteral(p)}%`];
    let clause = `f.drive_id = $1 AND f.deleted_at IS NULL AND f.path LIKE $2 ESCAPE '\\'`;
    clause += appendFileFilters(url, params, true);
    if (decoded) {
      params.push(decoded.value, decoded.id);
      clause +=
        sort === 'modified'
          ? ` AND (v.created_at, f.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
          : ` AND (f.path, f.id) > ($${params.length - 1}, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT f.id, f.path, v.id AS version_id, v.ciphertext_size, v.agent_id, v.machine_id, v.user_id, v.tags, v.description, v.created_at${sort === 'modified' ? `, ${isoText('v.created_at')} AS cursor_created_at` : ''}
       FROM files f JOIN versions v ON v.id = f.current_version_id WHERE ${clause} ORDER BY ${sort === 'modified' ? 'v.created_at DESC, f.id DESC' : 'f.path, f.id'} LIMIT $${params.length}`,
      params,
    );
    const items = rows.rows.slice(0, limit);
    const last = items.at(-1);
    const lastTime = last?.cursor_created_at;
    for (const item of items) delete item.cursor_created_at;
    return response({
      items,
      nextCursor:
        rows.rows.length > limit
          ? encodeCursor(
              sort === 'modified'
                ? { value: lastTime, id: last.id }
                : { value: last.path, id: last.id },
            )
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
    const { limit, cursor } = page(url);
    // since is ignored (and not validated) when a cursor is sent.
    if (!cursor && Number.isNaN(Date.parse(since)))
      throw new ApiError('validation_error', 'since must be an ISO timestamp.');
    const decoded = decodeCursor(cursor, 'seq');
    // With a cursor, seq is authoritative and since is ignored. Without one, since filters by
    // created_at (transaction start), which is approximate.
    const params: unknown[] = [driveId];
    let where = '';
    if (decoded) {
      params.push(decoded.value);
      where = `e.seq > $2::bigint`;
    } else {
      params.push(since);
      where = `e.created_at > $2`;
    }
    params.push(limit + 1);
    const rows = await getPool().query(
      `SELECT e.id, e.operation, e.path, e.previous_path, e.version_id, e.agent_id,
              e.machine_id, e.user_id, e.created_at, e.seq::text AS seq, g.name AS agent_name
         FROM file_events e LEFT JOIN agents g ON g.id = e.agent_id
        WHERE e.drive_id = $1 AND ${where}
        ORDER BY e.seq LIMIT $${params.length}`,
      params,
    );
    const output = collection(rows.rows as Row[], limit, (row) => row.seq);
    const lastItem = output.items[output.items.length - 1];
    const latestCursor = lastItem
      ? encodeCursor({ value: lastItem.seq, id: lastItem.id })
      : (cursor ?? null);
    return response({
      ...output,
      latestCursor,
      items: output.items.map((row) => ({
        id: row.id,
        operation: row.operation,
        path: row.path,
        previousPath: row.previous_path,
        versionId: row.version_id,
        agentId: row.agent_id,
        agentName: row.agent_name ?? null,
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
    needWritePath(auth, from);
    needWritePath(auth, to);
    const userId = auth.userId ?? optionalString(body, 'userId', 256) ?? null;
    const moved = await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      await enforceWriteBudget(client, auth.accountId);
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
        [driveId, auth.accountId],
      );
      if (!lockedDrive.rowCount) throw new ApiError('not_found', 'Drive not found.');
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
    needWritePath(auth, path);
    const userId = auth.userId ?? optionalString(body, 'userId', 256) ?? null;
    const deleted = await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
        [driveId, auth.accountId],
      );
      if (!lockedDrive.rowCount) throw new ApiError('not_found', 'Drive not found.');
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
  needWritePath(auth, destinationPath);
  const requestedVersion =
    body.versionId === undefined
      ? undefined
      : uuid(typeof body.versionId === 'string' ? body.versionId : undefined, 'versionId');
  const userId = auth.userId ?? optionalString(body, 'userId', 256) ?? null;
  let copiedKey: string | undefined;
  let result: Row;
  let undeleted = false;
  try {
    result = await withTransaction(async (client) => {
      await lockBillingAccount(client, auth.accountId);
      const lockedDrive = await client.query(
        'SELECT id FROM drives WHERE id = $1 AND account_id = $2 AND deleting_at IS NULL FOR UPDATE',
        [driveId, auth.accountId],
      );
      if (!lockedDrive.rowCount) throw new ApiError('not_found', 'Drive not found.');
      const machine = await machineId(client, auth, request);
      const source = await client.query(
        `SELECT f.*, v.* FROM files f JOIN versions v ON v.id = COALESCE($3::uuid, f.current_version_id)
       WHERE f.drive_id = $1 AND f.path = $2 AND v.file_id = f.id ${restore ? '' : 'AND f.deleted_at IS NULL'} FOR UPDATE`,
        [driveId, sourcePath, requestedVersion ?? null],
      );
      const row = source.rows[0] as Row | undefined;
      if (!row) throw new ApiError('not_found', 'Source file or version not found.');
      if (restore && row.id === row.current_version_id) {
        // Restoring the current version is an undelete: no copy, no new version, no quota check.
        if (row.deleted_at) {
          await client.query('UPDATE files SET deleted_at = NULL WHERE id = $1', [row.file_id]);
          await client.query(
            `INSERT INTO file_events
              (drive_id, file_id, operation, path, version_id, agent_id, machine_id, user_id)
             VALUES ($1, $2, 'restore', $3, $4, $5, $6, $7)`,
            [driveId, row.file_id, sourcePath, row.id, auth.agentId, machine, userId],
          );
        }
        const current = await client.query(
          'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.id = $1',
          [row.id],
        );
        undeleted = true;
        return current.rows[0] as Row;
      }
      await enforceWriteBudget(client, auth.accountId, { bytes: BigInt(row.ciphertext_size) });
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
  return response({ version: rowVersion(result) }, undeleted ? 200 : 201);
}

type RequestMode = { kind: 'bearer' } | { kind: 'console'; userId: string | null };

function consoleRouteAllowed(method: string, parts: string[]) {
  if (parts[0] === 'device') {
    if (parts.length === 2) return method === 'GET';
    return (
      parts.length === 3 && method === 'POST' && (parts[2] === 'approve' || parts[2] === 'deny')
    );
  }
  if (method === 'GET' && parts.length === 1 && ['deletions', 'audit'].includes(parts[0]!))
    return true;
  if (method === 'DELETE' && parts.length === 1 && parts[0] === 'account') return true;
  if (method === 'DELETE' && parts.length === 2 && parts[0] === 'drives') return true;
  if (method === 'GET' && parts.length === 1 && parts[0] === 'billing') return true;
  if (method === 'GET' && parts.length === 2 && parts[0] === 'billing' && parts[1] === 'statements')
    return true;
  if (method === 'PATCH' && parts.length === 2 && parts[0] === 'billing' && parts[1] === 'settings')
    return true;
  if (
    method === 'POST' &&
    parts.length === 2 &&
    parts[0] === 'billing' &&
    ['checkout', 'portal'].includes(parts[1]!)
  )
    return true;
  if (
    method === 'GET' &&
    parts.length === 1 &&
    ['session', 'usage', 'whoami', 'drives', 'agents', 'keys'].includes(parts[0]!)
  )
    return true;
  if (method === 'POST' && parts.length === 1 && ['drives', 'agents', 'keys'].includes(parts[0]!))
    return true;
  if (method === 'DELETE' && parts.length === 2 && parts[0] === 'keys') return true;
  if (method === 'POST' && parts.length === 3 && parts[0] === 'agents' && parts[2] === 'revoke')
    return true;
  if (method === 'DELETE' && parts.length === 4 && parts[0] === 'drives' && parts[2] === 'shares')
    return true;
  if (parts.length !== 3 || parts[0] !== 'drives') return false;
  if (method === 'POST' && parts[2] === 'key-backup') return true;
  if ((method === 'GET' || method === 'POST') && parts[2] === 'shares') return true;
  if (
    method === 'GET' &&
    ['get', 'list', 'versions', 'recent', 'search', 'trash'].includes(parts[2]!)
  )
    return true;
  return method === 'POST' && ['delete', 'restore', 'move', 'copy'].includes(parts[2]!);
}

function requireConsoleOrigin(request: Request, url: URL) {
  if (request.method === 'GET') return;
  if (request.headers.get('origin') !== url.origin) {
    throw new ApiError('permission_denied', 'A same-origin request is required.');
  }
}

async function handleRequest(request: Request, mode: RequestMode) {
  const url = new URL(request.url);
  const rawPath = url.pathname;
  const base = mode.kind === 'console' ? '/api/console/' : '/api/v1/';
  const validBase = rawPath.startsWith(base) && !rawPath.includes('//') && !rawPath.endsWith('/');
  const relative = validBase ? rawPath.slice(base.length).split('/') : [];
  const context: RequestContext = {
    action: actionFor(request.method, relative, mode.kind === 'bearer'),
    status: 500,
  };
  let output: Response;
  try {
    if (!secureTransportAllowed(url.protocol, process.env.NODE_ENV)) {
      throw new ApiError('permission_denied', 'HTTPS is required for API requests.');
    }
    if (mode.kind === 'console') {
      if (!mode.userId) throw new ApiError('unauthorized', 'A console session is required.');
      context.auth = await authenticateConsole(mode.userId);
      requireConsoleOrigin(request, url);
    }
    if (!validBase || url.search.length > MAX_QUERY_LENGTH) {
      throw new ApiError(
        url.search.length > MAX_QUERY_LENGTH ? 'validation_error' : 'not_found',
        url.search.length > MAX_QUERY_LENGTH
          ? 'The query string is too long.'
          : 'Endpoint not found.',
      );
    }
    if (mode.kind === 'bearer') context.auth = await authenticate(request);
    else {
      if (!consoleRouteAllowed(request.method, relative))
        throw new ApiError('not_found', 'Endpoint not found.');
    }
    const auth = context.auth;
    if (!auth) throw new ApiError('internal_error', 'The request actor is unavailable.');
    if (mode.kind === 'console') {
      const deleting = await getPool().query('SELECT deleting_at FROM accounts WHERE id = $1', [
        auth.accountId,
      ]);
      if (
        deleting.rows[0]?.deleting_at &&
        !(request.method === 'GET' && ['deletions', 'audit'].includes(relative[0]!)) &&
        !(request.method === 'DELETE' && relative[0] === 'account')
      ) {
        throw new ApiError('conflict', 'The account is being deleted.');
      }
    }
    await enforceKeyRateLimit(auth.keyId);
    if (quotaControlledActions.has(context.action)) await reserveOperation(context);
    const consoleOutput =
      mode.kind === 'console'
        ? ((await consoleDeviceEndpoint(request, auth.accountId, relative)) ??
          (await consoleEndpoint(request, auth, relative, url)))
        : undefined;
    const control = consoleOutput ?? (await controlPlane(request, auth, relative));
    if (control) output = control;
    else if (relative[0] === 'drives' && relative[2] === 'shares' && relative.length === 3) {
      uuid(relative[1], 'drive id');
      output = await shareEndpoint(request, auth, relative[1]!, relative[2]!, url);
    } else if (
      relative[0] === 'drives' &&
      relative[2] === 'shares' &&
      relative.length === 4 &&
      request.method === 'DELETE'
    ) {
      uuid(relative[1], 'drive id');
      if (!/^[A-Za-z0-9_-]{22}$/u.test(relative[3]!))
        throw new ApiError('validation_error', 'share id is invalid.');
      output = await revokeShare(request, auth, relative[1]!, relative[3]!);
    } else if (relative[0] === 'drives' && relative.length === 3) {
      uuid(relative[1], 'drive id');
      output = await fileEndpoint(request, auth, relative[1]!, relative[2]!, url);
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

export function handleApiRequest(request: Request) {
  return handleRequest(request, { kind: 'bearer' });
}

export function handleConsoleApiRequest(request: Request, userId: string | null) {
  return handleRequest(request, { kind: 'console', userId });
}

const shareIdPattern = /^[A-Za-z0-9_-]{22}$/u;

export async function handlePublicShareRequest(shareId: string, metadataOnly = false) {
  const context: RequestContext = { action: 'share.access', status: 500 };
  let output: Response;
  try {
    if (!shareIdPattern.test(shareId))
      throw new ApiError('not_found', 'This share link does not exist.');
    const result = await getPool().query(
      `SELECT s.id, s.account_id, s.expires_at, s.revoked_at,
              f.path, f.deleted_at, v.object_key, v.ciphertext_size, now() AS db_now
         FROM shares s
         JOIN files f ON f.id = s.file_id
         JOIN versions v ON v.id = s.version_id AND v.file_id = f.id
         JOIN drives d ON d.id = s.drive_id AND d.deleting_at IS NULL
         JOIN accounts a ON a.id = s.account_id AND a.deleting_at IS NULL
        WHERE s.id = $1`,
      [shareId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new ApiError('not_found', 'This share link does not exist.');
    context.accountId = row.account_id as string;
    if (row.revoked_at) throw new ApiError('share_revoked', 'This share link has been revoked.');
    if (new Date(row.expires_at).getTime() <= new Date(row.db_now).getTime())
      throw new ApiError('share_expired', 'This share link has expired.');
    if (row.deleted_at)
      throw new ApiError('share_unavailable', 'This file is no longer available.');
    await reserveOperation(context);
    if (metadataOnly) {
      output = response({
        name: String(row.path).slice(String(row.path).lastIndexOf('/') + 1),
        ciphertextSize: Number(row.ciphertext_size),
        expiresAt: row.expires_at,
      });
    } else {
      const remainingSeconds = Math.floor(
        (new Date(row.expires_at).getTime() - new Date(row.db_now).getTime()) / 1000,
      );
      if (remainingSeconds < 1)
        throw new ApiError('share_expired', 'This share link is too close to expiry to download.');
      const downloadUrl = await authorizeDownload(
        String(row.account_id),
        BigInt(row.ciphertext_size),
        () => presignedDownload(String(row.object_key), Math.min(60, remainingSeconds)),
      );
      output = response({
        name: String(row.path).slice(String(row.path).lastIndexOf('/') + 1),
        ciphertextSize: Number(row.ciphertext_size),
        expiresAt: row.expires_at,
        downloadUrl,
      });
    }
    context.status = output.status;
  } catch (error) {
    const mapped = error instanceof ApiError ? error : errorFromDatabase(error);
    output = responseForError(mapped);
    context.status = mapped.status;
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

import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, withTransaction } from '../db/client';
import { billingOrigin } from '../billing/policy';
import { enforceWriteBudget, lockBillingAccount } from '../billing/ledger';
import { ApiError } from './errors';
import { jsonBody, MAX_BODY_BYTES, objectBody, stringField, uuid, writePaths } from './validation';

// RFC 8628 device authorization for agent login. Contract: docs/agent-login.md section 2.

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/u;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/u;
const BASE64URL = /^[A-Za-z0-9_-]{1,4096}$/u;
const EXPIRES_IN_SECONDS = 600;
const STARTS_PER_HOUR = 20;
const USER_SCOPES = new Set(['read', 'write', 'delete', 'share']);
const DEFAULT_SCOPES = ['read', 'write', 'delete', 'share'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_KNOWN_DRIVES = 20;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const noStore = { 'Cache-Control': 'no-store' };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

class OAuthError extends Error {
  constructor(
    readonly oauthCode: string,
    readonly description?: string,
    readonly status = 400,
  ) {
    super(oauthCode);
  }
}

// The CLI's current key, if valid and unrevoked (same lookup as handler.ts authenticate). An
// invalid key is ignored; the token is never logged or stored.
async function previousKeyId(request: Request) {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ') || value.length <= 7) return null;
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT k.id FROM api_keys k
       JOIN accounts a ON a.id = k.account_id AND a.deleting_at IS NULL
      WHERE k.token_hash = $1 AND k.revoked_at IS NULL`,
    [sha256(value.slice(7))],
  );
  return rows[0]?.id ?? null;
}

export function generateUserCode() {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!;
  return `${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
}

type StartInput = {
  clientName: string;
  machine: string | null;
  publicKey: string;
  knownDriveIds?: string[];
  previousApiKeyId?: string | null;
};

export async function startDeviceAuthorization(
  input: StartInput,
  context: { ip: string; origin: string },
  newUserCode: () => string = generateUserCode,
) {
  const ipHash = sha256(context.ip);
  const deviceCode = randomBytes(32).toString('base64url');
  const userCode = await withTransaction(async (client) => {
    // Serialize starts per IP (rate limit) and globally (user code uniqueness among live rows).
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `device-start:${ipHash}`,
    ]);
    const recent = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM device_authorizations
        WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`,
      [ipHash],
    );
    if (recent.rows[0]!.n >= STARTS_PER_HOUR) throw new OAuthError('slow_down', undefined, 429);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'device-user-code',
    ]);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = newUserCode();
      const taken = await client.query(
        'SELECT 1 FROM device_authorizations WHERE user_code = $1 AND expires_at > now()',
        [candidate],
      );
      if (taken.rowCount) continue;
      await client.query(
        `INSERT INTO device_authorizations
           (device_code_hash, user_code, client_name, machine, public_key, ip_hash, expires_at,
            requested_drive_ids, previous_api_key_id)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7), $8::uuid[], $9)`,
        [
          sha256(deviceCode),
          candidate,
          input.clientName,
          input.machine,
          input.publicKey,
          ipHash,
          EXPIRES_IN_SECONDS,
          input.knownDriveIds ?? [],
          input.previousApiKeyId ?? null,
        ],
      );
      return candidate;
    }
    throw new ApiError('internal_error', 'A user code could not be allocated.');
  });
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${context.origin}/connect`,
    verification_uri_complete: `${context.origin}/connect?code=${userCode}`,
    expires_in: EXPIRES_IN_SECONDS,
    interval: 5,
  };
}

type Issued = {
  body: Record<string, unknown>;
  accountId: string;
  agentId: string;
};

async function exchangeDeviceCode(deviceCode: string, origin: string): Promise<Issued> {
  const outcome = await withTransaction(async (client): Promise<Issued | OAuthError> => {
    // Lock order is account, agent, then request row. agents.revoke and approval take the agent
    // lock before touching requests, so a revoke either lands first (the request is denied) or
    // waits until this key exists and revokes it.
    const owner = await client.query(
      'SELECT account_id, agent_id FROM device_authorizations WHERE device_code_hash = $1',
      [sha256(deviceCode)],
    );
    if (owner.rows[0]?.account_id) {
      try {
        await lockBillingAccount(client, owner.rows[0].account_id);
      } catch (error) {
        if (error instanceof ApiError) return new OAuthError('invalid_grant');
        throw error;
      }
      await client.query('SELECT 1 FROM agents WHERE id = $1 FOR UPDATE', [owner.rows[0].agent_id]);
    }
    const found = await client.query(
      `SELECT *, expires_at <= now() AS is_expired,
              (last_polled_at IS NOT NULL
                 AND last_polled_at + make_interval(secs => interval_seconds) > now()) AS too_fast
         FROM device_authorizations WHERE device_code_hash = $1 FOR UPDATE`,
      [sha256(deviceCode)],
    );
    const row = found.rows[0];
    if (!row || row.status === 'consumed') return new OAuthError('invalid_grant');
    if (row.is_expired) return new OAuthError('expired_token');
    if (row.too_fast) {
      await client.query(
        `UPDATE device_authorizations
            SET interval_seconds = interval_seconds + 5, last_polled_at = now() WHERE id = $1`,
        [row.id],
      );
      return new OAuthError('slow_down');
    }
    await client.query('UPDATE device_authorizations SET last_polled_at = now() WHERE id = $1', [
      row.id,
    ]);
    if (row.status === 'pending') return new OAuthError('authorization_pending');
    if (row.status === 'denied') return new OAuthError('access_denied');

    const agent = await client.query(
      `SELECT g.name FROM agents g JOIN accounts a ON a.id = g.account_id AND a.deleting_at IS NULL
        WHERE g.id = $1 AND g.account_id = $2`,
      [row.agent_id, row.account_id],
    );
    if (!agent.rows[0]) return new OAuthError('invalid_grant');
    const drives = await client.query(
      `SELECT id FROM drives WHERE account_id = $1 AND deleting_at IS NULL AND id = ANY($2::uuid[])`,
      [row.account_id, row.drive_ids],
    );
    const driveIds = drives.rows.map((drive) => drive.id as string);
    const label = row.machine ? `${row.client_name} on ${row.machine}` : row.client_name;
    // A reconnect replaces exactly the key the CLI proved it held, if it is this agent's. Lock
    // order: account, agent, request, then this key (handler.ts key revoke locks only the key row).
    // Re-check it here: it may have been revoked, or used by another approved request, since approval.
    if (row.previous_api_key_id) {
      const previous = await client.query(
        `SELECT 1 FROM api_keys
          WHERE id = $1 AND account_id = $2 AND agent_id = $3 AND revoked_at IS NULL FOR UPDATE`,
        [row.previous_api_key_id, row.account_id, row.agent_id],
      );
      if (!previous.rowCount && !row.new_drive_id) {
        await client.query("UPDATE device_authorizations SET status = 'denied' WHERE id = $1", [
          row.id,
        ]);
        return new OAuthError(
          'access_denied',
          'The previous key was revoked; run agent-drive login again.',
        );
      }
      if (previous.rowCount) {
        const revoked = await client.query(
          'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
          [row.previous_api_key_id],
        );
        if (revoked.rowCount !== 1) throw new Error('Previous key revocation did not apply.');
      }
    }
    const token = `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const key = await client.query(
      `INSERT INTO api_keys (account_id, agent_id, label, token_hash, drive_ids, scopes, write_paths)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6::text[], $7::text[]) RETURNING id`,
      [row.account_id, row.agent_id, label, sha256(token), driveIds, row.scopes, row.write_paths],
    );
    await client.query(
      `UPDATE device_authorizations
          SET status = 'consumed', consumed_at = now(), api_key_id = $2 WHERE id = $1`,
      [row.id, key.rows[0].id],
    );
    // Same transaction as the key: if this insert fails, nothing commits and the client retries.
    await client.query(
      `INSERT INTO audit_events (account_id, agent_id, action, outcome, http_status)
       VALUES ($1, $2, 'device.token', 'success', 200)`,
      [row.account_id, row.agent_id],
    );
    return {
      accountId: row.account_id,
      agentId: row.agent_id,
      body: {
        access_token: token,
        token_type: 'Bearer',
        scope: (row.scopes as string[]).join(' '),
        write_paths: row.write_paths,
        api_url: `${origin}/api`,
        account_id: row.account_id,
        agent_id: row.agent_id,
        agent_name: agent.rows[0].name,
        drive_ids: driveIds,
        new_drive_id: driveIds.includes(row.new_drive_id) ? row.new_drive_id : null,
        sealed_drive_keys: row.sealed_drive_keys ?? {},
      },
    };
  });
  if (outcome instanceof OAuthError) throw outcome;
  return outcome;
}

async function publicBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/x-www-form-urlencoded')) {
    try {
      return await jsonBody(request);
    } catch (error) {
      throw new OAuthError('invalid_request', error instanceof Error ? error.message : undefined);
    }
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    throw new OAuthError('invalid_request', 'The body is too large.');
  const params = new URLSearchParams(text);
  const body: Record<string, unknown> = Object.fromEntries(params);
  if (params.has('known_drive_ids')) body.known_drive_ids = params.getAll('known_drive_ids');
  return body;
}

// Array, or comma-separated string (form fields). At most 20 distinct UUIDs.
function knownDriveIds(value: unknown): string[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  const ids = items.flatMap((item) => {
    if (typeof item !== 'string')
      throw new OAuthError('invalid_request', 'known_drive_ids is invalid.');
    return item
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  });
  if (ids.some((id) => !UUID_PATTERN.test(id)))
    throw new OAuthError('invalid_request', 'known_drive_ids must be UUIDs.');
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (unique.length > MAX_KNOWN_DRIVES)
    throw new OAuthError('invalid_request', 'known_drive_ids may hold at most 20 ids.');
  return unique;
}

function field(body: Record<string, unknown>, name: string, max: number, required: boolean) {
  try {
    return stringField(body, name, { required, max });
  } catch {
    throw new OAuthError('invalid_request', `${name} is missing, too long, or invalid.`);
  }
}

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function recordAudit(action: string, status: number, errorCode: string | null) {
  await getPool().query(
    `INSERT INTO audit_events (account_id, agent_id, action, outcome, error_code, http_status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [null, null, action, status >= 400 ? 'failure' : 'success', errorCode, status],
  );
}

// Public endpoints under /api/oauth/. Not subject to API-key auth; every call is audited.
export async function handleOAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const endpoint = url.pathname.startsWith('/api/oauth/')
    ? url.pathname.slice('/api/oauth/'.length)
    : '';
  const action =
    endpoint === 'device_authorization'
      ? 'device.authorize'
      : endpoint === 'token'
        ? 'device.token'
        : 'unknown';
  let output: Response;
  let errorCode: string | null = null;
  let audited = false;
  try {
    if (action === 'unknown' || request.method !== 'POST')
      throw new OAuthError('invalid_request', 'Endpoint not found.', 404);
    const origin = billingOrigin();
    const body = await publicBody(request);
    if (action === 'device.authorize') {
      const publicKey = field(body, 'public_key', 128, true)!;
      if (!PUBLIC_KEY_PATTERN.test(publicKey))
        throw new OAuthError('invalid_request', 'public_key must be a base64url P-256 point.');
      output = reply(
        await startDeviceAuthorization(
          {
            clientName: field(body, 'client_name', 64, true)!,
            machine: field(body, 'machine', 128, false) ?? null,
            publicKey,
            knownDriveIds: knownDriveIds(body.known_drive_ids),
            previousApiKeyId: await previousKeyId(request),
          },
          { ip: clientIp(request), origin },
        ),
      );
    } else {
      if (body.grant_type !== DEVICE_GRANT) throw new OAuthError('unsupported_grant_type');
      const deviceCode = field(body, 'device_code', 256, true)!;
      const issued = await exchangeDeviceCode(deviceCode, origin);
      audited = true;
      output = reply(issued.body);
    }
  } catch (error) {
    const oauth =
      error instanceof OAuthError ? error : new OAuthError('server_error', undefined, 500);
    errorCode = oauth.oauthCode;
    output = reply(
      oauth.description
        ? { error: oauth.oauthCode, error_description: oauth.description }
        : { error: oauth.oauthCode },
      oauth.status,
    );
  }
  try {
    if (!audited) await recordAudit(action, output.status, errorCode);
  } catch {
    return reply({ error: 'server_error' }, 500);
  }
  return output;
}

// Console endpoints (/api/console/device/...). The caller has already authenticated the Clerk user.

function userCodeFrom(value: string | undefined) {
  const code = value?.toUpperCase() ?? '';
  if (!USER_CODE_PATTERN.test(code)) throw new ApiError('not_found', 'Device request not found.');
  return code;
}

const pendingRequest = `user_code = $1 AND status = 'pending' AND expires_at > now()`;

function approvalInput(body: Record<string, unknown>) {
  const isEmpty = Object.keys(body).length === 0;
  const driveIds = body.driveIds === undefined ? [] : body.driveIds;
  if (!Array.isArray(driveIds) || driveIds.length > 100)
    throw new ApiError('validation_error', 'driveIds must be an array of UUIDs.');
  const drives = [
    ...new Set(
      driveIds.map((value) => uuid(typeof value === 'string' ? value : undefined, 'driveId')),
    ),
  ];
  const newDriveName =
    body.newDriveName === undefined ? undefined : stringField(body, 'newDriveName', { max: 128 });
  if (
    (body.scopes !== undefined || !isEmpty) &&
    (!Array.isArray(body.scopes) ||
      body.scopes.length === 0 ||
      body.scopes.some((value) => typeof value !== 'string' || !USER_SCOPES.has(value)))
  )
    throw new ApiError(
      'validation_error',
      'scopes must be a non-empty list of read, write, delete, or share.',
    );
  const scopes = isEmpty ? DEFAULT_SCOPES : [...new Set(body.scopes as string[])];
  const paths = writePaths(body);
  const agentId =
    body.agentId === undefined
      ? undefined
      : uuid(typeof body.agentId === 'string' ? body.agentId : undefined, 'agentId');
  let sealed: Record<string, unknown> = {};
  if (body.sealedDriveKeys !== undefined) {
    sealed = objectBody(body.sealedDriveKeys);
    for (const [id, value] of Object.entries(sealed)) {
      if (!drives.includes(id))
        throw new ApiError('validation_error', 'sealedDriveKeys must only name driveIds.');
      const sealedKey = objectBody(value);
      for (const part of ['epk', 'iv', 'ct']) {
        const text = sealedKey[part];
        if (typeof text !== 'string' || !BASE64URL.test(text))
          throw new ApiError('validation_error', `sealedDriveKeys.${id}.${part} is invalid.`);
      }
    }
  }
  return { drives, newDriveName, scopes, writePaths: paths, agentId, sealed, isEmpty };
}

type Queryable = Pick<PoolClient, 'query'>;

// Reconnect drives (contract v2.1): requested ids that the previous key holds and that are live
// drives of the approving account. The previous key must be unrevoked, belong to this account,
// and belong to the agent named client_name. Otherwise there are none.
async function reconnectDrives(
  db: Queryable,
  accountId: string,
  row: { client_name: string; previous_api_key_id: string | null; requested_drive_ids: string[] },
) {
  if (!row.previous_api_key_id) return [];
  const { rows } = await db.query<{
    id: string;
    name: string;
    scopes: string[];
    write_paths: string[];
  }>(
    `SELECT d.id, d.name, k.scopes, k.write_paths FROM drives d
       JOIN api_keys k ON k.id = $2 AND k.account_id = $1 AND k.revoked_at IS NULL
                      AND d.id = ANY(k.drive_ids)
       JOIN agents g ON g.id = k.agent_id AND g.account_id = $1 AND g.name = $3
      WHERE d.account_id = $1 AND d.deleting_at IS NULL AND d.id = ANY($4::uuid[])
      ORDER BY d.name, d.id`,
    [accountId, row.previous_api_key_id, row.client_name, row.requested_drive_ids],
  );
  return rows;
}

// The previous key's permissions, when it is valid proof (unrevoked, same account, and the agent
// named client_name). An empty-body approve grants exactly these, whether or not any drive is
// reconnected; only an explicit body can widen them.
async function previousPermissions(
  db: Queryable,
  accountId: string,
  row: { client_name: string; previous_api_key_id: string | null },
) {
  if (!row.previous_api_key_id) return null;
  const { rows } = await db.query<{ scopes: string[]; write_paths: string[] }>(
    `SELECT k.scopes, k.write_paths FROM api_keys k
       JOIN agents g ON g.id = k.agent_id AND g.account_id = $1 AND g.name = $3
      WHERE k.id = $2 AND k.account_id = $1 AND k.revoked_at IS NULL`,
    [accountId, row.previous_api_key_id, row.client_name],
  );
  return rows[0] ?? null;
}

// client_name, then "client_name (machine)", then "client_name 2", "client_name 3", ...
async function freeDriveName(
  client: PoolClient,
  accountId: string,
  row: { client_name: string; machine: string | null },
) {
  const base = row.client_name;
  const candidates = [base, ...(row.machine ? [`${base} (${row.machine})`.slice(0, 128)] : [])];
  const { rows } = await client.query<{ name: string }>(
    'SELECT name FROM drives WHERE account_id = $1 AND name LIKE $2',
    [accountId, `${base.replace(/[\\%_]/gu, '\\$&')}%`],
  );
  const taken = new Set(rows.map((drive) => drive.name));
  for (const name of candidates) if (!taken.has(name)) return name;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

async function approve(
  client: PoolClient,
  accountId: string,
  code: string,
  input: ReturnType<typeof approvalInput>,
) {
  await lockBillingAccount(client, accountId);
  const found = await client.query(
    `SELECT id, client_name, machine, requested_drive_ids, previous_api_key_id FROM device_authorizations
      WHERE ${pendingRequest}
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [code],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found', 'Device request not found.');

  if (input.drives.length) {
    const owned = await client.query(
      `SELECT count(*)::int AS n FROM drives
        WHERE account_id = $1 AND deleting_at IS NULL AND id = ANY($2::uuid[])`,
      [accountId, input.drives],
    );
    if (owned.rows[0].n !== input.drives.length)
      throw new ApiError('not_found', 'One or more drives were not found.');
  }
  let agentId = input.agentId;
  if (agentId) {
    const agent = await client.query(
      'SELECT id FROM agents WHERE id = $1 AND account_id = $2 FOR UPDATE',
      [agentId, accountId],
    );
    if (!agent.rows[0]) throw new ApiError('not_found', 'Agent not found.');
  } else {
    agentId = (
      await client.query(
        `INSERT INTO agents (account_id, name) VALUES ($1, $2)
         ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [accountId, row.client_name],
      )
    ).rows[0].id as string;
  }
  let drives = input.drives;
  let newDriveName = input.newDriveName;
  let scopes = input.scopes;
  let paths = input.writePaths;
  if (input.isEmpty) {
    // Defaults (contract v2.1): reconnect with proof, else create one named for the agent.
    // A reconnect keeps the previous key's scopes and write paths; widening needs an explicit body.
    const known = await reconnectDrives(client, accountId, row);
    drives = known.map((drive) => drive.id);
    const previous = await previousPermissions(client, accountId, row);
    if (previous) ({ scopes, write_paths: paths } = previous);
    if (!drives.length) newDriveName = await freeDriveName(client, accountId, row);
  }
  let newDriveId: string | null = null;
  if (newDriveName) {
    const exists = await client.query('SELECT 1 FROM drives WHERE account_id = $1 AND name = $2', [
      accountId,
      newDriveName,
    ]);
    if (exists.rowCount) throw new ApiError('conflict', 'A drive with this name already exists.');
    await enforceWriteBudget(client, accountId, { drives: 1n });
    newDriveId = (
      await client.query('INSERT INTO drives (account_id, name) VALUES ($1, $2) RETURNING id', [
        accountId,
        newDriveName,
      ])
    ).rows[0].id as string;
  }
  await client.query(
    `UPDATE device_authorizations
        SET status = 'approved', account_id = $2, agent_id = $3, drive_ids = $4::uuid[],
            scopes = $5::text[], new_drive_id = $6, sealed_drive_keys = $7::jsonb,
            write_paths = $8::text[], decided_at = now()
      WHERE id = $1`,
    [
      row.id,
      accountId,
      agentId,
      newDriveId ? [...drives, newDriveId] : drives,
      scopes,
      newDriveId,
      Object.keys(input.sealed).length ? JSON.stringify(input.sealed) : null,
      paths,
    ],
  );
}

const CONSOLE_WINDOW = '10 minutes';
const CONSOLE_MAX_ATTEMPTS = 30;
const CONSOLE_MAX_FAILURES = 10;

// Bounds user-code guessing: 30 calls and 10 not-found results per account per 10 minutes.
// Once either is spent, every device call (even for a real code) returns 429 until the window ends.
async function takeConsoleAttempt(accountId: string) {
  const { rows } = await getPool().query<{ attempts: number; failures: number }>(
    `INSERT INTO device_console_limits (account_id, window_start, attempts, failures)
     VALUES ($1, now(), 1, 0)
     ON CONFLICT (account_id) DO UPDATE SET
       attempts = CASE WHEN device_console_limits.window_start <= now() - interval '${CONSOLE_WINDOW}'
                       THEN 1 ELSE device_console_limits.attempts + 1 END,
       failures = CASE WHEN device_console_limits.window_start <= now() - interval '${CONSOLE_WINDOW}'
                       THEN 0 ELSE device_console_limits.failures END,
       window_start = CASE WHEN device_console_limits.window_start <= now() - interval '${CONSOLE_WINDOW}'
                           THEN now() ELSE device_console_limits.window_start END
     RETURNING attempts, failures`,
    [accountId],
  );
  const { attempts, failures } = rows[0]!;
  if (attempts > CONSOLE_MAX_ATTEMPTS || failures >= CONSOLE_MAX_FAILURES)
    throw new ApiError(
      'rate_limited',
      'Too many device code attempts. Wait 10 minutes and try again.',
    );
}

export async function consoleDeviceEndpoint(
  request: Request,
  accountId: string,
  parts: string[],
): Promise<Response | undefined> {
  if (parts[0] !== 'device' || parts.length < 2 || parts.length > 3) return undefined;
  await takeConsoleAttempt(accountId);
  try {
    return await consoleDeviceAction(request, accountId, parts);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found')
      await getPool().query(
        'UPDATE device_console_limits SET failures = failures + 1 WHERE account_id = $1',
        [accountId],
      );
    throw error;
  }
}

async function consoleDeviceAction(
  request: Request,
  accountId: string,
  parts: string[],
): Promise<Response | undefined> {
  const code = userCodeFrom(parts[1]);
  if (parts.length === 2 && request.method === 'GET') {
    const found = await getPool().query(
      `SELECT user_code, client_name, machine, created_at, expires_at, public_key,
              requested_drive_ids, previous_api_key_id
         FROM device_authorizations WHERE ${pendingRequest} ORDER BY created_at DESC LIMIT 1`,
      [code],
    );
    const row = found.rows[0];
    if (!row) throw new ApiError('not_found', 'Device request not found.');
    const known = { rows: await reconnectDrives(getPool(), accountId, row) };
    const previous = await previousPermissions(getPool(), accountId, row);
    return reply({
      drives: known.rows.map(({ id, name }) => ({ id, name })),
      creates_drive: known.rows.length === 0,
      scopes: previous?.scopes ?? null,
      write_paths: previous?.write_paths ?? null,
      user_code: row.user_code,
      client_name: row.client_name,
      machine: row.machine,
      created_at: row.created_at,
      expires_at: row.expires_at,
      public_key: row.public_key,
    });
  }
  if (parts.length === 3 && parts[2] === 'approve' && request.method === 'POST') {
    const input = approvalInput(await jsonBody(request));
    await withTransaction((client) => approve(client, accountId, code, input));
    return reply({ status: 'approved' });
  }
  if (parts.length === 3 && parts[2] === 'deny' && request.method === 'POST') {
    const denied = await getPool().query(
      `UPDATE device_authorizations SET status = 'denied', account_id = $2, decided_at = now()
        WHERE ${pendingRequest}`,
      [code, accountId],
    );
    if (!denied.rowCount) throw new ApiError('not_found', 'Device request not found.');
    return reply({ status: 'denied' });
  }
  return undefined;
}

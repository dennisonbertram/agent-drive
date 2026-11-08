import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { encodeBase64Url } from '../../../../packages/agent-drive/src/crypto.js';
import { encryptedSize, seal } from '../../../../packages/agent-drive/src/crypto-format.js';
import { sealFileKeyToInbox } from '../../../../packages/agent-drive/src/trace-inbox.js';
import { tracePath, traceTags } from '../../../../packages/agent-drive/src/trace-path.js';
import { enforceOperationBudget, enforceWriteBudget, lockBillingAccount } from '../billing/ledger';
import { getPool, withTransaction } from '../db/client';
import { ApiError } from './errors';
import { deleteObject, putObject } from './storage';
import { secureTransportAllowed } from './validation';
import { checkDriveQuota, commitPut, putConflict } from './versions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const AGENT = 'openrouter';

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

type Attr = { key?: unknown; value?: { stringValue?: unknown } };
type Span = { startTimeUnixNano?: unknown; attributes?: Attr[] };

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function spansOf(body: unknown): Span[] {
  const out: Span[] = [];
  for (const rs of list(obj(body).resourceSpans))
    for (const ss of list(obj(rs).scopeSpans))
      for (const span of list(obj(ss).spans)) if (span && typeof span === 'object') out.push(span);
  return out;
}

function modelOf(span: Span | undefined) {
  const attrs = list(span?.attributes) as Attr[];
  const value = attrs.find((a) => a?.key === 'gen_ai.request.model')?.value?.stringValue;
  return typeof value === 'string' && value ? value : 'unknown';
}

function earliestStart(spans: Span[]) {
  let best: bigint | null = null;
  for (const span of spans) {
    const raw = span.startTimeUnixNano;
    if (typeof raw !== 'string' || !/^[0-9]+$/u.test(raw)) continue;
    const n = BigInt(raw);
    if (n > 0n && (best === null || n < best)) best = n;
  }
  if (best === null) return null;
  const date = new Date(Number(best / 1_000_000n));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function auditWebhook(client: PoolClient, accountId: string, agentId: string) {
  await client.query(
    `INSERT INTO audit_events
      (api_key_id, account_id, agent_id, user_id, action, outcome, error_code, http_status)
     VALUES (NULL, $1, $2, NULL, 'webhook.trace.ingest', 'success', NULL, 201)`,
    [accountId, agentId],
  );
}

async function authenticate(driveId: string, headers: Headers) {
  const header = headers.get('authorization');
  if (!header?.startsWith('Bearer ') || header.length <= 7)
    throw new ApiError('unauthorized', 'A bearer token is required.');
  const hash = createHash('sha256').update(header.slice(7)).digest('hex');
  const result = await getPool().query(
    `SELECT t.token_hash, t.agent_id, t.account_id
       FROM drive_webhook_tokens t
       JOIN drives d ON d.id = t.drive_id
       JOIN accounts a ON a.id = d.account_id
      WHERE t.drive_id = $1 AND t.token_hash = $2 AND t.revoked_at IS NULL
        AND d.deleting_at IS NULL AND a.deleting_at IS NULL`,
    [driveId, hash],
  );
  const row = result.rows[0] as
    | { token_hash: string; agent_id: string; account_id: string }
    | undefined;
  const stored = row ? Buffer.from(row.token_hash, 'hex') : null;
  const given = Buffer.from(hash, 'hex');
  if (!row || !stored || stored.length !== given.length || !timingSafeEqual(stored, given))
    throw new ApiError('unauthorized', 'The webhook token is not valid.');
  return row;
}

/** Stores one OpenRouter OTLP trace, encrypted to the drive's trace-inbox key. */
export async function ingestOpenRouterTrace(input: {
  url: URL;
  headers: Headers;
  bytes: Uint8Array;
  driveId: string;
}): Promise<Response> {
  const { driveId, bytes } = input;
  if (!secureTransportAllowed(input.url.protocol, process.env.NODE_ENV))
    throw new ApiError('permission_denied', 'HTTPS is required.');
  if (!UUID.test(driveId)) throw new ApiError('validation_error', 'The drive id is not valid.');
  const token = await authenticate(driveId, input.headers);
  if (input.headers.has('x-test-connection')) return json({ ok: true });

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ ok: true, stored: 0 });
  }
  const spans = spansOf(parsed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !spans.length)
    return json({ ok: true, stored: 0 });

  const model = modelOf(spans[0]);
  const path = tracePath({
    agent: AGENT,
    model,
    at: earliestStart(spans),
    suffix: createHash('sha256').update(bytes).digest('hex').slice(0, 32),
  });
  const tags = traceTags(AGENT, model);
  const jsonBytes = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      agent: AGENT,
      provider: 'openrouter',
      receivedAt: new Date().toISOString(),
      otlp: parsed,
    }),
  );
  const ciphertextSize = encryptedSize(jsonBytes.length);

  let objectKey: string | null = null;
  try {
    return await withTransaction(async (client) => {
      await lockBillingAccount(client, token.account_id);
      await client.query('SELECT id FROM drives WHERE id = $1 FOR UPDATE', [driveId]);
      try {
        await putConflict(client, driveId, path, 'create');
      } catch (error) {
        if (error instanceof ApiError && error.details.state === 'exists')
          return json({ ok: true, stored: 0, duplicate: true });
        throw error;
      }
      const inbox = await client.query(
        'SELECT key_id, public_key FROM drive_trace_inboxes WHERE drive_id = $1',
        [driveId],
      );
      if (!inbox.rowCount) throw new ApiError('conflict', 'The drive has no trace inbox.');
      await enforceOperationBudget(client, token.account_id);
      await enforceWriteBudget(client, token.account_id, { bytes: BigInt(ciphertextSize) });
      await checkDriveQuota(client, driveId, ciphertextSize);

      const fileKey = randomBytes(32);
      let ciphertext: Uint8Array;
      let wrappedKey: string;
      try {
        ciphertext = await seal(jsonBytes, fileKey, randomBytes(8));
        wrappedKey = await sealFileKeyToInbox(encodeBase64Url(fileKey), {
          driveId,
          keyId: inbox.rows[0].key_id,
          publicKey: inbox.rows[0].public_key,
        });
      } finally {
        fileKey.fill(0);
      }
      if (ciphertext.length !== ciphertextSize) throw new Error('Unexpected ciphertext size.');

      const versionId = randomUUID();
      objectKey = `objects/${token.account_id}/${driveId}/${versionId}`;
      await putObject(objectKey, ciphertext);
      await commitPut(client, {
        accountId: token.account_id,
        driveId,
        path,
        objectKey,
        ciphertextSize,
        wrappedKey,
        agentId: token.agent_id,
        machineId: null,
        userId: null,
        tags,
        description: null,
        mode: 'create',
        versionId,
      });
      await auditWebhook(client, token.account_id, token.agent_id);
      return json({ ok: true, stored: 1, path }, 201);
    });
  } catch (error) {
    if (objectKey) await deleteObject(objectKey).catch(() => undefined);
    if (error instanceof ApiError && error.details.state === 'exists')
      return json({ ok: true, stored: 0, duplicate: true });
    console.error(
      'trace webhook failed',
      error instanceof ApiError ? error.code : 'internal_error',
    );
    throw error;
  }
}

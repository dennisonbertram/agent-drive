import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/webhooks/openrouter/[driveId]/route';
import * as versions from './versions';
import * as db from '../db/client';

vi.mock('./storage', async (original) => {
  const actual = await original<typeof import('./storage')>();
  return { ...actual, putObject: vi.fn(actual.putObject) };
});
vi.mock('../db/client', async (original) => {
  const actual = await original<typeof import('../db/client')>();
  return { ...actual, withTransaction: vi.fn(actual.withTransaction) };
});
vi.mock('./versions', async (original) => {
  const actual = await original<typeof import('./versions')>();
  return { ...actual, commitPut: vi.fn(actual.commitPut) };
});
import { decryptFile, generateDriveKey } from '../../../../packages/agent-drive/src/crypto.js';
import { encryptedSize } from '../../../../packages/agent-drive/src/crypto-format.js';
import { createTraceInbox } from '../../../../packages/agent-drive/src/trace-inbox.js';
import { responseForError } from './errors';
import { authorizeOpenRouterWebhook, ingestOpenRouterTrace } from './trace-webhook';
import { putObject, storageBucket, storageClient } from './storage';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const accountIds: string[] = [];
const PROMPT = 'PROMPT-SENTINEL-7f3a';
const REPLY = 'REPLY-SENTINEL-9c1e';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(options: { inbox?: boolean; quotaBytes?: number } = {}) {
  const account = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `webhook-${randomUUID()}`,
  ]);
  const accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  const agent = await pool.query(
    "INSERT INTO agents (account_id, name) VALUES ($1, 'openrouter') RETURNING id",
    [accountId],
  );
  const make = async () =>
    (
      await pool.query(
        'INSERT INTO drives (account_id, name, quota_bytes) VALUES ($1, $2, $3) RETURNING id',
        [accountId, `drive-${randomUUID()}`, options.quotaBytes ?? 1_000_000],
      )
    ).rows[0].id as string;
  const driveId = await make();
  const otherDriveId = await make();
  const driveKey = generateDriveKey();
  const record = await createTraceInbox(driveId, driveKey);
  if (options.inbox !== false)
    await pool.query(
      `INSERT INTO drive_trace_inboxes (drive_id, account_id, key_id, public_key, wrapped_private_key)
       VALUES ($1,$2,$3,$4,$5)`,
      [driveId, accountId, record.keyId, record.publicKey, record.wrappedPrivateKey],
    );
  const addToken = async (forDrive: string, revoked = false) => {
    const token = `adw_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await pool.query(
      `INSERT INTO drive_webhook_tokens (drive_id, account_id, agent_id, token_hash, revoked_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [forDrive, accountId, agent.rows[0].id, sha(token), revoked ? new Date() : null],
    );
    return token;
  };
  const token = await addToken(driveId);
  const revoked = await addToken(driveId, true);
  const otherToken = await addToken(otherDriveId);
  return {
    accountId,
    agentId: agent.rows[0].id as string,
    driveId,
    driveKey,
    record,
    token,
    revoked,
    otherToken,
  };
}

const span = (extra: Record<string, unknown> = {}, model = 'openai/gpt-4') => ({
  traceId: 'a'.repeat(32),
  spanId: randomUUID().replaceAll('-', '').slice(0, 16),
  name: 'chat',
  attributes: [
    { key: 'gen_ai.request.model', value: { stringValue: model } },
    { key: 'input', value: { stringValue: PROMPT } },
    { key: 'output', value: { stringValue: REPLY } },
  ],
  ...extra,
});
const otlp = (spans: unknown[]) => ({
  resourceSpans: [{ scopeSpans: [{ spans }] }],
});
const withTime = (n = '1705312800000000000') => otlp([span({ startTimeUnixNano: n })]);

function post(
  f: Fixture,
  body: unknown,
  headers: Record<string, string> = {},
  opts: { driveId?: string; auth?: string | null; url?: string } = {},
) {
  const driveId = opts.driveId ?? f.driveId;
  const auth = opts.auth === undefined ? f.token : opts.auth;
  return ingestOpenRouterTrace({
    url: new URL(opts.url ?? `https://agent-drive.test/api/webhooks/openrouter/${driveId}`),
    headers: new Headers({ ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers }),
    bytes: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
    driveId,
  }).catch(responseForError);
}

async function objectKeys(f: Fixture) {
  const out = await storageClient().send(
    new ListObjectsV2Command({
      Bucket: storageBucket(),
      Prefix: `objects/${f.accountId}/${f.driveId}/`,
    }),
  );
  return (out.Contents ?? []).map((o) => o.Key!);
}

async function counts(f: Fixture) {
  const q = async (sql: string) =>
    Number((await pool.query(sql, [f.accountId, f.driveId])).rows[0].n);
  return {
    objects: (await objectKeys(f)).length,
    versions: await q(
      'SELECT count(*) n FROM versions WHERE drive_id = $2 AND $1::uuid IS NOT NULL',
    ),
    audit: await q(
      'SELECT count(*) n FROM audit_events WHERE account_id = $1 AND $2::uuid IS NOT NULL',
    ),
    events: await q(
      'SELECT count(*) n FROM file_events WHERE drive_id = $2 AND $1::uuid IS NOT NULL',
    ),
  };
}

beforeAll(async () => {
  await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))',
      [accountIds],
    );
    await pool.query('DELETE FROM drives WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM billing_accounts WHERE account_id = ANY($1::uuid[])', [
      accountIds,
    ]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('openrouter webhook ingest', () => {
  it('checks the token before anything, even for test connections', async () => {
    const f = await fixture();
    const before = await counts(f);
    for (const testHeader of [{}, { 'x-test-connection': 'true' }]) {
      for (const auth of [null, 'adw_wrong', f.revoked, f.otherToken]) {
        const response = await post(f, withTime(), testHeader, { auth });
        expect(response.status).toBe(401);
      }
    }
    expect(await counts(f)).toEqual(before);
  });

  it('answers a valid test connection without writing', async () => {
    const f = await fixture();
    const before = await counts(f);
    const response = await post(f, { resourceSpans: [] }, { 'x-test-connection': 'true' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await counts(f)).toEqual(before);
  });

  it('stores a trace that the drive key can decrypt, and leaks no plaintext', async () => {
    const f = await fixture();
    const spies = (['log', 'error', 'warn'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const body = withTime();
    const response = await post(f, body);
    expect(response.status).toBe(201);
    const result = (await response.json()) as { stored: number; path: string };
    expect(result.stored).toBe(1);
    expect(result.path).toMatch(
      /^\/traces\/openrouter\/2024-01-15\/.+_openai-gpt-4_[0-9a-f]{32}\.json$/u,
    );

    const versions = await pool.query(
      'SELECT v.*, f.path FROM versions v JOIN files f ON f.id = v.file_id WHERE v.drive_id = $1',
      [f.driveId],
    );
    expect(versions.rowCount).toBe(1);
    const version = versions.rows[0];
    expect(version.wrapped_key).toHaveLength(183);
    expect(version.agent_id).toBe(f.agentId);
    expect(version.tags).toEqual(['trace', 'agent:openrouter', 'model:openai-gpt-4']);
    expect(
      (
        await pool.query("SELECT 1 FROM file_events WHERE drive_id = $1 AND operation = 'put'", [
          f.driveId,
        ])
      ).rowCount,
    ).toBe(1);
    const audit = await pool.query(
      "SELECT * FROM audit_events WHERE account_id = $1 AND action = 'webhook.trace.ingest'",
      [f.accountId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      api_key_id: null,
      agent_id: f.agentId,
      outcome: 'success',
    });

    const object = await storageClient().send(
      new GetObjectCommand({ Bucket: storageBucket(), Key: version.object_key }),
    );
    const stored = new Uint8Array(await object.Body!.transformToByteArray());
    expect(stored.length).toBe(Number(version.ciphertext_size));
    const { envelopeVersion } = await import('../../../../packages/agent-drive/src/crypto.js');
    expect(envelopeVersion(version.wrapped_key)).toBe(2);
    const plain = await decryptFile(stored, version.wrapped_key, f.driveKey, {
      driveId: f.driveId,
      ...f.record,
    });
    const text = new TextDecoder().decode(plain);
    expect(JSON.parse(text).otlp).toEqual(body);
    expect(JSON.parse(text)).toMatchObject({ v: 1, agent: 'openrouter', provider: 'openrouter' });
    expect(text).toContain(PROMPT);
    expect(text).toContain(REPLY);

    // Plaintext and the token appear in no metadata, and in no log output.
    for (const needle of [PROMPT, REPLY, f.token]) {
      for (const [table, where] of [
        ['audit_events', 'account_id'],
        ['versions', 'drive_id'],
        ['file_events', 'drive_id'],
        ['files', 'drive_id'],
      ] as const) {
        const hit = await pool.query(
          `SELECT 1 FROM ${table} t WHERE t.${where} = $1 AND t::text LIKE '%' || $2 || '%'`,
          [where === 'account_id' ? f.accountId : f.driveId, needle],
        );
        expect(hit.rowCount, `${needle} in ${table}`).toBe(0);
      }
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(needle);
    }
    expect(new TextDecoder('latin1').decode(stored)).not.toContain(PROMPT);
  });

  it('stores a multi-span body as one file and dedupes redelivery', async () => {
    const f = await fixture();
    const multi = otlp([
      span({ startTimeUnixNano: '1705312805000000000' }),
      span({ startTimeUnixNano: '1705312800000000000' }),
    ]);
    expect((await post(f, multi)).status).toBe(201);
    vi.mocked(putObject).mockClear();
    const again = await post(f, multi, { date: 'Tue, 16 Jan 2024 00:00:00 GMT' });
    expect(putObject).not.toHaveBeenCalled(); // detected before any S3 write
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, stored: 0, duplicate: true });

    const undated = otlp([span()]);
    expect((await post(f, undated)).status).toBe(201);
    const dup2 = await post(f, undated, { date: 'Wed, 17 Jan 2024 00:00:00 GMT' });
    expect((await dup2.json()).duplicate).toBe(true);

    const c = await counts(f);
    expect(c.versions).toBe(2);
    expect(c.objects).toBe(2);
    expect(c.audit).toBe(2);
  });

  it('gives distinct bodies with identical timestamps distinct paths', async () => {
    const f = await fixture();
    const a = await (
      await post(f, otlp([span({ startTimeUnixNano: '1705312800000000000' })]))
    ).json();
    const b = await (
      await post(f, otlp([span({ startTimeUnixNano: '1705312800000000000' })]))
    ).json();
    expect(a.path).not.toBe(b.path);
  });

  it('ignores empty or span-less bodies', async () => {
    const f = await fixture();
    const before = await counts(f);
    for (const body of [{ resourceSpans: [] }, {}, 'not json', '[]']) {
      const response = await post(f, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, stored: 0 });
    }
    expect(await counts(f)).toEqual(before);
  });

  it('enforces the drive quota against the stored size', async () => {
    const probe = await fixture();
    const body = withTime();
    // The stored JSON is a pure function of the body plus a fixed-width receivedAt.
    const jsonLength = new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        agent: 'openrouter',
        provider: 'openrouter',
        receivedAt: new Date().toISOString(),
        otlp: body,
      }),
    ).length;
    const size = encryptedSize(jsonLength);

    const tight = await fixture({ quotaBytes: size - 1 });
    vi.mocked(putObject).mockClear();
    const rejected = await post(tight, body);
    expect(putObject).not.toHaveBeenCalled(); // rejected before any S3 write
    expect(rejected.status).toBe(413);
    expect((await rejected.json()).error.code).toBe('quota_exceeded');
    expect((await counts(tight)).objects).toBe(0);
    expect((await counts(tight)).versions).toBe(0);

    const exact = await fixture({ quotaBytes: size });
    expect((await post(exact, body)).status).toBe(201);
    const version = (
      await pool.query('SELECT object_key, ciphertext_size FROM versions WHERE drive_id = $1', [
        exact.driveId,
      ])
    ).rows[0];
    expect(Number(version.ciphertext_size)).toBe(size);
    const head = await storageClient().send(
      new GetObjectCommand({ Bucket: storageBucket(), Key: version.object_key }),
    );
    expect(head.ContentLength).toBe(size);
    expect(probe.driveId).toBeTruthy();
  });

  it('returns 409 and writes nothing without an inbox', async () => {
    const f = await fixture({ inbox: false });
    const response = await post(f, withTime());
    expect(response.status).toBe(409);
    expect(await counts(f)).toMatchObject({ objects: 0, versions: 0, audit: 0 });
  });

  it('deletes the uploaded object when the commit fails after the upload', async () => {
    const f = await fixture();
    vi.mocked(versions.commitPut).mockImplementationOnce(async () => {
      expect((await objectKeys(f)).length).toBe(1); // the object was uploaded first
      throw new Error('boom');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await post(f, withTime());
    expect(response.status).toBe(500);
    expect(await counts(f)).toMatchObject({ objects: 0, versions: 0, events: 0, audit: 0 });
    // A retry of the same body then succeeds.
    expect((await post(f, withTime())).status).toBe(201);
  });

  it('serves the same results through the route handler', async () => {
    const f = await fixture();
    const call = (auth: string | null) =>
      POST(
        new Request(`https://agent-drive.test/api/webhooks/openrouter/${f.driveId}`, {
          method: 'POST',
          headers: auth ? { authorization: `Bearer ${auth}` } : {},
          body: JSON.stringify(withTime()),
        }),
        { params: Promise.resolve({ driveId: f.driveId }) },
      );
    const denied = await call('adw_wrong');
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe('unauthorized');
    const stored = await call(f.token);
    expect(stored.status).toBe(201);
    expect((await stored.json()).stored).toBe(1);
  });

  it('does not read the body for a bad token or a plain-http production request', async () => {
    const f = await fixture();
    const attempt = async (auth: string, url: string) => {
      const pull = vi.fn();
      const response = await POST(
        new Request(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth}` },
          body: new ReadableStream({ pull }, { highWaterMark: 0 }),
          duplex: 'half',
        } as RequestInit),
        { params: Promise.resolve({ driveId: f.driveId }) },
      );
      expect(pull).not.toHaveBeenCalled();
      return response.status;
    };
    const https = `https://agent-drive.test/api/webhooks/openrouter/${f.driveId}`;
    expect(await attempt('adw_wrong', https)).toBe(401);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(await attempt(f.token, https.replace('https', 'http'))).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('writes nothing when the drive is marked for deletion after authentication', async () => {
    const f = await fixture();
    const headers = new Headers({ authorization: `Bearer ${f.token}` });
    const url = new URL(`https://agent-drive.test/api/webhooks/openrouter/${f.driveId}`);
    const auth = await authorizeOpenRouterWebhook({ url, headers, driveId: f.driveId });
    await pool.query('UPDATE drives SET deleting_at = now() WHERE id = $1', [f.driveId]);
    const response = await ingestOpenRouterTrace({
      url,
      headers,
      auth,
      driveId: f.driveId,
      bytes: new TextEncoder().encode(JSON.stringify(withTime())),
    }).catch(responseForError);
    expect(response.status).toBe(404);
    expect(await counts(f)).toMatchObject({ objects: 0, versions: 0, audit: 0 });
  });

  it('keeps the object when the commit succeeded but its acknowledgement was lost', async () => {
    const f = await fixture();
    const body = withTime();
    const actual = await vi.importActual<typeof import('../db/client')>('../db/client');
    vi.mocked(db.withTransaction).mockImplementationOnce(async (callback) => {
      await actual.withTransaction(callback);
      throw new Error('connection lost after commit');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lost = await post(f, body);
    expect(lost.status).toBe(500);
    expect(await counts(f)).toMatchObject({ objects: 1, versions: 1 });
    const retry = await post(f, body);
    expect((await retry.json()).duplicate).toBe(true);
    expect(await counts(f)).toMatchObject({ objects: 1, versions: 1 });
  });

  it('accepts an uppercase drive id in the URL', async () => {
    const f = await fixture();
    const response = await post(f, withTime(), {}, { driveId: f.driveId.toUpperCase() });
    expect(response.status).toBe(201);
    const row = await pool.query('SELECT wrapped_key FROM versions WHERE drive_id = $1', [
      f.driveId,
    ]);
    expect(row.rows[0].wrapped_key).toHaveLength(183);
  });

  it('rejects plain http in production', async () => {
    const f = await fixture();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await post(
        f,
        withTime(),
        {},
        { url: `http://agent-drive.test/api/webhooks/openrouter/${f.driveId}` },
      );
      expect(response.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await counts(f)).objects).toBe(0);
  });
});

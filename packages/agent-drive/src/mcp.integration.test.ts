import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest, handlePublicShareRequest } from '../../../apps/web/src/api/handler.js';
import { AgentDriveClient } from './client.js';
import { generateDriveKey } from './crypto.js';
import { driveKeyEnvironmentName } from './config.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive';
const bucket = process.env.S3_BUCKET ?? 'agent-drive-local';
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});
const database = new Pool({ connectionString: databaseUrl });
let server: Server | undefined;
let apiUrl = '';
let tempRoot = '';
let accountId = '';
let driveId = '';
let scopedToken = '';
let readonlyToken = '';
let driveKey = '';
const accountIds: string[] = [];

async function handleHttp(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = request.method ?? 'GET';
  const requestUrl = `http://${request.headers.host}${request.url}`;
  const result =
    request.headers.authorization === 'Bearer mcp-rate-limit-fixture'
      ? Response.json(
          {
            error: {
              code: 'rate_limited',
              message: 'UNTRUSTED_SERVER_TEXT',
              retryAfter: 45,
              upgradeUrl: 'http://remote.example.test/upgrade',
            },
          },
          { status: 429 },
        )
      : request.url?.startsWith('/api/shares/')
        ? await handlePublicShareRequest(request.url.slice('/api/shares/'.length).split('?')[0]!)
        : await handleApiRequest(
            new Request(requestUrl, {
              method,
              headers,
              ...(method === 'GET' || method === 'HEAD'
                ? {}
                : { body: body as unknown as BodyInit }),
            }),
          );
  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}

async function fixtureObjectKeys() {
  const keys: string[] = [];
  for (const prefix of [`objects/${accountId}/`, `staging/${accountId}/`]) {
    let token: string | undefined;
    do {
      const page = await storage.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
      token = page.NextContinuationToken;
    } while (token);
  }
  return keys;
}

function processEnv(token: string, key?: string) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  for (const name of Object.keys(inherited)) {
    if (name.startsWith('AGENT_DRIVE_KEY')) delete inherited[name];
  }
  return {
    ...inherited,
    AGENT_DRIVE_API_URL: apiUrl,
    AGENT_DRIVE_API_KEY: token,
    AGENT_DRIVE_CONFIG: join(tempRoot, 'mcp-config.json'),
    AGENT_DRIVE_MACHINE: 'mcp-test-machine',
    ...(key ? { [driveKeyEnvironmentName(driveId)]: key } : {}),
  };
}

async function openMcp(token: string, key?: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/agent-drive/dist/cli.js'), 'mcp'],
    cwd: process.cwd(),
    env: processEnv(token, key),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: 'agent-drive-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === 'text')?.text ?? '';
  return { result, value: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

beforeAll(async () => {
  execFileSync('pnpm', ['--dir', 'apps/web', 'db:migrate'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });
  execFileSync('pnpm', ['--filter', 'agent-drive', 'build'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-drive-mcp-'));
  server = createServer((request, response) => {
    void handleHttp(request, response);
  });
  await new Promise<void>((resolveListen, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP adapter failed to bind.');
  apiUrl = `http://127.0.0.1:${address.port}`;
  const account = await database.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `phase3-mcp-${randomUUID()}`,
  ]);
  accountId = account.rows[0].id as string;
  accountIds.push(accountId);
  const agent = await database.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `mcp-${randomUUID()}`],
  );
  const manager = `adk_${randomBytes(32).toString('base64url')}`;
  await database.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes) VALUES ($1,$2,'mcp-manager',$3,'{}'::uuid[],ARRAY['manage']::text[])`,
    [accountId, agent.rows[0].id, createHash('sha256').update(manager).digest('hex')],
  );
  const admin = new AgentDriveClient({ apiUrl, apiKey: manager });
  const target = await admin.createAgent(`mcp-file-agent-${randomUUID()}`);
  const drive = await admin.createDrive(`mcp-drive-${randomUUID()}`);
  driveId = drive.id;
  driveKey = generateDriveKey();
  scopedToken = (
    await admin.createKey(target.id, 'mcp-rwd', [driveId], ['read', 'write', 'delete', 'share'])
  ).token!;
  readonlyToken = (await admin.createKey(target.id, 'mcp-read', [driveId], ['read'])).token!;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  try {
    for (const id of accountIds) {
      for (const key of await fixtureObjectKeys())
        await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await database.query(
        'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
        [id],
      );
      await database.query('DELETE FROM upload_intents WHERE account_id=$1', [id]);
      await database.query(
        'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
        [id],
      );
      await database.query('DELETE FROM accounts WHERE id=$1', [id]);
    }
  } finally {
    storage.destroy();
    await database.end();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('MCP product tools over stdio', () => {
  it('lists and exercises all tools with encrypted file and safe error behavior', async () => {
    const marker = `MCP-PLAINTEXT-${randomUUID()}-${randomBytes(8).toString('hex')}`;
    const mcp = await openMcp(scopedToken, driveKey);
    try {
      const tools = await mcp.client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'copy',
        'delete',
        'get',
        'list',
        'move',
        'put',
        'recent',
        'restore',
        'search',
        'share',
        'versions',
        'whoami',
      ]);
      const who = await call(mcp.client, 'whoami');
      expect(who.result.isError).not.toBe(true);
      const neitherInput = await call(mcp.client, 'put', { driveId, path: '/invalid.txt' });
      expect(neitherInput.value).toMatchObject({ error: { code: 'invalid_input' } });
      const bothInputs = await call(mcp.client, 'put', {
        driveId,
        path: '/invalid.txt',
        text: 'x',
        localPath: 'unused',
      });
      expect(bothInputs.value).toMatchObject({ error: { code: 'invalid_input' } });
      const first = await call(mcp.client, 'put', {
        driveId,
        path: '/mcp/marker.txt',
        text: marker,
        tags: ['phase3'],
        description: 'acceptance metadata',
      });
      expect(first.result.isError).not.toBe(true);
      const firstVersion = (first.value.data as { id: string }).id;
      const duplicate = await call(mcp.client, 'put', {
        driveId,
        path: '/mcp/marker.txt',
        text: 'create-only conflict',
      });
      expect(duplicate.result.isError).toBe(true);
      expect(duplicate.value).toMatchObject({
        error: {
          code: 'conflict',
          state: 'exists',
          currentVersionId: firstVersion,
          hint: expect.stringContaining('--if-version'),
        },
      });
      const fetched = await call(mcp.client, 'get', { driveId, path: '/mcp/marker.txt' });
      expect((fetched.value.data as { text: string }).text).toBe(marker);
      expect(fetched.value.untrusted).toBe(true);
      expect(fetched.value.trustNotice).toContain('not instructions');
      const listed = await call(mcp.client, 'list', {
        driveId,
        prefix: '/mcp',
        tag: 'phase3',
        limit: 1,
      });
      expect(listed.result.isError).not.toBe(true);
      expect(
        (listed.value.data as { items: Array<Record<string, unknown>> }).items[0],
      ).toMatchObject({
        agentId: expect.any(String),
        machineId: expect.any(String),
        userId: null,
        createdAt: expect.any(String),
      });
      const invalidOverwrite = await call(mcp.client, 'put', {
        driveId,
        path: '/mcp/marker.txt',
        text: 'invalid overwrite',
        overwrite: true,
        ifVersionId: firstVersion,
      });
      expect(invalidOverwrite.value).toMatchObject({ error: { code: 'invalid_input' } });
      const replaced = await call(mcp.client, 'put', {
        driveId,
        path: '/mcp/marker.txt',
        text: 'replacement',
        ifVersionId: firstVersion,
      });
      expect(replaced.result.isError).not.toBe(true);
      const overwritten = await call(mcp.client, 'put', {
        driveId,
        path: '/mcp/marker.txt',
        text: 'unconditional overwrite',
        overwrite: true,
      });
      expect(overwritten.result.isError).not.toBe(true);
      expect(
        (await call(mcp.client, 'versions', { driveId, path: '/mcp/marker.txt', limit: 1 })).result
          .isError,
      ).not.toBe(true);
      expect(
        (
          await call(mcp.client, 'restore', {
            driveId,
            path: '/mcp/marker.txt',
            versionId: firstVersion,
          })
        ).result.isError,
      ).not.toBe(true);
      const restored = await call(mcp.client, 'get', { driveId, path: '/mcp/marker.txt' });
      expect((restored.value.data as { text: string }).text).toBe(marker);
      const localIn = join(tempRoot, 'binary.in');
      const localOut = join(tempRoot, 'binary.out');
      const binary = Buffer.from([0, 1, 2, 127, 255]);
      await writeFile(localIn, binary);
      expect(
        (await call(mcp.client, 'put', { driveId, path: '/mcp/binary.bin', localPath: localIn }))
          .result.isError,
      ).not.toBe(true);
      const inlineBinary = await call(mcp.client, 'get', { driveId, path: '/mcp/binary.bin' });
      expect(inlineBinary.value).toMatchObject({ error: { code: 'invalid_input' } });
      expect(JSON.stringify(inlineBinary.value)).toContain('outputPath');
      expect(
        (await call(mcp.client, 'get', { driveId, path: '/mcp/binary.bin', outputPath: localOut }))
          .result.isError,
      ).not.toBe(true);
      expect(await readFile(localOut)).toEqual(binary);
      expect(
        (
          await call(mcp.client, 'copy', {
            driveId,
            path: '/mcp/marker.txt',
            destinationPath: '/mcp/copy.txt',
          })
        ).result.isError,
      ).not.toBe(true);
      expect(
        (
          await call(mcp.client, 'move', {
            driveId,
            path: '/mcp/copy.txt',
            destinationPath: '/mcp/moved.txt',
          })
        ).result.isError,
      ).not.toBe(true);
      expect(
        (await call(mcp.client, 'delete', { driveId, path: '/mcp/moved.txt' })).result.isError,
      ).not.toBe(true);
      expect(
        (await call(mcp.client, 'search', { driveId, q: '/mcp', limit: 1 })).result.isError,
      ).not.toBe(true);
      expect(
        (await call(mcp.client, 'recent', { driveId, since: '2000-01-01T00:00:00.000Z', limit: 1 }))
          .result.isError,
      ).not.toBe(true);
      const share = await call(mcp.client, 'share', {
        driveId,
        path: '/mcp/marker.txt',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(share.result.isError).not.toBe(true);
      const shareUrl = (share.value.data as { url: string }).url;
      expect(/#k=[A-Za-z0-9_-]{43}$/u.test(shareUrl)).toBe(true);
      const shareId = new URL(shareUrl).pathname.split('/').pop()!;
      const publicResponse = await fetch(`${apiUrl}/api/shares/${shareId}`);
      expect(publicResponse.status).toBe(200);
      const revokeResponse = await fetch(`${apiUrl}/api/v1/drives/${driveId}/shares/${shareId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${scopedToken}` },
      });
      expect(revokeResponse.status).toBe(200);
      expect((await fetch(`${apiUrl}/api/shares/${shareId}`)).status).toBe(410);
      const search = await call(mcp.client, 'search', { driveId, q: '/mcp', limit: 1 });
      expect((search.value.data as { nextCursor: string | null }).nextCursor).toBeTruthy();
      const recent = await call(mcp.client, 'recent', {
        driveId,
        since: '2000-01-01T00:00:00.000Z',
        limit: 1,
      });
      expect((recent.value.data as { nextCursor: string | null }).nextCursor).toBeTruthy();
      type RecentData = {
        items: { agentName: string | null }[];
        nextCursor: string | null;
        latestCursor: string | null;
      };
      let tailPage = recent.value.data as RecentData;
      while (tailPage.nextCursor) {
        tailPage = (
          await call(mcp.client, 'recent', { driveId, limit: 100, cursor: tailPage.nextCursor })
        ).value.data as RecentData;
      }
      const tailCursor = tailPage.latestCursor ?? (recent.value.data as RecentData).latestCursor;
      expect(tailCursor).toBeTruthy();
      const started = Date.now();
      const putLater = setTimeout(() => {
        void call(mcp.client, 'put', { driveId, path: '/mcp/wait.txt', text: 'wait' });
      }, 1000);
      const waited = await call(mcp.client, 'recent', {
        driveId,
        cursor: tailCursor,
        waitSeconds: 5,
      });
      clearTimeout(putLater);
      const waitedData = waited.value.data as RecentData;
      expect(waitedData.items.length).toBeGreaterThan(0);
      expect(waitedData.items[0]).toHaveProperty('agentName');
      expect(Date.now() - started).toBeLessThan(4500);
      const idleStart = Date.now();
      const idle = await call(mcp.client, 'recent', {
        driveId,
        cursor: waitedData.latestCursor,
        waitSeconds: 1,
      });
      expect((idle.value.data as RecentData).items).toEqual([]);
      expect(Date.now() - idleStart).toBeGreaterThanOrEqual(900);
      expect(Date.now() - idleStart).toBeLessThan(3000);
    } finally {
      await mcp.client.close();
    }
    expect(mcp.stderr()).not.toContain(scopedToken);
    expect(mcp.stderr()).not.toContain(driveKey);

    const missingKey = await openMcp(scopedToken);
    try {
      const result = await call(missingKey.client, 'put', {
        driveId,
        path: '/missing-key.txt',
        text: 'x',
      });
      expect(result.result.isError).toBe(true);
      expect(result.value).toMatchObject({ error: { code: 'missing_drive_key' } });
      expect(JSON.stringify(result.value)).not.toContain(scopedToken);
    } finally {
      await missingKey.client.close();
    }

    const wrong = await openMcp(scopedToken, generateDriveKey());
    try {
      const output = join(tempRoot, 'wrong-key.out');
      const result = await call(wrong.client, 'get', {
        driveId,
        path: '/mcp/marker.txt',
        outputPath: output,
      });
      expect(result.result.isError).toBe(true);
      expect(result.value).toMatchObject({ error: { code: 'decryption_failed' } });
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await wrong.client.close();
    }
    const readonly = await openMcp(readonlyToken, driveKey);
    try {
      const result = await call(readonly.client, 'put', {
        driveId,
        path: '/denied.txt',
        text: 'x',
      });
      expect(result.result.isError).toBe(true);
      expect(result.value).toMatchObject({ error: { code: 'permission_denied' } });
      expect(JSON.stringify(result.value)).not.toContain(readonlyToken);
      expect(JSON.stringify(result.value)).not.toContain(driveKey);
    } finally {
      await readonly.client.close();
    }

    await database.query('UPDATE billing_accounts SET spend_cap_cents = 0 WHERE account_id = $1', [
      accountId,
    ]);
    const paymentRequired = await openMcp(scopedToken, driveKey);
    try {
      const result = await call(paymentRequired.client, 'put', {
        driveId,
        path: '/billing-cap.txt',
        text: 'blocked by spend cap',
      });
      expect(result.result.isError).toBe(true);
      expect(result.value).toMatchObject({
        error: {
          code: 'payment_required',
          message: 'The account requires a billing plan or payment action.',
          upgradeUrl: expect.any(String),
        },
      });
      expect(JSON.stringify(result.value)).not.toContain('configured spend cap');
    } finally {
      await paymentRequired.client.close();
    }

    const limited = await openMcp('mcp-rate-limit-fixture');
    try {
      const result = await call(limited.client, 'whoami');
      expect(result.value).toMatchObject({
        error: {
          code: 'rate_limited',
          message: 'The API key has exceeded its request rate limit.',
          retryAfter: 45,
        },
      });
      expect(JSON.stringify(result.value)).not.toContain('UNTRUSTED_SERVER_TEXT');
      expect(result.value.error).not.toHaveProperty('upgradeUrl');
    } finally {
      await limited.client.close();
    }

    const tables = await database.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    for (const { tablename } of tables.rows) {
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      const rows = await database.query<{ rows: string }>(
        `SELECT COALESCE(json_agg(row_to_json(t))::text,'[]') AS rows FROM public.${quoted} t`,
      );
      expect(rows.rows[0]?.rows).not.toContain(marker);
    }
    for (const key of await fixtureObjectKeys()) {
      const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      expect(
        Buffer.from((await object.Body?.transformToByteArray()) ?? []).includes(
          Buffer.from(marker),
        ),
      ).toBe(false);
    }
  }, 120_000);
});

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../../apps/web/src/api/handler.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { runCheck } from './check.js';
import { AgentDriveClient } from './client.js';
import { decodeDriveKey, generateDriveKey } from './crypto.js';
import { seal } from './crypto-format.js';
import { createTraceInbox, sealFileKeyToInbox } from './trace-inbox.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive';
const bucket = process.env.S3_BUCKET ?? 'agent-drive-local';
const s3Endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const database = new Pool({ connectionString: databaseUrl });
const storage = new S3Client({
  endpoint: s3Endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});
const fixtureAccounts: string[] = [];
const capturedApiBodies: string[] = [];
let server: Server | undefined;
let apiUrl = '';
let tempRoot = '';
let accountId = '';
let managerAgentId = '';
let managementToken = '';
let cliDriveId = '';
let cliScopedToken = '';
let cliDriveKey = '';

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function bodyBytes(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function handleHttp(request: IncomingMessage, response: ServerResponse) {
  const bytes = await bodyBytes(request);
  if (bytes.length && request.url?.includes('/put')) capturedApiBodies.push(bytes.toString('utf8'));
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = request.method ?? 'GET';
  const webRequest = new Request(
    `http://${request.headers.host ?? '127.0.0.1'}${request.url ?? '/'}`,
    {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: bytes as unknown as BodyInit }),
    },
  );
  const result = await handleApiRequest(webRequest);
  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}

type CliResult = { status: number | null; stdout: string; stderr: string; error?: Error };

function runCli(
  args: string[],
  environment: NodeJS.ProcessEnv,
  input?: string,
): Promise<CliResult> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [resolve('packages/agent-drive/dist/cli.js'), ...args], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveResult({ status: null, stdout, stderr, error });
    });
    child.once('close', (status) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parsedOutput(result: CliResult) {
  if (result.status !== 0) {
    throw new Error(
      `CLI failed with status ${result.status}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

async function startApi() {
  server = createServer((request, response) => {
    void handleHttp(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local API adapter did not bind.');
  apiUrl = `http://127.0.0.1:${address.port}`;
}

async function listFixtureObjects(prefix: string) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function fixtureObjectKeys(forAccount = accountId) {
  const keys: string[] = [];
  for (const prefix of [`objects/${forAccount}/`, `staging/${forAccount}/`]) {
    keys.push(...(await listFixtureObjects(prefix)));
  }
  return keys;
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
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-drive-phase2-'));
  await startApi();
  const account = await database.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
    `phase2-client-${randomUUID()}`,
  ]);
  accountId = account.rows[0].id as string;
  fixtureAccounts.push(accountId);
  await database.query(
    `INSERT INTO billing_accounts (account_id, plan, subscription_status)
     VALUES ($1, 'developer', 'active')`,
    [accountId],
  );
  const manager = await database.query(
    'INSERT INTO agents (account_id,name) VALUES ($1,$2) RETURNING id',
    [accountId, `manager-${randomUUID()}`],
  );
  managerAgentId = manager.rows[0].id as string;
  managementToken = `adk_${randomBytes(32).toString('base64url')}`;
  await database.query(
    `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
     VALUES ($1,$2,'phase2-test-manager',$3,'{}'::uuid[],ARRAY['manage']::text[])`,
    [accountId, managerAgentId, await tokenHash(managementToken)],
  );
});

afterAll(async () => {
  if (server) await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  try {
    for (const id of fixtureAccounts) {
      const objects = await fixtureObjectKeys(id);
      for (const key of objects) {
        await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
      await database.query(
        'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
        [id],
      );
      await database.query('DELETE FROM upload_intents WHERE account_id = $1', [id]);
      await database.query(
        'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = $1)',
        [id],
      );
      await database.query('DELETE FROM accounts WHERE id = $1', [id]);
    }
  } finally {
    storage.destroy();
    await database.end();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('Phase 2 client and CLI against the real API and services', () => {
  it('prints safe upgrade and retry metadata in CLI errors', async () => {
    const errorServer = createServer((request, response) => {
      const invalid = request.headers.authorization === 'Bearer cli-invalid-metadata-token';
      response.writeHead(invalid ? 429 : 402, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            code: invalid ? 'rate_limited' : 'payment_required',
            message: invalid ? 'Try again later.' : 'The account needs a paid plan.',
            upgradeUrl: invalid
              ? 'http://remote.example.test/upgrade'
              : 'https://billing.example.test/console/billing',
            retryAfter: invalid ? -1 : 30,
          },
        }),
      );
    });
    await new Promise<void>((resolveListen, reject) => {
      errorServer.once('error', reject);
      errorServer.listen(0, '127.0.0.1', resolveListen);
    });
    try {
      const address = errorServer.address();
      if (!address || typeof address === 'string') throw new Error('Error server failed to bind.');
      const result = await runCli(['whoami'], {
        ...process.env,
        AGENT_DRIVE_API_URL: `http://127.0.0.1:${address.port}`,
        AGENT_DRIVE_API_KEY: 'cli-error-fixture-token',
        AGENT_DRIVE_CONFIG: join(tempRoot, 'cli-error-config.json'),
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Upgrade: https://billing.example.test/console/billing');
      expect(result.stderr).toContain('Retry after: 30 seconds');
      const invalidMetadata = await runCli(['whoami'], {
        ...process.env,
        AGENT_DRIVE_API_URL: `http://127.0.0.1:${address.port}`,
        AGENT_DRIVE_API_KEY: 'cli-invalid-metadata-token',
        AGENT_DRIVE_CONFIG: join(tempRoot, 'cli-invalid-error-config.json'),
      });
      expect(invalidMetadata.status).toBe(1);
      expect(invalidMetadata.stderr).not.toContain('Upgrade:');
      expect(invalidMetadata.stderr).not.toContain('Retry after:');
    } finally {
      await new Promise<void>((resolveClose) => errorServer.close(() => resolveClose()));
    }
  });

  it('keeps plaintext out of API, every public database row, and raw fixture objects', async () => {
    const marker = `PHASE2-PLAINTEXT-${randomUUID()}-${randomBytes(12).toString('hex')}`;
    const driveKey = generateDriveKey();
    const manager = new AgentDriveClient({
      apiUrl,
      apiKey: managementToken,
      machine: 'phase2-manager',
    });
    const who = await manager.whoami();
    expect(who.accountId).toBe(accountId);
    const fileAgent = await manager.createAgent(`client-${randomUUID()}`);
    const createdDrive = await manager.createDrive(`client-drive-${randomUUID()}`);
    expect(createdDrive.created).toBe(true);
    const repeatedDrive = await manager.createDrive(createdDrive.name);
    expect(repeatedDrive.id).toBe(createdDrive.id);
    expect(repeatedDrive.created).toBe(false);
    const granted = await manager.createKey(
      fileAgent.id,
      'phase2-client-ops',
      [createdDrive.id],
      ['read', 'write', 'delete'],
    );
    const client = new AgentDriveClient({
      apiUrl,
      apiKey: granted.token!,
      machine: 'phase2-client-machine',
      driveKey,
    });
    const markerBytes = new TextEncoder().encode(marker);
    const first = await client.put(createdDrive.id, '/acceptance/marker.txt', markerBytes, {
      tags: ['acceptance'],
      description: 'encrypted acceptance payload',
      userId: 'phase2-test-user',
    });
    await expect(
      client.put(createdDrive.id, '/acceptance/marker.txt', markerBytes),
    ).rejects.toMatchObject({
      code: 'conflict',
      state: 'exists',
      currentVersionId: first.id,
    });
    const read = await client.get(createdDrive.id, '/acceptance/marker.txt');
    expect(read.bytes).toEqual(markerBytes);
    const replacement = new TextEncoder().encode('replacement encrypted bytes');
    const second = await client.put(createdDrive.id, '/acceptance/marker.txt', replacement, {
      ifVersionId: first.id,
    });
    expect(second.id).not.toBe(first.id);
    const overwritten = await client.put(createdDrive.id, '/acceptance/marker.txt', replacement, {
      mode: 'overwrite',
    });
    expect(overwritten.id).not.toBe(second.id);
    const versionPage = await client.versions(createdDrive.id, '/acceptance/marker.txt');
    expect(versionPage.items.map((version) => version.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    const restored = await client.restore(
      createdDrive.id,
      '/acceptance/marker.txt',
      first.id,
      'phase2-test-user',
    );
    expect((await client.get(createdDrive.id, '/acceptance/marker.txt')).bytes).toEqual(
      markerBytes,
    );

    const listed = await client.list(createdDrive.id, '/acceptance');
    const entry = listed.items.find((item) => item.path === '/acceptance/marker.txt');
    expect(entry).toMatchObject({
      fileId: expect.any(String),
      versionId: restored.version.id,
      ciphertextSize: expect.any(Number),
      agentId: fileAgent.id,
      machineId: expect.any(String),
      userId: 'phase2-test-user',
      tags: ['acceptance'],
      description: 'encrypted acceptance payload',
      createdAt: expect.any(String),
    });
    expect(entry?.fileId).not.toBe(entry?.versionId);
    expect(
      (
        await client.list(createdDrive.id, '/acceptance', 100, undefined, {
          agentId: fileAgent.id,
          machine: 'phase2-client-machine',
          user: 'phase2-test-user',
          tag: 'acceptance',
        })
      ).items,
    ).toContainEqual(expect.objectContaining({ path: '/acceptance/marker.txt' }));
    expect(
      await client.search(createdDrive.id, { machine: 'phase2-client-machine' }),
    ).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: restored.version.id })]),
    });
    await client.copy(createdDrive.id, '/acceptance/marker.txt', '/acceptance/copied.txt');
    await client.move(createdDrive.id, '/acceptance/copied.txt', '/acceptance/moved.txt');
    await client.delete(createdDrive.id, '/acceptance/moved.txt');
    await client.restore(createdDrive.id, '/acceptance/moved.txt');
    await manager.listAgents(100);
    await manager.listDrives(100);
    await manager.listKeys(100);

    expect(capturedApiBodies.join('\n')).not.toContain(marker);
    expect(capturedApiBodies.join('\n')).not.toContain(driveKey);
    const tables = await database.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    for (const { tablename } of tables.rows) {
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      const rows = await database.query<{ rows: string }>(
        `SELECT COALESCE(json_agg(row_to_json(t))::text, '[]') AS rows FROM public.${quoted} AS t`,
      );
      expect(rows.rows[0]?.rows).not.toContain(marker);
    }
    for (const key of await fixtureObjectKeys()) {
      const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await object.Body?.transformToByteArray();
      expect(Buffer.from(bytes ?? []).includes(Buffer.from(marker))).toBe(false);
    }
  }, 120_000);

  it('unwraps before creating a share and pins the version selected by preflight', async () => {
    const manager = new AgentDriveClient({ apiUrl, apiKey: managementToken });
    const agent = await manager.createAgent(`share-client-${randomUUID()}`);
    const drive = await manager.createDrive(`share-client-${randomUUID()}`);
    const driveKey = generateDriveKey();
    const scoped = await manager.createKey(
      agent.id,
      'share-client',
      [drive.id],
      ['read', 'write', 'share'],
    );
    const writer = new AgentDriveClient({
      apiUrl,
      apiKey: scoped.token!,
      driveKey,
    });
    const currentPeriodAuthorization = async () =>
      (
        await database.query<{ authorized_egress_bytes: string }>(
          `SELECT authorized_egress_bytes::text FROM billing_periods
            WHERE account_id = (SELECT account_id FROM drives WHERE id = $1)
              AND period_start = date_trunc('month', now())`,
          [drive.id],
        )
      ).rows[0]!.authorized_egress_bytes;
    const path = `/${'界'.repeat(1023)}`;
    const encodedQuery = new URLSearchParams({ path }).toString();
    expect(path.length).toBe(1024);
    expect(encodedQuery.length).toBeGreaterThan(8192);
    const firstVersion = await writer.put(drive.id, path, Buffer.from('first version'));
    const countShares = async () =>
      Number(
        (
          await database.query('SELECT count(*)::int AS count FROM shares WHERE drive_id = $1', [
            drive.id,
          ])
        ).rows[0]?.count,
      );
    const missingKeyClient = new AgentDriveClient({ apiUrl, apiKey: scoped.token! });
    await expect(missingKeyClient.createShare(drive.id, path)).rejects.toMatchObject({
      code: 'missing_drive_key',
    });
    const wrongKeyClient = new AgentDriveClient({
      apiUrl,
      apiKey: scoped.token!,
      driveKey: generateDriveKey(),
    });
    await expect(wrongKeyClient.createShare(drive.id, path)).rejects.toMatchObject({
      code: 'decryption_failed',
    });
    expect(await countShares()).toBe(0);

    let selectedVersionId = '';
    let racedVersionId = '';
    let metadataOnly = '';
    let postedBody: Record<string, unknown> | undefined;
    const authorizedBeforeShare = await currentPeriodAuthorization();
    const clientWithVersionRace = new AgentDriveClient({
      apiUrl,
      apiKey: scoped.token!,
      driveKey,
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.endsWith('/get')) {
          metadataOnly = url.searchParams.get('metadataOnly') ?? '';
          const response = await fetch(input, init);
          selectedVersionId = ((await response.clone().json()) as { id: string }).id;
          return response;
        }
        if (url.pathname.endsWith('/shares') && init?.method === 'POST') {
          racedVersionId = (
            await writer.put(drive.id, path, Buffer.from('new current version'), {
              mode: 'overwrite',
            })
          ).id;
          postedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        }
        return fetch(input, init);
      },
    });
    const share = await clientWithVersionRace.createShare(drive.id, path);
    expect(selectedVersionId).toBe(firstVersion.id);
    expect(racedVersionId).not.toBe(firstVersion.id);
    expect(postedBody?.versionId).toBe(firstVersion.id);
    expect(metadataOnly).toBe('1');
    expect(share.versionId).toBe(firstVersion.id);
    const stored = await database.query('SELECT version_id FROM shares WHERE id = $1', [share.id]);
    expect(stored.rows[0]?.version_id).toBe(firstVersion.id);
    expect(await countShares()).toBe(1);
    expect(await currentPeriodAuthorization()).toBe(authorizedBeforeShare);
  });

  it('runs the CLI login, provisioning, encrypted file, restore, sync, and wrong-key acceptance flow', async () => {
    const config = join(tempRoot, 'cli-config', 'config.json');
    const baseEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      AGENT_DRIVE_CONFIG: config,
      AGENT_DRIVE_API_URL: apiUrl,
      AGENT_DRIVE_API_KEY: managementToken,
      AGENT_DRIVE_MACHINE: 'phase2-cli-machine',
    };
    const help = await runCli(['--help'], {} as NodeJS.ProcessEnv);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('sync LOCAL_DIRECTORY');
    expect((await runCli([], {} as NodeJS.ProcessEnv)).stdout).toContain('Commands:');
    const loginEnvironment = { ...baseEnvironment };
    delete loginEnvironment.AGENT_DRIVE_API_KEY;
    const login = await runCli(
      ['login', '--api', apiUrl, '--token-stdin'],
      loginEnvironment,
      managementToken,
    );
    expect(login.status).toBe(0);
    expect(login.stdout).not.toContain(managementToken);
    const rootScriptHelp = spawnSync('pnpm', ['agent-drive', '--help'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(rootScriptHelp.status).toBe(0);
    expect(rootScriptHelp.stdout).toContain('Agent Drive CLI');

    const concurrentConfig = join(tempRoot, 'concurrent-config', 'config.json');
    const concurrentEnvironment: NodeJS.ProcessEnv = {
      ...baseEnvironment,
      AGENT_DRIVE_CONFIG: concurrentConfig,
    };
    const concurrentLoginEnvironment = { ...concurrentEnvironment };
    delete concurrentLoginEnvironment.AGENT_DRIVE_API_KEY;
    const concurrentLogin = await runCli(
      ['login', '--api', apiUrl, '--token-stdin'],
      concurrentLoginEnvironment,
      managementToken,
    );
    expect(concurrentLogin.status).toBe(0);
    const concurrentNames = [`parallel-a-${randomUUID()}`, `parallel-b-${randomUUID()}`];
    const concurrentDrives = await Promise.all(
      concurrentNames.map(async (name) =>
        parsedOutput(await runCli(['drive', 'create', '--name', name], concurrentEnvironment)),
      ),
    );
    const concurrentSaved = JSON.parse(await readFile(concurrentConfig, 'utf8')) as {
      driveKeys: Record<string, string>;
    };
    // `drive create` no longer prints the key; it must be saved, and distinct per drive.
    for (const drive of concurrentDrives) {
      expect(drive).not.toHaveProperty('driveKey');
      expect(concurrentSaved.driveKeys[String(drive.id)]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(
      new Set(concurrentDrives.map((drive) => concurrentSaved.driveKeys[String(drive.id)])).size,
    ).toBe(concurrentDrives.length);

    const agent = parsedOutput(
      await runCli(['agent', 'create', '--name', `cli-agent-${randomUUID()}`], baseEnvironment),
    );
    const drive = parsedOutput(
      await runCli(['drive', 'create', '--name', `cli-drive-${randomUUID()}`], baseEnvironment),
    );
    cliDriveId = String(drive.id);
    expect(drive.created).toBe(true);
    expect(drive).not.toHaveProperty('driveKey');
    const savedConfig = JSON.parse(await readFile(config, 'utf8')) as {
      driveKeys: Record<string, string>;
    };
    cliDriveKey = String(savedConfig.driveKeys[cliDriveId]);
    expect(cliDriveKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const repeated = parsedOutput(
      await runCli(['drive', 'create', '--name', String(drive.name)], baseEnvironment),
    );
    expect(repeated).toMatchObject({ id: cliDriveId, created: false });
    expect(
      (JSON.parse(await readFile(config, 'utf8')) as typeof savedConfig).driveKeys[cliDriveId],
    ).toBe(cliDriveKey);

    const noKeyConfig = join(tempRoot, 'missing-key-config', 'config.json');
    const noKeyEnvironment: NodeJS.ProcessEnv = {
      ...baseEnvironment,
      AGENT_DRIVE_CONFIG: noKeyConfig,
    };
    delete noKeyEnvironment.AGENT_DRIVE_KEY;
    const noKeyLoginEnvironment = { ...noKeyEnvironment };
    delete noKeyLoginEnvironment.AGENT_DRIVE_API_KEY;
    const noKeyLogin = await runCli(
      ['login', '--api', apiUrl, '--token-stdin'],
      noKeyLoginEnvironment,
      managementToken,
    );
    expect(noKeyLogin.status).toBe(0);
    const missingBackup = await runCli(
      ['drive', 'create', '--name', String(drive.name)],
      noKeyEnvironment,
    );
    expect(missingBackup.status).not.toBe(0);
    expect(missingBackup.stderr).toContain('load its backup');
    expect(JSON.parse(await readFile(noKeyConfig, 'utf8'))).not.toHaveProperty('driveKeys');

    const keyResult = parsedOutput(
      await runCli(
        [
          'key',
          'create',
          '--agent',
          String(agent.id),
          '--drive',
          cliDriveId,
          '--label',
          'cli-integration',
          '--scope',
          'read',
          '--scope',
          'write',
          '--scope',
          'delete',
        ],
        baseEnvironment,
      ),
    );
    cliScopedToken = String(keyResult.token);
    const cliEnvironment = { ...baseEnvironment, AGENT_DRIVE_API_KEY: cliScopedToken };
    const localFile = join(tempRoot, 'cli-input.txt');
    const original = Buffer.from('CLI acceptance original bytes\n');
    await writeFile(localFile, original);
    const put = parsedOutput(
      await runCli(['put', localFile, '/cli/file.txt', '--drive', cliDriveId], cliEnvironment),
    );
    const duplicatePut = await runCli(
      ['put', localFile, '/cli/file.txt', '--drive', cliDriveId],
      cliEnvironment,
    );
    expect(duplicatePut.status).not.toBe(0);
    expect(duplicatePut.stderr).toMatch(/conflict|already exists/i);
    const outputFile = join(tempRoot, 'cli-output.txt');
    const get = await runCli(
      ['get', '/cli/file.txt', '--drive', cliDriveId, '--output', outputFile],
      cliEnvironment,
    );
    expect(get.status).toBe(0);
    expect(await readFile(outputFile)).toEqual(original);
    expect((await stat(outputFile)).mode & 0o777).toBe(0o600);

    await writeFile(localFile, Buffer.from('CLI acceptance changed bytes\n'));
    const updated = parsedOutput(
      await runCli(
        ['put', localFile, '/cli/file.txt', '--drive', cliDriveId, '--if-version', String(put.id)],
        cliEnvironment,
      ),
    );
    const versions = parsedOutput(
      await runCli(['versions', '/cli/file.txt', '--drive', cliDriveId], cliEnvironment),
    );
    expect((versions.items as unknown[]).length).toBeGreaterThanOrEqual(2);
    const restore = await runCli(
      ['restore', '/cli/file.txt', '--drive', cliDriveId, '--version', String(put.id)],
      cliEnvironment,
    );
    expect(restore.status).toBe(0);
    const restoredFile = join(tempRoot, 'cli-restored.txt');
    expect(
      (
        await runCli(
          ['get', '/cli/file.txt', '--drive', cliDriveId, '--output', restoredFile],
          cliEnvironment,
        )
      ).status,
    ).toBe(0);
    expect(await readFile(restoredFile)).toEqual(original);
    expect(updated.id).not.toBe(put.id);
    const overwriteFile = join(tempRoot, 'cli-overwrite.txt');
    await writeFile(overwriteFile, Buffer.from('unconditional overwrite\n'));
    const unconditional = parsedOutput(
      await runCli(
        ['put', overwriteFile, '/cli/file.txt', '--drive', cliDriveId, '--overwrite'],
        cliEnvironment,
      ),
    );
    expect(unconditional.id).not.toBe(updated.id);
    const recent = await runCli(
      ['recent', '--drive', cliDriveId, '--since', '2000-01-01T00:00:00.000Z'],
      cliEnvironment,
    );
    expect(recent.status).toBe(0);
    const machineSearch = parsedOutput(
      await runCli(
        ['search', '--drive', cliDriveId, '--machine', 'phase2-cli-machine'],
        cliEnvironment,
      ),
    );
    expect(machineSearch.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/cli/file.txt' })]),
    );

    const adoptionRoot = join(tempRoot, 'adoption-source');
    await mkdirSafe(adoptionRoot);
    const adoptionFile = join(adoptionRoot, 'existing.txt');
    const remoteBytes = Buffer.from('remote before adoption\n');
    const adoptionBytes = Buffer.from('local adopted bytes\n');
    await writeFile(adoptionFile, adoptionBytes);
    const client = new AgentDriveClient({
      apiUrl,
      apiKey: cliScopedToken,
      driveKey: cliDriveKey,
    });
    await client.put(cliDriveId, '/adoption/existing.txt', remoteBytes, { mode: 'create' });
    const refusedAdoption = await runCli(
      ['sync', adoptionRoot, '--drive', cliDriveId, '--prefix', '/adoption'],
      cliEnvironment,
    );
    expect(refusedAdoption.status).not.toBe(0);
    expect(refusedAdoption.stderr).toContain('no local sync history');
    expect(Buffer.from((await client.get(cliDriveId, '/adoption/existing.txt')).bytes)).toEqual(
      remoteBytes,
    );
    const adopted = parsedOutput(
      await runCli(
        [
          'sync',
          adoptionRoot,
          '--drive',
          cliDriveId,
          '--prefix',
          '/adoption',
          '--overwrite-existing',
        ],
        cliEnvironment,
      ),
    );
    expect(adopted.uploaded).toBe(1);
    expect(Buffer.from((await client.get(cliDriveId, '/adoption/existing.txt')).bytes)).toEqual(
      adoptionBytes,
    );

    const binaryFile = join(tempRoot, 'cli-binary.txt');
    await writeFile(binaryFile, Buffer.from([0, 0x41, 0x1b]));
    expect(
      (await runCli(['put', binaryFile, '/cli/binary.txt', '--drive', cliDriveId], cliEnvironment))
        .status,
    ).toBe(0);
    expect(
      (await runCli(['get', '/cli/binary.txt', '--drive', cliDriveId], cliEnvironment)).status,
    ).not.toBe(0);

    const syncRoot = join(tempRoot, 'sync-source');
    await mkdirSafe(syncRoot);
    const syncFile = join(syncRoot, 'sync.txt');
    await writeFile(syncFile, Buffer.from('sync initial\n'));
    await writeFile(join(syncRoot, '__proto__'), Buffer.from('prototype-named file\n'));
    await writeFile(join(syncRoot, 'constructor'), Buffer.from('constructor-named file\n'));
    const firstSync = parsedOutput(
      await runCli(['sync', syncRoot, '--drive', cliDriveId, '--prefix', '/sync'], cliEnvironment),
    );
    expect(firstSync.uploaded).toBe(3);
    const manifestPath = String(firstSync.manifestPath);
    const manifestBytes = await readFile(manifestPath);
    await writeFile(manifestPath, '{malformed');
    const malformedManifest = await runCli(
      ['sync', syncRoot, '--drive', cliDriveId, '--prefix', '/sync'],
      cliEnvironment,
    );
    expect(malformedManifest.status).not.toBe(0);
    expect(malformedManifest.stderr).toContain('manifest is malformed');
    await writeFile(manifestPath, manifestBytes);
    const secondSync = parsedOutput(
      await runCli(['sync', syncRoot, '--drive', cliDriveId, '--prefix', '/sync'], cliEnvironment),
    );
    expect(secondSync.uploaded).toBe(0);
    await writeFile(syncFile, Buffer.from('sync changed\n'));
    const changedSync = parsedOutput(
      await runCli(['sync', syncRoot, '--drive', cliDriveId, '--prefix', '/sync'], cliEnvironment),
    );
    expect(changedSync.uploaded).toBe(1);
    const latest = await new AgentDriveClient({
      apiUrl,
      apiKey: cliScopedToken,
      machine: 'cli-conflict-writer',
      driveKey: cliDriveKey,
    }).list(cliDriveId, '/sync');
    const syncVersion = latest.items.find((item) => item.path === '/sync/sync.txt')?.versionId;
    if (!syncVersion) throw new Error('Sync version missing from current listing.');
    await new AgentDriveClient({
      apiUrl,
      apiKey: cliScopedToken,
      machine: 'cli-conflict-writer',
      driveKey: cliDriveKey,
    }).put(cliDriveId, '/sync/sync.txt', new TextEncoder().encode('remote edit\n'), {
      mode: 'overwrite',
      ifVersionId: syncVersion,
    });
    const conflict = await runCli(
      ['sync', syncRoot, '--drive', cliDriveId, '--prefix', '/sync', '--overwrite-existing'],
      cliEnvironment,
    );
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain('Remote conflict');
    const remoteAfterConflict = await new AgentDriveClient({
      apiUrl,
      apiKey: cliScopedToken,
      machine: 'cli-conflict-reader',
      driveKey: cliDriveKey,
    }).get(cliDriveId, '/sync/sync.txt');
    expect(remoteAfterConflict.bytes).toEqual(new TextEncoder().encode('remote edit\n'));

    const wrongOutput = join(tempRoot, 'wrong-key-output.bin');
    const wrongKey = await runCli(
      ['get', '/cli/file.txt', '--drive', cliDriveId, '--output', wrongOutput],
      { ...cliEnvironment, AGENT_DRIVE_KEY: generateDriveKey() },
    );
    expect(wrongKey.status).not.toBe(0);
    await expect(lstat(wrongOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('reads a version-2 (trace inbox) file through get and check', async () => {
    const manager = new AgentDriveClient({ apiUrl, apiKey: managementToken });
    const agent = await manager.createAgent(`v2-client-${randomUUID()}`);
    const drive = await manager.createDrive(`v2-client-${randomUUID()}`);
    const driveKey = generateDriveKey();
    const token = (await manager.createKey(agent.id, 'v2-client', [drive.id], ['read', 'write']))
      .token!;
    const record = await createTraceInbox(drive.id, driveKey);
    await database.query(
      `INSERT INTO drive_trace_inboxes (drive_id,account_id,key_id,public_key,wrapped_private_key)
       VALUES ($1,$2,$3,$4,$5)`,
      [drive.id, accountId, record.keyId, record.publicKey, record.wrappedPrivateKey],
    );
    const fileKey = generateDriveKey();
    const json = JSON.stringify({ otlp: { marker: randomUUID() } });
    const ciphertext = await seal(
      new TextEncoder().encode(json),
      decodeDriveKey(fileKey),
      randomBytes(8),
    );
    const wrappedKey = await sealFileKeyToInbox(fileKey, { driveId: drive.id, ...record });
    const versionId = randomUUID();
    const path = '/traces/openrouter/fixture.json';
    const objectKey = `objects/${accountId}/${drive.id}/${versionId}`;
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: ciphertext }));
    const fileId = (
      await database.query<{ id: string }>(
        'INSERT INTO files (drive_id,path) VALUES ($1,$2) RETURNING id',
        [drive.id, path],
      )
    ).rows[0]!.id;
    await database.query(
      `INSERT INTO versions (id,file_id,drive_id,object_key,ciphertext_size,wrapped_key,agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [versionId, fileId, drive.id, objectKey, ciphertext.length, wrappedKey, agent.id],
    );
    await database.query('UPDATE files SET current_version_id=$2 WHERE id=$1', [fileId, versionId]);
    await database.query(
      `INSERT INTO file_events (drive_id,file_id,operation,path,version_id,agent_id)
       VALUES ($1,$2,'put',$3,$4,$5)`,
      [drive.id, fileId, path, versionId, agent.id],
    );
    const client = new AgentDriveClient({ apiUrl, apiKey: token, driveKey });
    expect(new TextDecoder().decode((await client.get(drive.id, path)).bytes)).toBe(json);
    expect(await runCheck(client, drive.id)).toBe(`check ok drive=${drive.id}`);
    const wrong = new AgentDriveClient({ apiUrl, apiKey: token, driveKey: generateDriveKey() });
    await expect(wrong.get(drive.id, path)).rejects.toMatchObject({ code: 'decryption_failed' });
  }, 60_000);
});

async function mkdirSafe(path: string) {
  await mkdir(path, { recursive: true });
}

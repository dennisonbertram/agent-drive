import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

type Result = { status: number | null; stdout: string; stderr: string };

function cliEnv(baseURL: string, root: string, name: string, machine: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AGENT_DRIVE_API_KEY;
  delete env.AGENT_DRIVE_KEY;
  return {
    ...env,
    AGENT_DRIVE_API_URL: `${baseURL}/api`,
    AGENT_DRIVE_CONFIG: join(root, `${name}.json`),
    AGENT_DRIVE_MACHINE: machine,
    CI: '1',
  };
}

function cli(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return startCli(args, env).done;
}

function startCli(args: string[], env: NodeJS.ProcessEnv) {
  const child: ChildProcess = spawn(
    process.execPath,
    [resolve('packages/agent-drive/dist/cli.js'), ...args],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const out = { stdout: '', stderr: '' };
  const waiters: (() => void)[] = [];
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    out.stdout += chunk;
    waiters.splice(0).forEach((wake) => wake());
  });
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
    out.stderr += chunk;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const done = new Promise<Result>((resolveResult, reject) => {
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolveResult({ status, ...out });
    });
  });
  // Resolves with the match once stdout contains the pattern.
  async function waitFor(pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = out.stdout.match(pattern);
      if (match) return match;
      await new Promise<void>((wake) => {
        waiters.push(wake);
        setTimeout(wake, 500);
      });
    }
  }
  return { child, done, waitFor, out };
}

async function startLogin(env: NodeJS.ProcessEnv, name: string) {
  const login = startCli(['login', '--name', name, '--no-browser'], env);
  const [, link] = await login.waitFor(/Open this link to approve: (\S+)/);
  const [, code] = await login.waitFor(/matches: ([A-Z]{4}-[A-Z]{4})/);
  // The server builds the link from its public origin; open it on the test server.
  const url = new URL(link!);
  return { login, code: code!, path: `${url.pathname}${url.search}` };
}

async function signIn(context: BrowserContext, userId: string) {
  const response = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId },
  });
  expect(response.status()).toBe(200);
}

test.describe('agent device login', () => {
  const userIds: string[] = [];
  let root: string;
  let database: Pool;

  test.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-drive-login-'));
    database = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  test.afterEach(async () => {
    const storage = new S3Client({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    for (const userId of userIds.splice(0)) {
      const accounts = await database.query<{ id: string }>(
        'SELECT id FROM accounts WHERE external_clerk_user_id=$1',
        [userId],
      );
      for (const { id } of accounts.rows) {
        for (const prefix of [`objects/${id}/`, `staging/${id}/`]) {
          let continuation: string | undefined;
          do {
            const objects = await storage.send(
              new ListObjectsV2Command({
                Bucket: process.env.S3_BUCKET,
                Prefix: prefix,
                ContinuationToken: continuation,
              }),
            );
            for (const object of objects.Contents ?? [])
              await storage.send(
                new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key }),
              );
            continuation = objects.NextContinuationToken;
          } while (continuation);
        }
        await database.query('DELETE FROM audit_events WHERE account_id=$1', [id]);
        await database.query(
          'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
          [id],
        );
        await database.query('DELETE FROM upload_intents WHERE account_id=$1', [id]);
        await database.query(
          'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
          [id],
        );
        await database.query('DELETE FROM device_authorizations WHERE account_id=$1', [id]);
        await database.query('DELETE FROM accounts WHERE id=$1', [id]);
      }
    }
    storage.destroy();
    await database.end();
    await rm(root, { recursive: true, force: true });
  });

  async function newUser(context: BrowserContext) {
    const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
    userIds.push(userId);
    await signIn(context, userId);
    return userId;
  }

  async function approveNewDrive(page: Page, path: string, name: string, code: string) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: `Approve ${name}?` })).toBeVisible();
    await expect(page.locator('.connect-code')).toHaveText(code);
    await page.locator('select').selectOption({ label: 'Create a new drive for this agent' });
    await expect(page.getByLabel('Read files')).toBeChecked();
    await expect(page.getByLabel('Write files')).toBeChecked();
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
  }

  test('new drive: login, put/get, and incremental backup', async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const machine = `m-${randomBytes(3).toString('hex')}`;
    const env = cliEnv(baseURL!, root, 'trace', machine);
    const { login, code, path } = await startLogin(env, 'trace-bot');
    await approveNewDrive(page, path, 'trace-bot', code);
    const result = await login.done;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/adk_/);
    const config = JSON.parse(await readFile(env.AGENT_DRIVE_CONFIG!, 'utf8')) as {
      apiKey: string;
      driveKeys: Record<string, string>;
    };
    const [driveId, driveKey] = Object.entries(config.driveKeys)[0]!;
    expect(config.apiKey).toMatch(/^adk_/);
    expect(result.stdout + result.stderr).not.toContain(config.apiKey);
    expect(result.stdout + result.stderr).not.toContain(driveKey);

    // put / get round trip
    const original = Buffer.concat([Buffer.from(`LOGIN-${randomUUID()}\n`), randomBytes(1024)]);
    const local = join(root, 'hello.bin');
    await writeFile(local, original);
    const put = await cli(['put', local, '/notes/hello.bin', '--drive', driveId], env);
    expect(put.status, put.stderr).toBe(0);
    const back = join(root, 'hello.out');
    const get = await cli(['get', '/notes/hello.bin', '--drive', driveId, '--output', back], env);
    expect(get.status, get.stderr).toBe(0);
    expect((await readFile(back)).equals(original)).toBe(true);

    // backup
    const source = join(root, 'source');
    await mkdir(join(source, 'sub'), { recursive: true });
    await writeFile(join(source, 'a.txt'), 'alpha');
    await writeFile(join(source, 'b.txt'), 'beta');
    await writeFile(join(source, 'sub', 'c.txt'), 'gamma');
    const summary = async () => (await cli(['backup', source], env)).stdout.trim();
    const first = await cli(['backup', source], env);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain('backup uploaded=3 unchanged=0 failed=0');
    expect(await summary()).toBe('backup uploaded=0 unchanged=3 failed=0');
    await writeFile(join(source, 'b.txt'), 'beta changed');
    expect(await summary()).toBe('backup uploaded=1 unchanged=2 failed=0');
    const listing = await cli(['ls', '--drive', driveId, '--prefix', `/backups/${machine}`], env);
    expect(listing.status, listing.stderr).toBe(0);
    for (const file of ['a.txt', 'b.txt', 'sub/c.txt'])
      expect(listing.stdout).toContain(`/backups/${machine}/${file}`);
    expect(listing.stdout.split(`/backups/${machine}/`).length - 1).toBe(3);
  });

  test('existing drive: sealed drive key reaches the agent', async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await newUser(context);
    await page.goto('/console');
    await page.getByRole('button', { name: 'Create your first drive' }).click();
    await page.getByLabel('Drive name').fill('Sealed drive');
    await page.getByRole('button', { name: 'Create drive', exact: true }).click();
    const driveKey = await page.getByTestId('drive-key').inputValue();
    await page.getByLabel('I saved my drive key securely').check();
    await page.getByRole('button', { name: 'Continue to drive' }).click();
    const driveId = await page.getByTestId('drive-id').innerText();

    const env = cliEnv(baseURL!, root, 'sealed', 'sealed-box');
    const { login, code, path } = await startLogin(env, 'sealed-bot');
    await page.goto(path);
    await expect(page.locator('.connect-code')).toHaveText(code);
    await page.locator('select').selectOption({ label: 'Sealed drive' });
    await page.getByLabel(/^Drive key for Sealed drive/).fill(driveKey);
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
    const result = await login.done;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(driveKey);
    expect(result.stdout + result.stderr).not.toMatch(/adk_/);

    const config = JSON.parse(await readFile(env.AGENT_DRIVE_CONFIG!, 'utf8')) as {
      driveKeys: Record<string, string>;
    };
    expect(config.driveKeys[driveId]).toBe(driveKey);

    // The agent encrypts with the unsealed key, the console decrypts with the original key,
    // and the agent can read it back.
    const original = Buffer.concat([Buffer.from(`SEALED-${randomUUID()}\n`), randomBytes(1024)]);
    const local = join(root, 'sealed.bin');
    await writeFile(local, original);
    const put = await cli(['put', local, '/agent/sealed.bin', '--drive', driveId], env);
    expect(put.status, put.stderr).toBe(0);
    const back = join(root, 'sealed.out');
    const get = await cli(['get', '/agent/sealed.bin', '--drive', driveId, '--output', back], env);
    expect(get.status, get.stderr).toBe(0);
    expect((await readFile(back)).equals(original)).toBe(true);

    await page.goto('/console');
    await page.getByRole('button', { name: /^Files/ }).click();
    await page.getByRole('button', { name: 'Load drive key' }).click();
    await page.getByLabel('Drive key', { exact: true }).fill(driveKey);
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: '/agent/sealed.bin' });
    await expect(row).toBeVisible();
    const download = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await readFile((await (await download).path())!)).equals(original)).toBe(true);
  });

  test('deny: the agent stops with a denial message', async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await newUser(context);
    const env = cliEnv(baseURL!, root, 'denied', 'deny-box');
    const { login, path } = await startLogin(env, 'denied-bot');
    await page.goto(path);
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(page.getByText('Denied. The agent was not given access.')).toBeVisible();
    const result = await login.done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/denied/i);
    await expect(readFile(env.AGENT_DRIVE_CONFIG!)).rejects.toThrow();
  });

  test('signed out visitors are sent to sign-in', async ({ page }) => {
    await page.goto('/connect?code=BCDF-GHJK');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

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

  async function approve(page: Page, path: string, name: string, code: string, delegate = false) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: `Connect ${name}?` })).toBeVisible();
    await expect(page.locator('.connect-code')).toHaveText(code);
    // One click: no drive or key choices; one unchecked box for the delegate permission.
    await expect(page.locator('select, input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(1);
    await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
    if (delegate) await page.getByLabel('Let this agent add other agents to its drives').check();
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
  }

  type Config = { apiKey: string; driveKeys: Record<string, string> };
  const readConfig = async (env: NodeJS.ProcessEnv) =>
    JSON.parse(await readFile(env.AGENT_DRIVE_CONFIG!, 'utf8')) as Config;

  test('new drive: login, put/get, and incremental backup', async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const machine = `m-${randomBytes(3).toString('hex')}`;
    const env = cliEnv(baseURL!, root, 'trace', machine);
    const { login, code, path } = await startLogin(env, 'trace-bot');
    await approve(page, path, 'trace-bot', code);
    const result = await login.done;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/adk_/);
    const config = await readConfig(env);
    expect(Object.keys(config.driveKeys)).toHaveLength(1);
    const [driveId, driveKey] = Object.entries(config.driveKeys)[0]!;
    const unbacked = await cli(['check'], env);
    expect(unbacked.status).toBe(1);
    expect(unbacked.stderr).toContain('drive key not backed up');
    const exported = await cli(['credentials', 'export', '--to', join(root, 'bundle')], env);
    expect(exported.status, exported.stderr).toBe(0);
    expect(exported.stdout + exported.stderr).not.toMatch(/adk_|adcred1/);
    const check = await cli(['check'], env);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(`check ok drive=${driveId}`);
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

  test('new drive with delegate ticked: whoami lists delegate', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await newUser(context);
    const machine = `m-${randomBytes(3).toString('hex')}`;
    const env = cliEnv(baseURL!, root, 'delegate', machine);
    const { login, code, path } = await startLogin(env, 'delegate-bot');
    await approve(page, path, 'delegate-bot', code, true);
    const result = await login.done;
    expect(result.status, result.stderr).toBe(0);
    const who = await cli(['whoami'], env);
    expect(who.status, who.stderr).toBe(0);
    expect(who.stdout).toContain('delegate');
  });

  test('reconnect: second login reuses the drive and replaces the old key', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const machine = `m-${randomBytes(3).toString('hex')}`;
    const env = cliEnv(baseURL!, root, 'again', machine);

    const first = await startLogin(env, 'again-bot');
    await approve(page, first.path, 'again-bot', first.code);
    const firstResult = await first.login.done;
    expect(firstResult.status, firstResult.stderr).toBe(0);
    const before = await readConfig(env);
    const [driveId] = Object.keys(before.driveKeys);
    expect(Object.keys(before.driveKeys)).toHaveLength(1);

    const second = await startLogin(env, 'again-bot');
    await page.goto(second.path);
    await expect(page.getByText(/^Reconnects to: /)).toBeVisible();
    await expect(page.getByText('This agent gets its own encrypted drive')).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
    const secondResult = await second.login.done;
    expect(secondResult.status, secondResult.stderr).toBe(0);
    expect(secondResult.stdout + secondResult.stderr).not.toMatch(/adk_/);

    // Same drive and key, no new drive, new API key.
    const after = await readConfig(env);
    expect(after.driveKeys).toEqual(before.driveKeys);
    expect(after.apiKey).not.toBe(before.apiKey);
    const unbacked = await cli(['check'], env);
    expect(unbacked.status).toBe(1);
    expect(unbacked.stderr).toContain('drive key not backed up');
    const exported = await cli(['credentials', 'export', '--to', join(root, 'bundle')], env);
    expect(exported.status, exported.stderr).toBe(0);
    expect(exported.stdout + exported.stderr).not.toMatch(/adk_|adcred1/);
    const check = await cli(['check'], env);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(`check ok drive=${driveId}`);
    const count = await database.query<{ n: string }>(
      `SELECT count(*) AS n FROM drives WHERE account_id =
         (SELECT account_id FROM drives WHERE id=$1)`,
      [driveId],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);

    // The key from the first login was revoked when the second was issued.
    const stale = {
      ...cliEnv(baseURL!, root, 'stale', machine),
      AGENT_DRIVE_API_KEY: before.apiKey,
    };
    const old = await cli(['whoami'], stale);
    expect(old.status).not.toBe(0);
    const fresh = await cli(['whoami'], env);
    expect(fresh.status, fresh.stderr).toBe(0);
  });

  test('read-only agent: onboarding ends with check ok (read-only) without writing', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const writerEnv = cliEnv(baseURL!, root, 'writer', 'm-writer');
    const first = await startLogin(writerEnv, 'writer-bot');
    await approve(page, first.path, 'writer-bot', first.code);
    expect((await first.login.done).status).toBe(0);
    const [driveId, driveKey] = Object.entries((await readConfig(writerEnv)).driveKeys)[0]!;
    const local = join(root, 'seed.txt');
    await writeFile(local, 'seed');
    const put = await cli(['put', local, '/seed.txt', '--drive', driveId], writerEnv);
    expect(put.status, put.stderr).toBe(0);

    // The second agent is approved read-only on the same drive with an explicit approve body.
    const env = cliEnv(baseURL!, root, 'reader', 'm-reader');
    const second = await startLogin(env, 'reader-bot');
    const approved = await page.request.post(`/api/console/device/${second.code}/approve`, {
      headers: { origin: baseURL! },
      data: { driveIds: [driveId], scopes: ['read'] },
    });
    expect(approved.status()).toBe(200);
    // No sealed key was sent, so login saves the API key but reports no usable drive key.
    await second.login.done;
    const config = await readConfig(env);
    await writeFile(
      env.AGENT_DRIVE_CONFIG!,
      JSON.stringify({
        ...config,
        driveKeys: { [driveId]: driveKey },
        driveKeyOrigins: { [driveId]: new URL(baseURL!).origin },
      }),
    );
    const exported = await cli(['credentials', 'export', '--to', join(root, 'reader-bundle')], env);
    expect(exported.status, exported.stderr).toBe(0);

    const events = async () =>
      (await database.query('SELECT count(*)::int AS n FROM file_events')).rows[0].n as number;
    const before = await events();
    const check = await cli(['check'], env);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(`check ok drive=${driveId} (read-only)`);
    expect(await events()).toBe(before);
    const denied = await cli(['put', local, '/nope.txt', '--drive', driveId], env);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain('lacks the "write" scope');
  });

  test('second agent: add to an existing drive with a recovery file and a write folder; plaintext key never reaches the service', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'first', 'm-first');
    const first = await startLogin(envA, 'first-bot');
    await approve(page, first.path, 'first-bot', first.code);
    expect((await first.login.done).status).toBe(0);
    const configA = await readConfig(envA);
    const [driveId, driveKey] = Object.entries(configA.driveKeys)[0]!;
    const original = Buffer.from(`FIRST-${randomUUID()}\n`);
    const seed = join(root, 'seed.txt');
    await writeFile(seed, original);
    const put = await cli(['put', seed, '/notes/seed.txt', '--drive', driveId], envA);
    expect(put.status, put.stderr).toBe(0);

    const recovery = join(root, 'recovery.json');
    await writeFile(
      recovery,
      JSON.stringify({ format: 'agent-drive-key-v1', driveId, key: driveKey }),
    );
    const wrong = join(root, 'wrong.json');
    await writeFile(wrong, JSON.stringify({ driveId: randomUUID(), key: driveKey }));

    const envB = cliEnv(baseURL!, root, 'second', 'm-second');
    const second = await startLogin(envB, 'second-bot');
    await page.goto(second.path);
    await expect(page.locator('select')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to an existing drive instead' }).click();
    await expect(page.getByText('Agent Drive never sees it.')).toBeVisible();
    await page.locator('select').selectOption(driveId);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/approve')) posts.push(r.postData() ?? '');
    });

    // A recovery file for another drive is rejected in the browser and nothing is posted.
    await page.locator('input[type="file"]').setInputFiles(wrong);
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(
      page.getByText('This recovery file does not belong to the selected drive.'),
    ).toBeVisible();
    expect(posts).toHaveLength(0);

    await page.locator('input[type="file"]').setInputFiles(recovery);
    await page.getByPlaceholder('/inbox/x').fill('/inbox/b');
    const approveRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/console\/device\/[^/]+\/approve$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Approve agent' }).click();
    const sent = (await approveRequest).postData() ?? '';
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
    expect(sent).toContain('sealedDriveKeys');
    expect(sent).not.toContain(driveKey);
    expect(sent).not.toContain(configA.apiKey);
    expect(JSON.parse(sent).writePaths).toEqual(['/inbox/b']);

    const result = await second.login.done;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Writes limited to: /inbox/b');
    const configB = await readConfig(envB);
    const output = (r: Result) => r.stdout + r.stderr;
    const secrets = [driveKey, configA.apiKey, configB.apiKey];
    const noSecrets = (text: string) => secrets.forEach((s) => expect(text).not.toContain(s));
    noSecrets(output(result));

    const back = join(root, 'seed.out');
    const get = await cli(['get', '/notes/seed.txt', '--drive', driveId, '--output', back], envB);
    expect(get.status, get.stderr).toBe(0);
    expect((await readFile(back)).equals(original)).toBe(true);
    const denied = await cli(['put', seed, '/notes/x.md', '--drive', driveId], envB);
    expect(denied.status).not.toBe(0);
    expect(output(denied)).toMatch(/403|only write under/);
    const allowed = await cli(['put', seed, '/inbox/b/hello.md', '--drive', driveId], envB);
    expect(allowed.status, allowed.stderr).toBe(0);
    const exported = await cli(['credentials', 'export', '--to', join(root, 'b-bundle')], envB);
    expect(exported.status, exported.stderr).toBe(0);
    const check = await cli(['check'], envB);
    expect(check.status, check.stderr).toBe(0);
    for (const r of [get, denied, allowed, exported, check]) noSecrets(output(r));

    const rows = await database.query(
      'SELECT row_to_json(d)::text AS t FROM device_authorizations d WHERE account_id = (SELECT account_id FROM drives WHERE id=$1)',
      [driveId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) noSecrets(row.t as string);
    const count = await database.query<{ n: string }>(
      'SELECT count(*) AS n FROM drives WHERE account_id = (SELECT account_id FROM drives WHERE id=$1)',
      [driveId],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
  });

  test('second agent: credentials bundle file and Read only give a read-only key; the bundle token never reaches the service', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'bfirst', 'm-bfirst');
    const first = await startLogin(envA, 'bfirst-bot');
    await approve(page, first.path, 'bfirst-bot', first.code);
    expect((await first.login.done).status).toBe(0);
    const configA = await readConfig(envA);
    const [driveId, driveKey] = Object.entries(configA.driveKeys)[0]!;
    const bundle = join(root, 'bundle-file');
    const exported = await cli(['credentials', 'export', '--to', bundle], envA);
    expect(exported.status, exported.stderr).toBe(0);

    const envB = cliEnv(baseURL!, root, 'bsecond', 'm-bsecond');
    const second = await startLogin(envB, 'bsecond-bot');
    await page.goto(second.path);
    await page.getByRole('button', { name: 'Add to an existing drive instead' }).click();
    await page.locator('select').selectOption(driveId);
    await page.locator('input[type="file"]').setInputFiles(bundle);
    await page.getByLabel('Read only').check();
    const approveRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/console\/device\/[^/]+\/approve$/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Approve agent' }).click();
    const sent = (await approveRequest).postData() ?? '';
    await expect(
      page.getByText('Approved. Return to your agent; it will finish setup'),
    ).toBeVisible();
    expect(sent).toContain('sealedDriveKeys');
    expect(sent).not.toContain(driveKey);
    expect(sent).not.toContain(configA.apiKey);
    expect(JSON.parse(sent).scopes).toEqual(['read']);
    const result = await second.login.done;
    expect(result.status, result.stderr).toBe(0);
    const configB = await readConfig(envB);
    expect(configB.driveKeys[driveId]).toBe(driveKey);
    const who = await cli(['whoami'], envB);
    expect(who.status, who.stderr).toBe(0);
    expect(JSON.parse(who.stdout).scopes).toEqual(['read']);
    const local = join(root, 'x.txt');
    await writeFile(local, 'x');
    const denied = await cli(['put', local, '/x.txt', '--drive', driveId], envB);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain('lacks the "write" scope');
  });

  test('no Deny button; the deny API still stops the agent', async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await newUser(context);
    const env = cliEnv(baseURL!, root, 'denied', 'deny-box');
    const { login, path, code } = await startLogin(env, 'denied-bot');
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve agent' })).toBeVisible();
    // The server-side deny endpoint still works for other clients.
    const denied = await page.request.post(`/api/console/device/${encodeURIComponent(code)}/deny`, {
      data: {},
      headers: { Origin: new URL(baseURL!).origin },
    });
    expect(denied.status(), await denied.text()).toBe(200);
    const result = await login.done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/denied/i);
    await expect(readFile(env.AGENT_DRIVE_CONFIG!)).rejects.toThrow();
  });

  test('connect card presentation: banner, note, account, login command', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await newUser(context);
    await page.goto('/connect?code=BCDF-GHJK');
    const missing = page.locator('.banner.info');
    await expect(missing).toBeVisible();
    const login = missing.locator('code', { hasText: 'agent-drive login' });
    await expect(login).toHaveCSS('white-space', 'nowrap');
    await expect(missing).toHaveCSS('font-size', '13px');
    const env = cliEnv(baseURL!, root, 'style', 'style-box');
    const { login: cliLogin, path } = await startLogin(env, 'style-bot');
    await page.goto(path);
    await expect(page.locator('p.banner.info')).toHaveCSS('font-size', '13px');
    await expect(page.locator('.connect-note')).toHaveCSS('margin-top', '16px');
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
    await expect(page.locator('.connect-facts dt', { hasText: 'Account' })).toBeVisible();
    await expect(page.locator('.connect-facts')).toContainText('Local test session');
    // Nothing approves it, so the request stays pending; stop the CLI.
    cliLogin.child.kill();
  });

  test('signed out visitors are sent to sign-in', async ({ page }) => {
    await page.goto('/connect?code=BCDF-GHJK');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

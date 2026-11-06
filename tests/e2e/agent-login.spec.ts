import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
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

/**
 * A loopback HTTP proxy that records every request (method, path, body) and forwards it to
 * `target`. Point a CLI at `url` with AGENT_DRIVE_API_URL to assert what it sends. Shared by
 * the specs that check secrets never leave the machine.
 */
async function startCaptureProxy(target: string) {
  const requests: { method: string; path: string; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        requests.push({ method: req.method!, path: req.url!, body: body.toString('utf8') });
        const headers = { ...req.headers } as Record<string, string>;
        delete headers.host;
        delete headers['content-length'];
        try {
          const upstream = await fetch(`${target}${req.url}`, {
            method: req.method!,
            headers,
            ...(body.length ? { body } : {}),
            redirect: 'manual',
          });
          res.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') ?? 'application/json',
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch {
          res.writeHead(502).end();
        }
      })();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
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
    if (delegate) {
      await page.getByText('Optional: let this agent connect other agents').click();
      await page.getByLabel('Let this agent add other agents to its drives').check();
    }
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
  }

  // Records every browser request (URL, headers, body) so tests can prove secrets never left it.
  function recordRequests(page: Page) {
    const seen: string[] = [];
    page.on('request', (r) => {
      seen.push(`${r.method()} ${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ''}`);
    });
    return async (secrets: string[]) => {
      const storage = await page.evaluate(() =>
        JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
      );
      expect(seen.length).toBeGreaterThan(0);
      for (const secret of secrets) {
        for (const text of [...seen, storage]) expect(text).not.toContain(secret);
      }
    };
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

  test('sandbox handoff: credentials issue gives a second agent its own narrower key', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'issuer', `m-${randomBytes(3).toString('hex')}`);
    const { login, code, path } = await startLogin(envA, 'issuer-bot');
    await approve(page, path, 'issuer-bot', code, true);
    expect((await login.done).status).toBe(0);
    const configA = await readConfig(envA);
    const [driveId, driveKey] = Object.entries(configA.driveKeys)[0]!;
    const secret = `FIRST-${randomUUID()}`;
    const local = join(root, 'x.txt');
    await writeFile(local, secret);
    expect((await cli(['put', local, '/notes/x', '--drive', driveId], envA)).status).toBe(0);

    // Issue through a capturing proxy; the issuer's own config is untouched.
    const proxy = await startCaptureProxy(baseURL!);
    const issued = await cli(
      // --drive: the proxy is another origin, so the saved key is not a default for it.
      [
        'credentials',
        'issue',
        '--name',
        'sandbox-b',
        '--drive',
        driveId,
        '--write-path',
        '/outputs',
        '--stdout',
      ],
      { ...envA, AGENT_DRIVE_API_URL: `${proxy.url}/api` },
    );
    await proxy.close();
    expect(issued.status, issued.stderr).toBe(0);
    expect(issued.stdout.trim().split('\n')).toHaveLength(1);
    const line = issued.stdout.trim();
    expect(line.startsWith('AGENT_DRIVE_CREDENTIALS=adcred1.')).toBe(true);
    const bundle = JSON.parse(
      Buffer.from(line.slice('AGENT_DRIVE_CREDENTIALS=adcred1.'.length), 'base64url').toString(),
    ) as { v: number; apiKey: string; driveKeys: Record<string, string>; apiUrl: string };
    expect(bundle.v).toBe(1);
    expect(bundle.apiUrl).toBe(`${proxy.url}/api`);
    expect(bundle.apiKey).toMatch(/^adk_/);
    expect(bundle.apiKey).not.toBe(configA.apiKey);
    expect(Object.keys(bundle.driveKeys)).toEqual([driveId]);
    expect(issued.stderr).not.toContain(bundle.apiKey);
    expect(issued.stderr).not.toContain(driveKey);
    const keyPost = proxy.requests.find((r) => r.method === 'POST' && r.path.endsWith('/keys'))!;
    expect(keyPost.body).toContain('"agentName":"sandbox-b"');
    for (const r of proxy.requests) expect(r.body).not.toContain(driveKey);
    for (const text of [line, issued.stderr, ...proxy.requests.map((r) => r.body)])
      expect(text).not.toContain(configA.apiKey);
    expect(await readConfig(envA)).toEqual(configA);

    // A fresh CLI with only the env line.
    const envB = {
      ...cliEnv(baseURL!, root, 'sandbox', 'm-sandbox'),
      // The issuer ran through the proxy, so the line names the proxy URL; point it at the real
      // server, as a real issuer's line would already do.
      AGENT_DRIVE_CREDENTIALS:
        'adcred1.' +
        Buffer.from(JSON.stringify({ ...bundle, apiUrl: `${baseURL}/api` })).toString('base64url'),
    };
    const who = JSON.parse((await cli(['whoami'], envB)).stdout) as {
      agentId: string;
      scopes: string[];
      writePaths: string[];
    };
    const whoA = JSON.parse((await cli(['whoami'], envA)).stdout) as { agentId: string };
    expect(who.agentId).not.toBe(whoA.agentId);
    expect(who.scopes).toEqual(['read', 'write']);
    expect(who.writePaths).toEqual(['/outputs']);
    const out = join(root, 'x.out');
    const got = await cli(['get', '/notes/x', '--drive', driveId, '--output', out], envB);
    expect(got.status, got.stderr).toBe(0);
    expect(await readFile(out, 'utf8')).toBe(secret);
    expect(
      (await cli(['put', local, '/notes/x', '--drive', driveId, '--overwrite'], envB)).status,
    ).not.toBe(0);
    const forbidden = await cli(['put', local, '/notes/y', '--drive', driveId], envB);
    expect(forbidden.status).not.toBe(0);
    expect(forbidden.stderr).toContain('/outputs');
    expect((await cli(['put', local, '/outputs/x', '--drive', driveId], envB)).status).toBe(0);
    const check = await cli(['check'], envB);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(`check ok drive=${driveId}`);

    // The console shows provenance; revoking the issued key cuts only B.
    await page.goto('/console');
    await page.getByRole('button', { name: 'Agents' }).click();
    await expect(page.getByText('issued by issuer-bot')).toBeVisible({ timeout: 30_000 });
    const keys = (await (await page.request.get('/api/console/keys')).json()) as {
      items: { id: string; agent_id: string; issued_by_agent_id: string | null }[];
    };
    const issuedKey = keys.items.find((k) => k.issued_by_agent_id)!;
    expect(issuedKey.agent_id).toBe(who.agentId);
    const revoked = await page.request.delete(`/api/console/keys/${issuedKey.id}`, {
      headers: { origin: baseURL! },
    });
    expect(revoked.status()).toBe(200);
    expect((await cli(['whoami'], envB)).status).not.toBe(0);
    expect((await cli(['whoami'], envA)).status).toBe(0);
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
    await expect(page.getByText('It reconnects to the drive it used before')).toBeVisible();
    await expect(page.getByText('This agent gets its own encrypted drive')).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
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
    const assertPrivate = recordRequests(page);
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
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
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
    await assertPrivate(secrets);

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
    const assertPrivate = recordRequests(page);
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
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
    expect(sent).toContain('sealedDriveKeys');
    expect(sent).not.toContain(driveKey);
    expect(sent).not.toContain(configA.apiKey);
    expect(JSON.parse(sent).scopes).toEqual(['read']);
    const result = await second.login.done;
    expect(result.status, result.stderr).toBe(0);
    const configB = await readConfig(envB);
    expect(configB.driveKeys[driveId]).toBe(driveKey);
    const bundleText = (await readFile(bundle, 'utf8')).trim();
    await assertPrivate([
      driveKey,
      configA.apiKey,
      configB.apiKey,
      bundleText,
      bundleText.slice('adcred1.'.length),
    ]);
    const who = await cli(['whoami'], envB);
    expect(who.status, who.stderr).toBe(0);
    expect(JSON.parse(who.stdout).scopes).toEqual(['read']);
    const local = join(root, 'x.txt');
    await writeFile(local, 'x');
    const denied = await cli(['put', local, '/x.txt', '--drive', driveId], envB);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain('lacks the "write" scope');
  });

  test('second agent form: switching drives or leaving clears the key; a rejected approve keeps the file; reconnects get no form', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await newUser(context);
    const keys: { id: string; key: string }[] = [];
    for (const name of ['one', 'two']) {
      const env = cliEnv(baseURL!, root, `h-${name}`, `m-h-${name}`);
      const login = await startLogin(env, `h-${name}-bot`);
      await approve(page, login.path, `h-${name}-bot`, login.code);
      expect((await login.login.done).status).toBe(0);
      const [id, key] = Object.entries((await readConfig(env)).driveKeys)[0]!;
      keys.push({ id, key });
    }
    const [one, two] = keys as [(typeof keys)[0], (typeof keys)[0]];
    const recovery = join(root, 'h-recovery.json');
    await writeFile(recovery, JSON.stringify({ driveId: one.id, key: one.key }));

    const env = cliEnv(baseURL!, root, 'h-third', 'm-h-third');
    const third = await startLogin(env, 'h-third-bot');
    await page.goto(third.path);
    const open = page.getByRole('button', { name: 'Add to an existing drive instead' });
    await open.click();
    const password = page.locator('input[type="password"]');
    const file = page.locator('input[type="file"]');
    const fileCount = () => file.evaluate((el: HTMLInputElement) => el.files!.length);

    // Switching the drive forgets a pasted key and a chosen file.
    await page.locator('select').selectOption(one.id);
    await password.fill(one.key);
    await file.setInputFiles(recovery);
    await page.locator('select').selectOption(two.id);
    await expect(password).toHaveValue('');
    expect(await fileCount()).toBe(0);

    // Leaving the form forgets them too.
    await password.fill(one.key);
    await page.getByRole('button', { name: 'Use a new drive instead' }).click();
    await open.click();
    await expect(password).toHaveValue('');

    // A server rejection keeps the chosen file, so a corrected retry works.
    await page.locator('select').selectOption(one.id);
    await file.setInputFiles(recovery);
    await page.getByPlaceholder('/inbox/x').fill('/inbox/b/');
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await fileCount()).toBe(1);
    await page.getByPlaceholder('/inbox/x').fill('/inbox/b');
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
    expect((await third.login.done).status).toBe(0);
  });

  test('reconnect with no known drives shows no add-to-existing-drive option', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const env = cliEnv(baseURL!, root, 'lost', 'm-lost');
    const first = await startLogin(env, 'lost-bot');
    await approve(page, first.path, 'lost-bot', first.code);
    expect((await first.login.done).status).toBe(0);
    // The agent lost its drive key but still has its API key: a reconnect with no known drives.
    const config = await readConfig(env);
    await writeFile(env.AGENT_DRIVE_CONFIG!, JSON.stringify({ ...config, driveKeys: {} }));
    const again = await startLogin(env, 'lost-bot');
    await page.goto(again.path);
    await expect(page.getByRole('heading', { name: 'Connect lost-bot?' })).toBeVisible();
    await expect(page.getByText(/keeps its previous permissions/)).toBeVisible();
    await expect(page.locator('.connect-facts')).toContainText('New encrypted drive');
    await expect(page.getByText('This agent gets its own encrypted drive')).toBeVisible();
    await expect(page.getByText('reconnects to the drive it used before')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Add to an existing drive instead' }),
    ).toHaveCount(0);
    again.login.child.kill();
  });

  test('grant: the first agent seals the key for a second login and the human approves the offer it saw', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'granter', `m-${randomBytes(3).toString('hex')}`);
    // Unique per run: the offers query below counts rows by agent name in a shared database.
    const granter = `granter-${Date.now().toString(36)}`;
    const a = await startLogin(envA, granter);
    await approve(page, a.path, granter, a.code, true);
    expect((await a.login.done).status).toBe(0);
    const configA = await readConfig(envA);
    const [driveId, driveKey] = Object.entries(configA.driveKeys)[0]!;
    const secret = `FIRST-${randomUUID()}`;
    const local = join(root, 'x.txt');
    await writeFile(local, secret);
    expect((await cli(['put', local, '/notes/x', '--drive', driveId], envA)).status).toBe(0);

    const envB = cliEnv(baseURL!, root, 'grantee', 'm-grantee');
    const b = await startLogin(envB, 'grantee-bot');
    const proxy = await startCaptureProxy(baseURL!);
    // grant offers only a key saved for the API origin in use; record the proxy as that origin.
    const savedA = JSON.parse(await readFile(envA.AGENT_DRIVE_CONFIG!, 'utf8')) as {
      driveKeyOrigins: Record<string, string>;
    };
    savedA.driveKeyOrigins[driveId!] = proxy.url;
    await writeFile(envA.AGENT_DRIVE_CONFIG!, JSON.stringify(savedA));
    const granted = await cli(['grant', b.code, '--write-path', '/inbox/b'], {
      ...envA,
      AGENT_DRIVE_API_URL: `${proxy.url}/api`,
    });
    await proxy.close();
    expect(granted.status, granted.stderr).toBe(0);
    expect(granted.stdout).toContain('Request from grantee-bot on m-grantee');
    expect(granted.stdout).toContain(
      `Offered drive ${driveId} to grantee-bot (read write; writes under /inbox/b)`,
    );
    expect(granted.stdout).toContain(`/connect?code=${b.code}`);

    // The human sees who offered what, and approves once.
    await page.goto(b.path);
    await expect(page.locator('.connect-facts')).toContainText('Offered by');
    await expect(page.locator('.connect-facts')).toContainText(granter);
    await expect(page.locator('.connect-facts')).toContainText('/inbox/b');
    await expect(
      page.getByRole('button', { name: 'Add to an existing drive instead' }),
    ).toHaveCount(0);
    await mkdir('docs/design/shots/spec-connect-share', { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `docs/design/shots/spec-connect-share/offer-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
    const resultB = await b.login.done;
    expect(resultB.status, resultB.stderr).toBe(0);

    const out = join(root, 'x.out');
    const got = await cli(['get', '/notes/x', '--drive', driveId, '--output', out], envB);
    expect(got.status, got.stderr).toBe(0);
    expect(await readFile(out, 'utf8')).toBe(secret);
    const denied = await cli(['put', local, '/notes/y', '--drive', driveId], envB);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain('/inbox/b');
    expect((await cli(['put', local, '/inbox/b/x', '--drive', driveId], envB)).status).toBe(0);
    expect(await cli(['whoami'], envB)).toMatchObject({ status: 0 });

    // The drive key and the granter's token never left the machine, appeared in output, or reached the DB.
    const grantPost = proxy.requests.find((r) => r.path.endsWith('/grant'))!;
    expect(grantPost.body).toContain('sealedDriveKey');
    for (const text of [
      ...proxy.requests.map((r) => r.body),
      granted.stdout,
      granted.stderr,
      resultB.stdout,
      resultB.stderr,
    ]) {
      expect(text).not.toContain(driveKey);
      expect(text).not.toContain(configA.apiKey);
    }
    const stored = await database.query<{ row: string }>(
      'SELECT o.sealed_key::text || o.scopes::text AS row FROM device_offers o JOIN agents g ON g.id = o.offered_by_agent_id WHERE g.name = $1',
      [granter],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.row).not.toContain(driveKey);
    const configB = await readConfig(envB);
    expect(configB.driveKeys[driveId]).toBe(driveKey);
    expect(resultB.stdout + resultB.stderr).not.toContain(configB.apiKey);
  });

  test('grant: a page loaded before the offer gets a 409 notice, reloads, and approves the offer', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'granter2', `m-${randomBytes(3).toString('hex')}`);
    const a = await startLogin(envA, 'granter2-bot');
    await approve(page, a.path, 'granter2-bot', a.code, true);
    expect((await a.login.done).status).toBe(0);
    const [driveId] = Object.keys((await readConfig(envA)).driveKeys);

    const envB = cliEnv(baseURL!, root, 'grantee2', 'm-grantee2');
    const b = await startLogin(envB, 'grantee2-bot');
    await page.goto(b.path);
    await expect(page.getByText('This agent gets its own encrypted drive')).toBeVisible();
    const granted = await cli(['grant', b.code, '--read-only'], envA);
    expect(granted.status, granted.stderr).toBe(0);
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('The request changed; review it again.')).toBeVisible();
    await expect(page.locator('.connect-facts')).toContainText('granter2-bot');
    await expect(page.locator('.connect-facts')).toContainText('No writes');
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
    await expect(page.getByText(/can now read the drive/)).toBeVisible();
    const resultB = await b.login.done;
    expect(resultB.status, resultB.stderr).toBe(0);
    const who = JSON.parse((await cli(['whoami'], envB)).stdout) as {
      scopes: string[];
      driveIds: string[];
    };
    expect(who.scopes).toEqual(['read']);
    expect(who.driveIds).toEqual([driveId]);
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
    const missing = page.locator('.banner.error');
    await expect(missing).toBeVisible();
    const login = missing.locator('code', { hasText: 'agent-drive login' });
    await expect(login).toHaveCSS('white-space', 'nowrap');
    await expect(missing).toHaveCSS('font-size', '13px');
    const env = cliEnv(baseURL!, root, 'style', 'style-box');
    const { login: cliLogin, path } = await startLogin(env, 'style-bot');
    await page.goto(path);
    await expect(page.locator('.connect-explain')).toHaveCSS('font-size', '13px');
    await expect(page.locator('.connect-note')).toHaveCSS('margin-top', '16px');
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
    await expect(page.locator('.connect-facts dt', { hasText: 'Account' })).toBeVisible();
    await expect(page.locator('.connect-facts')).toContainText('Local test session');
    // Nothing approves it, so the request stays pending; stop the CLI.
    cliLogin.child.kill();
  });

  test('review card puts the decision first and Approve in the first viewport', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await newUser(context);
    const env = cliEnv(baseURL!, root, 'first-vp', 'vp-box');
    const { login, path } = await startLogin(env, 'vp-bot');
    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Connect vp-bot?' })).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page.getByRole('button', { name: 'Approve agent' })).toBeInViewport({
        ratio: 1,
      });
      const size = (selector: string) =>
        page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(await size('h1')).toBeGreaterThan(await size('.connect-code'));
      await expect(page.locator('.connect-code-line + .connect-actions')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
      await expect(page.getByLabel('Let this agent add other agents to its drives')).toBeHidden();
    }
    await page
      .locator('summary', { hasText: 'Optional: let this agent connect other agents' })
      .click();
    await expect(page.getByLabel('Let this agent add other agents to its drives')).toBeVisible();
    login.child.kill();
  });

  test('existing-drive form fits, and a bad key error sits by the field', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'fit-a', 'm-fit-a');
    const first = await startLogin(envA, 'fit-a-bot');
    await approve(page, first.path, 'fit-a-bot', first.code);
    expect((await first.login.done).status).toBe(0);
    const envB = cliEnv(baseURL!, root, 'fit-b', 'm-fit-b');
    const second = await startLogin(envB, 'fit-b-bot');
    const approveButton = page.getByRole('button', { name: 'Approve agent' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(second.path);
    const branch = page.getByRole('button', { name: 'Add to an existing drive instead' });
    expect((await branch.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await branch.click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const card = await page.locator('.connect-card').boundingBox();
    expect(card!.height).toBeLessThanOrEqual(850);
    await expect(approveButton).toBeInViewport({ ratio: 1 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(approveButton).toBeInViewport({ ratio: 1 });
    await page.getByPlaceholder('/inbox/x').focus();
    await expect(approveButton).toBeInViewport({ ratio: 1 });

    // A bad pasted key is reported next to the key field in plain words.
    await page.locator('input[type="password"]').fill('not-a-key');
    await approveButton.click();
    const error = page.locator('#connect-key-error');
    await expect(error).toBeVisible();
    await expect(error).toBeInViewport();
    await expect(error).toContainText('This is not a valid drive key.');
    await expect(page.locator('input[type="password"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Invalid base64url')).toHaveCount(0);
    second.login.child.kill();
  });

  test('approved state links to the console', async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await newUser(context);
    const env = cliEnv(baseURL!, root, 'done-state', 'm-done');
    const { login, path, code } = await startLogin(env, 'done-bot');
    await approve(page, path, 'done-bot', code);
    await expect(page.getByRole('heading', { name: 'done-bot is connected' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open console' })).toHaveAttribute(
      'href',
      '/console',
    );
    await expect(page.getByText('Approved')).toHaveCount(0);
    expect((await login.done).status).toBe(0);
  });

  test('an offer shows up when the user returns to the page', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await newUser(context);
    const envA = cliEnv(baseURL!, root, 'focus-a', `m-${randomBytes(3).toString('hex')}`);
    const a = await startLogin(envA, 'focus-a-bot');
    await approve(page, a.path, 'focus-a-bot', a.code, true);
    expect((await a.login.done).status).toBe(0);
    const [driveId] = Object.keys((await readConfig(envA)).driveKeys);

    const envB = cliEnv(baseURL!, root, 'focus-b', 'm-focus-b');
    const b = await startLogin(envB, 'focus-b-bot');
    await page.goto(b.path);
    await expect(page.getByText('This agent gets its own encrypted drive')).toBeVisible();
    const granted = await cli(['grant', b.code, '--read-only'], envA);
    expect(granted.status, granted.stderr).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('offered a drive for this login')).toBeVisible();
    await expect(page.locator('.connect-facts')).toContainText('Offered by');
    await expect(page.locator('.connect-facts')).toContainText('focus-a-bot');
    await page.getByRole('button', { name: 'Approve agent' }).click();
    await expect(page.getByText('Return to your agent; it will finish setup')).toBeVisible();
    expect((await b.login.done).status).toBe(0);
    const who = JSON.parse((await cli(['whoami'], envB)).stdout) as {
      scopes: string[];
      driveIds: string[];
    };
    expect(who.scopes).toEqual(['read']);
    expect(who.driveIds).toEqual([driveId]);
  });

  test('code entry formats and keeps the field still', async ({ page, context }) => {
    await newUser(context);
    await page.goto('/connect');
    const input = page.getByPlaceholder('XXXX-XXXX');
    await expect(input).toBeFocused();
    await page.keyboard.type('bcdfghjk');
    await expect(input).toHaveValue('BCDF-GHJK');
    const before = (await input.boundingBox())!.y;
    await page.getByRole('button', { name: 'Continue' }).click();
    const banner = page.locator('.banner.error[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', 'connect-code-error');
    expect((await input.boundingBox())!.y).toBe(before);
    await input.fill('');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter the code your agent printed.')).toBeVisible();
  });

  test('signed out visitors are sent to sign-in', async ({ page }) => {
    await page.goto('/connect?code=BCDF-GHJK');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

function cli(args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve('packages/agent-drive/dist/cli.js'), ...args], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      done({ status, stdout, stderr });
    });
  });
}

async function cleanupUser(userId: string) {
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  const storage = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  try {
    const result = await database.query<{ id: string }>(
      'SELECT id FROM accounts WHERE external_clerk_user_id=$1',
      [userId],
    );
    for (const { id } of result.rows) {
      for (const prefix of [`objects/${id}/`, `staging/${id}/`]) {
        const objects = await storage.send(
          new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix }),
        );
        for (const object of objects.Contents ?? [])
          await storage.send(
            new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key }),
          );
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
      await database.query('DELETE FROM accounts WHERE id=$1', [id]);
    }
  } finally {
    storage.destroy();
    await database.end();
  }
}

type Seeded = {
  userId: string;
  post: <T>(path: string, data: unknown) => Promise<T>;
  agentId: string;
};

// A signed-in account and one agent; drives and files are made per test.
async function seed(context: BrowserContext, baseURL: string): Promise<Seeded> {
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const login = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId },
  });
  expect(login.status()).toBe(200);
  const post = async <T>(path: string, data: unknown) =>
    (await (
      await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL } })
    ).json()) as T;
  const agent = await post<{ id: string }>('agents', { name: 'Seal agent' });
  return { userId, post, agentId: agent.id };
}

// The fingerprint a human would copy from the console (Settings): SHA-256 of the raw
// account public key, first 8 bytes, grouped — the independently sourced value that lets
// `account seal` pin this origin's account key.
async function accountFingerprint(context: BrowserContext) {
  const got = await context.request.get('/api/console/account-key');
  expect(got.status()).toBe(200);
  const { accountKey } = (await got.json()) as { accountKey?: { publicKey?: string } };
  expect(accountKey?.publicKey).toBeTruthy();
  const publicKey = accountKey!.publicKey!;
  return createHash('sha256')
    .update(Buffer.from(publicKey, 'base64url'))
    .digest('hex')
    .slice(0, 16)
    .match(/.{4}/g)!
    .join(' ');
}

const nameButton = (page: Page, name: string) =>
  page.getByTitle(`Preview ${name}`, { exact: true });
const chip = (page: Page) => page.getByTestId('key-chip');
const openMenu = async (page: Page) => {
  if (!(await page.getByTestId('key-menu').isVisible())) await chip(page).click();
  return page.getByTestId('key-menu');
};

// A config file that makes the CLI "hold" drive keys, like an agent's own machine would.
async function heldKeysConfig(
  root: string,
  baseURL: string,
  token: string,
  keys: Record<string, string>,
) {
  const configPath = join(root, `config-${randomUUID()}.json`);
  const origin = new URL(baseURL).origin;
  await writeFile(
    configPath,
    JSON.stringify({
      apiUrl: baseURL,
      apiKey: token,
      driveKeys: keys,
      driveKeyOrigins: Object.fromEntries(Object.keys(keys).map((id) => [id, origin])),
    }),
    { mode: 0o600 },
  );
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_DRIVE_CONFIG: configPath,
    AGENT_DRIVE_API_URL: baseURL,
    AGENT_DRIVE_API_KEY: token,
  };
  return { configPath, environment };
}

// Sets up passphrase unlock through the console UI: load drive A's recovery file, then create.
async function setUpPassphrase(
  page: Page,
  drive: { id: string; key: string },
  file: string,
  sentinel: string,
) {
  await page.goto(`/console?drive=${drive.id}`);
  await nameButton(page, file).click();
  await page.getByLabel('Choose recovery file').setInputFiles({
    name: 'recovery.key.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: drive.key }),
    ),
  });
  await expect(page.getByRole('dialog', { name: file })).toContainText(sentinel);
  await page.keyboard.press('Escape');
  await (await openMenu(page)).getByRole('button', { name: 'Set up passphrase unlock' }).click();
  await page.getByLabel('I saved it').check();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Passphrase set up. 1 drive added to your account.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(chip(page)).toContainText('Unlocked');
}

test('agent account seal posts held drive keys and the console opens them with no prompt', async ({
  page,
  context,
  baseURL,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-seal-'));
  let userId = '';
  try {
    const seeded = await seed(context, baseURL!);
    userId = seeded.userId;
    const a = await seeded.post<{ id: string }>('drives', { name: 'Sealed drive A' });
    const b = await seeded.post<{ id: string }>('drives', { name: 'Sealed drive B' });
    const apiKey = await seeded.post<{ token: string }>('keys', {
      label: 'Seal key',
      agentId: seeded.agentId,
      driveIds: [a.id, b.id],
      scopes: ['read', 'write'],
    });
    const keys = {
      a: randomBytes(32).toString('base64url'),
      b: randomBytes(32).toString('base64url'),
    };
    const sentinel = `SEAL-${randomUUID()}`;
    const upload = async (driveId: string, key: string, name: string, text: string) => {
      await writeFile(join(root, name), text, { mode: 0o600 });
      const result = await cli(['put', join(root, name), `/${name}`, '--drive', driveId], {
        ...process.env,
        AGENT_DRIVE_API_URL: baseURL,
        AGENT_DRIVE_API_KEY: apiKey.token,
        AGENT_DRIVE_KEY: key,
        AGENT_DRIVE_CONFIG: join(root, `put-${driveId}.json`),
      });
      expect(result.status, result.stderr).toBe(0);
    };
    await upload(a.id, keys.a, 'note.txt', `NOTE ${sentinel}\n`);
    await upload(b.id, keys.b, 'other.txt', `OTHER ${sentinel}\n`);

    // The owner sets a passphrase after drive B already existed — its key is only on the agent.
    await setUpPassphrase(page, { id: a.id, key: keys.a }, 'note.txt', `NOTE ${sentinel}`);

    // The next agent run seals every held key: A (already sealed by setup) and B (new).
    const { environment } = await heldKeysConfig(root, baseURL!, apiKey.token, {
      [a.id]: keys.a,
      [b.id]: keys.b,
    });
    environment.AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT = await accountFingerprint(context);
    const first = await cli(['account', 'seal'], environment);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(`${a.id}: already sealed`);
    expect(first.stdout).toContain(`${b.id}: sealed`);
    const second = await cli(['account', 'seal'], environment);
    expect(second.stdout).toContain(`${b.id}: already sealed`);

    // The persisted browser key unlocks the vault; B's auto-sealed slot opens its file.
    await page.goto(`/console?drive=${b.id}`);
    await expect(chip(page)).toContainText('Unlocked');
    await nameButton(page, 'other.txt').click();
    await expect(page.getByRole('dialog', { name: 'other.txt' })).toContainText(
      `OTHER ${sentinel}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    if (userId) await cleanupUser(userId);
  }
});

test('an agent-only drive is never sealed and asks for a recovery file in the console', async ({
  page,
  context,
  baseURL,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-only-'));
  let userId = '';
  try {
    const seeded = await seed(context, baseURL!);
    userId = seeded.userId;
    const a = await seeded.post<{ id: string }>('drives', { name: 'Passphrase drive' });
    const c = await seeded.post<{ id: string }>('drives', {
      name: 'Agent-only drive',
      agentOnly: true,
    });
    const apiKey = await seeded.post<{ token: string }>('keys', {
      label: 'Seal key',
      agentId: seeded.agentId,
      driveIds: [a.id, c.id],
      scopes: ['read', 'write'],
    });
    const keys = {
      a: randomBytes(32).toString('base64url'),
      c: randomBytes(32).toString('base64url'),
    };
    const sentinel = `ONLY-${randomUUID()}`;
    const upload = async (driveId: string, key: string, name: string, text: string) => {
      await writeFile(join(root, name), text, { mode: 0o600 });
      const result = await cli(['put', join(root, name), `/${name}`, '--drive', driveId], {
        ...process.env,
        AGENT_DRIVE_API_URL: baseURL,
        AGENT_DRIVE_API_KEY: apiKey.token,
        AGENT_DRIVE_KEY: key,
        AGENT_DRIVE_CONFIG: join(root, `put-${driveId}.json`),
      });
      expect(result.status, result.stderr).toBe(0);
    };
    await upload(a.id, keys.a, 'note.txt', `NOTE ${sentinel}\n`);
    await upload(c.id, keys.c, 'secret.txt', `SECRET ${sentinel}\n`);

    await setUpPassphrase(page, { id: a.id, key: keys.a }, 'note.txt', `NOTE ${sentinel}`);

    // Sealing skips the agent-only drive even though the agent holds its key.
    const { environment } = await heldKeysConfig(root, baseURL!, apiKey.token, {
      [a.id]: keys.a,
      [c.id]: keys.c,
    });
    environment.AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT = await accountFingerprint(context);
    const seal = await cli(['account', 'seal'], environment);
    expect(seal.status, seal.stderr).toBe(0);
    expect(seal.stdout).toContain(`${c.id}: agent-only`);

    // The console opens the unlocked vault but still demands the recovery file for this drive.
    await page.goto(`/console?drive=${c.id}`);
    await expect(chip(page)).toContainText('Unlocked');
    await nameButton(page, 'secret.txt').click();
    const dialog = page.getByRole('dialog', { name: 'Load the key for Agent-only drive' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Agent-only: open with a recovery file.');
    await dialog.getByLabel('Choose recovery file').setInputFiles({
      name: 'recovery.key.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ format: 'agent-drive-key-v1', driveId: c.id, key: keys.c }),
      ),
    });
    await expect(page.getByRole('dialog', { name: 'secret.txt' })).toContainText(
      `SECRET ${sentinel}`,
    );

    // Loading the recovery file must not create an account-key slot for an agent-only drive.
    await page.reload();
    await expect(chip(page)).toContainText('Unlocked');
    await nameButton(page, 'secret.txt').click();
    await expect(
      page.getByRole('dialog', { name: 'Load the key for Agent-only drive' }),
    ).toContainText('Agent-only: open with a recovery file.');
  } finally {
    await rm(root, { recursive: true, force: true });
    if (userId) await cleanupUser(userId);
  }
});

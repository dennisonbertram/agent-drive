import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sealDriveKey } from '../../apps/web/src/device/seal';

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
  a: { id: string; key: string };
  b: { id: string; key: string };
  sentinel: string;
};

// Two drives with real encrypted files, written through the CLI. Only authentication is stubbed.
async function seed(context: BrowserContext, baseURL: string, root: string): Promise<Seeded> {
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
  const a = await post<{ id: string }>('drives', { name: 'Vault drive A' });
  const b = await post<{ id: string }>('drives', { name: 'Vault drive B' });
  const agent = await post<{ id: string }>('agents', { name: 'Vault agent' });
  const apiKey = await post<{ token: string }>('keys', {
    label: 'Vault key',
    agentId: agent.id,
    driveIds: [a.id, b.id],
    scopes: ['read', 'write'],
  });
  const keys = {
    a: randomBytes(32).toString('base64url'),
    b: randomBytes(32).toString('base64url'),
  };
  const sentinel = `SENTINEL-${randomUUID()}`;
  const upload = async (drive: { id: string }, key: string, name: string, text: string) => {
    await writeFile(join(root, name), text, { mode: 0o600 });
    const result = await cli(['put', join(root, name), `/${name}`, '--drive', drive.id], {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL,
      AGENT_DRIVE_API_KEY: apiKey.token,
      AGENT_DRIVE_KEY: key,
      AGENT_DRIVE_CONFIG: join(root, `config-${drive.id}.json`),
    });
    expect(result.status, result.stderr).toBe(0);
  };
  await upload(a, keys.a, 'note.txt', `NOTE ${sentinel}\n`);
  await upload(a, keys.a, 'second.txt', `SECOND ${sentinel}\n`);
  await upload(b, keys.b, 'other.txt', `OTHER ${sentinel}\n`);
  return { userId, a: { id: a.id, key: keys.a }, b: { id: b.id, key: keys.b }, sentinel };
}

const recoveryFile = (drive: { id: string; key: string }) => ({
  name: 'recovery.key.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: drive.key }),
  ),
});
const nameButton = (page: Page, name: string) =>
  page.getByTitle(`Preview ${name}`, { exact: true });
const chip = (page: Page) => page.getByTestId('key-chip');
const openMenu = async (page: Page) => {
  if (!(await page.getByTestId('key-menu').isVisible())) await chip(page).click();
  return page.getByTestId('key-menu');
};
// Two animation frames: the page has run the continuation of a response it just received.
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
const dialogPassphrase = (page: Page) => page.getByLabel('Passphrase', { exact: true });

// Loads drive A's key from its recovery file, then sets up a generated passphrase.
async function setUpPassphrase(page: Page, seeded: Seeded) {
  await page.goto(`/console?drive=${seeded.a.id}`);
  await nameButton(page, 'note.txt').click();
  await page.getByLabel('Choose recovery file').setInputFiles(recoveryFile(seeded.a));
  await expect(page.getByRole('dialog', { name: 'note.txt' })).toContainText(
    `NOTE ${seeded.sentinel}`,
  );
  await page.keyboard.press('Escape');
  await (await openMenu(page)).getByRole('button', { name: 'Set up passphrase unlock' }).click();
  const grouped = (await page.getByTestId('generated-passphrase').innerText()).trim();
  expect(grouped).toMatch(/^([0-9A-Z]{4} ){4}[0-9A-Z]{4}$/);
  await page.getByLabel('I saved it').check();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Passphrase set up. 1 drive added to your account.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(chip(page)).toContainText('Unlocked');
  return { grouped, raw: grouped.replaceAll(' ', '') };
}

async function withSeed(
  context: BrowserContext,
  baseURL: string,
  run: (seeded: Seeded, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-vault-'));
  let userId = '';
  try {
    const seeded = await seed(context, baseURL, root);
    userId = seeded.userId;
    await run(seeded, root);
  } finally {
    await rm(root, { recursive: true, force: true });
    if (userId) await cleanupUser(userId);
  }
}

test('passphrase setup, reload, unlock, preview and download without the recovery file', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const sent: string[] = [];
  const logged: string[] = [];
  page.on('request', (request) =>
    sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`),
  );
  page.on('console', (message) => logged.push(message.text()));
  page.on('pageerror', (error) => logged.push(String(error)));
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw, grouped } = await setUpPassphrase(page, seeded);
    await page.reload();
    await expect(chip(page)).toContainText('Locked');
    // Preview asks for the passphrase, and says what happens next.
    await nameButton(page, 'note.txt').click();
    await expect(page.getByText('After you unlock, note.txt opens.')).toBeVisible();
    // Typed the way people copy it: lower case, with dashes and spaces.
    await dialogPassphrase(page).fill(grouped.toLowerCase().replaceAll(' ', '- '));
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'note.txt' });
    await expect(preview.locator('pre.preview-text')).toHaveText(`NOTE ${seeded.sentinel}\n`);
    await expect(chip(page)).toContainText('Unlocked');
    await page.keyboard.press('Escape');
    // A second file opens without asking again, and downloads decrypt.
    const download = page.waitForEvent('download');
    await page
      .getByRole('row')
      .filter({ hasText: 'second.txt' })
      .getByRole('button', { name: 'Download', exact: true })
      .click();
    expect(await readFile((await (await download).path())!, 'utf8')).toBe(
      `SECOND ${seeded.sentinel}\n`,
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Share opens too.
    await page.getByRole('button', { name: 'More actions for note.txt' }).click();
    await page
      .locator('[data-testid="row-menu"]:visible')
      .getByRole('button', { name: 'Share' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Share note.txt' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Settings shows the status and a link back to Files, nothing else.
    await page.goto('/console/settings');
    await expect(page.getByTestId('passphrase-status')).toContainText(
      /Passphrase set up .*fingerprint [0-9a-f]{4}( [0-9a-f]{4}){3}, 1 drive added\./,
    );
    await expect(page.getByRole('link', { name: 'Manage in Files' })).toHaveAttribute(
      'href',
      '/console',
    );

    // Nothing is stored in the browser, and no secret left it.
    await page.goto(`/console?drive=${seeded.a.id}`);
    const stored = await page.evaluate(async () => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases: (await indexedDB.databases()).map((database) => database.name),
    }));
    expect(stored.session).toEqual([]);
    expect(stored.databases).toEqual([]);
    expect(stored.local.map(([name]) => name)).not.toContain(seeded.a.key);
    const everything = [...sent, ...logged, JSON.stringify(stored)];
    const secrets = [
      raw,
      grouped,
      raw.toLowerCase(),
      seeded.a.key,
      seeded.b.key,
      seeded.sentinel,
      'adcred1.',
    ];
    for (const secret of secrets)
      expect(
        everything.some((text) => text.includes(secret)),
        'a secret appeared in a request, URL, console message or storage',
      ).toBe(false);
    expect(logged.filter((text) => /error/i.test(text))).toEqual([]);
  });
});

test('a wrong passphrase is refused and nothing opens', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    await setUpPassphrase(page, seeded);
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill('this is not the passphrase');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'That passphrase is not correct.' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(chip(page)).toContainText('Locked');
  });
});

test('a drive without a slot: load its recovery file once, then the passphrase opens it', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await page.reload();
    // Drive B is not in the account yet.
    await page.goto(`/console?drive=${seeded.b.id}`);
    await nameButton(page, 'other.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(
      page.getByText('This drive isn’t in your account yet. Load its recovery file once'),
    ).toBeVisible();
    await page.getByLabel('Choose recovery file').setInputFiles(recoveryFile(seeded.b));
    await expect(page.getByRole('dialog', { name: 'other.txt' })).toContainText(
      `OTHER ${seeded.sentinel}`,
    );
    await expect(
      page.getByText('Added to your account. Next time your passphrase opens it.'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await nameButton(page, 'other.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'other.txt' })).toContainText(
      `OTHER ${seeded.sentinel}`,
    );
  });
});

test('change passphrase: the old one stops working, the new one works; reset removes the vault', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await (await openMenu(page)).getByRole('button', { name: 'Change passphrase' }).click();
    await page.getByLabel('Current passphrase').fill(raw);
    await page.getByRole('button', { name: 'Use my own passphrase' }).click();
    // The weak-pattern check explains itself.
    await page.getByLabel('New passphrase (at least 14 characters)').fill('aaaaaaaaaaaaaaaa');
    await page.getByLabel('Type it again').fill('aaaaaaaaaaaaaaaa');
    await page.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'too easy to guess' })).toBeVisible();
    const next = 'purple-giraffe-cinnamon-77';
    await page.getByLabel('New passphrase (at least 14 characters)').fill(next);
    await page.getByLabel('Type it again').fill(`${next}x`);
    await page.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'don’t match' })).toBeVisible();
    await page.getByLabel('Type it again').fill(next);
    await page.getByRole('button', { name: 'Change passphrase', exact: true }).click();
    await expect(page.getByText('Passphrase changed. Use the new one from now on.')).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'That passphrase is not correct.' }),
    ).toBeVisible();
    await dialogPassphrase(page).fill(next);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toContainText(
      `NOTE ${seeded.sentinel}`,
    );
    await page.keyboard.press('Escape');

    // Reset needs the typed word, then leads straight to setup.
    await (await openMenu(page))
      .getByRole('button', { name: 'Forgot or exposed passphrase?' })
      .click();
    const reset = page.getByRole('button', { name: 'Reset and remove all drives' });
    await expect(reset).toBeDisabled();
    await page.getByLabel('Type RESET to continue').fill('RESET');
    await reset.click();
    await expect(page.getByRole('dialog', { name: 'Set up passphrase unlock' })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload();
    await expect(chip(page)).toContainText('Key needed');
  });
});

test('Lock while a file key is being verified: no key, no preview', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    // Hold the verification request (the file's wrapped key) once the slots are loaded.
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    let held!: () => void;
    const reached = new Promise<void>((resolveReached) => (held = resolveReached));
    await page.route('**/api/console/drives/*/versions?*', async (route) => {
      held();
      await gate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await reached;
    await expect(chip(page)).toContainText('Unlocked');
    await (await openMenu(page)).getByRole('button', { name: 'Lock' }).click();
    await expect(chip(page)).toContainText('Locked');
    const stale = page.waitForResponse((r) => /\/versions\?/.test(r.url()));
    release();
    await stale;
    await settle(page);
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toHaveCount(0);
    await expect(chip(page)).toContainText('Locked');
    // Nothing was cached: the next action asks for the passphrase again.
    await page.unroute('**/api/console/drives/*/versions?*');
    await nameButton(page, 'note.txt').click();
    await expect(page.getByRole('dialog', { name: 'Unlock with your passphrase' })).toBeVisible();
  });
});

test('leaving while the slots are loading installs nothing and resumes nothing', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await page.reload();
    await page.evaluate(() => history.pushState(null, '', location.href));
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    let held!: () => void;
    const reached = new Promise<void>((resolveReached) => (held = resolveReached));
    await page.route('**/api/console/account-key/slots*', async (route) => {
      held();
      await gate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await reached;
    // Browser Back closes the prompt and cancels the pending file.
    await page.evaluate(() => history.back());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const stale = page.waitForResponse((r) => /account-key\/slots/.test(r.url()));
    release();
    await stale;
    await settle(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chip(page)).toContainText('Locked');
  });
});

test('30 minutes idle locks the vault and closes the preview', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await page.clock.install();
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toBeVisible({ timeout: 30_000 });
    await page.clock.fastForward('31:00');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chip(page)).toContainText('Locked');
    await expect(
      page.getByText('Locked after 30 minutes without use. Enter your passphrase to continue.'),
    ).toBeVisible();
  });
});

test('idle closes the unlock dialog and drops what was typed', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    await page.clock.install();
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.clock.fastForward('31:00');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chip(page)).toContainText('Locked');
    await nameButton(page, 'note.txt').click();
    await expect(dialogPassphrase(page)).toHaveValue('');
  });
});

test('setup seals only keys that open a real file, and closing cancels it', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    await page.goto(`/console?drive=${seeded.a.id}`);
    // A recovery key that is wrong for the drive.
    await nameButton(page, 'note.txt').click();
    await page.getByText('Paste a key instead').click();
    await page
      .getByLabel(/^Drive key or credentials bundle/)
      .fill(randomBytes(32).toString('base64url'));
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await page.keyboard.press('Escape');
    // Setup, cancelled while the account key is being saved.
    await (await openMenu(page)).getByRole('button', { name: 'Set up passphrase unlock' }).click();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let held!: () => void;
    const reached = new Promise<void>((done) => (held = done));
    await page.route('**/api/console/account-key', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      held();
      await gate;
      await route.continue();
    });
    await page.getByLabel('I saved it').check();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await reached;
    await page.getByRole('button', { name: 'Close dialog' }).click();
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /account-key$/.test(r.url()),
    );
    release();
    await created;
    await settle(page);
    await expect(chip(page)).not.toContainText('Unlocked');
    await page.unroute('**/api/console/account-key');
  });
});

test('setup skips a loaded key that fails its file', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    await page.goto(`/console?drive=${seeded.a.id}`);
    await nameButton(page, 'note.txt').click();
    await page.getByText('Paste a key instead').click();
    await page
      .getByLabel(/^Drive key or credentials bundle/)
      .fill(randomBytes(32).toString('base64url'));
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await page.keyboard.press('Escape');
    await (await openMenu(page)).getByRole('button', { name: 'Set up passphrase unlock' }).click();
    await page.getByLabel('I saved it').check();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Passphrase set up. 0 drives added to your account.')).toBeVisible({
      timeout: 60_000,
    });
  });
});

test('a key loaded from a recovery file while locked shows Key loaded, and Lock clears it', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    await setUpPassphrase(page, seeded);
    await page.reload();
    await (await openMenu(page)).getByRole('button', { name: 'Load key' }).click();
    await page.getByLabel('Choose recovery file').setInputFiles(recoveryFile(seeded.a));
    await expect(chip(page)).toContainText('Key loaded');
    const menu = await openMenu(page);
    await expect(menu.getByRole('button', { name: 'Forget key' })).toBeVisible();
    await menu.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(chip(page)).toContainText('Locked');
  });
});

test('a slot that holds the wrong key never opens a preview or share', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await withSeed(context, baseURL!, async (seeded) => {
    const { raw } = await setUpPassphrase(page, seeded);
    // Plant a validly sealed slot that holds a different drive key.
    const database = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const key = await database.query<{ id: string; public_key: string }>(
        `SELECT k.id, k.public_key FROM account_keys k JOIN accounts a ON a.id = k.account_id
          WHERE a.external_clerk_user_id = $1`,
        [seeded.userId],
      );
      // The account seal is the device seal with its own salt and a `keyId:driveId` label.
      const sealed = await sealDriveKey(
        key.rows[0]!.public_key,
        seeded.a.id,
        randomBytes(32).toString('base64url'),
        { salt: 'agent-drive-account-v1', label: `${key.rows[0]!.id}:${seeded.a.id}` },
      );
      await database.query('UPDATE account_key_slots SET sealed = $2::jsonb WHERE drive_id = $1', [
        seeded.a.id,
        JSON.stringify(sealed),
      ]);
    } finally {
      await database.end();
    }
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    const mismatch =
      'The saved key for this drive doesn’t open this file. Load its recovery file to replace it.';
    await expect(page.getByText(mismatch)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    // Share does not open either.
    await page.getByRole('button', { name: 'More actions for note.txt' }).click();
    await page
      .locator('[data-testid="row-menu"]:visible')
      .getByRole('button', { name: 'Share' })
      .click();
    await expect(page.getByText(mismatch)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Share note.txt' })).toHaveCount(0);
    // Loading the real recovery file replaces the bad slot.
    await page.getByLabel('Choose recovery file').setInputFiles(recoveryFile(seeded.a));
    await expect(page.getByRole('dialog', { name: 'Share note.txt' })).toBeVisible();
    await expect(
      page.getByText('Added to your account. Next time your passphrase opens it.'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await nameButton(page, 'note.txt').click();
    await dialogPassphrase(page).fill(raw);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'note.txt' })).toContainText(
      `NOTE ${seeded.sentinel}`,
    );
  });
});

// Screenshots for review; only when VAULT_SHOTS names a folder.
test('screenshots of setup, unlock, unlocked chip, change and reset', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.VAULT_SHOTS, 'set VAULT_SHOTS to a folder to take screenshots');
  test.setTimeout(300_000);
  const folder = process.env.VAULT_SHOTS!;
  await mkdir(folder, { recursive: true });
  await withSeed(context, baseURL!, async (seeded) => {
    for (const [label, size] of [
      ['1440', { width: 1440, height: 900 }],
      ['390', { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(`/console?drive=${seeded.a.id}`);
      await nameButton(page, 'note.txt').click();
      await page.getByLabel('Choose recovery file').setInputFiles(recoveryFile(seeded.a));
      await expect(page.getByRole('dialog', { name: 'note.txt' })).toBeVisible();
      await page.keyboard.press('Escape');
      await (await openMenu(page))
        .getByRole('button', { name: 'Set up passphrase unlock' })
        .click();
      await page.screenshot({ path: join(folder, `${label}-setup-generated.png`) });
      await page.getByRole('button', { name: 'Use my own passphrase' }).click();
      await page.screenshot({ path: join(folder, `${label}-setup-own.png`) });
      await page.getByRole('button', { name: 'Use a generated passphrase' }).click();
      const raw = (await page.getByTestId('generated-passphrase').innerText()).replaceAll(' ', '');
      await page.getByLabel('I saved it').check();
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(chip(page)).toContainText('Unlocked', { timeout: 60_000 });
      await page.screenshot({ path: join(folder, `${label}-unlocked-chip.png`) });
      await (await openMenu(page)).waitFor();
      await page.screenshot({ path: join(folder, `${label}-unlocked-menu.png`) });
      await page.keyboard.press('Escape');
      await page.reload();
      await nameButton(page, 'note.txt').click();
      await page.screenshot({ path: join(folder, `${label}-unlock.png`) });
      await dialogPassphrase(page).fill(raw);
      await page.getByRole('button', { name: 'Unlock', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'note.txt' })).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      await (await openMenu(page)).getByRole('button', { name: 'Change passphrase' }).click();
      await page.screenshot({ path: join(folder, `${label}-change.png`) });
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await (await openMenu(page))
        .getByRole('button', { name: 'Forgot or exposed passphrase?' })
        .click();
      await page.screenshot({ path: join(folder, `${label}-reset.png`) });
      await page.getByLabel('Type RESET to continue').fill('RESET');
      await page.getByRole('button', { name: 'Reset and remove all drives' }).click();
      await expect(page.getByRole('dialog', { name: 'Set up passphrase unlock' })).toBeVisible();
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
  });
});

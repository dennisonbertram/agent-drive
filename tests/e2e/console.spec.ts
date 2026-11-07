import { test, expect, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

function cli(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('packages/agent-drive/dist/cli.js'), ...args], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
  });
}

// The backup state lives in the key chip: open its menu, then read the menu text.
async function keyMenu(page: Page) {
  const menu = page.getByTestId('key-menu');
  if (!(await menu.isVisible())) await page.getByTestId('key-chip').click();
  return menu;
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
      await database.query('DELETE FROM accounts WHERE id=$1', [id]);
    }
  } finally {
    storage.destroy();
    await database.end();
  }
}

test('new human workspace → encrypted CLI upload → browser download, restore, and revocation', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-browser-'));
  const networkBodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${baseURL}/api/`)) networkBodies.push(request.postData() ?? '');
  });
  try {
    // Only authentication is stubbed. Provisioning, API, CLI, crypto, DB and S3 are real.
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await page.goto('/console');
    // First run: one primary action (copy the agent instruction), one drive-creation control.
    await expect(page.getByRole('button', { name: 'Copy agent instruction' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.button.primary:visible')).toHaveCount(1);
    await expect(page.locator('.button.primary:visible')).toHaveAccessibleName(
      'Copy agent instruction',
    );
    await expect(page.getByRole('button', { name: '+ New drive' })).toHaveCount(0);
    const firstRun = await page.evaluate(() => ({
      panel: document.querySelector('.onboarding')!.getBoundingClientRect().height,
      overflow: document.scrollingElement!.scrollHeight - window.innerHeight,
      height: window.innerHeight,
    }));
    expect(firstRun.panel / firstRun.height).toBeGreaterThanOrEqual(0.35);
    expect(firstRun.overflow).toBeLessThanOrEqual(0);
    // Closing a dialog returns focus to the button that opened it.
    const opener = page.getByRole('button', { name: 'New drive', exact: true });
    await opener.click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByLabel('Drive name').fill('Browser acceptance');
    await page.getByRole('button', { name: 'Create drive', exact: true }).click();
    const driveKey = await page.getByTestId('drive-key').inputValue();
    expect(driveKey.length).toBe(43);
    const recoveryDownload = page.waitForEvent('download');
    let backupPosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/key-backup')) backupPosts += 1;
    });
    const backupPost = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/key-backup'),
    );
    await page.getByRole('button', { name: 'Download recovery file and continue' }).click();
    const recovery = await recoveryDownload;
    const backup = JSON.parse(await readFile((await recovery.path())!, 'utf8')) as {
      driveId: string;
      key: string;
    };
    expect(backup.key === driveKey).toBe(true);
    // The backup is recorded only after the user confirms the file saved.
    await expect(page.getByRole('heading', { name: 'Did the recovery file save?' })).toBeVisible();
    expect(backupPosts).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByRole('button', { name: 'I saved it' }).click();
    expect((await backupPost).postDataJSON()).toEqual({ method: 'file' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // F19: saving the recovery file from the receipt records the backup.
    await expect(page.getByTestId('key-chip')).not.toContainText('Not backed up');
    await expect(await keyMenu(page)).toContainText('Key backed up');
    const driveId = await page.getByTestId('drive-id').innerText();
    expect(backup.driveId).toBe(driveId);

    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Create your first agent' }).click();
    await page.getByLabel('Agent name').fill('Browser test agent');
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await page.getByRole('button', { name: 'Create API key', exact: true }).click();
    await page.getByLabel('Key label').fill('Browser regression key');
    await page.getByLabel('delete', { exact: true }).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create API key', exact: true })
      .click();
    const token = await page.getByTestId('api-key').inputValue();
    await page.getByLabel('I saved my API key securely').check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const environment = {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL,
      AGENT_DRIVE_API_KEY: token,
      AGENT_DRIVE_KEY: driveKey,
      AGENT_DRIVE_CONFIG: join(root, 'config.json'),
    };
    const original = Buffer.concat([
      Buffer.from(`BROWSER-PLAINTEXT-${randomUUID()}\n`),
      randomBytes(2048),
    ]);
    const localFile = join(root, 'artifact.bin');
    await writeFile(localFile, original, { mode: 0o600 });
    const upload = await cli(
      ['put', localFile, '/outputs/artifact.bin', '--drive', driveId],
      environment,
    );
    expect(upload.status, 'CLI upload must succeed').toBe(0);
    const initialVersion = JSON.parse(upload.stdout) as { id: string };
    await page.getByRole('button', { name: /^Files/ }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const fileRow = page.getByRole('row').filter({ hasText: '/outputs/artifact.bin' });
    await expect(fileRow).toBeVisible();
    await expect(fileRow).toContainText('Browser test agent');
    const contentDownload = page.waitForEvent('download');
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await readFile((await (await contentDownload).path())!)).equals(original)).toBe(true);

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.profile-row')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize(viewport);

    await page.reload();
    await expect(fileRow).toBeVisible();
    await expect(fileRow.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    // The key is never stored: no storage value contains it.
    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored).not.toContain(driveKey);
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByText('Paste a key instead').click();
    await page
      .getByLabel(/^Drive key or credentials bundle/)
      .fill(randomBytes(32).toString('base64url'));
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /decrypt/i })).toBeVisible();
    await page.getByTestId('key-chip').click();
    await page.getByRole('button', { name: 'Forget key' }).click();
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByText('Paste a key instead').click();
    await page.getByLabel(/^Drive key or credentials bundle/).fill(driveKey);
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await pendingDownload;
    const changed = Buffer.from('A later version, restored through the console.');
    await writeFile(localFile, changed);
    expect(
      (
        await cli(
          ['put', localFile, '/outputs/artifact.bin', '--drive', driveId, '--overwrite'],
          environment,
        )
      ).status,
    ).toBe(0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await fileRow.getByRole('button', { name: 'Versions' }).click();
    await page
      .locator('.version-row')
      .filter({ hasText: initialVersion.id })
      .getByRole('button', { name: 'Restore this version' })
      .click();
    const restoredDownload = page.waitForEvent('download');
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await readFile((await (await restoredDownload).path())!)).equals(original)).toBe(true);
    await fileRow.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(fileRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '/outputs/artifact.bin' })
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await expect(page.getByText('Nothing in the trash.')).toBeVisible();
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Storage by drive' })).toBeVisible();
    await expect(page.getByText('1 live files · 4 stored versions')).toBeVisible();
    await page.getByRole('button', { name: 'API keys', exact: true }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    const revoked = await cli(['whoami'], environment);
    expect(revoked.status).not.toBe(0);
    expect(revoked.stderr).toMatch(/invalid|revoked|unauthorized/i);
    // Do not print secrets even when this assertion fails.
    expect(
      networkBodies.some(
        (body) => body.includes(driveKey) || body.includes(original.toString('base64')),
      ),
    ).toBe(false);
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

test('console layout: tablet path column, desktop one-screen, phone rows and section menu', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-layout-'));
  const driveKey = randomBytes(32).toString('base64url');
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const post = async <T>(path: string, data: unknown) =>
      (await (
        await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL! } })
      ).json()) as T;
    const drive = await post<{ id: string }>('drives', { name: 'Layout drive' });
    const agent = await post<{ id: string }>('agents', { name: 'Layout agent' });
    const key = await post<{ token: string }>('keys', {
      label: 'Layout key',
      agentId: agent.id,
      driveIds: [drive.id],
      scopes: ['read', 'write'],
    });
    const environment = {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL,
      AGENT_DRIVE_API_KEY: key.token,
      AGENT_DRIVE_KEY: driveKey,
      AGENT_DRIVE_CONFIG: join(root, 'config.json'),
    };
    const localFile = join(root, 'note.txt');
    await writeFile(localFile, 'layout fixture', { mode: 0o600 });
    for (let index = 0; index < 14; index += 1) {
      const upload = await cli(
        [
          'put',
          localFile,
          `/notes/2026-q3-roadmap-and-planning-draft-${index}.md`,
          '--drive',
          drive.id,
        ],
        environment,
      );
      expect(upload.status, `CLI upload failed: ${upload.stderr.slice(0, 300)}`).toBe(0);
    }

    const firstRow = page.locator('.file-panel tbody tr').first();
    const openFiles = async () => {
      await page.goto('/console');
      await expect(firstRow).toBeVisible();
    };

    // Tablet: the file path column keeps room for the file name.
    await page.setViewportSize({ width: 768, height: 1024 });
    await openFiles();
    const pathHeader = await page.locator('.file-panel th').first().boundingBox();
    expect(pathHeader!.width).toBeGreaterThanOrEqual(240);

    // Desktop: the page does not scroll; the table scrolls inside its panel.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFiles();
    const desktop = await page.evaluate(() => ({
      page: document.scrollingElement!.scrollHeight - window.innerHeight,
      table: (() => {
        const box = document.querySelector('.file-panel .table-scroll')!;
        return box.scrollHeight - box.clientHeight;
      })(),
    }));
    expect(desktop.page).toBeLessThanOrEqual(0);
    expect(desktop.table).toBeGreaterThan(0);

    // Filtering: zero matches offer Clear filter, and one match pins the footer to the panel bottom.
    const filter = page.getByLabel('Filter loaded files');
    await filter.fill('zzz');
    await expect(page.getByRole('heading', { name: 'No files match “zzz”.' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(filter).toHaveValue('');
    await expect(filter).toBeFocused();
    await expect(page.locator('.file-panel tbody tr')).toHaveCount(14);
    await filter.fill('draft-13');
    await expect(page.locator('.file-panel tbody tr')).toHaveCount(1);
    const oneMatch = await page.evaluate(() => ({
      panel: document.querySelector('.file-panel')!.getBoundingClientRect().bottom,
      footer: document.querySelector('.file-panel .panel-footer')!.getBoundingClientRect().bottom,
    }));
    expect(oneMatch.panel - oneMatch.footer).toBeLessThanOrEqual(24);
    await filter.fill('');
    await expect(page.locator('.nav-count')).toHaveCount(0);

    // Trash: three useful columns, full dates, and Restore stays reachable on a tablet.
    for (const index of [0, 1])
      await post(`drives/${drive.id}/delete`, {
        path: `/notes/2026-q3-roadmap-and-planning-draft-${index}.md`,
      });
    for (const width of [1440, 768]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 1024 });
      await openFiles();
      await page.getByRole('button', { name: 'Trash', exact: true }).first().click();
      await expect(page.locator('.file-panel tbody tr')).toHaveCount(2);
      expect(
        await page.locator('.file-panel th').evaluateAll((a) => a.map((e) => e.textContent)),
      ).toEqual(['FILE PATH', 'DELETED', 'Actions']);
      await expect(page.getByText('Versions preserved')).toHaveCount(0);
      const clipped = await page
        .locator('.file-panel td:nth-child(2)')
        .evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth).length);
      expect(clipped, `DELETED clipped at ${width}`).toBe(0);
      await expect(
        page.locator('.file-panel tbody tr').first().getByRole('button', { name: 'Restore' }),
      ).toBeVisible();
    }
    for (const index of [0, 1])
      await post(`drives/${drive.id}/restore`, {
        path: `/notes/2026-q3-roadmap-and-planning-draft-${index}.md`,
      });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Phone: row actions are reachable without sideways scrolling.
    await page.setViewportSize({ width: 375, height: 812 });
    await openFiles();
    const download = await firstRow.getByRole('button', { name: 'Download' }).boundingBox();
    expect(download!.x).toBeGreaterThanOrEqual(0);
    expect(download!.x + download!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );

    // Phone: a short tab (Trash) still fills the viewport height.
    await page.locator('.nav-toggle').click();
    await page.locator('#console-nav .nav-item').filter({ hasText: 'Trash' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing in the trash.' })).toBeVisible();
    const mainBottom = await page.evaluate(
      () => document.querySelector('.console-main')!.getBoundingClientRect().bottom,
    );
    expect(mainBottom).toBeGreaterThanOrEqual(812);
    await openFiles();

    // Phone: all seven sections are reachable from the section menu.
    const toggle = page.locator('.nav-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const items = page.locator('#console-nav .nav-item');
    await expect(items).toHaveCount(7);
    for (const name of [
      'Files',
      'Agents',
      'API keys',
      'Usage',
      'Trash',
      'Billing & limits',
      'Activity & deletion',
    ]) {
      const item = items.filter({ hasText: name });
      await expect(item).toBeVisible();
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await items.filter({ hasText: 'Usage' }).click();
    await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Usage');
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

test('console unlock on demand: Download opens the key prompt and continues after the recovery file', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-unlock-'));
  const driveKey = randomBytes(32).toString('base64url');
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const post = async <T>(path: string, data: unknown) =>
      (await (
        await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL! } })
      ).json()) as T;
    const drive = await post<{ id: string }>('drives', { name: 'Unlock drive' });
    const agent = await post<{ id: string }>('agents', { name: 'Unlock agent' });
    const key = await post<{ token: string }>('keys', {
      label: 'Unlock key',
      agentId: agent.id,
      driveIds: [drive.id],
      scopes: ['read', 'write'],
    });
    const environment = {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL,
      AGENT_DRIVE_API_KEY: key.token,
      AGENT_DRIVE_KEY: driveKey,
      AGENT_DRIVE_CONFIG: join(root, 'config.json'),
    };
    const body = `UNLOCK-BODY-${randomUUID()}\n`;
    const localFile = join(root, 'today.md');
    await writeFile(localFile, body, { mode: 0o600 });
    const upload = await cli(
      ['put', localFile, '/notes/today.md', '--drive', drive.id],
      environment,
    );
    expect(upload.status, `CLI upload failed: ${upload.stderr.slice(0, 300)}`).toBe(0);
    const right = join(root, 'right.key.json');
    const wrong = join(root, 'wrong.key.json');
    await writeFile(
      right,
      JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: driveKey }),
    );
    await writeFile(
      wrong,
      JSON.stringify({ format: 'agent-drive-key-v1', driveId: randomUUID(), key: driveKey }),
    );
    const requests: string[] = [];
    page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));

    await page.clock.install();
    await page.goto('/console');
    const row = page.getByRole('row').filter({ hasText: '/notes/today.md' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    await row.getByRole('button', { name: 'Download', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Load the key for Unlock drive' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Drive key or credentials bundle/)).toBeHidden();
    const before = await dialog.boundingBox();
    await dialog.getByLabel('Choose recovery file').setInputFiles(wrong);
    await expect(dialog.getByRole('alert')).toHaveText('That recovery file is not for this drive.');
    const after = await dialog.boundingBox();
    expect(after!.height).toBe(before!.height);
    expect(after!.y).toBe(before!.y);

    const download = page.waitForEvent('download');
    await dialog.getByLabel('Choose recovery file').setInputFiles(right);
    expect((await readFile((await (await download).path())!, 'utf8')) === body).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('key-chip')).toContainText('Key loaded');

    // The idle lock clears the key and says so; the chip returns to "Key needed".
    await page.clock.fastForward('31:00');
    await expect(page.getByTestId('key-chip')).toContainText('Key needed');
    await expect(page.getByText(/The key was cleared after 30 minutes without use/)).toBeVisible();

    expect(
      await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])),
    ).not.toContain(driveKey);
    expect(requests.some((entry) => entry.includes(driveKey))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanupUser(userId);
  }
});

test('console trash: a failed load shows an error with Retry instead of loading forever', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await context.request.post('/api/console/drives', {
      data: { name: 'Trash drive' },
      headers: { Origin: baseURL! },
    });
    let failing = true;
    await page.route('**/api/console/drives/*/trash*', (route) =>
      failing
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Trash is unavailable.' } }),
          })
        : route.continue(),
    );
    await page.goto('/console');
    await page.getByRole('button', { name: 'Trash', exact: true }).first().click();
    await expect(page.getByText('Could not load files.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Loading files…')).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nothing in the trash.' })).toBeVisible();
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: recovery download stays on an empty drive, and a failed reload shows Retry over cached files', async ({
  page,
  context,
}) => {
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await page.goto('/console');
    await page.getByRole('button', { name: 'New drive', exact: true }).click({ timeout: 30_000 });
    // First drive: the name is prefilled; Enter creates it.
    await expect(page.getByLabel('Drive name')).toHaveValue('my-drive');
    await page.getByLabel('Drive name').press('Enter');
    // The backup POST fails once: the dialog still closes, the error is plain, and retry works.
    let failBackup = true;
    await page.route('**/key-backup', (route) =>
      failBackup
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Backup unavailable.' } }),
          })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Download recovery file and continue' }).click();
    await page.getByRole('button', { name: 'I saved it' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: 'The backup was not recorded' }),
    ).toBeVisible();
    // No files, key loaded: the backup warning and recovery download remain available.
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
    await expect(page.getByTestId('key-chip')).toContainText('Not backed up');
    failBackup = false;
    await (await keyMenu(page))
      .getByRole('button', { name: 'Download recovery file', exact: true })
      .click();
    // The key menu also records the backup only after "I saved it".
    await expect(page.getByTestId('key-chip')).toContainText('Not backed up');
    await page.getByRole('button', { name: 'I saved it' }).click();
    await expect(page.getByTestId('key-chip')).not.toContainText('Not backed up');
    await expect(await keyMenu(page)).toContainText('Key backed up');

    // The files list loaded once; a later reload of the cached scope fails.
    await page.route('**/api/console/drives/*/list*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Listing is unavailable.' } }),
      }),
    );
    await page.getByRole('button', { name: 'Agents', exact: true }).first().click();
    await page.getByRole('button', { name: 'Files', exact: true }).first().click();
    await expect(page.getByText('Could not load files.')).toHaveCount(1);
    await expect(page.getByText('Listing is unavailable.')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: a failed refresh is reported in plain words and moves nothing', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await context.request.post('/api/console/drives', {
      data: { name: 'Refresh drive' },
      headers: { Origin: baseURL! },
    });
    await page.goto('/console');
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible({
      timeout: 30_000,
    });
    const before = (await page.locator('.file-panel').boundingBox())!;
    await page.route('**/api/console/**', (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const refreshAlert = page.getByRole('alert').filter({ hasText: 'Could not reach Agent Drive' });
    await expect(refreshAlert).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    // The last loaded list stays visible under the message.
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
    const after = (await page.locator('.file-panel').boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(refreshAlert).toHaveCount(0);
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: a slow list shows skeleton, then Still loading with Retry', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await context.request.post('/api/console/drives', {
      data: { name: 'Slow drive' },
      headers: { Origin: baseURL! },
    });
    // Hold every list request: React strict mode may start more than one in development.
    let hold = true;
    await page.route('**/api/console/drives/*/list*', (route) =>
      hold ? undefined : route.continue(),
    );
    await page.goto('/console');
    await expect(page.locator('.list-state[data-state="loading"]')).toBeVisible({
      timeout: 30_000,
    });
    // The slow state appears after 10 s of real time (a fake clock made this test flaky in dev).
    await expect(page.getByRole('heading', { name: 'Still loading files…' })).toBeVisible({
      timeout: 20_000,
    });
    hold = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: a stale refresh cannot hide a recorded backup', async ({ page, context }) => {
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    await page.goto('/console');
    await page.getByRole('button', { name: 'New drive', exact: true }).click({ timeout: 30_000 });
    // Hold the drive list that createDrive() refreshes after creation, with its old contents.
    let armed = true;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/console/drives?limit=100', async (route) => {
      if (!armed) return route.continue();
      armed = false;
      const response = await route.fetch();
      await released;
      await route.fulfill({ response });
    });
    await page.getByLabel('Drive name').press('Enter');
    await page.getByRole('button', { name: 'Download recovery file and continue' }).click();
    await page.getByRole('button', { name: 'I saved it' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The backup was recorded; now the stale refresh lands.
    await page.waitForTimeout(500);
    release();
    await expect(page.getByTestId('key-chip')).not.toContainText('Not backed up');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('key-chip')).not.toContainText('Not backed up');
    await expect(await keyMenu(page)).toContainText('Key backed up');
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: coming back to a drive restarts the slow-load timer', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const create = async (name: string) =>
      (await (
        await context.request.post('/api/console/drives', {
          data: { name },
          headers: { Origin: baseURL! },
        })
      ).json()) as { id: string };
    const a = await create('a-slow');
    await create('b-fast');
    // Drive A's list never answers.
    await page.route(`**/api/console/drives/${a.id}/list*`, () => undefined);
    await page.goto('/console');
    await expect(page.getByRole('heading', { name: 'Still loading files…' })).toBeVisible({
      timeout: 25_000,
    });
    await page.getByRole('button', { name: /b-fast/ }).click();
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
    await page.getByRole('button', { name: /a-slow/ }).click();
    await expect(page.locator('.list-state[data-state="loading"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Still loading files…' })).toHaveCount(0);
  } finally {
    await cleanupUser(userId);
  }
});

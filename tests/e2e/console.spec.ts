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

// Exact storage the console may use. P1 stores nothing; later work extends `allowedLocal`.
async function expectNoStoredSecrets(page: Page, driveKey: string, allowedLocal: string[] = []) {
  const stored = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(stored.local.map(([name]) => name).sort()).toEqual([...allowedLocal].sort());
  expect(stored.session).toEqual([]);
  const text = JSON.stringify(stored);
  for (const secret of [driveKey, 'adk_', 'adcred1.']) expect(text).not.toContain(secret);
}

// The open ⋯ menu of a file row (a popover; closed ones are hidden).
const rowMenu = (page: Page) => page.locator('[data-testid="row-menu"]:visible');

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
    await page.getByTestId('drive-menu-button').click();
    const driveId = (await page.getByTestId('drive-id').getAttribute('title'))!;
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
    // Rows show names, not paths: open the folder, and the URL keeps it across reloads.
    await page.getByRole('link', { name: 'outputs', exact: true }).click();
    const fileRow = page.getByRole('row').filter({ hasText: 'artifact.bin' });
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
    await expectNoStoredSecrets(page, driveKey, ['agent-drive:last-drive']);
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
    // Refresh replaces the list; wait for the new one before opening a row menu.
    const reloaded = page.waitForResponse(
      (response) => response.url().includes('/list?') && response.ok(),
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await reloaded;
    await fileRow.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Versions' }).click();
    await page
      .locator(`.version-row[data-version-id="${initialVersion.id}"]`)
      .getByRole('button', { name: 'Restore this version' })
      .click();
    const restoredDownload = page.waitForEvent('download');
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    expect((await readFile((await (await restoredDownload).path())!)).equals(original)).toBe(true);
    await fileRow.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(fileRow).toHaveCount(0);
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    // From Trash the current version is the newest one, and it has no Restore button.
    await page
      .getByRole('row')
      .filter({ hasText: '/outputs/artifact.bin' })
      .getByRole('button', { name: 'Versions', exact: true })
      .click();
    const versionRows = page.locator('.version-row');
    await expect(versionRows.first()).toContainText('Current version');
    await expect(versionRows.first().getByRole('button')).toHaveCount(0);
    expect(await versionRows.count()).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: 'Restore this version' })).toHaveCount(
      (await versionRows.count()) - 1,
    );
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '/outputs/artifact.bin' })
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await expect(page.getByText('Nothing in the trash.')).toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Restored “artifact.bin”.');
    await page.getByRole('button', { name: 'Usage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Storage by drive' })).toBeVisible();
    await expect(page.getByText('1 live files · 3 stored versions')).toBeVisible();
    const storageTile = page.locator('.stat', { hasText: 'ENCRYPTED STORAGE' });
    await expect(storageTile).toContainText(' of 5.37 GB');
    await expect(storageTile.locator('progress')).toHaveCount(1);
    await page.getByRole('button', { name: 'API keys', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke Browser regression key', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke key', exact: true }).click();
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
      await page.goto('/console?path=/notes');
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

    // Chrome: one primary (Connect an agent, opens in place), no drive strip, no filler, no footer.
    await expect(page.locator('.button.primary:visible')).toHaveCount(1);
    await expect(page.locator('.button.primary:visible')).toHaveAccessibleName('Connect an agent');
    await expect(page.getByText('A home for the work')).toHaveCount(0);
    await expect(page.getByText('Built for the work between sessions.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Connect an agent' }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Copy agent instruction' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Agents', exact: true }).first().click();
    await expect(page.locator('.bay-strip')).toHaveCount(0);
    await page.getByRole('button', { name: 'Files', exact: true }).first().click();
    await expect(firstRow).toBeVisible();

    // Filtering: zero matches offer Clear filter, and one match pins the footer to the panel bottom.
    const filter = page.getByLabel('Search this folder');
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
    const more = await firstRow.getByRole('button', { name: /More actions/ }).boundingBox();
    expect(more!.x).toBeGreaterThanOrEqual(0);
    expect(more!.x + more!.width).toBeLessThanOrEqual(375);
    expect(more!.width).toBeGreaterThanOrEqual(44);
    expect(more!.height).toBeGreaterThanOrEqual(44);
    expect((await firstRow.boundingBox())!.height).toBeLessThanOrEqual(64);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    // Phone: at least 8 file rows fit on the first screen at 390x844.
    await page.setViewportSize({ width: 390, height: 844 });
    await openFiles();
    expect(
      await page
        .locator('.file-panel tbody tr')
        .evaluateAll(
          (rows) => rows.filter((row) => row.getBoundingClientRect().bottom <= 844).length,
        ),
    ).toBeGreaterThanOrEqual(8);
    await page.setViewportSize({ width: 375, height: 812 });

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
    await page.goto('/console?path=/notes');
    const row = page.getByRole('row').filter({ hasText: 'today.md' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    await row.getByRole('button', { name: 'Download', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Load the key for Unlock drive' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Drive key or credentials bundle/)).toBeHidden();
    // A slow read that finishes after the dialog closed must not load the key or download.
    let downloads = 0;
    page.on('download', () => (downloads += 1));
    await page.evaluate(() => {
      const w = window as unknown as { releaseRead: () => void };
      const original = File.prototype.text;
      const gate = new Promise<void>((resolve) => (w.releaseRead = resolve));
      File.prototype.text = async function () {
        const text = await original.call(this);
        await gate;
        File.prototype.text = original;
        return text;
      };
    });
    await dialog.getByLabel('Choose recovery file').setInputFiles(right);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { releaseRead: () => void }).releaseRead());
    await page.waitForTimeout(500);
    await expect(page.getByTestId('key-chip')).toContainText('Key needed');
    expect(downloads).toBe(0);
    await row.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(dialog).toBeVisible();
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

    await expectNoStoredSecrets(page, driveKey, ['agent-drive:last-drive']);
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
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /b-fast/ }).click();
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /a-slow/ }).click();
    await expect(page.locator('.list-state[data-state="loading"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Still loading files…' })).toHaveCount(0);
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: browse folders like a drive', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-browse-'));
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
    const drive = await post<{ id: string }>('drives', { name: 'A drive' });
    const second = await post<{ id: string }>('drives', { name: 'B drive' });
    // A backed-up drive keeps the key chip short, which leaves room for the phone breadcrumb.
    for (const { id } of [drive, second]) await post(`drives/${id}/key-backup`, { method: 'file' });
    const agent = await post<{ id: string }>('agents', { name: 'Browse agent' });
    const key = await post<{ token: string }>('keys', {
      label: 'Browse key',
      agentId: agent.id,
      driveIds: [drive.id],
      scopes: ['read', 'write'],
    });
    const environment = {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL,
      AGENT_DRIVE_API_KEY: key.token,
      AGENT_DRIVE_KEY: randomBytes(32).toString('base64url'),
      AGENT_DRIVE_CONFIG: join(root, 'config.json'),
    };
    const localFile = join(root, 'note.txt');
    await writeFile(localFile, 'browse fixture', { mode: 0o600 });
    // Upload order is the modified order: the last file written is the newest.
    for (const path of [
      '/README.md',
      '/inbox/x/2026-11-01.jsonl',
      '/inbox/x/2026-11-02.jsonl',
      '/reports',
      '/reports/week 45 ünïcode.md',
      '/logs/a.log',
      '/.agent-drive/check.txt',
      '/projects/acme/2026/q4/notes.md',
    ]) {
      const upload = await cli(['put', localFile, path, '--drive', drive.id], environment);
      expect(upload.status, `CLI upload failed: ${upload.stderr.slice(0, 300)}`).toBe(0);
    }

    const rows = page.locator('.file-panel tbody tr');
    const crumbNav = page.getByRole('navigation', { name: 'Folder path' });
    const names = () => rows.locator('.file-row-name').allInnerTexts();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/console');
    await expect(rows).toHaveCount(7);
    // No row title shows a path.
    expect(
      await rows.evaluateAll(
        (all) => all.filter((row) => /\//.test(row.querySelector('td')!.textContent!)).length,
      ),
    ).toBe(0);
    expect((await names()).sort()).toEqual(
      ['.agent-drive', 'README.md', 'inbox', 'logs', 'projects', 'reports', 'reports'].sort(),
    );
    await expect(
      rows.filter({ has: page.getByRole('link', { name: 'reports', exact: true }) }),
    ).toHaveCount(1);
    await expect(
      rows.filter({ has: page.getByRole('button', { name: 'reports', exact: true }) }),
    ).toHaveCount(1);

    // Folders open, the URL keeps the place, reload and Back restore it.
    await page.getByRole('link', { name: 'inbox', exact: true }).click();
    await page.getByRole('link', { name: 'x', exact: true }).click();
    await expect(page).toHaveURL(/path=%2Finbox%2Fx/);
    await expect(rows).toHaveCount(2);
    await page.reload();
    await expect(rows).toHaveCount(2);
    await page.goBack();
    await expect(rows).toHaveCount(1);
    await expect(crumbNav.locator('[aria-current="page"]')).toHaveText('inbox');
    await crumbNav.getByRole('link', { name: 'All files' }).click();
    await expect(rows).toHaveCount(7);
    await expect(page).not.toHaveURL(/path=/);

    // A file and a folder share a name; the folder opens, and the Unicode name survives reload.
    await page.getByRole('link', { name: 'reports', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'week 45 ünïcode.md', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'week 45 ünïcode.md', exact: true }),
    ).toBeVisible();

    // Sorting by keyboard: folders stay first.
    await page.goto('/console');
    await expect(rows).toHaveCount(7);
    const nameHeader = page.locator('th').filter({ hasText: 'NAME' });
    await page.getByRole('button', { name: /^NAME/ }).focus();
    await page.keyboard.press('Enter');
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(rows.first()).toHaveAttribute('data-kind', 'folder');
    await expect(rows.last()).toHaveAttribute('data-kind', 'file');
    await page.keyboard.press('Enter');
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.first()).toHaveAttribute('data-kind', 'folder');

    // Recent: newest first across folders, no .agent-drive, survives reload.
    await page.goto('/console?view=recent');
    await expect(rows).toHaveCount(7);
    expect(await names()).toEqual([
      'notes.md',
      'a.log',
      'week 45 ünïcode.md',
      'reports',
      '2026-11-02.jsonl',
      '2026-11-01.jsonl',
      'README.md',
    ]);
    await expect(page.getByText('check.txt')).toHaveCount(0);
    await page.reload();
    await expect(rows).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Search below the folder finds files at any depth and names their folder.
    await page.goto('/console?path=/inbox');
    await page.getByLabel('Search this folder').fill('11-02');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole('link', { name: '/inbox/x' })).toBeVisible();
    await expect(page.locator('.footer-count')).toHaveText('1 match');

    // A folder that is gone says so, and the button goes back to the drive.
    await page.goto('/console?path=/nope');
    await expect(page.getByRole('heading', { name: 'Nothing in this folder.' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to A drive' }).click();
    await expect(rows).toHaveCount(7);

    // Phone: only the drive, an up link and the current folder show, none of them truncated.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/console?path=/projects/acme/2026/q4');
    await expect(rows).toHaveCount(1);
    const up = crumbNav.getByRole('link', { name: /^Up to/ });
    await expect(up).toBeVisible();
    await expect(up).toHaveAttribute('href', /path=%2Fprojects%2Facme%2F2026$/);
    expect((await up.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await expect(crumbNav.locator('[aria-current="page"]')).toBeVisible();
    // Phone touch targets are at least 44 px tall.
    await rows
      .first()
      .getByRole('button', { name: /More actions/ })
      .click();
    for (const target of [
      page.getByTestId('drive-menu-button'),
      page.getByRole('button', { name: 'Browse', exact: true }),
      page.getByRole('button', { name: 'Recent', exact: true }),
      page.getByLabel('Sort by'),
      rowMenu(page).getByRole('button', { name: 'Versions' }),
      rowMenu(page).getByRole('button', { name: 'Trash' }),
    ])
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    for (const part of [
      crumbNav.locator('[aria-current="page"]'),
      page.getByTestId('drive-menu-button'),
    ])
      expect(await part.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(crumbNav.getByRole('link', { name: '2026', exact: true })).toBeHidden();
    // Phone, drive not backed up (long key chip): the chip wraps below and nothing is cut off.
    const bare = await post<{ id: string }>('drives', { name: 'C drive' });
    await page.route('**/api/console/drives/*/list*', (route) =>
      !route.request().url().includes(bare.id)
        ? route.continue()
        : route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              items: [{ id: 'f1', path: '/projects/acme/2026/q4/n.md', ciphertext_size: 9 }],
              nextCursor: null,
            }),
          }),
    );
    await page.goto(`/console?drive=${bare.id}&path=/projects/acme/2026/q4`);
    await expect(page.getByTestId('key-chip')).toContainText('Not backed up');
    await expect(rows).toHaveCount(1);
    for (const part of [
      crumbNav.locator('[aria-current="page"]'),
      page.getByTestId('drive-menu-button'),
    ])
      expect(await part.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(
      await crumbNav.locator('[aria-current="page"]').evaluate((el) => el.clientWidth),
    ).toBeGreaterThanOrEqual(20);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Switching drive drops the folder from the URL.
    await page.goto(`/console?drive=${drive.id}&path=/inbox`);
    await expect(rows).toHaveCount(1);
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /B drive/ }).click();
    await expect(page).not.toHaveURL(/path=/);
    await expect(page).toHaveURL(new RegExp(`drive=${second.id}`));
    await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
    // Back restores the drive and its folder together.
    await page.goBack();
    await expect(crumbNav).toContainText('A drive');
    await expect(rows).toHaveCount(1);
    await page.goForward();
    await expect(crumbNav).toContainText('B drive');
    // The last-used drive is remembered when the URL has none.
    await page.goto('/console');
    await expect(crumbNav).toContainText('B drive');

    // Back restores the first drive even after a folder open and a drive switch.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/console');
    await page.evaluate((id) => localStorage.setItem('agent-drive:last-drive', id), drive.id);
    await page.goto('/console');
    await expect(rows).toHaveCount(7);
    // Keyboard: opening a folder moves focus to the current folder in the breadcrumb.
    await page.getByRole('link', { name: 'inbox', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(crumbNav.locator('[aria-current="page"]')).toBeFocused();
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /B drive/ }).click();
    // An unlock dialog opened for B does not survive going Back to A.
    await page.getByTestId('key-chip').click();
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(crumbNav).toContainText('A drive');
    await page.goBack();
    await expect(crumbNav).toContainText('A drive');
    await expect(rows).toHaveCount(7);

    // Storage that throws must not break the console: it opens the first drive with no error.
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('blocked');
      };
      Storage.prototype.setItem = () => {
        throw new Error('blocked');
      };
    });
    await page.goto('/console');
    await expect(crumbNav).toContainText('A drive');
    await expect(rows).toHaveCount(7);
    await expect(page.locator('.banner.error, .notice-slot.error')).toHaveCount(0);
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

// UI only: the list API is mocked, to test what the console asks for and shows.
test('console files: browse asks for one folder page, pages with Load more, and searches with q (mocked API)', async ({
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
      data: { name: 'Bulk drive' },
      headers: { Origin: baseURL! },
    });
    const requests: URLSearchParams[] = [];
    const file = (n: number, path = `/f-${String(n).padStart(4, '0')}.log`) => ({
      kind: 'file',
      id: `file-${n}`,
      path,
      version_id: `v-${n}`,
      ciphertext_size: 64,
      agent_id: 'agent',
      created_at: '2026-11-01T00:00:00.000Z',
    });
    await page.route('**/api/console/drives/*/list*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      requests.push(query);
      const respond = (items: unknown[], nextCursor: string | null) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ items, nextCursor }),
        });
      if (query.get('q')) return respond([file(900, '/deep/er/needle.md')], null);
      if (query.get('delimiter') !== '/') {
        // The newest 100 changes are all internal check files; the user file is on page 2.
        if (!query.get('cursor'))
          return respond(
            Array.from({ length: 100 }, (_, n) => file(300 + n, `/.agent-drive/check-${n}.txt`)),
            'r2',
          );
        return respond([file(1, '/newest.md')], null);
      }
      if (!query.get('cursor') && !query.get('prefix'))
        return respond(
          [
            {
              kind: 'folder',
              path: '/logs',
              items: 1000,
              ciphertext_size: 640,
              created_at: '2026-11-01T00:00:00.000Z',
            },
            {
              kind: 'folder',
              path: '/outputs',
              items: 50,
              ciphertext_size: 640,
              created_at: '2026-11-02T00:00:00.000Z',
            },
            ...Array.from({ length: 98 }, (_, n) => file(n + 10)),
          ],
          '100',
        );
      // The second page repeats one row of the first page, as a moving listing can.
      return respond([file(10), ...Array.from({ length: 4 }, (_, n) => file(n + 200))], null);
    });
    await page.goto('/console');
    // Both root folders show with the server's counts, and the page cost one request.
    await expect(page.locator('[data-kind="folder"]')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('[data-kind="folder"]').first()).toContainText('50 items');
    await expect(page.locator('[data-kind="folder"]').nth(1)).toContainText('1000 items');
    await expect(page.locator('.list-cap')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.get('delimiter')).toBe('/');
    expect(requests[0]!.get('sort')).toBe('modified');
    requests.length = 0;
    // Load more continues from nextCursor and does not repeat a row.
    await expect(page.locator('.panel-footer')).toContainText('100 loaded');
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.locator('.panel-footer')).toContainText('104 items');
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.get('cursor')).toBe('100');
    const names = await page.locator('.file-row-name .file-label').allTextContents();
    expect(new Set(names).size).toBe(names.length);
    // Search asks the server and finds a file two folders down.
    await page.getByLabel('Search this folder').fill('needle');
    await expect(page.getByText('needle.md')).toBeVisible();
    expect(requests.some((query) => query.get('q') === 'needle')).toBe(true);
    // Recent is one request, newest first, with no cap note.
    requests.length = 0;
    await page.goto('/console?view=recent');
    await expect(page.getByText('newest.md')).toBeVisible();
    await expect(page.getByText('check.txt')).toHaveCount(0);
    await expect(page.locator('.list-cap')).toHaveCount(0);
    // One request per page: the internal rows do not count toward the 50 files shown.
    await expect(page.locator('.panel-footer')).toContainText('1 recent files');
    expect(requests).toHaveLength(2);
    expect(requests[0]!.get('sort')).toBe('modified');
    expect(requests[0]!.get('delimiter')).toBeNull();
    expect(requests[1]!.get('cursor')).toBe('r2');
  } finally {
    await cleanupUser(userId);
  }
});

// Inserts listing rows straight into the database: paging and counts need hundreds of files,
// and the listing never reads the stored bytes.
async function seedListing(
  driveId: string,
  agentId: string,
  files: { path: string; at: string }[],
) {
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const { path, at } of files) {
      const file = await database.query<{ id: string }>(
        'INSERT INTO files (drive_id, path, created_at) VALUES ($1,$2,$3) RETURNING id',
        [driveId, path, at],
      );
      const version = await database.query<{ id: string }>(
        `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id, created_at)
         VALUES ($1,$2,$3,50,'x',$4,$5) RETURNING id`,
        [file.rows[0]!.id, driveId, `e2e-seed/${randomUUID()}`, agentId, at],
      );
      await database.query('UPDATE files SET current_version_id=$1 WHERE id=$2', [
        version.rows[0]!.id,
        file.rows[0]!.id,
      ]);
    }
  } finally {
    await database.end();
  }
}

async function seededDrive(
  context: import('@playwright/test').BrowserContext,
  baseURL: string,
  userId: string,
  name: string,
  files: { path: string; at: string }[],
) {
  const login = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId },
  });
  expect(login.status()).toBe(200);
  const post = async <T>(path: string, data: unknown) =>
    (await (
      await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL } })
    ).json()) as T;
  const drive = await post<{ id: string }>('drives', { name });
  await post(`drives/${drive.id}/key-backup`, { method: 'file' });
  const agent = await post<{ id: string }>('agents', { name: 'Seed agent' });
  await seedListing(drive.id, agent.id, files);
  return drive.id;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

test('console files: a big drive lists every root folder, pages with Load more, and Recent is exact (seeded)', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const pad = (n: number, w = 3) => String(n).padStart(w, '0');
    const driveId = await seededDrive(context, baseURL!, userId, 'bulk-logs', [
      ...Array.from({ length: 230 }, (_, n) => ({
        path: `/logs/run-${pad(n)}.log`,
        at: minutesAgo(100 + n),
      })),
      ...Array.from({ length: 3 }, (_, n) => ({
        path: `/outputs/summary-${n + 1}.md`,
        at: minutesAgo(10 - n),
      })),
      { path: '/readme.md', at: minutesAgo(5000) },
    ]);
    const listRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/list')) listRequests.push(request.url());
    });
    await page.goto(`/console?drive=${driveId}`);
    const folders = page.locator('[data-kind="folder"]');
    await expect(folders).toHaveCount(2, { timeout: 30_000 });
    await expect(folders.filter({ hasText: 'logs' })).toContainText('230 items');
    await expect(folders.filter({ hasText: 'outputs' })).toContainText('3 items');
    await expect(page.locator('.list-cap')).toHaveCount(0);
    await expect(page.locator('.panel-footer')).toContainText('3 items');
    // One request for the folder view.
    expect(listRequests).toHaveLength(1);
    // Opening a folder from the list is exactly one more request.
    listRequests.length = 0;
    await folders.filter({ hasText: 'outputs' }).getByRole('link').first().click();
    await expect(page.getByText('summary-1.md')).toBeVisible();
    expect(listRequests).toHaveLength(1);
    expect(listRequests[0]).toContain('prefix=%2Foutputs');
    // /logs: 230 files in three pages, no repeats, no cap note.
    await page.goto(`/console?drive=${driveId}&path=/logs`);
    const rows = page.locator('.file-row-name');
    await expect(rows).toHaveCount(100);
    const more = page.getByRole('button', { name: 'Load more', exact: true });
    await more.click();
    await expect(rows).toHaveCount(200);
    await more.click();
    await expect(rows).toHaveCount(230);
    await expect(more).toHaveCount(0);
    await expect(page.locator('.panel-footer')).toContainText('230 items');
    await expect(page.getByText('All 230 items loaded.')).toBeAttached();
    const names = await page.locator('.file-row-name .file-label').allTextContents();
    expect(new Set(names).size).toBe(230);
    await expect(page.locator('.list-cap')).toHaveCount(0);
    // Recent: newest across the whole drive, one request.
    listRequests.length = 0;
    await page.goto(`/console?drive=${driveId}&view=recent`);
    await expect(page.locator('.file-row-name .file-label').first()).toHaveText('summary-3.md', {
      timeout: 30_000,
    });
    await expect(page.locator('.list-cap')).toHaveCount(0);
    expect(listRequests).toHaveLength(1);
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: Show file after Undo finds a file beyond the first page', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const driveId = await seededDrive(
      context,
      baseURL!,
      userId,
      'old-files',
      Array.from({ length: 130 }, (_, n) => ({
        path: `/old/f-${String(n).padStart(3, '0')}.md`,
        at: minutesAgo(1000 - n),
      })),
    );
    // f-000.md is the oldest, so it sits on the second page.
    await page.goto(`/console?drive=${driveId}&path=/old`);
    await page.getByRole('button', { name: 'Load more', exact: true }).click({ timeout: 30_000 });
    const row = page.locator('tr', { has: page.locator('[data-path="/old/f-000.md"]') });
    await row.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    const toast = page.locator('.toast').first();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toContainText('Restored', { timeout: 15_000 });
    await toast.getByRole('button', { name: 'Show file' }).click();
    await expect(page.locator('[data-path="/old/f-000.md"]')).toBeFocused({ timeout: 15_000 });
  } finally {
    await cleanupUser(userId);
  }
});

test('console files: a Load more still running on one drive never affects another (mocked API)', async ({
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
    const make = async (name: string) =>
      (await (
        await context.request.post('/api/console/drives', {
          data: { name },
          headers: { Origin: baseURL! },
        })
      ).json()) as { id: string };
    const a = await make('A drive');
    const b = await make('B drive');
    await page.route('**/api/console/drives/*/list*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cursor')) {
        await new Promise((done) => setTimeout(done, 1500));
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Listing is unavailable.' } }),
        });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: Array.from({ length: 100 }, (_, n) => ({
            kind: 'file',
            id: `${url.pathname}-${n}`,
            path: `/f-${n}.md`,
            version_id: `v${n}`,
            ciphertext_size: 5,
            created_at: '2026-11-01T00:00:00.000Z',
          })),
          nextCursor: 'next',
        }),
      });
    });
    await page.goto(`/console?drive=${a.id}`);
    await page.getByRole('button', { name: 'Load more', exact: true }).click({ timeout: 30_000 });
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /B drive/ }).click();
    await expect(page).toHaveURL(new RegExp(`drive=${b.id}`));
    const more = page.getByRole('button', { name: 'Load more', exact: true });
    await expect(more).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(2000);
    await expect(page.getByText('Could not load more')).toHaveCount(0);
    await expect(more).toBeEnabled();
  } finally {
    await cleanupUser(userId);
  }
});

test('console trash: typing in the filter does not reload the list (mocked API)', async ({
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
    let loads = 0;
    await page.route('**/api/console/drives/*/trash*', (route) => {
      loads += 1;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 'a', path: '/alpha.md', version_id: 'v1', deletedAt: '2026-11-01T00:00:00Z' },
            { id: 'b', path: '/beta.md', version_id: 'v2', deletedAt: '2026-11-01T00:00:00Z' },
          ],
          nextCursor: null,
        }),
      });
    });
    await page.goto('/console');
    await page.getByRole('button', { name: 'Trash', exact: true }).first().click();
    await expect(page.getByText('alpha.md')).toBeVisible({ timeout: 30_000 });
    const before = loads;
    await page.getByLabel('Search deleted files').fill('alpha');
    await expect(page.getByText('beta.md')).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(loads).toBe(before);
  } finally {
    await cleanupUser(userId);
  }
});

// Signs in a fresh test user, creates drives (key backed up, so the key chip stays short) and
// uploads the given paths to each through the real CLI.
async function seedRows(
  context: import('@playwright/test').BrowserContext,
  baseURL: string,
  root: string,
  userId: string,
  drives: { name: string; files: string[] }[],
) {
  const login = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId },
  });
  expect(login.status()).toBe(200);
  const post = async <T>(path: string, data: unknown) =>
    (await (
      await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL } })
    ).json()) as T;
  const created = [];
  for (const { name } of drives) created.push(await post<{ id: string }>('drives', { name }));
  for (const { id } of created) await post(`drives/${id}/key-backup`, { method: 'file' });
  const agent = await post<{ id: string; name: string }>('agents', { name: 'Row agent' });
  const keys = [];
  for (const label of ['Row key one', 'Row key two'])
    keys.push(
      await post<{ token: string }>('keys', {
        label,
        agentId: agent.id,
        driveIds: created.map((item) => item.id),
        scopes: ['read', 'write'],
      }),
    );
  const localFile = join(root, 'note.txt');
  await writeFile(localFile, 'row fixture', { mode: 0o600 });
  const environment = {
    ...process.env,
    AGENT_DRIVE_API_URL: baseURL,
    AGENT_DRIVE_API_KEY: keys[0]!.token,
    AGENT_DRIVE_KEY: randomBytes(32).toString('base64url'),
    AGENT_DRIVE_CONFIG: join(root, 'config.json'),
  };
  for (const [index, { files }] of drives.entries())
    for (const path of files) {
      const upload = await cli(
        ['put', localFile, path, '--drive', created[index]!.id],
        environment,
      );
      expect(upload.status, `CLI upload failed: ${upload.stderr.slice(0, 300)}`).toBe(0);
    }
  return { driveIds: created.map((item) => item.id), agentName: agent.name };
}

test('console row actions: Trash shows Undo at once and Undo restores on the original drive', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-undo-'));
  try {
    const { driveIds } = await seedRows(context, baseURL!, root, userId, [
      { name: 'Undo A', files: ['/notes/a.md', '/notes/b.md', '/notes/c.md'] },
      { name: 'Undo B', files: ['/other/x.md'] },
    ]);
    const [driveA, driveB] = driveIds as [string, string];
    const rows = page.locator('.file-panel tbody tr');
    const rowOf = (name: string) => rows.filter({ hasText: name });
    const toast = page.locator('.toast').last();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/console?drive=${driveA}&path=%2Fnotes`);
    await expect(rows).toHaveCount(3);

    // 1. The toast and the hidden row appear before the slow delete finishes.
    await page.route('**/drives/*/delete', (route) =>
      setTimeout(() => void route.continue(), 1500),
    );
    await rowOf('a.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Moved “a.md” to Trash.' }),
    ).toBeVisible({ timeout: 100 });
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible({ timeout: 100 });
    await expect(rowOf('a.md')).toHaveCount(0, { timeout: 100 });
    // a.md was the last row, so focus moved to the row above it (b.md), not lost.
    await expect(rowOf('b.md').locator('.file-row-name')).toBeFocused();

    // 3. The toast is inside the viewport and right of the sidebar.
    const box = (await toast.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(224);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + box.height).toBeLessThanOrEqual(900);

    // 2. Switch drive, then Undo: it restores on drive A.
    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: /Undo B/ }).click();
    await expect(page).toHaveURL(new RegExp(`drive=${driveB}`));
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toContainText('Restored “a.md”.', { timeout: 15_000 });
    await toast.getByRole('button', { name: 'Show file' }).click();
    await expect(page).toHaveURL(new RegExp(`drive=${driveA}`));
    await expect(page).toHaveURL(/path=%2Fnotes/);
    await expect(rowOf('a.md')).toHaveCount(1);
    await expect(rowOf('a.md').locator('.file-row-name')).toBeFocused();
    await page.unroute('**/drives/*/delete');

    // Phone width: the toast fits with 16 px margins.
    await page.setViewportSize({ width: 390, height: 844 });
    await rowOf('c.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(toast).toBeVisible();
    const phone = (await toast.boundingBox())!;
    expect(phone.x).toBeGreaterThanOrEqual(0);
    expect(phone.x + phone.width).toBeLessThanOrEqual(390);
    expect(phone.y + phone.height).toBeLessThanOrEqual(844);
    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });

    // 4. A failed delete brings the row back and says so.
    await page.route('**/drives/*/delete', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Storage is unavailable.' } }),
      }),
    );
    await rowOf('b.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Could not move “b.md” to Trash.' }),
    ).toBeVisible();
    await expect(rowOf('b.md')).toHaveCount(1);
    await page.unroute('**/drives/*/delete');

    // Two Undo toasts coexist: trashing a second file keeps the first one's Undo.
    while (await page.locator('.toast-dismiss').count())
      await page.locator('.toast-dismiss').first().click();
    await rowOf('b.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await rowOf('a.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(page.locator('.toast')).toHaveCount(2);
    await expect(page.locator('.toast').first()).toContainText('“b.md”');
    // One empty live region stays mounted and carries the text.
    await expect(page.getByRole('status').filter({ hasText: /Moved/ })).toHaveText(
      'Moved “a.md” to Trash.',
    );
    // Undo the first one by keyboard: the same button stays focused as "Show file".
    const firstUndo = page.locator('.toast').first().getByRole('button', { name: 'Undo' });
    await firstUndo.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.toast').first()).toContainText('Restored “b.md”.', {
      timeout: 15_000,
    });
    await expect(
      page.locator('.toast').first().getByRole('button', { name: 'Show file' }),
    ).toBeFocused();
    await expect(page.locator('.toast').nth(1)).toContainText('Moved “a.md” to Trash.');
    while (await page.locator('.toast-dismiss').count())
      await page.locator('.toast-dismiss').first().click();

    // 5. The toast stays for 8 s, pauses on hover, and is gone after that.
    await page.clock.install();
    await rowOf('b.md')
      .getByRole('button', { name: /More actions/ })
      .click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(toast).toContainText('Moved “b.md” to Trash.');
    await page.clock.runFor(7_500);
    await expect(toast).toBeVisible();
    await toast.hover();
    await page.clock.runFor(20_000);
    await expect(toast).toBeVisible();
    await page.mouse.move(700, 100);
    await page.clock.runFor(9_000);
    await expect(toast).toHaveCount(0);
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

test('console confirms: revoke agent names it and the key count; no Revoke at 0 keys', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-confirm-'));
  try {
    const { agentName } = await seedRows(context, baseURL!, root, userId, [
      { name: 'Confirm drive', files: ['/a.md'] },
    ]);
    const nativeDialogs: string[] = [];
    page.on('dialog', (dialog) => {
      nativeDialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/console');
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: `Revoke access for ${agentName}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Revoke access for ${agentName}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('2 active API keys stop working now.');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // Cancel changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('2 active keys')).toBeVisible();
    await page.getByRole('button', { name: `Revoke access for ${agentName}`, exact: true }).click();
    await page.getByRole('button', { name: 'Revoke 2 keys', exact: true }).click();
    await expect(page.locator('.toast')).toContainText(`Revoked access for ${agentName}.`);
    await expect(page.getByText('Access revoked')).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Revoke access for ${agentName}`, exact: true }),
    ).toHaveCount(0);

    // A single key uses the key dialog.
    await page.getByRole('button', { name: 'API keys', exact: true }).click();
    for (const key of ['Row key one', 'Row key two'])
      await expect(page.getByRole('button', { name: `Revoke ${key}`, exact: true })).toBeDisabled();
    expect(nativeDialogs).toEqual([]);
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

test('console row menu: arrow keys and spacing', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-menu-'));
  try {
    await seedRows(context, baseURL!, root, userId, [{ name: 'Menu drive', files: ['/m.md'] }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/console');
    const opener = page.getByRole('button', { name: /More actions for m\.md/ });
    await expect(opener).toBeVisible();
    await opener.focus();
    await page.keyboard.press('Enter');
    const items = rowMenu(page).locator('button.menu-item');
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveText('Versions');
    const count = await items.count();
    for (let index = 1; index < count; index += 1) {
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(index)).toBeFocused();
    }
    await expect(items.last()).toHaveText('Trash');
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    // Trash sits apart from the item above it.
    const above = (await items.nth(count - 2).boundingBox())!;
    const trash = (await items.last().boundingBox())!;
    expect(trash.y - (above.y + above.height)).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('Escape');
    await expect(rowMenu(page)).toHaveCount(0);
    await expect(opener).toBeFocused();

    // The key chip menu answers the same keys.
    await page.getByTestId('key-chip').click();
    await expect(page.getByTestId('key-menu').locator('button').first()).toBeFocused();
  } finally {
    await cleanupUser(userId);
    await rm(root, { recursive: true, force: true });
  }
});

test('console preview: decrypts in the tab, never renders HTML or SVG, and revokes blob URLs', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-preview-'));
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
    const drive = await post<{ id: string }>('drives', { name: 'Preview drive' });
    const agent = await post<{ id: string }>('agents', { name: 'Preview agent' });
    const key = await post<{ token: string }>('keys', {
      label: 'Preview key',
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
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    // A distinct sentinel per previewed file: none may appear in any request or console message.
    const sentinels = Object.fromEntries(
      [
        'notes.md',
        'evil.html',
        'evil.svg',
        'pixel.png',
        'disguised.png',
        'doc.pdf',
        'swap.txt',
      ].map((name) => [name, `SENTINEL-${name.replace('.', '-')}-${randomUUID()}`]),
    ) as Record<string, string>;
    const pdf = Buffer.from(
      `%${sentinels['doc.pdf']}\n%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    );
    const plaintext = {
      'notes.md': `# Title\n<b>bold</b>\n${sentinels['notes.md']}\n`,
      'evil.html': `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>${sentinels['evil.html']}`,
      'evil.svg': `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1"/>${sentinels['evil.svg']}`,
      'pixel.png': Buffer.concat([png, Buffer.from(sentinels['pixel.png']!)]),
      'disguised.png': `<html><script>window.__pwned=1</script>${sentinels['disguised.png']}</html>`,
      'swap.txt': sentinels['swap.txt']!,
      'doc.pdf': pdf,
      'big.log': Buffer.alloc(10.5 * 1024 * 1024, 'a'),
    };
    for (const [name, content] of Object.entries(plaintext)) {
      const local = join(root, name);
      await writeFile(local, content, { mode: 0o600 });
      const upload = await cli(['put', local, `/p/${name}`, '--drive', drive.id], environment);
      expect(upload.status, `upload ${name}: ${upload.stderr.slice(0, 300)}`).toBe(0);
    }
    const recovery = join(root, 'right.key.json');
    await writeFile(
      recovery,
      JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: driveKey }),
    );
    await page.addInitScript(() => {
      const w = window as unknown as { __made: string[]; __revoked: string[] };
      w.__made = [];
      w.__revoked = [];
      (w as unknown as { __imgErrors: string[] }).__imgErrors = [];
      window.addEventListener(
        'error',
        (event) => {
          if (event.target instanceof HTMLImageElement)
            (w as unknown as { __imgErrors: string[] }).__imgErrors.push(event.target.src);
        },
        true,
      );
      const make = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = make(blob);
        w.__made.push(`${(blob as Blob).type}|${url}`);
        return url;
      };
      URL.revokeObjectURL = (url: string) => {
        w.__revoked.push(url);
        revoke(url);
      };
    });
    // Every request (any URL, method, header, body) and every console message.
    const requests: string[] = [];
    const consoleText: string[] = [];
    page.on('request', (request) =>
      requests.push(
        `${request.method()} ${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ''}`,
      ),
    );
    page.on('console', (message) => consoleText.push(message.text()));
    page.on('pageerror', (error) => consoleText.push(String(error)));

    await page.goto('/console?path=/p');
    const nameButton = (name: string) => page.getByTitle(`Preview ${name}`, { exact: true });
    const preview = (name: string) => page.getByRole('dialog', { name });

    // 1. No key: the unlock dialog says the file opens afterwards, then the text is escaped.
    await nameButton('notes.md').click();
    await expect(page.getByText('After the key loads, notes.md opens.')).toBeVisible();
    await page.getByLabel('Choose recovery file').setInputFiles(recovery);
    await expect(preview('notes.md').locator('pre.preview-text')).toHaveText(
      `# Title\n<b>bold</b>\n${sentinels['notes.md']}\n`,
    );
    await expect(preview('notes.md').locator('b')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 2. HTML and SVG are source text. A PNG whose bytes are HTML is not rendered as HTML.
    for (const name of ['evil.html', 'evil.svg']) {
      await nameButton(name).click();
      const panel = preview(name);
      await expect(panel.locator('pre.preview-text')).toContainText(
        name === 'evil.html' ? 'onerror="window.__pwned=1"' : 'onload="window.__pwned=1"',
      );
      await expect(panel.locator('iframe, img, svg, script')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
        undefined,
      );
      await page.keyboard.press('Escape');
    }
    await nameButton('disguised.png').click();
    await expect(page.getByRole('dialog', { name: 'disguised.png' })).toBeVisible();
    await expect(page.getByText('This image could not be shown.')).toBeVisible();
    // A real image error event fired for the blob URL the console made for this file.
    const madeNow = await page.evaluate(() => (window as unknown as { __made: string[] }).__made);
    const disguisedUrl = madeNow.at(-1)!.split('|')[1];
    expect(madeNow.at(-1)).toMatch(/^image\/png\|blob:/);
    expect(
      await page.evaluate(() => (window as unknown as { __imgErrors: string[] }).__imgErrors),
    ).toContain(disguisedUrl);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    await page.keyboard.press('Escape');

    // 3. A real image comes from a console-typed blob and is revoked on Esc.
    await nameButton('pixel.png').click();
    const image = preview('pixel.png').locator('img');
    await expect(image).toBeVisible();
    expect(await image.getAttribute('src')).toMatch(/^blob:/);
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    const imageUrl = await image.getAttribute('src');
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked),
    ).toContain(imageUrl);
    await expect(nameButton('pixel.png')).toBeFocused();

    // 4. PDF: never embedded. Closing without opening revokes at once; opening goes to a tab
    // with no opener, and the URL stays alive for the new tab.
    await nameButton('doc.pdf').click();
    await expect(preview('doc.pdf').getByText('PDF files open in a separate tab.')).toBeVisible();
    await expect(page.locator('dialog iframe, dialog embed, dialog object')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await nameButton('doc.pdf').click();
    const openPdf = preview('doc.pdf').getByRole('button', { name: 'Open PDF in new tab' });
    await expect(openPdf).toBeEnabled();
    const popupPromise = context.waitForEvent('page');
    await openPdf.click();
    const popup = await popupPromise;
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    const pdfUrls = (
      await page.evaluate(() => (window as unknown as { __made: string[] }).__made)
    ).filter((entry) => entry.startsWith('application/pdf|'));
    expect(pdfUrls).toHaveLength(2);
    await page.keyboard.press('Escape');
    const revokedNow = await page.evaluate(
      () => (window as unknown as { __revoked: string[] }).__revoked,
    );
    expect(revokedNow).toContain(pdfUrls[0]!.split('|')[1]);
    expect(revokedNow).not.toContain(pdfUrls[1]!.split('|')[1]);
    await popup.close();

    // 5. Over the cap: no request for the file.
    const before = requests.length;
    await nameButton('big.log').click();
    await expect(page.getByText(/Too large to preview/)).toBeVisible();
    expect(requests.slice(before).some((entry) => entry.includes('big.log'))).toBe(false);
    await page.keyboard.press('Escape');

    // 5b. The preview shows the version that was listed, even if an agent replaced the file
    // after the list loaded: the request is pinned to that version id.
    const swapLocal = join(root, 'swap-big.txt');
    await writeFile(swapLocal, Buffer.alloc(10.5 * 1024 * 1024, 'b'));
    const current = (await (
      await context.request.get(
        `/api/console/drives/${drive.id}/get?path=%2Fp%2Fswap.txt&metadataOnly=1`,
      )
    ).json()) as { id: string };
    const swapped = await cli(
      ['put', swapLocal, '/p/swap.txt', '--drive', drive.id, '--if-version', current.id],
      environment,
    );
    expect(swapped.status, swapped.stderr.slice(0, 300)).toBe(0);
    const beforeSwap = requests.length;
    await nameButton('swap.txt').click();
    await expect(preview('swap.txt').locator('pre.preview-text')).toHaveText(
      sentinels['swap.txt']!,
    );
    expect(
      requests
        .slice(beforeSwap)
        .some((entry) => /\/get\?path=%2Fp%2Fswap\.txt&versionId=/.test(entry)),
    ).toBe(true);
    await page.keyboard.press('Escape');

    // 6. Neither the key nor any previewed plaintext crossed the network, console or storage.
    await expectNoStoredSecrets(page, driveKey, ['agent-drive:last-drive']);
    const outbound = [...requests, ...consoleText].join('\n');
    expect(outbound).not.toContain(driveKey);
    for (const value of [...Object.values(sentinels), '<b>bold</b>'])
      expect(outbound).not.toContain(value);
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanupUser(userId);
  }
});

test('console share: one link with the key only in the fragment, revoke in place, Shared view', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-share-'));
  const driveKey = randomBytes(32).toString('base64url');
  const body = `share body ${randomUUID()}\n`;
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const post = async <T>(path: string, data: unknown) =>
      (await (
        await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL! } })
      ).json()) as T;
    const drive = await post<{ id: string }>('drives', { name: 'Share drive' });
    const agent = await post<{ id: string }>('agents', { name: 'Share agent' });
    const key = await post<{ token: string }>('keys', {
      label: 'Share key',
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
    const local = join(root, 'report.md');
    await writeFile(local, body, { mode: 0o600 });
    const upload = await cli(['put', local, '/s/report.md', '--drive', drive.id], environment);
    expect(upload.status, upload.stderr.slice(0, 300)).toBe(0);
    const recovery = join(root, 'right.key.json');
    await writeFile(
      recovery,
      JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: driveKey }),
    );

    // Every request (URL, headers, body) and every console message.
    const requests: string[] = [];
    const consoleText: string[] = [];
    const sharePosts: { url: string; body: Record<string, unknown> }[] = [];
    let shareListLoads = 0;
    page.on('request', (request) => {
      requests.push(
        `${request.method()} ${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ''}`,
      );
      if (request.method() === 'POST' && /\/drives\/[^/]+\/shares$/.test(request.url()))
        sharePosts.push({ url: request.url(), body: request.postDataJSON() });
      if (request.method() === 'GET' && /\/drives\/[^/]+\/shares\?/.test(request.url()))
        shareListLoads += 1;
    });
    page.on('console', (message) => consoleText.push(message.text()));
    page.on('pageerror', (error) => consoleText.push(String(error)));
    await page.addInitScript(countClipboardWrites);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/console?drive=${drive.id}&path=%2Fs`);
    const row = page.locator('.file-panel tbody tr').filter({ hasText: 'report.md' });
    const dialog = page.getByRole('dialog', { name: 'Share report.md' });
    const openShare = async () => {
      await row.getByRole('button', { name: /More actions/ }).click();
      await rowMenu(page).getByRole('button', { name: 'Share', exact: true }).click();
    };

    // 1. No key: the unlock dialog says what happens next, then the Share dialog opens.
    await openShare();
    await expect(page.getByText('After the key loads, you can share report.md.')).toBeVisible();
    await page.getByLabel('Choose recovery file').setInputFiles(recovery);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '7 days' })).toBeChecked();

    // 2. One click: one POST, the link in the clipboard, the key only in its fragment.
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('status')).toContainText('Link copied.');
    const url1 = await page.evaluate(() => navigator.clipboard.readText());
    expect(url1).toMatch(/\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}$/);
    expect(sharePosts).toHaveLength(1);
    expect(Object.keys(sharePosts[0]!.body).sort()).toEqual(['expiresAt', 'path', 'versionId']);
    const ahead = Date.parse(String(sharePosts[0]!.body.expiresAt)) - Date.now();
    expect(Math.abs(ahead - 7 * 86_400_000)).toBeLessThan(5 * 60_000);
    expect(page.url()).not.toContain('#k=');

    // 3. A fresh browser context downloads the same bytes from the link.
    const outsider = await browser.newContext({ acceptDownloads: true });
    try {
      const guest = await outsider.newPage();
      await guest.goto(url1);
      const download = guest.waitForEvent('download', { timeout: 20_000 });
      await guest.getByRole('button', { name: 'Download' }).click({ timeout: 20_000 });
      expect((await readFile((await (await download).path())!)).toString()).toBe(body);
    } finally {
      await outsider.close();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // 4. A clipboard failure keeps one link and shows it in a read-only field; retrying creates nothing.
    await openShare();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      const deny = () => Promise.reject(new Error('denied'));
      Object.defineProperty(navigator.clipboard, 'write', { value: deny, configurable: true });
      Object.defineProperty(navigator.clipboard, 'writeText', { value: deny, configurable: true });
    });
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    const field = dialog.getByLabel('Share link');
    await expect(field).toBeVisible();
    await expect(field).toHaveJSProperty('readOnly', true);
    await expect(dialog.getByRole('status')).toContainText('Copy failed.');
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(field).toBeVisible();
    expect(sharePosts).toHaveLength(2);
    await expect(field).toHaveValue(/\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}$/);
    const url2 = await field.inputValue();
    expect(url2).not.toBe(url1);

    // 5. Both links are listed (newest first); revoking the older one is a two-step change in place.
    const links = dialog.getByTestId('share-link-row');
    await expect(links).toHaveCount(2);
    const loadsBefore = shareListLoads;
    await links.nth(1).getByRole('button', { name: 'Revoke' }).click();
    await expect(links.nth(1)).toContainText('Stop this link?');
    // Focus follows the control: Revoke -> Revoke link; Cancel -> back to Revoke.
    await expect(links.nth(1).getByRole('button', { name: 'Revoke link' })).toBeFocused();
    await links.nth(1).getByRole('button', { name: 'Cancel' }).click();
    await expect(links.nth(1).getByRole('button', { name: 'Revoke', exact: true })).toBeFocused();
    await links.nth(1).getByRole('button', { name: 'Revoke', exact: true }).click();
    await links.nth(1).getByRole('button', { name: 'Revoke link' }).click();
    await expect(links.nth(1)).toContainText('Revoked');
    // After success focus lands on the new status text, not on <body>.
    await expect(links.nth(1).locator('.share-state')).toBeFocused();
    expect(shareListLoads).toBe(loadsBefore);
    await expect(links.nth(0)).toContainText('Active');
    const revokedGuest = await browser.newContext();
    try {
      const guest = await revokedGuest.newPage();
      await guest.goto(url1);
      await expect(guest.getByTestId('share-error-share_revoked')).toBeVisible();
    } finally {
      await revokedGuest.close();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Closing the dialog leaves no key or key-bearing URL in the page, and no further clipboard writes.
    const afterClose = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      writes: (window as unknown as { __clipWrites: number }).__clipWrites,
    }));
    for (const secret of [url2.split('#k=')[1]!, url1.split('#k=')[1]!, '#k=', driveKey])
      expect(afterClose.html).not.toContain(secret);
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => (window as unknown as { __clipWrites: number }).__clipWrites),
    ).toBe(afterClose.writes);

    // 6. The Shared view lists both and survives a reload.
    await page.getByRole('button', { name: 'Shared', exact: true }).click();
    await expect(page).toHaveURL(/view=shared/);
    const shared = page.locator('.file-panel tbody tr');
    await expect(shared).toHaveCount(2);
    await expect(shared.filter({ hasText: 'Active' })).toHaveCount(1);
    await expect(shared.filter({ hasText: 'Revoked' })).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(shared).toHaveCount(2);

    // 7. Trash mentions the live link; Undo turns it back on.
    await page.goto(`/console?drive=${drive.id}&path=%2Fs`);
    await row.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    const toast = page.locator('.toast').last();
    await expect(toast).toContainText('Moved “report.md” to Trash.');
    await expect(toast).toContainText('Its 1 share link stops working until you restore it.');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toContainText('Restored “report.md”.', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Shared', exact: true }).click();
    await expect(shared.filter({ hasText: 'Active' })).toHaveCount(1);

    // 7b. A link whose file is in Trash is labelled and can still be revoked.
    await page.goto(`/console?drive=${drive.id}&path=%2Fs`);
    await row.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('Its 1 share link stops working');
    await page.getByRole('button', { name: 'Shared', exact: true }).click();
    const trashed = shared.filter({ hasText: 'Unavailable (file in Trash)' });
    await expect(trashed).toHaveCount(1);
    await trashed.getByRole('button', { name: 'Revoke', exact: true }).click();
    await trashed.getByRole('button', { name: 'Revoke link' }).click();
    await expect(shared.filter({ hasText: 'Revoked' })).toHaveCount(2);

    // 8. Neither the drive key nor any file key crossed the network, console or storage.
    const fileKeys = [url1, url2].map((url) => url.split('#k=')[1]!);
    await expectNoStoredSecrets(page, driveKey, ['agent-drive:last-drive']);
    const outbound = [...requests, ...consoleText].join('\n');
    expect(outbound).not.toContain(driveKey);
    expect(outbound).not.toContain('#k=');
    for (const fileKey of fileKeys) {
      expect(outbound).not.toContain(fileKey);
      const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
      expect(stored).not.toContain(fileKey);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanupUser(userId);
  }
});

// Counts calls to the async clipboard so a test can prove nothing is written after a dialog closes.
function countClipboardWrites() {
  const w = window as unknown as { __clipWrites: number };
  w.__clipWrites = 0;
  for (const method of ['write', 'writeText'] as const) {
    const original = navigator.clipboard[method].bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, method, {
      configurable: true,
      value: (...args: never[]) => {
        w.__clipWrites += 1;
        return (original as (...a: never[]) => Promise<void>)(...args);
      },
    });
  }
}

async function seedShareDrive(
  context: import('@playwright/test').BrowserContext,
  baseURL: string,
  root: string,
  userId: string,
) {
  const driveKey = randomBytes(32).toString('base64url');
  const login = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId },
  });
  expect(login.status()).toBe(200);
  const post = async <T>(path: string, data: unknown) =>
    (await (
      await context.request.post(`/api/console/${path}`, { data, headers: { Origin: baseURL } })
    ).json()) as T;
  const drive = await post<{ id: string }>('drives', { name: 'Share drive' });
  const agent = await post<{ id: string }>('agents', { name: 'Share agent' });
  const key = await post<{ token: string }>('keys', {
    label: 'Share key',
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
  const local = join(root, 'report.md');
  await writeFile(local, 'share body', { mode: 0o600 });
  const upload = await cli(['put', local, '/s/report.md', '--drive', drive.id], environment);
  expect(upload.status, upload.stderr.slice(0, 300)).toBe(0);
  const recovery = join(root, 'right.key.json');
  await writeFile(
    recovery,
    JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: driveKey }),
  );
  return { driveId: drive.id, driveKey, recovery };
}

for (const how of ['closing the dialog', 'the idle lock'] as const) {
  test(`console share: ${how} cancels an in-flight copy and nothing reaches the clipboard`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
    const root = await mkdtemp(join(tmpdir(), 'agent-drive-share-cancel-'));
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const { driveId, recovery } = await seedShareDrive(context, baseURL!, root, userId);
      await page.addInitScript(countClipboardWrites);
      if (how === 'the idle lock') await page.clock.install();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/drives/*/shares', async (route) => {
        if (route.request().method() === 'POST') await gate;
        await route.continue();
      });
      await page.goto(`/console?drive=${driveId}&path=%2Fs`);
      const row = page.locator('.file-panel tbody tr').filter({ hasText: 'report.md' });
      await row.getByRole('button', { name: /More actions/ }).click();
      await rowMenu(page).getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByLabel('Choose recovery file').setInputFiles(recovery);
      const dialog = page.getByRole('dialog', { name: 'Share report.md' });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const baseline = await page.evaluate(
        () => (window as unknown as { __clipWrites: number }).__clipWrites,
      );
      await dialog.getByRole('button', { name: 'Copy link' }).click();
      if (how === 'the idle lock') await page.clock.fastForward('31:00');
      else await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      release();
      await page.waitForTimeout(1500);
      // The clipboard still holds the sentinel; the key-bearing URL never reached it.
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('sentinel');
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      expect(html).not.toContain('#k=');
      // Only the one write started by the click itself: no write after the dialog went away.
      expect(
        await page.evaluate(() => (window as unknown as { __clipWrites: number }).__clipWrites),
      ).toBe(baseline + 1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await cleanupUser(userId);
    }
  });
}

test('console share: a lost response does not create a second link', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-share-lost-'));
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { driveId, recovery } = await seedShareDrive(context, baseURL!, root, userId);
    let posts = 0;
    await page.route('**/drives/*/shares', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      // The server commits the share, then the browser never sees the answer.
      if (posts === 1) {
        await route.fetch();
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.goto(`/console?drive=${driveId}&path=%2Fs`);
    const row = page.locator('.file-panel tbody tr').filter({ hasText: 'report.md' });
    await row.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Choose recovery file').setInputFiles(recovery);
    const dialog = page.getByRole('dialog', { name: 'Share report.md' });
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    // The dialog finds the link that was committed and copies it; it does not ask for a retry.
    await expect(dialog.getByRole('status')).toContainText('Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}$/,
    );
    await expect(dialog.getByTestId('share-link-row')).toHaveCount(1);
    expect(posts).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanupUser(userId);
  }
});

test('console polish: phone search row, account header, Drive ID, Restored toast', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const driveId = await seededDrive(context, baseURL!, userId, 'polish', [
      { path: '/a.md', at: minutesAgo(5) },
      { path: '/b.md', at: minutesAgo(4) },
    ]);
    // N1: search is a full-width, 44 px row on phones.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/console?drive=${driveId}`);
    const search = page.getByLabel('Search this folder');
    await expect(search).toBeVisible({ timeout: 30_000 });
    const box = (await search.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(280);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    // N8: Drive ID is short, the full id is the title and the copy text.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('drive-menu-button').click();
    await expect(page.getByTestId('drive-id')).toHaveText(`${driveId.slice(0, 8)}…`);
    await expect(page.getByTestId('drive-id')).toHaveAttribute('title', driveId);
    await page.keyboard.press('Escape');
    // N7: restoring a file that is already in view offers no "Show file".
    const row = page.locator('tr', { has: page.locator('[data-path="/a.md"]') });
    await row.getByRole('button', { name: /More actions/ }).click();
    await rowMenu(page).getByRole('button', { name: 'Trash', exact: true }).click();
    const toast = page.locator('.toast').first();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toContainText('Restored', { timeout: 15_000 });
    await expect(page.locator('[data-path="/a.md"]')).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Show file' })).toHaveCount(0);
    // N3: account header fits one short row on phones.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/console/settings');
    const header = page.locator('.billing-header');
    await expect(header).toBeVisible({ timeout: 30_000 });
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
    for (const name of ['Agent Drive', 'Billing & limits', 'Activity & deletion'])
      await expect(header.getByRole('link', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  } finally {
    await cleanupUser(userId);
  }
});

import { test, expect } from '@playwright/test';
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

test('new human workspace → encrypted CLI upload → browser download, restore, and revocation', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-browser-'));
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
    await page.getByRole('button', { name: 'Create your first drive' }).click();
    await page.getByLabel('Drive name').fill('Browser acceptance');
    await page.getByRole('button', { name: 'Create drive', exact: true }).click();
    const driveKey = await page.getByTestId('drive-key').inputValue();
    expect(driveKey.length).toBe(43);
    const recoveryDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save recovery key' }).click();
    const recovery = await recoveryDownload;
    const backup = JSON.parse(await readFile((await recovery.path())!, 'utf8')) as {
      driveId: string;
      key: string;
    };
    expect(backup.key === driveKey).toBe(true);
    await page.getByLabel('I saved my drive key securely').check();
    await page.getByRole('button', { name: 'Continue to drive' }).click();
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize(viewport);

    await page.reload();
    await expect(fileRow).toBeVisible();
    await expect(fileRow.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.getByRole('button', { name: 'Load drive key' }).click();
    await page.getByLabel('Drive key', { exact: true }).fill(randomBytes(32).toString('base64url'));
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await fileRow.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /decrypt/i })).toBeVisible();
    await page.getByRole('button', { name: 'Forget key' }).click();
    await page.getByRole('button', { name: 'Load drive key' }).click();
    await page.getByLabel('Drive key', { exact: true }).fill(driveKey);
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
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
    page.once('dialog', (dialog) => void dialog.accept());
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
    storage.destroy();
    await database.end();
    await rm(root, { recursive: true, force: true });
  }
});

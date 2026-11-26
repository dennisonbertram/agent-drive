import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

function cli(args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveResult) => {
    const child = spawn(process.execPath, [resolve('packages/agent-drive/dist/cli.js'), ...args], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('close', (status) => resolveResult({ status, stdout, stderr }));
  });
}

test('owner save retry reacquires a forgotten key instead of reusing the old key', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-download-lock-'));
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
  let driveId = '';
  let accountId = '';
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const post = async <T>(path: string, body: unknown) => {
      const response = await context.request.post(`/api/console/${path}`, {
        data: body,
        headers: { Origin: baseURL! },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()) as T;
    };
    const drive = await post<{ id: string }>('drives', { name: 'Picker retry drive' });
    driveId = drive.id;
    const agent = await post<{ id: string }>('agents', { name: 'Picker retry agent' });
    const apiKey = await post<{ token: string }>('keys', {
      label: 'Picker retry key',
      agentId: agent.id,
      driveIds: [drive.id],
      scopes: ['read', 'write'],
    });
    const driveKey = randomBytes(32).toString('base64url');
    const plaintext = Buffer.alloc(32 * 1024 * 1024 + 1);
    const sourcePath = join(root, 'retry.txt');
    await writeFile(sourcePath, plaintext, { mode: 0o600 });
    const upload = await cli(['put', sourcePath, '/retry.txt', '--drive', drive.id], {
      ...process.env,
      AGENT_DRIVE_API_URL: baseURL!,
      AGENT_DRIVE_API_KEY: apiKey.token,
      AGENT_DRIVE_KEY: driveKey,
      AGENT_DRIVE_CONFIG: join(root, 'config.json'),
    });
    expect(upload.status, upload.stderr).toBe(0);
    const account = await database.query<{ id: string }>(
      'SELECT id FROM accounts WHERE external_clerk_user_id=$1',
      [userId],
    );
    accountId = account.rows[0]!.id;

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: {} });
      const state = { pickerCalls: 0, bytesWritten: 0, closed: false };
      (window as unknown as { __pickerState: typeof state }).__pickerState = state;
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          state.pickerCalls += 1;
          if (state.pickerCalls === 1)
            throw new DOMException('The original click activation expired.', 'SecurityError');
          return {
            createWritable: async () => ({
              write: async (chunk: Uint8Array) => {
                state.bytesWritten += chunk.byteLength;
              },
              close: async () => {
                state.closed = true;
              },
              abort: async () => undefined,
            }),
          };
        },
      });
    });
    await page.goto(`/console?drive=${drive.id}`);
    await expect(page.getByTitle('Preview retry.txt')).toBeVisible();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const recovery = {
      name: 'recovery.key.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ format: 'agent-drive-key-v1', driveId: drive.id, key: driveKey }),
      ),
    };
    const chooseRecovery = page.getByLabel('Choose recovery file');
    await expect(chooseRecovery).toBeVisible();
    await chooseRecovery.setInputFiles(recovery);
    await expect(page.getByRole('button', { name: 'Save file again' })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __pickerState: { pickerCalls: number } }).__pickerState
            .pickerCalls,
      ),
    ).toBe(1);

    // Clear the only loaded drive-key copy while retaining the file-only save retry action.
    await page.getByTestId('key-chip').click();
    await page.getByTestId('key-menu').getByRole('button', { name: 'Forget key' }).click();
    await expect(page.getByTestId('key-chip')).toContainText('Key needed');
    await page.getByRole('button', { name: 'Save file again' }).click();
    const retryRecovery = page.getByLabel('Choose recovery file');
    await expect(retryRecovery).toBeVisible();
    await retryRecovery.setInputFiles(recovery);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __pickerState: { pickerCalls: number; bytesWritten: number; closed: boolean };
              }
            ).__pickerState,
        ),
      )
      .toEqual({ pickerCalls: 2, bytesWritten: plaintext.byteLength, closed: true });
  } finally {
    if (accountId) {
      for (const prefix of [`objects/${accountId}/`, `staging/${accountId}/`]) {
        let continuationToken: string | undefined;
        do {
          const objects = await storage.send(
            new ListObjectsV2Command({
              Bucket: process.env.S3_BUCKET,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
          );
          for (const object of objects.Contents ?? [])
            if (object.Key)
              await storage.send(
                new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key }),
              );
          continuationToken = objects.NextContinuationToken;
        } while (continuationToken);
      }
      await database.query('DELETE FROM audit_events WHERE account_id=$1', [accountId]);
      if (driveId) await database.query('DELETE FROM file_events WHERE drive_id=$1', [driveId]);
      if (driveId) await database.query('DELETE FROM versions WHERE drive_id=$1', [driveId]);
      await database.query('DELETE FROM accounts WHERE id=$1', [accountId]);
    }
    await context.close();
    await database.end();
    storage.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('CLI share links download, expire, revoke, and never send fragment keys', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const database = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive',
  });
  const storage = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
    },
  });
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-sharing-e2e-'));
  const accountId = randomUUID();
  const agentId = randomUUID();
  const driveId = randomUUID();
  const token = `adk_${randomBytes(32).toString('base64url')}`;
  const driveKey = randomBytes(32).toString('base64url');
  const environment = {
    ...process.env,
    AGENT_DRIVE_API_URL: baseURL!,
    AGENT_DRIVE_API_KEY: token,
    AGENT_DRIVE_KEY: driveKey,
    AGENT_DRIVE_CONFIG: join(root, 'config.json'),
  };
  const requestRecords: string[] = [];
  const context = await browser.newContext();
  context.on('request', (request) => {
    requestRecords.push(
      JSON.stringify({
        url: request.url(),
        headers: request.headers(),
        postData: request.postData(),
      }),
    );
  });
  const page = await context.newPage();
  try {
    const account = await database.query('INSERT INTO accounts (id, name) VALUES ($1, $2)', [
      accountId,
      `sharing-e2e-${randomUUID()}`,
    ]);
    void account;
    await database.query('INSERT INTO agents (id,account_id,name) VALUES ($1,$2,$3)', [
      agentId,
      accountId,
      `sharing-agent-${randomUUID()}`,
    ]);
    await database.query('INSERT INTO drives (id,account_id,name) VALUES ($1,$2,$3)', [
      driveId,
      accountId,
      `sharing-drive-${randomUUID()}`,
    ]);
    await database.query(
      `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes)
       VALUES ($1,$2,'sharing-e2e',$3,$4::uuid[],ARRAY['read','write','share']::text[])`,
      [accountId, agentId, createHash('sha256').update(token).digest('hex'), [driveId]],
    );

    const fileA = Buffer.concat([randomBytes(37), randomBytes(1024)]);
    const fileB = Buffer.concat([randomBytes(37), randomBytes(257)]);
    await writeFile(join(root, 'a.bin'), fileA, { mode: 0o600 });
    await writeFile(join(root, 'b.bin'), fileB, { mode: 0o600 });
    const uploadA = await cli(
      ['put', join(root, 'a.bin'), '/sharing/a.bin', '--drive', driveId],
      environment,
    );
    expect(uploadA.status).toBe(0);
    const uploadB = await cli(
      ['put', join(root, 'b.bin'), '/sharing/b.bin', '--drive', driveId],
      environment,
    );
    expect(uploadB.status).toBe(0);
    const createShare = async (path: string) => {
      const result = await cli(['share', path, '--drive', driveId], environment);
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout) as { id: string; url: string };
    };
    const shareA = await createShare('/sharing/a.bin');
    const fileKeyA = new URL(shareA.url).hash.slice(3);
    const shareKeys = [fileKeyA];
    const sharePageResponse = await page.goto(shareA.url);
    expect(sharePageResponse?.headers()['referrer-policy']).toBe('no-referrer');
    expect(sharePageResponse?.headers()['cache-control']).toContain('no-store');
    expect(sharePageResponse?.headers()['x-robots-tag']).toBe('noindex');
    await expect(page.getByTestId('share-page')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    expect((await readFile((await (await download).path())!)).equals(fileA)).toBe(true);

    const revoked = await cli(['share', 'revoke', shareA.id, '--drive', driveId], environment);
    expect(revoked.status).toBe(0);
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByTestId('share-error-share_revoked')).toBeVisible();

    await page.goto(`${baseURL}/s/${shareA.id}`);
    await expect(page.getByTestId('share-error-missing-key')).toBeVisible();
    await page.goto(`${baseURL}/s/AAAAAAAAAAAAAAAAAAAAAA#k=${fileKeyA}`);
    await expect(page.getByTestId('share-error-not_found')).toBeVisible();

    const shareExpired = await createShare('/sharing/a.bin');
    const fileKeyExpired = new URL(shareExpired.url).hash.slice(3);
    shareKeys.push(fileKeyExpired);
    await database.query(
      `UPDATE shares SET created_at = now() - interval '2 seconds',
                         expires_at = now() - interval '1 second'
        WHERE id = $1`,
      [shareExpired.id],
    );
    await page.goto(shareExpired.url);
    await expect(page.getByTestId('share-error-share_expired')).toBeVisible();

    const shareB = await createShare('/sharing/b.bin');
    const fileKeyB = new URL(shareB.url).hash.slice(3);
    shareKeys.push(fileKeyB);
    await page.goto(`${baseURL}/s/${shareB.id}#k=${fileKeyA}`);
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByTestId('share-error-decryption-failed')).toBeVisible();
    await page.evaluate((key) => {
      window.location.hash = `k=${key}`;
    }, fileKeyB);
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
    const downloadB = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    const downloadedPathB = await (await downloadB).path();
    expect(downloadedPathB).not.toBeNull();
    expect((await readFile(downloadedPathB!)).equals(fileB)).toBe(true);

    const origins = new Set(
      requestRecords.map((item) => new URL((JSON.parse(item) as { url: string }).url).origin),
    );
    expect(
      [...origins].every(
        (origin) =>
          origin === new URL(baseURL!).origin ||
          origin === new URL(process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000').origin,
      ),
    ).toBe(true);
    expect(shareKeys.every((key) => requestRecords.every((record) => !record.includes(key)))).toBe(
      true,
    );
    expect(requestRecords.some((record) => record.includes('#k='))).toBe(false);

    const serverLog = await readFile('test-results/web-server.log', 'utf8');
    expect(serverLog).toContain(`/s/${shareA.id}`);
    expect(serverLog).toContain(`/s/${shareExpired.id}`);
    expect(serverLog).toContain(`/s/${shareB.id}`);
    expect(shareKeys.every((key) => !serverLog.includes(key))).toBe(true);
    expect(serverLog.includes('#k=')).toBe(false);
  } finally {
    await context.close();
    for (const prefix of [`objects/${accountId}/`, `staging/${accountId}/`]) {
      let continuationToken: string | undefined;
      do {
        const result = await storage.send(
          new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET ?? 'agent-drive-local',
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const item of result.Contents ?? [])
          if (item.Key)
            await storage.send(
              new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET ?? 'agent-drive-local',
                Key: item.Key,
              }),
            );
        continuationToken = result.NextContinuationToken;
      } while (continuationToken);
    }
    await database.query('DELETE FROM audit_events WHERE account_id=$1', [accountId]);
    await database.query('DELETE FROM file_events WHERE drive_id=$1', [driveId]);
    await database.query('DELETE FROM versions WHERE drive_id=$1', [driveId]);
    await database.query('DELETE FROM accounts WHERE id=$1', [accountId]);
    storage.destroy();
    await database.end();
    await rm(root, { recursive: true, force: true });
  }
});

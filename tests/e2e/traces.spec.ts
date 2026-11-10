import { test, expect, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const EMPTY_DRIVE = /This drive has no files yet\. Load its recovery file or credentials bundle/;

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
      await database.query('DELETE FROM drive_webhook_tokens WHERE account_id=$1', [id]);
      await database.query('DELETE FROM drive_trace_inboxes WHERE account_id=$1', [id]);
      await database.query('DELETE FROM accounts WHERE id=$1', [id]);
    }
  } finally {
    storage.destroy();
    await database.end();
  }
}

// What OpenRouter's OTLP webhook sends, reduced to the fields the server reads.
const fixture = (model: string, start: string, prompt: string, reply: string) => ({
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: [
            {
              startTimeUnixNano: String(BigInt(Date.parse(start)) * 1_000_000n),
              attributes: [
                { key: 'gen_ai.request.model', value: { stringValue: model } },
                { key: 'gen_ai.prompt', value: { stringValue: prompt } },
                { key: 'gen_ai.completion', value: { stringValue: reply } },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const addWebhook = (page: Page) => page.getByRole('button', { name: 'Add webhook' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Capture traces' });

test('ux round 05: traces capture guidance preserves its commands and webhook safeguards', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    expect(login.status()).toBe(200);
    const created = await context.request.post('/api/console/drives', {
      data: { name: 'Trace drive' },
      headers: { Origin: baseURL! },
    });
    const driveId = ((await created.json()) as { id: string }).id;
    // The drive key never reaches the server; the console only ever sees this bundle.
    const driveKey = randomBytes(32).toString('base64url');
    const bundle = `adcred1.${Buffer.from(JSON.stringify({ v: 1, driveKeys: { [driveId]: driveKey } })).toString('base64url')}`;

    // Traces from the Recent view with a changed Browse sort lands on the /traces list.
    await page.goto(`/console?drive=${driveId}`);
    // The sort menu is shown on narrow screens only.
    await page.setViewportSize({ width: 600, height: 900 });
    await page.getByLabel('Sort by').selectOption('name');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Recent', exact: true }).click();
    await page.getByTestId('traces-link').click();
    await expect(page).toHaveURL(/path=%2Ftraces/);
    await expect(page).toHaveURL(/view=recent/);
    await expect(page.getByRole('heading', { name: 'No traces yet.' })).toBeVisible();

    // A raw key cannot be matched to an empty drive, and is not kept.
    await page.getByTestId('capture-link').click();
    await expect(dialog(page)).toContainText(
      'Connect to Agent Drive and load this drive’s key on your agent’s machine first. Run Claude Code or Codex through capture to save encrypted traces under /traces. Check terminal output: capture may be disabled, uploads may be queued, or calls may not be captured.',
    );
    await addWebhook(page).click();
    await page.getByText('Paste a key instead').click();
    await page
      .getByLabel(/^Drive key or credentials bundle/)
      .fill(randomBytes(32).toString('base64url'));
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await expect(dialog(page).getByRole('alert').filter({ hasText: EMPTY_DRIVE })).toBeVisible();

    // The bundle names the drive, so it is accepted. URL and headers are shown once.
    await addWebhook(page).click();
    await page.getByText('Paste a key instead').click();
    await page.getByLabel(/^Drive key or credentials bundle/).fill(bundle);
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    const url = (await page.getByTestId('webhook-url').innerText()).trim();
    expect(url).toBe(`${baseURL}/api/webhooks/openrouter/${driveId}`);
    const headers = (await page.getByTestId('webhook-headers').innerText()).trim();
    const bearer = (JSON.parse(headers) as { Authorization: string }).Authorization;
    expect(bearer).toMatch(/^Bearer adw_/);
    await expect(dialog(page)).toContainText('leave Privacy Mode off for this destination');
    await expect(dialog(page)).toContainText('it never holds your drive key');

    // OpenRouter delivers two traces; the later upload lists first even though it is the earlier call.
    const send = (authorization: string, body: unknown) =>
      context.request.post(url, { headers: { Authorization: authorization }, data: body });
    const a = await send(
      bearer,
      fixture('model-a', '2026-11-08T10:00:00Z', 'PROMPT-SENTINEL-7f3a', 'REPLY-SENTINEL-9c1e'),
    );
    expect(a.status()).toBe(201);
    const b = await send(
      bearer,
      fixture('model-b', '2026-11-08T09:00:00Z', 'PROMPT-SENTINEL-b2d4', 'REPLY-SENTINEL-e581'),
    );
    expect(b.status()).toBe(201);
    await page.keyboard.press('Escape');
    await page.getByTestId('traces-link').click();
    const rows = page.locator('.file-panel tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('model-b');
    await expect(rows.nth(1)).toContainText('model-a');
    await expect(rows.nth(0)).toContainText('/traces/openrouter/2026-11-08');
    // The agent list was loaded before the webhook created the openrouter agent.
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('openrouter');

    // The preview needs the key: it was cached when the bundle loaded.
    await rows.nth(1).locator('[title^="Preview "]').click();
    const preview = page.getByRole('dialog').last();
    await expect(preview).toContainText('PROMPT-SENTINEL-7f3a');
    await expect(preview).toContainText('REPLY-SENTINEL-9c1e');
    await page.keyboard.press('Escape');

    // The Shared view reaches the same list.
    await page.getByRole('button', { name: 'Shared', exact: true }).click();
    await page.getByTestId('traces-link').click();
    await expect(rows).toHaveCount(2);

    // Management works with files present. Replace revokes the old bearer.
    await page.getByTestId('capture-link').click();
    await expect(page.getByTestId('webhook-token-row')).toBeVisible();
    await page.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByTestId('webhook-created')).toBeVisible();
    const next = (
      JSON.parse((await page.getByTestId('webhook-headers').innerText()).trim()) as {
        Authorization: string;
      }
    ).Authorization;
    expect(next).not.toBe(bearer);
    const body = fixture('model-c', '2026-11-08T11:00:00Z', 'p', 'r');
    expect((await send(bearer, body)).status()).toBe(401);
    expect((await send(next, body)).status()).toBe(201);

    await dialog(page).getByRole('button', { name: 'Revoke', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Revoke webhook' }).click();
    await expect(addWebhook(page)).toBeVisible();
    expect((await send(next, body)).status()).toBe(401);

    // Nothing secret is stored in the browser.
    const stored = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }));
    expect(stored.session).toEqual([]);
    const text = JSON.stringify(stored);
    for (const secret of [driveKey, 'adk_', 'adw_', 'adcred1.']) expect(text).not.toContain(secret);
  } finally {
    await cleanupUser(userId);
  }
});

test('traces: the dialog cannot be closed while a token is being created, and revoke returns focus', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    const created = await context.request.post('/api/console/drives', {
      data: { name: 'Trace drive' },
      headers: { Origin: baseURL! },
    });
    const driveId = ((await created.json()) as { id: string }).id;
    const driveKey = randomBytes(32).toString('base64url');
    const bundle = `adcred1.${Buffer.from(JSON.stringify({ v: 1, driveKeys: { [driveId]: driveKey } })).toString('base64url')}`;
    // Hold the token POST so the test can try to close the dialog while it is in flight.
    let release = () => {};
    const gate = new Promise<void>((done) => (release = done));
    await page.route('**/webhook-token', async (route) => {
      if (route.request().method() === 'POST') await gate;
      await route.continue();
    });
    await page.goto(`/console?drive=${driveId}`);
    await page.getByTestId('capture-link').click();
    await addWebhook(page).click();
    await page.getByText('Paste a key instead').click();
    await page.getByLabel(/^Drive key or credentials bundle/).fill(bundle);
    await page.getByRole('button', { name: 'Load key', exact: true }).click();
    await expect(dialog(page).getByText('Setting up…')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Close dialog' })).toHaveCount(0);
    release();
    await expect(page.getByTestId('webhook-created')).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Revoke', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Revoke webhook' }).click();
    await expect(addWebhook(page)).toBeFocused();
  } finally {
    await cleanupUser(userId);
  }
});

test('traces: on a phone the header buttons give way to the drive menu', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const userId = `e2e_${randomUUID().replaceAll('-', '')}`;
  try {
    await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId },
    });
    const created = await context.request.post('/api/console/drives', {
      data: { name: 'Trace drive' },
      headers: { Origin: baseURL! },
    });
    const driveId = ((await created.json()) as { id: string }).id;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/console?drive=${driveId}`);
    await expect(page.getByTestId('traces-link')).toBeHidden();
    await expect(page.getByTestId('capture-link')).toBeHidden();

    await page.getByTestId('drive-menu-button').click();
    await expect(page.getByRole('button', { name: 'Traces', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Traces', exact: true }).click();
    await expect(page).toHaveURL(/path=%2Ftraces/);
    await expect(page).toHaveURL(/view=recent/);

    await page.getByTestId('drive-menu-button').click();
    await page.getByRole('button', { name: 'Capture traces…' }).click();
    await expect(dialog(page)).toBeVisible();
  } finally {
    await cleanupUser(userId);
  }
});

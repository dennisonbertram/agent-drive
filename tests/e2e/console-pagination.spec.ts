import { test, expect } from '@playwright/test';

const volume = 250;

function page<T>(kind: string, cursor: string | null, values: T[]) {
  const offset = cursor ? Number(cursor.split(':')[1]) : 0;
  const items = values.slice(offset, offset + 100);
  const next = offset + items.length;
  return {
    items,
    nextCursor: next < values.length ? `${kind}:${next}` : null,
  };
}

test('console pages large synthetic lists after first paint and recovers from a failed page', async ({
  page: browser,
  context,
}) => {
  const drives = Array.from({ length: volume }, (_, index) => ({
    id: `drive-${String(index).padStart(3, '0')}`,
    name: `Synthetic drive ${String(index).padStart(3, '0')}`,
    quota_bytes: '1000000',
    key_backup_at: null,
    key_backup_method: null,
  }));
  const agents = Array.from({ length: volume }, (_, index) => ({
    id: `agent-${String(index).padStart(3, '0')}`,
    name: `Synthetic agent ${String(index).padStart(3, '0')}`,
  }));
  const keys = Array.from({ length: volume }, (_, index) => ({
    id: `key-${String(index).padStart(3, '0')}`,
    label: `Synthetic key ${String(index).padStart(3, '0')}`,
    agent_id: agents[index]!.id,
    drive_ids: [drives[index]!.id],
    scopes: ['read'],
    revoked_at: null,
  }));
  const shares = Array.from({ length: volume }, (_, index) => ({
    id: `share-${String(index).padStart(3, '0')}`,
    path: `/volume/file-${String(index).padStart(3, '0')}.txt`,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    revokedAt: null,
    versionId: `version-${String(index).padStart(3, '0')}`,
  }));
  const searchResults = Array.from({ length: volume }, (_, index) => ({
    id: `search-file-${String(index).padStart(3, '0')}`,
    path: `/matches/search-${String(index).padStart(3, '0')}.txt`,
    ciphertext_size: 12,
    created_at: new Date(0).toISOString(),
    kind: 'file',
  }));
  const deleted = Array.from({ length: volume }, (_, index) => ({
    id: `deleted-file-${String(index).padStart(3, '0')}`,
    path: `/archive/deleted-${String(index).padStart(3, '0')}.txt`,
    ciphertext_size: 12,
    deletedAt: new Date(0).toISOString(),
    kind: 'file',
  }));
  const browseItems = [
    {
      id: 'browse-file',
      path: '/browse.txt',
      ciphertext_size: 8,
      created_at: new Date(0).toISOString(),
      kind: 'file',
    },
  ];
  const calls = new Map<string, number>();
  const record = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1);
  let releaseUsage!: () => void;
  const heldUsage = new Promise<void>((resolve) => {
    releaseUsage = resolve;
  });

  await browser.route('**/api/console/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/console/', '');
    const collection = path === 'drives' || path === 'agents' || path === 'keys' ? path : null;
    if (collection) {
      record(`${collection}:${url.searchParams.get('cursor') ?? 'first'}`);
      const entries: Array<
        (typeof drives)[number] | (typeof agents)[number] | (typeof keys)[number]
      > = collection === 'drives' ? drives : collection === 'agents' ? agents : keys;
      await route.fulfill({ json: page(collection, url.searchParams.get('cursor'), entries) });
      return;
    }
    if (path === 'usage') {
      record('usage');
      await heldUsage;
      await route.fulfill({
        status: 503,
        json: { error: { message: 'Synthetic usage failure. Try again.' } },
      });
      return;
    }
    if (path === 'device/BCDF-GHJK') {
      await route.fulfill({
        json: {
          user_code: 'BCDF-GHJK',
          client_name: 'Synthetic agent',
          machine: null,
          created_at: new Date(0).toISOString(),
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          creates_drive: true,
          public_key: 'synthetic-public-key',
        },
      });
      return;
    }
    if (/^drives\/[^/]+\/shares$/.test(path)) {
      record(`shares:${url.searchParams.get('cursor') ?? 'first'}`);
      await route.fulfill({ json: page('shares', url.searchParams.get('cursor'), shares) });
      return;
    }
    if (/^drives\/[^/]+\/trash$/.test(path)) {
      const cursor = url.searchParams.get('cursor');
      const requestName = `trash:${cursor ?? 'first'}`;
      record(requestName);
      if (cursor && calls.get(requestName) === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { message: 'Synthetic page failure. Try again.' } },
        });
        return;
      }
      await route.fulfill({ json: page('trash', cursor, deleted) });
      return;
    }
    if (/^drives\/[^/]+\/list$/.test(path)) {
      if (url.searchParams.has('q')) {
        record(`search:${url.searchParams.get('cursor') ?? 'first'}`);
        await route.fulfill({
          json: page('search', url.searchParams.get('cursor'), searchResults),
        });
        return;
      }
      record('file-list');
      await route.fulfill({ json: { items: browseItems, nextCursor: null } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${path}` } } });
  });

  const authSecret = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
  if (!authSecret) throw new Error('The isolated pagination test auth secret is missing.');
  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret}` },
    data: { userId: 'e2e_pagination_volume_test' },
  });
  expect(session.status()).toBe(200);
  await browser.goto('/console');
  await expect(browser.getByTestId('drive-menu-button')).toBeVisible();
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Synthetic drive 000');
  await expect(browser.getByText('browse.txt', { exact: true })).toBeVisible();
  expect(calls.get('drives:first')).toBe(1);
  expect(calls.get('agents:first')).toBe(1);
  expect(calls.get('keys:first')).toBe(1);
  expect(calls.has('usage')).toBe(false);
  expect(calls.has('drives:drives:100')).toBe(false);
  expect(calls.has('agents:agents:100')).toBe(false);
  expect(calls.has('keys:keys:100')).toBe(false);

  await browser.getByTestId('drive-menu-button').click();
  await expect.poll(() => calls.get('usage')).toBe(1);
  await expect(browser.getByText('browse.txt', { exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'Load more drives' }).click();
  await expect(browser.getByRole('button', { name: /Synthetic drive 149/ })).toBeVisible();
  expect(calls.get('drives:drives:100')).toBe(1);
  releaseUsage();
  await browser.getByRole('button', { name: /Synthetic drive 149/ }).click();
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Synthetic drive 149');
  await browser.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Synthetic drive 149');
  await browser.getByTestId('drive-menu-button').click();
  await expect(
    browser.getByRole('button', { name: 'Synthetic drive 149', exact: true }),
  ).toBeAttached();

  await browser.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(browser.getByText('Synthetic agent 000', { exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'Load more agents' }).click();
  await expect(browser.getByText('Synthetic agent 149', { exact: true })).toBeVisible();

  await browser.getByRole('button', { name: 'API keys', exact: true }).click();
  await expect(browser.getByText('Synthetic key 000', { exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'Load more API keys' }).click();
  await expect(browser.getByText('Synthetic key 149', { exact: true })).toBeVisible();

  await browser.getByRole('button', { name: 'Files', exact: true }).click();
  await browser.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(browser.getByText('file-000.txt', { exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'Load more links' }).click();
  await expect(browser.getByText('file-149.txt', { exact: true })).toBeVisible();
  expect(calls.get('shares:shares:100')).toBe(1);

  await browser.getByRole('button', { name: 'Browse', exact: true }).click();
  await browser.getByLabel('Search this folder').fill('match');
  await expect(browser.getByText('search-000.txt', { exact: true })).toBeVisible();
  expect(calls.get('search:first')).toBe(1);
  await browser.getByRole('button', { name: 'Load more' }).click();
  await expect(browser.getByText('search-149.txt', { exact: true })).toBeVisible();
  expect(calls.get('search:search:100')).toBe(1);

  await browser.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(browser.locator('.file-name').getByText('deleted-000.txt')).toBeVisible();
  expect(calls.get('trash:first')).toBe(1);
  await browser.getByRole('button', { name: 'Load more' }).click();
  await expect(browser.locator('.list-more [role="alert"]')).toContainText(
    'Synthetic page failure. Try again.',
  );
  expect(calls.get('trash:trash:100')).toBe(1);
  await browser.getByRole('button', { name: 'Load more' }).click();
  await expect(browser.locator('.file-name').getByText('deleted-149.txt')).toBeVisible();
  expect(calls.get('trash:trash:100')).toBe(2);

  await browser.getByRole('button', { name: 'API keys', exact: true }).click();
  await browser.getByRole('button', { name: '+ New API key' }).click();
  const dialog = browser.getByRole('dialog');
  const create = dialog.getByRole('button', { name: 'Create API key', exact: true });
  await expect(create).toBeDisabled();
  await dialog.getByRole('button', { name: 'Load all agents and drives' }).click();
  await expect(
    dialog.getByText('Load every agent and drive before choosing where this key can connect.'),
  ).toHaveCount(0);
  await expect(create).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(calls.get('drives:drives:100')).toBe(2);
  expect(calls.get('drives:drives:200')).toBe(1);
  expect(calls.get('agents:agents:100')).toBe(1);
  expect(calls.get('agents:agents:200')).toBe(1);

  await browser.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(browser.getByRole('heading', { name: 'Usage could not be loaded.' })).toBeVisible();
  await expect(
    browser.getByText('Synthetic usage failure. Try again.', { exact: true }),
  ).toBeVisible();
  expect(calls.get('usage')).toBe(3);
  await browser.getByRole('button', { name: 'Retry usage' }).click();
  await expect.poll(() => calls.get('usage')).toBe(4);
  await expect(browser.getByRole('heading', { name: 'Usage could not be loaded.' })).toBeVisible();

  await browser.goto('/connect?code=BCDF-GHJK');
  await browser.getByText('Details', { exact: true }).click();
  await browser
    .getByRole('button', { name: 'Use one of my drives instead (needs its recovery file)' })
    .waitFor({ state: 'visible' });
  expect(calls.get('drives:first')).toBe(3);
  expect(calls.get('drives:drives:100')).toBe(2);
  await browser
    .getByRole('button', { name: 'Use one of my drives instead (needs its recovery file)' })
    .click();
  await browser.getByRole('button', { name: 'Load more drives' }).click();
  await expect(browser.getByRole('option', { name: 'Synthetic drive 149' })).toBeAttached();
  expect(calls.get('drives:drives:100')).toBe(3);
});

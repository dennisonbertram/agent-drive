import { test, expect } from '@playwright/test';

// A console link names a drive that is not in the signed-in account. The linked
// folder must never be fetched or shown against another drive: the console says
// the linked drive is unavailable and opens a fallback at its own root instead.

function page<T>(kind: string, cursor: string | null, values: T[]) {
  const offset = cursor ? Number(cursor.split(':')[1]) : 0;
  const items = values.slice(offset, offset + 100);
  const next = offset + items.length;
  return {
    items,
    nextCursor: next < values.length ? `${kind}:${next}` : null,
  };
}

const authSecret = () => {
  const secret = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
  if (!secret) throw new Error('The isolated drive-link test auth secret is missing.');
  return secret;
};

test('console link: an unavailable drive opens a fallback root with an explanation', async ({
  page: browser,
  context,
}) => {
  const drives = [
    {
      id: 'drive-own',
      name: 'Own drive',
      quota_bytes: '1000000',
      key_backup_at: null,
      key_backup_method: null,
    },
    {
      id: 'drive-alt',
      name: 'Alt drive',
      quota_bytes: '1000000',
      key_backup_at: null,
      key_backup_method: null,
    },
  ];
  const prefixes: string[] = [];
  await browser.route('**/api/console/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/console/', '');
    if (path === 'drives' || path === 'agents' || path === 'keys') {
      const entries = path === 'drives' ? drives : [];
      await route.fulfill({ json: { items: entries, nextCursor: null } });
      return;
    }
    if (path === 'usage') {
      await route.fulfill({
        json: {
          plan: 'test',
          limits: { storageBytes: '0', operations: '0', drives: '0' },
          storageBytes: 0,
          operations: 0,
          drives: [],
          agents: [],
        },
      });
      return;
    }
    if (/^drives\/[^/]+\/list$/.test(path)) {
      prefixes.push(url.searchParams.get('prefix') ?? '');
      const linked = url.searchParams.get('prefix') === '/linked/folder';
      await route.fulfill({
        json: {
          items: linked
            ? [
                {
                  id: 'decoy-file',
                  path: '/linked/folder/decoy.txt',
                  ciphertext_size: 8,
                  created_at: new Date(0).toISOString(),
                  kind: 'file',
                },
              ]
            : [
                {
                  id: 'own-file',
                  path: '/own-note.txt',
                  ciphertext_size: 8,
                  created_at: new Date(0).toISOString(),
                  kind: 'file',
                },
              ],
          nextCursor: null,
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${path}` } } });
  });

  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret()}` },
    data: { userId: 'e2e_drive_link_test' },
  });
  expect(session.status()).toBe(200);

  // No drive in the URL keeps the quiet remembered-drive behaviour.
  await browser.goto('/console');
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Own drive');
  await expect(browser.getByText('own-note.txt', { exact: true })).toBeVisible();
  await expect(browser.getByText(/isn.t available in this account/)).toHaveCount(0);

  await browser.goto('/console?drive=drv_missing&path=%2Flinked%2Ffolder');
  await expect(browser.getByText(/isn.t available in this account/)).toBeVisible();
  // The fallback opens at its root: the linked path left the URL.
  const landed = new URL(browser.url());
  expect(landed.searchParams.get('drive')).toBe('drive-own');
  expect(landed.searchParams.get('path')).toBeNull();
  // The other drive's root shows; the linked folder was never fetched or rendered.
  await expect(browser.getByText('own-note.txt', { exact: true })).toBeVisible();
  expect(browser.getByText('decoy.txt', { exact: true })).toHaveCount(0);
  expect(prefixes.filter((prefix) => prefix)).toEqual([]);

  // A manual drive switch still works and clears the explanation.
  await browser.getByTestId('drive-menu-button').click();
  await browser.getByRole('button', { name: 'Alt drive', exact: true }).click();
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Alt drive');
  await expect(browser).toHaveURL(/drive=drive-alt/);
  await expect(browser.getByText(/isn.t available in this account/)).toHaveCount(0);

  // Back returns to the rewritten fallback entry, never to the dead link.
  await browser.goBack();
  await expect(browser).toHaveURL(/drive=drive-own/);
  expect(new URL(browser.url()).searchParams.get('drive')).not.toBe('drv_missing');
});

test('console link: a drive past the first page still resolves and keeps the linked folder', async ({
  page: browser,
  context,
}) => {
  const drives = Array.from({ length: 150 }, (_, index) => ({
    id: `drive-${String(index).padStart(3, '0')}`,
    name: `Synthetic drive ${String(index).padStart(3, '0')}`,
    quota_bytes: '1000000',
    key_backup_at: null,
    key_backup_method: null,
  }));
  const listCalls: string[] = [];
  await browser.route('**/api/console/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/console/', '');
    const collection = path === 'drives' || path === 'agents' || path === 'keys' ? path : null;
    if (collection) {
      const entries = collection === 'drives' ? drives : [];
      await route.fulfill({ json: page(collection, url.searchParams.get('cursor'), entries) });
      return;
    }
    const listMatch = /^drives\/([^/]+)\/list$/.exec(path);
    if (listMatch) {
      listCalls.push(`${listMatch[1]}:${url.searchParams.get('prefix') ?? ''}`);
      await route.fulfill({
        json: {
          items:
            url.searchParams.get('prefix') === '/deep'
              ? [
                  {
                    id: 'deep-file',
                    path: '/deep/note.txt',
                    ciphertext_size: 8,
                    created_at: new Date(0).toISOString(),
                    kind: 'file',
                  },
                ]
              : [],
          nextCursor: null,
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${path}` } } });
  });

  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret()}` },
    data: { userId: 'e2e_drive_link_paged_test' },
  });
  expect(session.status()).toBe(200);

  await browser.goto('/console?drive=drive-149&path=%2Fdeep');
  await expect(browser.getByTestId('drive-menu-button')).toContainText('Synthetic drive 149');
  await expect(browser.getByText('note.txt', { exact: true })).toBeVisible();
  // Discovery across pages is not "unavailable": no message, and the linked
  // folder stays in the URL against the drive it named.
  await expect(browser.getByText(/isn.t available in this account/)).toHaveCount(0);
  const landed = new URL(browser.url());
  expect(landed.searchParams.get('drive')).toBe('drive-149');
  expect(landed.searchParams.get('path')).toBe('/deep');
  // The deep folder was only ever asked of the linked drive, never a fallback.
  expect(listCalls.filter((call) => call.endsWith(':/deep'))).toEqual(['drive-149:/deep']);
});

test('console link: an unavailable drive with no drives keeps onboarding and shows the message', async ({
  page: browser,
  context,
}) => {
  let listCalls = 0;
  await browser.route('**/api/console/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/console/', '');
    if (path === 'drives' || path === 'agents' || path === 'keys') {
      await route.fulfill({ json: { items: [], nextCursor: null } });
      return;
    }
    if (/^drives\/[^/]+\/list$/.test(path)) {
      listCalls += 1;
      await route.fulfill({ json: { items: [], nextCursor: null } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${path}` } } });
  });

  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret()}` },
    data: { userId: 'e2e_drive_link_empty_test' },
  });
  expect(session.status()).toBe(200);

  await browser.goto('/console?drive=drv_missing&path=%2Flinked%2Ffolder');
  await expect(browser.getByText(/isn.t available in this account/)).toBeVisible();
  await expect(
    browser.getByRole('heading', { name: 'Give your first agent a home.' }),
  ).toBeVisible();
  // With nothing to fall back to, no folder listing runs at all.
  expect(listCalls).toBe(0);
});

test('console link: a 401 still signs the session out', async ({ page: browser, context }) => {
  await browser.route('**/api/console/**', async (route) => {
    await route.fulfill({ status: 401, json: { error: { message: 'Signed out.' } } });
  });
  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret()}` },
    data: { userId: 'e2e_drive_link_signin_test' },
  });
  expect(session.status()).toBe(200);
  await browser.goto('/console?drive=drv_missing&path=%2Flinked%2Ffolder');
  await expect(browser).toHaveURL(/\/sign-in/);
});

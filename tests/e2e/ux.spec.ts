import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const driveId = '00000000-0000-4000-8000-000000000001';

test.beforeEach(async ({ page, context }) => {
  const login = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
    data: { userId: `e2e_ux_${randomUUID().replaceAll('-', '')}` },
  });
  expect(login.status()).toBe(200);
  // Synthetic responses isolate UI states; the console acceptance suite uses real storage.
  await page.route('**/api/console/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/drives')
      ? { items: [{ id: driveId, name: 'Research', quota_bytes: 1024 }], nextCursor: null }
      : path.endsWith('/usage')
        ? { storageBytes: 0, operations: 0, drives: [], agents: [] }
        : { items: [], nextCursor: null };
    await route.fulfill({ json: data });
  });
});

test('loaded-file filtering explains no matches and preserves pagination', async ({ page }) => {
  await page.route(`**/api/console/drives/${driveId}/list?*`, async (route) => {
    const next = new URL(route.request().url()).searchParams.has('cursor');
    await route.fulfill({
      json: {
        items: [
          { id: next ? 'second' : 'first', path: next ? '/reports/zoning.md' : '/notes/first.md' },
        ],
        nextCursor: next ? null : 'next',
      },
    });
  });
  await page.goto('/console');
  await expect(page.getByText('/notes/first.md', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Filter loaded files' }).fill('zoning');
  await expect(page.getByRole('heading', { name: 'No matching loaded files.' })).toBeVisible();
  await expect(
    page.getByText('More files are available. Load the next page to include them in your filter.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load more files' }).click();
  await expect(page.getByText('/reports/zoning.md', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Filter loaded files' }).fill('absent');
  await expect(page.getByRole('heading', { name: 'No matching loaded files.' })).toBeVisible();
  await expect(page.getByText('More files are available.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('spending-control feedback stays beside the mobile form', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let saves = 0;
  let settings = {
    spendCapCents: null as string | null,
    alertThresholdCents: null as string | null,
    alertEmail: null as string | null,
  };
  await page.route('**/api/console/billing**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/settings')) {
      saves += 1;
      const data = route.request().postDataJSON();
      settings = {
        spendCapCents: data.spendCapCents === null ? null : String(data.spendCapCents),
        alertThresholdCents:
          data.alertThresholdCents === null ? null : String(data.alertThresholdCents),
        alertEmail: data.alertEmail,
      };
      await route.fulfill({ json: {} });
    } else if (path.endsWith('/statements')) {
      await route.fulfill({ json: { items: [] } });
    } else {
      await route.fulfill({
        json: {
          plan: 'free',
          subscriptionStatus: null,
          periodStart: '2026-11-01T00:00:00Z',
          periodEnd: '2026-12-01T00:00:00Z',
          storageBytes: '0',
          peakStorageBytes: '0',
          drives: '1',
          egressBytes: '0',
          authorizedEgressBytes: '0',
          operations: '0',
          totalCents: '0',
          overageCents: '0',
          ...settings,
          overageConfigured: false,
          hasCustomer: false,
          checkoutConfigured: false,
          egressMeteringConfigured: false,
          emailConfigured: false,
          agents: [],
          rates: null,
          checkoutRates: null,
          limits: { storageBytes: '5368709120' },
        },
      });
    }
  });
  await page.goto('/console/billing');
  const form = page.locator('form').filter({ has: page.getByLabel('Monthly write cap (USD)') });
  await page.getByLabel('Monthly write cap (USD)').fill('50.005');
  await form.getByRole('button', { name: 'Save spending controls' }).click();
  await expect(form.getByRole('alert')).toContainText('at most two decimal places');
  await expect(form.getByRole('alert')).toBeInViewport();
  await expect(form.getByRole('alert')).toBeFocused();
  await page.getByLabel('Monthly write cap (USD)').fill('50.00');
  await page.getByLabel('Email me at (USD)').fill('35.00');
  await form.getByRole('button', { name: 'Save spending controls' }).click();
  await expect(form.getByRole('alert')).toContainText(
    'Enter an alert email to receive your spending alert.',
  );
  expect(saves).toBe(0);
  await page.getByLabel('Alert email').fill('synthetic@example.test');
  await form.getByRole('button', { name: 'Save spending controls' }).click();
  await expect(form.getByRole('status')).toHaveText('Spending controls saved.');
  await expect(form.getByRole('alert')).toHaveCount(0);
  expect(settings.spendCapCents).toBe('5000');
  await page.getByLabel('Monthly write cap (USD)').fill('');
  await form.getByRole('button', { name: 'Save spending controls' }).click();
  await expect(form.getByRole('status')).toHaveText('Spending controls saved.');
  expect(settings.spendCapCents).toBeNull();
});

test('closing a dialog returns keyboard focus to its opener', async ({ page }) => {
  await page.goto('/console');
  const opener = page.getByRole('button', { name: '+ New drive', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(opener).toBeFocused();
});

test('mobile workspace menu exposes every destination without horizontal navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/console');
  const toggle = page.getByRole('button', { name: 'Workspace menu', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  for (const item of await nav.locator('button, a').all()) await expect(item).toBeInViewport();
  expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await nav.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
  await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  await expect(nav.getByRole('link', { name: 'Activity & deletion' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(nav.getByRole('button', { name: /^Files\b/ })).toBeVisible();
});

test('file listing distinguishes pending, failed and empty states with local retry', async ({
  page,
}) => {
  let fail = true;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/console/drives/${driveId}/list?*`, async (route) => {
    if (fail) {
      await pending;
      await route.fulfill({ status: 503, json: { error: { message: 'Temporary list failure' } } });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });
  await page.goto('/console');
  await expect(page.getByText('Loading files…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect an agent', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Files could not be loaded.' })).toBeVisible();
  await expect(page.getByText('Loading files…', { exact: true })).toHaveCount(0);
  fail = false;
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await nav.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing in the trash.' })).toBeVisible();
  await nav.getByRole('button', { name: /^Files\b/ }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Files could not be loaded.' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry loading files' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your first file.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect an agent', exact: true })).toBeVisible();
});

import { expect, test } from '@playwright/test';

test.describe('public landing page', () => {
  test('explains the product and links to signup', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Every agent gets a drive.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create your workspace' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
    await page.goto('/console');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('shows the agent setup instruction with a copy button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Paste into your agent')).toBeVisible();
    await expect(page.getByText(/^Set up Agent Drive: https?:\/\/.+\/llms\.txt$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy agent instruction' })).toBeVisible();
    await expect(page.getByText('Claude Code', { exact: true })).toBeVisible();
  });

  test('shows the whole CLI command on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const fits = await page.locator('.setup-row code >> nth=1').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const page = document.scrollingElement ?? document.documentElement;
      return (
        el.scrollWidth <= el.clientWidth &&
        box.left >= 0 &&
        box.right <= window.innerWidth &&
        page.scrollWidth <= window.innerWidth
      );
    });
    expect(fits).toBe(true);
    await expect(page.getByRole('button', { name: 'Copy command', exact: true })).toBeVisible();
  });
});

test.describe('account pages', () => {
  test('pricing disables paid plans while checkout is not enabled', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('status')).toContainText('Paid checkout is not enabled');
    for (const name of ['Developer', 'Team']) {
      const card = page.locator('.billing-plan', { has: page.getByRole('heading', { name }) });
      const button = card.getByRole('button');
      await expect(button).toBeDisabled();
      await expect(button).toHaveText('Coming soon');
    }
    await expect(page.getByText('SELECTED')).toHaveCount(0);
    expect(await page.locator('.billing-plan.selected').count()).toBe(0);
  });

  test('a bad spend cap shows its error next to the save button', async ({ page, context }) => {
    const login = await context.request.post('/api/test-session', {
      headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_TEST_AUTH_SECRET}` },
      data: { userId: `e2e_wp2_${Date.now()}` },
    });
    expect(login.status()).toBe(200);
    await page.goto('/console/billing');
    await page.getByLabel('Monthly write cap (USD)').fill('abc');
    const save = page.getByRole('button', { name: 'Save spending controls' });
    await save.click();
    const alert = page.locator('.billing-banner.error');
    await expect(alert).toBeVisible();
    await expect(alert).toBeInViewport();
    const [a, b] = await Promise.all([alert.boundingBox(), save.boundingBox()]);
    expect(Math.abs(a!.y + a!.height - b!.y)).toBeLessThan(200);
  });
});

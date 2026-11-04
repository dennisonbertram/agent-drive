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

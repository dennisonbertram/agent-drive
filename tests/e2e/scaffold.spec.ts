import { expect, test } from '@playwright/test';

test.describe('public landing page', () => {
  test('explains the product and links to signup', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Your agents. Their own drive.' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create your workspace' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
    await page.goto('/console');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('shows the whole CLI command on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const fits = await page
      .locator('.terminal-preview code')
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    await expect(page.getByRole('button', { name: 'Copy command' })).toBeVisible();
  });
});

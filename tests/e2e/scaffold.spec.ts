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
});

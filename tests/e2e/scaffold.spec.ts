import { expect, test } from '@playwright/test';

test.describe('scaffold smoke (not product acceptance)', () => {
  test('renders the Phase 0 placeholder page', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Agent Drive foundation' })).toBeVisible();
    await expect(
      page.getByText('Phase 0 scaffold smoke page. Product operations are not implemented.'),
    ).toBeVisible();
  });
});

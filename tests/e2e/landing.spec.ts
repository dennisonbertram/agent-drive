import { expect, test } from '@playwright/test';

const H2 = [
  /Sandboxes end/,
  /Long-running sessions need persistent data/,
  /Keep every generated asset/,
  /Gigabytes of protein data/,
  /See every file your agents saved/,
  /Encrypted\. Sharable\. Works anywhere/,
  /Why not S3, git or Dropbox/,
  /Questions/,
  /Start free/,
  /Give your agent a drive/,
];
const QUESTIONS = [
  'What happens if I lose the drive key?',
  'How is this different from S3, git or Dropbox?',
  'Which agents work with it?',
  "Can a chat assistant in a vendor's cloud use it?",
  'What counts as an API operation?',
];

test.describe('landing page', () => {
  test('sections appear in the story order', async ({ page }) => {
    await page.goto('/');
    const heads = await page.locator('main > section h2').allTextContents();
    expect(heads).toHaveLength(H2.length);
    H2.forEach((re, i) => expect(heads[i]).toMatch(re));
  });

  test('says what happens next under the hero copy box', async ({ page }) => {
    await page.goto('/');
    await expect(
      page
        .locator('.l-hero')
        .getByText(
          'Free to start. Your agent shows a pairing code, and you approve it in your account.',
          { exact: true },
        ),
    ).toBeVisible();
  });

  test('hero figure names only verified tools, with no sections listing files twice', async ({
    page,
  }) => {
    await page.goto('/');
    const label =
      (await page.locator('.te-hero svg[role="img"]').first().getAttribute('aria-label')) ?? '';
    for (const tool of ['Claude Code', 'Codex', 'pi', 'opencode', 'shell or MCP'])
      expect(label).toContain(tool);
    for (const gone of ['Gemini', 'Cursor', 'Amp', 'Muse', 'Dots', 'trace-bot'])
      expect(label).not.toContain(gone);
    // the games and protein sections show their files in the figure, not in a table
    await expect(page.locator('#games .l-log, #protein .l-log')).toHaveCount(0);
    await expect(page.locator('#games svg[role="img"], #protein svg[role="img"]')).toHaveCount(2);
  });

  test('shows no localhost and no paid-checkout notice', async ({ page }) => {
    await page.goto('/');
    const text = await page.locator('main').innerText();
    expect(text).not.toContain('localhost');
    expect(text).not.toContain('Paid checkout');
    await expect(page.locator('#connect')).toHaveCount(0);
    await expect(page.locator('.l-hero code').first()).toContainText(
      'Set up Agent Drive: https://agentdrive.xyz/llms.txt',
    );
  });

  test('footer links to GitHub and every comparison', async ({ page }) => {
    await page.goto('/');
    const f = page.locator('footer.site-footer');
    await expect(f.locator('a[href="https://github.com/dennisonbertram/agent-drive"]')).toHaveCount(
      2,
    );
    await expect(f.locator('a[href^="/compare/"]')).toHaveCount(3);
    await expect(f.getByText('© 2026 DappHero Corp.')).toBeVisible();
  });

  test('FAQ has five questions and each opens', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('#faq details');
    await expect(items).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const d = items.nth(i);
      await expect(d.locator('summary')).toHaveText(QUESTIONS[i]!);
      await d.locator('summary').click();
      await expect(d).toHaveAttribute('open', '');
    }
  });

  test('Free tier has a Sign up free link to sign-up', async ({ page }) => {
    await page.goto('/');
    const free = page.locator('.l-plan', { hasText: 'Free' }).first();
    await expect(free.getByRole('link', { name: 'Sign up free' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });

  test('console section shows a described screenshot', async ({ page }) => {
    await page.goto('/');
    const img = page.locator('#console img');
    await expect(img).toHaveAttribute('alt', /console showing the inbox/i);
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(
      true,
    );
  });

  test('phones get the portrait console screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const img = page.locator('#console img');
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
      .toBe(true);
    const m = await img.evaluate((i: HTMLImageElement) => ({
      w: i.getBoundingClientRect().width,
      nw: i.naturalWidth,
      nh: i.naturalHeight,
    }));
    expect(m.w).toBeGreaterThanOrEqual(300);
    expect(m.nh).toBeGreaterThan(m.nw);
  });

  test('has Open Graph and Twitter metadata', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(
      'Agent Drive: encrypted storage your agents keep across sandboxes',
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    const ogUrl = new URL(og!);
    expect(ogUrl.origin).toBe(new URL(page.url()).origin);
    const res = await page.request.get(ogUrl.href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('has a favicon and an Apple touch icon that load', async ({ page }) => {
    await page.goto('/');
    for (const [selector, type] of [
      ['link[rel="icon"][type="image/svg+xml"]', 'image/svg+xml'],
      ['link[rel="apple-touch-icon"]', 'image/png'],
    ] as const) {
      const href = await page.locator(selector).first().getAttribute('href');
      expect(href).toBeTruthy();
      const res = await page.request.get(new URL(href!, page.url()).href);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain(type);
    }
  });

  test('pricing has its own social title and url', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Pricing | Agent Drive',
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `${new URL(page.url()).origin}/pricing`,
    );
  });

  for (const width of [375, 390]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(w).toBeLessThanOrEqual(width);
    });
  }
});

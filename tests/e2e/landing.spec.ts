import { expect, test } from '@playwright/test';

const H2 = [
  /Sandboxes end/,
  /A bot, a coder and an assistant/,
  /See every file your agents saved/,
  /Encrypted\. Sharable\. Works anywhere/,
  /One line to the agent/,
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
    const heads = await page.locator('main h2').allTextContents();
    expect(heads).toHaveLength(H2.length);
    H2.forEach((re, i) => expect(heads[i]).toMatch(re));
  });

  test('says what happens next under the hero copy box', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByText(
        'Free to start. Your agent shows a code; you approve it once. No API keys to copy.',
        { exact: true },
      ),
    ).toBeVisible();
  });

  test('hero figure lists only verified tools plus a generic tile', async ({ page }) => {
    await page.goto('/');
    const fig = page.locator('.landing-fig svg.dsk');
    const names = await fig.locator('text.kn').allTextContents();
    expect(names.filter((n) => n !== 'Agent Drive').sort()).toEqual(
      ['Claude Code', 'Codex', 'pi', 'opencode', 'Any agent with a shell or MCP'].sort(),
    );
    const label = (await fig.getAttribute('aria-label')) ?? '';
    for (const gone of ['Gemini', 'Cursor', 'Amp', 'Muse', 'Dots', 'trace-bot'])
      expect(label).not.toContain(gone);
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

  test('Free tier has a Start free link to sign-up', async ({ page }) => {
    await page.goto('/');
    const free = page.locator('.l-plan', { hasText: 'Free' }).first();
    await expect(free.getByRole('link', { name: 'Start free' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });

  test('console section shows a described screenshot', async ({ page }) => {
    await page.goto('/');
    const img = page.locator('#console img');
    await expect(img).toHaveAttribute('alt', /file browser/i);
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
    const res = await page.request.get(new URL(og!).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
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

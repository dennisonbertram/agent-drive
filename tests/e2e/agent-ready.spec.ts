import { expect, test, type APIResponse } from '@playwright/test';
import { PLANS } from '../../apps/web/src/billing/policy';

const ORIGIN = 'http://localhost:3100';
const DOCS = ['quickstart', 'cli', 'api', 'crypto'];
const COMPARE = ['s3-r2', 'git-github', 'dropbox-google-drive'];
const QUESTIONS = [
  'What happens if I lose the drive key?',
  'How is this different from S3, git or Dropbox?',
  'Which agents work with it?',
  "Can a chat assistant in a vendor's cloud use it?",
  'What counts as an API operation?',
];

// [HTML path, Markdown twin path]
const PAGES: [string, string][] = [
  ['/', '/index.md'],
  ['/pricing', '/pricing.md'],
  ['/docs', '/docs.md'],
  ...DOCS.map((d): [string, string] => [`/docs/${d}`, `/docs/${d}.md`]),
  ['/compare', '/compare.md'],
  ...COMPARE.map((c): [string, string] => [`/compare/${c}`, `/compare/${c}.md`]),
];

function expectMarkdown(res: APIResponse, htmlPath: string) {
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('text/markdown; charset=utf-8');
  expect(res.headers()['vary']?.toLowerCase()).toContain('accept');
  expect(res.headers()['link']).toContain(`<${ORIGIN}${htmlPath}>; rel="canonical"`);
}

test.describe('agent-ready site', () => {
  test('robots.txt allows public pages and blocks private paths', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-Agent: \*/i);
    expect(body).toMatch(/^Allow: \/$/m);
    for (const p of ['/console', '/connect', '/api', '/s/', '/sign-in', '/sign-up'])
      expect(body).toContain(`Disallow: ${p}`);
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  test('sitemap lists every public page and the llms files', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    const urls = ['/', '/pricing', '/docs', '/compare', '/llms.txt', '/llms-full.txt'];
    for (const d of DOCS) urls.push(`/docs/${d}`);
    for (const c of COMPARE) urls.push(`/compare/${c}`);
    for (const u of urls) expect(body).toContain(`<loc>${ORIGIN}${u === '/' ? '/' : u}</loc>`);
    expect(body).not.toContain('/console');
    expect(body).not.toContain('/docs/plan');
  });

  for (const [html, md] of PAGES) {
    test(`${md} serves Markdown and ${html} negotiates it`, async ({ request, page }) => {
      expectMarkdown(await request.get(md), html);

      const negotiated = await request.get(html, { headers: { accept: 'text/markdown' } });
      expectMarkdown(negotiated, html);
      expect(await negotiated.text()).toBe(await (await request.get(md)).text());

      const preferred = await request.get(html, {
        headers: { accept: 'text/markdown, text/html;q=0.5' },
      });
      expect(preferred.headers()['content-type']).toContain('text/markdown');

      const browser = await request.get(html, {
        headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      expect(browser.headers()['content-type']).toContain('text/html');
      expect(browser.headers()['vary']?.toLowerCase()).toContain('accept');

      await page.goto(html);
      await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
        'href',
        `${ORIGIN}${md}`,
      );
    });
  }

  test('Accept negotiation honours q-values', async ({ request }) => {
    const kind = async (accept: string) =>
      (await request.get('/pricing', { headers: { accept } })).headers()['content-type'] ?? '';
    expect(await kind('text/markdown;q=0, text/html')).toContain('text/html');
    expect(await kind('text/html;q=0.5, text/markdown')).toContain('text/markdown');
    expect(await kind('text/markdown')).toContain('text/markdown');
    expect(await kind('text/markdown;q=0.4, text/html;q=0.8')).toContain('text/html');
    expect(await kind('*/*')).toContain('text/html');
    expect(await kind('text/html,application/xhtml+xml,*/*;q=0.8')).toContain('text/html');
  });

  test('/index.md contains every homepage FAQ question', async ({ request, page }) => {
    const md = await (await request.get('/index.md')).text();
    for (const q of QUESTIONS) expect(md).toContain(q);
    await page.goto('/');
    const shown = await page.locator('.l-faq summary').allTextContents();
    expect(shown).toEqual(QUESTIONS);
  });

  test('/pricing.md and /pricing agree on every price and limit', async ({ request, page }) => {
    const md = await (await request.get('/pricing.md')).text();
    await page.goto('/pricing');
    const cards = page.locator('.billing-plan');
    expect(await cards.count()).toBe(Object.keys(PLANS).length);
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i);
      expect(md).toContain((await card.locator('h2').innerText()).toLowerCase());
      expect(md).toContain(await card.locator('.billing-price').innerText());
      for (const li of await card.locator('li').allInnerTexts()) expect(md).toContain(li);
    }
    for (const dd of await page.locator('.pricing-rate-list dd').allInnerTexts())
      expect(md).toContain(dd);
    // One decimal byte unit everywhere: the Free plan's 5 GiB shows as 5.37 GB, never GiB.
    expect(md).toContain('5.37 GB stored ciphertext');
    expect(await page.locator('.billing-plan').first().innerText()).toContain('5.37 GB');
    expect(md).not.toMatch(/GiB|TiB/u);
    // Conditions: every paragraph of the fine print and any availability notice must match.
    const notes = [
      ...(await page.locator('.pricing-details p:not(.eyebrow)').allInnerTexts()),
      ...(await page.locator('#pricing-availability').allInnerTexts()),
    ];
    expect(notes.length).toBeGreaterThanOrEqual(3);
    for (const n of notes) expect(md).toContain(n);
  });

  test('JSON-LD on /pricing matches the plan prices; FAQPage on /', async ({ page }) => {
    await page.goto('/pricing');
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    const ld = JSON.parse(raw ?? '');
    expect(ld['@type']).toBe('SoftwareApplication');
    const prices = (ld.offers as { price: string }[]).map((o) => o.price);
    expect(prices).toEqual(Object.values(PLANS).map((p) => (p.baseCents / 100).toFixed(2)));
    expect(ld.offers.every((o: { priceCurrency: string }) => o.priceCurrency === 'USD')).toBe(true);

    await page.goto('/');
    const faq = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '',
    );
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity.map((e: { name: string }) => e.name)).toEqual(QUESTIONS);
  });

  test('docs index and doc pages render; only allowlisted docs exist', async ({
    request,
    page,
  }) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const d of DOCS) await expect(page.locator(`main a[href="/docs/${d}"]`)).toHaveCount(1);
    await expect(page.locator('main a[href="/llms.txt"]').first()).toBeVisible();
    await page.goto('/docs/quickstart');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main pre').first()).toBeVisible();
    expect(await page.locator('main script, main iframe').count()).toBe(0);
    for (const bad of ['plan', 'deployment', 'agent-login', 'ux-flow', '..%2Fplan', 'README']) {
      expect((await request.get(`/docs/${bad}`)).status()).toBe(404);
      expect((await request.get(`/docs/${bad}.md`)).status()).toBe(404);
    }
    const qs = await (await request.get('/docs/quickstart.md')).text();
    expect(qs).not.toContain('not yet published');
    expect(qs).not.toMatch(/clone this repository/i);
    expect(qs).toContain('agent-drive login');
    expect(qs).toContain('agent-drive check');
  });

  test('header Docs link goes to /docs and llms.txt stays reachable', async ({ page, request }) => {
    await page.goto('/pricing');
    await expect(page.locator('header.site-header a[href="/docs"]')).toHaveCount(1);
    expect((await request.get('/llms.txt')).status()).toBe(200);
  });

  test('llms.txt is an index followed by the setup guide; llms-full adds the docs', async ({
    request,
  }) => {
    const txt = await (await request.get('/llms.txt')).text();
    expect(txt).toMatch(/^# Agent Drive\n\n> /);
    expect(txt).toContain('## Docs');
    expect(txt).toContain('## Pages');
    expect(txt).toContain(`${ORIGIN}/docs/quickstart.md`);
    expect(txt).toContain(`${ORIGIN}/pricing.md`);
    expect(txt).toContain(`${ORIGIN}/compare/s3-r2.md`);
    expect(txt).toContain('## Set up (local agent with a shell)');
    const full = await request.get('/llms-full.txt');
    expect(full.status()).toBe(200);
    expect(full.headers()['content-type']).toBe('text/plain; charset=utf-8');
    const fullTxt = await full.text();
    expect(fullTxt).toContain('## Docs');
    expect(fullTxt).toContain('ADRV v1');
    expect(fullTxt).toContain('agent-drive login');
    expect(fullTxt).not.toContain('Design contract for three connected features');
  });

  test('compare pages render with answer, table and choice section', async ({ page }) => {
    await page.goto('/compare');
    for (const c of COMPARE)
      await expect(page.locator(`main a[href="/compare/${c}"]`)).toHaveCount(1);
    for (const c of COMPARE) {
      await page.goto(`/compare/${c}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main table')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'When to choose which' })).toBeVisible();
      await expect(page.locator('main .doc-answer')).toContainText('Use ');
    }
    await page.goto('/');
    await expect(page.locator('footer a[href="/compare"]')).toHaveCount(1);
  });
});

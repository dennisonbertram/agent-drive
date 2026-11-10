import { expect, test, type Page } from '@playwright/test';

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

async function headerBox(page: Page) {
  return page.locator('header.site-header').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { height: Math.round(r.height), width: r.width, inner: window.innerWidth };
  });
}

test.describe('shared site header', () => {
  test('Sign up free is in the phone viewport and tall enough to tap', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/');
    const link = page.locator('header.site-header').getByRole('link', { name: 'Sign up free' });
    await expect(link).toBeInViewport();
    await expect(link).toHaveAttribute('href', '/sign-up');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  for (const size of [desktop, phone]) {
    test(`same header on / and /pricing at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      const boxes = [];
      for (const path of ['/', '/pricing']) {
        await page.goto(path);
        await expect(
          page.locator('header.site-header').getByRole('link', { name: 'Sign up free' }),
        ).toHaveCount(1);
        const header = page.locator('header.site-header');
        await expect(header.getByRole('link', { name: 'Console' })).toHaveCount(0);
        await expect(header.locator('a[href="/docs"]')).toHaveCount(1);
        const box = await headerBox(page);
        expect(box.width).toBe(box.inner);
        boxes.push(box.height);
      }
      expect(boxes[0]).toBe(boxes[1]);
    });
  }

  test('menu opens on a phone and closes with Escape', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/');
    const nav = page.locator('header.site-header nav');
    const links = ['Pricing', 'Docs', 'Sign in'].map((n) => nav.getByRole('link', { name: n }));
    for (const l of links) await expect(l).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    for (const l of links) {
      await expect(l).toBeVisible();
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    for (const l of links) await expect(l).toBeHidden();
  });

  test('menu works from the keyboard and exposes its state', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Menu', expanded: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('header.site-header nav a').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('header.site-header nav a').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('header.site-header nav a').first()).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(page.getByRole('button', { name: 'Menu', expanded: false })).toBeVisible();
  });

  test('desktop shows the links and no Menu button', async ({ page }) => {
    await page.setViewportSize(desktop);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
    const nav = page.locator('header.site-header nav');
    for (const n of ['Pricing', 'Docs', 'Sign in'])
      await expect(nav.getByRole('link', { name: n })).toBeVisible();
  });
});

test.describe('auth cross-links', () => {
  test('sign-in and sign-up link to each other and to Pricing and Docs', async ({ page }) => {
    await page.goto('/sign-in');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Sign up free' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
    await expect(main.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Docs' })).toBeVisible();
    await page.goto('/sign-up');
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    await expect(page.getByRole('main').getByRole('link', { name: 'Pricing' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  });

  test('keeps a same-origin redirect_url and drops anything else', async ({ page }) => {
    const bad = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '%2F%5Cevil.example',
      '/\t/evil.example',
      '/%09/evil.example',
      'javascript:alert(1)',
    ];
    const cases = [
      ['/sign-in', 'Sign up free', '/sign-up'],
      ['/sign-up', 'Sign in', '/sign-in'],
    ] as const;
    for (const [from, name, to] of cases) {
      const link = () => page.getByRole('main').getByRole('link', { name, exact: true });
      await page.goto(`${from}?redirect_url=${encodeURIComponent('/connect?code=ABCD-EFGH')}`);
      await expect(link()).toHaveAttribute('href', /redirect_url=%2Fconnect%3Fcode%3DABCD-EFGH/);
      for (const value of bad) {
        // Raw values that are already percent-encoded are sent as is; others are encoded once.
        const q =
          value.startsWith('%') || value.includes('%09') ? value : encodeURIComponent(value);
        await page.goto(`${from}?redirect_url=${q}`);
        await expect(link(), `${from} ${value}`).toHaveAttribute('href', to);
      }
    }
  });
});

for (const size of [phone, desktop]) {
  test.describe(`primary action at ${size.width}px`, () => {
    test.use({ viewport: size, permissions: ['clipboard-read', 'clipboard-write'] });

    test('header stays at the top after scrolling to pricing, FAQ and the final call', async ({
      page,
    }) => {
      await page.goto('/');
      for (const sel of ['#pricing', '#faq', '.l-final']) {
        await page.locator(sel).scrollIntoViewIfNeeded();
        await page.locator(sel).evaluate((el) => el.scrollIntoView());
        const top = await page
          .locator('header.site-header')
          .evaluate((el) => Math.round(el.getBoundingClientRect().top));
        expect(top, sel).toBe(0);
        await expect(
          page.locator('header.site-header').getByRole('link', { name: 'Sign up free' }),
        ).toBeInViewport();
      }
    });

    test('every filled orange element is a Sign up free link, one per region', async ({ page }) => {
      await page.goto('/');
      const filled = await page.evaluate(() => {
        const out: { name: string; tag: string; region: string }[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('a, button, span, div')) {
          if (getComputedStyle(el).backgroundColor !== 'rgb(255, 74, 28)') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 20) continue; // decorative dots, not buttons
          out.push({
            name: (el.textContent ?? '').trim(),
            tag: el.tagName,
            region:
              el.closest('header, section, footer')?.id ||
              el.closest('header, section, footer')?.className ||
              '',
          });
        }
        return out;
      });
      expect(filled.length).toBeGreaterThan(0);
      for (const f of filled) {
        expect(f.tag).toBe('A');
        expect(f.name).toBe('Sign up free');
      }
      const regions = filled.map((f) => f.region);
      expect(new Set(regions).size).toBe(regions.length);
    });

    test('a filled Sign up free is visible on every screen', async ({ page }) => {
      await page.goto('/');
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < total; y += size.height) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        const seen = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('a')].some((a) => {
            const r = a.getBoundingClientRect();
            return (
              a.textContent?.trim() === 'Sign up free' &&
              getComputedStyle(a).backgroundColor === 'rgb(255, 74, 28)' &&
              r.bottom > 0 &&
              r.top < innerHeight
            );
          }),
        );
        expect(seen, `scrollY ${y}`).toBe(true);
      }
    });

    test('sign-up has one name and the copy buttons keep theirs', async ({ page }) => {
      await page.goto('/');
      for (const bad of ['Create a free account', 'Start free'])
        await expect(page.getByRole('link', { name: bad })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
      const hero = page.locator('.l-hero').getByRole('button', { name: 'Copy agent instruction' });
      await expect(hero).toHaveText('Copy prompt');
      await hero.click();
      await expect(hero).toHaveText('Copied');
      await expect(
        page.locator('.l-final').getByRole('button', { name: 'Copy agent instruction again' }),
      ).toHaveText('Copy prompt');
    });

    test('See the FAQ above lands below the sticky header', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'See the FAQ above.' }).click();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const h = document.querySelector('header.site-header')!.getBoundingClientRect().bottom;
            const f = document.querySelector('#faq h2')!.getBoundingClientRect().top;
            return f >= h;
          }),
        )
        .toBe(true);
    });
  });
}

test('final call to action offers sign-up beside the copy button', async ({ page }) => {
  await page.goto('/');
  const final = page.locator('section.l-final');
  await expect(final.getByRole('link', { name: 'Sign up free' })).toHaveAttribute(
    'href',
    '/sign-up',
  );
  await expect(final.getByRole('button', { name: 'Copy agent instruction again' })).toBeVisible();
});

test('no horizontal scroll on public pages at narrow widths', async ({ page }) => {
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/pricing', '/sign-in', '/sign-up']) {
      await page.goto(path);
      const wide = await page.evaluate(
        () => (document.scrollingElement ?? document.documentElement).scrollWidth > innerWidth,
      );
      expect(wide, `${path} at ${width}`).toBe(false);
    }
  }
});

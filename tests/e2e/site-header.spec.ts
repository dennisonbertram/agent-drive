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
    const link = page.getByRole('link', { name: 'Sign up free' });
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
        await expect(page.getByRole('link', { name: 'Sign up free' })).toHaveCount(1);
        const header = page.locator('header.site-header');
        await expect(header.getByRole('link', { name: 'Console' })).toHaveCount(0);
        await expect(header.locator('a[href="/llms.txt"]')).toHaveCount(1);
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
    await expect(main.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
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
    const link = () => page.getByRole('main').getByRole('link', { name: 'Create a free account' });
    await page.goto('/sign-in?redirect_url=%2Fconnect%3Fcode%3DBCDF-GHJK');
    await expect(link()).toHaveAttribute('href', /redirect_url=%2Fconnect%3Fcode%3DBCDF-GHJK/);
    await page.goto('/sign-in?redirect_url=https%3A%2F%2Fevil.example');
    await expect(link()).toHaveAttribute('href', '/sign-up');
    await page.goto('/sign-in?redirect_url=%2F%2Fevil.example');
    await expect(link()).toHaveAttribute('href', '/sign-up');
  });
});

test('final call to action offers sign-up beside the copy button', async ({ page }) => {
  await page.goto('/');
  const final = page.locator('section.l-final');
  await expect(final.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
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

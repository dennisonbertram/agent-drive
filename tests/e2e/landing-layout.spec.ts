import { expect, test, type Page } from '@playwright/test';

const phones = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
];

/** Visible links, buttons and summaries shorter than 44 px, as "tag text height". */
async function smallTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a, button, summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('.sr-only');
      })
      .map((el) => ({ el, h: el.getBoundingClientRect().height }))
      .filter(({ h }) => h < 43.5)
      .map(({ el, h }) => `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${h}`),
  );
}

for (const size of phones) {
  test.describe(`touch targets and gutters at ${size.width}px`, () => {
    test.use({ viewport: size });

    test('every link, button and summary on / is at least 44 px tall', async ({ page }) => {
      await page.goto('/');
      expect(await smallTargets(page)).toEqual([]);
    });

    test('the open menu links are tall enough and its edge is on the page gutter', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Menu' }).click();
      expect(await smallTargets(page)).toEqual([]);
      const edges = await page.evaluate(() => ({
        menu: document.querySelector('#site-nav')!.getBoundingClientRect().right,
        content: document.querySelector('#problem .l-wrap')!.getBoundingClientRect().right - 20,
      }));
      expect(Math.abs(edges.menu - edges.content)).toBeLessThanOrEqual(1);
    });

    test('header brand and footer content start at the page gutter', async ({ page }) => {
      await page.goto('/');
      const lefts = await page.evaluate(() => ({
        brand: document.querySelector('.site-header .brand')!.getBoundingClientRect().left,
        h2: document.querySelector('#problem h2')!.getBoundingClientRect().left,
        footer: document.querySelector('footer .sf-brand')!.getBoundingClientRect().left,
      }));
      expect(lefts.brand).toBe(lefts.h2);
      expect(lefts.footer).toBe(lefts.h2);
    });

    test('content text links share one style', async ({ page }) => {
      await page.goto('/');
      const styles = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.l-also a, #features .feat > div > a, .l-pnote a',
          ),
        ].map((a) => {
          const s = getComputedStyle(a);
          return `${s.color} ${s.fontWeight} ${s.textDecorationLine}`;
        }),
      );
      expect(styles.length).toBeGreaterThan(0);
      expect(new Set(styles).size).toBe(1);
    });
  });
}

for (const width of [1440, 768, 390]) {
  test(`footer content lines up with the section headings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const lefts = await page.evaluate(() => ({
      h2: document.querySelector('#problem h2')!.getBoundingClientRect().left,
      footer: document.querySelector('footer .sf-brand')!.getBoundingClientRect().left,
    }));
    expect(lefts.footer).toBe(lefts.h2);
  });
}

for (const width of [1440, 390]) {
  test(`the page uses at most six font sizes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const sizes = await page.evaluate(() => {
      const out = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !n.textContent?.trim() || el.closest('svg, script, style, title, .sr-only'))
          continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs > 0) out.add(String(fs));
      }
      return [...out];
    });
    expect(sizes.length, sizes.join(' ')).toBeLessThanOrEqual(6);
  });
}

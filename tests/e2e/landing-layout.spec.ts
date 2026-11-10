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

// K2: a shorter, non-repeating phone page
test.describe('phone page length and structure', () => {
  test('the page is at most 9,400 px tall at 390px with nothing hidden behind a tap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(h).toBeLessThanOrEqual(9400);
    await expect(page.locator('main [hidden], main [role="tab"]')).toHaveCount(0);
  });

  for (const width of [390, 360]) {
    test(`the activity log is a labelled table at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const table = page.locator('table.lt');
      await expect(table).toHaveCount(1);
      await expect(page.locator('.l-log[role="img"]')).toHaveCount(0);
      for (const name of ['Saved by', 'From', 'When'])
        await expect(table.getByRole('columnheader', { name })).toBeVisible();
      await expect(table.locator('th[scope="row"]')).toHaveCount(3);
      const cols = await table.evaluate((t) => {
        const head = [...t.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect());
        return [...t.querySelectorAll('tbody tr')]
          .filter((tr) => !tr.querySelector('th'))
          .map((tr) =>
            [...tr.children].map((td, i) => {
              const r = td.getBoundingClientRect();
              return Math.abs(r.left - head[i]!.left) < 1 && r.right <= head[i]!.right + 1;
            }),
          );
      });
      expect(cols).toHaveLength(3);
      for (const row of cols) expect(row).toEqual([true, true, true]);
    });
  }

  test('relay steps stack and the phone console image is used at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    const lefts = await page
      .locator('.relay > div')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
    const broken = await page
      .locator('.relay code')
      .evaluateAll(
        (els) => els.filter((e) => getComputedStyle(e).overflowWrap === 'anywhere').length,
      );
    expect(broken).toBe(0);
    const img = page.locator('#console img');
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.currentSrc))
      .toMatch(/console-files-phone\.png/);
    expect((await img.boundingBox())!.width).toBeLessThanOrEqual(520);
  });

  for (const width of [360, 390, 768, 1440]) {
    test(`no horizontal page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }

  test('repeated pills are gone and compare links share one style', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('ul.l-solve li')).toHaveText([
      'Many agents, one drive',
      'No silent overwrites',
    ]);
    const border = await page
      .locator('ul.l-solve li')
      .first()
      .evaluate((e) => getComputedStyle(e).borderTopWidth);
    expect(border).toBe('0px');
    const rows = page.locator('#compare a.cmp-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.last()).toContainText('All comparisons');
    const styles = await rows.evaluateAll((els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return `${s.color} ${s.fontWeight} ${s.display}`;
      }),
    );
    expect(new Set(styles).size).toBe(1);
  });

  test('pricing is one table with a single Sign up free button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const t = page.locator('#pricing table.pt');
    await expect(t).toHaveCount(1);
    for (const plan of ['Free', 'Developer', 'Team'])
      await expect(t.getByRole('columnheader', { name: new RegExp(plan) })).toBeVisible();
    for (const row of ['Price', 'Drives', 'Stored', 'Downloads', 'API operations'])
      await expect(t.getByRole('rowheader', { name: new RegExp(row) })).toBeVisible();
    await expect(page.locator('#pricing').getByRole('link', { name: 'Sign up free' })).toHaveCount(
      1,
    );
  });

  test('the final call sits within 64 px of the footer rule', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const gap = await page.evaluate(() => {
      const last = document.querySelector('.l-final .l-final-row')!.getBoundingClientRect().bottom;
      return document.querySelector('footer.site-footer')!.getBoundingClientRect().top - last;
    });
    expect(gap).toBeLessThanOrEqual(64);
  });
});

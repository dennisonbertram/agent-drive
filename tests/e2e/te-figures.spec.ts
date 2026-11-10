import { expect, test, type Page } from '@playwright/test';

// Landing figures on phones (ux-visual decision K1). Text must not collide, must render at
// 12 px or more, and must use only the accessible text colours.
const FIGURES = ['hero', 'games', 'protein'] as const;
const OK_FILLS = new Set(['#111111', '#6f6d68', '#c2370f', '#ffffff', '#f6f5f2']);

type Box = { s: string; x: number; y: number; w: number; h: number };

async function measure(page: Page, name: string) {
  return page.evaluate((n) => {
    const svg = document.querySelector<SVGSVGElement>(`.te-${n} svg`)!;
    const scale = svg.getBoundingClientRect().width / 520;
    const texts = [...svg.querySelectorAll<SVGTextElement>('text')]
      .filter((t) => Number(t.getAttribute('opacity') ?? 1) > 0.05)
      .map((t) => {
        const r = t.getBoundingClientRect();
        return {
          s: t.textContent ?? '',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          fill: t.getAttribute('fill') ?? '',
          size: parseFloat(getComputedStyle(t).fontSize) * scale,
        };
      });
    // outlined shapes (keys, pills, bars); a text box may sit inside one but not cross its edge
    const outlines = [...svg.querySelectorAll<SVGRectElement>('rect')]
      .filter((r) => {
        const so = Number(r.getAttribute('stroke-opacity') ?? 1);
        const st = r.getAttribute('stroke');
        const fill = r.getAttribute('fill');
        const rect = r.getBoundingClientRect();
        return (
          !r.closest('[clip-path]') && // clipped rows (scrolled-out tiles) are not visible
          rect.width < 200 * scale &&
          so > 0.05 &&
          ((st && st !== 'none') || (fill && fill !== 'none' && fill !== 'url(#te-gp)'))
        );
      })
      .map((r) => {
        const b = r.getBoundingClientRect();
        return { s: 'rect', x: b.x, y: b.y, w: b.width, h: b.height };
      });
    return { texts, outlines };
  }, name);
}

const hit = (a: Box, b: Box, tol = 1) =>
  a.x + a.w - tol > b.x && b.x + b.w - tol > a.x && a.y + a.h - tol > b.y && b.y + b.h - tol > a.y;

function check(name: string, m: Awaited<ReturnType<typeof measure>>) {
  const bad: string[] = [];
  m.texts.forEach((a, i) => {
    if (a.size < 11.95) bad.push(`${name}: "${a.s}" renders at ${a.size.toFixed(1)}px`);
    if (a.fill === '#a8a69f' || !OK_FILLS.has(a.fill))
      bad.push(`${name}: "${a.s}" has fill ${a.fill}`);
    if (/AD-0\d|AD—0\d|S0\d|\d\d:\d\d\.\d|Cα|GEN \d/.test(a.s)) bad.push(`${name}: code "${a.s}"`);
    m.texts.slice(i + 1).forEach((b) => {
      if (hit(a, b)) bad.push(`${name}: "${a.s}" overlaps "${b.s}"`);
    });
    // a text box that crosses a shape's edge (partly in, partly out) touches its outline
    m.outlines.forEach((o) => {
      const inside =
        a.x >= o.x - 1 &&
        a.y >= o.y - 1 &&
        a.x + a.w <= o.x + o.w + 1 &&
        a.y + a.h <= o.y + o.h + 1;
      if (hit(a, o) && !inside) bad.push(`${name}: "${a.s}" crosses a shape outline`);
    });
  });
  return bad;
}

for (const [width, height] of [
  [360, 780],
  [390, 844],
] as const) {
  test.describe(`figures at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    for (const name of FIGURES) {
      test(`${name}: no overlap, 12 px floor, accessible colours, no codes`, async ({ page }) => {
        await page.goto('/');
        const fig = page.locator(`.te-${name}`);
        await fig.scrollIntoViewIfNeeded();
        if (name === 'hero') {
          const labels = await page.locator('.te-hero [data-g="keys"] text').allTextContents();
          expect(labels.join(' ')).toBe('CLAUDE CODE CODEX PI OPEN CODE ANY AGENT');
        }
        const bad: string[] = [];
        let waited = 0;
        for (const at of [1000, 5000, 8000]) {
          await page.waitForTimeout(at - waited);
          waited = at;
          bad.push(...check(`${name}@${at}`, await measure(page, name)));
        }
        expect(bad).toEqual([]);
      });

      test(`${name}: reduced-motion still is clean and shows no timecode`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await page.locator(`.te-${name}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const m = await measure(page, name);
        expect(check(`${name}@still`, m)).toEqual([]);
        if (name === 'hero')
          expect(
            await page
              .locator('.te-hero rect[stroke-dasharray="3 3"]')
              .evaluateAll(
                (els) => els.filter((e) => Number(e.getAttribute('stroke-opacity')) > 0).length,
              ),
          ).toBe(0);
      });
    }
  });
}

test('server HTML uses the phone variant and a 19.5px first-paint font size', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('>CLAUDE<');
  expect(html).not.toMatch(/AD—0\d|>01</);
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
    (x) => x[1]!,
  );
  const css = (await Promise.all(hrefs.map(async (h) => (await request.get(h)).text()))).join('');
  expect(css).toMatch(/--fs:\s*19\.5px/);
});

test.describe('figure centring', () => {
  test.use({ viewport: { width: 768, height: 1024 } });
  for (const name of FIGURES)
    test(`${name} is centred in its column at 768`, async ({ page }) => {
      await page.goto('/');
      const g = await page.locator(`.te-${name}`).evaluate((el) => {
        const f = el.getBoundingClientRect();
        const p = el.parentElement!.getBoundingClientRect();
        return { left: f.left - p.left, right: p.right - f.right };
      });
      expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
    });
});

# K3+K4 A Minimal: recolour, rename, resize (CSS, copy and class names only)

## Change

No new elements and no layout changes. The fix is done with CSS, text, and one class removed in markup.

**K3: primary action**

1. Header "Sign up free" becomes the orange filled button at every width. Move `background: var(--sig)` into `.site-signup` and delete the unused `.site-signup.signal` rule and its comment.
2. The header becomes sticky: `.site-header { position: sticky; top: 0; z-index: 50; }`.
   **Required companion fix:** `.landing { overflow-x: hidden }` turns `main.landing` into a scroll container, so sticky would not work on the homepage. Change it to `overflow-x: clip`, which does not create a scroll container (Chrome 90, Safari 16, Firefox 81). A Chromium check confirmed this: after scrolling 2,000 px, a sticky header inside `overflow-x: hidden` was at top = -2000, and inside `overflow-x: clip` it was at top = 0.
3. The hero "Copy" stops being the orange button. Remove `signal` from `className="l-btn signal"` in `SetupPanel` (`page.tsx`). Add `.l-panel .l-btn { background: transparent; color: #fff; }` so it becomes a white outline button on the dark panel. Change its caption from "Copy" to "Copy prompt".
4. Add text that tells the human what happens:
   - Panel tag: "Give this to your agent" becomes "Paste this into your agent".
   - `HERO.next` ("Free to start.") becomes "Free to start. Your agent shows a pairing code, and you approve it in your account." The line now explains the next step, so it no longer reads as a stray caption (H-25).
5. Use one name, "Sign up free", for the sign-up action everywhere:
   - Pricing card button "Start free" becomes "Sign up free" and gets `signal`.
   - Pricing heading "Start free." becomes "Plans and limits."
   - Final CTA link "Create a free account" becomes "Sign up free" and gets `signal`. The final Copy button loses `signal`, as in the hero.
   - The footer `.sf-cta` "Create a free account →" becomes "Sign up free →".
   - The `AuthLinks` text "Create a free account" becomes "Sign up free".

**K4: targets, links, menu**

6. `.l-btn`: `min-height: 44px; padding: 0 18px; justify-content: center;` at all widths. This replaces `padding: 10px 18px`, which gave 39 px.
7. `.l-copy` (terminal chip): `min-height: 44px; padding: 0 12px;`. Under 760 px, `.l-cmd { align-items: center }`.
8. One style for text links in landing content. Add one shared rule: `.l-also a, .feat > div > a, .l-pnote a { color: var(--i); font-weight: 500; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }`.
   - Standalone links ("Agent Drive vs …", "All comparisons", "See full pricing") also get `display: inline-flex; align-items: center; min-height: 44px; align-self: flex-start;`.
   - Inline links inside sentences ("See how", "See the FAQ above.") get `padding-block: 12px`. This enlarges the hit box without changing line height.
9. Footer: `.site-footer .sf-cols a, .sf-cta { display: inline-flex; align-items: center; min-height: 44px; }` and `.sf-cols ul { gap: 0 }`. The row pitch becomes 44 px instead of 34 px.
10. Header wordmark: `.site-header .brand { min-height: 44px; }`.
11. Menu popover: change `inset: 64px 16px auto auto` to `inset: 64px 20px auto auto`. The panel's right edge then sits on the 20 px page gutter, at x = 370 on a 390 px screen (H-26).
12. At 360 px and below, delete `padding: 0 12px` in `@media (max-width: 360px)` so the header keeps the 20 px gutter. Keep the logo-only rule. The brand icon then starts at x = 20, the same as the content (H-27).

## Before / after

```
390 before                         390 after
[▣ Agent Drive] [Menu] [Sign up]   [▣ Agent Drive] [Menu] [■ Sign up free]   (sticky)
 GIVE THIS TO YOUR AGENT            PASTE THIS INTO YOUR AGENT
 [■ Copy]  (orange, 39 px)          [□ Copy prompt]  (outline, 44 px)
 Free to start.                     Free to start. Your agent shows a pairing
                                    code, and you approve it in your account.
 npm install … [COPY 22 px]         npm install … [COPY 44 px]
```

Mocks were rendered in Playwright Chromium 1.64 because headless Chrome kept a window about 500 px wide and could not render 390. Each mock has an #audit pass that counts interactive targets under 44 px; every render found 0 and no horizontal overflow:

- 390x844: `<scratchpad>/uxv-home/mocks/K3-A-390.png`
- 390x844, menu open: `<scratchpad>/uxv-home/mocks/K3-A-390-menu.png`
- 360x780: `<scratchpad>/uxv-home/mocks/K3-A-360.png`
- 1440x900: `<scratchpad>/uxv-home/mocks/K3-A-1440.png`
- Source: `<scratchpad>/uxv-home/mocks/K3-A-hero.html`

## Files

- `apps/web/app/styles/site-header.css`: `.site-header`, `.site-signup`, `.site-header .brand`, `.site-nav:popover-open`, `@media (max-width: 360px)`.
- `apps/web/app/styles/landing.css`: `.landing` (overflow), `.l-btn`, `.l-panel .l-btn`, `.l-copy`, `.l-cmd`, the new text-link rule.
- `apps/web/app/styles/site-footer.css`: `.sf-cols a`, `.sf-cols ul`, `.sf-cta`.
- `apps/web/app/(app)/page.tsx`: the `SetupPanel` class and caption, the panel tag text, the pricing button label, class and heading, and the final CTA label and class.
- `apps/web/src/content/home.ts`: `HERO.next`. The `/index.md` output reuses it, so the agent-readable page changes with it.
- `apps/web/app/site-footer.tsx` and `site-header.tsx` (`AuthLinks`): label text.
- Tests to update: `tests/e2e/landing.spec.ts` (expects "Start free" and the exact text "Free to start.") and `tests/e2e/site-header.spec.ts`. Its line 29 counts exactly one "Sign up free" link on the page, so scope that check to `header.site-header`. Lines 87, 114 and 135 expect "Create a free account".

## Effort

S, about 2 to 3 hours including test updates. Roughly 40 changed CSS lines and 10 text edits.

## Risks

- **The hero has no filled button.** At 1440 the only filled action in the first screen is the small header button at the top right. The agent prompt is still the most visible block. A visitor who reads only the hero now gets the pairing hint, but no sign-up button next to it. B and C fix this; A does not.
- The `overflow-x: clip` change is required. Without it, the sticky header silently does nothing on `/`. Other routes that wrap the header in an overflow container need the same check (`/pricing` uses the same header).
- Inline links with `padding-block: 12px` can overlap the hit area of the line above or below. That is acceptable in the `.l-also` list (4 px gap, one link per line).
- Footer columns grow by about 10 px per row on phones. This interacts with K5 (footer grid).

## Acceptance criteria

| Criterion                                                    | How A meets it                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K3: exactly one filled primary per region, and it is sign-up | Header: "Sign up free" is filled. Hero: none filled. Copy is an outline button, and the first screen's one filled button is the sticky header. Pricing: only the Free card's "Sign up free" is filled. "Choose plan" stays outline. Final CTA: "Sign up free" is filled, Copy is outline. **Partly met:** the hero region has zero filled buttons, not one. |
| K3: agent prompt prominent but secondary or clearly labelled | It stays in the dark panel, labelled "Paste this into your agent", with the pairing-code sentence under it. Met.                                                                                                                                                                                                                                            |
| K3: header sticky on phones with "Sign up free" as primary   | `position: sticky` plus `overflow-x: clip`, with an orange button. Met (mock is static; sticky behaviour not observed in a scroll).                                                                                                                                                                                                                         |
| K3: one name for sign-up                                     | "Sign up free" in the header, pricing, final CTA, footer and auth links. Met.                                                                                                                                                                                                                                                                               |
| K4: every target ≥ 44 px at 390/360                          | Mock audit: 0 targets under 44 px in the header and hero at 390 and 360. Pricing, compare, FAQ and footer follow by CSS rules but have no mock. Not verified.                                                                                                                                                                                               |
| K4: one link style per role                                  | Content text links: underlined, ink, weight 500. Nav links: plain, ink-2. Buttons: `.l-btn`. Met.                                                                                                                                                                                                                                                           |
| K4: menu aligned to the page gutter                          | Right edge at 370 on a 390 screen, the same as content. Mock `K3-A-390-menu.png`. Met.                                                                                                                                                                                                                                                                      |

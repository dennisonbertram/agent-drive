# VC-2 / B Restructure: text-role classes and a console density mode

## Change

Stop setting `font-size` per selector. Define a small set of text roles as utility classes (and token pairs of size + line-height + weight), and give the console a denser scale than marketing pages.

Tokens in `:root` (marketing/reading default):

- `--t-caption: 0.75rem/1.4`, `--t-body: 1rem/1.55`, `--t-lead: 1.125rem/1.5`, `--t-title: 1.5rem/1.2`, `--t-hero: clamp(3rem,7vw,6rem)/1.04`.
  Override block `.console-shell, .settings-page, .billing-page { --t-body: 0.8125rem/1.45; --t-lead: 0.9375rem/1.4; --t-title: 1.25rem/1.25; }` so the same class is 13px in the console and 16px on public pages.

Classes: `.t-caption`, `.t-body`, `.t-lead`, `.t-title`, `.t-hero`, `.t-label` (12px, weight 600, replaces every uppercase 8-10px eyebrow/th/terminal-label/encrypted-label; no uppercase, no letter spacing).
Replace `font-size` in `th`, `td`, `.badge`, `.cell-subtext`, etc. with `font: var(--t-caption)` or compose the class in markup.

## Before / after

Before: each component picks a rem. After: components choose a role; density is decided once per surface.

## Wireframe

```
Public (16px body)              Console (13px body)
+---------------------+         +----------------------------+
| Title (24)          |         | Title (20)                 |
| Body text (16)      |         | Label (12, 600)            |
| caption (12)        |         | Body (13)   caption (12)   |
+---------------------+         +----------------------------+
```

## Files / selectors touched

`globals.css` (`:root`, console/billing/settings override block, every `font-size`); `pricing.css`, `billing.css`, `settings.css`; page and component markup in `apps/web/app/(app)/console/**` and `apps/web/app/(app)/pricing/**` to add role classes where selectors are removed.

## Effort

L (largest). Touches markup, not only CSS.

## Risks

- Highest regression surface; many selectors lose their font-size and depend on markup classes.
- Two density modes means a component copied between surfaces changes size; documented in the CSS comment.
- Takes longer than the contrast fix and may block VC-1 if done together.

## How it meets the criteria

1. No text under 12px on console: caption is the floor (0.75rem) and `.t-label` is 12px.
2. Same floor on public pages.
3. <= 6 sizes per screen: five role sizes plus hero; console uses 12/13/15/20.
4. All font sizes are tokens: no `font-size` literals remain; the grep test enforces it. Token count 5-6.
5. Row height: 13px console body keeps rows at about 48px, so density improves relative to A.

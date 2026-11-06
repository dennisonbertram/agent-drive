# VC-2 / C Convention: GitHub Primer and Vercel dashboard type ramps

## Pattern

Primer defines a fixed ramp (caption 12, body-small 14, body 16, subtitle 20, title-medium 32, display 48) with paired line-heights, and its dashboards use 14px as the working size. Vercel's dashboard also uses 14px body, 12px for meta, 16px for card headings, 24-32px for page titles. Best-in-class data products use a 12/14/16/20/24/32 ramp with no sizes under 12px. No brand assets; only the ramp.

## Change

Adopt a 12/14/16/20/24/32/display ramp for the whole app, 14px as the body size everywhere signed in.
Tokens: `--fs-12 0.75rem`, `--fs-14 0.875rem`, `--fs-16 1rem`, `--fs-20 1.25rem`, `--fs-24 1.5rem`, `--fs-32 2rem`, `--fs-display clamp(3rem,7vw,6rem)`; `--lh-tight 1.2`, `--lh-body 1.5`; `--fw-regular 400`, `--fw-strong 600` (drop 500/550 variants, which are near-duplicates).
Rules: table cell 14px, table header 12px/600, badge 12px, row actions 14px (also fixes VC-8 target height), h1 is 32px on every console and billing page, landing h1 is display, pricing h1 is 32 to 48 via clamp.

## Before / after

Before: 8.6-11.5px table text, h1 48px (Billing) vs 32px (Files). After: 14px cells, 12px header/badges, 32px h1 everywhere.

## Wireframe

```
+--------------------------------------------------+
| Files                                    (32/600) |
| Name (12/600)        Size (12/600)  Updated      |
| notes.md (14/400)    4 KiB (14)     2m ago (14)  |
|   [v3] (12)                                      |
+--------------------------------------------------+
```

## Files / selectors touched

`globals.css` (`:root`, all `font-size`, `font-weight` near-duplicates), `pricing.css`, `billing.css` (h1 48 to 32, shared with VC-9), `settings.css`.

## Effort

M. Same selector set as A, with a stricter mapping and weights.

## Risks

- 14px table text makes the Files table the widest option; with Name/Size/Updated/Actions at 1131px it likely fits, but `td` padding should go from 20px to 12px vertical to hold row height near 52px. Unmeasured at 768/375.
- Weight consolidation visibly changes headings (550 to 600).

## How it meets the criteria

1. Console >= 12px: ramp minimum is 12px.
2. Public pages >= 12px: same.
3. <= 6 sizes per screen: ramp is 6 sizes plus display; Files uses 12/14/20 or 32 (4).
4. Tokens only: grep test; token count 7 (display counted).
5. Row height <= 56px: `td { padding: 12px 20px }` gives 14px x 1.5 + 24 = 45px single-line rows.

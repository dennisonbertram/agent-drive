# VC-2 / A Minimal: six size tokens, snap every font-size to one

## Change

Add six tokens to `:root` in `apps/web/app/globals.css` and replace each `font-size` value by snapping to the nearest token. Root font size is 16px, so rem x 16 = px.

| Token          | Value                    | Replaces (rem)                                                                                                                                                                          |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--fs-xs`      | 0.75rem (12px)           | 0.48 to 0.75 (th 0.54, `.encrypted-label` 0.55, `.terminal-label` 0.58, `.badge` 0.6, `.cell-subtext` 0.6, `.row-actions button` 0.66, `td` 0.72, `.terminal-preview p` 0.72, eyebrows) |
| `--fs-sm`      | 0.8125rem (13px)         | 0.76 to 0.88 (`.settings-audit` 0.82, form hints)                                                                                                                                       |
| `--fs-md`      | 0.9375rem (15px)         | 0.89 to 1.1 (`.hero-copy` 1.05, body copy)                                                                                                                                              |
| `--fs-lg`      | 1.25rem (20px)           | 1.11 to 1.5 (card titles)                                                                                                                                                               |
| `--fs-xl`      | 2rem (32px)              | 1.6 to 2.4 (console h1 32px, share h1 clamp top 2.1rem)                                                                                                                                 |
| `--fs-display` | `clamp(3rem, 7vw, 6rem)` | hero h1 and pricing h1                                                                                                                                                                  |

## Before / after

Before, Files screen: 8, 9, 10, 11, 12, 13, 15, 18, 19, 22, 32px (11 sizes, 26 nodes at <= 10px). After: 12, 13, 15, 20, 32 (5 sizes). Table header, cell text, subtext and badges are all 12px; weight and color (VC-1) separate them.

## Wireframe

```
Before                                   After
NAME (8.6px)  SIZE   UPDATED             NAME (12px, 600)  SIZE   UPDATED
notes.md (11.5px)                        notes.md (13px)
 v3 (9.6px)                               v3 (12px)
```

## Files / selectors touched

`globals.css`: `:root` plus every `font-size` (about 80 declarations; the heavy ones are `th`, `td`, `.badge`, `.cell-subtext`, `.encrypted-label`, `.row-actions button`, `.terminal-label`, `.terminal-preview p`, `.eyebrow`, `.hero h1`, `.hero-copy`, `.share-card h1`). Also `pricing.css`, `billing.css` (h1 48px becomes `--fs-xl`; resolves part of VC-9), `settings.css`.

## Effort

M. Mechanical, but wide; needs a screenshot pass on every page.

## Risks

- Raising 8.6-10px text to 12px makes the Files table about 15-20% wider and rows a little taller; column wrapping at 1131px must be checked. `th { white-space: nowrap }` can overflow `.table-scroll` and cause horizontal scroll inside the table.
- Snapping loses small intentional differences (e.g., 0.66 vs 0.72 rem).
- Signed-in tablet/phone not measured; check at 768/375.

## How it meets the criteria

1. Nothing below 12px on console: smallest token is 12px, enforced by a test that scans computed font sizes on each console route.
2. Landing/pricing/share >= 12px: same token floor.
3. <= 6 sizes per screen: only six tokens exist; Files shows 5.
4. All `font-size` use tokens: grep test fails on a literal `font-size: <n>rem` outside `:root` (clamp built from tokens allowed).
5. Row height <= 56px: `td` padding stays 20px vertically only if it fits; reduce to 16px (see risks) to keep 12px text rows near 52px.

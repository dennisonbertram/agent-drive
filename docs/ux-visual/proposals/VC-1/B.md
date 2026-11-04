# VC-1 / B Restructure: two text tiers and no pale third tier

## Change

Remove the idea of a "faint" text color. Replace the greys with role tokens, and change the places that used pale text to carry secondary information in a different way (position and weight, not paleness).

Tokens (in `:root`, `apps/web/app/globals.css`):

- `--text` `#202a23`, `--text-2` `#4a5448` (body, table cells, subtext), `--muted` `#5f695f` (labels, hints only).
- `--link #58703d`, `--focus #5c8a2c`, `--on-dark #e7efde`, `--on-dark-2 #c3cbbd`.
- Status pairs: `--ok-bg #ecf5df / --ok-fg #4d6634`, `--neutral-bg #f0f2ed / --neutral-fg #4a5448`.

Structural changes:

- `.cell-subtext` stops being a separate pale second line. Version and "encrypted" move into one inline meta chip next to the file name (`.badge`), so the row is one line tall.
- `th` becomes sentence case, 12px, weight 600, `--text-2` (no uppercase, no letter spacing). This removes the lightest text in the product.
- `.file-icon` becomes `--text-2` on `#f0f2ed`.
- `.breadcrumb` separator becomes a CSS chevron using `border` in `--muted`, not a pale glyph.

## Before / after

```
Before                                         After
NAME (pale caps)  SIZE  UPDATED                Name            Size    Updated
[f] notes.md      4 KiB 2m ago                 [f] notes.md [v3] [encrypted]  4 KiB  2m ago
    v3 . encrypted (pale, 2.7:1)               (one line, 4.9:1+)
```

## Files / selectors touched

`globals.css`: `:root`; `th`, `td`, `.cell-subtext` (delete rule, move content), `.badge`, `.badge.positive`, `.file-icon`, `.breadcrumb`, `.encrypted-label`, `.eyebrow`, `.banner.info`, `:focus-visible`. Console Files table component (find `cell-subtext` usages under `apps/web/app/(app)/console/`) to render meta as badges. `pricing.css`, `billing.css`, `settings.css`: tokens.

## Effort

M. CSS plus one table component change and its tests.

## Risks

- Rows with long names and two badges wrap on narrow widths; need `flex-wrap` and a 375/768 console pass (not measured yet).
- Changing header case affects the visual identity of the console; the eyebrow style on page headings should stay for consistency or move too.
- More badges per row raises noise (D5); cap at two.

## How it meets the criteria

1. Text >= 4.5:1: no color below `--muted` (5.07+ on light surfaces) exists in the system, so the audit lowContrast list is empty by construction.
2. UI >= 3:1: `--focus`; borders that carry meaning use `--muted`.
3. No hex outside `:root`: enforced by the same CSS grep test.
4. Breadcrumb separator is a bordered chevron in `--muted`.
   Extra: rows become shorter, helping VC-2 criterion 5.

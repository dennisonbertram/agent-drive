# VC-1 / A Minimal: swap the greys for three tokens

## Change

Add text-color tokens to `:root` in `apps/web/app/globals.css` and replace every per-selector grey/green text hex with one of them. No layout change.

New tokens (contrast computed against `#ffffff` / `#f7f8f4` / `#f0f2ed` / `#ecf5df`):

- `--muted: #5f695f` (replaces `#707a71`): 5.72 / 5.36 / 5.07 / 5.09.
- `--text-2: #4a5448` for table body, subtext: 7.9 / 7.4 / 7.0 / 7.1.
- `--link: #58703d` (row action buttons, replaces `#677b4b` which is 4.36 on the page background): 5.53 / 5.18 / 4.90 / 4.92.
- `--focus: #5c8a2c` for the 3px focus ring: 3.84 on `#f7f8f4` (>= 3:1 for UI).
- `--on-dark-muted: #c3cbbd` for text on the `--ink` terminal card (verify >= 4.5 with the audit; `#acb4a8` is about 6.95:1 already, so this may be unnecessary).

## Before / after

Before: breadcrumb `#c4cbbf` (1.56), `.cell-subtext` `#99a08f` (2.70), `th` `#8c9583` (3.05), `.badge` `#808973` (3.24), `.file-icon` `#8f9c80` (2.76), `.encrypted-label` (2.98), footer 2.91, eyebrow 4.02.
After: all of them use `--muted` or `--text-2`; badges keep their tinted backgrounds but text becomes `--text-2` (neutral) and `#3f5f1f`-class dark green for `.badge.positive` (pick the value that gives >= 4.5 on `#ecf5df`; `#577a31` is 4.42, so darken to about `#4d6634`, 5.72).

## Wireframe (Files table row)

```
Before                                   After
NAME            SIZE   UPDATED           NAME            SIZE   UPDATED     (th 12px, --muted)
[f] notes.md    4 KiB  2m ago            [f] notes.md    4 KiB  2m ago
    v3 . encrypted (pale grey)               v3 . encrypted (--muted, same size)
```

No geometry changes; only color.

## Files / selectors / tokens touched

- `apps/web/app/globals.css`: `:root` (add `--text-2`, `--link`, `--focus`, change `--muted`); `.breadcrumb` (line ~458; also set `margin` unchanged), `.encrypted-label`, `.badge`, `.badge.positive`, `th`, `td`, `td:first-child` (keep), `.file-icon`, `.cell-subtext`, `.row-actions button`, `.eyebrow` (line 198), `.hero-copy`, footer selectors, `.banner.info`, `:focus-visible` rule (use `--focus`).
- `pricing.css`, `billing.css`, `settings.css`: replace text hex with tokens.
- Breadcrumb separator: use `color: var(--muted)` and keep as glyph.

## Effort

S. About 25 selector edits, one test.

## Risks

- Everything gets darker, so the calm look loses some softness; hierarchy now depends on size and weight rather than paleness. Mitigation: VC-2 sets sizes and weights.
- `--muted` is used by about 7 existing rules; they all darken at once.
- Terminal card text is on a dark surface; do not apply `--muted` there.

## How it meets the criteria

1. Text >= 4.5:1: all three text tokens are >= 5.07 on every light surface in use; verify with the layout audit lowContrast list (target 0).
2. UI >= 3:1: `--focus` is 3.84:1 on the page background.
3. No hex text outside `:root`: done by the selector replacement; enforce with the grep test below.
4. Breadcrumb separator: now `--muted`.
   Test: a Node test that reads the four CSS files and fails if a `color:` declaration holds a hex literal outside `:root`.

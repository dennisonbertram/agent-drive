# VC-1 / C Convention: GitHub Primer and Stripe Dashboard text roles

## Pattern

GitHub Primer ("fg.default / fg.muted / fg.subtle") and the Stripe Dashboard both use exactly three text roles on light surfaces: default, secondary, and a tertiary that is still >= 4.5:1. Disabled is the only role allowed below 4.5:1. Status is shown with a tinted pill and dark text (Primer labels, Stripe status badges), and table headers are sentence case in secondary color, not uppercase pale caps. No brand assets are copied; only the role structure.

## Change

Adopt role tokens with those names and rules:

- `--fg-default #202a23`, `--fg-muted #4a5448`, `--fg-subtle #5f695f` (all >= 5.07 on `#ffffff`, `#f7f8f4`, `#f0f2ed`, `#ecf5df`), `--fg-disabled #9aa393` (2.45:1, allowed only on `:disabled`).
- `--fg-link #58703d`, `--focus #5c8a2c`.
- Keep `--muted` as an alias of `--fg-subtle` so existing references work.
- Status pills: dot + dark text on a tint (`.badge::before` 6px dot). Success `#4d6634` on `#ecf5df` (5.72), neutral `#4a5448` on `#f0f2ed` (7.0).
- Table headers: sentence case, 12px, `--fg-muted`, weight 600.
- A written rule in a comment block above `:root`: "text never uses a value outside --fg-\*; only `:disabled` may use --fg-disabled."

## Before / after

```
Before: ( BADGE pale grey on grey, 3.24:1 )    After: ( o  v3 )  dot + dark text on tint
Before: NAME  SIZE (8.6px caps, 3.05:1)        After: Name  Size (12px, 600, 7.0:1)
```

```
+-----------------------------------------------+
| Name              Size     Status             |
| notes.md          4 KiB    (o Encrypted)      |
| plan.pdf          2 MiB    (o Encrypted)      |
+-----------------------------------------------+
```

## Files / selectors touched

`globals.css`: `:root` (new `--fg-*`, keep `--muted` alias, `--ink` alias of `--fg-default`), `th`, `td`, `.badge`, `.badge::before` (new), `.badge.positive`, `.cell-subtext`, `.file-icon`, `.breadcrumb`, `.encrypted-label`, `.eyebrow`, `.banner.info`, `.row-actions button`, `:focus-visible`, `button:disabled`. Page CSS files: replace hex.

## Effort

S-M. Same selectors as A, plus a rename and the badge dot; no structural component change.

## Risks

- Naming churn: two names (`--muted` and `--fg-subtle`) during the transition; remove the alias in a follow-up.
- Dots add a small element; color is never the only carrier because the badge also has text (C3).
- Sentence-case headers change the console identity slightly.

## How it meets the criteria

1. Text >= 4.5:1: all `--fg-*` except `--fg-disabled` are >= 5.07 on every light surface; disabled is exempt by criterion.
2. UI >= 3:1: `--focus` 3.84:1; badge dot uses text color.
3. No hex outside `:root`: grep test; comment block documents the rule.
4. Breadcrumb separator: `--fg-subtle`.

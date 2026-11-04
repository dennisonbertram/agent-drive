# Console, Billing, Activity & deletion — visual findings (signed in)

Captured by the lead in the user's signed-in Chrome on https://agent-drive.vercel.app, 2026-11-03.
Viewport: 1131×959 CSS px (DPR 2). The Chrome window could not be resized, so tablet and phone
behavior was **not measured** for signed-in pages; it is judged from CSS only where stated.

## Measurements (layout audit, Files tab)

- 11 distinct rendered font sizes on one screen (8, 9, 10, 11, 12, 13, 15, 18, 19, 22, 32 px); 26 text nodes at 10 px or below.
- Source CSS declares ~25 distinct `font-size` values, many below 0.7rem (down to 0.48rem ≈ 7.7px): `th` 0.54rem (8.64px), `.cell-subtext` 0.6rem, `.badge` 0.6rem, `.encrypted-label` 0.55rem. No type-scale tokens exist (globals.css defines 4 custom properties total).
- Contrast below WCAG AA (4.5:1 for small text): breadcrumb 1.56, `.cell-subtext` 2.70, `.file-icon` 2.76, `.encrypted-label` 2.98, `th` 3.05, `code` (drive id) 3.04, `.badge` 3.24, `.eyebrow` 4.02, `.banner.info` 4.27.
- Row action buttons (Download / Trash / Versions) are 20 px tall (28–50 px wide): below the 24 px minimum target.
- Spacing: 15 off-4px-scale values in use (5, 6, 7, 9, 10, 11, 14, 15, 17, 18, 19, 22, 34, 35, 38).
- Billing page: 2.3 viewport heights; page `h1` 48 px vs console `h1` 32 px.
- Activity & deletion: the audit log is an inner scroll region inside a scrolling page; 15 wheel ticks over it never reached "Delete your data" (top at 1036 px). See `shots/1131x959-settings-scroll-trap.jpg`.

## Findings

| id   | level     | element                                               | problem                                                                                | norm                       | evidence                                | severity | found by | verified |
| ---- | --------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- | -------- | -------- | -------- |
| C-01 | layout    | type scale                                            | ~25 ad-hoc font sizes, many 8–10 px; no tokens                                         | H3 type scale; readability | CSS tally; audit sizes                  | P1       | own      | measured |
| C-02 | component | muted text (th, subtext, badge, breadcrumb, drive id) | contrast 1.56–3.24:1                                                                   | A1 WCAG AA 4.5:1           | lowContrast list                        | P1       | own      | measured |
| C-03 | component | file row actions                                      | 20 px tall text buttons, three in a row                                                | I4 target ≥ 24 px          | smallTargets                            | P2       | own      | measured |
| C-04 | page      | Activity & deletion                                   | nested scroll traps the wheel; deletion section unreachable by wheel over the table    | L3 one scroll owner        | shots/1131x959-settings-scroll-trap.jpg | P1       | own      | observed |
| C-05 | layout    | Billing/Settings shells                               | separate page shell, 48 px h1 vs 32 px console h1, "Back to workspace"/"Back to files" | L layout consistency       | shots/07-billing-top.jpg vs 02          | P2       | own      | measured |
| C-06 | layout    | spacing                                               | 15 off-scale spacing values                                                            | D3 spacing scale           | audit spacing.offScale                  | P3       | own      | measured |

## Excellent as is

- Restrained palette and calm visual tone; one clear primary action per console screen (`+ New drive`, `+ New agent`, `+ New API key`).
- Empty states with a single call to action (Trash "Nothing in the trash.", onboarding "Give your first agent a home.").
- No horizontal overflow at desktop width.

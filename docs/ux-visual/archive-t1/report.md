# UX Visual Report — 2026-11-03

Target: https://agent-drive.vercel.app (production). Round 1 merged in PR #33 and deployed.

## Scope and coverage

| Surface                                                      | Viewports measured                     | How                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Landing, pricing, share page                                 | 1440×900, 1920×1080, 768×1024, 375×812 | Headless agent-browser, layout-audit.js + geometry-audit.js, MUSE Wonder and Gemini Argon second opinions (Argon failed on pricing) |
| Console Files, API keys, Usage, Billing, Activity & deletion | 1131×959 only                          | User's signed-in Chrome; the window could not be resized, so tablet and phone were **not measured** for signed-in pages             |

Run was scaled down from the skill's full panel: one consolidator wrote all proposals, and the lead judged them with `solution-rubric.md` instead of three internal and two external judges per cluster.

## Clusters implemented (PR #33)

| Cluster              | Decision                                         | Before                                                               | After (measured on production)                                                                  |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| VC-1 Contrast        | Text-colour tokens                               | 9 console selectors at 1.56–4.27:1                                   | Console Files: 0 text elements below 4.5:1 (disabled controls excluded); landing and pricing: 0 |
| VC-2 Type scale      | Six size tokens, 12px minimum                    | 11 sizes on Files, smallest 8.6px; ~25 sizes in CSS                  | Files: 5 sizes (12, 13, 15, 20, 32px); landing and pricing minimum 12px                         |
| VC-3 Settings scroll | Remove inner scroller                            | Wheel over the audit log never reached "Delete your data"            | No inner scrollers; 20 wheel ticks over the log reach "Delete your data"                        |
| VC-4 Landing CLI     | Wrapping command + Copy                          | Command clipped at 375px (scrollWidth 407 vs 327)                    | Fits at 375px (224 = 224; page 375); e2e phone check passes                                     |
| VC-5 Pricing wording | "Downloads not charged" when egress is unmetered | Cards listed a download allowance while the table said "Not charged" | All plan cards read "Downloads not charged"                                                     |

## Deferred (filed)

- #34 VC-6 Share link error page is a dead end (P1)
- #35 VC-7 Landing hero composition and missing trust links (P1/P2)
- #36 VC-8 Interactive targets under 24px (P2)
- #37 VC-9 Page frames differ between public pages, Billing, and Settings (P2)
- #38 VC-10 Display type details (P2)
- #39 VC-11 Spacing scale, list styling, card rhythm (P3)

## Still open

- Billing page plan cards still say "monthly download allowance"; VC-5 covered `/pricing` only.
- A "Recommended" label and moving the highlighted plan need owner copy decisions.
- Console layout at tablet and phone widths has not been measured.
- The Copy button was not clicked in a browser; its failure path is code-reviewed only.

## Excellent as is

- One clear primary action per console screen; calm, restrained palette.
- Empty states with a single call to action.
- No horizontal overflow at any measured viewport.

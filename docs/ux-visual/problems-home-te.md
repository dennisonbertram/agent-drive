# Homepage (Direction C figures) — problem register, 2026-11-09

Source: pages/home-te/findings.md (28 findings: P1 1, P2 13, P3 14). Viewports 1440, 768, 390, 360. Lead re-checked H-14, H-07 and H-01 against the 360/390 screenshots: confirmed.

| Cluster | Title                                          | Root cause                                                                                                                                             | Findings                                       | Sev | Reach                            |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --- | -------------------------------- |
| K1      | Figures don't have a phone layout              | Each 520x420 panel is scaled down to ~320 px instead of reflowing; grey labels use #a8a69f (2.2:1); decorative codes (AD-01, S01, timecodes) add noise | H-14, H-13, H-17, H-20, H-21, H-22, H-28       | P2  | hero, games, protein             |
| K2      | Mobile page is 13.7 screens and repeats itself | Desktop multi-column sections stack verbatim on phones; same facts repeated across sections                                                            | H-02, H-07, H-08, H-09, H-10, H-15, H-16, H-19 | P2  | whole page                       |
| K3      | No clear primary action for a human            | Orange "Copy" is the only filled button; header not sticky; sign-up has five names                                                                     | H-01, H-03, H-05, H-25                         | P1  | hero, header, pricing, final CTA |
| K4      | Small touch targets and inconsistent links     | Link/button sizes not set for touch; two link styles for one role; menu popover not aligned                                                            | H-11, H-12, H-26, H-27                         | P2  | whole page                       |
| K5      | Off-grid footer and loose type/spacing scale   | Footer uses its own gutters; ad-hoc sizes in landing.css and te-figures.css                                                                            | H-04, H-06, H-24                               | P2  | whole page                       |

Not carried: H-18 (phone console image needs a re-shot; deferred), H-23 (Fable 6.2 sentence is the owner's explicit choice; kept).

## Acceptance criteria

- K1: at 360 and 390 no text inside a figure overlaps or touches other text/lines (geometry check); every figure label ≥ 12 px effective and ≥ 4.5:1 contrast; no decorative codes without meaning; reduced-motion frames look active, not disabled; first paint uses the mobile size.
- K2: page ≤ 9 screens at 390 (≤ 7,600 px); activity log rows labelled on phones; relay stacks below 1000 px; console image readable (≥ 11 px text) at 768; each fact stated once.
- K3: exactly one filled primary per screen region and it is sign-up for humans (the agent prompt stays prominent but secondary or clearly labelled); header sticky on phones with "Sign up free" as primary; one name for the sign-up action.
- K4: every interactive target ≥ 44 px tall at 390/360; one link style per role; menu panel aligned to the page gutter.
- K5: footer edges align with page content at all four widths; ≤ 6 font sizes in landing + figure CSS; spacing values on the 4/8 scale.

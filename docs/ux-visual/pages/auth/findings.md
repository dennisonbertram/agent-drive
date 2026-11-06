# /sign-in and /sign-up findings
IMPORTANT: Clerk is not configured locally, so the real Clerk forms were NOT audited. This audits only the frame (`auth-page` layout) and the "not configured" fallback card as rendered. The Clerk theme (`apps/web/app/(app)/sign-in/appearance.ts`) was read in code only; its rendering is unverified.
Session `ux-visual-auth`. Shots `shots/{viewport}-signin*.png`, `-signup*.png`; metrics in `audit.json`.

## Verdicts
- sign-in at 1440x900 / 768x1024 / 390x844: centered brand + 440px bordered card with 2px bottom rule; matches the design system. It is a dead end: heading, one sentence of operator instructions, nothing to click.
- sign-up, same viewports: identical frame, heading "Create your workspace", same dead end.

## Findings
| id | level | element | problem | norm | evidence | sev | found by | verified |
|----|-------|---------|---------|------|----------|-----|----------|----------|
| A-1 | page | fallback card | No link to the other auth page, pricing or docs (only the brand mark links home). Nothing the user can do | I6, I3 | 1440x900-signin.png; DOM has one link | P1 | own | measured |
| A-2 | component | fallback copy | "Configure the Agent Drive Clerk instance to enable human access." tells a visitor to configure the operator's vendor; jargon, not actionable | C1, C4, I3 | 1440x900-signup.png | P1 | own | observed |
| A-3 | component | sign-up heading | "Create your workspace" is the only place "workspace" appears; the product says account and drive | C1 | signup vs signin shots | P2 | own | observed |
| A-4 | layout | brand placement | Auth pages center the brand above the card; /connect left-aligns it to the card and top-anchors it (88px) instead of centering vertically | H5, L4 | auth 1440x900-signin.png vs connect 1440x900-entry.png | P2 | own | observed |
| A-5 | component | Clerk appearance (code-read) | Theme maps colors/fonts only; Clerk's footer, dev badge, social buttons, error red `#8b3027`, and orange primary with dark text not seen rendered | A1, H4 | appearance.ts | P2 | own | suspected, unverified |
| A-6 | page | dead space | Card about 160px tall in a 100vh centered page: 11% of the 390x844 viewport used | D2 | audit deadSpace | P3 | own | measured |

## Excellent as is
Card styling (1px ink border, 6px radius, 2px drop rule) and heading scale match the system; no overflow at any viewport; 16px mobile gutters.

# /console/billing ("Billing & limits") (localhost:3500, 2026-11-06)

Shots `shots/{1440x900,768x1024,390x844}-default(.png|-full.png)`, `audit.json`. Export CSV not clicked (no side effect needed; the control was inspected visually). Plans/usage all rendered. Second opinions skipped.

## Verdicts
- 1440x900: well-structured. Three summary tiles, plan comparison, spending controls, usage-by-agent table with export. Scroll 1708px, acceptable for a content page; Save and export are reachable. Visible weaknesses: the "Not connected" tile gives a status as a headline value (and every row of the usage table repeats "Not connected" 17 times); the plan buttons are all disabled grey ("Choose developer", "Choose team") and nothing explains how to upgrade beyond a note under the cards; the "Stay in control" left column is a blank 280px beside the form; usage table includes 16 rows of mostly "0 B / Not connected" test agents.
- 768x1024: summary tiles wrap to 2+1 (third tile full width, uneven); plan cards become a stacked list; works.
- 390x844: tiles stack (3 x 180px, consuming the first screen before the plan), table header row spills horizontally (geometry overflowSpills), but no page-level horizontal scroll.

## Findings
| id | level | element | problem | norm | evidence | sev | found by | verified |
|---|---|---|---|---|---|---|---|---|
| BL1 | component | "Observed downloads" tile and column | "Not connected" is used as the headline value and repeated in every usage row; reads as an error or missing integration, not as data | C3, D5 | 1440x900-default-full.png | P1 | own | observed |
| BL2 | group | plan cards | All CTAs disabled grey, including "Current plan"; the reason sits in a banner above and a footnote below; no hover/title explaining; selected plan marked only by a small orange "SELECTED" label | I8, H1 | 1440x900-default.png | P2 | own | observed |
| BL3 | group | Stay in control | Two-column layout leaves ~280px blank under the left explanatory text; form with three fields where email alert cannot send ("Email delivery is not configured") but is still offered | D2, C4 | 1440x900-default-full.png | P2 | own | observed |
| BL4 | group | usage table | 17 rows with a tiny font; mostly zeros; no sorting or hide-zero; operations column left-aligned (numeric columns should right-align); at 390 the header row spills | H6, D5, L6 | 1440x900-default-full.png; geometry overflowSpills | P2 | own | measured |
| BL5 | page | summary tiles at 768 | Third tile drops to a full-width row, unequal heights | L4 | 768x1024-default-full.png | P2 | own | observed |
| BL6 | page | mobile | Three 180px tiles fill the 844px viewport before the plan; page scroll 4547px | D5, L1 | 390x844-default.png | P2 | own | measured |
| BL7 | component | nav | "Settings" text link beside "Back to files" is low-contrast grey and gives no current-page cue; same pattern on Settings | I6 | 1440x900-default.png | P3 | own | observed |
| BL8 | component | small targets | 3 targets <24px per audit | I4 | audit.json smallTargets | P3 | own | measured |

## Excellent as is
- Clear numeric hierarchy in tiles and plan prices (large display figures).
- Honest microcopy ("Authorizations are not charges", "This is not a guaranteed invoice ceiling").
- One primary action ("Save spending controls") in its group, with Download CSV as secondary next to its period select.
- Plan comparison reads well at 1440 as a three-column table.

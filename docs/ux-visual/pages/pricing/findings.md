# /pricing findings

Inspector: own only. Session `ux-visual-pricing`, signed out. Shots `shots/{viewport}-main*.png`; metrics `audit.json`.

## Verdicts

- 1440x900 (`1440x900-main.png`, `-main-full.png`): Clean, scannable three-column plan table with hairlines; one orange primary. Page 1362px tall, fine for content. A deployment-status banner above the prices weakens the first read.
- 768x1024 (`768x1024-main.png`): Plans stack in one column; fine.
- 390x844 (`390x844-main.png`): Header fits (Pricing, Sign in, Open console); plans stack; Start with Free reachable. No overflow.

## Findings

| id   | level     | element               | problem                                                                                                                                                                                                                                  | norm       | evidence                | sev | found by | verified                                  |
| ---- | --------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------- | --- | -------- | ----------------------------------------- |
| PR-1 | page      | top banner            | "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; ..." is operator language shown to every visitor above the prices, and contradicts the "Start with Free" CTA below | C1, C4, H1 | 1440x900-main.png       | P1  | own      | observed (may be environment-conditional) |
| PR-2 | layout    | header                | Signed-out visitor gets "Open console" as the only button, no Sign up; header differs from landing (L-4)                                                                                                                                 | H1, H5     | 1440x900-main.png       | P2  | own      | observed                                  |
| PR-3 | group     | plan feature lists    | Prose features ("CLI, MCP, web console, and encrypted sharing") set in 13px mono and wrapped; identical last line repeated in all three plans                                                                                            | H3, C2, D1 | 1440x900-main.png       | P2  | own      | observed                                  |
| PR-4 | group     | "How usage works"     | Two columns misaligned (left tag + H2 + 2 paragraphs, right only a tag); jargon ("monthly high-water allocation", "observed storage logs") in 13px grey without hierarchy                                                                | H6, C1, D4 | 1440x900-main-full.png  | P2  | own      | observed                                  |
| PR-5 | component | targets               | Nav links 21px, footer "AGENT DRIVE" link 15px tall                                                                                                                                                                                      | I4         | audit.json smallTargets | P2  | own      | measured                                  |
| PR-6 | component | price format          | "$0.00 / $20.00 / $200.00" trailing decimals; landing uses "$0/$20/$200"                                                                                                                                                                 | H5         | shots                   | P3  | own      | observed                                  |
| PR-7 | component | "Coming soon" buttons | Disabled-looking buttons with no explanation or notify path; Developer and Team differ only by numbers (no emphasis, no differences called out)                                                                                          | I8, C4     | 1440x900-main.png       | P3  | own      | observed                                  |

## Excellent as is

Plan table (big number, mono features, hairline columns); one primary action; "01/02/03" principle row; section spacing; no horizontal overflow; no low-contrast or overlap hits in the audit.

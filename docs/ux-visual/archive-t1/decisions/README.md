# UX visual decisions — 2026-11-03

Judged by the lead with `solution-rubric.md`, in place of the full judge panel (one judge per
lens plus external models), to keep this run proportionate. Proposals are in `../proposals/`.
Copy marked TBD in any proposal is left out; product wording decisions stay with the owner.

| Cluster                        | Chosen                                                                                                                              | Why it wins                                                                                                   | Not chosen, and why                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| VC-1 Contrast                  | **A** — three text-colour tokens in `globals.css` (`--muted #5f695f` and siblings), selectors switched to them                      | Meets WCAG AA on every measured selector with the smallest diff; tokens fix the root cause (hard-coded greys) | B removes a text tier and restructures rows (more risk, no extra contrast gain); C renames the whole colour system (large churn for the same result) |
| VC-2 Type scale                | **A** — six size tokens, every existing size snapped to the nearest, minimum 12px for text                                          | Removes 8–10px text without redesigning screens; one place to change sizes later                              | B adds a density mode (new concept); C changes the working size to 14px everywhere (visible redesign, needs owner sign-off)                          |
| VC-3 Settings scroll trap      | **A** — remove the audit log's inner scroll region so the page has one scroll owner                                                 | Directly meets "single scroll owner"; no navigation change                                                    | B/C reorder the page or add a route — reasonable later, but they change information architecture already under issue #31                             |
| VC-4 Landing CLI snippet       | **A without the output line** — wrap the command and add a Copy button                                                              | Command fully visible at 375px, no horizontal scroll; copy is the conventional affordance                     | The output line needs invented CLI output (TBD); B/C restructure the hero (deferred VC-7 territory)                                                  |
| VC-5 Pricing allowance wording | **A, wording part only** — when `S3_EGRESS_METERING=none`, plan cards say downloads are not charged instead of listing an allowance | Removes the contradiction between cards and the overage table using a fact the app already knows              | Moving the filled button and a "Recommended" label are product decisions (TBD); B/C rebuild the page                                                 |

## Acceptance criteria carried into implementation

- VC-1: every text selector measured in `problems.md` reaches ≥ 4.5:1 (≥ 3:1 for ≥ 24px or ≥ 18.66px bold); disabled controls exempt.
- VC-2: no rendered text below 12px on landing, pricing, share, console, billing and settings; font sizes come from the six tokens.
- VC-3: `/console/settings` has one scroll owner; wheel scrolling over the audit log reaches "Delete your data".
- VC-4: at 375×812 the landing command is fully visible without horizontal scroll; Copy places the exact command on the clipboard and announces success.
- VC-5: with `S3_EGRESS_METERING=none`, no plan card lists a download allowance; without it, cards are unchanged.

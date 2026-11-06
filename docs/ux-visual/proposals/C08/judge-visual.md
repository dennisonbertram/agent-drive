# C08 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 4 | 4 | 4 | 51 |
| B | 5 | 3 | 4 | 4 | 4 | 3 | 48 |
| C | 5 | 2 | 2 | 4 | 4 | 2 | 41 |

Reasoning
- A is one dialog (expiry select, one orange Copy link) plus a list dialog; it meets the 2-click path and matches the existing Dialog and form-stack styles.
- A's "Shared links (n)" header button crowds the toolbar that C04 already fills; B's All|Shared segmented control places it where people look, and merges with C04's Browse|Recent.
- B's per-row Shared chip adds noise and needs the share list loaded when Files opens.
- C adds a sixth nav item, against the plan to reduce tabs.

Pick: A. Graft: put "Shared links" as a third view in C04's view switcher (from B) instead of a header button; use B's inline two-step Revoke so no nested dialog is needed. Share goes in the ⋯ menu from C03, not a fourth row button.

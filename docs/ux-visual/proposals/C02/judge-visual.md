# C02 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | --- | --- | ---- | -------- |
| A      | 4    | 4    | 3    | 3   | 3   | 5    | 43       |
| B      | 5    | 3    | 5    | 4   | 5   | 3    | 52       |
| C      | 4    | 3    | 3    | 3   | 3   | 2    | 38       |

Reasoning

- B's skeleton rows use the table's own column template, so loading, error and ready occupy the same grid: the strongest answer to the 56 px shift and the dead band, and the same look on all five tabs.
- A covers only Files and Trash, leaves Agents, API keys and Usage hand-rolled, and loading is a text block rather than a skeleton.
- C removes the footer line "File contents encrypted / Paths and metadata visible", which is product honesty copy the brief says to keep, and shows stale rows under an error bar.

Pick: B. Graft: C's Dropbox wording for the zero-match state and the "Showing earlier results" label only if a refresh error ever keeps rows; keep the footer line. Define --danger once (also wanted by C03, C05); land B first because C03 and C04 edit the same file. One red left rule (A) is not needed: use the red icon and title only.

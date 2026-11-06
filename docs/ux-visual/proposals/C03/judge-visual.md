# C03 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 5 | 4 | 4 | 4 | 53 |
| B | 4 | 2 | 3 | 4 | 4 | 1 | 39 |
| C | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

Reasoning
- A and C are nearly the same design (Download plus a ⋯ menu, bottom-left toast with Undo, in-app revoke confirm). A is more specific on the receipt dialog hierarchy (one orange Save, Copy beside the key, Continue secondary).
- C adds a hover reveal rule it then rejects; A has no such inconsistency. Trash sits last under a divider in both, which keeps the destructive action away from Download.
- B's checkbox column, action bar and Versions drawer add three new patterns and depend on C04; the extra chrome conflicts with the dense, hairline list.

Pick: A. Graft: C's Dropbox-style Versions row text ("Current version · today 14:02 · 4.2 KB · author"), and C's red danger text for the Trash menu item. Use the shared --danger token, not a new one.

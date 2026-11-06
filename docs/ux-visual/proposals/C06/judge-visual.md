# C06 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 4 | 4 | 4 | 51 |
| B | 4 | 3 | 5 | 4 | 5 | 2 | 48 |
| C | 5 | 4 | 4 | 4 | 5 | 3 | 52 |

Reasoning
- All three fix the real bug (receipt save never posts key-backup). C and A both leave one orange button in a centred card; C makes "Or create a drive yourself" a text link, which is the cleaner hierarchy, and adds a "Step 1 of 3" line.
- B's inline checklist matches the landing How it works list best, but it removes the receipt dialog and is the biggest rewrite.
- A's min-height 60vh centring directly meets the 35% fill criterion.

Pick: C. Graft: A's data-derived step states, the min-height centring, and the green Key backed up banner using --ok. Keep Copy key behind a disclosure (C) rather than as a quiet row (A).

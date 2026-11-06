# C07 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | --- | --- | ---- | -------- |
| A      | 5    | 4    | 5    | 4   | 4   | 4    | 53       |
| B      | 5    | 3    | 3    | 5   | 4   | 3    | 48       |
| C      | 5    | 4    | 4    | 4   | 4   | 3    | 50       |

Reasoning

- A makes the decision heading the largest text, uses a spec-sheet label list (Drive, Access, Writes) and reuses the auth brand placement, with Approve near y 470. It is the smallest change that meets all criteria.
- B's sticky footer and radio cards add a scrolling region inside the card and a new control; the existing-drive form still needs nested scroll.
- C's account chip and bulleted grants match the familiar OAuth consent screen and the Deny/Approve pair is clear, but it needs a sub-view state.

Pick: A. Graft: C's sub-view for the existing-drive step to keep the card short, and a secondary Deny button beside Approve (the deny route exists) with the code line directly above the buttons.

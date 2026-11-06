# C05 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | --- | --- | ---- | -------- |
| A      | 5    | 4    | 5    | 4   | 4   | 3    | 52       |
| B      | 4    | 2    | 3    | 4   | 4   | 1    | 39       |
| C      | 4    | 3    | 3    | 3   | 4   | 3    | 41       |

Reasoning

- A pairs with C04/A and replaces three key signals with one chip (red or green dot plus a word), so state is not color-only. The unlock dialog puts the recovery file target first, with a reserved error line that avoids the 33 px shift.
- B depends on the C04/B switcher tile and Sheet pattern; drop-anywhere is nice but not required.
- C's lock button is both a state display and a toggle, and introduces "Locked/Unlocked" beside the product's "key" and "recovery file" terms.

Pick: A. Graft: B's drop target styling inside A's file target (dashed hairline box, "Drop your recovery file here"). Add --ok and --danger once in globals.css with the spec-brief note; they are the only non-orange colours in the system, so keep them for status only.

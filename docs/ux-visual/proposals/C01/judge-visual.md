# C01 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | --- | --- | ---- | -------- |
| A      | 5    | 5    | 5    | 4   | 4   | 5    | 56       |
| B      | 5    | 3    | 5    | 5   | 4   | 3    | 52       |
| C      | 4    | 2    | 4    | 4   | 4   | 2    | 42       |

Reasoning

- A gives the same one-row header as the reference page at 1440 and keeps one orange button visible at 390 beside a native details menu; it deletes two header CSS blocks, which is the largest consistency win.
- B's two-row phone header shows every item with no menu but spends about 44 px more height and requires moving routes; its auth shell (header and footer on sign-in/up) is the better answer to the floating auth card (A-4/A-6).
- C's hamburger sheet is the most code for the least gain and relies on an unverified Clerk footer.

Pick: A. Graft: render the shared SiteHeader above the Clerk card on /sign-in and /sign-up (B's idea, without moving routes), so the auth pages stop floating. Skip the second hero button from B: it dilutes the one orange Copy action.

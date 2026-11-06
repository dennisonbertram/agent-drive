# C04 judge: visual craft

Lens: hierarchy, rhythm, density, consistency with the spec-sheet system (`docs/design/spec-brief.md`: one orange primary per screen, orange only for primary and LED, hairline rules, mono labels, dense console that fits 1280x800). Scores are 1-5 per rubric criterion: Crit = meets acceptance criteria (x3), Simp = simplicity (x2), Cons = consistency (x2), Use = usability (x2), Vis = visual quality (x2), Risk = effort/risk, 5 = lowest (x1). Weighted total is out of 60.

| Option | Crit | Simp | Cons | Use | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | --- | --- | ---- | -------- |
| A      | 5    | 4    | 4    | 4   | 4   | 4    | 51       |
| B      | 4    | 1    | 2    | 4   | 3   | 1    | 33       |
| C      | 5    | 3    | 3    | 4   | 4   | 3    | 46       |

Reasoning

- A keeps the existing panel and table, adds breadcrumb, folder rows, sortable headers and type icons, and stays inside one scroller at 1440x900. It is the lowest-risk path to a Dropbox-like list.
- B puts three scrolling regions in a 1280x800 page and shrinks the list to about 560 px; that contradicts the dense-console rule and adds three new patterns.
- C has the cleanest header (one orange "+ New", drive as a dropdown in the breadcrumb), but a split button, FAB and rail reordering are new patterns that are not in the spec sheet.
- A's toolbar is crowded: breadcrumb, Browse|Recent, Filter, Connect an agent and New drive in one row.

Pick: A. Graft: C's drive dropdown at the root of the breadcrumb, so the drive strip disappears from every tab and New drive moves into that menu (relieves A's toolbar); C's 56 px two-line mobile row. Make the Browse|Recent control a general view switcher so C08's Shared links can be a third view.

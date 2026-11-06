# C04 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | ---- | --- | ---- | -------- |
| A      | 5    | 4    | 4    | 4    | 3   | 4    | 49       |
| B      | 4    | 2    | 3    | 4    | 5   | 1    | 41       |
| C      | 5    | 4    | 4    | 5    | 5   | 3    | 54       |

**Pick: C, with grafts from A.** The owner goal is a console that feels like Dropbox, and C copies the model people already know: Files / Recent / Trash as rail views, drive as a dropdown in the title (replaces the 74 px strip on every tab), breadcrumb, one primary "+ New", name-only rows with icons. Effort is M, same as A.

- A keeps the drive strip on Files and makes "Connect an agent" the lone orange button, honest but not familiar; Browse|Recent as a toggle is easy to overlook next to a rail that already has Trash.
- B (three panes, tree, details pane, new Sheet pattern, effort L) is too large and puts three scrollers in one screen (B, Risks); the details pane is a phase 2 idea.
- Risk in C: "+ New" with no Upload will read as an upload button. Make the menu's default item "Connect an agent" and label the first entry clearly; do not call it Upload.
- Graft from A: on phones use a 60 px two-line row where tapping the row downloads (via the unlock prompt) and keep a 44 px `...`; show "100+" and load more when `nextCursor` is set.
- Graft: no hover-only actions (focus-within and touch show them; keep `...` always visible). Avoid C's floating button over the last row; use a header button at 390.
- Pairing: C04-C pairs with C05-C. C02-B and C04 share the skeleton/empty variants.

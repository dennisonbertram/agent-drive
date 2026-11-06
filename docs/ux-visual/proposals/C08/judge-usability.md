# C08 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 4 | 4 | 4 | 51 |
| B | 5 | 3 | 4 | 4 | 4 | 3 | 48 |
| C | 4 | 3 | 3 | 4 | 4 | 2 | 42 |

**Pick: A, with grafts from B.** Two clicks from the file row (Share, Copy link), a simple dialog with a 7-day default, and a Shared links list. That is the fastest path to a job the console cannot do at all today. It reuses Dialog and the C05 unlock prompt.
- C adds a sixth nav item, which works against the plan to reduce tabs (C, Risks) and costs the most.
- B's Shared chip on rows is useful but needs every share loaded when Files opens, an extra request, and sets up two lists to keep in sync (B, Risks).
- Graft from B: show "Links for this file" (created, expires, status, Revoke) inside the Share dialog, so a sender can revoke where they created it. Reuse A's list for the all-files view.
- Graft: Share should be a visible row action next to Download on wide screens (Dropbox shows Share inline), not only inside the C03 overflow menu; this is the verb the owner expects.
- Limitation to state in the UI: old links cannot be re-copied (the server stores no key); say so once in the list help text.
- Trash consequence: A fetches shares lazily at Trash click, which can slow the toast; load the share count in the background so the toast stays under 100 ms.

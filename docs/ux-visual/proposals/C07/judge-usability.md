# C07 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 4 | 4 | 4 | 3 | 4 | 5 | 47 |
| B | 5 | 3 | 4 | 5 | 4 | 3 | 50 |
| C | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

**Pick: C, with grafts.** C uses the OAuth consent layout people know from GitHub and Google: app name as the heading, a bullet list of what it can do, "Confirm the code in your terminal" above the buttons, Deny and Approve. It is simpler than B and gives a Deny, which A lacks: someone who sees a code they did not start has no safe way out today.
- A is the safest edit but has no Deny and keeps the existing-drive branch inside the same long form.
- B has the best structure (visible drive choice, sticky footer so Approve is always in view), but a scrolling body inside a card is poor on phones with the keyboard open (B, Risks). Its heading "to Personal workspace" also repeats the term C10 removes.
- Graft from B: Approve and Deny in a footer that stays inside the viewport at 390 (sticky bottom, no inner scroll of the whole card).
- Graft from A: poll `device/<code>` every 5 s (stop after 10 min) so a later offer updates the card, 44 px checkbox rows, and the field-level error with scroll into view.
- Fix in C: the account chip says "Personal workspace"; show the account name or email, not "workspace".

# C06 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 5 | 4 | 4 | 53 |
| B | 4 | 3 | 3 | 4 | 4 | 2 | 42 |
| C | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

**Pick: A, with grafts from C.** Sign-up and setup is an owner goal, and A fixes the real bug first (the receipt never calls `key-backup`, so the banner lies; A, Root cause), then gives one clear path: Copy setup line, a drive named my-drive submittable with Enter, and a single "Download recovery file and continue".
- A keeps Copy key as a quiet secondary row for password-manager users; C hides it behind a disclosure, one more click for that group. A also keeps a visible secondary "Create a drive" button; C reduces it to a text link that a user who only wants a drive may miss.
- B removes the receipt modal for an inline checklist; the persistent backup row is a real safety gain, but it is an M-L rewrite with a new state machine and rewritten e2e tests (B, Effort).
- Graft from C: one sentence in the receipt, "Without it nobody, including us, can open this drive.", and the toast "Recovery file downloaded. Store it in a password manager." Add C's "Step 1 of 3" line.
- Graft from B: if the receipt is ever left unfinished, the steps list shows "Back up your key" as current until `key_backup_at` is set (A's data-derived steps already do this).
- Receipt ownership: C06 owns the receipt; C03's receipt items are dropped. Needs a real-browser check of F19.

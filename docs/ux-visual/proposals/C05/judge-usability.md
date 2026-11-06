# C05 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 4 | 4 | 4 | 51 |
| B | 4 | 2 | 3 | 4 | 4 | 1 | 39 |
| C | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

**Pick: C (pairs with C04-C), grafts from A.** A and C tie. Both make Download always enabled, open a file-first prompt, auto-run the pending download and add Remember on this device. I take C because it matches the C04-C header and uses Locked/Unlocked, words a first-time user understands better than "key loaded" (but see C10: keep "recovery file" for the file).
- B needs C04-B's switcher and Sheet; drop-anywhere is a nice extra but not a path (B, Risks).
- Graft from A: the reserved 20 px error line with plain copy ("That recovery file is not for this drive."), and a visible state word. In C, backup state is only a red dot and a menu item: add visible text "Not backed up" (colour alone is not enough) until the recovery file is saved; it must agree with C06's green "Key backed up".
- Risk: a toggle that both shows state and acts can be misread (C, Risks); the toast "Locked" mitigates. Idle auto-lock at 15 minutes can lose a user's place; keep the toast with a Download hint and skip it when remembered.
- Remember on this device: off by default with the profile-access sentence beside the checkbox (all three agree).

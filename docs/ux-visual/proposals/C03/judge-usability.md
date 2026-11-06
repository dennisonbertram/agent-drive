# C03 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
|---|---|---|---|---|---|---|---|
| A | 5 | 4 | 4 | 4 | 4 | 4 | 51 |
| B | 4 | 2 | 3 | 4 | 4 | 1 | 39 |
| C | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

**Pick: A, with grafts from C.** A and C are the same design (one primary, overflow menu, toast with Undo, named revoke confirm). A is more concrete about the failure cases that matter for error-proneness: optimistic Trash that rolls back, and Undo capturing the original drive id so it still works after a drive switch (A, Risks).
- B is disqualified in practice: it depends on C04 row selection, adds a drawer pattern and bulk-undo with partial failures (B, Risks), and makes single-file Trash a two-step select-then-act. Slower for the common case.
- Graft from C: never reveal actions on hover only (C, Risks); Download and the overflow button are always visible. Use Drive's "Restored 'name' - Show file location" wording and Dropbox's "Current version - today 14:02 - 4.2 KB - agent" labels in Versions.
- Graft from C: Trash is a danger-coloured item below a divider in the menu, not a visible row button (stops the mis-click that trashed two files, F04).
- Conflict: criterion 6 (receipt) overlaps C06. C06-A owns the receipt (one button, no checkbox); drop C03's receipt items.
- The overflow menu should be the shared one from C04 (`...`); keyboard arrows are required if native popover is used.

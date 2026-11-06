# C03 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Toast + overflow + confirm | 5 | 4 | 4 | 4 | 3 | 4 | 49 |
| B Selection + action bar + drawer | 3 | 2 | 3 | 4 | 4 | 1 | 36 |
| C Drive/Gmail convention | 5 | 4 | 5 | 4 | 4 | 4 | 53 |

- A and C are the same design; C is the cleaner statement and keeps both Download and the kebab visible (no hover-only). A has the better implementation notes: optimistic trash with rollback, Undo capturing the drive id in the closure, `ConfirmDialog` built on the existing `Dialog` (console.tsx:203).
- B depends on C04's selection model, adds bulk Undo with N API calls and partial failure, and introduces a drawer. It is L effort for a criterion set that A and C meet with M.
- Conflict to resolve: criterion 6 here (receipt dialog hierarchy) overlaps C06 criterion 3. C06's single "Download recovery file and continue" supersedes the checkbox flow that C03 A, B and C keep. Drop the receipt item from C03.
- The "share links stop working" text depends on the share list (C08). Both A and C mark it TBD. Show it only when the shares are known (C08-A loads them lazily when Trash is clicked).
- Test: toast appears synchronously, Undo restores on the original drive after a drive switch, rollback on API failure, and the kebab has keyboard open/close (native popover has no arrow-key handling, per A).

**Pick: C**, with A's implementation: optimistic trash + rollback, closure-captured drive id, `ConfirmDialog` reuse. Drop the receipt change (owned by C06).

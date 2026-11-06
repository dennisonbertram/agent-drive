# C06 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Fix backup call + reorder | 5 | 4 | 4 | 4 | 4 | 5 | 52 |
| B Inline checklist, no dialog | 4 | 3 | 3 | 4 | 4 | 2 | 42 |
| C Checklist + recovery kit | 5 | 4 | 4 | 4 | 4 | 4 | 51 |

- Root cause confirmed in code: the receipt's "Save recovery key" (console.tsx ~1330) saves the file but never POSTs `drives/{id}/key-backup`; only `downloadRecoveryFile()` (line 495) does. A and C both fix it with one shared helper. This is a real bug fix that closes F19 and walker F-024-01.
- B removes the non-closable receipt dialog. The drive key then exists only in `driveKeys` state, so a reload or a closed tab before step 4 loses the only copy and the drive can never be opened. The dialog is the guard against that today. B's own risk section admits the key is lost on tab close. Reject on data-loss grounds, and it needs the receipt e2e rewritten.
- A and C are nearly identical. A keeps a visible secondary "Create a drive" button; C makes it a text link, which is harder for a human who just wants a drive. A keeps Copy key visible; C hides it behind a disclosure, which is slightly better (plaintext key not on screen by default) but costs password-manager users a click.
- "Backed up" means the download started; neither can confirm the file was saved. Both say so. Keep the toast wording honest ("Recovery file downloaded").
- Test: update tests/e2e/console.spec.ts (lines ~127, 134, 436 use the removed checkbox and "Save recovery key"); add an assertion that the key-backup POST body is only `{ method: 'file' }` and never contains the key.

**Pick: A.** Grafts: C's `<details>` that hides the plaintext key textarea, and C's "Download again" in the chip menu (matches the C05 chip). Add `--ok` once, shared with C05.

# STORY-032 walk — Filter, paginate, and trash a stale file

Walked by the lead in the user's signed-in Chrome on https://agent-drive.vercel.app/console (2026-11-03). Status: **pass with findings**.

1. Typed `tests` in "Filter loaded files…" → two rows (`/tests/note.jsonl`, `/tests/sample.bin`); footer "9 loaded". Screenshot `step-1-filter-tests.jpg`: aligned rows, single drive selector, one primary action (+ New drive).
2. Typed `zzz-nothing` → table body empty, footer still "9 loaded", column widths shift. Finding F-032-001.
3. Filtered to `sample`, clicked Trash → native `window.confirm("Move /tests/sample.bin to trash?")` (answered OK from page script so the extension wasn't blocked); row disappeared with no notice. Finding F-032-002. Screenshot `step-3-after-trash.jpg`.

Pagination not exercised (9 files fit on one page).

## Flow Log

- Steps needed: 3 (filter, Trash, confirm) vs ideal 2 (no confirm for a reversible action).
- Hesitation: after trashing, no feedback confirms where the file went.

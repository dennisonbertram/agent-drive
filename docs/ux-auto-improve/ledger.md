# UX auto-improve ledger

Five rounds run with `/ux-auto-improve`, 6–7 Nov 2026. Goal: the console reads like a cloud drive
(Dropbox-style), and sign-up and first-run setup work well. Reviewer input came from the audits in
`docs/ux-paths`, `docs/ux-flow`, `docs/ux-walker` and `docs/ux-visual` (decisions C01–C15).
Narrated before/after videos were kept outside this public repo.

| Round | Section (decisions)                                                                          | PRs                     |
| ----- | -------------------------------------------------------------------------------------------- | ----------------------- |
| 1     | Console list states and first-run key backup (C02, C06)                                      | #74                     |
| 2     | Unlock on demand and the folder browser (C05, C04)                                           | #75, #76, #78           |
| 3     | Row actions, preview, Trash and sharing (C03, C08)                                           | #79, #81, #82, #83, #86 |
| 4     | /connect approval and the sign-up front door (C07, C01)                                      | #72, #73, #94           |
| 5     | Verification sweep: share page, plain billing units, audit log, large drives (C11, C12, C15) | #87, #88, #89, #90, #91 |

Related follow-ups in the same pass: homepage story (#84), agent-ready public site (#85),
plan-limit messages (#93), activity names (#92), and the passphrase vault that lets the
console open files after sign-in (#96, #97, #98).

## Status (8 Nov 2026)

- Merged to `main` (5a1dd42). All six required CI checks passed on each PR.
- Checked by hand on a local build of `main` with test data: folder browsing, passphrase
  setup, lock and unlock on demand, preview, download, and a share link downloaded from a
  signed-out browser (contents matched).
- Not yet verified on production: the vault needs migration 0021 and a deploy; Google
  sign-in needs its client secret saved in Clerk; GitHub sign-in needs a re-check in a
  clean browser profile.

## Deferred

- Per-folder permissions and sharing a folder with another agent's identity (user story S6.4).

# STORY-049 walk report (lane B)

Data: user e2e_walkerb, drive walkb-bot, throwaway file /reports/2026-11-04-draft.md (2 versions written by the agent). Result: PASS (goal in 2 clicks after the file was in Trash), with display findings.

0. Precondition: filtered "draft" in Files, clicked the row's "Trash": file moved at once with no confirmation, header notice "Moved /reports/2026-11-04-draft.md to Trash. Restore it from the Trash tab." (screenshots/pre-2-trash-dialog.png). After the move the filter shows "No loaded files match “draft”." with a "Load more files" button, which wrongly suggests more matches may exist.
1. Sidebar "Trash" (step-1-trash-tab.png): heading "Trash - Recover deleted files without losing their history.", table FILE PATH / DELETED / RECOVERY / MODIFIED / ACTIONS with buttons Restore and Versions. The DELETED cell is cut ("11/6/2026…", needs 192px, has 110px) and RECOVERY reads "Versions preser…" (168 vs 160), MODIFIED shows "—". Geometry audit: only intentional unequal widths.
2. Clicked "Restore" (step-2-restored.png): row disappears, "Nothing in the trash.", notice "Restored as a new version. Previous versions are preserved."; tile count went from 115 to 116 files.
3. Files tab, filter "draft", Load more (step-3-files-after-restore.png): the file is back, AUTHOR "Console" (not walkb-bot), size 99 B.
4. Variation: trashed it again and opened Trash > Versions (var-trash-versions.png): three versions, all with "Restore this version", none marked Current (the newest is the Console copy from step 2, same 99 B as the one below it, so the list shows two identical-looking rows). The dialog states "Restore creates a new current version. Existing history stays intact."
5. Edge (409 "The destination exists."): not reproducible because the CLI refused to write over a trashed path ("The file is in the trash: restore it with restore <path> or write with --overwrite"); the console Restore then simply succeeded (var-conflict.png). Not verified.
6. Mobile 390x844 (mobile-check.png, taken on the Trash tab): fits; the restore notice sits as a bottom bar and the dev tools badge overlaps its text in dev mode (dev-only artifact). The Trash tab still shows the "KEY REQUIRED FOR DOWNLOADS / Load drive key" controls though nothing here downloads.

## Flow log

- Ideal 2; actual 2 (Trash tab, Restore) plus 1 to confirm in Files. No hesitation.
- Trash has no confirm and no Undo link in the notice (the notice tells where to restore; fine because it is recoverable).
- Author and time appear in Files rows, Versions dialog and Usage by author with no link between them.

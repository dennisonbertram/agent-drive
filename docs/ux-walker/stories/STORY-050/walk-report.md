# STORY-050 walk report (lane B)
Data: user e2e_walkerb, drive walkb-bot, throwaway /notes/design.md with 3 versions written by the agent (67 B, 82 B, 97 B). Result: PASS for the rollback itself; findings on where the user lands afterwards and on choosing the right version.

1. Files, filter "design" (needed "Load more files" first, the path sorts after the first 100 rows), clicked "Versions" (step-1b-versions-dialog.png): dialog "Version history", path, text "Restore creates a new current version. Existing history stays intact.", three rows with date, size, author, version id; newest marked "· Current" with no button; the others have "Restore this version". Geometry audit: clean.
2. Compared versions: only date/size/author/id. All three of my writes happened within the same second, so the timestamps (to the second) do not separate them; size is the only hint. No preview/diff. Confirmed gap. No copy button next to the version id (checked: zero copy buttons in the dialog).
3. Clicked "Restore this version" on the middle (82 B) row: dialog closes, notice "Restored as a new version. Previous versions are preserved." (step-3-after-restore.png). The list reloads to the first 100 rows while the filter "design" stays, so the page now says "No loaded files match “design”." with "Load more files". The file the user just restored is out of view until Load more is clicked again.
4. After "Load more files" and reopening Versions (step-4-versions-after.png): new top row "· Current", author Console, 82 B, new id; old rows still present (4 rows).
5. Content check: loaded the drive key (credentials bundle) and downloaded /notes/design.md with download capture: saved file contains "design v2 " plus 30 y's, i.e. the restored middle version, not v3. Saved to scratchpad/dl-b/files/design.md.
6. Mobile 390x844 (mobile-check.png): dialog fills the width, buttons stack under each row; no overflow. Long histories not tested; the dialog has no loading text (not triggered: only 4 versions loaded instantly).

Environment note (not a product finding): one browser call hung for about 2 minutes while loading the key and the page fell back to about:blank; reopening /console and redoing the step worked. Cause not determined (machine load).

## Flow log
- Ideal 3; actual: filter (+1 Load more) + Versions + Restore = 4-5 actions, then another Load more + Versions to confirm (2 more).
- Hesitation: choosing which version to restore without any preview; user must load the key, download each candidate, and compare, or use the CLI.
- Same data (author/time/size) appears in Files row, Versions dialog and Usage by author.

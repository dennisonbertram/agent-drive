# STORY-033 walk — Recover an accidentally deleted file from the Trash tab

Lead walk in signed-in Chrome. Status: **pass**.

1. Opened Trash → `/tests/sample.bin`, "Deleted 11/3/2026, 8:28:45 PM", "Versions preserved", actions Restore / Versions (`step-1-trash-tab.jpg`).
2. Clicked Restore → no confirm; banner "Restored as a new version. Previous versions are preserved."; Trash empty state "Nothing in the trash." (`step-2-restored.jpg`).

## Flow Log

- 2 steps, matching the ideal. Duplicated controls: the drive selector and "Load drive key" repeat from the Files tab (already reported by /ux-flow).

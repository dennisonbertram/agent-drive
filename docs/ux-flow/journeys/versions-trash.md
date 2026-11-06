# Journey: versions-trash (restore a previous version; restore from Trash)

Stories: STORY-050 (roll back in the Versions dialog; ideal 3) and STORY-049 (restore from the Trash tab; ideal 2). Walked live at 1440x900 plus one 390x844 pass, as e2e_uxreview on drive research-bot. Screens: `versions-trash-screens/`. For the delete step I created my own file /work/ux-throwaway-vt.txt and trashed it (no seeded item deleted). Real changes made: /memory/project-notes.md restored to its older version (now 3 versions), /work/csv-export/old-draft.md restored from Trash, throwaway file left in Trash.

## Story
- STORY-050 ideal path: open history, pick the older version, confirm it became current (3).
- STORY-049 ideal path: open Trash, press Restore (2).

## Friction Scorecard (measured unless marked suspected)
| | STORY-050 | STORY-049 |
|---|---|---|
| Steps actual / ideal | 6 / 3: pick drive, type filter "project-notes", click Versions, click Restore this version, (re-open Versions to confirm) | 3 / 2: Trash in sidebar, Restore, (read the notice) |
| Decisions | 1 real (which version), but the dialog gives no way to decide (see below) | 0 |
| Re-entry | Filter text typed to find the row; stays after navigation (01, 02, 08) | none |
| Confirmations | 0 (acceptable: restore is non-destructive, history kept) | 0 |
| Dead ends | Restore notice is shown in the page header, not where the eyes are (04, 07); no "View file" onward action | same (07) |
| Hesitations | "Which version is the good one?" Rows show only time, size, author, UUID (03, 05). Download is disabled until the drive key is loaded (01). | Two rows, both look alike; DELETED and RECOVERY columns are truncated ("11/6/2026…", "Versions preser…", 06) |

## Take-away Pass (per screen)
- Files list (01): per-row "Download / Versions / Trash" are all low-emphasis links; Download is greyed (key not loaded) on every row. The Trash link sits next to Versions with no confirmation (08) and no undo button in the notice.
- Version history dialog (03, 09): UUID per row is noise for a human; it exists only for CLI use. "Restore creates a new current version..." is useful once. Newest row is marked "Current" and has no button, which is clear.
- Trash tab (06): RECOVERY column says "Versions preserved" on every row (carries no information, truncated). MODIFIED column is "—" on every row (dead column). "Deleted files / research-bot" repeats the page title "Trash" and the drive pill above.
- After restore (04, 07): notice "Restored as a new version. Previous versions are preserved." is accurate but does not name the file or say where it went.

## The Simpler Version
1. Files: type in the filter, hover the row.
2. Row menu has "Version history" (same as today) and the dialog shows a one-line content preview or "Download this version" next to each row (needs the key; if the key is not loaded show "Load key to preview").
3. Click "Restore this version"; the dialog stays open, the row becomes Current and a toast says "Restored 11:55 AM version of project-notes.md".
Trash: Restore sits on the row; toast names the file and has a "Show in Files" link; the row disappears.
Concrete changes:
- Put the restore notice in a toast near the action, name the file, add "Undo"/"Show file" (04, 07, 08).
- Replace the UUID with a copy-on-hover affordance or hide it; show "Restored from 11:55 AM" for restore-created versions (05, 09).
- Remove MODIFIED and RECOVERY columns from Trash; widen DELETED to show date and time (06).
- Trash needs no Versions button for most users; keep it behind the row's secondary action.

## Clarity Issues
- Author after restore becomes "Console", not the original agent (04, 09). A user looking for "what did research-bot write" loses the row. (STORY-049 notes the same.)
- Restore does not say what content came back. The two versions were 232 B and 136 B; the user must guess from size (03).
- "Previous versions are preserved" does not say a new version was added (history grew from 2 to 3 rows, 09).
- Functional notes (one line each): (a) when I opened Versions and then switched to the Trash tab, the dialog that appeared (05) showed no "Current" row and offered Restore on every version, unlike the same dialog opened from Files (09); suspected stale context, not reproduced reliably. (b) Session cookie expiry (1 h, test env) sent a restore click to the dead-end "Sign-in is not configured" page with no return path; test-environment artifact. (c) Under load (machine load average 230+) the Trash tab sat on "Loading files…" for minutes with no timeout or retry message (no screenshot kept; env-related).

## Cloud-drive comparison
Dropbox/Google Drive: right-click a file, "Version history", each version shows a preview/diff, "Restore" or "Make current" on the row, with a toast. Trash is a sidebar item listing deleted items with a single Restore (and "Delete forever"); restored files return to their original place with a "Show file" link. Here the flow is structurally the same and short, but the version dialog is metadata-only and the trash tab has no permanent-delete, no multi-select and no search beyond a path filter.

## Verdict: acceptable
Both restores work in 2-3 clicks and cost no confirmations. The gaps are information (what is in each version) and feedback (where the notice lands).

Three most valuable changes: (1) show content or a download per version so the user can pick the right one; (2) name the file and add "Show file" to the restore notice and show it near the action; (3) drop empty/duplicate Trash columns and show full deleted date and time.

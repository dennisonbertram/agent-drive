# Journey: find and open the latest weekly report (slug find-open-file)

Signed in as e2e_uxreview, live at http://localhost:3500, 1440x900. Screens: `find-open-file-screens/`.
Not done: the 390x844 mobile pass (browser and storage hung, see Caveats). Opening the file's contents was not observed.

## Story
STORY-038 (human finds a file in the console and checks what changed recently; also touches STORY-021 download).
Ideal path (3 steps): type "weekly" in a search over the whole drive, see the newest report first with its author and time, click it to open (preview or download).

## Friction Scorecard
| Measure | Actual | Ideal | Evidence |
|---|---|---|---|
| Steps to reach the file row | 3: open /console, click the research-bot drive card, type in the filter | 2 | 01, 02, 03 |
| Steps to read content | +5: Load drive key, choose recovery file, Load key, Download (not observed to finish) | 1 (preview) | 05-08 |
| Decisions | Which drive (console opens on nightly-builds, the alphabetically first, not the drive with 25 files); which of two weekly files is newest | 0-1 | 01, 03 |
| Re-entry | The filter text is cleared when switching tabs (Files to Trash and back) | none | observed after step 5 |
| Confirmations | 0 on Trash (see Functional note) | 0 with Undo | 04-accidental-trash |
| Dead ends | "What changed recently" has no answer anywhere in Files; sidebar has no Recents | | 02 |
| Hesitations | Both weekly rows show the same MODIFIED time (Nov 6, 11:55 AM), so "latest" is decided only by the 44 vs 45 in the name | | 03 |

Measured: the step counts, the nightly-builds default, the identical timestamps, the filter reset. Suspected: users will not know to look in Versions for history.

## Take-away Pass
- 01 Console on nightly-builds: the drive strip, the "Copy" button beside a truncated drive ID (`814fb1e0...`) and the red-dotted "Key backed up ... (file)" line are all unused by this journey. The banner is a status line that never changes the user's next action and its red dot reads as a warning even though it says "backed up".
- 02 research-bot file list: 25 rows are one flat alphabetical list of full paths with the path prefix greyed. The table scrolls inside a fixed-height box (the 9th row is clipped), so the page looks like it has everything but shows nine rows.
- 03 Filter: works, and "2 of 25" is clear. It matches path text only. The empty bordered space left under the rows when few rows match is dead area.
- 04-versions: useful, but it is the only place that shows who wrote which version and when. The Versions dialog says "Restore creates a new current version", which is clear.
- Header "Drives & files / A home for the work. A starting point for what's next." is decoration that no step uses.

## The Simpler Version
1. Open /console and land on the drive last used (or the one with the most files), not alphabetically first.
2. Type "weekly" in a search box labelled for the whole drive; results are sorted by modified time, newest first.
3. Click the row to open a preview. If the key is not loaded, the preview area offers "Load key" in place, then shows the file.
Changes: (a) remember the last drive, (b) clickable column headers with a default sort of MODIFIED descending, (c) a Recent section or a "Changed in the last 7 days" filter backed by the existing `recent` API, (d) inline preview for text files, (e) folders or at least a path breadcrumb, (f) undo toast instead of a silent Trash.

## Clarity Issues
- "Latest report" is unanswerable from the screen: same timestamp on both rows (03).
- AUTHOR shows "Console" for weekly-2026-45 after it was trashed and restored in this session (07-key-loaded). The original author, research-bot, is only visible in Versions (04-versions). A restore overwrites the "who wrote it" answer in the main list.
- The filter box says "Filter loaded files", which suggests that it might miss unloaded ones. With 25 files it does not matter, but the label invites doubt.
- Trash feedback "Moved /outputs/reports/weekly-2026-45.md to Trash. Restore it from the Trash tab." (04-accidental-trash) tells the user where to go, but gives no one-click Undo.

## Cloud-drive comparison
Dropbox and Google Drive offer: folder navigation with breadcrumbs; one search covering names and content; sort by name or modified; a Recent view; an activity panel showing who changed what; click to preview in place; Undo after delete. Today the console has the flat list and a client-side path filter only. Recents and search exist in the CLI/MCP (`recent`, `search`), not in the console (catalog "Cloud-drive expectations vs. today").

## Functional note
My click on a Trash button (I used a stale element ref and meant Versions) trashed the seeded /outputs/reports/weekly-2026-45.md at once, with no confirmation. I restored it from the Trash tab (06-restored). Side effects on seed data: the file now has a third version written by "Console" (same 192 B content), so its AUTHOR column reads Console rather than research-bot, and the drive shows 9.0 KB instead of 8.8 KB. The seed README should be refreshed, or the version re-seeded, before other critics rely on AUTHOR for that file.

## Caveats
- The 390x844 pass captured only an error state (09-mobile-error-state.png: "Failed to fetch" and "Workspace unavailable" with the message "Check the connection, then refresh to try again."), because the app's API calls were hanging at that moment. The error screen itself is clear and has a Refresh button, but no mobile file list was seen. Reason: the browser session and the local MinIO storage (127.0.0.1:19000 accepts the connection but never answers; other agents' curls also hang) stopped responding. I did not restart anything.

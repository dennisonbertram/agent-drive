# Topic: Trash, versions and restore

Source: code at main 2870d7a. Console: `apps/web/app/(app)/console/console.tsx`. CLI: `packages/agent-drive/src/cli.ts`, `check.ts`. Server: `apps/web/src/api/handler.ts`.

## STORY-048: Owner trashes a stale report from the console and sees the notice
**Type**: short
**Topic**: Trash, versions and restore
**Persona**: Mara Ellis, a solo founder, cleaning up after her agent "report-bot" wrote a wrong file.
**Goal**: Remove /reports/2026-11-04-draft.md from the drive's file list.
**Preconditions**: Signed in at /console, Files tab, a drive with the file listed.
**Ideal path**: 2 — find the row, press one remove action (undo offered afterward).
**Alternate paths**: CLI `agent-drive rm /reports/2026-11-04-draft.md` (needs the `delete` scope). MCP tool `delete`.
### Steps
1. Open /console, Files tab → table of full paths, one row per file, with Download, Versions, Trash buttons.
2. Type "2026-11-04" in "Filter loaded files" → only matching loaded rows remain.
3. Click "Trash" on the row → no confirmation dialog; row disappears; notice "Moved /reports/2026-11-04-draft.md to Trash. Restore it from the Trash tab."
4. Mara hesitates, wonders whether it is really gone, and clicks the "Trash" sidebar tab → the file is listed with a DELETED date and "Versions preserved".
### Variations
- She skips the filter and scrolls; if the file is beyond the first 100 rows she must press "Load more files" first.
- She tries the Download button first; it is disabled with tooltip "Load your drive key first" (no key loaded this session). Trash does not need the key.
### Edge Cases
- Trash is immediate with no confirm, unlike "Revoke access" which asks. A mis-click on the adjacent Versions/Trash buttons moves the file.
- The notice is the only undo hint; it vanishes on the next action. (gap) No "Undo" button in the notice itself.
- Another agent deleted the same path a moment earlier: the click returns "File not found." as an error.

## STORY-049: Owner restores a trashed file from the Trash tab
**Type**: short
**Topic**: Trash, versions and restore
**Persona**: Mara Ellis, the next morning, realises the "wrong" file was the right one.
**Goal**: Get /reports/2026-11-04-draft.md back.
**Preconditions**: The file is in the Trash (previous story).
**Ideal path**: 2 — open Trash, press Restore.
**Alternate paths**: CLI `agent-drive restore /reports/2026-11-04-draft.md --drive ID` (needs read and write scopes, not `delete`). Versions dialog per-version "Restore this version" (Trash tab Versions button).
### Steps
1. Click sidebar "Trash" → heading "Deleted files", rows with DELETED date, RECOVERY "Versions preserved", buttons Restore and Versions.
2. Click "Restore" on the row → API restore with no version, so the latest version is used; dialog-free; notice "Restored as a new version. Previous versions are preserved."
3. Click sidebar "Files" → the file is back in the flat list, MODIFIED now, AUTHOR "Console".
### Variations
- She first clicks "Versions" to check which content will return; sees all versions and "Restore this version" on each one that is not marked Current (a trashed file may show every version as restorable, depending on whether the list marks the last one as Current).
- She restores from a phone-width layout where the sidebar is behind a toggle.
### Edge Cases
- Restore creates a new version (a copy of the old object), so storage grows; the pricing page says versions and trash count toward storage.
- If an agent has meanwhile written a new file at the same path, the server says "The destination exists." (409) and the console shows that text.
- The restored file's AUTHOR becomes "Console", not the original agent. Same information (author) appears in Files rows, the Versions dialog and Usage by author.

## STORY-050: Owner rolls back to yesterday's version in the Versions dialog
**Type**: medium
**Topic**: Trash, versions and restore
**Persona**: Dev Patel, an engineer whose agent "notes-bot" overwrote /notes/design.md with a bad summary.
**Goal**: Make the previous content current again.
**Preconditions**: /notes/design.md has 3 versions; file is live; drive key may or may not be loaded.
**Ideal path**: 3 — open the history, pick the older version, confirm it became current.
**Alternate paths**: CLI `agent-drive versions /notes/design.md --drive ID` then `restore /notes/design.md --version ID`. MCP `versions` and `restore`.
### Steps
1. Files tab, filter "design", click "Versions" on the row → dialog "Version history" with the path, text "Restore creates a new current version. Existing history stays intact.", and one row per version: date, size, author, version ID, newest marked "· Current" without a button.
2. Dev compares dates and authors; the dialog shows no content preview and no diff, so he cannot tell which one is good (gap: no preview of version content in the dialog).
3. He downloads nothing (key not loaded). He guesses the middle version by time and sizes, clicks "Restore this version" → dialog closes; notice "Restored as a new version. Previous versions are preserved."
4. He reopens Versions → a new top row marked Current, authored "Console", same size as the chosen one.
### Variations
- He loads the drive key via "Load drive key", downloads the file to check, finds it is wrong, and repeats with the oldest version. History now has 5 entries.
- He pastes the version ID from the dialog into the CLI: `agent-drive get /notes/design.md --version ID --output /tmp/old.md` to read old content before restoring.
### Edge Cases
- Dialog lists versions via an "all pages" fetch; very long histories take a moment and there is no loading text inside the dialog.
- Version IDs are UUIDs shown in a `code` element; selecting for copy is manual (no copy button, unlike drive IDs).
- Restoring the same older version twice creates two new versions with identical content.

## STORY-051: Agent deletes a file and restores it from the CLI after the human objects
**Type**: medium
**Topic**: Trash, versions and restore
**Persona**: An agent "build-agent" working for Tomás Rivera; Tomás says "wait, I needed that log".
**Goal**: Delete /logs/run-0412.txt, then bring it back.
**Preconditions**: Key with read, write, delete scopes; single default drive resolves, so `--drive` is optional.
**Ideal path**: 2 — one `rm`, one `restore`.
**Alternate paths**: MCP `delete` then `restore`; console Trash tab restore.
### Steps
1. Agent runs `agent-drive rm /logs/run-0412.txt` → prints JSON with id, path, deleted_at.
2. Tomás objects. Agent runs `agent-drive ls --prefix /logs` → the file is no longer listed.
3. Agent runs `agent-drive restore /logs/run-0412.txt` → prints the new version JSON (HTTP 201 version); `ls` lists it again.
4. Agent runs `agent-drive get /logs/run-0412.txt` → prints the text.
### Variations
- The agent had only read+write scope: `rm` fails with a permission error naming the missing scope plus the hint "Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope."
- llms.txt rule: ask the human before deleting; the agent does so first in the polite version of this story.
### Edge Cases
- `rm` on a path already in the trash → "File not found."
- `ls` has no flag to list trash (gap): the CLI cannot list deleted files, so the agent must remember the path; only the console Trash tab (and the API `trash` listing) shows them. The MCP server also has no trash listing tool.
- Key limited with `--write-path /reports`: `rm /logs/run-0412.txt` is refused with "The API key may only write under /reports."

## STORY-052: Two agents race on one file and the loser hits a --if-version conflict
**Type**: long
**Topic**: Trash, versions and restore
**Persona**: Agents "planner" and "writer" sharing /plan/status.md for the human Ines Okafor.
**Goal**: Update the status file without clobbering the other's change.
**Preconditions**: Both keys have read+write on the same drive; the file exists at version V1.
**Ideal path**: 4 — read, write with condition, on conflict re-read and retry.
**Alternate paths**: MCP `put` with `ifVersionId`. `sync` and `backup` do their own handling.
### Steps
1. Planner runs `agent-drive get /plan/status.md` and `agent-drive versions /plan/status.md` → current version ID V1 is the newest entry.
2. Writer does the same, then edits and runs `agent-drive put ./status.md /plan/status.md --if-version V1` → succeeds, returns version V2.
3. Planner runs `agent-drive put ./status.md /plan/status.md --if-version V1` → exit 1; stderr "The file changed since the conditional write was prepared." plus "Current version: V2. Read the file again, merge your change, then retry with --if-version V2."
4. Planner runs `agent-drive get /plan/status.md`, merges, retries with `--if-version V2` → succeeds, V3.
5. Ines opens Versions in the console → three rows, authors planner and writer, newest marked Current.
### Variations
- A plain `put ./status.md /plan/status.md` with neither flag: the default is create-only, so it fails with "The file already exists." and the hint to read, merge and retry with --if-version.
- Planner uses `--overwrite` and silently replaces V2; V2 is still in Versions.
- Planner passes both flags: "--overwrite and --if-version are mutually exclusive."
### Edge Cases
- Conflict message is identical in meaning for "exists" and "changed" but uses different first lines; hint appears only when the server returns the current version ID.
- The conflict text appears on three surfaces: CLI stderr, MCP result `hint`, and API error body.
- A stale `--if-version` value that is not a UUID is rejected as a validation error before any upload.

## STORY-053: Conditional write hits a trashed file
**Type**: medium
**Topic**: Trash, versions and restore
**Persona**: Agent "sync-bot" for Priya Nair, after Priya trashed /data/config.json in the console.
**Goal**: Write a new config.json.
**Preconditions**: /data/config.json is in the trash; sync-bot has write scope.
**Ideal path**: 2 — be told the file is trashed, then restore or overwrite.
**Alternate paths**: console Trash tab Restore first.
### Steps
1. sync-bot runs `agent-drive put ./config.json /data/config.json` → exit 1; "The file is in the trash. Restore it, or write with overwrite." and "The file is in the trash: restore it with "restore <path>" or write with --overwrite."
2. It chooses `agent-drive put ./config.json /data/config.json --overwrite` → succeeds and the file is live again with a new version.
3. Priya checks Files tab → file is back, AUTHOR "sync-bot"; the Trash tab no longer lists it.
### Variations
- With `--if-version V1` instead: same trashed conflict, because a conditional write cannot revive a trashed file; `--overwrite` is the only write that does.
- Agent picks `restore` and then `put --if-version <new id>` to keep a clean history.
### Edge Cases
- Priya sees no signal in the console that an agent tried to write to a trashed path (gap); the audit log in Activity & deletion lists the denied or conflicting requests only as outcome/HTTP status.
- `--if-version` against a path with no file: "There is no file at this path." plus "write it without --if-version."

## STORY-054: Owner looks for a deleted file but cannot find it in a long Trash list
**Type**: medium
**Topic**: Trash, versions and restore
**Persona**: Hannah Cho, an operator who has 300 files in trash after an agent cleanup run.
**Goal**: Restore /exports/customer-list-2026-10.csv only.
**Preconditions**: Trash tab with more than 100 entries.
**Ideal path**: 3 — search the trash, restore one file, verify it.
**Alternate paths**: CLI cannot list trash; `agent-drive restore PATH` works if she knows the exact path.
### Steps
1. Click the sidebar "Trash" tab → first 100 deleted files, footer count "100 loaded".
2. Type "customer-list" in "Filter loaded files" → no matches; message "No loaded files match ...", because the file is on a page not yet loaded.
3. Hannah thinks the file is not there and gets worried; she clicks "Load more files" → next 100 rows loaded; filter now matches one row.
4. Click "Restore" → notice "Restored as a new version. Previous versions are preserved."
### Variations
- She types the filter text in lowercase for a path with capitals; the match is case-insensitive.
- She restores a whole batch one by one (gap): no multi-select or "Restore all".
### Edge Cases
- Filter works on loaded rows only, with no hint in the empty-result message that more pages exist.
- DELETED date is the only sort cue; no sort controls.
- Trash list is per selected drive; with several drives she must switch in the drives strip first.

## STORY-055: Read-only or path-limited agent tries to delete and restore
**Type**: medium
**Topic**: Trash, versions and restore
**Persona**: Agent "viewer-bot" (read only) and "inbox-bot" (writes under /inbox/x) for Luis Ferreira.
**Goal**: See which destructive actions each limited key may perform.
**Preconditions**: viewer-bot key scopes `read`; inbox-bot scopes read write delete, `--write-path /inbox/x`.
**Ideal path**: 2 — one attempt, one clear refusal each.
**Alternate paths**: none found.
### Steps
1. viewer-bot runs `agent-drive rm /inbox/x/a.json` → refused: permission denied naming the scope, plus the reconnect hint.
2. viewer-bot runs `agent-drive restore /inbox/x/a.json` → refused (restore needs read and write).
3. inbox-bot runs `agent-drive rm /inbox/x/2026-11-05.jsonl` → succeeds.
4. inbox-bot runs `agent-drive rm /reports/summary.md` → refused: "The API key may only write under /inbox/x." even though deletion is not a write in the user's mind.
5. inbox-bot runs `agent-drive versions /reports/summary.md` → succeeds; read is not limited by write paths.
### Variations
- Luis sees the trashed inbox file in the console Trash tab with DELETED date and restores it.
### Edge Cases
- The write-path error does not mention restore or delete by name; the message is the same for put, mv, rm, restore.
- `mv` checks both source and destination against write paths.

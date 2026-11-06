# Topic: Console as a cloud drive

Source: `apps/web/app/(app)/console/console.tsx` at main 2870d7a (read from code, not run).

## STORY-017: Find yesterday's trace file in a long flat list
**Type**: medium
**Topic**: console-drive
**Persona**: Priya, a founder whose agent "trace-bot" writes daily logs such as /inbox/trace-bot/2026-11-05.jsonl. She opens the console on her laptop to check one.
**Goal**: Locate /inbox/trace-bot/2026-11-05.jsonl and see who wrote it and when.
**Preconditions**: Signed in; drive "research" has 340 files; no filter active.
**Ideal path**: 3 — open Files, type part of the name, read the row.
**Alternate paths**: CLI `agent-drive ls --prefix /inbox/trace-bot` or `search --query`; MCP `list` and `search` (server-side, cover all files). No console equivalent beyond the filter.
### Steps
1. Open `/console` → "Opening your workspace…" panel, then the Files tab with the drive strip and an "All files / research" panel.
2. Scan the table (FILE PATH, SIZE, AUTHOR, MODIFIED) → shows 100 rows, footer "100 loaded", button "Load more files". The file is not visible.
3. Type "2026-11-05" in "Filter loaded files…" → rows are cut to those whose path contains the text; footer reads "0 of 100" and "No loaded files match “2026-11-05”." (it is on page 2).
4. Hesitate: clear the filter, click "Load more files" → 100 more rows append; footer "200 loaded".
5. Type "2026-11-05" again → footer "1 of 200"; the row shows dim /inbox/trace-bot/ and bold 2026-11-05.jsonl, AUTHOR "trace-bot", MODIFIED "Nov 5, 11:42 PM".
### Variations
- Filter typed before load more: user concludes the file does not exist (gap: the filter never says it only covers loaded rows beyond its placeholder).
- Pressing Refresh resets to the first 100 rows and the user must load more again.
### Edge Cases
- A 3,000-file drive needs 30 "Load more files" clicks before the filter is trustworthy.
- Filter has no sort, so "newest first" order depends on the server list order (not visible as a choice).
- (gap) No server-side search in the console even though `search` exists for agents.

## STORY-018: Switch between drives and notice the filter and key reset
**Type**: short
**Topic**: console-drive
**Persona**: Marcus, who runs two agents on drives "research" and "client-acme".
**Goal**: Look at client-acme's files after working in research.
**Preconditions**: Two drives; research has its key loaded; filter text "jsonl" typed.
**Ideal path**: 1 — one click on the drive.
**Alternate paths**: none found (no drive picker elsewhere; selection is client state, not in the URL).
### Steps
1. Click the "client-acme" button in the Drives strip (shows name plus "2.4 MB · 18 files") → the selected button gets aria-pressed and a lit LED; filter clears; any notice clears.
2. Table reloads → "Loading files…" then the 18 rows.
3. Check the badge → "Key required for downloads" and a "Load drive key" button (keys are per drive).
4. Click back to "research" → key is still loaded (held in memory by drive id), badge "Key loaded".
### Variations
- Click the "+ your next agent" tile expecting to add an agent → it opens "Create a drive" (label and action do not match).
- Reload the page → both keys are forgotten and the selected drive resets to the first one; the user returns to the wrong drive.
### Edge Cases
- Drive count and size in the strip come from usage; if usage is missing the meta line is absent.
- On a phone the strip scrolls so the selected bay stays centered.
- (gap) Drive choice and tab are not in the URL, so a link or browser back cannot return to "client-acme / Files".

## STORY-019: Open a folder like in Dropbox (gap)
**Type**: short
**Topic**: console-drive
**Persona**: Hana, new to Agent Drive, used to Dropbox. Her agent wrote /reports/q3/summary.md and /reports/q4/summary.md.
**Goal**: Click "reports", then "q3", and see only the files in it.
**Preconditions**: Drive has files under /reports/q3, /reports/q4 and /inbox.
**Ideal path**: 2 — click a folder, click a subfolder.
**Alternate paths**: filter box with "/reports/q3/" (substring on loaded rows only); CLI `ls --prefix /reports/q3`; MCP `list` with a prefix.
### Steps
1. Open Files → one flat table where each row shows the full path: dim "/reports/q3/" then bold "summary.md". No folder rows, no tree, no breadcrumb below the topbar.
2. Click the dim directory text "/reports/q3/" expecting to enter it → nothing happens (it is a plain span; the row's `title` shows the full path on hover).
3. Look at the topbar "Workspace / Files" → the crumb names the tab, not a folder (gap).
4. Type "/reports/q3/" in the filter → works as a substring match; only q3 rows remain, footer "2 of 100". This is the only folder-like action.
### Variations
- Double-click a row → nothing happens.
- Right-click → browser default menu only.
### Edge Cases
- Paths that sort far apart (/reports/q3/ on page 3) are missed until "Load more files" is used.
- Typing without a leading slash also matches "/old/reports/q3x/…" (substring, not prefix).

## STORY-020: Upload a file from the browser (gap)
**Type**: short
**Topic**: console-drive
**Persona**: Tomás, who has a PDF contract he wants his agent to read; he expects to drag it onto the drive.
**Goal**: Put contract.pdf into the drive from the console.
**Preconditions**: Signed in; drive "client-acme" exists and is empty.
**Ideal path**: 2 — drag the file onto the page, confirm.
**Alternate paths**: `agent-drive put ./contract.pdf /clients/acme/contract.pdf --drive ID`; MCP `put`; `agent-drive sync LOCAL_DIR`. The agent or CLI is the only writer.
### Steps
1. Open Files on the empty drive → heading "Ready for your first file." and text "Connect an agent with the CLI or MCP to upload encrypted files." (the empty state itself says uploads are not done here).
2. Look for an Upload or "+ New" control → the only buttons are "Refresh" and "+ New drive" (gap: "+ New drive" sits where Dropbox puts "Upload").
3. Drag the PDF onto the table → the browser opens or downloads the PDF locally; nothing is stored (no drop handler).
4. Click "Connect an agent" → switches to the API keys tab (it does not explain put).
5. Give up and ask the agent: copy the instruction from the Agents tab "Connect an agent" panel.
### Variations
- User with files already in the drive sees no empty-state hint, so no on-screen text says "uploads are CLI only" (gap).
### Edge Cases
- Console writes only exist as `__console__` for Trash, Restore; no code path puts bytes from the browser.
- A 5 GiB upload limit and client-side encryption would both need new browser code.

## STORY-021: Preview a file before downloading (gap)
**Type**: short
**Topic**: console-drive
**Persona**: Aisha, checking whether notes.md in /memory/agent-notes/ is the right version before sending it on.
**Goal**: Read the first lines in the console.
**Preconditions**: Key loaded; file present.
**Ideal path**: 1 — click the file name to open a preview.
**Alternate paths**: CLI `agent-drive get /memory/agent-notes/notes.md` (prints text; binary needs `--output`); MCP `get`; or Download then open locally.
### Steps
1. Click the file name text → nothing happens (not a link; no detail page, no side panel).
2. Click "Versions" → dialog lists version ID, size, time and author per version, but never content (gap).
3. Click "Download" → "File decrypted in your browser. Download started." and the browser saves `notes.md` to Downloads.
4. Open it in an editor to read it.
### Variations
- Image or PDF files: same, no thumbnail (gap).
- The user judges by size and MODIFIED only; SIZE is the encrypted size, so it is slightly larger than the real file (header tooltip "Encrypted size").
### Edge Cases
- Each Download repeats a presigned fetch and counts as egress.
- Two versions with similar sizes can look identical in Versions.

## STORY-022: See what changed recently (gap)
**Type**: medium
**Topic**: console-drive
**Persona**: Jonas, who left two agents running overnight and wants a "Recent" view like Google Drive.
**Goal**: See which files were added or changed since yesterday.
**Preconditions**: Drive with 150 files written by two agents.
**Ideal path**: 1 — open a Recent view.
**Alternate paths**: CLI `agent-drive recent --since ... [--wait]`; MCP `recent`; `ls --agent NAME`; Activity & deletion page (audit log of actions, not file lists).
### Steps
1. Open Files → no "Recent", "Starred" or sort control; the column header MODIFIED is plain text, not clickable.
2. Click "MODIFIED" → nothing happens.
3. Scan the MODIFIED column by eye across 100 rows → order is the server's list order; the user cannot tell if it is newest first.
4. Open sidebar "Activity & deletion" → audit log shows actions (time, action, actor, outcome) but not a file list; he must match paths himself.
5. Switch to the Usage tab → "Usage by author" shows counts per agent, not files.
### Variations
- Type an agent name in the filter → matches only paths, not the AUTHOR column (gap), so "trace-bot" finds files only if the path contains it.
### Edge Cases
- The same author and time information appears in the Files table, Versions dialog, Usage by author, and the audit log, with no link between them.

## STORY-023: Recover from a failed file list
**Type**: medium
**Topic**: console-drive
**Persona**: Elena on hotel Wi-Fi, opening the console while the connection drops.
**Goal**: Get the file list to load.
**Preconditions**: Signed in; network flaky.
**Ideal path**: 2 — see the error, click retry.
**Alternate paths**: "Refresh" button in the page heading; full browser reload.
### Steps
1. Open `/console` with the network down → "Opening your workspace…" then "Workspace unavailable" with "Check the connection, then refresh to try again." (no retry button here, the heading Refresh button is also present but the page remains in the not-ready state until a success).
2. Reconnect and click "Refresh" → drives load; file list requests start.
3. A list request fails → "Could not load files." with the server message and a "Retry" button, while the table area stays empty.
4. Click "Retry" → "Loading files…" then rows.
### Variations
- Session expired while the page was open → error text "Your session expired. Sign in again." in a banner; no automatic redirect.
- Click "Load more files" and it fails → banner error above the panel (the existing rows stay); there is no Retry button on that path.
### Edge Cases
- The Files nav item shows a count only after the list is loaded.
- While loading, the key banner is a hidden reserve block so the layout does not jump.
- Switching tab during a load discards the stale response (scope key).

## STORY-024: Brand-new user with an empty drive
**Type**: long
**Topic**: console-drive
**Persona**: Wei, just signed up, no agent yet.
**Goal**: Get from an empty console to seeing a first file.
**Preconditions**: New account, no drives.
**Ideal path**: 5 — create drive, save key, paste instruction to agent, agent puts file, see it.
**Alternate paths**: agent-first setup with `/llms.txt` and `/connect` (drive created by the device flow); API keys tab "Create API key".
### Steps
1. Open `/console` → "Give your first agent a home." with "Create your first drive ↗" and three steps "01 Create a drive 02 Save your key 03 Connect an agent".
2. Click it → "Create a drive" dialog; enter "Research workspace" → "Create drive".
3. Receipt "Your drive. Your key." appears; click "Save recovery key" (downloads agent-drive-<id>.key.json) → tick "I saved my drive key securely" → "Continue to drive".
4. Land on the Files tab: red banner "This drive's key hasn't been backed up...", badge "Key loaded", "Ready for your first file." with a "Connect an agent" button.
5. Click "Connect an agent" → API keys tab, notice guard "Create an agent first." (Wei has no agent) and a disabled "+ New API key".
6. Hesitate, go to Agents → "+ New agent" → create "trace-bot" → lands on API keys with notice "Agent created. Create an API key to connect it." → "+ New API key" and so on.
7. After an agent puts a file, return to Files and press "Refresh" → the row appears.
### Variations
- Wei saved the file in step 3 but the banner is still red in step 4 (saving at the receipt does not record a backup; only "Download recovery file" on the Files tab does) — the same file must be saved twice.
- Wei closes the receipt dialog with Escape → blocked; receipt dialogs cannot be closed until acknowledged.
### Edge Cases
- The list does not poll; new agent files appear only after Refresh or reload.
- Free plan allows 3 drives; the "+ New drive" button is still enabled and errors on submit.
- The sidebar count appears only on the Files item.

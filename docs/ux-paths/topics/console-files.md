# Topic 6: Console file management: browse, unlock, download, trash, restore, versions

Source: `apps/web/app/(app)/console/console.tsx` (Files and Trash tabs, "Load drive key" dialog, "Version history" dialog). Surface facts: the console has NO upload, rename, move, copy, share, or permanent-delete controls; Download works only for the current version; the drive key lives in page memory only (lost on reload, tab switch does not lose it). The same "restore" capability exists in the CLI (`agent-drive restore PATH --drive ID [--version ID]`) and MCP `restore`.

## STORY-001: Browse file names while the drive is still locked

**Type**: short
**Topic**: Console file management
**Persona**: Priya Raman, a founder who just signed in on her phone-sized laptop window and wants to see whether her research agent saved anything overnight.
**Goal**: See the list of files and who wrote them without entering a key.
**Preconditions**: Signed in; drive "Research workspace" exists with 3 files written by agent "Research assistant" via CLI; no key loaded in this browser session.
**Ideal path**: 2 — open /console, read the list (Files is the default tab).
**Alternate paths**: CLI `agent-drive ls --drive ID` (needs API key, not the drive key); CLI `agent-drive recent --drive ID`; Usage tab shows counts (`liveFiles` · `versions`) but not names.

### Steps

1. Open https://agent-drive.vercel.app/console → "Opening your workspace…" then Files tab, heading "Drives & files", eyebrow "YOUR AGENTS' SHARED MEMORY".
2. Read the info banner "You can browse file names without a key. Load your drive key to decrypt and download contents. Keys are kept only in this page's memory." → Reassurance that no key is needed to look.
3. Read the table under "All files / Research workspace" (columns FILE PATH, ENCRYPTED SIZE, AUTHOR) → rows like `/memory/handoff.md`, "4.2 KB", "Research assistant", with created date as sub-text.
4. Read the footer "3 loaded — File contents encrypted · Paths and metadata visible to the service" → Confirms the plaintext-metadata trade-off.

### Variations

- Drive selector ("Selected drive") with several drives: she switches and the filter clears.
- Badge says "Key required for downloads" (amber/neutral) even though browsing works; same information is repeated in the banner and in the disabled Download button tooltip "Load your drive key first".

### Edge Cases

- Empty drive: "Ready for your first file." with "Connect an agent with the CLI or MCP to upload encrypted files." and a "Connect an agent" button that jumps to the API keys tab (the only path to the Files-empty next step; no upload button exists).
- Author column falls back to the raw agent id if the agent is not in the loaded list (e.g. revoked/other).

## STORY-002: Unlock with a pasted drive key and download one file

**Type**: medium
**Topic**: Console file management
**Persona**: Marcus Webb, a PM who got a drive key from his engineer in a password manager and wants the `/outputs/q3-report.csv` an agent produced.
**Goal**: Get the decrypted file onto his laptop.
**Preconditions**: Signed in; drive has `/outputs/q3-report.csv`; Marcus has the 43-character drive key text.
**Ideal path**: 4 — paste key once, click Download.
**Alternate paths**: Recovery-file route (STORY-003); CLI `agent-drive get /outputs/q3-report.csv --drive ID --output q3.csv`; sharing a link (`agent-drive share`, see share-links.md) which needs no key for the recipient.

### Steps

1. On Files, click Download on the `/outputs/q3-report.csv` row → Button is disabled; hover title "Load your drive key first".
2. Click "Load drive key" in the drive toolbar → Dialog "Load drive key" opens: "For Research workspace. Your key stays in this page's memory and is cleared when you reload."
3. Paste the key into the password field "Drive key" (masked, so he cannot see typos) → Field filled.
4. Click "Load key" → Dialog closes; notice "Key loaded into page memory. A download will verify that it matches this drive."; badge changes to "Key loaded"; button "Load drive key" becomes "Forget key".
5. Click Download on the row → Browser saves `q3-report.csv`; notice "File decrypted in your browser. Download started."
6. Open the file locally → Content intact.

### Variations

- Key pasted with leading/trailing spaces is trimmed (`keyInput.trim()`).
- Large file: no progress indicator; buttons just disable (`busy`) while the whole ciphertext is fetched into memory.

### Edge Cases

- Hesitation: the notice says verification happens at download, so "Key loaded" does not mean the key is correct (see STORY-004).
- Filename is the last path segment only; two files in different folders with the same name download with identical names.
- Notice from step 4 vanishes on the next action (`act` clears notice).

## STORY-003: Unlock using the recovery key file saved at drive creation

**Type**: medium
**Topic**: Console file management
**Persona**: Dana Okafor, who saved `agent-drive-<id>.key.json` to her Downloads folder weeks ago and now returns after a browser restart.
**Goal**: Unlock the drive without hand-copying the key.
**Preconditions**: Recovery file from "Save recovery key" (format `agent-drive-key-v1`, fields `driveId`, `key`); signed in; page freshly loaded (key forgotten).
**Ideal path**: 3 — choose file, load key, download.
**Alternate paths**: Paste raw key (STORY-002); CLI uses `AGENT_DRIVE_KEY` / `AGENT_DRIVE_KEY_<DRIVE_ID>` env vars or `--key-file`-style config instead.

### Steps

1. Open /console, confirm badge "Key required for downloads" → Locked state after reload.
2. Click "Load drive key" → Dialog opens.
3. Under "Or choose a recovery file" click the file chooser and pick the downloaded JSON → The key text populates the (masked) "Drive key" field; no confirmation text that the file was accepted other than the dots.
4. Click "Load key" → Dialog closes, notice "Key loaded into page memory…", badge "Key loaded".
5. Click Download on a row → File downloads and notice appears.

### Variations

- Picks the wrong drive's recovery file while "Research workspace" is selected → red banner "This recovery file does not belong to the selected drive."
- Picks a non-JSON file → "Choose a JSON recovery key file downloaded from this console."
- Picks a file over 16 KB → "This is not a valid drive key file."

### Edge Cases

- Dana switches the drive selector to a different drive after loading: the key is stored per drive id, so the new drive shows "Key required for downloads" again.
- If she cannot find the file she has no recovery path in the UI: the dialog and receipt text say losing the key means losing access to contents.

## STORY-004: Wrong or mismatched key is discovered only at download time

**Type**: medium
**Topic**: Console file management
**Persona**: Jin Park, who pasted the key of his old drive into the new drive's dialog by mistake.
**Goal**: Download `/work/t-481/notes.md`.
**Preconditions**: Two drives, "Staging" and "Production"; Jin is on Production but holds Staging's key.
**Ideal path**: 3 — a well-designed UI would reject a mismatched key on "Load key" instead of at download.
**Alternate paths**: Forget key then reload with correct key; CLI `get` gives the same decrypt error text.

### Steps

1. Select "Production" in "Selected drive"; click "Load drive key"; paste Staging key; click "Load key" → Accepted (any well-formed 32-byte base64url key passes `decodeDriveKey`); badge "Key loaded" appears and the notice warns "A download will verify that it matches this drive."
2. Click Download on `/work/t-481/notes.md` → Busy state, then red banner (role alert) with decryption failure text, e.g. "Unable to decrypt: the drive key is wrong, or the file is damaged or incomplete."
3. Click "Forget key" → Notice "Drive key removed from this browser session."; badge back to "Key required for downloads".
4. Click "Load drive key" and enter the correct key → Accepted.
5. Click Download again → Success notice.

### Variations

- Malformed key (too short): dialog banner "Invalid drive key. Expected a base64url-encoded 32-byte key."
- Empty field: native `required` validation.

### Edge Cases

- Instead of Forget key he could just load the right key (overwrites); two controls for the same recovery, but "Load drive key" is hidden while a key is loaded (only "Forget key" shows), so he must Forget first. Real friction.
- Banner shows on the page, not near the clicked row; with 100 rows the user may not see it.
- Damaged-file and wrong-key are indistinguishable (same message).

## STORY-005: Filter, paginate, and trash a stale file

**Type**: medium
**Topic**: Console file management
**Persona**: Elena Rossi, an engineer cleaning up a drive with 240 files where an agent wrote debug output to `/work/tmp-*`.
**Goal**: Move a specific scratch file to Trash.
**Preconditions**: Drive with 240 files; Elena is signed in. Key not needed.
**Ideal path**: 3 — filter, Trash, confirm.
**Alternate paths**: CLI `agent-drive rm /work/tmp-old.log --drive ID` (needs `delete` scope); MCP `delete`; bulk delete does not exist anywhere.

### Steps

1. On Files, see "100 loaded" in the footer and a "Load more files" button → Only the first page (limit 100) is loaded.
2. Type "tmp-old" in "Filter loaded files…" → Table narrows client-side; she sees no match because the file is on page 2.
3. Click "Load more files" → Next page appended ("200 loaded"); the filter is still applied.
4. Click "Load more files" again → "240 loaded"; button disappears when no cursor remains; `/work/tmp-old.log` now shows.
5. Click "Trash" on that row → Browser confirm dialog "Move /work/tmp-old.log to trash?"
6. Accept → List refreshes (back to first page, 100 loaded or fewer, filter still typed); no success notice is shown.

### Variations

- Cancel in the confirm: nothing happens.
- Filter text is cleared when switching drive or tab (explicit `setFilter('')`).

### Edge Cases

- Filter only searches already-loaded rows (placeholder says "loaded"); no server search in the console, whereas CLI `search` is server-side.
- After trashing, refresh resets pagination so Elena loses her place and must Load more again.
- Trashing is silent: no toast; the only confirmation is the row disappearing. The Trash tab text says "Deleted files appear here until permanently removed", but no permanent removal exists in the UI.
- Agent key without `delete` scope cannot do this from CLI; the console always can.

## STORY-006: Recover an accidentally deleted file from the Trash tab

**Type**: medium
**Topic**: Console file management
**Persona**: Tomas Beltran, who trashed `/memory/handoff.md` yesterday and now needs it back before an agent session.
**Goal**: Get the file back under its original path.
**Preconditions**: `/memory/handoff.md` was trashed (console or `rm`); signed in.
**Ideal path**: 2 — Trash tab, Restore.
**Alternate paths**: CLI `agent-drive restore /memory/handoff.md --drive ID [--version ID]`; MCP `restore`; Versions button in Trash opens the same "Version history" dialog for choosing an older version.

### Steps

1. Click "Trash" in the sidebar → Heading "Trash"; subtitle "Recover deleted files without losing their history."; table "Deleted files / Research workspace" with columns FILE PATH, DELETED, RECOVERY.
2. Locate the row (RECOVERY says "Versions preserved") → Deleted date/time shown.
3. Click "Restore" → Notice "Restored as a new version. Previous versions are preserved."
4. Click "Files" in the sidebar → File is back with a newer timestamp; the former current content is now one version older in history.

### Variations

- Drive selector is also on Trash tab; the "no key" banner is hidden on Trash.
- Trash empty: "Nothing in the trash." with "Deleted files appear here until permanently removed."

### Edge Cases

- If an agent already re-created a new file at the same path since deletion, the restore may conflict (API behaviour not surfaced distinctly; error shows in banner as returned by API).
- The notice appears on the Trash tab where the row vanishes; nothing links to the restored file.
- Hesitation: "Restore" restores the latest version only; a user wanting an earlier one must use "Versions" on the trash row, which is unlabelled about this.

## STORY-007: Roll back to an earlier version after an agent overwrote a file

**Type**: long
**Topic**: Console file management
**Persona**: Hannah Cho, an ops lead. Agent "Research assistant" ran `put --overwrite` on `/memory/handoff.md` and replaced a good handoff with a truncated one. She will inspect versions, restore, verify by downloading, and later check that history is intact.
**Goal**: Make the previous good content current again and confirm it.
**Preconditions**: File has 3 versions (v1 good 4.2 KB, v2 good 4.5 KB, v3 truncated 0.3 KB); Hannah has the drive key in her password manager.
**Ideal path**: 4 — Versions, Restore this version, (optionally) Download.
**Alternate paths**: CLI `agent-drive versions /memory/handoff.md --drive ID` then `agent-drive restore /memory/handoff.md --drive ID --version VERSION_ID`; CLI `agent-drive get --version ID --output FILE` to inspect an old version first (the console cannot download non-current versions); MCP `versions` + `restore`.

### Steps

1. Open /console on Files; spot `/memory/handoff.md` at "300 B" in ENCRYPTED SIZE, smaller than expected → Suspicion confirmed by size alone.
2. Click "Versions" on the row → Dialog "Version history": path `/memory/handoff.md`, text "Restore creates a new current version. Existing history stays intact."
3. Read the three rows: local date/time, size · agent name, version id in `<code>` → Newest listed first or in API order; no "current" marker is shown in the dialog (flag).
4. Hesitate: which of v1/v2 is the good one? Dialog has no preview or download → She notes sizes (4.5 KB vs 4.2 KB) and times.
5. Click "Load drive key" in the toolbar to prepare verification → Behind the open dialog? The dialog is modal, so she must first close it with the "Close dialog" icon button.
6. Close the dialog; click "Load drive key"; paste key; "Load key" → Key loaded.
7. Reopen "Versions" and click "Restore this version" on the 4.5 KB row → Dialog closes, list refreshes, notice "Restored as a new version. Previous versions are preserved."
8. Row now shows "4.5 KB" with new timestamp; click Download → Notice "File decrypted in your browser. Download started."
9. Open the file; content is the good handoff → Success.
10. Click "Versions" again → Now 4 versions: the restored copy is a new top entry, the truncated v3 is still in history.
11. Tell the engineer: next time use `put --if-version` to avoid blind overwrites (CLI knowledge, not shown in console).

### Variations

- Pick the 4.2 KB v1 instead.
- Do the same from CLI in a terminal (4 commands) without any key because `restore` is server-side metadata.

### Edge Cases

- Each restore adds a version that counts toward storage (Usage tab "stored versions").
- Clicking restore on the version that is already current creates a redundant duplicate version.
- "Versions" button is disabled while any action is `busy`.
- Version agent shows raw agent id if the agent is not in the list.
- The same restore capability appears in 4 places (Trash Restore, Versions dialog from Files, Versions dialog from Trash, CLI/MCP) with slightly different semantics (latest vs. chosen).

## STORY-008: Key forgotten on reload mid-task and the full session lifecycle

**Type**: long
**Topic**: Console file management
**Persona**: Sofia Marin, a compliance analyst who reviews three drives' outputs each Friday, switching drives and refreshing the page.
**Goal**: Download one file from each of two drives and understand when keys are kept or lost.
**Preconditions**: Drives "Legal", "Finance", "Ops", all with files; Sofia has recovery JSON files for Legal and Finance only.
**Ideal path**: 8 — per-drive unlock + download for two drives, no re-entry.
**Alternate paths**: CLI with `AGENT_DRIVE_KEY_<DRIVE_ID>` env vars loads keys for all drives non-interactively; share link for single files (see share-links.md).

### Steps

1. Open /console; Files tab shows first drive in "Selected drive" (Legal) → Badge "Key required for downloads".
2. Click "Load drive key" → Dialog.
3. Choose Legal recovery JSON; click "Load key" → "Key loaded".
4. Download `/outputs/contract-summary.md` → Notice shown.
5. Switch "Selected drive" to Finance → Filter clears; badge back to "Key required for downloads" (per-drive key).
6. Repeat load via recovery file for Finance; download `/outputs/q3-ledger.csv` → Works.
7. Switch to "Ops" → No recovery file; she cannot unlock; browsing names still works.
8. Click the browser Refresh (or the header "Refresh" button) → Header "Refresh" reloads data; state check: keys still loaded for Legal/Finance (in-memory state survives data refresh).
9. Press F5 (full page reload) → "Opening your workspace…"; all keys lost; every badge reads "Key required for downloads".
10. Switch tab to "Trash" and back to "Files" → Keys unaffected by tab switching.
11. Click "Forget key" on Legal → Notice "Drive key removed from this browser session."
12. Sign out via UserButton ("Your account") → Keys discarded with the page.

### Variations

- Sofia opens the console in two browser tabs: each tab has separate memory; keys do not carry over.
- Password manager autofill into the masked "Drive key" field works (autocomplete off may fight it).

### Edge Cases

- Selected drive reverts to first drive on refresh if the previous selection no longer exists.
- No indicator of which drives currently hold keys besides the badge for the selected drive.
- Header "Refresh" vs. browser reload look similar but have different effects on keys (header preserves, reload wipes) with no UI hint.

## STORY-009: Console shows an expected file that is missing (agent wrote to the wrong drive)

**Type**: short
**Topic**: Console file management
**Persona**: Aisha Karim, whose agent claims it saved `/outputs/summary.md`, but she cannot find it.
**Goal**: Locate the file or conclude it was never written to this drive.
**Preconditions**: Two drives; file exists on drive "Staging" only.
**Ideal path**: 3 — a cross-drive search would be 1 step; none exists in the console.
**Alternate paths**: CLI `agent-drive search --query summary --drive ID` per drive; `agent-drive recent --drive ID --since ...`; Usage tab "Usage by author" shows which agent wrote versions; Activity & deletion Audit log (/console/settings) shows actions without paths.

### Steps

1. On Files, type "summary" in "Filter loaded files…" with drive "Production" selected → No rows; empty-state text "Ready for your first file." shows beneath if the table is empty, otherwise just an empty table.
2. Switch "Selected drive" to "Staging" → Filter clears (must retype).
3. Retype "summary" → Row `/outputs/summary.md` appears.
4. Also check the Trash tab for the Production drive → "Nothing in the trash."

### Variations

- File was trashed: it shows in Trash instead, with the DELETED timestamp.

### Edge Cases

- Filter being cleared on drive switch forces retyping per drive.
- When the filter matches nothing but files exist, no "no matches" message appears; the empty-state only appears when the loaded list itself is empty (potentially misleading text "Ready for your first file." never shows in that case).

# Topic: Settings and data lifecycle

Source: `apps/web/app/(app)/console/settings/settings-client.tsx` (page title "Activity & deletion"), handlers in `apps/web/src/api/handler.ts` (`console.audit.list`, `console.drive.delete`, `console.account.delete`, `console.deletions.list`) and `apps/web/src/api/deletion.ts`.

## STORY-080: Owner reviews what the agents did last night
**Type**: short
**Topic**: Settings and data lifecycle
**Persona**: Priya, a solo developer whose two agents (trace-bot, notes-bot) ran overnight, wondering whether anything was refused.
**Goal**: See recent activity and spot failed or denied requests.
**Preconditions**: Signed in, at least one drive, agents have made API calls.
**Ideal path**: 2 — open the page, read the newest rows; the log should be one click from the console.
**Alternate paths**: Files tab has no activity feed (gap); `agent-drive recent --drive ID` shows file events only, not denied requests; Usage tab "Usage by author" shows operation counts, not individual events.
### Steps
1. In `/console`, click "Activity & deletion" in the sidebar → `/console/settings`, heading "Activity & deletion", "Loading…" on the Refresh button, then the "Audit log" card (badge "OWNER ONLY", subtitle "Most recent first. Metadata only—never file contents or credentials.").
2. Read the table columns When / Action / Actor / Result → rows like `v1.files.put` by "trace-bot" with key label, Result "success" and "HTTP 200".
3. Notice a row with Result "failure", "HTTP 403 · permission_denied" from "notes-bot" → she learns a write was refused but not which path (the log has no path column; gap).
4. Click "Load older events" → 25 more rows are appended (button reads "Loading…" while busy).
### Variations
- A write that is still running shows "In progress" instead of an outcome and no HTTP line.
- Console actions show the actor "Console user"; unauthenticated requests show "Public / unauthenticated".
### Edge Cases
- New account: table is empty and the text "No audit events loaded." appears.
- Audit request fails: red banner (role alert) with the server message or "The request failed. Please retry."; the Refresh button retries everything.
- She wants to filter by agent or action: no filter or search exists (gap); she must scroll and page.

## STORY-081: Owner cannot find file-level history in the audit log
**Type**: short
**Topic**: Settings and data lifecycle
**Persona**: Marcus, who thinks a teammate's agent deleted /inbox/vendor/2026-11-05.jsonl.
**Goal**: Find who deleted a specific file and when.
**Preconditions**: A file was moved to trash by an agent.
**Ideal path**: 3 — open Trash tab, see "Deleted" date and author on the row, done.
**Alternate paths**: Trash tab (DELETED date, author); Versions dialog; `agent-drive recent`; audit log (action name only).
### Steps
1. Open `/console/settings` and read the audit table → rows show the action code (for example `v1.files.delete`) and actor, but no path.
2. He scans for the time he remembers → finds the action but cannot confirm it was that file (gap: no path or filter).
3. He goes back to the console and opens the Trash tab → the row for the path shows DELETED date and AUTHOR, answering the question.
### Variations
- CLI: `agent-drive recent --drive ID --since 2026-11-05T00:00:00Z` lists file events with the author agent name.
### Edge Cases
- The same event is described on three surfaces (audit log, Trash tab, `recent`) with different fields on each.

## STORY-082: Delete one drive after finishing a project
**Type**: medium
**Topic**: Settings and data lifecycle
**Persona**: Hana, finished a contract; wants the drive "client-acme-q3" gone but keeps her other drive "personal-notes".
**Goal**: Permanently delete one drive.
**Preconditions**: Two drives, no account deletion pending.
**Ideal path**: 3 — pick drive, type name, confirm.
**Alternate paths**: Per-drive delete exists only on this page; no delete in the Files tab or CLI (`drive delete` does not exist).
### Steps
1. Open `/console/settings`, scroll to "Delete your data" (eyebrow PERMANENT ACTIONS) → text warns it cannot be undone and removes versions, trash, sharing links, upload metadata.
2. Open the "When is data actually removed?" disclosure → reads that access is disabled at once, purge starts after an upload grace period of at least ten minutes.
3. In "Delete one drive", the Drive select defaults to the first drive ("client-acme-q3" or "personal-notes", whichever is first). She almost leaves it on the wrong one, then picks "client-acme-q3" → confirmation field clears.
4. Type "client-acme" (partial) → button "Permanently delete drive" stays disabled; hint "Type the exact drive name above to enable this."
5. Type the exact "client-acme-q3" → button enables. Click it → label "Requesting deletion…".
6. Green status banner: "Drive deletion accepted. Access is disabled. See request history below for the current cleanup status. Request <id>." and the page scrolls to it. Drive vanishes from the select; a "Drive deletion" row appears under "Deletion requests" with status "pending".
### Variations
- She has downloaded files first: Files tab Download needs the drive key loaded (see download topic); the page only says "Download any files you need before continuing".
- Keyboard: pressing Enter in the name field submits the form when enabled.
### Edge Cases
- Names are case sensitive and checked exactly, including spaces; a trailing space keeps the button disabled.
- Server rejects mismatched name: "The drive name confirmation is incorrect." in a red banner (a race with a rename is not possible; drives cannot be renamed).
- Agents that used the drive start getting errors immediately; the page does not list which agents are affected (gap).
- Pending job gives no way to cancel or undo (gap).

## STORY-083: Duplicate drive names make the delete dropdown ambiguous
**Type**: short
**Topic**: Settings and data lifecycle
**Persona**: Tomas, who created two drives both named "scratch" while testing.
**Goal**: Delete only the older "scratch" drive.
**Preconditions**: Two drives with the same name.
**Ideal path**: 3 — pick the right one by id or date, type name, confirm.
**Alternate paths**: Drive IDs are visible with copy buttons in the Files tab drive view.
### Steps
1. Open the Drive select → two options both read "scratch"; no id, size or date (gap).
2. He guesses the first, types "scratch", clicks "Permanently delete drive" → deletion accepted.
3. The "Deletion requests" row shows `Target <drive id>` → he compares to the id in the Files tab and realises it may be the wrong drive; no cancel exists.
### Variations
- Check the Files tab drive strip (name, size, file count) before visiting settings and note the id.
### Edge Cases
- Typed name matches either drive, so the confirmation does not protect against picking the wrong duplicate.

## STORY-084: Delete the whole account
**Type**: long
**Topic**: Settings and data lifecycle
**Persona**: Elena, closing her workspace after moving to another tool; she has a paid Developer plan.
**Goal**: End the account and know when data is really gone.
**Preconditions**: Signed in, paid plan, two drives, three agents.
**Ideal path**: 4 — open settings, read what happens, type phrase, confirm (cancel-plan step should be automatic).
**Alternate paths**: Billing page offers plan changes and the portal but no account closure; the settings page notes "This is not a plan downgrade".
### Steps
1. On `/console/billing` she looks for "Close account", finds only plan cards and spending controls → follows the sidebar link "Activity & deletion" (gap: no pointer from billing).
2. Reads the "Delete your account" card: removes every drive and agent, revokes all API keys, ends the workspace.
3. Opens "When is data actually removed?" → learns billing closes, known usage is settled first, a hashed identity tombstone and aggregate billing receipts remain, invoices follow provider retention.
4. Types "delete my account" in lower case → button "Permanently delete account" stays disabled; hint "Type DELETE MY ACCOUNT above to enable this."
5. Types `DELETE MY ACCOUNT` exactly → button enables; click → "Requesting deletion…".
6. Banner "Account deletion accepted. Access is disabled. ... Request <id>." The button now reads "Account deletion requested" and is disabled; the drive select shows "No active drives" and is disabled.
7. She copies the request id from "Deletion requests" for her records.
### Variations
- She reloads later: console actions still render the settings page; data lists are empty, the account job remains listed.
- Her agents run `agent-drive check` and receive authentication failures; llms.txt tells agents to ask the human, so they report it.
### Edge Cases
- The Clerk sign-in identity is removed at the end of the job; if identity deletion is not configured the job reports "Console identity deletion is not configured." and stays blocked.
- Free-text confirmation is the only guard; there is no password or email re-check.
- Active share links may work until they expire (disclosure text), which surprises owners who assumed instant revocation.

## STORY-085: Checking whether the deletion has finished
**Type**: medium
**Topic**: Settings and data lifecycle
**Persona**: Hana, ten minutes after requesting drive deletion, wants proof it is purged.
**Goal**: See the job status.
**Preconditions**: A drive deletion request exists.
**Ideal path**: 2 — open settings, read the status line; ideally it updates itself.
**Alternate paths**: none found (no email, no push notice, no CLI command for status).
### Steps
1. Open `/console/settings` → "Deletion requests" card says "Refresh to check background progress. Save the request ID if you need help."
2. Row shows "Drive deletion", status "pending", "Requested <time> · Purge not before <time>".
3. She clicks Refresh at the top → still "pending" (purging starts only after the grace period and a maintenance worker run).
4. Later she refreshes again → status "complete" and "Completed <time>" replaces the purge-not-before text.
### Variations
- Status "blocked" is labelled "Needs retry" with the message from the worker plus "The worker will retry; unresolved billing or provider issues may need operator help." She has no retry button (gap).
- More than 25 requests: "Load older requests".
### Edge Cases
- Page does not poll; it stays "pending" until she clicks Refresh.
- Refresh also reloads the audit log and resets its scroll to the top.
- If the status refresh fails after submitting a deletion, the banner reads "Deletion was accepted, but status could not be refreshed. The background job continues independently."
- The only support instruction is "save the request ID"; no support contact is shown (gap).

## STORY-086: Last drive deleted, then the owner returns to the console
**Type**: medium
**Topic**: Settings and data lifecycle
**Persona**: Jonas, deletes his only drive, then wants a fresh start with a new agent.
**Goal**: Recreate a workspace after deleting the last drive.
**Preconditions**: One drive, one agent, one key.
**Ideal path**: 3 — delete, create new drive, connect agent.
**Alternate paths**: A new drive can also come from the agent's `login` flow.
### Steps
1. Deletes the only drive in settings (see drive deletion story) → select shows "No active drives".
2. Clicks "Back to files" → console shows "Give your first agent a home" (no-drives empty state).
3. Creates a new drive with a name; saves the new key in the receipt dialog → drive appears.
4. The old agent's key is still listed in the API keys tab as Active but its drive is gone (gap: stale key not flagged); `agent-drive ls` for the old id returns not found.
### Variations
- The old agent runs `agent-drive check` and sees an error about the missing drive and no usable key; the local config still holds the deleted drive's key (no cleanup).
### Edge Cases
- Free plan drive limit is 3; deleted drives free the slot only after the job completes (not verified in code).

## STORY-087: Settings page on a phone, second session, and signed-out access
**Type**: short
**Topic**: Settings and data lifecycle
**Persona**: Aisha, checking the audit log from her phone while travelling.
**Goal**: Read audit rows on a narrow screen and handle an expired session.
**Preconditions**: Signed in on a phone.
**Ideal path**: 2 — open `/console/settings`, read.
**Alternate paths**: none found.
### Steps
1. Opens `/console/settings` from a bookmark → if signed out, the server redirects to `/sign-in` (no return to settings after sign-in; the redirect has no `redirect_url`) — she lands on `/console` instead (gap).
2. On the narrow layout the audit table stacks with labels Action / Actor / Result, so each row reads as a card.
3. Her session expires mid-visit and she taps "Load older events" → error banner shows the API message (the console shows "Your session expired. Sign in again." elsewhere; here the generic API error text is shown).
### Variations
- Chrome back button leaves the settings page without a confirmation even with half-typed confirmation text.
### Edge Cases
- Typed confirmation text is cleared when the drive selection changes.

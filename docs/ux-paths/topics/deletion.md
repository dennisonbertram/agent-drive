# Topic 10: Audit, deletion and account teardown

Code read: `apps/web/app/(app)/console/settings/settings-client.tsx`, `src/api/handler.ts` (console `audit`, `deletions`, `drives/:id` DELETE, `account` DELETE), `src/api/deletion.ts` (purge worker), cron maintenance. Route: `/console/settings` ("Activity & deletion"), reached from the sidebar link "Activity & deletion".

Cross-surface notes: the same typed-confirmation rule exists only on this page; the Files tab has "Trash" (soft delete, restorable) which is a different concept than "Permanently delete drive". Billing page copy never links here; this page says account deletion "is not a plan downgrade". Audit "OWNER ONLY" pill is the only role cue.

## STORY-001: Skim the audit log after an agent behaves oddly

**Type**: short
**Topic**: Audit, deletion and account teardown
**Persona**: Maya Okafor, wants to know if her research agent deleted something
**Goal**: See recent actions and who did them
**Preconditions**: Signed in, agents have been active
**Ideal path**: 2 — open page, read table
**Alternate paths**: console "Trash" tab shows deleted files (not who did it) ; CLI `recent` shows file events with author (no failures)

### Steps

1. Click sidebar "Activity & deletion" → `/console/settings`, heading "Activity & deletion", "Audit log" with pill "OWNER ONLY", "Most recent first. Metadata only—never file contents or credentials."
2. Read rows → Columns When / Action (code, e.g. `files.delete`) / Actor ("Console user" or agent name with key label, or "Public / unauthenticated") / Result (success, failure, "In progress" with "HTTP 200" or "HTTP 402 · payment_required").
3. Scroll the table → Region labeled "Audit events" (keyboard focusable).
4. Click "Load older events" → Appends 25 more rows.

### Variations

- Click "Refresh" at top to reload everything (button reads "Loading…").

### Edge Cases

- No filter/search/date range; Maya must scroll through pages to find a specific day.
- Empty: "No audit events loaded."
- Action names are raw codes with no explanation; file paths are not shown (metadata only), so she cannot see which file was deleted.

## STORY-002: Diagnose a failing agent through audit failures

**Type**: medium
**Topic**: Audit, deletion and account teardown
**Persona**: Jordan Lee, agent errors overnight, wants the cause
**Goal**: Find the 402 / 403 events for the key "nightly-laptop"
**Preconditions**: Key has failed several writes
**Ideal path**: 3 — open audit log, spot failure rows
**Alternate paths**: CLI stderr from the agent itself; billing page for 402 cause

### Steps

1. Open `/console/settings` → Audit table loads (25 rows).
2. Scan Result column for red "failure" with `HTTP 402 · payment_required` → Actor column shows agent name and small key label "nightly-laptop".
3. Load older events twice to find the first failure → Rows appended.
4. Follow up in billing → Sidebar back via "Back to files" then "Billing & limits" (no direct link from audit).

### Variations

- Failures with `errorCode` like `quota_exceeded` or `rate_limited`.

### Edge Cases

- Rate-limit failures may flood the log, pushing the relevant row far back.
- Console actions show as "Console user" without email.

## STORY-003: Delete one drive with the typed-name confirmation

**Type**: medium
**Topic**: Audit, deletion and account teardown
**Persona**: Tomás Rivera, retiring the "Research workspace" drive after downloading what he needs
**Goal**: Permanently delete one drive
**Preconditions**: Two active drives: "Research workspace" and "Scratch"; an API key allowed on both; one active share link on Research workspace
**Ideal path**: 4 — choose drive, type name, click, confirm status
**Alternate paths**: none found (Files tab only offers Trash for files; no drive delete button there. Console API `drives/:id/trash` exists but is not a UI button)

### Steps

1. Open `/console/settings`, find "Delete your data" and the "Delete one drive" form → Select "Drive" defaults to the first drive alphabetically (could be the wrong one). Button "Permanently delete drive" disabled.
2. Open the select, choose "Research workspace" → Confirmation cleared.
3. Type `research workspace` (wrong case) → Button stays disabled; no error shown, only disabled state.
4. Retype exact `Research workspace` → Button enables.
5. Click "Permanently delete drive" → Button "Requesting deletion…", then banner: "Drive deletion accepted. Access is disabled. See request history below for the current cleanup status. Request {uuid}."
6. Scroll to "Deletion requests" → New item "Drive deletion", status "pending", "Requested ... · Purge not before {time >= 10 minutes later}", Request and Target IDs.

### Variations

- Open "When is data actually removed?" first to read the grace rule.
- Drive deleted while Tomás had unsaved Load drive key state in console: the drive disappears from Files after refresh.

### Edge Cases

- Share links on the drive are revoked immediately, the drive is removed from every API key's drive list; keys remain active for other drives. Agent writing to it gets not found / unavailable.
- Drive name with trailing spaces must match exactly.
- Deleting the last drive: select shows "No active drives" and form disables.
- Double-submit returns the existing job (202).

## STORY-004: Watch a drive deletion progress through pending to complete

**Type**: medium
**Topic**: Audit, deletion and account teardown
**Persona**: Tomás Rivera, wants proof the data is gone
**Goal**: Confirm the purge finished
**Preconditions**: Drive deletion requested; Vercel Cron cleanup runs every 5 minutes
**Ideal path**: 3 — wait, refresh, read status
**Alternate paths**: none found; no email or notification on completion

### Steps

1. Immediately after request, read job list → "pending", "Purge not before {time}".
2. Click "Refresh" at 3 minutes → Still pending (grace period of at least 10 minutes, or later if upload intents are still valid).
3. Click "Refresh" after ~15 minutes → Status "complete", text "Completed {time}" replaces "Purge not before".
4. Check Usage tab → Drive gone from "Storage by drive"; billing storage drops.

### Variations

- Status "Needs retry" (internal `blocked`): job shows `lastError` plus "The worker will retry; unresolved billing or provider issues may need operator help." No retry button exists.
- Status "running" is not a UI-typed value (types are pending/blocked/complete).

### Edge Cases

- Page does not auto-poll; user must press Refresh.
- Cron hiccup leaves status pending beyond the stated time with no explanation.
- If the post-accept reload fails: "Deletion was accepted, but status could not be refreshed. The background job continues independently."
- Many jobs: "Load older requests".

## STORY-005: Mistyped or abandoned drive deletion

**Type**: short
**Topic**: Audit, deletion and account teardown
**Persona**: Priya Nair, nervous about deleting the wrong drive
**Goal**: Back out safely
**Preconditions**: Three drives
**Ideal path**: 2 — start, navigate away
**Alternate paths**: none

### Steps

1. Select drive "prod-memory" and type its name → Button enabled.
2. Hesitate, switch the select to "staging-memory" → Confirmation field cleared and error cleared; button disabled again.
3. Click "Back to files" → Returns to console without any deletion.

### Variations

- Press Enter in the confirm field when name matches: form submit triggers deletion (no extra confirm dialog).

### Edge Cases

- The only guard is typing the name; no second dialog, no download prompt (copy says "Download any files you need before continuing").
- Server re-checks: "The drive name confirmation is incorrect."

## STORY-006: Delete the whole account

**Type**: long
**Topic**: Audit, deletion and account teardown
**Persona**: Dana Whitfield, shutting down her workspace; paid Developer plan with 3 drives, 4 agents, 6 API keys, 2 active shares
**Goal**: Fully tear down account and billing
**Preconditions**: Developer plan, active subscription, files already exported by downloading in console with keys
**Ideal path**: 6 — read warning, type phrase, click, verify job, wait, done
**Alternate paths**: Stripe portal cancel first (billing page "Invoices & payment details") but this only cancels the subscription, not the data; Clerk UserButton profile for identity (account deletion also removes sign-in identity)

### Steps

1. Download needed files from Files tab (Load drive key then "Download") for each of 3 drives → decrypt in browser.
2. Open `/console/settings`, read "Delete your data" and expand "When is data actually removed?" → Text on grace period, billing closing, tombstone and receipts retained.
3. Look at "Delete your account": "Remove every drive and agent, revoke all API keys, and end this workspace. This is not a plan downgrade." → Dana now sees the field label "Type DELETE MY ACCOUNT to confirm".
4. Type `delete my account` → Button disabled; type `DELETE MY ACCOUNT` → enabled.
5. Click "Permanently delete account" → "Requesting deletion…" then banner "Account deletion accepted. Access is disabled. See request history below for the current cleanup status. Request {id}." Button now reads "Account deletion requested" (disabled); drive select shows "No active drives".
6. Check "Deletion requests" → "Account deletion", "pending", "Purge not before ...".
7. Try an agent: `agent-drive whoami` → API keys were revoked at acceptance; unauthorized.
8. Open a share link `/s/<id>#k=...` → "Share link revoked" (shares revoked at acceptance; already-issued presigned URLs may live up to ~60 s).
9. Wait for cron (every 5 minutes) → Worker settles billing, closes Stripe customer, purges storage, deletes identity, writes hashed tombstone; status eventually "complete".
10. Reload `/console` later → Session identity removed; Dana is signed out / cannot re-enter as same account.

### Variations

- Billing errors: job shows "Needs retry" with e.g. "Billing deliveries remain pending.", "Billing reconciliation is required." or "Stripe billing remains open." and no user remedy.
- Free plan account: no Stripe step.

### Edge Cases

- Console remains visible during deletion for the same session (account session accepted while `deleting_at` is set); other tabs show the drives list empty after refresh.
- Account deletion cannot be cancelled; no "undo" in the UI.
- Subsequent creates give conflict "The account is being deleted."
- "Console identity deletion is not configured." can block completion on misconfigured installs.
- Billing page does not warn that open usage is settled and invoiced upon deletion except in the explainer.

## STORY-007: Compare soft delete (Trash) with permanent deletion before acting

**Type**: medium
**Topic**: Audit, deletion and account teardown
**Persona**: Leo Park, cleaning up to cut storage cost after seeing the billing page
**Goal**: Actually reduce billed storage
**Preconditions**: Free plan near limit; 200 files in Trash
**Ideal path**: 3 — realise only drive/account deletion purges; delete a drive
**Alternate paths**: none found for purging individual trashed files (no hard purge of single files)

### Steps

1. On `/console/billing` read "All versions count, including trash." → Learns Trash costs storage.
2. Open console "Trash" tab → Files list with DELETED and RECOVERY columns, "Restore" only; no "Empty trash" / permanent delete.
3. Open `/console/settings` → "Delete your data" says it "removes retained versions, trash, sharing links, and upload metadata—not just visible files." Leo realizes only whole-drive deletion frees space.
4. Decide to move the remaining wanted files with `agent-drive cp`/`put` to another drive first, then delete the old drive using the typed name → Job pending, then complete.

### Variations

- Instead upgrade to Developer (see billing stories).

### Edge Cases

- No guidance linking Trash tab to settings page.
- Storage figure only drops after job completes (not on acceptance).

## STORY-008: Audit evidence of a deletion

**Type**: short
**Topic**: Audit, deletion and account teardown
**Persona**: Sam Brooks, wants a record that a drive deletion happened for compliance
**Goal**: Find the request ID, time and result
**Preconditions**: A drive deletion completed last week
**Ideal path**: 1 — open settings, read "Deletion requests"
**Alternate paths**: Audit log (may list the DELETE call), but identifies metadata only

### Steps

1. Open `/console/settings`, scroll to "Deletion requests" → Entry "Drive deletion · complete", "Requested {date} · Completed {date}", Request `{id}`, Target `{drive id}`.
2. Copy the IDs manually → No copy button or export.
3. Search audit log for the delete action → Row shows the action code, actor "Console user", result success HTTP 202.

### Variations

- Older entries need "Load older requests".

### Edge Cases

- Drive name is not shown in the job (only target UUID), so correlating with a deleted drive name requires external notes.
- After account deletion only minimal receipts and hashed tombstone remain, which Sam cannot view from the UI because the account is gone.

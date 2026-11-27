# Setup topic: OpenRouter webhook and trace capture

> ID note: stories in this file now use catalog IDs SETUP-059 to SETUP-068 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-059, 02 = SETUP-060, 03 = SETUP-061, 04 = SETUP-062, 05 = SETUP-063, 06 = SETUP-064, 07 = SETUP-065, 08 = SETUP-066, 09 = SETUP-067, 10 = SETUP-068.


Temporary IDs: STORY-WEBHOOK-CAPTURE-NN. Source of truth is code; file:line refs are in the worktree `/Users/dennison/develop/agent-drive-ux-setup`.

Key code: `apps/web/app/(app)/console/traces-dialog.tsx` (dialog), `apps/web/src/console/webhook-setup.ts` (key proof and token flow), `apps/web/app/(app)/console/console.tsx` (`webhookKey` ~1759, `keyLoaded` ~2380, `strictFetcher` ~549, `vaultFailure` ~515, modal title ~4182), `apps/web/src/api/handler.ts` (`traceEndpoint` ~2636), `docs/trace-capture.md`, `docs/console.md:74-79`, `packages/agent-drive/src/capture.ts`.

Entry points to the same dialog ("Capture traces"):
- Files toolbar button `Capture…` (`console.tsx:3069`); the neighbouring button `Traces` (`console.tsx:3063`) only opens `/traces` in the Recent view.
- Drive menu item `Capture traces…` (`drive-menu.tsx:77`; item above it is `Traces`).
- Empty state on `/traces`: "No traces yet." with link `add an OpenRouter webhook` (`console.tsx:3543-3552`).

## Cross-surface and copy findings (all stories use these)

1. Same action, two labels: toolbar `Capture…` vs drive menu `Capture traces…` vs dialog title "Capture traces". `docs/trace-capture.md:122` says only "choose the traces action (the "Capture traces" dialog)", and `docs/console.md:74` says "Capture…". The word "Traces" is a different button that does not open the dialog.
2. Same word, two meanings of mismatch: `MISMATCH` in `webhook-setup.ts:17` is "This key does not open this drive’s files." but `MISMATCH` in `console.tsx:497` is "This drive’s account copy is invalid — load its recovery file to repair it." Both can appear in this flow (the second is the unlock dialog's note when the account slot cannot be opened, the first is the Capture dialog error).
3. Same fact (empty drive, pasted key cannot be checked) has two wordings: unlock dialog `console.tsx:2600` "This drive has no file or trace inbox to confirm the key. Use a recovery file or credentials bundle for an empty drive." and Capture dialog `webhook-setup.ts:18` "This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive."
4. Reverification cancel: vault actions show "Confirm it’s you to <doing>." (`console.tsx:515-520`), but the Capture dialog shows the raw `reason.message` (`traces-dialog.tsx:107`). The exact Clerk text could not be confirmed in this worktree (Clerk package not searchable). Walkers should record the real text.
5. `docs/console.md:79` says a fresh sign-in is needed to "create the inbox and issue a token"; the code asks for it up to three times in one Add (inbox challenge, inbox enroll, token challenge, token POST are all strict calls), though Clerk normally remembers a recent verification so usually one prompt.
6. The token (`adw_...`) is shown once: dialog text "Copy these now. The token is shown once." (`traces-dialog.tsx:222`), `docs/trace-capture.md:134`. After close, only "Created <time>" and `Active` remain.
7. Dialog text under both sections: "OpenRouter sends this trace to our server over TLS. The server reads it once to encrypt it to this drive’s inbox key; it never holds your drive key." This sits under the Local agents section too, where it does not apply (capture encrypts locally).
8. Privacy Mode warning appears only after a token is created (`traces-dialog.tsx:238`), not before the user leaves for OpenRouter's site if they skip reading. Docs `trace-capture.md:132` repeat it.

---

## SETUP-059: Add the first webhook on an unlocked drive with a loaded key
**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Priya Raman, a developer running agents through OpenRouter. She created the drive "priya-agents" in this tab ten minutes ago and has just clicked "I saved it" on the receipt.
**Goal**: Send OpenRouter traces into the drive.
**Preconditions**: Signed in with Clerk; drive has at least one file or was created in this tab (so the key is "trusted"); no trace inbox, no webhook token.
**Surface**: web (browser) plus OpenRouter's site (outside the app)
**Ideal path**: 4 — click `Capture…`, click `Add webhook`, click `Copy webhook URL`, click `Copy headers JSON` (then paste into OpenRouter).
**Alternate paths**: Drive menu `Capture traces…`; the `/traces` empty-state link `add an OpenRouter webhook`; local `agent-drive capture --drive <id> -- claude` instead (no OpenRouter, traces under `/traces/<agent>/`).
### Steps
1. On Files, click `Capture…` in the toolbar → dialog "Capture traces" opens with "Local agents" (install and capture commands) and "OpenRouter webhook" with `Loading…`, then button `Add webhook`.
2. Click `Add webhook` → "Setting up…" shows. The key is already in the tab, so no unlock dialog. Console reads `drives/<id>/trace-inbox`, finds none, verifies the key against a drive file, creates the inbox in the browser, then makes strict calls.
3. Clerk shows its own reverification prompt; Priya confirms her sign-in. The dialog is hidden while Clerk's prompt is open (`native-dialog-suspension`) and returns afterward.
4. Dialog shows "Copy these now. The token is shown once. In OpenRouter, add a Webhook destination." with `Webhook URL` (`https://<origin>/api/webhooks/openrouter/<drive id>`) and `Headers` (`{"Authorization":"Bearer adw_..."}`). Row now reads "Created <time>" `Active` with `Replace` and `Revoke`.
5. Click `Copy webhook URL`, then `Copy headers JSON` → copy buttons confirm. She pastes each into OpenRouter's Webhook destination form, leaves Privacy Mode off per the note "In OpenRouter, leave Privacy Mode off for this destination, or traces will contain no prompts or replies."
6. She closes the dialog and returns to Files; the account now has an agent named `openrouter` (created by the token, `handler.ts:2745`), and the console reloads (`refresh()`).
### Variations
- Priya copies only the URL and forgets the header; OpenRouter's test returns 401 (docs `trace-capture.md:142`).
- She uses the terminal check from `docs/trace-capture.md:158` with `X-Test-Connection: 1` and expects `{"ok":true}`.
### Edge Cases
- Hesitation: step 1, she looks for "webhook" in the toolbar and finds `Traces` first. That button opens the folder, not the setup.
- Closing the dialog while "Setting up…" is not possible (`closable` false while `tracesBusy`).
- She is not told the setup also creates an `openrouter` agent; she may see it in the Agents tab later.

## SETUP-060: Click Add webhook on a locked drive, unlock, and resume
**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Marcus Webb, a returning user on a new laptop. He signed in to Clerk, has an account passphrase, and the drive "research-bots" is sealed into his account. The vault is locked.
**Goal**: Add an OpenRouter webhook for "research-bots".
**Preconditions**: Vault locked; drive key not in this tab; drive not agent-only; has files.
**Surface**: web (browser)
**Ideal path**: 5 — `Capture…`, `Add webhook`, type passphrase and `Unlock`, (Clerk confirm), copy URL; headers copy is a sixth click.
**Alternate paths**: If he has a passkey, the unlock dialog opens in passkey mode ("Unlock with your passkey", button `Unlock with passkey`); `Use your passphrase instead`; `Choose recovery file`; "Paste a key instead" with `Load key`.
### Steps
1. Click `Capture…` → dialog "Capture traces" opens.
2. Click `Add webhook` → `webhookKey()` finds no cached key and the vault is locked. The Capture dialog closes and the unlock dialog opens, title "Unlock with your passphrase", containing the note "After you unlock, you can set up the OpenRouter webhook." (`console.tsx:4295`).
3. Marcus types his passphrase and clicks `Unlock` → vault opens, slot key is read, Capture dialog reopens and starts setting up on its own (`resume` → `resumeWebhook` → `openTraces(found)`); "Setting up…" appears without a second click on `Add webhook`.
4. Clerk reverification prompt; he confirms.
5. Token appears with `Webhook URL` and `Headers`; he copies both.
### Variations
- Passkey account: step 2 opens "Unlock with your passkey" with note; button `Unlock with passkey` shows "Waiting for your passkey…".
- "No recovery file?" help in the recovery mode mentions `agent-drive account seal --drive <id>`.
- He has "keep unlocked" checked; vault stays open 30 minutes, then "Locked after 30 minutes without use. Enter your passphrase to continue." (`console.tsx:494`).
### Edge Cases
- After unlocking Marcus may be confused that he is back in a fresh Capture dialog and not on Files. The unlock note promises this ("you can set up"), but it reads as if he must click again, while the code actually continues automatically.
- If he closes the unlock dialog, nothing resumes; he must click `Add webhook` again.
- Wrong passphrase: PassphraseForm shows its own error; Capture dialog stays closed.

## SETUP-061: Agent-only drive: recovery file needed, mismatched file chosen
**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Lena Okafor, ops engineer. An agent created "ci-traces" for her; its key is on the CI machine only. She has two recovery files in Downloads: `agent-drive-drv_ci.key.json` and an older `agent-drive-drv_old.key.json`.
**Goal**: Add a webhook to "ci-traces".
**Preconditions**: Drive is agent-only (not in her account); unlocked vault; drive has files.
**Surface**: web (browser)
**Ideal path**: 5 — `Capture…`, `Add webhook`, `Choose recovery file`, pick file, (Clerk confirm), copy URL.
**Alternate paths**: "Paste a key instead" → `Drive key or credentials bundle (adcred1.…)` → `Load key`; on the CI machine run `agent-drive credentials export` (shown in the dialog as `Copy credentials export command`).
### Steps
1. `Capture…` → `Add webhook` → unlock dialog opens in recovery mode titled "Load the key for ci-traces" with the notice "Agent-only: open with a recovery file." (`console.tsx:498`) and the note "After the key loads, you can set up the OpenRouter webhook."
2. Lena chooses the old file by mistake via `Choose recovery file` → the dialog verifies the key against the drive; the wrong key is rejected with the unlock-side text (not the Capture-side text).
3. She chooses the right file → Capture dialog reopens and sets up automatically; Clerk prompt; token shown.
### Variations
- Pasted key whose source is `pasted` and drive has files: verification against a file succeeds, setup proceeds.
- A credentials bundle `adcred1.…` counts as drive-bound (`isDriveBoundSource`), so it works even on an empty drive.
### Edge Cases
- Where the mismatch is caught depends on where the key came from: unlock dialog (`MISMATCH`, `console.tsx:497`, "account copy is invalid") versus Capture dialog (`webhook-setup.ts:17`, "This key does not open this drive’s files."). Different words for one failure (copy finding 2).
- The "account seal" instruction is hidden for agent-only drives (`!agentOnly`), so Lena has only recovery file or paste.

## SETUP-062: Empty new drive with a pasted key
**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Tomás Ibarra, set up a drive for a small side project on the CLI and wants traces before any file exists.
**Goal**: Set up the webhook on a drive with no files and no inbox.
**Preconditions**: Drive has zero files and no trace inbox; key not in tab; Tomás has the plain base key text only (not the file or bundle).
**Surface**: mixed (CLI then web)
**Ideal path**: 6 — `Capture…`, `Add webhook`, "Paste a key instead", paste, `Load key`, then read error and switch to `Choose recovery file`.
**Alternate paths**: Use the credentials bundle (`agent-drive credentials export`); use recovery file; or write any file first (`agent-drive put`) so the key can be checked; or `agent-drive capture` locally.
### Steps
1. `Capture…` → `Add webhook` → unlock dialog (recovery mode, since signed-out of vault or not enrolled) with note about setting up the webhook.
2. Open "Paste a key instead", type the key into `Drive key or credentials bundle (adcred1.…)` → `Load key`.
3. Console cannot find a file or inbox to check the key against. Either the unlock dialog rejects it with "This drive has no file or trace inbox to confirm the key. Use a recovery file or credentials bundle for an empty drive." (`console.tsx:2600`) or, once the key reaches the Capture dialog, the error reads "This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive." with a `Retry` button (`traces-dialog.tsx:211`).
4. Tomás clicks `Retry`: the same error returns, because the pasted key is the same. Retry does not reopen the unlock dialog.
5. He exports a bundle on the CLI with `agent-drive credentials export`, pastes `adcred1.…`, and succeeds.
### Variations
- Recovery file from the drive's receipt works the first time.
### Edge Cases
- `Retry` offered for an error that retrying cannot fix is a clarity problem.
- Two wordings for the same fact (copy finding 3).
- Wrong-drive key on an empty drive cannot be detected at all; only recovery material that names the drive is accepted.

## SETUP-063: Cancel Clerk reverification, then retry
**Type**: short
**Topic**: OpenRouter webhook and trace capture
**Persona**: Hana Sato, who clicked `Add webhook` while on a shared desk and is interrupted when Clerk asks for her password.
**Goal**: Get a token after cancelling once.
**Preconditions**: Drive unlocked, key loaded; Clerk prompt requires strict reverification.
**Surface**: web (browser)
**Ideal path**: 3 — `Add webhook`, cancel prompt, `Retry`.
**Alternate paths**: Reclick `Add webhook` is not available; only `Retry` is (the add button is still visible when no token exists, so clicking `Add webhook` again also works).
### Steps
1. Click `Add webhook` → "Setting up…" → Clerk prompt appears (dialog hidden).
2. Cancel the Clerk prompt → the Capture dialog returns and shows an error row (`role="alert"`) with a `Retry` button. The text is the raw error message from Clerk's cancel (`traces-dialog.tsx:107`); it is not the "Confirm it’s you to …" wording that vault actions use (`console.tsx:515`).
3. Click `Retry` → Clerk prompt appears again; she confirms.
4. Token shown as in SETUP-059.
### Variations
- Cancel at the second prompt (token challenge): inbox is already created; the next attempt skips creation and goes straight to issuing the token.
- Session already freshly verified: no prompt at all.
### Edge Cases
- Hesitation: after cancel the dialog looks like it did before except for the error; some users will not know whether anything was created. In fact an inbox may exist but no token.
- The dialog cannot be closed while `Setting up…`, so while Clerk's prompt is up Hana cannot back out of the Capture dialog itself.

## SETUP-064: Save the token for later, lose it, then Replace
**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Ravi Menon, who closed the dialog before pasting the header into OpenRouter, then comes back the next day.
**Goal**: Recover a lost one-time token.
**Preconditions**: A token exists (`Active`), secret was never copied.
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Replace`, copy headers.
**Alternate paths**: `Revoke` then `Revoke webhook` then `Add webhook` (more clicks, same result); nothing in the UI or CLI can show the old token (`docs/trace-capture.md:134`: "a lost token cannot be shown again. Replace it.").
### Steps
1. `Capture…` → row shows "Created <time>", state `Active`, buttons `Replace` and `Revoke`. No URL or header is visible.
2. Ravi looks for a "show token" option; there is none. He clicks `Replace`.
3. Same flow as `Add webhook` (key check, Clerk prompt) → new `Webhook URL` and `Headers` appear with the "shown once" copy.
4. In OpenRouter he updates the destination's header with the new `Authorization` value. The old token has already been revoked server-side when the new one was issued (`handler.ts:2737-2739`).
### Variations
- If the previous OpenRouter destination is still live, its deliveries return 401 until updated (docs table).
- Webhook URL itself does not change, so only the header needs updating, but the dialog does not say that.
### Edge Cases
- `Replace` has no confirmation and silently breaks the current destination; copy under the button does not warn about it.
- Same `Webhook URL` is also derivable (`https://<origin>/api/webhooks/openrouter/<drive id>`), but the dialog does not show it for an existing token.

## SETUP-065: Stale token ("Needs replacement") after the inbox changed
**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Dana Whitfield, a team admin. A teammate re-enrolled the drive's trace inbox through the API; Dana's OpenRouter dashboard begins showing failures.
**Goal**: Restore trace delivery.
**Preconditions**: Active token whose bound inbox record no longer matches the current record (`status: 'stale'`, `handler.ts:2718`).
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Replace`, update header in OpenRouter.
**Alternate paths**: `Revoke` then `Add webhook`.
### Steps
1. `Capture…` → row shows state `Needs replacement` and "The inbox changed after this token was created. Replace the token to resume trace delivery."
2. Click `Replace` → key proof runs against the current inbox; if the key opens that inbox, a new token is issued after Clerk reverification.
3. If the key does not open the new inbox: error "This key does not open this drive’s files." with `Retry`. Dana needs the correct recovery file.
4. Success: update OpenRouter with the new header. Deliveries go from 409 `conflict` (docs table, "token's bound inbox record was changed") to 201.
### Variations
- Legacy token (issued before binding) never shows `Needs replacement` (docs `trace-capture.md:125`).
### Edge Cases
- The dialog never says why the inbox changed or who did it.
- The stale text says "Replace the token" but she may not know the old token stops working immediately.
- OpenRouter's own error for 409 does not mention Agent Drive; she must connect OpenRouter failures to this badge.

## SETUP-066: Revoke a webhook, with confirm and cancel
**Type**: short
**Topic**: OpenRouter webhook and trace capture
**Persona**: Eli Brandt, who rotated away from OpenRouter and wants the URL dead.
**Goal**: Stop deliveries.
**Preconditions**: Active token.
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Revoke`, `Revoke webhook`.
**Alternate paths**: `Replace` (does not stop deliveries, swaps the token); nothing on the CLI revokes a webhook token.
### Steps
1. `Capture…` → click `Revoke` → inline confirm "Stop this webhook?" with `Revoke webhook` and `Cancel`.
2. He clicks `Cancel` by reflex → back to `Revoke`. Clicks `Revoke` again, then `Revoke webhook` → row replaced by `Add webhook`; focus moves to `Add webhook`.
### Variations
- Network error on revoke: confirm text is replaced by the error (default "Could not revoke the link." from the shared control — the word "link" is wrong for a webhook, `share-dialog.tsx:~96`).
### Edge Cases
- Existing traces stay in `/traces/openrouter/`; the dialog does not say so.
- The `openrouter` agent created at first token stays; revoke does not remove it.
- After revoke, OpenRouter requests get 401.

## SETUP-067: Local capture with the CLI instead of OpenRouter
**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Jonas Albrecht, using Claude Code in API-key mode on a server, no OpenRouter account.
**Goal**: See traces appear under `/traces`.
**Preconditions**: CLI logged in with a drive key saved for one drive; `ANTHROPIC_BASE_URL` not set.
**Surface**: mixed (web to copy commands, CLI to run, web to check)
**Ideal path**: 4 — `Capture…`, `Copy install command` (if CLI missing), `Copy capture command`, paste and run in terminal.
**Alternate paths**: Type `agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]` by hand; `--drive` can be omitted when only one drive key is saved.
### Steps
1. `Capture…` → "Local agents": text "Connect to Agent Drive and load this drive’s key on your agent’s machine first. Run Claude Code or Codex through capture to save encrypted traces under /traces."
2. Click `Copy install command` (`npm install -g @dennisonbertram/agent-drive`) then `Copy capture command` (`agent-drive capture --drive <drive id> -- claude`).
3. In a terminal: runs. Each call logs `capture: POST /v1/messages 200 842ms captured`. On exit: `capture: 3 uploaded, 0 queued (0.0 MiB in <spool dir>), 0 not captured (...), 0 invalid`.
4. Back in the console, click `Traces` → `/traces` Recent view lists files under `/traces/claude/<date>/`.
### Variations
- `ANTHROPIC_BASE_URL` already set → `capture disabled: ANTHROPIC_BASE_URL is already set; running claude without capture`; agent runs unwrapped.
- No drive key: `capture disabled: no drive key for drive <id>; running claude without capture`.
- Upload rejected (e.g. 402 quota): `capture: uploads stopped (<cause>); traces stay in <spool dir> for the next run`.
- Invalid `--agent` value (uppercase): error `--agent must be 1-40 characters: lowercase letters, digits, ".", "_" or "-".`
- Missing `--`: `Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]`.
### Edge Cases
- The TLS/"server reads it once" footer in the dialog is about the webhook, but is placed below both sections.
- The dialog tells the user to check terminal output for "disabled / queued / not captured", but does not list those messages; they are in `docs/trace-capture.md`.
- The Claude desktop app is not captured (docs `trace-capture.md:81`); the dialog does not say so.

## SETUP-068: Key from another tab wins (409 race) and traces folder empty state
**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Ines Duarte, who opened the console in two tabs and clicked `Add webhook` in both while setting up for a demo.
**Goal**: End with one working webhook and see traces arrive.
**Preconditions**: No inbox, no token; two tabs both with the key.
**Surface**: web (browser) plus OpenRouter
**Ideal path**: 6 — `Capture…`, `Add webhook`, copy URL, copy headers, paste into OpenRouter, click `Traces`.
**Alternate paths**: Let only one tab finish; `Replace` in the other.
### Steps
1. In tab A she clicks `Capture…` then `Add webhook`, confirms Clerk.
2. In tab B (stale view: still shows `Add webhook`) she does the same. The inbox now exists; the code treats a 409 as "another tab created it" and re-reads it (`webhook-setup.ts:100-111`), proves her key opens it, then issues a second token.
3. Tab B shows its own URL and header. Tab A's token is revoked by B's issue (`handler.ts:2737`). If she pasted tab A's header into OpenRouter, it now returns 401.
4. She runs a test request in OpenRouter; then in the console clicks `Traces`. With nothing yet: "No traces yet." / "Run an agent through agent-drive capture, or add an OpenRouter webhook." The link `add an OpenRouter webhook` reopens the same dialog.
5. After the first delivery the folder shows `/traces/openrouter/<date>/…json`.
### Variations
- If the OpenRouter request has Privacy Mode on, a file is stored but contains no prompts or replies.
- Duplicate delivery of the same body: stored once (docs table).
### Edge Cases
- Tab A keeps showing the old token's `Webhook URL` and `Headers` as valid after tab B replaced it; nothing refreshes it.
- Hesitation: she cannot tell which header is current, since "Created <time>" is only on the saved row, not the one-time block.
- The `/traces` empty state tells users how to start capture but not where OpenRouter traces will land (`/traces/openrouter/`).

---

Story count by Type: short 2 (05, 08), medium 5 (01, 04, 06, 07, 09), long 3 (02, 03, 10).

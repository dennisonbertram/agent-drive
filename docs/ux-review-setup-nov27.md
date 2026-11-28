# First-time setup: consolidated UX review (Nov 27)

Inputs: ux-walker (201 findings, 68 stories, `docs/ux-walker/setup-nov27/`), ux-flow (6 journeys J1-J6 plus `redundancy.md`, `docs/ux-flow/setup-nov27/`), ux-visual (4 pages with findings: prod-public 11, connect 16, console-first-run 19, console-agents-keys 26; `docs/ux-visual/setup-nov27/pages/`).

Labels: **measured** = a number from an audit script or a counted step; **observed** = seen in a screenshot or walk report; **suspected** = inferred from code or catalog, not walked. Paths starting `W/` mean `docs/ux-walker/setup-nov27/stories/`; `V/` means `docs/ux-visual/setup-nov27/pages/`; `J/` means `docs/ux-flow/setup-nov27/journeys/`. The walkers ran on a local build (release 0.5.1, localhost, test session, no Clerk) except the PROD stories, which ran on https://agentdrive.xyz signed out. The test secret is not reproduced anywhere in this file.

Review artifact exclusion: device-login `slow_down` lockouts of 20+ minutes (F-050-03, F-SETUP-035-08, F-011-1 "about 55 minutes") were caused by the review itself (many walkers on one IP against the 20-starts-per-IP-per-hour limit). The duration is not ranked as a defect. Only the unexplained message is (cluster C12).

---

## 1. Verdict

**Is setup clear, obvious, flawless? Clear in the middle, not obvious at the edges, not flawless.** The core agent-first path is close to ideal in step count: J1 measured 12 steps actual against 12 ideal for SETUP-006, and 4 human touches against 4 ideal for SETUP-009 and SETUP-016 (J/J1.md section 1). Most of the damage is in wording that contradicts the real approval step, in a few invisible or stuck controls, and in the second layer (backup, passphrase, recovery file, second agent), where users meet five overlapping concepts. Flow verdicts were: J1 acceptable, J2 convoluted (hand-off), J3 convoluted, J4 acceptable, J5 convoluted, J6 acceptable.

**Website (landing, pricing, docs, llms.txt).** Mostly clear, not obvious on two points. The quickstart is an excellent numbered checklist (`V/prod-public/shots/quickstart-1440-fold.png`), pricing and sign-up are clean (PROD-02, `V/prod-public/shots/signup-1440-fold.png`), and there is no horizontal overflow at four viewports (measured, `V/prod-public/audit.json`). Weaknesses: the hero says "Your agent shows a pairing code, and you approve it in your account" (`apps/web/src/content/home.ts:8`) but the real approval page also requires typing a 16-hex verification code, and walkers filed this seven times independently (see C1); nothing on the landing tells a new user that approval needs sign-up (F-SETUP-001-1); the macOS Finder app is mentioned only inside one dense paragraph of `/docs/cli`, a page measured at 19,286px tall (PP1, PP4, F-PROD-01-4); the landing plan table says downloads 5GB/100GB/1TB while `/pricing` says "Downloads not charged" (F-PROD-01-1, observed on prod, cause suspected).

**CLI.** The happy path works in about 6 seconds of CLI time (SETUP-016 walk) and the 4-line output is relayable by an agent (J/J1.md "already minimal"). It is not flawless in the sections around it. Observed: `slow_down` printed with no explanation (F-011-1, F-SETUP-021-02), `refused the login request: 404` with no URL hint when the API URL lacks `/api` (seven walkers: F-SETUP-006-1, F-009-5, F-SETUP-016-03, F-SETUP-034-08, F-044-01, F-SETUP-051-03, F-SETUP-067-1; may be partly a local-dev artifact, suspected), two competing post-login next steps (F-SETUP-026-F3), `check` failing for agents that were granted or got an env bundle (F-043-04, F-044-05), and the console's recovery file being rejected by `credentials import` (F-015-1, high). Backup routes are well written individually (`Refusing to print credentials to a terminal. Pipe them...` is praised in J/J4.md) but the user is given three with no default (SETUP-027-F2).

**/connect (approval page).** The best surface in the product at desktop width: one dominant "Approve agent", clear title, one-line summary, revoke note (`W/SETUP-013/screenshots/step-1.png`; V/connect "Excellent as is"; J/J1.md). Errors for wrong verification codes are exemplary (V/connect `shots/err-wrongverif-1440-vp.png`). It is not flawless: the typed code is clipped at 375px (measured scrollWidth 218 vs clientWidth 151, `V/connect/shots/typed-375-vp.png`), Approve falls to the viewport edge at 1280x800 with Details open (`V/connect/shots/details-1280-vp.png`), the account and the delegate option are hidden in a collapsed Details, and there is no Deny control (F-013-1, F-SETUP-020-01, verified: the walker approved a request they had meant to ignore).

**Console (onboarding, keys, passphrase, Agents, API keys).** Onboarding at desktop is excellent (one orange Copy, three steps; `W/SETUP-003/screenshots/step-3-onboarding.png`, V/console-first-run "Excellent as is"). From there it degrades quickly. The Connect-an-agent dialog's Copy button is invisible at rest (measured computed color rgb(17,17,17) on a #111 block, ratio 1; `W/SETUP-004/screenshots/step-5-connect-dialog.png`), and the same bug hides the three MCP-setup Copy buttons (V/console-agents-keys F1). The CLI and dialogs send users to "Settings" which does not exist (F-SETUP-035-01, high; V/console-first-run F04, `V/console-first-run/shots/12-load-key-dialog-1440-view.png`). The passphrase and key menu are the least clear area: "Lock" does not lock after reload (F-SETUP-042-01, high), the unlock dialog has no path to reset and loops (F-SETUP-038-01, high), and seven same-weight buttons sit in one menu (`W/SETUP-035/screenshots/step-7.png`). A failed workspace load can be dismissed into a permanently stuck card (F-SETUP-005-1, high; `W/SETUP-005/screenshots/step-4-after-dismiss-stuck.png`).

**Finder / desktop.** Not verified end to end, and the unverified part is the success path. The Finder app and Instabox were not installed on the walk machine, so no success screen was observed in any of SETUP-051 to 058 (J/J5.md caveat). What was observed is bad at the edges: missing `Agent Drive.app` prints a raw system error with no install instruction (F-SETUP-051-01, high), a failed `connect --persist` leaves the mount registered and blocks the rerun (F-SETUP-056-01), "Instabox" is never defined (F-SETUP-056-02, F-SETUP-055-03), and the feature is undiscoverable from every first-time surface (PP1, F-PROD-01-4). Verdict: unclear, not obvious, success path unknown.

**Trace capture.** Closest to good. Click counts equal ideal in SETUP-059, 060, 064, 066, 068 (J/J6.md), auto-resume after unlock removes a click, and revoke is inline, focused and cancelable (SETUP-066). Weaknesses are naming (three labels plus a neighbouring "Traces" button, `W/SETUP-059/screenshots/step-1.png`), a Replace action that kills the old token immediately with no warning (verified: old token 401, F-SETUP-064-1), a stale second tab that silently revokes the first tab's token (verified 200 vs 401, F-SETUP-068-1), and a wrong-key file that is accepted at unlock then fails later (F-SETUP-061-1). Clerk reverification, a real OpenRouter delivery and the CLI capture run were not verified.

---

## 2. Problem clusters

Reach: **All** = every first-time user; **Most** = most users who reach that step; **Subset** = users of a specific path (owner passphrase, second agent, desktop, capture). Effort: S <= 1 day, M a few days, L more. Severity: P0 blocks setup for most users (none found), P1 a main-path failure or a contradiction on a required step, P2 friction or a confusing edge, P3 polish. Walker "found by": W = walker, F = flow, V = visual.

### C1. Approval step is described wrongly on four surfaces; three codes have overlapping names

- **Root cause:** Copy is hand-written separately in `home.ts`, the console onboarding/Connect dialog, `docs/quickstart.md` and `llms.txt`. Three have the human "approve" and the fourth requires typing a 16-hex verification code that the page never shows. The 8-letter pairing code, 16-hex verification code and account fingerprint share shape and vocabulary (F-SETUP-035-03 shows a user pasting the wrong one).
- **Found by:** W F-SETUP-003-1, F-009-1, F-014-1, F-SETUP-018-01, F-015-7, F-PROD-01-2, F-013-3, F-SETUP-035-03; F redundancy "Duplicate Information 1/2", "Naming 1"; V F9 (connect), prod-public landing verdict. Seven independent filings (measured count from the findings list).
- **Surfaces:** website, console, /connect, CLI docs.
- **Severity:** P1 (contradiction on the required, human step of the primary path). **Reach:** All. **Effort:** S.
- **Fix:** One sentence in all four places: "your agent shows a pairing code; open the link, type the verification code from your terminal, and click Approve agent." Define the three names once: pairing code (8 letters, matched by eye), verification code (16 hex, typed), account key fingerprint (always full label, with Copy). Rename the "No pairing" tag.
- **Acceptance:** `git grep -i "approve it once\|click Approve"` finds no sentence lacking "verification code" on home, console, quickstart, llms.txt; the three terms appear in identical wording on each surface; no walker finding of this type on re-walk of SETUP-009/016.
- **Files:** `apps/web/src/content/home.ts`, `docs/quickstart.md` (then regenerate `docs.generated.json`), `apps/web/app/llms.txt/route.ts`, `apps/web/app/(app)/console/console.tsx` (lines ~323 and ~2877).
- **QUICK FIX** (copy only; 4 files, no logic).

### C2. Invisible Copy buttons (and a cluster of dialog styling defects)

- **Root cause:** `dialog .copy-button` sets `color: var(--ink)` with transparent background (`console-panels.css:526`), which on the #111 code block gives ratio 1. Same family: password fields render as solid black bars and the disabled primary reads weaker than the neighbouring secondary; the focus ring on the onboarding Copy is #111 on #111.
- **Found by:** W F-SETUP-004-1 (high); V console-first-run F01 (P1), F06, F07, F08; V console-agents-keys F1 (P1, three MCP Copy buttons); F redundancy "Duplicate Paths 1".
- **Surfaces:** console. **Severity:** P1 (the only action of the Connect dialog is invisible; measured). **Reach:** Most (every first-time user who opens "Connect an agent" or MCP setup). **Effort:** S.
- **Fix:** Give dialog and details Copy buttons a visible light-on-dark (or orange) style at rest; add a visible focus ring; style password inputs like other inputs; make disabled primary visibly weaker than secondary.
- **Acceptance:** `layout-audit` lowContrast reports no `.copy-button`; ratio >= 4.5:1 at rest for the Connect dialog and the three MCP Copy buttons at 1440 and 375; focus ring visible with ratio >= 3:1 on the onboarding Copy.
- **Files:** `apps/web/app/styles/console-panels.css` (and possibly `console.css`).
- **QUICK FIX.**

### C3. /connect layout degrades the primary action first

- **Root cause:** The verification-code label sits beside the input, squeezing it to 153-168px at 375px; opening Details adds about 320px so Approve sits at y 794 of 800 at 1280x800; field labels are 11px grey mono.
- **Found by:** W F-009-2, F-SETUP-017-01, F-043-05, F-013-5, F-SETUP-018-03, F-SETUP-022-04; F redundancy "Hierarchy 5"; V connect F1 (P1), F2 (P1, measured 218 vs 151), F6, F10, F12.
- **Surfaces:** /connect. **Severity:** P1 (mobile users cannot read back the code they typed; measured). **Reach:** Most (mobile or laptop approvals). **Effort:** S.
- **Fix:** Stack label above the input at all widths; keep Approve visible with Details open (sticky or move Details below the button); raise labels to >= 12px; placeholder contrast up.
- **Acceptance:** at 375px the 19-character code is fully visible (scrollWidth <= clientWidth); at 1280x800 with Details open the Approve button bottom <= 800; labels >= 12px.
- **Files:** `apps/web/app/styles/connect.css`, `apps/web/app/(app)/connect/connect.tsx`.
- **QUICK FIX.**

### C4. /connect code-entry and error messages are generic or wrong

- **Root cause:** One message "Enter the code in the form XXXX-XXXX." (`connect.tsx:199`) covers wrong alphabet and wrong shape; the verification message implies spaces are required; one message covers unknown, expired and already-approved codes; literal backticks around `agent-drive login` in the expired banner.
- **Found by:** W F-012-1..4, F-SETUP-017-02, F-SETUP-019-01, F-010-3, F-SETUP-024-01; V connect F5, F7, F9, F8.
- **Surfaces:** /connect. **Severity:** P2. **Reach:** Subset (users who mistype or reload; F5: reload after approval shows an error). **Effort:** S.
- **Fix:** Name the allowed letters or say "no vowels"; accept the code with or without spaces and say so; show "already approved" distinctly if the server can reveal that to the same account (needs a check; otherwise reword to "Already approved? Return to your agent"); render the command as code; autofocus the verification input.
- **Acceptance:** `ABCD-EFGH` yields a message naming the letter rule; `Verification code: ...` pasted line is accepted or named; reload after approval shows text that does not read as a failure.
- **Files:** `apps/web/app/(app)/connect/connect.tsx` (shares with C3).
- **QUICK FIX** (message text; the "already approved" wording is the only part that needs a server check).

### C5. /connect hides what the human decides on and gives no way to refuse

- **Root cause:** Account and machine rows, the delegate checkbox, the existing-drive route and its fields are inside a collapsed Details; there is no Deny; the done card does not echo what was granted (delegate, write folder); two same-name drives in the picker are indistinguishable.
- **Found by:** W F-013-1, F-013-2, F-SETUP-020-01, -02, F-SETUP-025-01, F-SETUP-023-01, -03, F-044-03, F-050-01, F-SETUP-022-01, -02, -03, F-SETUP-034-02, F-043-02; F redundancy "Hierarchy 1, 2"; V connect F3, F4.
- **Surfaces:** /connect, CLI error text. **Severity:** P1 (security-relevant decision information is hidden; observed twice, one walker approved a request they had meant to refuse). **Reach:** All approvals see the account issue; Subset (orchestrators) for delegate. **Effort:** M.
- **Fix:** Show account name in the card header; show delegate and write-folder in the visible summary when requested; add a Deny that marks the request refused (server change); distinguish drives with id suffix or date; make the done card say what was granted; fix the CLI error to say "tick 'Let this agent add other agents'" and to re-run `login --name` (F-050-02).
- **Acceptance:** account name visible without expanding Details; Deny ends the CLI wait with a distinct message; the done card lists scopes and folder; picker rows unique.
- **Files:** `apps/web/app/(app)/connect/connect.tsx`, `apps/web/src/api/device.ts`, `packages/agent-drive/src/cli.ts`, `packages/agent-drive/src/device.ts`.
- **NEEDS DESIGN** (new Deny state, summary layout). Keep the desktop card hierarchy; do not redesign it.

### C6. Approving before a grant, or re-logging in with an existing name, silently creates a new empty drive

- **Root cause:** A login request that expects a grant looks identical to a fresh one; a reused agent name with no saved key shows "New encrypted drive" with no notice.
- **Found by:** W F-043-01 (high), F-SETUP-021-01 (high), F-043-03, F-043-04 (partly), F-050-02; F J/J4.md proposal 1.
- **Surfaces:** /connect, CLI. **Severity:** P1 (produces a duplicate drive the user does not realise exists; observed twice). **Reach:** Subset (second agent, lost-config recovery). **Effort:** M.
- **Fix:** On /connect, when the account already has an agent of that name or a pending grant, say so in the summary line; on the CLI, tell a new agent to wait for a grant. Distinguish unknown-pairing-code from verification-code errors in `grant`.
- **Acceptance:** re-login with an existing name shows a notice before Approve; approve-before-grant shows a warning; `grant` with an unknown pairing code names the pairing code.
- **Files:** `apps/web/src/api/device.ts`, `apps/web/app/(app)/connect/connect.tsx`, `packages/agent-drive/src/cli.ts`.
- **NEEDS DESIGN.**

### C7. "Settings" does not exist

- **Root cause:** CLI and dialogs name a console "Settings" page; the sidebar has no such item and the settings route is titled "Activity & deletion" with the passphrase card as an off-topic block linking back to Files.
- **Found by:** W F-SETUP-016-01, F-SETUP-035-01 (high), F-SETUP-036-02, F-SETUP-061-2; F redundancy "Hierarchy 3"; V first-run F04 (P1, DOM check "nav has Settings: false"), V agents-keys F14, F16.
- **Surfaces:** CLI, console, llms.txt. **Severity:** P1 (instruction points to a place that is not there; measured). **Reach:** Subset (owners with a passphrase) but it is printed to every user after login. **Effort:** S.
- **Fix:** Say where the control really is ("Files, key chip menu, Set up passphrase unlock") in `account-seal.ts:31`, `account-seal.ts:86`, `unlock-dialog.tsx:242`, `llms.txt/route.ts:160`. Optional later: move the passphrase card out of Activity & deletion.
- **Acceptance:** `git grep "under Settings"` returns nothing in `packages/` and `apps/web/app`; every named location exists in the sidebar or menu.
- **Files:** `packages/agent-drive/src/account-seal.ts`, `apps/web/app/(app)/console/unlock-dialog.tsx` (llms.txt line goes with C1's change).
- **QUICK FIX.**

### C8. Account-key fingerprint hand-off is manual and error-prone

- **Root cause:** The console knows the fingerprint but shows it as small grey prose with no Copy button; the generated seal command lacks `--fingerprint`; a trailing comma from the sentence is rejected by the CLI with a generic message.
- **Found by:** W F-SETUP-035-02, -03, F-SETUP-036-01, -03, F-SETUP-041-04; F J/J3.md proposal 1.
- **Surfaces:** console, CLI. **Severity:** P2. **Reach:** Subset. **Effort:** M.
- **Fix:** Put fingerprint plus Copy in the passphrase-success notice and key menu; include `--fingerprint` in the copied command; make the CLI trim punctuation.
- **Acceptance:** one copy of the command seals the account with state "verified" on first run; fingerprint with trailing comma accepted.
- **Files:** `apps/web/app/(app)/console/console.tsx`, `apps/web/app/(app)/console/unlock-dialog.tsx`, `packages/agent-drive/src/account-seal.ts`.
- **NEEDS DESIGN** (small).

### C9. Two backup records, forced backup before `check`, and scattered backup guidance

- **Root cause:** Console `key_backup_at` and CLI config track backup independently and disagree; `check` demands a CLI backup even for agents that were granted a drive or received an env bundle; backup advice appears as three routes with no default and a second competing passphrase instruction.
- **Found by:** W F-043-04, F-044-05, F-SETUP-034-01, F-015-2, F-SETUP-026-F3, -F4, SETUP-027-F2, F-009-6, F-049-01, F-045-02; F redundancy "Duplicate Paths 4", "Duplicate Information 3, 5"; F J/J4.md proposal 2.
- **Surfaces:** CLI, console. **Severity:** P1 (the first `check` fails and the console shows "backed up" at the same time; observed in three walks). **Reach:** Most (every agent hits the backup gate; the contradiction hits second agents and the human-first path). **Effort:** M.
- **Fix:** Pick one source of truth, or let `check` pass or say "optional" for granted and env-bundle agents; show one next step after login (backup only); show human labels not "(env)", "(stdout)".
- **Acceptance:** after `grant --verify` + approval, `check` on the new agent does not fail on backup, or the output says why and how to proceed in one step; console and CLI show the same state after a console recovery-file save.
- **Files:** `packages/agent-drive/src/check.ts`, `packages/agent-drive/src/credentials.ts`, `apps/web/src/api/handler.ts`, `apps/web/app/(app)/console/key-chip.tsx`.
- **NEEDS DESIGN.**

### C10. CLI backup, export and import error messages leave out the working route

- **Root cause:** Each error message was written for one path; none points to the `--stdout | STORE && confirm` route used by sandboxes or names `AGENT_DRIVE_CREDENTIALS`.
- **Found by:** W F-SETUP-026-F1, -F2, -F5, SETUP-027-F1, -F3, SETUP-028-F1, -F2, -F3, F-SETUP-033-F1, -F2, -F3, F-044-04, F-SETUP-029-F2, -F3, F-044-09; F J/J4.md proposal 3.
- **Surfaces:** CLI. **Severity:** P2. **Reach:** Most (backup is mandatory). **Effort:** S.
- **Fix:** Error messages list all working routes with a recommended default; name the file written and warn about repo/synced folders; make the bundle import accept the `AGENT_DRIVE_CREDENTIALS=` prefix or say to drop it; one wording for "outside the repo/sandbox"; warn that unpiped `--stdout` in an agent shell writes into the transcript.
- **Acceptance:** each listed error includes the `--stdout` route or a pointer to it; pasting the full `NAME=value` line imports or fails with a message naming the prefix.
- **Files:** `packages/agent-drive/src/credentials.ts`, `packages/agent-drive/src/backup-targets.ts`, `packages/agent-drive/src/check.ts`.
- **QUICK FIX** (message text; 3 files).

### C11. The console's recovery file cannot be imported by the CLI

- **Root cause:** Two formats do one job: the console recovery file (`agent-drive-key-v1`) and the CLI credentials bundle (`adcred1`). `credentials import --from agent-drive-<id>.key.json` fails with "Not a valid Agent Drive credentials bundle." and does not say which format is accepted.
- **Found by:** W F-015-1 (high), F-015-4, F-SETUP-039-03, F-SETUP-022-03; F redundancy "Duplicate Paths 2", "Overlapping Features 2", "Naming 4"; F J/J2.md proposal 3.
- **Surfaces:** CLI, console, /connect. **Severity:** P1 (the human-first branch offered on the first-run page ends in a dead end; observed; SETUP-015 status fail). **Reach:** Subset (human-first users), but it is the second option on the first-run screen. **Effort:** M.
- **Fix:** Make `credentials import` accept the recovery file (key only, then login for API credentials), or make the console offer the adcred1 bundle for human-first setups; at minimum, make the error name the accepted format and list `AGENT_DRIVE_KEY` in `--help`. Name the file "drive key file" everywhere.
- **Acceptance:** a drive created in the console and saved as a recovery file can be given to a fresh CLI home with one documented command and `check` reports ok.
- **Files:** `packages/agent-drive/src/credentials.ts`, `apps/web/src/console/credentials-bundle.ts`, `apps/web/app/(app)/console/console.tsx`.
- **NEEDS DESIGN.**

### C12. Device-login errors are bare (rate limit, wrong API URL)

- **Root cause:** `device.ts` surfaces server codes directly: `Agent Drive refused the login request: slow_down` (`packages/agent-drive/src/device.ts:137`). "slow_down" is also the polling term inside the same module (line 191). A URL without `/api` returns bare 404; "Ignored a different API URL returned by the server." has no explanation.
- **Found by:** W F-011-1, F-SETUP-021-02, SETUP-027-F4, F-050-03 (message only), F-SETUP-035-08, F-SETUP-067-1, SETUP-030-F1, F-SETUP-006-1, F-009-4, F-009-5, F-044-01, -02, F-SETUP-016-03, F-SETUP-034-08, F-SETUP-051-03, SETUP-026-F6.
- **Surfaces:** CLI. **Severity:** P2. **Reach:** Subset (shared-IP sandboxes, CI; URL typo). The lockout duration is a review artifact and is not counted. **Effort:** S.
- **Fix:** Map `slow_down` at start to "Too many login attempts from this network (limit: 20 per hour per IP). Wait and retry; this is not an error in your setup." On 404, print the URL tried and "the API URL normally ends in /api". Explain the ignored-URL line or drop it for local origins.
- **Acceptance:** a login start rejected for rate limit prints the words "rate limit" and the stated limit; a 404 prints the URL tried and the `/api` hint.
- **Files:** `packages/agent-drive/src/device.ts`.
- **QUICK FIX.**

### C13. Console first-run shows concepts before they matter, and repeats itself

- **Root cause:** The Files header offers passphrase unlock to an account with no drive; "Agent-only" appears in drive creation before passphrase unlock is explained; the receipt dialog repeats one sentence twice; the header subtitle truncates at 768px.
- **Found by:** W F-SETUP-003-2, F-015-6, SETUP-032-F1, F-SETUP-004-2, F-SETUP-034-07, F-SETUP-040-03, F-047-03, F-047-05, F-009-6; F redundancy "Duplicate Information 4, 6", "Naming 7"; V first-run F05, F11, F03, F10.
- **Surfaces:** console. **Severity:** P2. **Reach:** All (first-run page). **Effort:** S.
- **Fix:** Hide the passphrase banner until a drive exists; remove or explain the Agent-only checkbox ("this drive always needs its recovery file"); delete the second "Without it nobody..." sentence; limit drive name length; fix the "Ready for your first file. Connect an agent..." text after an agent is connected.
- **Acceptance:** a new account sees one call to action on Files; `console.tsx` has one occurrence per dialog of the recovery sentence; a 201-character drive name is rejected or counted.
- **Files:** `apps/web/app/(app)/console/console.tsx`.
- **QUICK FIX** (small conditional logic on the banner).

### C14. Console load-failure card can get stuck

- **Root cause:** Dismiss on the red error line changes the card to "Opening your workspace..." with no retry (`console.tsx:2833`); the same failure is also stated twice with three recovery controls.
- **Found by:** W F-SETUP-005-1 (high, reproduced twice), F-SETUP-005-2; V first-run F13.
- **Surfaces:** console. **Severity:** P2 (impact high, reach low: needs a network failure). **Reach:** Subset. **Effort:** S.
- **Fix:** Dismiss only hides the line; keep Try again visible; one error statement; one retry control.
- **Acceptance:** with `/api/console` blocked, Dismiss then unblock leaves a card with a working retry; the error text appears once.
- **Files:** `apps/web/app/(app)/console/console.tsx`.
- **QUICK FIX.**

### C15. API keys and Agents tabs give stale or contradictory setup guidance

- **Root cause:** The API keys panel still says "Run the CLI from the repository after building it" with origin-only `--api` (`console.tsx:3879`); after "New agent" the notice says "Create an API key to connect it" while the tab says "Create a drive first." and a disabled button with no reason (`console.tsx:3776`, `4419`); completing the recovery file dialog moves the user to Files.
- **Found by:** W F-015-3, F-044-06, F-047-01, -02, -07, F-044-07, -08, F-045-03, -04; F redundancy "Overlapping Features 4"; V agents-keys F2 (P1), F3, F4, F5, F11, F12, F13.
- **Surfaces:** console. **Severity:** P2. **Reach:** Subset (manual API-key path; 19 actions measured, SETUP-047). **Effort:** S for text, M for continuity.
- **Fix:** Replace the panel text with the npm install and `login --token-stdin` command shown in docs; show the reason next to a disabled button; show the exact command in the key receipt; return the user to API keys after the receipt.
- **Acceptance:** no mention of "repository after building"; a disabled "+ New API key" states why; the notice does not contradict the tab.
- **Files:** `apps/web/app/(app)/console/console.tsx`.
- **QUICK FIX** (text); return-to-tab is DESIGN-lite.

### C16. Console Codex MCP snippet is incomplete

- **Root cause:** The snippet is the bare three-line server block; `/docs/mcp-tools` and llms.txt include per-tool approval blocks.
- **Found by:** W F-048-01 (high), F-048-02, F-048-03.
- **Surfaces:** console, docs. **Severity:** P2. **Reach:** Subset (Codex users). **Effort:** S.
- **Fix:** Copy the docs snippet (or a link) into `ConnectAgentBody` and list the mutating tools.
- **Acceptance:** console Codex snippet equals the documented one; `put` succeeds under `codex exec` with the pasted config (re-walk of SETUP-048).
- **Files:** `apps/web/app/(app)/console/console.tsx`.
- **QUICK FIX.**

### C17. Passphrase and key-lock model is hard to understand and leaves stuck users without a route

- **Root cause:** "Lock" locks the tab only; "Lock this browser" is adjacent with no explanation; "Keep this browser unlocked" is ticked by default with no consequence text; the Unlock dialog has no reset route and "Use a recovery file instead" loops back; the chip says green "Unlocked" with nothing added; seven same-weight buttons in the menu; a passkey step that cannot be closed.
- **Found by:** W F-SETUP-042-01, -02, -03, F-SETUP-038-01..04, F-SETUP-035-04, -05, F-SETUP-037-01, -02, F-SETUP-040-02, F-SETUP-041-01, -03, -04, SETUP-060-1; F J/J3.md (verdict convoluted), redundancy "Naming 6", "Hierarchy 6"; V first-run F06, F07, F12.
- **Surfaces:** console. **Severity:** P1 (three high findings; a locked-out owner cannot find reset; observed). **Reach:** Subset (owners who set a passphrase). **Effort:** L.
- **Fix:** Add "Forgot passphrase?" to the Unlock dialog; post-reset message with the `account seal --repin` command; make Lock match what it says or merge the two; explain the default; group routine and rare actions; make the passkey spinner cancelable.
- **Acceptance:** from the Unlock dialog, reset is reachable in one click; after reload, Lock leaves the chip in the locked state or the label says "this tab only"; Esc closes the passkey step.
- **Files:** `apps/web/app/(app)/console/unlock-dialog.tsx`, `apps/web/app/(app)/console/key-chip.tsx`, `apps/web/app/(app)/console/vault-forms.tsx`.
- **NEEDS DESIGN.** Not walked: success paths of passkey and second laptop (SETUP-037).

### C18. Load-key dialog is a jargon wall with the slow route first

- **Root cause:** Five recovery routes in one dialog, in an order that puts the slower account-seal route first, with terms the user has not met ("account seal --drive <uuid>", "unverified"), plus an agent-only text that says "ask the agent that created this drive" when the drive was created in the browser. A long drive name pushes the Close button 581px outside the dialog.
- **Found by:** W F-SETUP-039-01, -02, -03, F-SETUP-040-01, F-SETUP-061-1, F-SETUP-062-1, F-SETUP-061-2; F redundancy "Overlapping Features 2"; V first-run F04 (P1), F02 (P1), F03.
- **Surfaces:** console. **Severity:** P1 (visual P1; the dialog is the only way back in for a key-needed drive). **Reach:** Subset. **Effort:** M.
- **Fix:** Lead with "choose recovery file" and one agent command; hide the rest; wrap the title; limit drive name length (also C13).
- **Acceptance:** file route first; no CLI flags shown unless expanded; Close visible with a 200-character name.
- **Files:** `apps/web/app/(app)/console/unlock-dialog.tsx`.
- **NEEDS DESIGN.**

### C19. Trace capture: naming, token warnings, stale tab, wrong-key acceptance

- **Root cause:** Same action has three labels plus a neighbouring "Traces" button; Replace and a second tab's Add silently revoke the live token; a wrong-key file is accepted at unlock then fails in the Capture dialog; setup silently creates an `openrouter` agent.
- **Found by:** W F-SETUP-059-1..4, F-SETUP-064-1, F-SETUP-066-1, F-SETUP-068-1, F-SETUP-061-1, F-SETUP-062-1, SETUP-060-1; F J/J6.md; F redundancy "Naming 5".
- **Surfaces:** trace capture, console. **Severity:** P2. **Reach:** Subset. **Effort:** M (S for naming and Replace warning).
- **Fix:** Rename toolbar "Set up trace capture" and "View traces"; add "The old token stops working immediately" confirmation to Replace; move the one-time token block to the top; explain the `openrouter` agent; verify the key against the drive at unlock.
- **Acceptance:** one label for the opener in toolbar, menu and dialog; Replace requires confirmation naming the consequence; stale tab shows the current state.
- **Files:** `apps/web/app/(app)/console/traces-dialog.tsx`, `apps/web/app/(app)/console/drive-menu.tsx`, `apps/web/app/(app)/console/console.tsx`.
- **QUICK FIX for the naming and Replace warning part; NEEDS DESIGN for stale-tab and wrong-key.**

### C20. Finder / Instabox dead ends

- **Root cause:** Mount code reports raw system errors; Instabox is undefined; help text lists impossible options; a failed `--persist` leaves state.
- **Found by:** W F-SETUP-051-01 (high), -04, F-SETUP-055-01..04, F-SETUP-056-01, -02, F-SETUP-057-01, F-SETUP-054-01; F J/J5.md proposal 1.
- **Surfaces:** CLI, Finder/desktop. **Severity:** P2 (one high-severity finding, but narrow reach). **Reach:** Subset. **Effort:** S (messages), M (persist rollback).
- **Fix:** Missing app: "Agent Drive.app is not installed. Download: <url>. Drag to /Applications and open once." Define "Instabox workspace" and link it; remove `--sandbox` from `mounts add` help; roll back registration on failed `--persist` or print `mounts forget NAME`.
- **Acceptance:** `agent-drive mount` on a Mac without the app prints the install URL; no raw system errors.
- **Files:** `packages/agent-drive/src/mount-mac.ts` (missing-app message), `packages/agent-drive/src/cli.ts` (help text).
- **QUICK FIX for the missing-app message (1 file); NEEDS DESIGN for the rest.** Success path never observed.

### C21. Finder app is undiscoverable and the CLI docs bury it

- **Root cause:** One dense ~9-line paragraph inside a 19,286px page; absent from landing, docs index, sidebar, console and llms.txt. Same paragraph says "signed" and "does not sign".
- **Found by:** W F-PROD-01-4, -5, F-SETUP-051-02, F-SETUP-055-04; V prod-public PP1, PP3, PP4; F redundancy "Hierarchy 4"; F J/J5.md proposal 3.
- **Surfaces:** website, console, Finder. **Severity:** P2. **Reach:** Subset. **Effort:** S.
- **Fix:** Rewrite the paragraph as numbered steps; resolve the signing contradiction; add one line on the docs index and in the console empty state.
- **Acceptance:** "Finder" appears in the docs index; the paragraph is split; no contradiction between "signed" and "does not sign".
- **Files:** `docs/cli.md` (then regenerate docs content).
- **QUICK FIX** (the console one-liner belongs with C13's `console.tsx` change).

### C22. Entry cues on the public site and sign-in

- **Root cause:** Hero never says sign-up is needed; hero CTAs compete (outline Copy prompt vs filled orange "Sign up free"); signed-out visitors following an approval link see a plain sign-in with no mention of the pending pairing; landing plan table disagrees with /pricing on downloads; quickstart order differs from llms.txt; docs index has no "start here".
- **Found by:** W F-SETUP-001-1, F-010-1, -2, -4, F-PROD-01-1, -3, -6, -7, -8, -9, F-SETUP-002-1 (local build only, see Not verified), F-SETUP-007-1, F-014-2, -3, -4, F-PROD-01-10; V prod-public PP2, PP5, PP6, PP7, PP11; F redundancy "Duplicate Information 1".
- **Surfaces:** website, sign-in. **Severity:** P2. **Reach:** All first-time visitors. **Effort:** S (copy), M (sign-in context needs Clerk configuration).
- **Fix:** Hero line "Free to start. Sign in when the link opens, then type the verification code."; one primary hero action; reconcile downloads figure; add Node 24 and `agent-drive login` to the hero terminal option; "Start here" on Quickstart in the docs index.
- **Acceptance:** landing and /pricing show the same downloads statement; docs index marks Quickstart as the first step.
- **Files:** `apps/web/src/content/home.ts`, `apps/web/src/content/pricing.ts`.
- **QUICK FIX for copy** (files share `home.ts` with C1; merged in the fixes file); sign-in context is NEEDS DESIGN.

### C23. Skill install is inconsistent

- **Root cause:** llms.txt makes it required step 5; quickstart makes it optional step 7; `--target DIR` writes a different layout; exit 0 when nothing was written; overwrite is silent; `skill --help` prints the whole CLI help.
- **Found by:** W SETUP-031-F1..F5, F-009-3; F redundancy "Duplicate Paths 6".
- **Surfaces:** CLI, docs. **Severity:** P2. **Reach:** Most. **Effort:** S.
- **Fix:** Pick one status (required or optional); exit non-zero when nothing was written or print the fallback clearly; document the `--target` layout; scoped help.
- **Acceptance:** the two docs agree; `skill install` with no agent dir exits non-zero.
- **Files:** `packages/agent-drive/src/cli.ts`, `packages/agent-drive/src/skill.ts`.
- **QUICK FIX** (docs part rides with C1).

### C24. Revoke and lifecycle copy omits what matters

- **Root cause:** Revoke dialogs do not warn that a leaked sandbox bundle also holds the drive key, which revoking the API key does not invalidate; revoked sandboxes see a backup warning before the real error; revoked agent rows stay and still count.
- **Found by:** W F-045-01, -02, -03, -04, F-044-08.
- **Surfaces:** console, CLI. **Severity:** P2. **Reach:** Subset. **Effort:** S.
- **Fix:** One sentence in the revoke dialogs; show the revoked error first; add "This cannot be undone." to the agent dialog.
- **Acceptance:** revoke dialog text includes the drive-key sentence; revoked sandbox error is first.
- **Files:** `apps/web/app/(app)/console/console.tsx`, `packages/agent-drive/src/check.ts`.
- **QUICK FIX** (console part merged into the C13 item; `check.ts` is in C10's item).

### C25. Polish: targets, scale, spacing, keyboard (P3)

- **Root cause:** Many controls under 24px, off-scale spacing values (measured 3, 5, 6, 9, 10, 11, 14, 18), no skip link (11 Tab presses to the main action, measured), dead band under the empty Files panel (400px, measured), tracked all-caps revoke titles up to 5 lines.
- **Found by:** V first-run F09, F10, F14, F15, F17, F18; V agents-keys F9, F10, F17, F19, F20, F24, F25, F26; V connect F13, F14, F15; V prod-public PP8, PP9, PP10; W SETUP-029-F1, -F4, F-SETUP-036-04.
- **Severity:** P3. **Reach:** All, low impact. **Effort:** M across the set. **Fix:** batch by file when a related change is open. **Acceptance:** audit smallTargets empty on the setup pages.
- **Files:** `apps/web/app/styles/console.css`, `apps/web/app/styles/console-panels.css`, `apps/web/app/styles/connect.css`.
- **Not queued as quick fixes** (large, low value, many files).

---

## 3. Ranked list

Score = severity weight (P1 = 4, P2 = 2, P3 = 1) x reach (All = 3, Most = 2.5, Subset = 1) x centrality (on the main first-run path = 1.5, side path = 1) / effort (S = 1, M = 2, L = 4). Weights are my judgement, not measured; use them for ordering only.

| Rank | Cluster                          | Score | Sev | Reach                        | Effort | Type         |
| ---- | -------------------------------- | ----- | --- | ---------------------------- | ------ | ------------ |
| 1    | C1 Approval wording              | 18    | P1  | All                          | S      | QUICK        |
| 2    | C2 Invisible Copy buttons        | 15    | P1  | Most                         | S      | QUICK        |
| 3    | C3 /connect layout               | 15    | P1  | Most                         | S      | QUICK        |
| 4    | C5 /connect hidden info and Deny | 9     | P1  | All                          | M      | DESIGN       |
| 5    | C13 Console first-run clutter    | 9     | P2  | All                          | S      | QUICK        |
| 6    | C22 Public site cues             | 9     | P2  | All                          | S      | QUICK (copy) |
| 7    | C9 Backup state                  | 7.5   | P1  | Most                         | M      | DESIGN       |
| 8    | C10 CLI backup messages          | 7.5   | P2  | Most                         | S      | QUICK        |
| 9    | C7 "Settings" does not exist     | 6     | P1  | Subset (text printed to all) | S      | QUICK        |
| 10   | C23 Skill install                | 5     | P2  | Most                         | S      | QUICK        |
| 11   | C11 Recovery file import         | 3     | P1  | Subset                       | M      | DESIGN       |
| 12   | C12 Device-login errors          | 3     | P2  | Subset                       | S      | QUICK        |
| 13   | C4 /connect messages             | 3     | P2  | Subset                       | S      | QUICK        |
| 14   | C6 Approve-before-grant          | 2     | P1  | Subset                       | M      | DESIGN       |
| 15   | C14 Stuck failure card           | 2     | P2  | Subset                       | S      | QUICK        |
| 16   | C15 API keys / Agents copy       | 2     | P2  | Subset                       | S      | QUICK        |
| 17   | C16 Codex MCP snippet            | 2     | P2  | Subset                       | S      | QUICK        |
| 18   | C18 Load-key dialog              | 2     | P1  | Subset                       | M      | DESIGN       |
| 19   | C20 Finder / Instabox dead ends  | 2     | P2  | Subset                       | S      | split        |
| 20   | C21 Finder discoverability       | 2     | P2  | Subset                       | S      | QUICK        |
| 21   | C24 Revoke copy                  | 2     | P2  | Subset                       | S      | QUICK        |
| 22   | C25 Polish                       | 1.5   | P3  | All                          | M      | batch later  |
| 23   | C19 Trace capture                | 1     | P2  | Subset                       | M      | split        |
| 24   | C17 Passphrase and lock model    | 1     | P1  | Subset                       | L      | DESIGN       |
| 25   | C8 Fingerprint hand-off          | 1     | P2  | Subset                       | M      | DESIGN       |

Ties are broken by whether the failure is a dead end. C17 ranks low only because of effort; do its "Forgot passphrase?" link as the first slice.

Cluster counts by severity: **P0 0, P1 10 (C1, C2, C3, C5, C6, C7, C9, C11, C17, C18), P2 14 (C4, C8, C10, C12, C13, C14, C15, C16, C19, C20, C21, C22, C23, C24), P3 1 (C25)**. Total 25.

---

## 4. Already excellent or minimal (no change needed)

- Agent-first happy path step count: 4 human touches against 4 ideal (SETUP-009, 016; J/J1.md). Do not add steps.
- `/connect` desktop card hierarchy: one dominant orange "Approve agent", one-line summary, revoke note (`W/SETUP-013/screenshots/step-1.png`; V/connect "Excellent as is"). Fix only C3, C4, C5.
- Console onboarding hero at 1440 and 1280: one orange Copy, three steps, no page scroll (`W/SETUP-003/screenshots/step-3-onboarding.png`; V/console-first-run). The only change is removing the competing passphrase line (C13).
- Verification-code errors: inline, role alert, keep the value, return focus. "This code does not match the one your agent printed. Check the terminal again and type it exactly." (V/connect, `shots/err-wrongverif-1440-vp.png`).
- Rate-limit state on /connect: "Too many device code attempts. Wait 10 minutes and try again." (V/connect).
- Signed-out redirect keeps `redirect_url`/code through sign-in and sign-up (W F-006-2 context, SETUP-018; V/connect). Reaching the approval page: printed link, `--no-browser` and bare `/connect` all converge (SETUP-016, 017; redundancy "already minimal").
- Quickstart numbered checklist; sign-up page; pricing page; no horizontal overflow at four viewports on public pages (V/prod-public).
- Create-a-drive, Create-agent and Create-key dialogs; save-secret dialog (one-time warning, "I saved my API key securely" gates Done); revoke dialogs default to Cancel and list consequences (V/console-agents-keys "Excellent as is").
- Revoke path: 3 steps, 3 clicks, ideal 3 (SETUP-045; J/J4.md).
- CLI messages praised: "Refusing to print credentials to a terminal. Pipe them...", duplicate-name and `--force` guards, "The API key needs the delegate scope." (J/J4.md "Already minimal").
- Package name and install command identical on every surface (PROD-01, PROD-03; redundancy "Already consistent").
- Trace capture click counts equal ideal; auto-resume after unlock; revoke confirm (J/J6.md "Already good").
- Delete drive/account buttons are disabled with the reason written under them (V/console-agents-keys).
- Sign-up entry points all go to `/sign-up`; duplicates are placements of one route (redundancy "Duplicate Paths", last note). Leave.

---

## 5. Not verified (and why)

- **Clerk sign-up, sign-in, email verification, and Clerk reverification** (SETUP-003, 006, 018, 037, 041, 059, 063, 065): the local build has no Clerk; the test session was used. The timing of sign-up against the 10-minute code lifetime is unknown (J/J1.md). Account selection with two real accounts was not walked (SETUP-025; the test session shows "Local test session" for every user).
- **The first `agent-drive put` after approval** was not walked in any J1 story; walks stop at `check ok`.
- **Real clipboard contents** (SETUP-001, 026) and **Apple Passwords / 1Password flows** (SETUP-028: `op` install, locked vault): headless, no clipboard or 1Password.
- **Recovery-file download to disk** (SETUP-004): not verifiable headless.
- **Finder app, File Provider, Instabox, Linux FUSE, Windows** (SETUP-051 to 058): not installed or wrong host OS (macOS Studio). No success screen of the Finder path was observed; the "Finder app" verdict is about failure paths and discoverability only.
- **SETUP-030 (read-only reviewer), SETUP-050 steps 2-6, SETUP-032 console chip parts, SETUP-038 to 040 agent steps, SETUP-067 real capture run**: blocked by the review's own device-login rate limit (see header note) or by shared test-session cookies overwritten by other walkers (SETUP-032-F2). The affected agent halves are unobserved.
- **Passkey device prompt and second laptop** (SETUP-037) and **passphrase success path in the visual review** (V/console-first-run run notes).
- **Share download in the browser** (SETUP-029-F5): the page fetched from a local object store the browser could not reach.
- **Pricing/billing wording** F-SETUP-002-1 ("Paid checkout is not enabled on this deployment...", self-host language) was observed on the local build. The prod `/pricing` walk (PROD-02) says "clear and clean", so this is not claimed as a prod defect.
- **Geometry-audit `wrappedControls` flags** were judged false positives by the walker (F-GEO-1) and are not ranked.
- **Capture dialog visual review**: `V/capture-dialog/` contains `audit.json` and screenshots but no `findings.md`, so no visual-review findings from that page were consolidated; trace capture rests on the walker and flow reviews.
- **Shared-environment contamination**: two visual reviewers and several walkers overwrote shared helper scripts and sessions (V first-run run notes, W F-ENV-1, F-SETUP-032-F2). Any finding inconsistent with a sibling's may be affected; I did not re-walk anything.
- **Local-only artifacts, suspected**: "Ignored a different API URL returned by the server." and the bare-origin 404 may be local-dev routing differences (walker said "possibly", F-044-01). The fix in C12 is still low risk, but the 404 may not occur on the production API.

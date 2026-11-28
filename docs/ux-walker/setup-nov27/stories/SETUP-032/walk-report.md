# SETUP-032 Finish setup end to end and watch the console chip change - walk report

Status: PARTIAL. The end-to-end run needs a fresh device login whose approval, backup, skill install, check and first put all belong to one account, then the console chip and unlock dialog for that same account. Three blockers:
1. Device login starts are rate-limited per IP (20 per hour, shared by every walker); `agent-drive login` returned `Agent Drive refused the login request: slow_down` for about 35 minutes.
2. The browser cookie jar is shared with other walkers: the test-session cookie gets overwritten, so the console showed another persona's drive ("priya-agents", a Capture traces dialog) and the first pairing I approved attached to a different user than the one I set. Console chip and file preview for my agent could not be trusted.
3. File download/preview in the browser fetches from 127.0.0.1:9811 (local object store), unreachable from the browser (see SETUP-029).

What was walked, by sibling stories on the same CLI and server:
- Step 1 (export to a file): SETUP-028 (`Backed up credentials for 1 drive(s) (file).`). Aisha's path `~/Documents/...` fails when Documents does not exist: `Unable to write <path>.` (SETUP-027 F1).
- Step 2 (/connect then console): /connect pairing and done pages walked in SETUP-026 (screenshots there). The done page text "Return to your agent to finish setup and confirm it is ready." plus an `Open console` link, and no mention of backup. New-user console empty state (this story, screenshots/step-0-console-new-user.png, step-0-console-new-user-mobile.png): "CONNECT YOUR AGENT / Give your first agent a home." with the copyable line `Set up Agent Drive: http://localhost:3811/llms.txt`, three numbered steps and a `New drive` button. Clean at 1280 and 390 wide (geometry: no overflow; the three-step list has uneven item widths 190/204/134 which is intentional inline text). The Files header carries "Set a passphrase and agents will add every drive's key to your account ... Set up" before any agent or drive exists, competing with the one clear next action. Neither the console nor the done page mentions the credentials backup that `check` requires.
- Step 3 (skill install): SETUP-031. Step 4 (check ok): SETUP-026/027/028. Steps 5-6 (put/get/cmp): SETUP-029, all passed.
Not walked: console chip text `Key needed` / `Not backed up` / `Key backed up <date> (<method>)`, refresh behavior, unlock dialog with a recovery file, passphrase banner (steps 2, 7, 8, 9), and the `reportKeyBackup` failure case. The console label `(stdout)` for 1Password/clipboard users (contradiction 3 in the story file) remains unverified in the UI; the CLI side records method `stdout` for those routes (SETUP-026 F2).

## Flow Log
- Steps specified 9 in the Ideal path; CLI-side steps all needed exactly the specified commands. Console steps not walked.
- Hesitations: terminal prints two next steps at login (backup vs passphrase); console shows the passphrase prompt before any agent exists.

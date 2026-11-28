# SETUP-026 Back up by clipboard and confirm in Apple Passwords - walk report

Status: PARTIAL (clipboard copy and Apple Passwords paste are not walkable: the Studio account is headless, `pbcopy` fails over ssh).

Setup note: the instructed `AGENT_DRIVE_API_URL=http://localhost:3811` made `agent-drive login` fail with `Agent Drive refused the login request: 404`. `llms.txt` uses `--api http://localhost:3811/api`; with `AGENT_DRIVE_API_URL=http://localhost:3811/api` login works and prints `Ignored a different API URL returned by the server.` (environment artefact, logged as a low finding).

Step 1 - login (browser /connect, screenshots/step-1-connect.png, step-2-approved.png): pairing page is clear (code shown, verification code field, one orange primary button). Approved page says "Return to your agent to finish setup and confirm it is ready." Geometry: no overflow; only `summary "Details"` flagged as a wrapped control (false positive, single line). Terminal printed `Back up this agent's credentials ...` hint, then a second unrelated instruction `Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings`. Two competing next steps.

Step 2 - `agent-drive check` before backup: exit 1, `drive key not backed up: <id>` plus the full hint. Clear. `credentials status` -> `{"drives":{"<id>":{"backedUp":false}}}`. `credentials confirm` before export: `There is no matching credentials export to confirm. Run \`agent-drive credentials export\` first.` exit 1 (clear).

Step 3 - `credentials export --to clipboard` (and with `--keep-clipboard`): exit 1, `Could not copy to the clipboard with pbcopy. Nothing was exported. Use \`--to 1password\` or \`--to <a file outside the repo>\` instead.` Environment limitation (headless). Note the error does not offer the `--stdout | STORE && confirm` route either. Paste into Apple Passwords: not-walkable.

Step 4 - stand-in for the paste: `credentials export --stdout > pend.txt` (stderr `Exported. After the secret store has saved it, run \`agent-drive credentials confirm\`.`), then `credentials confirm` -> `Recorded the credential backup for 1 drive(s) (stdout).` `credentials status` -> backedUp true, method "stdout". `check` -> `check ok drive=<id>`. `whoami` keyBackup shows method "stdout". Note: a clipboard user is told the method is "stdout".

Other CLI copy: bare `credentials export` -> `Pass exactly one of --to <path> or --stdout.` (omits 1password and clipboard, which help lists first). `export --to` with no value -> `Option '--to <value>' argument missing` then usage.

Console: not usable for this story. The shared browser cookie was overwritten by other walkers running at the same time (console showed another persona's drive "priya-agents" and an unrelated Capture dialog), so the approval most likely attached the agent to a different test user. Console chip not judged here; see SETUP-032.

## Flow Log
- Steps specified: 4. Needed: export, (paste), confirm, check = 4 plus the login. Ideal path 3 reached except the clipboard wait.
- Hesitations: terminal prints two different "next" instructions after login (backup, passphrase). Bare `export` error hides the clipboard/1Password choices. `(stdout)` method label for a clipboard backup.
- Re-entry: none.
- Duplicated info: backup hint printed at login, in `check` failure (full repeat).

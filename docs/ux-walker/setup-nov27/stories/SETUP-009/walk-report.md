# SETUP-009 walk report: llms.txt line, existing account, happy path

Walker session: uxw-install-login-solo (the named session `uxw-install-login` was contaminated, see Notes). Account: e2e_install_login_9. CLI home: ~/uxw/install-login-009 (first run) and install-login-009b (clean rerun of login + browser).
Screenshots: `screenshots/step-N.png` (clean run); `screenshots/first-run-shared-session/` holds the first attempt (kept, not deleted).

## Steps
1. Home `/` hero. Screenshot first-run-shared-session/step-1.png: "Give this to your agent" panel with `Copy prompt`, hint "Free to start. Your agent shows a pairing code, and you approve it in your account." and "or in a terminal: npm install -g ...". LOOK: clean, one dominant CTA. Geometry: overflow 0; script hits are nav links/buttons flagged as "wrapped" but the screenshot shows single-line labels (false positives). Clipboard copy itself not exercised.
2. `/llms.txt` fetched with curl: index, then "## Set up (local agent with a shell)" steps 1-6. Served from localhost, so every command carries `--api http://localhost:3811/api` (expected on a non-public origin). Install step (npm) not-walkable here; CLI binary pre-built.
3. CLI `login --name "billing-api agent"` printed exactly the four lines (link, "Check that the code matches", "Verification code: 1a3d 945a a9d0 0db6", "Waiting for approval..."). Note: with `AGENT_DRIVE_API_URL=http://localhost:3811` (no /api) it printed only `Agent Drive refused the login request: 404`.
4. `/connect?code=` (step-2.png): tag "Pairing request", h1 "Connect billing-api agent?", "New encrypted drive · full access", collapsed Details, "Does this code match your terminal?" with big code, Verification code field, orange `Approve agent`. LOOK pass: one dominant action, good hierarchy. Geometry: overflow 0, no uneven rows.
5. Details opened (step-3.png): Machine, Account ("Local test session"), Drive, Access, Writes, Requested, plus link "Use one of my drives instead (needs its recovery file)" and checkbox "Let this agent add other agents to its drives". Clean.
6. Empty submit (first run): inline error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." Clear and recoverable. Field gets focus ring + red border.
7. Typed verification code, clicked `Approve agent` (step-4.png): "APPROVAL SAVED / Access approved for billing-api agent / ... Return to your agent to finish setup and confirm it is ready." + `Open console`. CLI finished within ~5 s: "Logged in as agent billing-api agent.", Usable drives, Scopes, Config, "New drive ... created", the backup paragraph, and a line "Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings...". Also printed "Ignored a different API URL returned by the server." with no explanation (probably local-origin artifact).
8. `agent-drive check` before backup: "drive key not backed up: <id>" + the three backup options, exit 1. Clear.
9. `credentials export --to 1password` with no `op`: "The 1Password CLI (`op`) is not installed. Nothing was exported. Install ... run this again." Clear. Clipboard path not-walkable (needs interactive macOS clipboard, and the human password manager).
10. `credentials export --to <file>` -> "Backed up credentials for 1 drive(s) (file)."; repeat -> "... already exists; pass --force to overwrite it." Good.
11. `skill install` with no ~/.claude or ~/.codex: "No ~/.claude or ~/.codex directory found. The skill is at ...; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>." exit code 0 although nothing was installed (finding). With `--target <dir>`: "wrote <dir>/SKILL.md".
12. `check` -> "check ok drive=<id>".
13. Console after Open console (step-5.png): Files, drive "billing-api agent", "Key needed · Not backed up" chip, empty state "Ready for your first file. Connect an agent with the CLI or MCP to upload encrypted files." Geometry: overflow 0; "Refresh / Connect an agent" row flagged, widths 85/148 (intentional primary/secondary). Chrome console: only HMR/React devtools info; no errors.
14. Mobile 390x844 on /connect (first-run-shared-session/mobile-check.png): no horizontal overflow, but the Verification code input is only ~165 px wide; the placeholder shows "a1b2 c3d4 e5f6" and the fourth group is cut off, so the user cannot see the whole 16-character code while typing.

## Flow Log
- Ideal path: 6 (human touches 4 times). Actual: paste line, relay link, open link, type code, click Approve = 5 human actions plus the agent's 6 CLI steps (install, login, export, skill, check). Matches the ideal; no extra screens.
- Hesitations: (a) the hero and console panel say "a pairing code ... click Approve" but the approve page requires a second, hidden 16-hex code; a human who reads only the website is surprised. (b) "Does this code match your terminal?" shows the 8-letter code, which is not the one to type; label "VERIFICATION CODE" next to it is the typed one. Two codes on one card.
- Re-entry: none. Duplicated info: backup instruction text repeated in login output and in `check` output (useful).
- Not walkable: npm install, Clerk, clipboard backup, 1Password success, Chrome auto-open (stdout not a TTY).

## Notes
`$scratchpad/ab.sh` is a shared filename that another walker overwrote with `--session uxw-owner-keys`; my first run's browser commands partly drove that other session (page jumped to /console with unrelated drives). I discarded that run's console evidence and redid login/approve/console in a private session.

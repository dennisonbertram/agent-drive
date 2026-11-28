# SETUP-011 walk report: sandbox agent, npx, --no-browser

Session uxw-install-login-solo, account e2e_install_login_11. CLI home ~/uxw/install-login-011. Device-login starts were rate-limited for about 55 minutes (see F-011-1), so this story was walked after the limit cleared. Not walkable here: a real Docker/CI container, EACCES on `npm install -g`, a real `npx -y ...@latest` (would download from the public npm registry; `npm view` shows 0.5.1 is published), Node < 24, browser auto-open suppression under `CI` (the test shell is not a TTY either way).

## Steps
1. `agent-drive --help` bottom lines: "Without installing: npx -y @dennisonbertram/agent-drive@latest <command>" and the global configuration list (AGENT_DRIVE_CONFIG, API_URL, API_KEY, MACHINE, CREDENTIALS). The npx fallback is discoverable from help and from llms.txt step 1.
2. First attempt, `CI=1 agent-drive login` (no name): "Agent Drive refused the login request: slow_down" (the 20-starts-per-IP-per-hour limit; many walkers share localhost). No wait time, no explanation of the limit, and the word `slow_down` (a polling term) is the whole message. The same text repeated for ~55 minutes on every attempt.
3. After the limit cleared: `agent-drive login --name research-bot --no-browser` printed link `http://localhost:3811/connect?code=VBJT-XQGF`, "Check that the code matches", "Verification code: 35cc cb0c 4a3f f751", "Waiting for approval..." (step-1 shows the page).
4. `/connect` for a signed-in owner on a separate machine (step-1.png): "Connect research-bot?", code matches the terminal, field for the verification code. Typed the code, Approve (step-2.png): "Access approved for research-bot ... Return to your agent to finish setup".
5. CLI finished: "Logged in as agent research-bot. / Usable drives / Scopes / Config / New drive created" and the backup paragraph. Unlike a laptop user, the sandbox agent now needs the 3-way backup choice; the first two (1Password, clipboard) make no sense in a container.
6. Sandbox persistence (docs/sandboxes.md route): `credentials export --stdout` printed "Exported. After the secret store has saved it, run `agent-drive credentials confirm`." then `credentials confirm` -> "Recorded the credential backup for 1 drive(s) (stdout)." then `check` -> `check ok drive=<id>`.
7. A fresh home with only `AGENT_DRIVE_CREDENTIALS` set: `check ok drive=<id>` (no login, no approval). A fresh home with nothing: "API configuration is missing. Run `agent-drive login` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY." (exit 1) and the same for `ls`. Clear and actionable.
8. Variation not walked: default agent name (`<hostname> agent`); the 009 run shows the Details "Machine" row names the host, which a sandbox owner could use.

## Flow Log
- Ideal 5; actual 5 human/agent actions once login started (npx login, relay link+codes, human types code and approves, agent continues).
- Hesitation: none on the web; in the terminal the post-login output offers 1Password/clipboard first, which a sandbox cannot use; llms.txt step 4 does list `--stdout` only in the Sandboxes section.
- Duplicated info: the backup paragraph is repeated by login and by `check`.
- Mobile: the same /connect page was checked at 390x844 in SETUP-013 (verification input narrow, see F-009-2).

# SETUP-027 Run `check` before any backup - walk report

Status: PASS with findings (CLI). No browser screen, no screenshots apply.

Account: this story used the same freshly logged-in agent as SETUP-026 (a second device login was blocked by the server limit, see SETUP-026 F6 and finding F4 here). The "before backup" outputs below come from that agent before its backup; the backup and `check ok` steps were run on a copy of the home (backup-first-file-027).

1. `agent-drive check` before any backup -> exit 1, stderr `drive key not backed up: 19a2d2d3-...` followed by `Back up this agent's credentials before this machine or sandbox goes away: \`agent-drive credentials export --to 1password\` (1Password), \`agent-drive credentials export --to clipboard\` (copy, paste it into Apple Passwords or another password manager, then run \`agent-drive credentials confirm\`), or \`agent-drive credentials export --to <a file outside the sandbox, on a path that survives it>\`. Until then \`agent-drive check\` will not pass.\` Clear: names the problem, three fixes, and that check will not pass until then. `credentials status` -> `{"drives":{"<id>":{"backedUp":false}}}`.
2. `agent-drive credentials export --to ~/Documents/agent-drive-credentials.txt` on a home with no Documents folder -> exit 1 `Unable to write /Users/agent/uxw/backup-first-file-027/Documents/agent-drive-credentials.txt.` No reason (folder missing) and no hint (create the folder or pick another path). The story's happy path assumes Documents exists. With `--to ./x.txt` -> `Backed up credentials for 1 drive(s) (file).` exit 0.
3. `agent-drive check` after backup -> `check ok drive=<id>` exit 0. PASS.
   Edge cases: path exists -> `./cred.txt already exists; pass --force to overwrite it.` (seen in SETUP-028). `--to ./clipboard --force` writes a file named `clipboard` (works; the `./` hint exists only in the story). `check --drive <unknown>` -> `There is no key for drive 00000000-... on this machine.` (accurate, no pointer to `whoami`/`login`). A login-less home: `check` -> `API configuration is missing. Run \`agent-drive login\` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY.`; `credentials export`there ->`There is no API key to back up. Run \`agent-drive login\` first.`
Not walked: several drives (`More than one usable drive. Pass --drive ID.`), a path inside a project folder (CLI does not stop it per code comment; not exercised).

## Flow Log

- Ideal path 2 (export, check): reached in 2 commands after the refusal; refusal plus export plus check = 3.
- Hesitations: the refusal lists three options without recommending one for an impatient user; a failed ~/Documents write gives no recovery.
- Duplicated info: the hint block is the same text as the login hint and llms.txt step 4.

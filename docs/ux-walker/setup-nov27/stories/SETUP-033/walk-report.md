# SETUP-033 Keep a drive across disposable CI sandboxes - walk report

Status: PASS (CLI). Not walkable: the company secret manager and the CI platform secret UI (a plain file stood in for the secret store); Linux sandbox clipboard message (Studio is macOS, clipboard fails for a different reason). No browser screen in this story, so no screenshots.

Account: SETUP-026 agent home copied to backup-first-file-033 (the "laptop"). Sandboxes: three fresh homes (backup-first-file-033-sandbox1/2/3) with only AGENT_DRIVE_CREDENTIALS set.

1. `set -o pipefail; agent-drive credentials export --stdout | cat > secretstore.txt && agent-drive credentials confirm` -> stderr `Exported. After the secret store has saved it, run \`agent-drive credentials confirm\`.`then`Recorded the credential backup for 1 drive(s) (stdout).` exit 0. Matches story.
2. Read-back: file starts `adcred1.` (417 bytes). OK.
   Unpiped `export --stdout` on a TTY (ssh -tt): `Refusing to print credentials to a terminal. Pipe them to a secret store: \`agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm\`, or use --to <path>.` exit 1. Good. In a non-TTY shell (what an agent has) the same command just prints the 417-byte bundle; docs say "prints the bundle only when stdout is not a terminal", so the doc describes the guard but not that an agent's shell is not a terminal (agent transcript leak risk).
3. CI secret: not walkable.
4. Sandbox 1: `whoami` -> JSON with agent id, scopes, driveIds, `localDriveKeys` true, keyBackup method `env`. `credentials status` -> backedUp true, method `env`. PASS. No home config.json written; `.config/agent-drive/config.json.state/account-seal.json` is created (no secrets: pins and a checked timestamp). Matches the docs claim that the bundle is "never written to disk" for secrets.
5. `check` -> `check ok drive=<id>` exit 0.
6. `put ./report.md /outputs/nightly/report.md` -> JSON with id/path (folderUrl present in the story; cut in my view).
7. Sandbox 2 (empty home): `check ok`; `put` nightly report2.md; `ls --prefix /outputs` lists both files, so the second night sees the first night's file. PASS. A further empty home with AGENT_DRIVE_API_URL unset also gets `check ok`, so the bundle alone supplies the API origin.
   Failure cases: `AGENT_DRIVE_CREDENTIALS=adcred1.bogus` -> `AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.` (clear; does not say how to recover). Empty value -> `API configuration is missing. Run \`agent-drive login\` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY.`(does not mention AGENT_DRIVE_CREDENTIALS).`credentials export --to clipboard`in a sandbox ->`Could not copy to the clipboard with pbcopy. Nothing was exported. Use \`--to 1password\` or \`--to <a file outside the repo>\` instead.`(a sandbox user is told "outside the repo" although the doc says "outside the sandbox").
Not exercised (needs a second login or a changed key): re-login key change message;`credentials issue` (needs delegate scope, see SETUP-030).

## Flow Log

- Ideal path 6 (export+confirm, store secret, whoami, check, put). Needed 5 CLI commands in the sandbox plus the laptop export; no extra steps.
- Hesitations: none in the CLI; the docs ask the reader to know their secret-store command.
- Duplicated info: backup order repeated in the hint, docs and llms.txt.

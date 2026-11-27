# Setup stories: back up, check, first file, skill

> ID note: stories in this file now use catalog IDs SETUP-026 to SETUP-033 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-026, 02 = SETUP-027, 03 = SETUP-028, 04 = SETUP-029, 05 = SETUP-030, 06 = SETUP-031, 07 = SETUP-032, 08 = SETUP-033.


Topic: credentials export targets and confirm, `check` outcomes, first `put`/`get`/`share`, `skill install`.
Source: worktree `agent-drive-ux-setup` (CLI 0.5.1). Read from code only; nothing was run.
Key files: `packages/agent-drive/src/{cli.ts,credentials.ts,backup-targets.ts,check.ts,skill.ts,config.ts}`, `apps/web/app/llms.txt/route.ts`, `docs/{quickstart,backup-and-recovery,sandboxes,skills,sharing,console}.md`, `skills/agent-drive/SKILL.md`, `apps/web/app/(app)/console/{key-chip.tsx,console.tsx,share-dialog.tsx}`, `apps/web/app/s/[id]/share-client.tsx`.

## Facts shown on more than one surface

- Backup order "1Password, clipboard, file": `llms.txt` step 4, `docs/quickstart.md` step 4, `docs/backup-and-recovery.md`, `docs/skills.md`, `skills/agent-drive/SKILL.md`, CLI help (`cli.ts:1769`).
- `check` refuses until a backup exists: `llms.txt` step 6, `docs/quickstart.md` step 5, `BACKUP_HINT` (`credentials.ts:34`), CLI help `check` line (`cli.ts:1721`), `docs/sandboxes.md`.
- Backup state: CLI `credentials status` JSON and `whoami` `keyBackup`; console key chip `· Not backed up`, its menu text, and `Key backed up <date> (<method>)`.
- "Do not paste the bundle into chat": `llms.txt`, `SKILL.md`, `docs/console.md`.
- Share URL fragment `#k=` is a secret: `docs/sharing.md`, `docs/quickstart.md` step 6.

## Copy that contradicts or under-describes (file:line)

1. Skill order. `apps/web/app/llms.txt/route.ts:52` makes `agent-drive skill install` step 5, before `check` (step 6), and not optional. `docs/quickstart.md:90` lists it as "7. Optional: skill and MCP", after `check` and the first file.
2. Drive flag. CLI help (`cli.ts:1721` and the `put`/`get`/`share` help lines) writes `--drive ID` as if required. In code `requiredDrive` (`cli.ts:273`) falls back to the single saved drive (`resolveDriveId`, `config.ts:34`). `docs/quickstart.md` step 6 says to add `--drive` only with more than one drive. With several drives the error is `A --drive ID is required. Configured drives for this API: <ids>.`
3. Console backup label. `console.tsx:929` builds `Key backed up <date> (<method>)` from the raw method value. The method is `stdout` for 1Password and for `credentials confirm`, `file` for a file, `env` for a bundle. A person who used 1Password sees "(stdout)".
4. `BACKUP_HINT` (`credentials.ts:34`) lists 1Password, clipboard and a file but not `--stdout | STORE && credentials confirm`, the route that `docs/sandboxes.md` teaches. The `check` failure for a sandbox user points to a different route than the sandbox doc.
5. `--stdout` safety wording. `docs/backup-and-recovery.md` says `--stdout` "prints only when standard output is not a terminal". An agent's shell is usually not a terminal, so an unpiped `agent-drive credentials export --stdout` run by an agent prints the secret into the agent's transcript. The guard (`credentials.ts:318`) protects human terminals only.
6. Clipboard wording. Docs say "macOS and Windows". On Linux or WSL the error is `The clipboard target works on macOS and Windows only. Use \`--to 1password\` or \`--to <a file outside the repo>\` instead.` The CLI help line says "a file outside the repo"; the docs and `BACKUP_HINT` say "a file outside the sandbox".
7. `skill install` says it writes into "~/.claude/skills or ~/.codex/skills". The `npx skills add dennisonbertram/agent-drive` route (`docs/skills.md:10`) installs elsewhere and also installs `agent-drive-trace-archive`. The two routes are described side by side with no guidance on which to pick.

---

## SETUP-026: Back up by clipboard and confirm in Apple Passwords
**Type**: short
**Topic**: Credentials export targets and confirm
**Persona**: Maya Okafor, a freelance data analyst on a MacBook. She approved her agent a minute ago and uses Apple Passwords, not 1Password.
**Goal**: Record a credentials backup so `check` can pass.
**Preconditions**: `agent-drive login` finished. Config has one drive key and no `keyBackup`. macOS. Terminal is open, Passwords app is available.
**Surface**: CLI
**Ideal path**: 3 — export, paste, confirm.
**Alternate paths**: `--to 1password`; `--to /path/agent-drive-credentials.txt` (recorded at once, no confirm); `--stdout | STORE && agent-drive credentials confirm`; `--to clipboard --keep-clipboard`.

### Steps
1. The agent offers three choices (from `llms.txt` step 4). Maya says "clipboard". Agent runs `agent-drive credentials export --to clipboard` → stderr: `Copied the credentials to the clipboard. Paste them into Apple Passwords or your password manager, then run \`agent-drive credentials confirm\`. The clipboard is cleared in 60 seconds.` The command keeps running for 60 seconds (it waits in-process to clear the clipboard).
2. Maya opens Passwords, makes a new password item, pastes (the value begins `adcred1.`) and saves → clipboard still holds the bundle.
3. In a second terminal tab the agent runs `agent-drive credentials confirm` → `Recorded the credential backup for 1 drive(s) (stdout).`
4. The first command ends about a minute after it started; if the clipboard still holds the bundle it is cleared silently. If clearing failed it prints `Could not clear the clipboard; clear it yourself.`

### Variations
- Maya pastes, then runs `confirm` before the 60 seconds end: the export process is still waiting, so the agent must use another shell. An agent that runs commands one at a time waits a minute before it can run `confirm`.
- She adds `--keep-clipboard`: the message ends `The clipboard is not cleared (--keep-clipboard).` and the command returns at once.
- She copies something else within 60 seconds: the clear step reports `unchanged` and leaves her new clipboard alone.

### Edge Cases
- Ctrl+C during the 60-second wait leaves the bundle on the clipboard (code comment in `backup-targets.ts`). No message says so.
- `confirm` before any export: `There is no matching credentials export to confirm. Run \`agent-drive credentials export\` first.`
- Running `confirm` after a new login changed the API key: the pending marker no longer matches, same error as above.
- The name "stdout" in `(stdout)` confuses a clipboard user; she never used stdout.

---

## SETUP-027: Run `check` before any backup
**Type**: short
**Topic**: `check` outcomes
**Persona**: Tomas Vega, an impatient indie developer who pastes "Set up Agent Drive: https://agentdrive.xyz/llms.txt" into Codex and wants to be done.
**Goal**: See `check ok`.
**Preconditions**: Login succeeded, no backup recorded, one drive.
**Surface**: CLI
**Ideal path**: 2 — export a backup, then `check`.
**Alternate paths**: Any of the export targets; `AGENT_DRIVE_CREDENTIALS` in the environment (counts as backed up); `agent-drive credentials import`.

### Steps
1. Agent runs `agent-drive check` → exit 1, stderr: `drive key not backed up: <drive id>` followed by the full `BACKUP_HINT` ("Back up this agent's credentials before this machine or sandbox goes away: ... Until then `agent-drive check` will not pass.").
2. Tomas answers "just do the file one" and the agent runs `agent-drive credentials export --to ~/Documents/agent-drive-credentials.txt` → `Backed up credentials for 1 drive(s) (file).`
3. Agent runs `agent-drive check` → `check ok drive=<drive id>`.

### Variations
- The agent runs `agent-drive credentials status` first → JSON `{"drives":{"<id>":{"backedUp":false}}}`.
- Tomas picks a path inside a project folder: the CLI does not stop him (help says "outside the repo", code does not enforce it), and the file with the secret may be committed.

### Edge Cases
- Path already exists: `<path> already exists; pass --force to overwrite it.`
- Path named `1password`, `op` or `clipboard` is read as a target, not a file; `./clipboard` is needed.
- Several drives with keys: `check` without `--drive` errors `More than one usable drive. Pass --drive ID.`; the unbacked-up list in the refusal names all of them.

---

## SETUP-028: 1Password is not signed in, fall back to a file
**Type**: medium
**Topic**: Export targets and recovery from failure
**Persona**: Priya Natarajan, a platform engineer. She installed 1Password long ago, never installed the `op` CLI.
**Goal**: Back up to 1Password; settle for a file when that fails.
**Preconditions**: Login done, no backup. `op` is not on PATH.
**Surface**: CLI
**Ideal path**: 3 — try 1Password, read the error, export to a file.
**Alternate paths**: install `op`, turn on desktop integration, `op whoami`, retry; `--to clipboard` then paste into the 1Password app and `confirm`; `--vault NAME`.

### Steps
1. Priya chooses 1Password. Agent runs `agent-drive credentials export --to 1password` → exit 1: `The 1Password CLI (\`op\`) is not installed. Nothing was exported. Install the 1Password CLI (https://developer.1password.com/docs/cli/get-started/), turn on its desktop-app integration or run \`eval $(op signin)\`, check that \`op whoami\` succeeds, then run this again.`
2. Priya hesitates: installing a CLI feels like a detour. She asks "can I paste it into the 1Password app instead?" The agent offers `--to clipboard`.
3. Agent runs `agent-drive credentials export --to clipboard`, Priya pastes into a new 1Password item and saves, agent runs `agent-drive credentials confirm` → `Recorded the credential backup for 1 drive(s) (stdout).`
4. Agent runs `agent-drive credentials status` → JSON with `backedUp: true`, `at`, `method: "stdout"`.
5. Agent runs `agent-drive check` → `check ok drive=<id>`.

### Variations
- Priya installs `op` but is signed out: `The 1Password CLI (\`op\`) is not signed in. Nothing was exported. ...`
- `op item create` fails (vault locked): `The 1Password CLI could not create the item. Nothing was recorded as backed up.`
- On success with `--vault Personal` the item is titled `Agent Drive – <drive ids>` with a concealed field `credentials`; stderr says `Saved the credentials for 1 drive(s) to 1Password.`
- Linux or WSL: clipboard route fails as in contradiction 6; only file or `--stdout` remain.

### Edge Cases
- The llms.txt and quickstart sentence "Offer these choices in this order" nudges the agent to lead with a path that needs an extra install for most people.
- Priya's pasted bundle might wrap lines in a note app; the bundle is one line and `decodeBundle` rejects `Not a valid Agent Drive credentials bundle.` at import time. Nothing verifies the copy at backup time.

---

## SETUP-029: First put, get, compare and share
**Type**: medium
**Topic**: First file
**Persona**: Jonas Albrecht, a researcher who wants to hand a one-page PDF summary to a colleague with no account.
**Goal**: Store a file, confirm it round-trips, send a 24-hour link.
**Preconditions**: `check ok` already printed. One drive. Local file `./summary.pdf`.
**Surface**: mixed (CLI, then browser)
**Ideal path**: 3 — `put`, `share`, send the URL. (`get` and `cmp` are a verification, not required.)
**Alternate paths**: MCP tools `put`, `download`, `share` from the client; console file row menu then share dialog (`Link expires after`, `Copy link`); `put LOCAL -` from stdin; `put` the `folderUrl` it prints to open the folder in the console.

### Steps
1. Agent runs `agent-drive put ./summary.pdf /outputs/summary.pdf` → one line of JSON with the version and `folderUrl` (`<origin>/console?drive=<id>&path=/outputs`). The agent shows Jonas the `folderUrl` (SKILL.md says to).
2. Agent runs `agent-drive get /outputs/summary.pdf --output ./summary-copy.pdf` → JSON status; then `cmp ./summary.pdf ./summary-copy.pdf` → no output.
3. Agent runs `agent-drive share /outputs/summary.pdf --expires-in 24h` → JSON with `id`, `path`, `versionId`, `expiresAt`, `url`.
4. Jonas pastes the `url` (`https://agentdrive.xyz/s/<id>#k=...`) to his colleague. The colleague opens it → page tag `ENCRYPTED FILE TRANSFER`, the file name as heading, button `Download`; after the click, `Download started: summary.pdf. Check your downloads.`
5. Later Jonas asks "which links are live?" Agent runs `agent-drive share list` → rows with `status` `active`.

### Variations
- Jonas opens `folderUrl` before setting a passphrase: Files shows the file row but the key chip reads `Key needed · Not backed up` or `Key needed`; preview and download ask for a key (`Choose recovery file`).
- `--expires-in 90s` → `--expires-in must be between 2m and 30d to allow for API request transit (API minimum: 60 seconds).` `--expires-in 24` → `--expires-in must use a duration such as 30m, 24h, or 7d.` No flag: the service uses 7 days.
- The console route: row menu, share dialog `Link expires after` (1 hour, 24 hours, 7 days, 30 days) and `Copy link`; the URL lands on the clipboard and is not displayed unless `Copy failed`.
- `get /x.txt` without `--output` prints the text; a PDF or file over 1 MiB fails with `Binary or large output requires --output.` or `Binary output requires --output.`

### Edge Cases
- Re-running the same `put` with the same path: writes are create-only unless `--overwrite` or `--if-version`; the CLI returns a conflict error with a hint.
- Key without `share` scope: permission error that names the scope; see `SCOPE_HINT`.
- Colleague opens the link after 24 hours: heading `Share link expired`, text `This link passed its expiry date. Ask the sender for a new link.` After `share revoke <id>`: `Share link revoked`. Colleague's link lost its fragment: `This link is missing a valid decryption key`.
- Jonas trashes the file: `share list` shows `unavailable` and the colleague sees `Shared file unavailable`.
- Help shows `--drive ID` on every command, so Jonas assumes it is required (contradiction 2).

---

## SETUP-030: Read-only agent runs `check` on an empty drive
**Type**: medium
**Topic**: `check` outcomes
**Persona**: Lena Fischer, a security-minded engineer who approved a second agent as read-only (`--read-only` grant) to review a report folder.
**Goal**: Get `check ok ... (read-only)` for the reviewer agent.
**Preconditions**: Reviewer agent logged in with read-only access to an existing drive; drive holds no files yet; the reviewer holds the drive key and has a recorded backup (for example from `credentials import`).
**Surface**: CLI
**Ideal path**: 4 — check fails, ask the writer agent for a file, writer `put`s, check again.
**Alternate paths**: Ignore the failure because read-only agents need no write test (no doc says this explicitly); run `agent-drive ls` or `recent` to see that nothing is there.

### Steps
1. Reviewer runs `agent-drive check` → exit 1, stderr: `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.`
2. Lena hesitates: "not verified" reads like the key is wrong. She asks the writer agent to run `agent-drive put ./notes.md /work/notes.md`.
3. Reviewer runs `agent-drive check` again → `check ok drive=<id> (read-only)`.
4. Reviewer runs `agent-drive get /work/notes.md` → text of the note. Lena confirms the key opens real content.

### Variations
- The reviewer's key has `write` but a `--write-path /inbox/reviewer`: `check` writes `/inbox/reviewer/.agent-drive/check.txt` (uses the first write path), still in her inbox folder.
- Wrong drive key on the reviewer: `This drive key cannot decrypt existing files.` Lena must load the right key or repeat login.
- Reviewer machine key not backed up: `check` refuses first with `drive key not backed up` unless the key came from `AGENT_DRIVE_KEY`, `AGENT_DRIVE_KEY_<ID>`, `--key-file`, or `AGENT_DRIVE_CREDENTIALS`.

### Edge Cases
- Only `/.agent-drive/check.txt` files exist: `readOnlyCheck` skips them and still reports not verified.
- A read-only key cannot report the backup (403 on `key-backup`, silently ignored), so the console chip can stay `Not backed up` even after the reviewer backs up locally.
- The error goes to stderr with exit code 1 although the message wording ("run check again") sounds like a retry, not a failure.

---

## SETUP-031: Install the skill where no agent folder exists
**Type**: medium
**Topic**: `skill install`
**Persona**: Devon Brooks, running Cursor and a throwaway Docker dev container. `~/.claude` and `~/.codex` do not exist.
**Goal**: Have the agent save and recall files without being asked.
**Preconditions**: CLI installed and logged in. No `~/.claude` or `~/.codex`.
**Surface**: CLI
**Ideal path**: 2 — `agent-drive skill install --target <dir>`; point the agent at that folder.
**Alternate paths**: `agent-drive skill install --target claude` or `--target codex` (creates the folder); `npx skills add dennisonbertram/agent-drive` (both skills); copy `SKILL.md` by hand from the printed path; skip it (llms.txt allows skipping in a sandbox); MCP (`claude mcp add agent-drive -- agent-drive mcp`) instead.

### Steps
1. Following llms.txt step 5, agent runs `agent-drive skill install` → `No ~/.claude or ~/.codex directory found. The skill is at <packaged path>; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>.` Exit code 0.
2. Devon asks where Cursor reads skills. Neither the CLI output nor llms.txt says (Cursor is named only in the MCP snippet). He tries `agent-drive skill install --target ./.cursor/skills/agent-drive` and the agent runs it → `wrote ./.cursor/skills/agent-drive/SKILL.md`... Note the code appends `agent-drive` only for `claude`/`codex`; a custom `DIR` gets `SKILL.md` written directly inside it, so the path printed is `<DIR>/SKILL.md`.
3. Devon starts a new Cursor chat and asks "what do you remember about this project?". Whether the skill loads depends on Cursor; nothing in Agent Drive confirms it.

### Variations
- Home with `~/.claude` only: one file written, `wrote /Users/devon/.claude/skills/agent-drive/SKILL.md`.
- Both folders: both written (two `wrote` lines).
- `--target claude` on a machine with no `~/.claude`: folder is created with `mkdir -p`.
- Running it twice overwrites the file (`overwrite: true`); local edits to the skill are lost silently.

### Edge Cases
- Exit code is 0 when nothing was written, so a script cannot detect the miss.
- In a sandbox the skill is lost when the sandbox ends; `docs/sandboxes.md` says to skip it or use `--target`.
- Quickstart lists the skill as optional after `check` (contradiction 1), so a reader following the doc may never run it while an agent following llms.txt always does.
- `agent-drive-trace-archive` is not installed by this command (docs/skills.md:26).

---

## SETUP-032: Finish setup end to end and watch the console chip change
**Type**: long
**Topic**: Backup, check, first file, skill, console confirmation
**Persona**: Aisha Rahman, a startup founder, non-technical about terminals. She gave Claude Code the line `Set up Agent Drive: https://agentdrive.xyz/llms.txt`, signed up and approved the pairing. She wants to see her first file in the browser.
**Goal**: Complete setup, store a first file, open it in the console, know the key is safe.
**Preconditions**: `agent-drive login` just printed `Logged in as agent ...`, `New drive <id> created; its key is saved in the config file.` and `BACKUP_HINT`. `/connect` shows `Access approved for ...` with `Open console`. Aisha has not set a passphrase.
**Surface**: mixed (CLI, browser)
**Ideal path**: 9 — export, confirm if needed, check, skill, put, share optional, open console, refresh, set passphrase.
**Alternate paths**: Aisha clicks `Open console` before backup; downloads a recovery file from the key menu (`Download recovery file`, then `I saved it`) which records the backup from the browser (`console.tsx:2617`); the agent writes a file backup and she chooses that file under `Choose recovery file`.

### Steps
1. Claude Code says the login finished and asks how to back up. Aisha does not know what "credentials" are; she reads the three options and picks the file, naming `~/Documents/agent-drive-credentials.txt`. Agent runs `agent-drive credentials export --to ~/Documents/agent-drive-credentials.txt` → `Backed up credentials for 1 drive(s) (file).`
2. Aisha clicks `Open console` on the `/connect` done page → `/console`. The Files tab shows `Ready for your first file.` / `Connect an agent with the CLI or MCP to upload encrypted files.` The key chip shows `Key needed`. If the page loaded before the backup was reported it also shows `· Not backed up`.
3. She returns to the terminal. Agent runs `agent-drive skill install` → `wrote /Users/aisha/.claude/skills/agent-drive/SKILL.md`.
4. Agent runs `agent-drive check` → `check ok drive=<id>`. Agent tells Aisha setup is complete.
5. Aisha asks for proof. Agent runs `printf 'hello from an agent\n' > sample.txt`, then `agent-drive put ./sample.txt /sample.txt` → JSON with `folderUrl`.
6. Agent runs `agent-drive get /sample.txt --output ./downloaded.txt` and `cmp ./sample.txt ./downloaded.txt` → no output.
7. Aisha clicks the `folderUrl`, or `Refresh` in the console header. The row `sample.txt` appears. The key chip now reads (menu text) `Key backed up <date> (file)` and the `Not backed up` suffix is gone, provided the CLI's backup report reached the server.
8. She clicks the file. Preview asks for a key: unlock dialog with `Choose recovery file`, `Paste a key instead`, `Load key`. She does not have a recovery file; she chooses `~/Documents/agent-drive-credentials.txt` (the console accepts a bundle file) → text preview `hello from an agent`.
9. The passphrase banner on Files offers `Set up`; she defers it (next topic, account seal).

### Variations
- Aisha refreshes before the CLI finished reporting: chip still `Not backed up`; no auto-refresh.
- Self-host: `check` and `folderUrl` use the configured origin.
- The agent installs the skill before backup (llms.txt order): same result, only order differs.
- Aisha asks Claude Code to share the file with a friend: `agent-drive share /sample.txt --expires-in 24h` and the console `Shared` view lists it.

### Edge Cases
- If `reportKeyBackup` fails (offline, 5 second deadline), the CLI prints `Warning: could not report the key backup for drive <id> to Agent Drive.`, `check` still passes (local record), and the console keeps showing `Not backed up`. The two surfaces disagree until the report succeeds. No command re-reports besides running export or confirm again.
- She uses 1Password: the console label reads `(stdout)` (contradiction 3).
- She saves the credentials file in `~/Documents`, which is synced to a cloud drive; no text warns about that. The first sandbox-ending question in llms.txt is the only guidance ("a path that survives it").
- The agent prints the bundle in chat despite warnings: the `--stdout` guard does not catch a non-TTY agent shell (contradiction 5).

---

## SETUP-033: Keep a drive across disposable CI sandboxes
**Type**: long
**Topic**: Backup by stdout pipe, `AGENT_DRIVE_CREDENTIALS`, check in a new sandbox
**Persona**: Hannah Cole, a DevOps engineer. Her coding agent runs in an ephemeral Linux container each night. She stores secrets in a company secret manager with a CLI, `vault kv put` style.
**Goal**: The agent keeps the same drive and `check ok` in every new sandbox.
**Preconditions**: Agent logged in once on her laptop (macOS) with a drive. No backup yet. Secret manager CLI works on the laptop. CI platform has a secret named `AGENT_DRIVE_CREDENTIALS` to be set.
**Surface**: CLI (plus the CI platform's secret UI)
**Ideal path**: 6 — export to the secret store, confirm, set the CI secret, new sandbox `whoami`, `check`, first `put`.
**Alternate paths**: `credentials export --to <path>` then copy by hand; `credentials issue --name ... --stdout` (needs `delegate`) to mint a separate key for the sandbox; `agent-drive credentials import --from <path>` inside the sandbox.

### Steps
1. Hannah reads `docs/sandboxes.md`. Agent runs (in bash) `set -o pipefail; agent-drive credentials export --stdout | <secret store command> && agent-drive credentials confirm` → stderr `Exported. After the secret store has saved it, run \`agent-drive credentials confirm\`.` then `Recorded the credential backup for 1 drive(s) (stdout).`
2. Hannah, being cautious, reads the secret back from the store and confirms it starts with `adcred1.`.
3. In the CI platform she creates the secret `AGENT_DRIVE_CREDENTIALS` with that value (docs warn not to use the CI secret as the only copy).
4. The nightly container starts. It installs the CLI (`npm install -g @dennisonbertram/agent-drive`, Node 24+) and runs `agent-drive whoami` → agent name, drives, scopes, `localDriveKeys` showing the drive has a key here.
5. It runs `agent-drive check` → `check ok drive=<id>` (the bundle's drives count as backed up, method `env`). The first command also reports the backup to the service once.
6. It runs `agent-drive put ./report.md /outputs/nightly/report.md` → JSON with `folderUrl`.
7. The next night the container is gone; the new one repeats steps 4 to 6 and the file from the earlier night is visible with `agent-drive ls --prefix /outputs`.

### Variations
- Hannah forgets `set -o pipefail`: the pipeline status is the secret store's, so a failed `export` that still lets the store exit 0 with empty input would run `confirm`. `confirm` then fails with `There is no matching credentials export to confirm...` because no pending export was written. The doc explains `pipefail` but not this outcome.
- She runs `agent-drive credentials export --stdout` directly in her laptop terminal: `Refusing to print credentials to a terminal. Pipe them to a secret store: \`agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm\`, or use --to <path>.`
- Both `AGENT_DRIVE_CREDENTIALS` and a saved config exist: saved values win (docs/sandboxes.md).
- Bundle typo: `AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.`
- Network blocked to agentdrive.xyz: `Could not reach Agent Drive at <base>. Check the network and try again.`; llms.txt tells the agent to stop and tell the human.

### Edge Cases
- Hannah's key differs after a re-login: `The API key changed, so earlier credential backups are out of date. Run \`agent-drive credentials export\` again.` The stored CI secret holds an old API key and old sandboxes fail until she updates it.
- She uses the sandbox's bundle as the only copy: documented as wrong, but `BACKUP_HINT` does not repeat it.
- An agent in the sandbox runs `agent-drive credentials export --to clipboard` on Linux: `The clipboard target works on macOS and Windows only. ...`
- `skill install` in the container: llms.txt says use `--target <dir>` or skip; the skill file vanishes with the container.
- The same secret in many sandboxes gives every sandbox full drive access; `credentials issue --write-path` is the scoped alternative and is documented only in `connect-an-agent.md`, not the quickstart.

---

## Clarity risks (summary)

1. Backup state is described three ways with different words (`BACKUP_HINT`, `credentials status`, console `Key backed up <date> (stdout|file|env)`), and the console shows the raw method name, so 1Password and clipboard users see "(stdout)". The console also lags the CLI until Refresh and silently stays `Not backed up` if the report fails or the key is read-only.
2. An unpiped `credentials export --stdout` from an agent's non-TTY shell prints the secret into the agent transcript, while every doc says the CLI refuses when stdout is a terminal. Related: the order of skill install versus `check` differs between llms.txt and the quickstart, and help text shows `--drive ID` as required when one saved drive is the default.

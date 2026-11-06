# Topic: Agent CLI/MCP daily use and edge cases

Source: `packages/agent-drive/src/cli.ts`, `mcp.ts`, `sync.ts`, `backup.ts`, `check.ts`, `config.ts`, `skill.ts`; server messages in `apps/web/src/api/handler.ts`. On main the MCP `get` tool has `outputPath` and `driveId` is required on every tool. Branch `fix/mcp-defaults` (not merged into main) adds an optional `driveId`, a separate `download` tool and removes `outputPath` from `get`; variations below mark this. CLI output is JSON on stdout; hints go to stderr.

## STORY-088: First save of a handoff note with the default drive

**Type**: short
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent named "trace-bot" on a laptop that already passed `login` and `check ok`.
**Goal**: Write /work/triage/handoff.md.
**Preconditions**: One drive configured for this API origin; file notes.md in the working directory.
**Ideal path**: 1 — a single put command with no drive argument.
**Alternate paths**: MCP `put` with `text`; `sync` of a directory.

### Steps

1. Run `agent-drive put ./notes.md /work/triage/handoff.md --description "triage handoff" --tag handoff` → JSON of the new version (id, path, size, tags). `--drive` is not needed because exactly one drive key matches the API origin.
2. Run `agent-drive ls --prefix /work/triage` → JSON page listing the file, no folders (flat paths).
3. Run `agent-drive get /work/triage/handoff.md` → file text printed, trailing newline added.

### Variations

- With two drives configured: put fails with "A --drive ID is required. Configured drives for this API: drv_a, drv_b." and she re-runs with `--drive drv_a`.
- `AGENT_DRIVE_API_URL` pointing at another origin makes the default ignore drives saved for the first origin.

### Edge Cases

- Running put a second time without a flag: create-only default, the API returns 409 conflict; stderr prints the message and the hint "Current version: <id>. Read the file again, merge your change, then retry with --if-version <id>."
- `--overwrite` with `--if-version` fails locally: "--overwrite and --if-version are mutually exclusive."

## STORY-089: Two agents edit the same file and one loses the race

**Type**: medium
**Topic**: Agent CLI/MCP daily use
**Persona**: notes-bot and trace-bot both update /memory/decisions.md.
**Goal**: Update without clobbering the other agent's change.
**Preconditions**: /memory/decisions.md exists at version v1.
**Ideal path**: 3 — read with version, merge, write with guard.
**Alternate paths**: MCP `put` with `ifVersionId`; `agent-drive versions` to see the history.

### Steps

1. notes-bot runs `agent-drive get /memory/decisions.md` and `agent-drive ls --prefix /memory` to read the version id → text and metadata.
2. trace-bot meanwhile writes v2 with `--overwrite`.
3. notes-bot runs `agent-drive put ./decisions.md /memory/decisions.md --if-version <v1>` → 409; stderr: conflict message plus "Current version: <v2>. Read the file again, merge your change, then retry with --if-version <v2>."
4. notes-bot reads v2, merges, retries with `--if-version <v2>` → new version v3; history retains v1, v2.

### Variations

- MCP: tool result has isError true with `error.code "conflict"`, `currentVersionId` and `hint`.
- If the file was trashed in between, the hint says restore it or write with --overwrite; if it was removed, "write it without --if-version."

### Edge Cases

- Using `--overwrite` blindly hides the other agent's change; the SKILL says to ask before overwriting.

## STORY-090: Restricted agent writes outside its allowed folder

**Type**: medium
**Topic**: Agent CLI/MCP daily use
**Persona**: intake-bot, issued a key with `--write-path /inbox/intake-bot`, saving a scraped export.
**Goal**: Save /inbox/vendor/2026-11-05.jsonl, then recover.
**Preconditions**: Key has read+write scopes and one write path.
**Ideal path**: 2 — the error names the allowed folder, retry under it.
**Alternate paths**: Ask the owner to re-approve with a wider folder on `/connect`; `whoami` shows `writePaths`.

### Steps

1. `agent-drive put ./export.jsonl /inbox/vendor/2026-11-05.jsonl` → stderr "The API key may only write under /inbox/intake-bot."
2. She runs `agent-drive whoami` → JSON with scopes, `writePaths`, driveIds, `localDriveKeys`, `keyBackup`.
3. Retries `agent-drive put ./export.jsonl /inbox/intake-bot/vendor/2026-11-05.jsonl` → success.

### Variations

- Reads (`ls`, `get`) outside the folder still work; only writes are restricted (per `needWritePath`).
- `mv` and `cp` into a path outside the folder are refused with the same message (not exercised here).

### Edge Cases

- Hesitation: the error does not say how to widen the folder; only the owner can via a new approval.
- `agent-drive check` for a write-restricted key writes its check file; behaviour for keys with write path not covering `/.agent-drive/check.txt` not verified in code.

## STORY-091: Read-only agent attempts a write or share

**Type**: short
**Topic**: Agent CLI/MCP daily use
**Persona**: audit-bot with scopes `read` only.
**Goal**: Upload a summary; then share a link.
**Preconditions**: Key scopes are read.
**Ideal path**: 1 — fail fast and tell the human what is missing.
**Alternate paths**: none found.

### Steps

1. `agent-drive put ./summary.md /outputs/summary.md` → stderr "The API key lacks the "write" scope." then "Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope."
2. `agent-drive share /outputs/summary.md` → same style error for "share".
3. `agent-drive check` → prints `check ok drive=... (read-only)` only if a live file exists; else "check not verified".

### Variations

- MCP: result isError with code `permission_denied`, message "The API key does not have permission for this operation." (the scope name is not in the MCP message; gap).

### Edge Cases

- Plain `rm` needs `delete`; the error text names the scope the same way.

## STORY-092: Reading a binary or large file

**Type**: short
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent fetching /outputs/report.pdf and a 3 MB log.
**Goal**: Get the bytes onto local disk.
**Preconditions**: Files exist.
**Ideal path**: 1 — one command that writes a file.
**Alternate paths**: MCP `get` with `outputPath` (main) or the `download` tool (fix/mcp-defaults).

### Steps

1. `agent-drive get /outputs/report.pdf` → stderr "Binary output requires --output." nothing printed.
2. `agent-drive get /outputs/report.pdf --output ./report.pdf` → file written mode 600; stdout JSON of the version.
3. For the 3 MB log `agent-drive get /logs/run.log` → "Binary or large output requires --output." (limit 1 MiB on CLI).

### Variations

- MCP on main: `get` without `outputPath` rejects over 64 KiB with "Large or binary files require outputPath."; with `outputPath` it creates the file with flag `wx`, so an existing file fails with an operation error. On `fix/mcp-defaults`: the message says "require the download tool", and `download` takes `driveId?`, `path`, `outputPath`, `versionId?` and refuses to overwrite.
- A read-only MCP client can call `get` (annotated read-only) on the branch without being able to write disk; on main `get` can write when `outputPath` is set.

### Edge Cases

- CLI `--output` overwrites an existing file silently (`writeFile`), MCP refuses; inconsistent.
- Wrong drive key or tampered data gives a crypto error (DriveCryptoError) rather than garbage.

## STORY-093: Reorganising paths with mv and cp

**Type**: medium
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent tidying /work/triage after a task.
**Goal**: Move final files to /outputs and keep a copy of an old version.
**Preconditions**: Files at /work/triage/a.md and /work/triage/b.md.
**Ideal path**: 2 — one command per file, no folders to create.
**Alternate paths**: MCP `move` and `copy`.

### Steps

1. `agent-drive mv /work/triage/a.md /outputs/a.md` → JSON of the moved file. No mkdir is needed since paths are flat.
2. She mistypes `agent-drive cp /work/triage/b.md` without a destination → the CLI passes an empty string; the API returns a validation error (no local usage message; gap).
3. `agent-drive versions /work/triage/b.md` → version ids; `agent-drive cp /work/triage/b.md /outputs/b-old.md --version <v1>` → copy of the older version.

### Variations

- `mv` onto an existing path: result depends on the server (conflict); not verified in code here.
- Moving a whole prefix is not supported; she must loop over `ls --prefix` output (gap).

### Edge Cases

- The same operations are not available in the console UI at all (no move/copy/rename).

## STORY-094: Sync a working directory, then hit a remote conflict

**Type**: long
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent syncing ./out/ to /outputs/run-42 before its sandbox ends; later a second agent edits one file.
**Goal**: Keep the remote copy current without overwriting someone else's edits.
**Preconditions**: Local directory with 20 files; drive has some of the same paths.
**Ideal path**: 1 — one command.
**Alternate paths**: `backup` for one-way uploads that always overwrite; CLI `put` per file.

### Steps

1. `agent-drive sync ./out --prefix /outputs/run-42` → JSON `{uploaded, skipped, conflicts, accountId, manifestPath}`.
2. Re-run → unchanged files are counted as `skipped`.
3. A second agent edits /outputs/run-42/report.md remotely; the first agent edits locally and re-runs sync → it fails: "Remote conflict for report.md; refusing to overwrite." The run stops at the first conflict; files after it are not uploaded (gap: no per-file summary).
4. She resolves by `agent-drive get` of the remote version, merging by hand, and `agent-drive put ... --if-version <id>`; then sync again.

### Variations

- First sync where a remote file already exists with no local history: "Remote file X has no local sync history; use --overwrite-existing to replace it." and she re-runs with `--overwrite-existing`.
- Symlinked sync root is refused: "Sync root must be a real directory, not a symlink."

### Edge Cases

- A malformed local manifest stops the run: "The private sync manifest is malformed; refusing to discard conflict history."
- A file that changes while being read: "Sync file X changed after enumeration; refusing to read it."
- Sync never deletes remote files for locally removed files.

## STORY-095: Back up a workspace with a dry run first

**Type**: medium
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent about to lose its container; the human said "back up everything but be careful".
**Goal**: Preview, then upload ./workdir.
**Preconditions**: Credentials backed up; ./workdir has 40 files including a 6 GiB dump.
**Ideal path**: 2 — dry run, then real run.
**Alternate paths**: `sync` (conflict-checked) instead of backup (overwrites by design).

### Steps

1. `agent-drive backup ./workdir --dry-run` → stdout lists `would upload /backups/<machine>/<relative path>` per changed file, then `backup uploaded=0 unchanged=0 failed=1`; stderr `failed /backups/<machine>/dump.bin: file exceeds the 5 GiB limit`. Exit code 1.
2. She moves the dump away and re-runs with `--prefix /backups/laptop-7` → dry run now shows `failed=0`.
3. Runs without `--dry-run` → uploads and prints `backup uploaded=39 unchanged=0 failed=0`; a hash manifest under the config state directory stores what was sent.
4. Runs again → `uploaded=0 unchanged=39`.

### Variations

- `--prefix` must be absolute: "--prefix must be an absolute remote path."
- The config file, key file passed with `--key-file`, and symlinks are skipped silently.

### Edge Cases

- Dry run does not update the manifest, so a later real run uploads the same files.
- Dry run counts files over the limit as failed even though nothing is uploaded; exit code is 1.
- Only a single drive can be targeted; with two configured drives and no `--drive` the command stops with the "A --drive ID is required" message.

## STORY-096: Using the MCP tools from an editor agent

**Type**: long
**Topic**: Agent CLI/MCP daily use
**Persona**: A coding assistant in Cursor connected with `agent-drive mcp` (stdio), keys in the environment.
**Goal**: Read prior decisions, write a result, wait for a teammate agent's change.
**Preconditions**: MCP server configured from the console's "Connect an agent" snippet; one drive.
**Ideal path**: 3 — list, get, put; drive should not need to be restated.
**Alternate paths**: CLI equivalents; login, grant, credentials, sync, backup, check, share list and revoke are not exposed over MCP.

### Steps

1. Calls `whoami` → account, agent, scopes, authorized `driveIds` (plain, not marked untrusted).
2. Calls `list` with `driveId` and `prefix "/memory"` → page of metadata wrapped as `{untrusted: true, trustNotice, data}`.
3. Calls `get` with `driveId`, `path "/memory/decisions.md"` → `{version, text}`.
4. Calls `put` with `driveId`, `path`, `text`, `tags`; first omits `overwrite` and gets a conflict error with hint; retries with `ifVersionId` from the hint.
5. Calls `recent` with `driveId`, `cursor` from the previous `latestCursor` and `waitSeconds 20` → blocks until another agent writes (max 30 seconds over MCP versus 300 for CLI `--wait`).

### Variations

- On main every tool requires `driveId`, so the assistant first calls `whoami` to learn it, even with one drive. On `fix/mcp-defaults` `driveId` is optional and defaults like the CLI; with several drives the error says "A driveId is required. Configured drives..." (the CLI wording of `--drive ID` is rewritten).
- `put` supplies both `text` and `localPath`: "Provide exactly one of text or localPath."
- `put` of a local file that is missing returns generic "The operation failed." (no detail; gap).

### Edge Cases

- Malicious file content saying "ignore previous instructions" arrives inside the untrusted wrapper; the trust notice is the only defence.
- API error messages are replaced by short fixed texts (for example "The drive quota would be exceeded."), so the agent sees less detail than CLI users.
- `share` over MCP takes an ISO `expiresAt`, not the CLI's `--expires-in 24h`.

## STORY-097: Installing the skill on a fresh machine

**Type**: short
**Topic**: Agent CLI/MCP daily use
**Persona**: An agent in a clean container with neither ~/.claude nor ~/.codex.
**Goal**: Get the SKILL.md in place so future sessions use the drive proactively.
**Preconditions**: CLI installed and logged in.
**Ideal path**: 1 — one command.
**Alternate paths**: Copy the file by hand from the path printed.

### Steps

1. `agent-drive skill install` → stdout "No ~/.claude or ~/.codex directory found. The skill is at <package>/SKILL.md; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>."
2. `agent-drive skill install --target claude` → `wrote ~/.claude/skills/agent-drive/SKILL.md` (creates the directories).
3. `agent-drive skill install --target /workspace/.skills/agent-drive` → writes SKILL.md into that directory, overwriting any prior copy.

### Variations

- With both home directories present and no `--target`, both are written.
- `--target codex` writes `~/.codex/skills/agent-drive/SKILL.md`.

### Edge Cases

- An unknown word as target such as `--target cursor` is treated as a directory name relative to the current directory and creates `./cursor/SKILL.md` (not an error; gap).
- Missing target value: `--target` with no value errors in argument parsing.

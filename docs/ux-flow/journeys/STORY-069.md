# STORY-069: Weekly trace archive (put, verify hash, delete local)

Verdict: **acceptable** with the new script, **convoluted** without it. Steps: 1 command per week (script) versus 6 shell steps per file (catalog); ideal 1 command per run.

Sources: catalog STORY-069; `packages/agent-drive/src/cli.ts`; `skills/agent-drive/SKILL.md` and `docs/cli.md` (no mention of verify or archive); `/Users/dennison/develop/agent-drive-trace/skills/agent-drive-trace-archive/SKILL.md` and `archive-traces.sh` (read-only, on another branch); screen `02-console-files.jpg`; lead-measured live facts.

## 1. Friction Scorecard

Per file, without the script (catalog): put, `mktemp`, get to temp, compare hashes, delete local, delete temp, then one final `ls` audit. That is 6 steps per file plus 2 per run. Decisions: how to hash (`shasum` or `sha256sum`), what to do on mismatch, what to do when the file already exists. The CLI has no verify or delete-after option (catalog edge case; `cli.ts` has no such flag).

With the script (measured by the lead): 5 files uploaded, verified and deleted, 1 fresh file skipped, 1 secret-bearing file held, exit 0. The agent's procedure in `SKILL.md` is:

1. `whoami` (the script also does it)
2. review candidates with `find`
3. search for secrets with `grep`
4. dry run, then real run (2 commands)
5. read the summary line

So the weekly job is 5 numbered steps and 3 or 4 commands, but steps 1 and 2 repeat what the script does ("The script also enforces both rules", SKILL.md read). Step 3 duplicates the script's secret filter, though the skill says the review is required because the pattern list "cannot find every secret".

Other friction:

- The script lives in a skill directory. A user must know the path, or set `AGENT_DRIVE_BIN`, or put `agent-drive` on PATH (SKILL.md prerequisites). It is not a CLI command, so `agent-drive help` does not list it (read: help in `cli.ts`).
- Environment setup: four variables, one with a computed name (`AGENT_DRIVE_KEY_<ID>`). Measured as working. The drive id also has to be known by the person scheduling the job; the console shows it only in small grey text (screen 02).
- A secret key rule split across two places: the key must be `read` and `write` only, and the human creates it with a long `key create` command in the SKILL (read). The console API keys tab has the same job in a dialog (screen 04 shows a trace-bot key with read, write).
- Error recovery: a failed file stays local, and the exit code is nonzero. Re-run is safe (SKILL.md; the script handles "The file already exists" by comparing hashes). Not re-measured by me.
- Delete confirmations: none, by design (unattended). The safety is the hash compare, which is the right guard.

Dead ends: a read+write key cannot delete remote files, so a wrong upload cannot be cleaned up by the agent (measured: "The API key lacks this scope." for `rm`). That is correct for safety, but the script's mismatch message ("the remote path holds different content, so a human decides") gives the human no command to run.

## 2. Take-away Pass

Script and skill:

- SKILL.md section "Purpose" and "Prerequisites": needed once; the weekly procedure should not make the agent re-read them. Fine.
- Procedure steps 1 and 2 (whoami, find): duplicate script behaviour. Remove from the agent's list.
- `--week` option: default is enough. Rarely used. Fine as an optional flag.
- Final summary line: 9 `key=value` fields. The agent needs: how many archived, how many held, how many failed, exit code. `skipped` and `remote_files_in_week` are diagnostics (suspected useful for audit only).
- Per-file line "uploaded, verified, deleted: path": needed, it is the evidence.

CLI output:

- `put` prints version JSON with `wrappedKey` (measured). The script reads only the `id` with `sed` (read: `sed -n 's/^{"id":"\([^"]*\)".*/\1/p'`), so it depends on the field order of the JSON. A reordering of fields in the CLI output would break pinning silently, since the script then falls back to no `--version` (suspected, not tested).
- Same pattern for `ls` count: `grep -o '"path":"/traces/'` counts text matches in JSON, which would miscount if a file name contained that text (suspected).

Console:

- Files screen (02) lists `/traces/2026-W45/...` files with Download greyed out until a drive key is loaded. That is correct for the retrieval story, not part of this one.

## 3. The Simpler Version

Ideal as stated in the catalog is 5 steps per file. Minimal version for the user is 1 command, with the safety order built in:

1. `agent-drive archive ./traces --drive agent-traces --older-than 7d --verify --delete-local`

The command would, for each file: skip files modified in the last hour, hold files matching the secret patterns, put with tags, get to a private temp file, compare SHA-256, delete the local file only on a match, and print one summary at the end (exit nonzero if anything failed). A `--dry-run` flag stays.

Concrete changes:

1. Move the script's logic into the CLI as `archive` (or `put --verify --delete-local` for one file). The CLI already has the encrypted client, the temp file mode (0600 on `get --output`, read in `cli.ts`), and the JSON it needs; today the script scrapes JSON with `sed` and `grep` and shells out per file (about 4 process starts per file, each with a config read and a key-derivation, suspected cost, not timed). A built-in command parses results directly, does not depend on `shasum`, `mktemp` or `find`, and works on Windows. Evidence: script text.
2. Print the version `id` and `ciphertextSize` only, not `wrappedKey`.
3. Let the skill's weekly procedure say: "Run `archive --dry-run`, read held files, run `archive`, report the summary". Steps 1 and 2 go away because the command does them.
4. For the secret review, make the command print the held-back file names to stderr and exit with a distinct code (for example 3) when files were held, so the scheduler can tell "needs a human" from "failed". The script currently exits 0 when files are only held (measured: exit 0 with one held).
5. Show the drive id with a copy button in the console (screen 02) and show the ready `AGENT_DRIVE_KEY_<ID>` env name next to it for the archive-only key, so the person scheduling the job does not compute it. Suspected helpful; not seen in the console today.
6. Offer "Create archive-only key" in the console: preselects read + write, names the key `trace-weekly`, and shows the env block with the real host and drive id. Today that is a long `key create` command in the SKILL.

Already minimal: the order put, get, hash compare, delete local (it is the only safe order), and the decision to hold files rather than ask. The create-only put with the "already exists then compare" re-run behaviour is the right design.

## 4. Clarity Issues

- The skill says the weekly agent "Review the candidates" and "Check for secrets" before the script, but the script also checks. A reader cannot tell which checks are redundant and which are required. State: "The script's filter is a safety net; your review is the check."
- Exit code 0 can mean "all archived" or "some held back for a secret" (measured: exit 0 with one held file). A scheduler cannot alert on it.
- Summary field names mix verified and deleted: `already_present_verified` versus `deleted`. In the script, `verified=$deleted`, so they are one number in the audit. Use one name.
- "Skipped" counts files too new for the 7-day or 1-hour rule, but the word also suggests an error. Call it `too_recent`.
- The file name rule ("never put secrets or customer names in file names") is stated in the skill but not shown when the script runs. Paths are plaintext metadata (SKILL.md; catalog). Add one line to the script's dry-run output.
- `--older-than-days N` in the script versus the catalog's discussion of the CLI: no CLI command has this flag, so the name will not match anything the user already knows.
- The skill is separate from the general `agent-drive` skill, which advises against saving transcripts (SKILL.md in main, "Do not save ... chat transcripts"). The archive skill explains the opt-in; a user who loads both skills still sees two opposite rules. Not resolved by the product, only by the note in the archive skill.

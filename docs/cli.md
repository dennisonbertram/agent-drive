# Agent Drive CLI

The CLI keeps the API token and drive keys in
`~/.config/agent-drive/config.json` (or `AGENT_DRIVE_CONFIG`). The directory is mode `0700` and
the file is mode `0600`; updates are atomic. `AGENT_DRIVE_API_URL` and `AGENT_DRIVE_API_KEY`
override saved values. Run `agent-drive login` with those environment variables, or pipe a token
to `agent-drive login --api URL --token-stdin`; tokens are never required in command arguments.

Drive-key precedence is the per-drive `AGENT_DRIVE_KEY_<DRIVE_ID>` variable (uppercase, with
non-alphanumeric characters replaced by `_`), then `AGENT_DRIVE_KEY`, then `--key-file`, then the
locally saved key. Drive keys are client secrets and are never sent to the API or S3.

Commands include `login`, `whoami`, `agent create`, `drive create`, `check`, `key create`, `key revoke`,
`put`, `get`, `ls`, `mv`, `cp`, `rm`, `versions`, `restore`, `search`, `recent`, and `sync`.
`put LOCAL REMOTE --drive ID` is create-only by default and encrypts before requesting an upload URL.
A conflict prints what to do: `exists` and `changed` print "Current version: ID. Read the file again, merge
your change, then retry with --if-version ID."; `trashed` says to restore the file or write with `--overwrite`;
`absent` says to write without `--if-version`.
Use `--overwrite` for an unconditional replacement, or `--if-version ID` for an optimistic
conditional replacement; these flags are mutually exclusive. `get REMOTE --drive ID
--output FILE` writes only after authenticated decryption succeeds; without `--output`, only
small valid UTF-8 files are printed.
Inline text output rejects binary control bytes while allowing tabs and line breaks. `ls` and
`search` accept `--agent`, `--machine`, `--user`, and `--tag`; `recent` accepts `--since`, `--cursor`, and `--wait SECONDS` (1 to 300; polls every 2 seconds for the next event, one metered operation per poll).

Drive creation is idempotent. A newly created drive generates and prints a key once with a backup
warning. Re-running against an existing drive uses the retained local key and refuses to invent a
replacement when the backup is missing. Creating a scoped API key remains an explicit `key create`
step; a management key is not silently granted drive access.

`sync LOCAL_DIRECTORY --drive ID --prefix /folder` is upload-only. It skips symlinks, never
deletes remote files, stores private SHA-256/version manifests outside the uploaded directory,
skips unchanged files, and refuses unknown remote files unless `--overwrite-existing` is supplied
for deliberate initial adoption. That flag still uses a current-version guard; files with existing
manifest history always conflict if their remote version changed. It reads each local file once and
hashes the exact bytes uploaded. Corrupt or unreadable manifests fail rather than resetting conflict
history. Sync state is stored in a private sibling directory named `<config-path>.state`; an
existing state directory with unsafe permissions is rejected without changing its mode. Config
updates use an exclusive `<config-path>.lock` directory. A crashed CLI may leave that lock; remove
it manually only after confirming no Agent Drive CLI process is active. It is not a download or
destructive mirror.

## Install, device login, and backup

Install from the site: `npm install -g https://agentdrive.xyz/cli/agent-drive.tgz`, or run
without installing: `npx -y https://agentdrive.xyz/cli/agent-drive.tgz <command>`. The
Vercel build packs `packages/agent-drive` into `apps/web/public/cli/agent-drive.tgz`. The default
API URL is `https://agentdrive.xyz/api` (override with `--api` or `AGENT_DRIVE_API_URL`).

`agent-drive login [--name AGENT] [--no-browser]` runs the OAuth device flow when no
`AGENT_DRIVE_API_KEY` or `--token-stdin` is given. It prints a link and a code, opens a browser only
when stdout is a TTY, `CI` is unset, and `--no-browser` is absent, then polls until the human
approves. The default name is `<machine> agent`. It sends the saved drive IDs for the same API origin
as `known_drive_ids`, saves the API key and unsealed drive keys to the private config, and never
prints them. A drive key that fails to unseal is reported and skipped. If no granted drive has a
usable key, login exits 1 (the config is still saved); run `login` again. Otherwise it prints the
usable drives and the config path. See `docs/agent-login.md`.

`agent-drive whoami` adds `localDriveKeys`, a map of authorized drive IDs to whether this machine
holds a key. `agent-drive check [--drive ID]` first downloads the newest existing file (other than
the check file) and fails with "This drive key cannot decrypt existing files." if the key cannot
open it. Then it writes a random file to `/.agent-drive/check.txt` (under the key's first write path, if it has any) with overwrite, reads it back, and prints `check ok drive=<id>`, or fails with exit 1. A key without the `write` scope cannot write, so `check` lists live files, downloads and decrypts the first one that still exists, and prints `check ok drive=<id> (read-only)` without writing anything. If no file decrypts (an empty drive), it prints `check not verified drive=<id>: ...` and exits 1; run it again after another agent writes a file. `drive create`
prints only the drive and a note on stderr that the key is saved to the config; it never prints the
key. A `permission_denied` error about a missing scope adds a hint to run `agent-drive login` again.

`key create --agent ID --drive ID --label L --scope read --scope write [--write-path /inbox/x]...` limits the key's writes, moves, copies, deletes and restores to those folders (up to 16; each a canonical absolute path). Reads stay drive-wide. `whoami` shows `writePaths` (empty means no limit).

## Credential backup and skill install (contract section 9)

The drive key lives only in the config file, so lose the machine and the files cannot be opened.

- `agent-drive credentials export (--to PATH [--force] | --stdout)` writes a bundle:
  `adcred1.` plus base64url of `{"v":1,"apiUrl","apiKey","driveKeys","driveKeyOrigins"}`. `--to`
  writes a mode `0600` file and refuses an existing path without `--force`. `--stdout` prints only
  when stdout is not a terminal (pipe it to a secret store), waits for stdout to drain, and fails on
  EPIPE. `--to` and `skill install` write through a temp file and rename, and refuse a symlink
  destination. The bundle is the only secret the CLI
  ever prints. A `--to` export records `keyBackup: { "<driveId>": { at, method } }` in the config and
  then calls `POST /v1/drives/:id/key-backup` with `{ method }` for each drive; a failed call is
  only a warning. A `--stdout` export records nothing; run
  `agent-drive credentials export --stdout | <secret store> && agent-drive credentials confirm`
  (`confirm [--method stdout]` records the backup and reports it). Use `set -o pipefail` so a failed
  store stops `confirm`. A login that replaces the API key clears all backup records (the exported
  bundle holds the revoked key) and says so; `check` then asks for a new export.
- `agent-drive credentials issue --name NAME [--drive ID] [--scope S]... [--write-path P]... [--label L] (--to PATH [--force] | --stdout)`
  needs the `delegate` scope. It creates a new agent `NAME` with its own API key (default scopes
  `read write`, which must be within the caller's own; the drive defaults to the only configured
  drive key) and prints one `AGENT_DRIVE_CREDENTIALS=adcred1.…` line holding only that key and the
  chosen drive's key. The caller's own API key and config are neither included nor changed. `--to`
  and `--stdout` follow the same terminal and mode `0600` rules as `export`. Store the line as a
  secret in the sandbox. A name that already exists returns 409; pick another. Revoke the issued
  key alone from the console under Agents.
- `agent-drive grant CODE [--drive ID] [--read-only] [--scope S]... [--write-path P]...` needs the
  `delegate` scope. `CODE` is the code a new agent's `agent-drive login` showed. It prints
  `Request from <client_name> on <machine>, made <time>.`, seals this machine's drive key to the
  login's public key (the `adk-device-v1` format of agent-login.md section 4), posts the sealed
  blob as an offer, and prints `Offered drive <id> to <name> (<scopes>; writes under <paths>). The
owner approves at <origin>/connect?code=CODE.` It does not approve: the human opens that page and
  clicks Approve once. The drive defaults to the only configured drive key. Scopes default to
  `read write` (`read` with `--read-only`); they must be within the caller's own, else pass
  `--scope`. Write paths default to the caller's own. It never prints or sends a key in the clear. It offers only a drive key saved for the current API origin (as login does); a key from `AGENT_DRIVE_KEY*`, `--key-file`, or saved for another origin is refused, so an endpoint other than the key's own cannot obtain it.
  Which handoff when: `grant` when the new agent has a shell and a human is present; the human's
  "Add to an existing drive instead" on `/connect` when they hold the recovery file; `credentials
issue` for a sandbox with no browser.
- `agent-drive credentials import [--from PATH]` merges a bundle (file or stdin) into the config
  and marks its drives as backed up.
- `agent-drive credentials status` prints, per drive key, whether and when it was backed up.
- `AGENT_DRIVE_CREDENTIALS=<bundle>` is merged in memory at startup and never written to disk. The
  saved config and the explicit variables (`AGENT_DRIVE_API_URL`, `AGENT_DRIVE_API_KEY`,
  `AGENT_DRIVE_KEY_<ID>`) take precedence over it. Its drives count as backed up (method `env`)
  and are reported once per process, but only for drives whose effective key (after the precedence
  above) equals the bundle's key and whose recorded origin matches the API origin.
- `login` and `drive create` print the backup instructions when they create a drive key.
  `check` fails with "drive key not backed up" until every usable key is backed up (a key supplied
  by `AGENT_DRIVE_KEY*` or `--key-file` is already outside the config and is exempt). `whoami`
  includes `keyBackup`.
- `agent-drive skill install [--target claude|codex|DIR]` copies the packaged `SKILL.md` to
  `~/.claude/skills/agent-drive/` and `~/.codex/skills/agent-drive/` when those directories exist
  (or to the target), and prints the paths written. With none found it prints the packaged file's
  location.

On reconnect, `login` sends the saved API key as a bearer header only when the saved API URL has the
same origin as the login URL. The config records each drive key's origin in `driveKeyOrigins`. Keys
with a different or unknown origin, or that do not decode to 32 bytes, are not sent or counted as
usable. Configs written before origins were recorded are migrated when read: a drive key with no
origin is assigned the origin of the saved `apiUrl` (and kept only if one is saved); the migration is
written back on the next config write. The default agent name is `<machine> agent`, truncated to 64 characters.

`agent-drive backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--dry-run]` uploads every regular
file to `PATH/<relative path>` (default `/backups/<machine>`) with overwrite, so history is kept.
The drive defaults to the only drive key in config. A private manifest in `<config-path>.state`,
keyed by server, drive, prefix, and relative path, lets later runs skip unchanged files by SHA-256.
Symlinks are skipped, and one failing file does not stop the rest. It prints
`backup uploaded=N unchanged=N failed=N` and exits 1 if any file failed.

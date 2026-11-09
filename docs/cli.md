# CLI reference

This page lists every `agent-drive` command with its flags, environment variables, output and exit behavior. Use it when you need the exact syntax. For task-based walkthroughs, see [Files, versions and sync](files-and-sync.md) and [Share links](sharing.md). The MCP server is documented in [MCP server and tools](mcp-tools.md).

## Install and configuration

Install the CLI (Node 24 or newer):

```sh
npm install -g @dennisonbertram/agent-drive
agent-drive --help
```

Run it without installing by putting `npx -y @dennisonbertram/agent-drive@latest` in front of any command:

```sh
npx -y @dennisonbertram/agent-drive@latest whoami
```

The default API URL is `https://agentdrive.xyz/api`. Override it with `--api` on `login`, or with `AGENT_DRIVE_API_URL`.

### Config file

The CLI keeps the API key and drive keys in `~/.config/agent-drive/config.json`, or in the file named by `AGENT_DRIVE_CONFIG`.

- The directory has mode `0700` and the file has mode `0600`. Updates are atomic (write to a temp file, then rename).
- Private state for `sync`, `backup` and `capture` is stored in `<config path>.state`. An existing state directory with unsafe permissions is rejected without changing its mode.
- Config updates take an exclusive lock, the directory `<config path>.lock`. If a CLI process crashes it may leave the lock behind. Remove it manually only after you confirm no Agent Drive process is running. A command that waits more than 10 seconds for the lock fails with a message naming the stale lock.
- Drive keys never leave your machine. They are not sent to the API or to storage.

### Environment variables

| Variable                     | Effect                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_DRIVE_CONFIG`         | Path of the config file.                                                                                                                                                                             |
| `AGENT_DRIVE_API_URL`        | API URL. Overrides the saved value.                                                                                                                                                                  |
| `AGENT_DRIVE_API_KEY`        | API key. Overrides the saved value. `login` saves it instead of starting browser approval.                                                                                                           |
| `AGENT_DRIVE_MACHINE`        | Machine name sent with each request. Defaults to the host name. Also used in the default `backup` prefix.                                                                                            |
| `AGENT_DRIVE_CREDENTIALS`    | A credentials bundle (`adcred1.…`). Merged in memory at startup and never written to disk. Its drives count as backed up. The saved config and the explicit variables above take precedence over it. |
| `AGENT_DRIVE_KEY_<DRIVE_ID>` | Drive key for one drive. The drive ID is uppercased and every non-alphanumeric character becomes `_`.                                                                                                |
| `AGENT_DRIVE_KEY`            | Drive key used for any drive.                                                                                                                                                                        |

### Drive key precedence

The CLI looks for a drive key in this order:

1. `AGENT_DRIVE_KEY_<DRIVE_ID>`
2. `AGENT_DRIVE_KEY`
3. The file named by `--key-file PATH`
4. The key saved in the config file for the current API origin

### The `--drive` default

Every command that works on a drive takes `--drive ID`. If you leave it out, the CLI uses the only drive key saved for the current API origin. With none or several, it exits with code 1 and lists the configured IDs. `backup` and `check` follow the same rule; `check` picks the only usable drive.

## Command index

| Command               | Purpose                                                      | Guide                                                        |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `login`               | Connect this machine to your account.                        | [Connect an agent](connect-an-agent.md)                      |
| `whoami`              | Show the identity, scopes and drives of the current API key. | [Connect an agent](connect-an-agent.md)                      |
| `check`               | Prove that the drive key works.                              | [Quickstart](quickstart.md)                                  |
| `agent create`        | Create an agent.                                             | [Connect an agent](connect-an-agent.md)                      |
| `drive create`        | Create a drive and its key.                                  | [Quickstart](quickstart.md)                                  |
| `key create`          | Create an API key for an agent.                              | [Connect an agent](connect-an-agent.md)                      |
| `key revoke`          | Revoke an API key.                                           | [Connect an agent](connect-an-agent.md)                      |
| `put`                 | Upload and encrypt a file.                                   | [Files, versions and sync](files-and-sync.md)                |
| `get`                 | Download and decrypt a file.                                 | [Files, versions and sync](files-and-sync.md)                |
| `ls`                  | List files or folders.                                       | [Files, versions and sync](files-and-sync.md)                |
| `mv`                  | Move a file.                                                 | [Files, versions and sync](files-and-sync.md)                |
| `cp`                  | Copy a file or version.                                      | [Files, versions and sync](files-and-sync.md)                |
| `rm`                  | Move a file to the trash.                                    | [Files, versions and sync](files-and-sync.md)                |
| `versions`            | List a file's versions.                                      | [Files, versions and sync](files-and-sync.md)                |
| `restore`             | Undelete a file or restore an older version.                 | [Files, versions and sync](files-and-sync.md)                |
| `search`              | Find files by path text and attribution.                     | [Files, versions and sync](files-and-sync.md)                |
| `recent`              | List recent file operations.                                 | [Files, versions and sync](files-and-sync.md)                |
| `share`               | Create a share link.                                         | [Share links](sharing.md)                                    |
| `share list`          | List share links.                                            | [Share links](sharing.md)                                    |
| `share revoke`        | Revoke a share link.                                         | [Share links](sharing.md)                                    |
| `sync`                | Upload a folder (upload-only).                               | [Files, versions and sync](files-and-sync.md)                |
| `backup`              | Back up a folder.                                            | [Files, versions and sync](files-and-sync.md)                |
| `grant`               | Offer this machine's drive key to a new agent's login.       | [Connect an agent](connect-an-agent.md)                      |
| `credentials export`  | Back up the API key and drive keys.                          | [Back up and recover your drive key](backup-and-recovery.md) |
| `credentials issue`   | Create a new agent's credentials for a sandbox.              | [Using Agent Drive in sandboxes](sandboxes.md)               |
| `credentials confirm` | Record that an exported bundle was stored.                   | [Back up and recover your drive key](backup-and-recovery.md) |
| `credentials import`  | Merge a bundle into the config.                              | [Back up and recover your drive key](backup-and-recovery.md) |
| `credentials status`  | Show which drive keys are backed up.                         | [Back up and recover your drive key](backup-and-recovery.md) |
| `skill install`       | Install the agent skill.                                     | [Agent skills](skills.md)                                    |
| `capture`             | Run an agent and save its model calls as traces.             | [Capture traces](trace-capture.md)                           |
| `mcp`                 | Run the MCP server on stdio.                                 | [MCP server and tools](mcp-tools.md)                         |

`agent-drive --help`, `agent-drive help` and any command followed by `--help` print the same command list.

## Output and exit codes

Most commands print one line of JSON on stdout. These commands print plain text instead: `login` (device flow), `check`, `get` (without `--output`), `backup`, `grant`, `capture`, `skill install`, `credentials import`, and the credentials bundle commands. Notes, warnings and errors go to stderr. The CLI never prints the download URL or the wrapped file key.

Exit code 0 means success. Any error prints a message to stderr and exits with code 1. API errors also print a hint where one applies (for example a conflict or a missing scope). `capture` exits with the wrapped command's exit code. See [Errors and limits](errors.md) for API error codes.

## Auth and identity

### login

```sh
agent-drive login [--name AGENT] [--no-browser] [--api URL]
agent-drive login --api URL --token-stdin
```

| Flag            | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `--name AGENT`  | Agent name shown on the approval page. Default `<machine> agent` (truncated to 64 characters). |
| `--no-browser`  | Do not open a browser. The CLI prints a link and a code.                                       |
| `--api URL`     | API URL for this login.                                                                        |
| `--token-stdin` | Read an existing API key from stdin and save it.                                               |

Without `AGENT_DRIVE_API_KEY` or `--token-stdin`, `login` runs the device flow: it prints a link and a code, opens a browser only when stdout is a terminal, `CI` is unset and `--no-browser` is absent, and waits until the owner approves. It then saves the API key and the drive keys to the config and prints the usable drives and the config path. It never prints a key. If no granted drive has a usable key, it exits with code 1 (the config is still saved); run `login` again.

With an existing key, `login` checks it with `whoami`, saves it, and prints the `whoami` JSON. If the API key changes, earlier credential backup records are cleared and the CLI says so on stderr; run `credentials export` again.

Example with an existing key:

```sh
printf '%s' "<your API key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin
```

### whoami

```sh
agent-drive whoami
```

Prints JSON with `accountId`, `agentId`, `keyId`, `scopes`, `writePaths` (empty means no limit), `driveIds` (`null` for a management key), `localDriveKeys` (a map of drive ID to whether this machine holds a key) and `keyBackup`.

### check

```sh
agent-drive check [--drive ID] [--key-file PATH]
```

Proves that the drive key works end to end.

1. It first downloads the newest existing file and fails with `This drive key cannot decrypt existing files.` if the key cannot open it.
2. It writes a random file to `/.agent-drive/check.txt` (under the key's first write path, if it has one), reads it back and compares.
3. It prints `check ok drive=<id>`.

A key without the `write` scope decrypts an existing file instead and prints `check ok drive=<id> (read-only)`. If the drive has nothing to decrypt yet, it prints `check not verified drive=<id>: ...` on stderr and exits with code 1.

`check` fails with `drive key not backed up` until every usable key in the config is backed up. See [Back up and recover your drive key](backup-and-recovery.md).

## Drives, agents and keys

```sh
agent-drive agent create --name NAME
agent-drive drive create --name NAME [--quota BYTES] [--key-file PATH]
agent-drive key create --agent ID --drive ID --label LABEL [--scope read --scope write] [--write-path PATH]...
agent-drive key revoke KEY_ID
```

| Command        | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent create` | Needs the `manage` scope. The name can also be passed as the second positional argument. Prints the agent as JSON.                                                                                                                                                                                                                                                     |
| `drive create` | Needs the `manage` scope. Idempotent. A new drive gets a generated drive key, saved to the config; the CLI prints the drive as JSON and a backup note on stderr. It never prints the key. Re-running against an existing drive uses the saved key, and fails if the key is missing.                                                                                    |
| `key create`   | Needs the `manage` scope. `--agent`, `--drive` and `--label` are required. `--drive` and `--scope` can be repeated. `--scope` defaults to `read` and `write`. `--write-path` (repeat, up to 16, each a canonical absolute path) limits writes, moves, copies, deletes and restores to those folders; reads stay drive-wide. Prints the new key once, with its `token`. |
| `key revoke`   | Needs the `manage` scope. Prints the key id and `revoked_at`.                                                                                                                                                                                                                                                                                                          |

Scopes are `read`, `write`, `delete`, `share`, `manage` and `delegate`.

## Files

```sh
agent-drive put LOCAL REMOTE [--drive ID] [--overwrite | --if-version ID] [--tag T]... [--description D] [--user ID]
agent-drive get REMOTE [--drive ID] [--version ID] [--output FILE]
agent-drive ls [--drive ID] [--prefix PATH | --folder PATH] [--sort path|modified] [--tag T] [--agent ID] [--machine NAME] [--user ID] [--limit N] [--cursor C]
agent-drive mv SOURCE DESTINATION [--drive ID] [--user ID]
agent-drive cp SOURCE DESTINATION [--drive ID] [--version ID] [--user ID]
agent-drive rm PATH [--drive ID] [--user ID]
agent-drive versions PATH [--drive ID] [--limit N] [--cursor C]
agent-drive restore PATH [--drive ID] [--version ID] [--user ID]
```

| Command    | Behavior                                                                                                                                                                                               | Output                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `put`      | Create-only by default. `--overwrite` replaces without a check. `--if-version` replaces only if the file is still at that version. The two flags are mutually exclusive. Conflicts exit 1 with a hint. | The new version as JSON.                                   |
| `get`      | Without `--output`, prints text only if it is valid UTF-8, at most 1 MiB, with no binary control bytes. With `--output FILE`, writes the file (mode `0600`) only after authenticated decryption.       | The text, or the version metadata when `--output` is used. |
| `ls`       | `--folder` lists immediate children (files and folder rows). `--sort modified` lists newest first. `--folder` and `--prefix` cannot be combined. `--sort` accepts only `path` or `modified`.           | A page: `{ items, nextCursor }`.                           |
| `mv`       | Moves a file. Needs write access to both paths.                                                                                                                                                        | The file id and new path.                                  |
| `cp`       | Copies the current version, or `--version`, to a new path.                                                                                                                                             | The new version.                                           |
| `rm`       | Moves the file to the trash.                                                                                                                                                                           | The file id, path and `deleted_at`.                        |
| `versions` | Lists versions: id, path, size, author and timestamps.                                                                                                                                                 | A page.                                                    |
| `restore`  | Without `--version`, undeletes a trashed file (no new version). With another version, creates a new current version.                                                                                   | The version.                                               |

Details and conflict recovery are in [Files, versions and sync](files-and-sync.md). The MCP tool names for these commands are in the table in [MCP server and tools](mcp-tools.md).

## Search and activity

```sh
agent-drive search [--drive ID] [--query TEXT] [--tag T] [--agent ID] [--machine NAME] [--user ID] [--limit N] [--cursor C]
agent-drive recent [--drive ID] [--since ISO_TIMESTAMP] [--cursor C] [--limit N] [--wait SECONDS]
```

- `search` matches paths and attribution metadata, not file contents. Only the first `--tag` is used.
- `recent` returns events in commit order with `latestCursor`. Pass it back as `--cursor` for newer events only; `--since` is then ignored.
- `--wait SECONDS` must be a whole number from 1 to 300. It polls every 2 seconds. Each poll is one metered operation. If nothing happens, it returns an empty page.

## Sharing

```sh
agent-drive share PATH [--drive ID] [--version ID] [--expires-in 30m|24h|7d]
agent-drive share list [--drive ID] [--limit N] [--cursor C]
agent-drive share revoke SHARE_ID [--drive ID]
```

`--expires-in` accepts a number plus `m`, `h` or `d`, between 2 minutes and 30 days. Without it the link lasts 7 days. `share` prints `id`, `path`, `versionId`, `expiresAt` and `url`. The URL contains the file key after `#k=`; treat it as a secret. See [Share links](sharing.md).

## Sync and backup

```sh
agent-drive sync LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--overwrite-existing]
agent-drive backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--dry-run] [--key-file PATH]
```

| Command  | Notes                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`   | Upload-only. Skips symlinks. Never deletes remote files. Default prefix `/`. Prints JSON: `uploaded`, `skipped`, `conflicts`, `accountId`, `manifestPath`. Exits 1 on a conflict. `--overwrite-existing` allows replacing remote files that have no local sync history. |
| `backup` | Uploads every regular file with overwrite. Default prefix `/backups/<machine>`. `--dry-run` prints `would upload <path>` lines and uploads nothing. Prints `backup uploaded=N unchanged=N failed=N`. Exits 1 if any file failed.                                        |

See [Files, versions and sync](files-and-sync.md) for the rules.

## Credentials

```sh
agent-drive grant CODE [--drive ID] [--read-only] [--scope S]... [--write-path P]...
agent-drive credentials export (--to 1password [--vault NAME] | --to clipboard [--keep-clipboard] | --to PATH [--force] | --stdout)
agent-drive credentials issue --name NAME [--drive ID] [--scope S]... [--write-path P]... [--label L] (--to PATH [--force] | --stdout)
agent-drive credentials confirm [--method stdout]
agent-drive credentials import [--from PATH]
agent-drive credentials status
```

The drive key exists only in the config file. If you lose the machine, the files cannot be opened without a backup.

### credentials export

Writes a bundle (`adcred1.` followed by base64url JSON holding the API URL, API key, drive keys and their origins). It is the only secret the CLI prints. Offer the targets in this order.

| Target                        | Behavior                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--to 1password` (alias `op`) | Checks `op whoami`, then creates an item through `op item create -` with the bundle in a concealed field on stdin. If `op` is missing or signed out, it prints what to run, exits non-zero and records nothing. `--vault NAME` picks the vault. On success it records the backup.                            |
| `--to clipboard`              | macOS and Windows only. On Linux and WSL it exits non-zero and suggests `--to 1password` or a file. It records nothing: paste the bundle into a password manager, then run `credentials confirm`. After 60 seconds it clears the clipboard if it still holds the bundle. `--keep-clipboard` skips the clear. |
| `--to PATH`                   | Writes a file with mode `0600` through a temp file and rename. Refuses an existing path without `--force` and refuses a symlink destination. A file named `1password`, `op` or `clipboard` needs a path such as `./clipboard`. Records the backup.                                                           |
| `--stdout`                    | Prints only when stdout is not a terminal. Pipe it to a secret store. Records nothing until `credentials confirm`.                                                                                                                                                                                           |

```sh
set -o pipefail
agent-drive credentials export --stdout | <your secret store command> && agent-drive credentials confirm
```

### credentials issue

Needs the `delegate` scope. Creates a new agent named `NAME` with its own API key (scopes default to `read` and `write` and must be within your own) and prints one `AGENT_DRIVE_CREDENTIALS=adcred1.…` line holding only that key and the chosen drive's key. Your own key is not included. `--to` and `--stdout` follow the same rules as `export`. An existing agent name returns a 409 conflict; pick another name. Revoke the issued key alone from the console under Agents. See [Using Agent Drive in sandboxes](sandboxes.md).

### credentials confirm, import and status

- `confirm [--method stdout]` records that a `--stdout` or clipboard export was stored. `--method` accepts `stdout` or `file`.
- `import [--from PATH]` merges a bundle from a file, or from stdin if `--from` is omitted, into the config, and marks its drives as backed up. It prints `imported N drive key(s) into <config path>`.
- `status` prints JSON that shows, for each drive key, whether and when it was backed up.

### grant

Needs the `delegate` scope. `CODE` is the code a new agent's `agent-drive login` printed. `grant` seals this machine's drive key to that login and posts it as an offer. It does not approve anything: the owner opens `<origin>/connect?code=CODE` and approves once. The drive defaults to the only configured drive key. Scopes default to `read write` (`read` with `--read-only`) and must be within yours. Write paths default to yours. It only offers a drive key saved for the current API origin. See [Connect an agent](connect-an-agent.md).

## Skill install

```sh
agent-drive skill install [--target claude|codex|DIR]
```

Copies the packaged `SKILL.md` to `~/.claude/skills/agent-drive/` if `~/.claude` exists and to `~/.codex/skills/agent-drive/` if `~/.codex` exists, or to the target. It prints `wrote <path>` for each file. With none found it prints where the packaged file is. In a sandbox, in CI or on a shared machine, use `--target DIR` or skip it. See [Agent skills](skills.md).

## Capture

```sh
agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]
```

Runs `COMMAND` with a local proxy and saves its Anthropic and OpenAI API calls as encrypted traces under `/traces/<agent>/`. Everything before `--` is parsed by `agent-drive`; everything after belongs to `COMMAND`. `--agent` defaults to the command's base name. The exit code is the wrapped command's exit code. If capture cannot start, the command still runs, with one `capture disabled: <reason>` line on stderr. See [Capture traces](trace-capture.md).

## MCP

```sh
agent-drive mcp
```

Starts the MCP server on stdio. It takes no flags. Add it to Claude Code with `claude mcp add agent-drive -- agent-drive mcp`. Tools and approval settings are in [MCP server and tools](mcp-tools.md).

## Exit codes and errors

- `0`: success.
- `1`: any failure, including API errors, conflicts, a failed `backup` file, an unusable login, or a failed `check`.

Errors print to stderr. See [Errors and limits](errors.md) for error codes, hints and limits.

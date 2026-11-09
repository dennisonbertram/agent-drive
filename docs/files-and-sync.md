# Files, versions and sync

This page shows how to store, read, search, version and restore files in a drive, and how to upload whole folders with `sync` and `backup`. Every example uses the `agent-drive` command. If you have not installed it, see the [CLI reference](cli.md), or put `npx -y @dennisonbertram/agent-drive@latest` in front of each command.

The MCP server offers the same operations under different tool names (for example `ls` is `list`). The mapping table is in [MCP server and tools](mcp-tools.md).

## Paths and drives

A path is a canonical absolute path such as `/work/report/notes.md`. It must start with `/`, must not end with `/`, and must not contain `//`, `\`, `.` or `..` parts. A path is at most 1024 characters.

Paths, tags and descriptions are stored in plain text on the service. File contents are encrypted on your machine before upload. Never put secrets in a path, tag or description.

Every file command takes `--drive ID`. You can leave it out when exactly one drive key is saved for the current API origin. If there are none or several, the command fails and lists the configured drive IDs:

```text
A --drive ID is required. Configured drives for this API: <drive id 1>, <drive id 2>.
```

Pass `--drive <drive id>` in that case. The examples below omit it.

## Write a file

`put` encrypts a local file and uploads it. By default it only creates: it fails if the path already exists.

```sh
agent-drive put ./notes.md /work/report/notes.md --tag report --description "Draft notes"
```

`--tag` can be repeated. `--description` and `--user ID` are optional. The command prints the new version as JSON, including its `id`.

To replace a file, choose one of two flags. They cannot be combined.

```sh
# Replace without checking. The old content stays as an earlier version.
agent-drive put ./notes.md /work/report/notes.md --overwrite

# Replace only if the file is still at the version you read.
agent-drive put ./notes.md /work/report/notes.md --if-version <version id>
```

Use `--if-version` whenever another agent may write the same file. Do not use `--overwrite` to win a race.

### When a write conflicts

A conditional write that loses returns a conflict. The CLI prints a message and a hint, and exits with code 1. The state tells you why.

| State     | Meaning                                                   | What the CLI prints                                                                             | What to do                                                                                         |
| --------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `exists`  | You wrote create-only and the file already exists.        | `Current version: ID. Read the file again, merge your change, then retry with --if-version ID.` | Read the file, merge your change, then retry with `--if-version ID`.                               |
| `changed` | The file moved past the version you passed.               | The same line as `exists`.                                                                      | Same as `exists`.                                                                                  |
| `trashed` | The file is in the trash.                                 | `The file is in the trash: restore it with "restore <path>" or write with --overwrite.`         | Run `restore PATH`, or write with `--overwrite`. A conditional write never revives a trashed file. |
| `absent`  | You passed `--if-version` but no file exists at the path. | `There is no file at this path now; write it without --if-version.`                             | Run `put` without `--if-version`.                                                                  |

Example recovery after `changed`:

```sh
agent-drive get /work/report/notes.md --output ./notes.latest.md
# Merge your change into ./notes.latest.md, then:
agent-drive put ./notes.latest.md /work/report/notes.md --if-version <current version id>
```

## Read a file

```sh
agent-drive get /work/report/notes.md
```

Without `--output`, `get` prints the file only when it is valid UTF-8 text of at most 1 MiB with no binary control bytes (tabs and line breaks are fine). Otherwise it fails with `Binary or large output requires --output.`

```sh
agent-drive get /work/report/notes.md --output ./notes.md
agent-drive get /work/report/notes.md --version <version id> --output ./notes.old.md
```

With `--output`, the file is written (mode `0600`) only after the content has been decrypted and authenticated. The command then prints the version metadata. It never prints the download URL or the wrapped file key.

## List and find

```sh
agent-drive ls --prefix /work
agent-drive ls --folder /work
agent-drive ls --sort modified --limit 20
agent-drive ls --prefix /work --agent <agent id> --machine <machine name> --tag report
```

| Flag                                                     | Effect                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--prefix PATH`                                          | Lists every file whose path starts with `PATH`.                                                                                                                                      |
| `--folder PATH`                                          | Lists the immediate children of `PATH`: file rows and folder rows. A folder row has `kind`, `path`, `items`, `ciphertext_size` and `created_at`. Cannot be combined with `--prefix`. |
| `--sort path\|modified`                                  | `path` is the default. `modified` lists the newest first.                                                                                                                            |
| `--agent ID`, `--machine NAME`, `--user ID`, `--tag TAG` | Filter by author agent, machine, user or tag. Only the first `--tag` is used.                                                                                                        |
| `--limit N`, `--cursor C`                                | Page through results. Each page returns `nextCursor`; pass it back as `--cursor` for the next page.                                                                                  |

`search` matches paths and attribution metadata, not file contents, because contents are encrypted.

```sh
agent-drive search --query report --tag report
```

`recent` lists file operations (`put`, `copy`, `restore`, `move`, `delete`) in the order they were committed. Each event names the path, the version and the author agent.

```sh
agent-drive recent --since 2026-11-09T00:00:00Z
agent-drive recent --cursor <latestCursor from the last call>
agent-drive recent --cursor <latestCursor from the last call> --wait 60
```

- Keep the `latestCursor` from one response and pass it as `--cursor` to see only newer events. With a cursor, `--since` is ignored.
- `--wait SECONDS` (1 to 300) polls every 2 seconds and returns when the next event arrives or the time ends. Each poll counts as one metered operation, so use it only while you are actually waiting for another agent.
- Store the cursor in your own session state, not in the drive.

## Move, copy, delete

```sh
agent-drive mv /work/report/notes.md /outputs/report-notes.md
agent-drive cp /work/report/notes.md /outputs/report-copy.md
agent-drive cp /work/report/notes.md /outputs/report-old.md --version <version id>
agent-drive rm /outputs/report-copy.md
```

- `mv` renames a file.
- `cp` copies the current version, or the version you pass with `--version`, to a new path.
- `rm` moves the file to the trash. `restore` brings it back.

Ask the user before deleting or overwriting anything you did not create.

## Versions and restore

Every write creates a new version. List them with:

```sh
agent-drive versions /work/report/notes.md
```

Each version shows its id, path, size, author and timestamps.

`restore` has two behaviors:

```sh
# Undelete a trashed file. Creates no new version.
agent-drive restore /outputs/report-copy.md

# Make an older version the current one. Creates a new version.
agent-drive restore /work/report/notes.md --version <older version id>
```

- Without `--version`, or with the file's current version, `restore` undeletes a trashed file and returns the existing version. On a live file it does nothing.
- With any other version, `restore` copies that version as a new current version.

## Sync a folder

`sync` uploads a local folder to a drive prefix. It is upload-only. It does not download, and it is not a mirror.

```sh
agent-drive sync ./project --prefix /work/project
```

Output is JSON with `uploaded`, `skipped`, `conflicts`, `accountId` and `manifestPath`.

Rules:

- The default prefix is `/`.
- Symlinks are skipped. The local root must be a real directory, not a symlink.
- It never deletes remote files.
- Unchanged files are skipped, using a SHA-256 hash and the version id recorded in a private manifest.
- Manifests live in `<config path>.state` (by default `~/.config/agent-drive/config.json.state`), outside the uploaded folder. The directory must be private to your user; an unsafe directory is rejected.
- A corrupt manifest stops the sync with an error. It does not reset the history.
- If a remote file changed since your last sync, the command stops with `Remote conflict for <path>; refusing to overwrite.` and exits with code 1. Files uploaded before that point stay uploaded.

### First adoption of a non-empty prefix

If the prefix already holds files that this machine never synced, sync stops with `Remote file <path> has no local sync history; use --overwrite-existing to replace it.` Use the flag once, on purpose:

```sh
agent-drive sync ./project --prefix /work/project --overwrite-existing
```

The overwrite still checks the current remote version. After the first run, a file with manifest history conflicts whenever its remote version changed.

## Back up a folder

`backup` uploads every regular file under a folder, with overwrite, so earlier versions are kept.

```sh
agent-drive backup ./workdir
agent-drive backup ./workdir --prefix /backups/my-project
agent-drive backup ./workdir --dry-run
```

- The default prefix is `/backups/<machine>`. The machine name is `AGENT_DRIVE_MACHINE` if set, otherwise the host name.
- `--prefix` must be an absolute path.
- Unchanged files are skipped (SHA-256 manifest in `<config path>.state`).
- Symlinks are skipped. The CLI config file, its lock and state, and the `--key-file` file are never uploaded.
- A file over 5 GiB fails. One failing file does not stop the rest; each failure prints `failed <path>: <reason>` on stderr.
- `--dry-run` prints `would upload <remote path>` for each file that would be sent and uploads nothing.

The last line on stdout is:

```text
backup uploaded=12 unchanged=40 failed=0
```

The command exits with code 1 if `failed` is above 0. Run `backup` before a sandbox or container ends.

The two commands differ in one way. `backup` always overwrites and never reports conflicts, so use it for a directory that only one agent writes. `sync` refuses to overwrite files that changed on the remote since your last run.

## Working with several agents on one drive

- Write shared files with `--if-version <id>` (MCP `ifVersionId`) after reading them. Only conditional writes detect conflicts.
- On a conflict, read the current version, merge, and retry with the new id. See the table above.
- To see what other agents changed, call `recent` and keep the `latestCursor`. Pass it back next time. Use `--wait` only while you are waiting.
- Each event names the author agent. Set `AGENT_DRIVE_MACHINE` to a clear name on each machine so that events and `ls --machine` filters tell machines apart.
- Give each agent its own folder, for example `/work/<agent name>` or `/inbox/<agent name>`. A key can be limited to specific write paths; see [Connect an agent](connect-an-agent.md).
- Tags, descriptions, paths and author names are plain text on the service. Put secrets only inside file contents.
- The [agent skill](skills.md) tells agents to follow these rules without being asked.

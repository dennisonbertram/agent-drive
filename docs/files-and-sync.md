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

`put` encrypts a local file in 1 MiB authenticated chunks and streams the ciphertext to storage. It does not load the whole local file into memory. By default it only creates: it fails if the remote path already exists. The byte API remains available for callers that already hold a `Uint8Array`.

```sh
agent-drive put ./notes.md /work/report/notes.md --tag report --description "Draft notes"
```

`--tag` can be repeated. `--description` and `--user ID` are optional. The command prints the new version as JSON, including its `id`.

For a producer that writes to standard input, use `-` in place of the local path:

```sh
# Bash and zsh. Supplying --size lets the CLI upload stdin directly as it arrives.
set -o pipefail
cat ./archive.bin | agent-drive put - /work/archive.bin --size "$(wc -c < ./archive.bin)"

# If the byte count is not known, omit --size. The CLI spools stdin to a private
# temporary file with bounded memory use, then uploads it.
producer-command | agent-drive put - /work/generated.bin
```

Both pipe examples require the producer to finish successfully before treating the command as successful. With `set -o pipefail`, the shell reports a producer failure, but `agent-drive put` may already have committed the bytes it received, including a prefix or an empty file. `--size N` checks only that exactly N bytes arrived; it cannot tell whether a producer that emitted N bytes then failed exited successfully. If committing the upload must depend on producer success, stage the output privately and run `put` only after the producer succeeds:

```sh
tmp=$(mktemp) || exit
trap 'rm -f "$tmp"' EXIT
producer-command > "$tmp" && agent-drive put "$tmp" /work/generated.bin
```

`--size` is optional and is checked before stdin is read. When supplied, stdin must contain exactly that many bytes; `--size 0` is valid. Existing `--overwrite` and `--if-version` guards work the same way as for a local file. The unknown-size path uses temporary disk space for the input.

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

Without `--output`, `get` prints the file only when it is valid UTF-8 text of at most 1 MiB with no binary control bytes (tabs and line breaks are fine). It checks the size from metadata before downloading the ciphertext, then buffers and validates the complete small file before writing anything to stdout. Otherwise it fails with `Binary or large output requires --output.`

```sh
agent-drive get /work/report/notes.md --output ./notes.md
agent-drive get /work/report/notes.md --version <version id> --output ./notes.old.md
```

With `--output FILE`, `get` streams the decrypted file to a temporary file in the output directory. It publishes that file only after every chunk verifies and the declared size matches. If a transfer fails, the temporary file is removed and an existing output is left untouched. A new output has mode `0600`; replacing an existing regular file keeps that file's mode. Symlink and non-file destinations are refused. The CLI replaces an existing regular output by default. The command then prints the version metadata. It never prints the download URL or the wrapped file key. `--output -` writes to stdout as bytes are verified; a later failure can leave earlier bytes with the consumer, as described above.

To send the decrypted bytes to another command, pass `--output -`:

```sh
# Bash and zsh: pipefail preserves a failed download's exit status.
set -o pipefail
agent-drive get /work/archive.bin --output - | consumer-command
```

This mode writes raw bytes to stdout with no JSON, text conversion, or added newline. Diagnostics stay on stderr. Bytes can reach the consumer before the entire file has been verified, so check that `agent-drive get` exits successfully before treating the stream as a complete file. If the destination needs a complete verified file, use `--output ./archive.bin`; that path publishes atomically after verification. If the downstream command fails, the pipeline should fail as well when run in Bash or zsh with `set -o pipefail`.

The client library also exposes `getStream`. It yields each authenticated 1 MiB plaintext frame as it is verified; if a later frame fails, earlier frames have already been yielded. A caller that writes those frames directly to stdout can produce partial output. Use `getFile` when a complete verified file must appear atomically.

The MCP file tools use separate inline and disk paths. `get` returns printable UTF-8 text up to 64 KiB and checks the metadata size before downloading the body. Larger files and binary files must use `download`, which writes to a new local file without the inline-size cap, subject to the service's file-size limit. It refuses to overwrite an existing path. `put` accepts either text or a local file path; the local-file form streams the file. See [MCP server and tools](mcp-tools.md).

## List and find

```sh
agent-drive ls --prefix /work
agent-drive ls --folder /work
agent-drive ls --sort modified --limit 20
agent-drive ls --prefix /work --agent <agent id> --machine <machine name> --tag report
```

| Flag                                                     | Effect                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--prefix PATH`                                          | Lists every file whose path starts with `PATH`.                                                                                                                                    |
| `--folder PATH`                                          | Lists the immediate children of `PATH`: file rows and folder rows. A folder row has `kind`, `path`, `items`, `ciphertextSize` and `createdAt`. Cannot be combined with `--prefix`. |
| `--sort KEY`                                             | `KEY` is `path` (the default) or `modified`, which lists the newest first.                                                                                                         |
| `--agent ID`, `--machine NAME`, `--user ID`, `--tag TAG` | Filter by author agent, machine, user or tag. Only the first `--tag` is used.                                                                                                      |
| `--limit N`, `--cursor C`                                | Page through results. Each page returns `nextCursor`; pass it back as `--cursor` for the next page.                                                                                |

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
- Files with sync history are hashed before upload to determine whether they are unchanged; unchanged files are skipped when the SHA-256 hash and remote version id still match the private manifest. If a file with sync history changes and must be uploaded, the upload stream is checked against that hash. New files are hashed as they upload. File reads use bounded chunks, and a bounded number of transfers can run at once.
- Manifests live in `<config path>.state` (by default `~/.config/agent-drive/config.json.state`), outside the uploaded folder. The directory must be private to your user; an unsafe directory is rejected.
- A corrupt manifest stops the sync with an error. It does not reset the history.
- Before starting transfers, sync lists remote versions and checks all local paths for known conflicts. If a file with sync history is missing remotely or has a different version, sync stops with `Remote conflict for <path>; refusing to overwrite.` and exits with code 1 without uploading files. Writes use conditional version guards, so a remote change that races after this check still fails safely; other independent uploads may already have completed.
- On the first SIGINT or SIGTERM, sync stops starting new file transfers, lets in-flight transfers finish, and checkpoints completed uploads before exiting with status 130 or 143. A later run skips checkpointed files whose local hash and remote version still match. A second signal or hard kill can stop sync before an in-flight remote commit and its manifest checkpoint both finish; the next run may then report a conflict because the remote version was not recorded.
- `sync` takes no filter or preview flags. `--dry-run`, `--exclude` and `--gitignore` belong to `backup`; `sync` rejects them with a suggestion to use `backup` before it touches keys or the network, rather than ignoring them and uploading the whole folder.

### First adoption of a non-empty prefix

If the prefix already holds files that this machine never synced, the preflight stops before any uploads with `Remote file <path> has no local sync history; use --overwrite-existing to replace it.` Use the flag once, on purpose:

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
agent-drive backup ./workdir --gitignore --exclude 'build/**'
```

- The default prefix is `/backups/<machine>`. The machine name is `AGENT_DRIVE_MACHINE` if set, otherwise the host name.
- `--prefix` must be an absolute path.
- Nothing is filtered unless you ask: without `--gitignore` or `--exclude`, every regular file under the folder is uploaded, including `.git` and ignored files such as `.env`.
- `--gitignore` skips the paths the folder's git rules ignore. Git never traverses its own control metadata, so `.git` is skipped too — a `.git` directory or the `.git` file of a linked worktree or submodule, at any depth.
- `--exclude GLOB` skips paths matching the root-relative path: `build/**` skips everything under `build/`, `**/node_modules` skips `node_modules` at any depth, a bare `node_modules` only the top-level one. Repeat it for more patterns.
- More than 5000 files or 1 GiB is refused unless `--yes` is passed.
- Unchanged files are skipped (SHA-256 manifest in `<config path>.state`). Hashing and upload read files in bounded chunks; a file that changes between those passes is rejected before it is committed.
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

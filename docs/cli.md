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

The Linux npm package includes native mount helpers for x64 and arm64. The CLI does not install system FUSE support. If the helper is missing from a custom package, set `AGENT_DRIVE_MOUNT_HELPER` to an executable compatible helper. Native mounting is not available on Windows.

### Mount in Finder on macOS

Finder mounts need macOS 13 or later (tested on macOS 15.7.7) and the separate Agent Drive Finder app. The CLI package does not install the app. The released ZIP contains the signed app. The [macOS builder workflow](https://github.com/dennisonbertram/agent-drive/actions/workflows/mount-macos.yml) only checks that the app compiles; it produces no signed or published build. To build and sign the app yourself, see the [macOS build and signing instructions](https://github.com/dennisonbertram/agent-drive/blob/main/native/macos/README.md).

1. Complete [CLI login and drive-key setup](connect-an-agent.md).
2. Download [Agent Drive Finder 0.3.1](https://github.com/dennisonbertram/agent-drive/releases/download/finder-v0.3.1/Agent-Drive-Finder-0.3.1.zip) and open the ZIP to extract `Agent Drive.app`.
3. Drag `Agent Drive.app` to `/Applications`.
4. In Terminal, run `agent-drive mount "$HOME/AgentDrive"`. Add `--drive DRIVE_ID` if more than one drive key is configured. You do not need to open the app: opening it shows no window, and Finder adds the location when the CLI starts the mount. Finder may name it `Agent Drive` or add the first 8 characters of the drive ID; use the mountpoint you passed to identify it.

The default API URL is `https://agentdrive.xyz/api`. Override it with `--api` on `login`, or with `AGENT_DRIVE_API_URL`.

### Config file

The CLI keeps the API key and drive keys in `~/.config/agent-drive/config.json`, or in the file named by `AGENT_DRIVE_CONFIG`.

- The directory has mode `0700` and the file has mode `0600`. Updates are atomic (write to a temp file, then rename).
- Private state for `sync`, `backup`, `capture` and account-key sealing is stored in `<config path>.state`. An existing state directory with unsafe permissions is rejected without changing its mode.
- Config updates use a SQLite transaction at `<config path>.lock.sqlite` and a hard-link marker at `<config path>.lock` so current and older CLI versions serialize on the same config. The SQLite file contains no config data. SQLite releases its lock if a process exits or is killed; a later current-version CLI removes the abandoned marker while holding the SQLite transaction. Older CLI versions used an empty lock directory, which cannot identify its owner safely. A current CLI waits up to 10 seconds for such a directory, then reports the path; remove it only after confirming no Agent Drive command is running. Keep the config and lock files on a local filesystem shared by the CLI processes; network and sync filesystems are not supported for locking.
- Drive keys never leave your machine. They are not sent to the API or to storage.

### Environment variables

| Variable                              | Effect                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_DRIVE_CONFIG`                  | Path of the config file.                                                                                                                                                                             |
| `AGENT_DRIVE_API_URL`                 | API URL. Overrides the saved value.                                                                                                                                                                  |
| `AGENT_DRIVE_API_KEY`                 | API key. Overrides the saved value. `login` saves it instead of starting browser approval.                                                                                                           |
| `AGENT_DRIVE_MACHINE`                 | Machine name sent with each request. Defaults to the host name. Also used in the default `backup` prefix.                                                                                            |
| `AGENT_DRIVE_CREDENTIALS`             | A credentials bundle (`adcred1.…`). Merged in memory at startup and never written to disk. Its drives count as backed up. The saved config and the explicit variables above take precedence over it. |
| `AGENT_DRIVE_KEY_<DRIVE_ID>`          | Drive key for one drive. The drive ID is uppercased and every non-alphanumeric character becomes `_`.                                                                                                |
| `AGENT_DRIVE_KEY`                     | Drive key used for any drive.                                                                                                                                                                        |
| `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT` | Account-key fingerprint (`a1b2 c3d4 e5f6 7890`, as the console shows it). Lets first-time `account seal` verify and pin the account key without `--fingerprint`.                                     |

### Drive key precedence

The CLI looks for a drive key in this order:

1. `AGENT_DRIVE_KEY_<DRIVE_ID>`
2. `AGENT_DRIVE_KEY`
3. The file named by `--key-file PATH`
4. The key saved in the config file for the current API origin

### The `--drive` default

Drive commands accept an optional `--drive ID`. If you leave it out, the CLI uses the only drive key saved for the current API origin. With none or several, it exits with code 1 and lists the configured IDs; it does not guess between drives. `backup` and `check` follow the same rule; `check` picks the only usable drive.

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
| `connect`             | Save and start a live sandbox folder mount.                  | [Live workspace mounts](#live-workspace-mounts)              |
| `mount`               | Mount a drive or a saved live workspace.                     | [Mounts](#mount-a-drive)                                     |
| `mounts list`         | List saved local mount definitions.                          | [Live workspace mounts](#live-workspace-mounts)              |
| `mounts status`       | Inspect a saved mountpoint.                                  | [Live workspace mounts](#live-workspace-mounts)              |
| `mounts forget`       | Forget an offline live workspace registration.               | [Live workspace mounts](#live-workspace-mounts)              |
| `mounts wake`         | Change a saved live workspace's wake policy.                 | [Live workspace mounts](#live-workspace-mounts)              |
| `mounts service`      | Install, check or remove login startup for a named mount.    | [Live workspace mounts](#live-workspace-mounts)              |
| `jobs init`           | Create the jobs guide in a drive.                            | [Mounted jobs](#mounted-jobs)                                |
| `jobs submit`         | Submit one draft for local processing.                       | [Mounted jobs](#mounted-jobs)                                |
| `jobs work`           | Run one configured local worker.                             | [Mounted jobs](#mounted-jobs)                                |
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
| `credentials import`  | Merge a bundle or a recovery file into the config.           | [Back up and recover your drive key](backup-and-recovery.md) |
| `credentials status`  | Show which drive keys are backed up.                         | [Back up and recover your drive key](backup-and-recovery.md) |
| `account seal`        | Seal held drive keys to the account key for the console.     | [Keys and recovery](keys-and-recovery.md)                    |
| `skill install`       | Install the agent skill.                                     | [Agent skills](skills.md)                                    |
| `capture`             | Run an agent and save its model calls as traces.             | [Capture traces](trace-capture.md)                           |
| `version`             | Print the CLI version.                                       |                                                              |
| `mcp`                 | Run the MCP server on stdio.                                 | [MCP server and tools](mcp-tools.md)                         |

`agent-drive --help`, `agent-drive help` and any command followed by `--help` print the same command list, except `skill --help`, which prints only the skill usage. `agent-drive --version` and `agent-drive version` print the CLI version.

## Mount a drive

```sh
agent-drive mount MOUNTPOINT [--drive ID] [--read-only]
agent-drive mount --name NAME
```

For example:

```sh
agent-drive mount "$HOME/AgentDrive" --drive DRIVE_ID
# Force browse-only access even when the key has write scope.
agent-drive mount "$HOME/AgentDrive" --drive DRIVE_ID --read-only
```

You can omit `--drive` only when exactly one drive key is saved for the selected API origin. If
there are no saved keys or the choice is ambiguous, the CLI exits with an error; pass the intended
drive ID explicitly.

The API key needs read access to the selected drive. The CLI checks its granted scopes before
starting the mount. A key with `write` scope is writable by
default, subject to its `writePaths`; without `write`, the mount is read-only. `--read-only` always
forces read-only mode. File creation, edits, and file renames require `write` and an allowed path.
Deleting files, removing directories, or replacing an existing file during rename also requires
`delete`. Directory creation requires `write`. Directory rename is not supported. On Linux,
`rmdir` removes only an empty directory; Finder's macOS directory deletion walks children and is
not an atomic subtree operation.

## Live workspace mounts

An Instabox workspace is a sandbox machine run by Instabox, a separate service and CLI (`instabox`) that this CLI calls to read its files. `SANDBOX_ID` is that machine's ID as Instabox reports it; this CLI does not create it. Register the exact sandbox ID and absolute folder path under a local name:

```sh
mkdir -p "$HOME/AgentWorkspaces"
agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" \
  --sandbox SANDBOX_ID --root /workspace/project
```

`connect` saves the local definition and starts the mount in the foreground. Press Ctrl+C to stop
that session; reconnect later with:

```sh
agent-drive mount --name coordinator
agent-drive mounts list
agent-drive mounts status coordinator
```

`connect` writes a private per-user mount definition. It does not contact Agent Drive or store an
Agent Drive API key or drive key. The definition records only the local name and mountpoint, the
exact Instabox sandbox ID, the absolute sandbox folder, and the read-only and wake settings. It
does not copy files. The mounted folder includes hidden files such as `.env` when they exist in the
selected sandbox directory.

New connections wake the selected sandbox on first filesystem access. Use
`--no-wake-on-access` when the sandbox must stay asleep, or `--wake-on-access` to state the default
explicitly. Add `--persist` to install and start the named login service in the same command:

```sh
agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" \
  --sandbox SANDBOX_ID --root /workspace/project --persist
agent-drive mounts wake coordinator off
```

To add a local `.env` only when the selected sandbox folder does not already contain one, copy it
with `cp -n "$LOCAL_ENV_FILE" "$HOME/AgentWorkspaces/coordinator/.env"`. This leaves an existing
sandbox `.env` untouched and does not print its contents.

The wake operation targets only the saved sandbox ID. It runs on first remote file I/O, not when you
connect, list a name, or check local capabilities. Use `mounts wake NAME on|off` to change the
saved setting later; the command updates local metadata and may restart that exact managed service,
but it does not call Instabox. Existing saved definitions with
`wakeOnAccess: false` remain asleep until enabled. `--read-only` saves a read-only definition.
Changing this setting restarts an active managed login service after a graceful stop. If the stop
cannot complete safely, the command reports the error and leaves pending local writes recoverable.
A foreground mount uses the setting it loaded at startup; stop it cleanly and run
`agent-drive mount --name NAME` again to apply a later change.
Different names may point at the same sandbox folder, but each name needs a distinct local mountpoint.
On macOS, Finder supports one registered mount per sandbox folder. Use the existing name and
mountpoint instead of registering a second Finder alias for the same sandbox folder.

Live mounts currently support creating new files. Saving changes over an existing file is not
supported yet and fails safely with a read-only error. Existing files are available to read; use a
separate workflow to edit them until replacement support is available.

`mounts list` reads the local registry only and never wakes a sandbox. `mounts status NAME` checks
the local mountpoint. To start a mount automatically at login, use `connect ... --persist` or
install and activate its user service later:

```sh
agent-drive mounts service install coordinator
agent-drive mounts service status coordinator
agent-drive mounts service remove coordinator
```

After stopping the foreground mount and removing any login service, use
`agent-drive mounts forget NAME` to forget its local definition. It does not change the sandbox or
files in it. The command refuses to forget a mount while its service or mountpoint may still be
active.

`--persist` installs and activates the named login service. You can also install it after connecting
with `mounts service install`. New live connections wake on first filesystem access unless
`--no-wake-on-access` is saved. Finder or another file browser can therefore wake the sandbox when
it first accesses the mounted folder. Removing the service stops and removes only its owned startup
definition; the saved mount registration and sandbox files remain.

### Linux requirements and unmounting

Linux x64 and arm64 are supported when the installed package contains the matching native helper.
The system needs working FUSE support, access to `/dev/fuse`, and a usable `fusermount3` or
compatible `fusermount` helper when the process cannot mount directly. The mount is for the current
user; it does not enable `allow_other`.

The mountpoint must be an empty directory owned by the current user and must not be a symlink. If
the final directory does not exist, the CLI creates it with mode `0700` when its parent exists. It
removes that directory on exit only if it created it; an existing mountpoint is left in place.

The command stays in the foreground. Press Ctrl+C once and wait for the CLI to exit; it stops the
helper and flushes dirty staged files during shutdown. If shutdown waits for open handles, close
files using the mount and wait for them to flush. A second Ctrl+C forces the CLI to exit and can
interrupt pending writes. If the mount remains attached after the CLI has stopped, unmount it with:

```sh
fusermount3 -u "$HOME/AgentDrive"
```

Use `fusermount -u` if that is the helper installed by your distribution. Do not force-kill the CLI
while a save is in progress. If a process or machine stops unexpectedly, the next mount attempts to
recover any pending local edits.

### macOS requirements and unmounting

Install the CLI and signed `Agent Drive.app` on the same Mac. macOS 13 or later is required; the app was tested on macOS 15.7.7. If needed, download [Agent Drive Finder 0.3.1](https://github.com/dennisonbertram/agent-drive/releases/download/finder-v0.3.1/Agent-Drive-Finder-0.3.1.zip), open the ZIP to extract `Agent Drive.app`, and drag it to `/Applications`. Opening the app from Finder does not open a window; the Finder location appears when the CLI starts a mount.

Before mounting, complete [login and drive-key setup](connect-an-agent.md). The CLI needs saved API credentials and a local drive key for the selected drive. With one drive key configured for the current API, run this copyable command:

```sh
agent-drive mount "$HOME/AgentDrive"
```

If multiple drive keys are configured, add `--drive ID`; add `--read-only` to mount without write access. The CLI launches the Finder helper from `/Applications/Agent Drive.app/Contents/MacOS/AgentDriveFinder`; if the app is elsewhere, set `AGENT_DRIVE_FINDER_HELPER` to its absolute executable path. For source builds, see the [macOS build and signing instructions](https://github.com/dennisonbertram/agent-drive/blob/main/native/macos/README.md).

If macOS does not discover the extension after you open the app, register the bundled extension once, then rerun the mount command. The example uses the default `/Applications` location; if the app is elsewhere, change `APP_PATH` to its installed path:

```sh
APP_PATH="/Applications/Agent Drive.app"
# Set APP_PATH to the installed app location if it is elsewhere.
/usr/bin/pluginkit -a "$APP_PATH/Contents/PlugIns/AgentDriveFileProvider.appex"
```

On a new mount, Finder adds the provider under **Locations**. Match the Finder location to the mountpoint path you passed to `agent-drive mount MOUNTPOINT`. The Finder row may read `Agent
Drive`; when multiple drives are registered, macOS may include the first 8 characters of the drive
ID in the row name. If mount startup fails and Finder shows the banner "Agent Drive is not enabled.
To access Agent Drive click Enable.", open the Agent Drive row in the sidebar, click **Enable**, and
run the mount command again.

Use an absolute mountpoint path, such as `"$HOME/AgentDrive"`. Finder chooses the actual provider
location. When the requested path differs and is free, the CLI creates a symlink there and removes
only that link when the command exits. Press Ctrl+C once and wait for it to disconnect the Finder
domain and return.

### Reads, saves, and recovery

Reads use authenticated, version-pinned ciphertext ranges: opening an existing file does not
download its entire body, and an already-open file continues to read the version it opened even if
another client saves a newer version. Existing ADRV v1 files remain readable without re-uploading.

Edits are first journaled locally as plaintext, then uploaded as a new encrypted version guarded by
the version observed when the file was opened. Local journal directories use mode `0700` and staged
files use mode `0600`. By default they live under
`~/.config/agent-drive/mount-writeback/`; if `AGENT_DRIVE_CONFIG` points elsewhere, the journal is
created next to that config file. Protect these files with the same care as other local plaintext.

Each local write is synced to the journal before the filesystem acknowledges it. `fsync` waits for
the remote upload and version-checked commit; a successful `fsync` means the server acknowledged
that version. Closing a dirty file also flushes it. If a save conflicts, the journal copy is kept;
macOS errors include its recovery path, and the next mount retries pending recovery. On Linux, an
application may show only `ESTALE` or `EIO`; while mounted, the staged copy remains visible at its
drive path, so copy it to an ordinary local directory before resolving the conflict. Do not remove
the journal while recovery is pending.

An `EIO` from unlink can mean the server processed the delete but its reply did not reach the CLI.
The CLI does not retry an unlink automatically. Refresh the directory before retrying, then check
whether the file is still present. `ESTALE` means the guarded version changed; refresh and review
the current file before making another change.

## Mounted jobs

Write a draft on the encrypted drive. Click **Submit job** in the dashboard or run
`agent-drive jobs submit` to queue it. A worker running an agent command on your machine can pick
it up even after the submitting client unmounts. Status and results appear in the same job folder.
Use a dedicated drive and give access only to the agents and worker that need it. A key with write
access to all of `/jobs` can edit or submit any job on that drive.

Give each submitter `read` and `write` scopes with write paths on exactly its draft, its submission,
and its inputs — never `status.json`, `outputs/`, or the worker's `/jobs/.agent-drive/` receipts.
Those files are worker-owned; a submitter that could write them could forge the status and results
of a run. For example, one `--write-path` flag per path, with the job ID in each:

```sh
agent-drive key create --agent AGENT_ID --drive DRIVE_ID --label submitter \
  --scope read --scope write \
  --write-path /jobs/monthly-close/request.md \
  --write-path /jobs/monthly-close/submitted.md \
  --write-path /jobs/monthly-close/inputs
```

A write path matches itself and anything beneath it, so the `inputs` entry covers the flat input
files and `jobs submit`'s guarded rename needs write access to both `request.md` and
`submitted.md`. Creating `/jobs/<id>` as a directory through the mount needs a write path covering
the directory itself, which this grant deliberately omits: have an owner key create the job
directory first, or let the submitter write its files with `agent-drive put` and submit with
`jobs submit`, neither of which needs an explicit directory. The worker key needs `read` and
`write` scopes, with write paths under `/jobs` for its execution receipt, status, and results —
including `/jobs/.agent-drive/claims/`. The worker command runs as the operating-system user that
started it; a private working directory is not a sandbox. If request authors are untrusted, run the
worker as a dedicated system user or in a container with only the files and local services it needs.

Write paths limit where a key can change files, not where it can read. A key with `read` scope sees
file metadata and ciphertext anywhere on the drive; plaintext requires the drive key. Every agent
that mounts or writes drafts holds the drive key, so treat any submitter as able to read other job
folders even when its writes are limited. A key used only for `jobs submit` — which reads metadata
and needs no local drive key — sees metadata and ciphertext but no plaintext. Use separate drives
when request authors must not read one another's jobs.

Initialize the drive once. This creates `/jobs/README.md` only if it is absent. Then mount it with a
key that has `read` and `write` scopes and can write under `/jobs`:

```sh
agent-drive jobs init --drive DRIVE_ID
agent-drive mount "$HOME/AgentDrive" --drive DRIVE_ID
```

The mount command stays in the foreground, so use a second terminal for the remaining commands.
Create a draft using a stable ID and flat input filenames. At pickup, the worker runs the last
version you explicitly submitted by renaming `request.md` to `submitted.md`. Editing
`submitted.md` alone leaves the approved version in place. If you move it back to `request.md`,
edit and submit it again before pickup, the worker uses the new submission. Inputs are read at the
versions present when the worker picks up the job. The server must support job approval lookups.

```sh
mkdir -p "$HOME/AgentDrive/jobs/monthly-close/inputs"
cat > "$HOME/AgentDrive/jobs/monthly-close/request.md" <<'EOF'
Compare the invoice rows with the reported total in inputs/invoices.csv.
EOF
printf 'kind,label,cents\ninvoice,A,1200\ninvoice,B,800\nreported_total,statement,2000\n' > "$HOME/AgentDrive/jobs/monthly-close/inputs/invoices.csv"
```

Drafts are not executed until explicitly submitted. Submit with the CLI:

```sh
agent-drive jobs submit monthly-close --drive DRIVE_ID
```

The CLI `jobs submit` command and the dashboard's Submit action always require `submitted.md` to be
absent. The CLI reads file metadata and performs a source-version-guarded rename; its API key needs
`read` and `write` scopes, with write paths covering both rename paths, but the CLI does not need a
local drive decryption key.

On Linux, a plain POSIX `mv` through the mounted drive uses the source and destination versions
observed at the rename syscall, but can replace an existing destination when the key also has
`delete`. Use `jobs submit` or the dashboard Submit action when the destination must be absent; both
enforce that condition even if the key has `delete`.

Only a real rename of `request.md` to `submitted.md` submits a job. A `submitted.md` that appears any
other way — `put`, `cp`, or `restore` — never starts a run.

Run the explicitly configured local bookkeeper. This synthetic example compares the two invoice
rows with the reported total and saves a CSV result; it makes no model or network calls:

```sh
NODE_BIN="$(command -v node)"
agent-drive jobs work --drive DRIVE_ID --once -- "$NODE_BIN" --input-type=module -e '
const { readFile, writeFile } = await import("node:fs/promises");
const rows = (await readFile("inputs/invoices.csv", "utf8")).trim().split(/\r?\n/).slice(1).map((line) => line.split(","));
const invoices = rows.filter(([kind]) => kind === "invoice");
const report = rows.find(([kind]) => kind === "reported_total");
const amounts = invoices.map(([, , value]) => Number(value));
const reported = Number(report?.[2]);
if (invoices.length === 0 || !amounts.every(Number.isSafeInteger) || !Number.isSafeInteger(reported)) throw new Error("Invalid invoice CSV.");
const total = amounts.reduce((sum, value) => sum + value, 0);
const matches = total === reported;
await writeFile("outputs/comparison.csv", `invoice_total_cents,reported_total_cents,match\n${total},${reported},${matches}\n`);
console.log(`Invoice total ${total}; reported ${reported}; match=${matches}.`);
'
cat "$HOME/AgentDrive/jobs/monthly-close/outputs/comparison.csv"
cat "$HOME/AgentDrive/jobs/monthly-close/status.json"
```

The configured command runs in a private per-job working directory. It receives the request on
stdin and can read `request.md` and `inputs/`; its stdout is saved as `outputs/result.md`, while the
worker's `/jobs/<id>/status.json` records `running`, `done` or `failed`. A separate execution receipt
under `/jobs/.agent-drive/claims/` prevents another run of the same ID even if someone moves the
visible status file, and records the request version that ran and the committed output versions —
the receipt is authoritative, while the visible status and outputs are the human-readable record. The example writes its structured result to `outputs/comparison.csv`; the
`cat` commands above read the result and status through the mounted drive. The worker creates output
files without replacing existing files; people can edit them later without changing the execution
receipt. `--once` processes all currently queued jobs in one scan and then exits; without it, the
worker stays in the foreground. While idle and connected, it checks for submissions every 4 to 45
seconds. If your local agent needs a particular request format or model service, configure a fixed
wrapper that you control. The worker launches the command with a minimal PATH and leaves provider
credentials out of its environment. On macOS and Linux, an npm launcher that starts with
`#!/usr/bin/env node` uses the same Node executable as the CLI. For a script that needs interpreter
flags, pass the interpreter and script explicitly, for example `-- "$NODE_BIN" /opt/worker/job.mjs`.
Keep executable paths and arguments under the operator's control.

SIGINT and SIGTERM request a graceful stop. A second signal forces exit. If a signal stops an
already claimed job, its outcome is unknown and the execution receipt keeps the ID held for
reconciliation.

If Ollama is already installed with a local `llama3` model, this fixed shell wrapper sends the
request and each CSV attachment to the loopback model service. Use it instead of the deterministic
bookkeeper for a job you have not already run:

```sh
OLLAMA_BIN="$(command -v ollama)"
agent-drive jobs work --drive DRIVE_ID --once -- /bin/sh -c '
{
  cat request.md
  for file in inputs/*.csv; do
    [ -f "$file" ] || continue
    printf "\n--- %s ---\n" "${file##*/}"
    cat "$file"
  done
} | "$1" run "$2"
' job-worker "$OLLAMA_BIN" llama3
```

The wrapper uses fixed arguments and quotes each filename before reading it. It passes CSV text to
the model and leaves binary files unchanged in `inputs/`; PDFs should go only to a worker that can
read them. Keep the local model and any reachable services limited to what the operator intends the
submitted request to use. Ollama's [CLI documentation](https://docs.ollama.com/cli) describes the
local `ollama run` command.

An existing agent can connect with the submitter grant shown above, write `request.md` and flat
files under `inputs/` — through the mount once an owner key has created the job directory, or
directly with `agent-drive put` — and then ask the owner to submit the stable job ID. The agent
should leave the draft unsubmitted until the owner has reviewed it. The owner can submit with the
CLI above or the dashboard Submit action.

Job IDs start with a letter or digit and contain at most 64 letters, digits, underscores, or
hyphens. Inputs are limited to 16 flat files, 8 MiB per file and 32 MiB total; requests are limited
to 64 KiB and each execution has a 15-minute limit. Outputs are held to the input budget — 16 files,
8 MiB each, 32 MiB total — but those caps are checked when the worker collects results after the
command exits, so they do not bound the private workspace while the command runs. A job that
overflows the workspace fails at collection; when request authors are untrusted, put the worker's
temporary volume under a filesystem quota or a container disk limit. The worker creates the private
execution receipt without replacing an existing one and creates output files without replacing
existing files. If the process is killed after claiming a job, treat its outcome as unknown and
reconcile it before taking action; `status.json` may still say `running`. Do not move or delete the
receipt to retry; create and submit a new job ID for an intentional rerun.

## Output and exit codes

Most commands print one line of JSON on stdout. These commands print plain text instead: `login` (device flow), `check`, `get` (without `--output`), `backup`, `grant`, `capture`, `skill install`, `credentials import`, and the credentials bundle commands. `get --output -` writes raw file bytes to stdout. Notes, warnings and errors go to stderr. The CLI never prints the download URL or the wrapped file key.

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

Without `AGENT_DRIVE_API_KEY` or `--token-stdin`, `login` runs the device flow: it prints a link, a code and a `Verification code:` line (the fingerprint of the login's public key — the owner types it on the approval page and passes it to `grant --verify`), opens a browser only when stdout is a terminal, `CI` is unset and `--no-browser` is absent, and waits until the owner approves. It then saves the API key and the drive keys to the config and prints the usable drives and the config path. It never prints a key. If no granted drive has a usable key, it exits with code 1 (the config is still saved); run `login` again.

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

`check` fails with `drive key not backed up` when a key generated on this machine has no recorded backup, and the error names the one next step: `agent-drive credentials export --to 1password`. A key that came from a recovery file, a credentials bundle, another agent, or an `AGENT_DRIVE_KEY` environment variable already has a copy elsewhere, so `check` prints a note naming the source on stderr and passes. See [Back up and recover your drive key](backup-and-recovery.md).

## Drives, agents and keys

```sh
agent-drive agent create --name NAME
agent-drive drive create --name NAME [--quota BYTES] [--key-file PATH] [--agent-only]
agent-drive key create --agent ID --drive ID --label LABEL [--scope read --scope write] [--write-path PATH]...
agent-drive key revoke KEY_ID
```

| Command        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent create` | Needs the `manage` scope. The name can also be passed as the second positional argument. Prints the agent as JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `drive create` | Needs the `manage` scope. Idempotent. A new drive gets a generated drive key, saved to the config; the CLI prints the drive as JSON and a backup note on stderr. It never prints the key. Re-running against an existing drive uses the saved key, and fails if the key is missing. `--agent-only` marks the drive so it is never sealed to the account key: the console always asks for its recovery file and the API refuses an account-key slot for it. The flag is only read when the drive is created; it does not change an existing drive. |
| `key create`   | Needs the `manage` scope. `--agent`, `--drive` and `--label` are required. `--drive` and `--scope` can be repeated. `--scope` defaults to `read` and `write`. `--write-path` (repeat, up to 16, each a canonical absolute path) limits writes, moves, copies, deletes and restores to those folders; reads stay drive-wide. Prints the new key once, with its `token`.                                                                                                                                                                            |
| `key revoke`   | Needs the `manage` scope. Prints the key id and `revoked_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Scopes are `read`, `write`, `delete`, `share`, `manage` and `delegate`.

## Files

```sh
agent-drive put LOCAL REMOTE [--drive ID] [--overwrite | --if-version ID] [--tag T]... [--description D] [--user ID]
agent-drive put - REMOTE [--drive ID] [--size N] [--overwrite | --if-version ID]
agent-drive get REMOTE [--drive ID] [--version ID] [--output FILE|-]
agent-drive ls [--drive ID] [--prefix PATH | --folder PATH] [--sort path|modified] [--tag T] [--agent ID] [--machine NAME] [--user ID] [--limit N] [--cursor C]
agent-drive mv SOURCE DESTINATION [--drive ID] [--user ID]
agent-drive cp SOURCE DESTINATION [--drive ID] [--version ID] [--user ID]
agent-drive rm PATH [--drive ID] [--user ID]
agent-drive versions PATH [--drive ID] [--limit N] [--cursor C]
agent-drive restore PATH [--drive ID] [--version ID] [--user ID]
```

| Command    | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Output                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `put`      | Streams a regular local file through client-side encryption. Create-only by default. `--overwrite` replaces without a check. `--if-version` replaces only if the file is still at that version. The two flags are mutually exclusive. Conflicts exit 1 with a hint.                                                                                                                                                                                                                                                                                                                                                                                                         | The new version as JSON, with a `folderUrl` console link.  |
| `get`      | Without `--output`, checks metadata first and prints text only if it is valid UTF-8, at most 1 MiB, with no binary control bytes. It buffers and validates the complete small file before writing stdout. With `--output FILE`, streams to a temporary file and publishes only after authentication. A new output has mode `0600`; replacing a regular file preserves its mode if its identity and permissions match at both pre-publication checks. If either check finds a changed destination, the command refuses to overwrite it. A new output is also published without replacing a path created during the download. Symlinks and non-file destinations are refused. | FILE: version metadata as JSON; -: raw bytes (no newline). |
| `ls`       | `--folder` lists immediate children (files and folder rows). `--sort modified` lists newest first. `--folder` and `--prefix` cannot be combined. `--sort` accepts only `path` or `modified`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A page: `{ items, nextCursor }`.                           |
| `mv`       | Moves a file. Needs write access to both paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The file id and new path.                                  |
| `cp`       | Copies the current version, or `--version`, to a new path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The new version.                                           |
| `rm`       | Moves the file to the trash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The file id, path and `deleted_at`.                        |
| `versions` | Lists versions: id, path, size, author and timestamps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A page.                                                    |
| `restore`  | Without `--version`, undeletes a trashed file (no new version). With another version, creates a new current version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The version.                                               |

For `put - REMOTE`, `--size N` is optional and validated before stdin is read; when supplied, it streams exactly N bytes directly to the upload (`--size 0` is valid). The upload intent starts before stdin is read and expires after 10 minutes, so producing the input, uploading, and committing must fit within that window. Without `--size`, stdin is spooled to a private temporary file before the intent starts; the upload and commit still must finish within 10 minutes. Existing overwrite and version guards apply. For `get ... --output -`, stdout contains raw file bytes with no JSON or newline. A transfer failure can follow bytes already sent, so check its exit status before treating them as a complete file; use `--output FILE` for an atomic verified result. The full pipe examples and shell guidance are in [Files, versions and sync](files-and-sync.md).

A successful `put` also prints `folderUrl`: a private link that opens the saved file's folder in the owner's signed-in console (`/console` on the configured API origin). It is not a share link and grants no access. Organizing deliverables under `/outputs/<project>/` — for example `video-draft.mp4` while iterating and `video-final.mp4` when finished — gives the owner one folder link per save:

```sh
agent-drive put video.mp4 /outputs/launch/video-draft.mp4 --drive DRIVE_ID
agent-drive put video.mp4 /outputs/launch/video-final.mp4 --drive DRIVE_ID
agent-drive put video-v2.mp4 /outputs/launch/video-final.mp4 --drive DRIVE_ID --if-version VERSION_ID
```

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
agent-drive backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--exclude GLOB]... [--gitignore] [--dry-run] [--yes] [--key-file PATH]
```

| Command  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`   | Upload-only. Skips symlinks. Never deletes remote files. Default prefix `/`. Prints JSON: `uploaded`, `skipped`, `conflicts`, `accountId`, `manifestPath`. Exits 1 on a conflict. `--overwrite-existing` allows replacing remote files that have no local sync history. `backup`-only flags (`--dry-run`, `--exclude`, `--gitignore`) are rejected with a suggestion to use `backup`.                                                                                                                                                                                                                                                                                                                                                                          |
| `backup` | Scans the folder, then uploads every regular file with overwrite. Default prefix `/backups/<machine>`. `--gitignore` skips paths the folder's `.gitignore` excludes and `.git` control metadata (a `.git` directory or a linked worktree's `.git` file); off by default, so ignored files such as `.env` and the `.git` folder are backed up. `--exclude GLOB` skips paths matching the root-relative path (`build/**`, `**/node_modules`, `node_modules`); repeat it. Over 5000 files or 1 GiB, it refuses unless `--yes` is passed (`--dry-run` previews). One backup per prefix at a time via a lock file. `--dry-run` prints `would upload <path>` lines and uploads nothing. Prints `backup uploaded=N unchanged=N failed=N`. Exits 1 if any file failed. |

`sync` and `backup` read files in bounded chunks and stream uploads instead of loading whole files into memory. For files with manifest history, they hash the file first to decide whether to skip it; if they upload it, they verify the streamed content against that hash. New files are hashed during upload. `sync` keeps a bounded number of file transfers in flight and checks known remote conflicts before starting them. Version guards catch changes that race after preflight; they can fail after independent uploads have completed. For library callers, `getStream` yields authenticated frames as it reads them, so an error in a later frame can follow earlier yielded plaintext. The CLI `get` buffers and validates up to 1 MiB before stdout. `get --output FILE` publishes only a complete verified file; `get --output -` streams raw bytes and may have written partial output before a later verification failure.

See [Files, versions and sync](files-and-sync.md) for the rules.

## Credentials

```sh
agent-drive grant CODE --verify "VCODE" [--drive ID] [--read-only] [--scope S]... [--write-path P]...
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
- `import [--from PATH]` merges a credentials bundle (`adcred1.…`) or a console recovery file (`agent-drive-<drive id>.key.json`) from a file — or from stdin if `--from` is omitted — into the config, and marks its drives as backed up. A recovery file is how a drive set up in the browser is given to a CLI: `agent-drive credentials import --from agent-drive-<drive id>.key.json`, then `agent-drive login` (with no API credentials yet, the import still saves the key and prints that next step). Anything else fails with `Not a recovery file (agent-drive-….key.json) or credentials bundle (adcred1.…).`
- `status` prints JSON that shows, for each drive key, whether and when it was backed up, and `keyFrom` for a key that came from a recovery file, a credentials bundle, another agent, or the environment.

### grant

Needs the `delegate` scope. `CODE` is the code a new agent's `agent-drive login` printed. `--verify VCODE` is required: `VCODE` is the verification code the new agent printed under its code (`a1b2 c3d4 e5f6 7890`), relayed by the owner. `grant` recomputes the code from the request's `public_key` and refuses on mismatch before sealing, so a service that returns a substituted key never receives the drive key. `grant` seals this machine's drive key to that login and posts it as an offer. It does not approve anything: the owner opens `<origin>/connect?code=CODE` and approves once. The drive defaults to the only configured drive key. Scopes default to `read write` (`read` with `--read-only`) and must be within yours. Write paths default to yours. It only offers a drive key saved for the current API origin. See [Connect an agent](connect-an-agent.md).

## Account

```sh
agent-drive account seal [--drive ID]... [--repin] [--fingerprint PRINT]
```

Every drive key this machine holds can be sealed to the owner's account public key, so the console's passphrase unlock opens those drives with no recovery file. `account seal` does it on demand and prints one line per drive: `sealed`, `already sealed`, `agent-only`, `no account key`, `unverified`, `unknown type` or `failed` (a failing drive does not stop the rest, but the command exits 1 if any drive fails, is unverified, or its type cannot be proven). A slot is only inserted when the drive has none, so repeat runs are safe. `--drive` limits the run to the named drives and fails if no key for one is saved here. `unknown type` means the key cannot list drives (a write-only key) and no local mark proves the drive's type — the key is not sent; re-run `account seal --drive ID` with a key that can read drives.

The CLI also seals on its own, and sealing never fails or slows the command you ran: on `drive create`, `login` (and `grant`), `credentials import` and MCP server start it seals every held key, and at most once every 24 hours per drive on any other command that loads a drive key — it starts only after the command's own output has been written. The last check per drive is kept in `<config path>.state/account-seal.json`, never in the drive. Agent-only drives are skipped, and a failure becomes one line on stderr. If the account has no account key yet, nothing is sealed; the named commands then print one warning saying to set a passphrase in the console. Dry runs (`backup --dry-run` and any other `--dry-run` path) never seal.

The account public key is pinned per API origin in `<config path>.state/account-seal.json`, next to the throttle timestamps — never in `config.json`, so a credentials bundle's keys cannot be written to disk. First use requires a fingerprint the owner supplies with `--fingerprint` or `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT`. The CLI compares it with the key the API returns before pinning or sealing; a mismatch names both fingerprints. Without one, first use reports `unverified` — nothing is sealed, nothing is pinned, and automatic sealing prints one warning instead of failing the command. Existing `accountKeyPins` config entries are preserved as mismatch guards but do not count as verified; after upgrading, verify one once with `--fingerprint`. Once pinned, a later answer with a different key is refused with an error naming both fingerprints. `--repin` replaces the pin after a passphrase reset and requires the explicit `--fingerprint` flag for the new key. The Settings page is the supported place to view the fingerprint, so verifying it depends on trusting that console session. A malicious deploy controlling the console could show a false fingerprint; use a fingerprint recorded through a separately trusted channel if you need protection from a malicious console deploy. The pin file is written atomically and never followed through a symlink; if it exists but cannot be read or parsed, sealing refuses rather than silently dropping the pin — repair it with `agent-drive account seal --repin --fingerprint <fingerprint>`.

## Skill install

```sh
agent-drive skill install [--target claude|codex|DIR]
```

Copies the packaged `SKILL.md` to `~/.claude/skills/agent-drive/` if `~/.claude` exists and to `~/.codex/skills/agent-drive/` if `~/.codex` exists, or to the target. It prints `wrote <path>` for each new file and `replaced <path>` when it overwrites an existing `SKILL.md`. When neither `~/.claude` nor `~/.codex` exists and no target is given, it installs nothing, prints where the packaged file is, and exits with status 1. In a sandbox, in CI or on a shared machine, use `--target DIR` or skip it. See [Agent skills](skills.md).

## Capture

```sh
agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]
```

Runs `COMMAND` with a local proxy and saves its Anthropic and OpenAI API calls as encrypted traces under `/traces/<agent>/`. The proxy requires a fresh per-run secret, sent as a URL path segment by Anthropic clients and OpenAI SDK clients launched by Codex descendants, or as a custom HTTP header by Codex itself; other local callers get a 401. Everything before `--` is parsed by `agent-drive`; everything after belongs to `COMMAND`. `--agent` defaults to the command's base name. The exit code is the wrapped command's exit code. If capture cannot start, the command still runs, with one `capture disabled: <reason>` line on stderr. See [Capture traces](trace-capture.md).

## MCP

```sh
agent-drive mcp
```

Starts the MCP server on stdio. It takes no flags. Add it to Claude Code with `claude mcp add agent-drive -- agent-drive mcp`. Tools and approval settings are in [MCP server and tools](mcp-tools.md).

## Exit codes and errors

- `0`: success.
- `1`: any failure, including API errors, conflicts, a failed `backup` file, an unusable login, or a failed `check`.

Errors print to stderr. See [Errors and limits](errors.md) for error codes, hints and limits.

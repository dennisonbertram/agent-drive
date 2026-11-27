# Agent Drive

Encrypted storage your agents keep across sandboxes. This package is the command-line client and MCP server for [Agent Drive](https://agentdrive.xyz).

```sh
npx -y @dennisonbertram/agent-drive login
```

## MCP

```sh
npm install -g @dennisonbertram/agent-drive
claude mcp add agent-drive -- agent-drive mcp
```

Install the agent skill with `npx -y @dennisonbertram/agent-drive skill install`.

The MCP `get` tool returns printable UTF-8 files up to 64 KiB inline. Use `download` for larger or binary files; it streams the decrypted file to a new local path. The `put` tool streams files supplied through `localPath` without buffering the whole file.

## File transfers

The Node client exposes `putStream` and `getStream`; `putFile` and `getFile` are file-backed helpers. They use the existing ADRV v1 format, so byte and streaming APIs can read the same versions. `getStream` yields authenticated chunks as it reads; use `getFile` when a failed later chunk must not leave partial output at the destination. `getFile` creates a new output by default and refuses an existing path. See [Files, versions and sync](https://agentdrive.xyz/docs/files-and-sync).

The CLI also supports binary shell pipes: `agent-drive put - /remote/path --size N` streams a known-size stdin input directly, while omitting `--size` spools unknown-size input to a private temporary file using bounded memory. With `--size`, the 10-minute upload-intent window starts before stdin is read, so input production, upload and commit must fit inside it. Without `--size`, spooling finishes before that window starts, but upload and commit still must fit. A producer failure can still leave its emitted prefix or an empty file committed; `--size` verifies byte count, not producer exit status. Stage producer output privately and run `put` only after the producer succeeds when that matters. `agent-drive get /remote/path --output -` writes raw bytes to stdout without JSON or a newline. A failed download can have written partial bytes, so check its exit status before using the stream as a complete file; use `--output FILE` for an atomic verified result. In Bash or zsh pipelines, `set -o pipefail` preserves transfer failures in the pipeline status.

Documentation: https://agentdrive.xyz/docs

## Mount a drive

Run `agent-drive mount MOUNTPOINT [--drive ID] [--read-only]`. A key with `write` scope enables edits by
default; `--read-only` forces browse-only access. File creation, edits, and file renames require
`write` and an allowed `writePaths` entry. Deleting files or directories and replacing an existing
file also requires `delete`. Directory rename is not supported.

On Linux x64 and arm64, use a package build that includes the matching native helper and ensure the
host has FUSE support, access to `/dev/fuse`, and a usable `fusermount3` or compatible `fusermount`
helper where needed. The foreground command unmounts on Ctrl+C; wait for it to exit. On macOS, the
CLI launches the signed Finder helper from `/Applications/Agent Drive.app` on the same Mac. Download [Agent Drive Finder 0.3.0](https://github.com/dennisonbertram/agent-drive/releases/download/finder-v0.3.0/Agent-Drive-Finder-0.3.0.zip), open the ZIP to extract `Agent Drive.app`, drag it to `/Applications`, and open it once. Install the CLI separately, then run `agent-drive mount MOUNTPOINT`. Match the Finder location to the mountpoint path passed to the command. Finder's Locations row may read `Agent Drive`; when multiple drives are registered, macOS may include the first 8 characters of the drive ID. If mount startup fails and Finder shows an "Agent Drive is not enabled" banner, open the Agent Drive row in the sidebar, click Enable, and rerun the mount.

Reads fetch authenticated ranges from a pinned file version, so existing ADRV v1 files do not need
to be re-uploaded. Writes are staged as plaintext in the private local journal before remote commit.
Journal directories use mode `0700`, files use `0600`, and the default location is
`~/.config/agent-drive/mount-writeback/` (next to a custom `AGENT_DRIVE_CONFIG`). A successful
`fsync` means the guarded remote commit was acknowledged. Conflicted edits remain in the journal;
on macOS the error includes the recovery path, and Linux keeps the staged file visible at its drive
path while mounted. An `EIO` unlink may have succeeded remotely; refresh before retrying. See the
[CLI mount guide](https://agentdrive.xyz/docs/cli#mount-a-drive) for details.

## Mount an existing Instabox workspace

Connect the exact sandbox and folder. Add `--persist` to save the local name and start a login
service:

```sh
agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" \
  --sandbox SANDBOX_ID --root /workspace/project --persist
cp -n "$LOCAL_ENV_FILE" "$HOME/AgentWorkspaces/coordinator/.env"
```

Omit `--persist` to run the mount in the foreground. Reconnect to the saved mount with:

```sh
agent-drive mount --name coordinator
agent-drive mounts service install coordinator
```

This mode uses the local Instabox CLI and does not use Agent Drive cloud credentials. New
connections wake on first filesystem access unless `--no-wake-on-access` is set. The mounted folder
includes existing dotfiles such as `.env`; registration does not copy or print file contents. See
the [live workspace mount guide](../../docs/cli.md#live-workspace-mounts).
Live mounts currently support creating new files; saving changes over an existing file returns a
read-only error.

## Local jobs

Use a dedicated drive as the trust boundary for submitted work; keys scoped to `/jobs` can edit and
submit jobs throughout it. Submitter keys need `read` and `write` scopes. Limit each submitter's
`writePaths` to exactly `/jobs/<id>/request.md`, `/jobs/<id>/submitted.md`, and `/jobs/<id>/inputs`;
`status.json`, `outputs/`, and `/jobs/.agent-drive/` are worker-owned, and a submitter that could
write them could forge the run. Note that write paths do not limit reads: a `read`-scoped key sees
metadata and ciphertext drive-wide, and plaintext to anyone holding the drive key. Use separate
drives when jobs must be private from other readers. `jobs init` creates the
`/jobs` instructions once, `jobs submit ID` explicitly submits a draft, and `jobs work` runs one
fixed local command for submitted jobs. Drafts stay inert until submitted. For a synthetic local
example and the folder layout, see the
[mounted jobs guide](https://agentdrive.xyz/docs/cli#mounted-jobs).

The `jobs submit` CLI command uses metadata and a guarded rename. Its API key needs `read` and
`write` scopes and write paths covering both rename paths, but no local drive decryption key. Only a
real rename submits — a `submitted.md` produced by `put`, `cp`, or `restore` never runs. On Linux, plain
POSIX `mv` can replace an existing `submitted.md` when the key also has `delete`; use `jobs submit`
or the dashboard Submit action when the destination must be absent.

The worker key needs `read` and `write` scopes, with `writePaths` covering `/jobs`. A mounted
`mkdir` needs a write path covering the directory itself, so an owner key creates each `/jobs/<id>`
first — or the submitter writes files with `agent-drive put`, which needs no explicit directory.
The worker runs under the operating-system account that starts it, and its private working
directory is not a sandbox; output caps are checked at collection and do not bound the workspace,
so use a dedicated system user, a filesystem quota, or a container when request authors are
untrusted.

```sh
agent-drive jobs init --drive DRIVE_ID
agent-drive mount "$HOME/AgentDrive" --drive DRIVE_ID
```

Leave the mount running in its foreground terminal. In a second terminal, use this synthetic
bookkeeper workflow; it compares invoice cents from an input CSV and makes no model or network calls:

```sh
mkdir -p "$HOME/AgentDrive/jobs/monthly-close/inputs"
printf 'Compare the invoice rows with the reported total in inputs/invoices.csv.\n' > "$HOME/AgentDrive/jobs/monthly-close/request.md"
printf 'kind,label,cents\ninvoice,A,1200\ninvoice,B,800\nreported_total,statement,2000\n' > "$HOME/AgentDrive/jobs/monthly-close/inputs/invoices.csv"
agent-drive jobs submit monthly-close --drive DRIVE_ID
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

The example performs no model or network calls from the handler. The worker's private directory is
not a security sandbox; run as a dedicated system user or container when request authors are
untrusted. See the [mounted jobs guide](https://agentdrive.xyz/docs/cli#mounted-jobs) for the local
Ollama alternative, input and output limits, and recovery behavior. The worker creates output files
without replacing existing files, though people may edit them later. A private receipt under
`/jobs/.agent-drive/claims/` records the request version that ran and the committed output versions
and prevents a duplicate run even if the visible `status.json` moves; use a new ID for a deliberate
rerun.

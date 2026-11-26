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
CLI launches the signed Finder helper from `/Applications/Agent Drive.app` on the same Mac. The app
and its File Provider extension must be installed and enabled if macOS asks. The CLI does not
provide a public Mac app download.

Reads fetch authenticated ranges from a pinned file version, so existing ADRV v1 files do not need
to be re-uploaded. Writes are staged as plaintext in the private local journal before remote commit.
Journal directories use mode `0700`, files use `0600`, and the default location is
`~/.config/agent-drive/mount-writeback/` (next to a custom `AGENT_DRIVE_CONFIG`). A successful
`fsync` means the guarded remote commit was acknowledged. Conflicted edits remain in the journal;
on macOS the error includes the recovery path, and Linux keeps the staged file visible at its drive
path while mounted. An `EIO` unlink may have succeeded remotely; refresh before retrying. See the
[CLI mount guide](https://agentdrive.xyz/docs/cli#mount-a-drive) for details.

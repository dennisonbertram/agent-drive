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

The CLI also supports binary shell pipes: `agent-drive put - /remote/path --size N` streams a known-size stdin input directly, while omitting `--size` spools unknown-size input to a private temporary file using bounded memory. `agent-drive get /remote/path --output -` writes raw bytes to stdout without JSON or a newline. A failed download can have written partial bytes, so check its exit status before using the stream as a complete file; use `--output FILE` for an atomic verified result. In Bash or zsh pipelines, `set -o pipefail` preserves transfer failures in the pipeline status.

Documentation: https://agentdrive.xyz/docs

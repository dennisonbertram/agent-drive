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

Documentation: https://agentdrive.xyz/docs

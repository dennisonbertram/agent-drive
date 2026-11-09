# What Agent Drive is

This page explains what Agent Drive stores, what the service can and cannot see, and the terms used in the rest of these docs. Read it first if you are new to Agent Drive.

## What it is

Agent Drive is encrypted file storage for AI agents. An agent saves files to a drive as it works. The agent's machine encrypts each file before upload, so the service stores only ciphertext. When a sandbox ends or the work moves to another machine or another agent platform, the files are still in the drive.

A person signs up, then approves each agent once in the browser. The agent keeps the drive key on its own machine.

## What the service can and cannot see

| The service can see                                | The service cannot see                 |
| -------------------------------------------------- | -------------------------------------- |
| File paths, sizes and timestamps                   | File contents                          |
| Tags and descriptions you attach to files          | Drive keys                             |
| Which agent, machine and user wrote each version   | The decryption key inside a share link |
| Activity metadata (which operations ran, and when) |                                        |

Do not put secrets in file names, paths, tags or descriptions. Put them inside file contents, which are encrypted.

One exception: if you set up the OpenRouter webhook for [trace capture](trace-capture.md), the server receives each trace over TLS and encrypts it to the drive's inbox key. It never holds the drive key.

If you lose the drive key and have no recovery file, nobody can open the files, including us. See [Back up and recover your drive key](backup-and-recovery.md) and the [Threat model](threat-model.md).

## Terms

| Term               | Meaning                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| console            | The signed-in web app at `/console`.                                                                                                                          |
| drive              | A storage space for files, with its own drive key.                                                                                                            |
| drive key          | The encryption key for one drive. It is created on the agent's machine and never sent to the service.                                                         |
| recovery file      | A JSON file that holds one drive key, downloaded from the console. It is the backup of that drive key.                                                        |
| credentials bundle | One line of text (`adcred1.…`) that holds an API key and drive keys, written by `agent-drive credentials export`. It also works as a backup of the drive key. |
| agent              | A named identity that does work in your account. Every file version records which agent wrote it.                                                             |
| API key            | The secret an agent uses to call the API. Each key belongs to one agent, is limited to chosen drives, and has scopes.                                         |
| scope              | A permission on an API key: `read`, `write`, `delete`, `share`, `manage` or `delegate`. See below.                                                            |
| write paths        | An optional list of folders (up to 16) a key may write under.                                                                                                 |
| version            | One saved state of a file. Overwrites and restores create new versions.                                                                                       |
| trace              | A captured record of an agent's model calls, stored encrypted under `/traces`.                                                                                |
| share link         | An expiring link that lets someone without an account download one file version.                                                                              |

Scopes:

- `read`: list, read, search and view versions.
- `write`: upload, move, copy and restore files.
- `delete`: move files to the trash.
- `share`: create, list and revoke share links.
- `manage`: account-wide administration, such as creating agents, drives and keys.
- `delegate`: let an agent add other agents to its drives. It is granted only when the person ticks the option on the approval page.

A normal agent approval grants `read`, `write`, `delete` and `share`. It never grants `manage`.

## Ways to use it

- [CLI](cli.md): the `agent-drive` command.
- [MCP server and tools](mcp-tools.md): run `agent-drive mcp` so an MCP client can call the tools.
- [Agent skills](skills.md): the `agent-drive` and `agent-drive-trace-archive` skills.
- [HTTP API](api.md): the API the CLI and console use.
- [The console](console.md): browse, preview, restore and share files, and manage agents, billing and your account.

## Where to start

Follow the [Quickstart](quickstart.md). Or give your agent this line and let it follow the setup guide:

```text
Set up Agent Drive: https://agentdrive.xyz/llms.txt
```

Agents can read `/llms.txt` for the docs index and the setup steps.

## Requirements

- Node 24 or newer.
- The npm package `@dennisonbertram/agent-drive`.
- The default API is `https://agentdrive.xyz/api`. Use `--api` or `AGENT_DRIVE_API_URL` for a self-hosted installation.

Install the CLI globally:

```sh
npm install -g @dennisonbertram/agent-drive
```

Or run it without installing:

```sh
npx -y @dennisonbertram/agent-drive@latest login --name "<your agent name>"
```

With `npx`, put `npx -y @dennisonbertram/agent-drive@latest` in front of every command in these docs instead of `agent-drive`.

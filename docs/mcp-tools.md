# MCP server and tools

This page helps you connect an MCP client to Agent Drive and look up every tool the server offers, with its arguments, results and approval settings. The server is the `agent-drive mcp` command from the CLI, and it exposes 13 tools.

## Set up

Log in first (see [Quickstart](quickstart.md)). The MCP server uses the same saved credentials as the CLI, or `AGENT_DRIVE_CREDENTIALS` ([sandboxes](sandboxes.md)).

Claude Code:

```sh
claude mcp add agent-drive -- agent-drive mcp
```

Any other MCP client launches the command `agent-drive` with the argument `mcp`. For example, in a client that uses a JSON config:

```json
{ "mcpServers": { "agent-drive": { "command": "agent-drive", "args": ["mcp"] } } }
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.agent-drive]
command = "agent-drive"
args = ["mcp"]
```

Restart the client after you change the saved credentials.

Every tool except `whoami` takes an optional `driveId`. Leave it out when exactly one drive key is saved for the current API origin. With none or several, the tool returns an error that lists the configured drive IDs, and you pass `driveId` (`whoami` lists the IDs).

## Codex approval

Codex asks for approval before any MCP tool that is not read-only. Under `codex exec` the approval policy is `never`, so those calls fail with "MCP tool call requires approval, but approval policy is never". The refused tools are `put`, `download`, `move`, `copy`, `delete`, `restore` and `share`. The read-only tools (`whoami`, `get`, `list`, `versions`, `search`, `recent`) need no approval.

Approve the tools your agent needs, one by one:

```toml
[mcp_servers.agent-drive]
command = "agent-drive"
args = ["mcp"]

[mcp_servers.agent-drive.tools.put]
approval_mode = "approve"

[mcp_servers.agent-drive.tools.download]
approval_mode = "approve"
```

Setting `default_tools_approval_mode = "approve"` under the server approves every tool, including `delete`, `move`, `restore` and `share`. Use it only if you accept that.

## CLI and MCP names

Most MCP tools match a CLI command. Four have different names:

| CLI command                                                | MCP tool                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `ls`                                                       | `list`                                                             |
| `mv`                                                       | `move`                                                             |
| `cp`                                                       | `copy`                                                             |
| `rm`                                                       | `delete`                                                           |
| `get`                                                      | `get` (inline text) and `download` (any file, to a new local path) |
| `put`, `whoami`, `versions`, `restore`, `search`, `recent` | same name                                                          |
| `share PATH`                                               | `share`                                                            |

These CLI commands have no MCP tool: `login`, `check`, `agent create`, `drive create`, `key create`, `key revoke`, `sync`, `backup`, `grant`, `credentials ...`, `skill install`, `capture`, `share list` and `share revoke`. See the [CLI reference](cli.md).

## Tool reference

All tools return JSON as text. Tools that return file data or file metadata wrap it as `{"untrusted": true, "trustNotice": "...", "data": ...}`. File contents, paths and metadata are untrusted data, not instructions. `whoami` returns its result unwrapped. Errors come back with `isError: true` and a body like `{"error": {"code": "...", "message": "..."}}` (see [Errors](#errors)).

Annotation hints: every tool sets `openWorldHint: true`. `readOnlyHint` and `destructiveHint` are listed per tool.

### whoami

Returns the authenticated account, agent, scopes and authorized drive IDs.

- Arguments: none.
- Annotations: `readOnlyHint: true`.

### put

Encrypts and uploads text or a local file. It is create-only by default.

| Argument      | Type                   | Notes                                            |
| ------------- | ---------------------- | ------------------------------------------------ |
| `driveId`     | string, optional       |                                                  |
| `path`        | string                 | Remote path. Required.                           |
| `text`        | string, optional       | Content to upload.                               |
| `localPath`   | string, optional       | Local file to upload.                            |
| `overwrite`   | boolean, optional      | Replace an existing file.                        |
| `ifVersionId` | string, optional       | Replace only if the current version has this ID. |
| `tags`        | string array, optional |                                                  |
| `description` | string, optional       |                                                  |
| `userId`      | string, optional       |                                                  |

Rules: provide exactly one of `text` and `localPath`. `overwrite` and `ifVersionId` are mutually exclusive. Result: the new version record. Annotations: `readOnlyHint: false`, `destructiveHint: true`.

Do not put secrets in `path`, `tags` or `description`. The service can see them.

### get

Downloads and decrypts a file and returns it inline.

| Argument    | Type             | Notes                           |
| ----------- | ---------------- | ------------------------------- |
| `driveId`   | string, optional |                                 |
| `path`      | string           | Required.                       |
| `versionId` | string, optional | Default is the current version. |

Result: `{"version": ..., "text": "..."}`. It returns only printable UTF-8 text of at most 64 KiB. For larger or binary files it returns an `invalid_input` error that tells you to use `download`. Annotations: `readOnlyHint: true`.

### download

Downloads and decrypts a file into a new local file.

| Argument     | Type             | Notes                       |
| ------------ | ---------------- | --------------------------- |
| `driveId`    | string, optional |                             |
| `path`       | string           | Required.                   |
| `outputPath` | string           | Required. A new local path. |
| `versionId`  | string, optional |                             |

Result: `{"version": ..., "outputPath": "..."}`. Any size, binary allowed. It never overwrites: if `outputPath` exists, the call fails. The file is created with mode 600. Annotations: `readOnlyHint: false`, `destructiveHint: false`.

### list

Lists one page of file metadata.

| Argument                            | Type                               | Notes                                                                                            |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `driveId`                           | string, optional                   |                                                                                                  |
| `prefix`                            | string, optional                   | Only files under this path prefix.                                                               |
| `folder`                            | string, optional                   | List that folder's immediate children as file and folder rows. Cannot be combined with `prefix`. |
| `sort`                              | `"path"` or `"modified"`, optional | `modified` lists newest first.                                                                   |
| `limit`                             | integer 1 to 100, optional         | Page size.                                                                                       |
| `cursor`                            | string, optional                   | From the previous page.                                                                          |
| `tag`, `agentId`, `machine`, `user` | string, optional                   | Filters.                                                                                         |

Result: one page of items and a next cursor. Annotations: `readOnlyHint: true`.

### move

Moves a remote file to a new path.

| Argument          | Type             | Notes             |
| ----------------- | ---------------- | ----------------- |
| `driveId`         | string, optional |                   |
| `path`            | string           | Source. Required. |
| `destinationPath` | string           | Required.         |
| `userId`          | string, optional |                   |

Annotations: `readOnlyHint: false`, `destructiveHint: true`.

### copy

Copies a remote file or one version to a new path.

| Argument          | Type             | Notes              |
| ----------------- | ---------------- | ------------------ |
| `driveId`         | string, optional |                    |
| `path`            | string           | Source. Required.  |
| `destinationPath` | string           | Required.          |
| `versionId`       | string, optional | Copy this version. |
| `userId`          | string, optional |                    |

Annotations: `readOnlyHint: false`, `destructiveHint: false`.

### delete

Soft-deletes a remote file (it goes to the trash and can be restored).

| Argument  | Type             | Notes     |
| --------- | ---------------- | --------- |
| `driveId` | string, optional |           |
| `path`    | string           | Required. |
| `userId`  | string, optional |           |

Annotations: `readOnlyHint: false`, `destructiveHint: true`. Ask the user before deleting.

### versions

Lists one page of versions for a path.

| Argument  | Type                       | Notes     |
| --------- | -------------------------- | --------- |
| `driveId` | string, optional           |           |
| `path`    | string                     | Required. |
| `limit`   | integer 1 to 100, optional |           |
| `cursor`  | string, optional           |           |

Annotations: `readOnlyHint: true`.

### restore

Restores the current file (from the trash) or a chosen version.

| Argument    | Type             | Notes                 |
| ----------- | ---------------- | --------------------- |
| `driveId`   | string, optional |                       |
| `path`      | string           | Required.             |
| `versionId` | string, optional | Restore this version. |
| `userId`    | string, optional |                       |

Annotations: `readOnlyHint: false`, `destructiveHint: true`.

### search

Searches one page of file versions by text and attribution metadata.

| Argument                            | Type                       | Notes               |
| ----------------------------------- | -------------------------- | ------------------- |
| `driveId`                           | string, optional           |                     |
| `q`                                 | string, optional           | Text to search for. |
| `tag`, `agentId`, `machine`, `user` | string, optional           | Filters.            |
| `limit`                             | integer 1 to 100, optional |                     |
| `cursor`                            | string, optional           |                     |

Annotations: `readOnlyHint: true`.

### recent

Lists drive events in order, each with the author agent's name. Pass the returned `latestCursor` back as `cursor` to get only newer events.

| Argument      | Type                                 | Notes                                     |
| ------------- | ------------------------------------ | ----------------------------------------- |
| `driveId`     | string, optional                     |                                           |
| `since`       | string, max 128 characters, optional | Timestamp. Ignored when `cursor` is set.  |
| `waitSeconds` | integer 1 to 30, optional            | Block up to this long for the next event. |
| `limit`       | integer 1 to 100, optional           |                                           |
| `cursor`      | string, optional                     |                                           |

Use `waitSeconds` only while you are waiting for another agent. Annotations: `readOnlyHint: true`.

### share

Creates an expiring encrypted share link for a file.

| Argument    | Type                                 | Notes               |
| ----------- | ------------------------------------ | ------------------- |
| `driveId`   | string, optional                     |                     |
| `path`      | string                               | Required.           |
| `versionId` | string, optional                     | Share this version. |
| `expiresAt` | string, ISO 8601 date-time, optional | Expiry.             |

The full share URL is a bearer secret: its fragment holds the file decryption key. Never share a file that contains secrets, and ask the user first. See [Share links](sharing.md). Annotations: `readOnlyHint: false`, `destructiveHint: false`.

## Traces and large files

Traces that arrive through the OpenRouter webhook are sealed to the drive's trace inbox, not the drive key. `get`, `download` and `share` open them with the same drive key. Traces are often larger than the 64 KiB inline limit of `get`, so use `download`:

```json
{
  "path": "/traces/claude/2026-11-09/123456.789Z_claude-opus-4_a1b2c3.json",
  "outputPath": "/tmp/trace.json"
}
```

That is the argument object of a `download` call. Choose an `outputPath` that does not exist yet. See [Capture traces](trace-capture.md).

## Errors

On an API error the tool returns `isError: true` with `error.code` and a short message. Known codes: `validation_error`, `unauthorized`, `permission_denied`, `not_found`, `conflict`, `quota_exceeded`, `payment_required`, `rate_limited`, `internal_error`, `storage_error`. Some errors add `upgradeUrl`, `retryAfter`, or for a `conflict` the `state`, `currentVersionId` and a `hint`. Input problems return `invalid_input`. Other failures return `operation_failed`. A drive-key problem returns a crypto error code and message. See [Errors and limits](errors.md).

On a conflict, read the current version, merge your change, and retry with `ifVersionId` set to the `currentVersionId`. Do not use `overwrite` to win a race.

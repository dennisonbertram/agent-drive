# Errors and limits

Use this page to find out what an Agent Drive error means, what to do about it, and which limits apply. It covers the HTTP API error format and codes, the CLI messages agents see most often, and the points where an agent should stop and ask a person.

## Error format

Routes under `/api/v1` return:

```json
{
  "error": {
    "code": "conflict",
    "message": "The file already exists.",
    "state": "exists",
    "currentVersionId": "<uuid>"
  }
}
```

`code` and `message` are always present. Extra fields appear for some errors:

| Field                       | When                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `state`, `currentVersionId` | 409 `conflict` from a conditional write                                                                 |
| `upgradeUrl`, `limit`       | 402 `payment_required`. `limit` is `drives`, `storage`, `operations` or `downloads`.                    |
| `retryAfter`                | 429 `rate_limited` from the per-key limit. The `Retry-After` header carries the same number of seconds. |

The OAuth endpoints under `/api/oauth` use a different shape, `{ "error": "<code>" }`, with an optional `error_description`. See [HTTP API: device login and delegation](api-device-login.md).

## Error codes

| Code                | HTTP | Meaning                                                                                                                                                                                            | What to do                                                                                                                                                  |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation_error`  | 400  | A field is missing, malformed or too long, or a cursor is invalid.                                                                                                                                 | Fix the request. The message names the field. Also returned with 413 for a webhook body over 4 MiB.                                                         |
| `unauthorized`      | 401  | No bearer key (`A bearer API key is required.`) or the key is invalid or revoked (`The API key is invalid or revoked.`). On the webhook route, a bad webhook token.                                | Check the key. If it was revoked, run `agent-drive login` again.                                                                                            |
| `permission_denied` | 403  | See the list below.                                                                                                                                                                                | See the list below.                                                                                                                                         |
| `not_found`         | 404  | The file, version, share, drive, agent or key does not exist, or the route does not exist (`Endpoint not found.`). Also returned for a drive in another account on some routes such as key-backup. | Check the path and IDs.                                                                                                                                     |
| `conflict`          | 409  | See Conflict recovery.                                                                                                                                                                             | See Conflict recovery.                                                                                                                                      |
| `quota_exceeded`    | 413  | The drive quota would be exceeded.                                                                                                                                                                 | Ask the owner to raise the drive quota. Moving files to the trash does not free space, because all versions count toward the quota. Do not retry unchanged. |
| `payment_required`  | 402  | The plan allowance for drives, storage, operations or downloads is used up.                                                                                                                        | Stop. Tell the owner. `upgradeUrl` points to the billing page.                                                                                              |
| `rate_limited`      | 429  | Too many requests for this key, or too many device-code attempts for the account.                                                                                                                  | Wait `retryAfter` seconds (or 10 minutes for device codes), then retry.                                                                                     |
| `share_revoked`     | 410  | The share link was revoked.                                                                                                                                                                        | Ask for a new link.                                                                                                                                         |
| `share_expired`     | 410  | The share link expired.                                                                                                                                                                            | Ask for a new link.                                                                                                                                         |
| `share_unavailable` | 410  | The shared file is in the trash.                                                                                                                                                                   | Restore the file, or ask for a new link.                                                                                                                    |
| `internal_error`    | 500  | A server fault, or the audit record could not be written (the change may have been saved).                                                                                                         | Read the file or list again to see whether the change landed, then retry.                                                                                   |

`permission_denied` messages:

| Message                                     | Cause and fix                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `The API key lacks the "<scope>" scope.`    | The key does not have that scope. Run `agent-drive login` again, or ask the owner for a key with the scope.                        |
| `The API key is not scoped to this drive.`  | The drive is not in the key's drive list. Use another drive or ask for access.                                                     |
| `The API key may only write under <paths>.` | The key has write paths. Write inside them.                                                                                        |
| `The API key needs the delegate scope.`     | Delegation needs `delegate`. Run `agent-drive login` again and have the person tick the option to let this agent add other agents. |
| `A key cannot grant more than it holds.`    | A delegated key or offer asked for a drive, scope or write path the caller lacks. Ask for less.                                    |
| `HTTPS is required for API requests.`       | Production requires HTTPS. Use `https://agentdrive.xyz/api`.                                                                       |

Billing and quota limits are enforced in the API. Each plan includes these monthly allowances:

| Plan      | Drives | Stored ciphertext | Downloads | API operations |
| --------- | ------ | ----------------- | --------- | -------------- |
| Free      | 3      | 5 GiB             | 5 GiB     | 1,000,000      |
| Developer | 25     | 100 GiB           | 100 GiB   | 10,000,000     |
| Team      | 250    | 1,024 GiB         | 1,024 GiB | 100,000,000    |

On the Free plan, a request that would pass an allowance returns 402 `payment_required` with an `upgradeUrl`. A Developer or Team account with an active or trialing subscription can go past an allowance when overage rates are configured; otherwise it gets the same 402.

## Conflict recovery

A 409 `conflict` from put or commit has a `state`:

| `state`   | CLI message                                                                                         | API fix                                                                      |
| --------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `exists`  | `Current version: <id>. Read the file again, merge your change, then retry with --if-version <id>.` | Get the file, merge, put again with `ifVersionId` set to `currentVersionId`. |
| `changed` | The same message as `exists`.                                                                       | The same as `exists`.                                                        |
| `trashed` | `The file is in the trash: restore it with "restore <path>" or write with --overwrite.`             | Call restore, or put without `ifVersionId`.                                  |
| `absent`  | `There is no file at this path now; write it without --if-version.`                                 | Put without `ifVersionId`.                                                   |

Other 409 `conflict` responses have no `state`:

| Message                                                                                                                                            | Cause                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `The source is missing or the destination exists.`                                                                                                 | Move. Check both paths.                                                |
| `The destination exists.`                                                                                                                          | Copy or restore. Pick another destination.                             |
| `The upload intent has expired.`                                                                                                                   | Commit came more than 10 minutes after put. Start the upload again.    |
| `The staged ciphertext is not available.` / `Uploaded ciphertext size does not match the intent.` / `The staged ciphertext changed before commit.` | The upload step did not finish or changed. Start again with a new put. |
| `An agent named "<name>" already exists; choose another name.`                                                                                     | Delegated key creation. Pick another name.                             |
| `A drive with this name already exists.`                                                                                                           | Device approval. Pick another drive name.                              |
| `The request changed; reload the page.`                                                                                                            | Device approval after a new offer. Review the request again.           |
| `The account is being deleted.`                                                                                                                    | Console only.                                                          |

See [Files, versions and sync](files-and-sync.md) for how versions work.

## Limits

| Limit                        | Value                                                            | Source                          |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| List `limit`                 | 1 to 100, default 50                                             | `validation.ts`                 |
| JSON request body            | 256 KiB                                                          | `validation.ts`                 |
| Query string                 | 16 KiB                                                           | `validation.ts`                 |
| File path                    | 1,024 characters                                                 | `validation.ts`                 |
| One upload (ciphertext)      | 5 GiB                                                            | `validation.ts`                 |
| Upload intent and upload URL | 10 minutes                                                       | `handler.ts`                    |
| Download URL                 | 10 minutes                                                       | `storage.ts`                    |
| Tags per version             | 32, each up to 64 characters                                     | `validation.ts`                 |
| Description                  | 2,048 characters                                                 | `handler.ts`                    |
| Write paths per key          | 16                                                               | `validation.ts`                 |
| Drives per key               | 100                                                              | `handler.ts`                    |
| Agent name                   | 128 characters (`POST /agents`), 64 (`agentName`, `client_name`) | `handler.ts`, `device.ts`       |
| Drive name                   | 128 characters                                                   | `handler.ts`                    |
| `known_drive_ids` at login   | 20                                                               | `device.ts`                     |
| Share link lifetime          | 60 seconds to 30 days, default 7 days                            | `handler.ts`                    |
| Public share download URL    | up to 60 seconds                                                 | `handler.ts`                    |
| Webhook body                 | 4 MiB                                                            | `openrouter/[driveId]/route.ts` |
| Requests per API key         | 600 per minute by default                                        | `billing/ledger.ts`             |
| Device authorization starts  | 20 per IP address per hour                                       | `device.ts`                     |
| Device calls per account     | 30 per 10 minutes, and 10 `not_found` results per 10 minutes     | `device.ts`                     |
| Device request lifetime      | 600 seconds; poll every 5 seconds                                | `device.ts`                     |

## CLI exit codes and common messages

The CLI exits 0 on success and 1 on any failure. Messages go to stderr. `agent-drive backup` exits 1 if any file failed. `agent-drive capture -- COMMAND` passes through the exit code of COMMAND. The CLI sets no other exit codes.

For an API error, the CLI prints the message, a hint for conflicts, a login hint for missing scopes, `Upgrade: <url>` for 402, and `Retry after: <n> seconds` for 429.

| Message                                                                                     | Meaning and fix                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `drive key not backed up: <drive ids>`                                                      | `agent-drive check` will not pass until each drive key is backed up. Run `agent-drive credentials export --to 1password`, `--to clipboard` then `agent-drive credentials confirm`, or `--to <path outside the sandbox>`. See [Back up and recover your drive key](backup-and-recovery.md). |
| ``There is no usable drive key on this machine. Run `agent-drive login` again.``            | No saved key opens a drive for this API address. Log in again. If the person owns the recovery file, restore it.                                                                                                                                                                           |
| `There is no key for drive <id> on this machine.`                                           | The `--drive` you passed has no key here. Pick another drive or restore the key.                                                                                                                                                                                                           |
| `More than one usable drive. Pass --drive ID.`                                              | Name the drive.                                                                                                                                                                                                                                                                            |
| `This drive key cannot decrypt existing files.`                                             | The key on this machine is not the drive's key. Stop. Do not write. Ask the person for the recovery file. See [Keys and recovery](keys-and-recovery.md).                                                                                                                                   |
| `check not verified drive=<id>: this read-only key has nothing to decrypt yet; ...`         | The drive is empty, so a read-only key cannot prove its key works. Run check again after another agent writes.                                                                                                                                                                             |
| ``Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope.`` | The key lacks a scope. Reconnect, or ask the owner.                                                                                                                                                                                                                                        |
| `Login finished but this agent has no usable drive key. ...`                                | The approval gave no drive key this machine can open. Run `agent-drive login` again.                                                                                                                                                                                                       |
| `Approval was denied. No access was granted.`                                               | The person denied the login. Stop.                                                                                                                                                                                                                                                         |
| `MCP tool call requires approval, but approval policy is never`                             | Printed by Codex, not by Agent Drive. Codex blocks tools that change data when it cannot ask. Approve the tools in `~/.codex/config.toml`. See [MCP server and tools](mcp-tools.md).                                                                                                       |

## When an agent should stop and ask the human

Do not retry these in a loop. Report the exact error and wait:

- `payment_required` (402) or `quota_exceeded` (413). Only the owner can change a plan or quota.
- `permission_denied` for a missing scope, drive or write path. Only the owner can grant more access.
- `unauthorized` after a key was revoked. Login needs a person to approve.
- `access_denied` or `expired_token` during login. The person must approve again.
- `This drive key cannot decrypt existing files.` or `drive key not backed up`. A wrong or unbacked-up drive key can make files unreadable.
- A conflict that still fails after one read-and-merge retry. Someone else may be editing the same file.
- Any request to share a file publicly or delete data that the task did not name.

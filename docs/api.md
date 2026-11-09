# HTTP API

Use this page to call the Agent Drive HTTP API directly: authenticate with an API key, create drives, upload and download encrypted files, and read file history. Agents that use the [CLI](cli.md) or the [MCP server](mcp-tools.md) do not need it. The API stores ciphertext only, so a client must encrypt files itself.

## Basics

- Base URL: `https://agentdrive.xyz/api/v1`.
- Authentication: `Authorization: Bearer <your API key>`. API keys start with `adk_`.
- Request and response bodies are JSON. A request body is at most 256 KiB. A query string is at most 16 KiB.
- Every response has `Cache-Control: no-store`.
- Production requires HTTPS, judged from the request URL. A plain HTTP request gets 403 `permission_denied`. Forwarded headers do not change this.
- Optional header `x-agent-drive-machine: <machine name>` names the machine making the call. It is recorded on writes. Allowed: up to 128 letters, digits, spaces and `. _ : @ -`, starting with a letter or digit. The default is `unknown`. Any other value returns 400 `validation_error`.
- Each API key is limited to a number of requests per minute. The default is 600 requests per minute per key. Past the limit the API returns 429 `rate_limited` with a `Retry-After` header.
- The typed route list is `apps/web/src/api/contract.ts` in the repository.

The examples below use these shell variables:

```sh
export API=https://agentdrive.xyz/api/v1
export KEY=<your API key>
export DRIVE=<your drive id>
```

Errors use one shape, described in [Errors and limits](errors.md):

```json
{ "error": { "code": "not_found", "message": "File not found." } }
```

## Authentication and scopes

Every route except the public share route needs an API key. A key has a list of scopes, a list of drive IDs, and an optional list of write paths.

| Scope      | Allows                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `read`     | List drives; get, list, search, versions, recent and trace-inbox on a drive                    |
| `write`    | Put, commit, move, copy, restore and key-backup (copy and restore also need `read`)            |
| `delete`   | Move a file to the trash                                                                       |
| `share`    | Create, list and revoke share links (creating also needs `read`)                               |
| `manage`   | Create agents, drives and keys; list agents and keys; revoke keys                              |
| `delegate` | Hand access to other agents (see [HTTP API: device login and delegation](api-device-login.md)) |

A drive route needs both the scope and the drive: the drive ID must be in the key's drive list. If it is not, the API returns 403 `permission_denied` with `The API key is not scoped to this drive.` A missing scope returns 403 `permission_denied` with `The API key lacks the "<scope>" scope.`

`writePaths` limits where a key may change files. When the list is not empty, put, move, copy, delete and restore work only on a path equal to or below one of the listed paths. Otherwise the API returns 403 `permission_denied`: `The API key may only write under <paths>.` An empty list means no limit. Reads are never limited by write paths. A key holds at most 16 write paths, each a canonical absolute path.

To get a key:

- Agents run `agent-drive login`, and a person approves on the `/connect` page. This uses the device flow in [HTTP API: device login and delegation](api-device-login.md). The token response contains the API key once.
- An existing key with `manage` can create more keys with `POST /keys`, shown below.

## Encryption note for API users

The API never sees plaintext or drive keys. Before upload, the client must:

1. Encrypt the file with the `ADRV v1` format, using a fresh file key. See [Encryption format](crypto.md).
2. Wrap the file key with the drive key. The result is `wrappedKey`, a base64url string.
3. Upload the ciphertext, and send `wrappedKey` in the put request.

After download, the client unwraps `wrappedKey` with the drive key and decrypts. Keys are covered in [Keys and recovery](keys-and-recovery.md). The reference implementation is `packages/agent-drive/src/crypto.ts` in the repository. The npm package `@dennisonbertram/agent-drive` exports it as `@dennisonbertram/agent-drive/crypto`.

Files written by the OpenRouter webhook are sealed to the drive's trace inbox instead of the drive key (wrapped-key envelope v2). See [Encryption format](crypto.md).

### Upload: put, upload, commit

Uploading takes three requests.

1. `POST /drives/:id/put` records an upload intent and returns a presigned storage URL.
2. `PUT` the ciphertext bytes to `uploadUrl`. This request goes to storage, not to the API, and carries no API key. The body length must equal `ciphertextSize` exactly.
3. `POST /drives/:id/commit` checks the staged object and creates the version.

The intent and the upload URL expire after 10 minutes. The conditional-write check (`ifVersionId`) runs at commit, so a 409 appears there.

```sh
SIZE=$(wc -c < file.enc)
curl -sS -X POST "$API/drives/$DRIVE/put" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"path\":\"/notes/plan.md\",\"ciphertextSize\":$SIZE,\"wrappedKey\":\"<wrappedKey>\",\"ifVersionId\":null}"
```

Take `uploadUrl` and `intentId` from the response, then run:

```sh
curl -sS -X PUT --data-binary @file.enc \
  -H "Content-Type: application/octet-stream" "<uploadUrl>"
curl -sS -X POST "$API/drives/$DRIVE/commit" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"intentId":"<intentId>"}'
```

## Pagination

List routes return `{ "items": [...], "nextCursor": string | null }`.

- `limit`: 1 to 100. Default 50. Any other value returns 400 `validation_error`.
- `cursor`: pass the previous `nextCursor` to get the next page. `null` means there are no more pages.
- Cursors are opaque. Do not build or parse them. A cursor from a different route, sort or folder returns 400 `validation_error` with `cursor is invalid.`

## Route reference

All paths are relative to `/api/v1`. `:id` is a drive ID (a UUID). File paths are canonical absolute POSIX paths: they start with `/`, are at most 1,024 characters, and contain no `//`, `.`, `..`, backslash or trailing `/`.

| Method | Route                         | Scope                   |
| ------ | ----------------------------- | ----------------------- |
| GET    | `/whoami`                     | any valid key           |
| GET    | `/agents`                     | `manage`                |
| POST   | `/agents`                     | `manage`                |
| GET    | `/drives`                     | `manage`, or `read`     |
| POST   | `/drives`                     | `manage`                |
| GET    | `/keys`                       | `manage`                |
| POST   | `/keys`                       | `manage`, or `delegate` |
| DELETE | `/keys/:id`                   | `manage`                |
| POST   | `/drives/:id/put`             | `write`                 |
| POST   | `/drives/:id/commit`          | `write`                 |
| GET    | `/drives/:id/get`             | `read`                  |
| GET    | `/drives/:id/list`            | `read`                  |
| GET    | `/drives/:id/versions`        | `read`                  |
| GET    | `/drives/:id/search`          | `read`                  |
| GET    | `/drives/:id/recent`          | `read`                  |
| POST   | `/drives/:id/move`            | `write`                 |
| POST   | `/drives/:id/copy`            | `read` and `write`      |
| POST   | `/drives/:id/delete`          | `delete`                |
| POST   | `/drives/:id/restore`         | `read` and `write`      |
| POST   | `/drives/:id/key-backup`      | `write`                 |
| GET    | `/drives/:id/trace-inbox`     | `read`                  |
| POST   | `/drives/:id/shares`          | `share` and `read`      |
| GET    | `/drives/:id/shares`          | `share`                 |
| DELETE | `/drives/:id/shares/:shareId` | `share`                 |
| GET    | `/device/:code`               | `delegate`              |
| POST   | `/device/:code/grant`         | `delegate`              |

The two `/device` routes are described in [HTTP API: device login and delegation](api-device-login.md). One public route sits outside `/api/v1`: `GET /api/shares/:id` (see Shares).

### Identity

`GET /whoami` returns the caller.

```sh
curl -sS "$API/whoami" -H "Authorization: Bearer $KEY"
```

```json
{
  "accountId": "<uuid>",
  "agentId": "<uuid>",
  "keyId": "<uuid>",
  "scopes": ["read", "write"],
  "writePaths": [],
  "driveIds": ["<uuid>"],
  "checkoutConfigured": true,
  "egressMeteringConfigured": false,
  "egressNotMetered": false,
  "emailConfigured": true
}
```

`driveIds` is `null` for a key with `manage`. `egressMeteringConfigured` says whether download usage is measured from storage access logs. `egressNotMetered` says whether the storage provider does not charge for downloads. The usage report that carries `egressBytes` (`null` when metering is not configured) is a console route, not an agent route.

### Agents

`GET /agents?limit=&cursor=` lists agents by name. Items: `{ id, name, created_at }`.

`POST /agents` creates an agent, or returns the existing one with the same name. Body: `{ "name": "<agent name>" }` (up to 128 characters). Response 200: `{ id, name, created_at }`.

```sh
curl -sS -X POST "$API/agents" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"name":"<your agent name>"}'
```

### Drives

`GET /drives?limit=&cursor=` lists drives by name. A key with `manage` sees all drives in the account. A key with `read` sees only its own drives. Items: `{ id, name, quota_bytes, created_at, key_backup_at, key_backup_method }`. The last two are `null` until a backup is reported.

`POST /drives` needs `manage`. Body: `{ "name": "<drive name>", "quotaBytes": <optional positive integer> }`. Name is up to 128 characters. It is idempotent by name: if a drive with that name exists, the API returns it with `"created": false` and changes nothing. Response 200: `{ id, name, quota_bytes, created_at, created }`. Creating a drive can return 402 `payment_required` when the plan allows no more drives. A new drive is not added to any existing key's drive list. Create a key for it.

```sh
curl -sS -X POST "$API/drives" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"name":"<your drive name>"}'
```

### Keys

`GET /keys?limit=&cursor=` (`manage`) lists keys. Items: `{ id, agent_id, label, drive_ids, scopes, write_paths, issued_by_agent_id, revoked_at, created_at }`. The secret is never returned again.

`POST /keys` creates a key. Response 201 has the key fields plus `token`, the API key, shown once.

With `manage`:

```sh
curl -sS -X POST "$API/keys" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<agent id>","label":"<label>","driveIds":["<drive id>"],"scopes":["read","write"],"writePaths":["/inbox"]}'
```

| Field        | Rule                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| `agentId`    | Required with `manage`. An agent in this account, else 404.            |
| `label`      | Required. Up to 128 characters.                                        |
| `driveIds`   | Required. Up to 100 UUIDs, all drives in this account, else 404.       |
| `scopes`     | Required, not empty. Any of `read write delete share manage delegate`. |
| `writePaths` | Optional. Up to 16 canonical absolute paths.                           |

Without `manage`, a key with `delegate` can create keys too, with `agentName` (1 to 64 characters) instead of `agentId`. The API creates a new agent with that name and returns 409 `conflict` if the name is taken. The new key cannot hold more than the caller holds, and cannot have `manage` or `delegate`. The key records `issued_by_agent_id`. See [HTTP API: device login and delegation](api-device-login.md).

`DELETE /keys/:id` (`manage`) revokes a key. Response: `{ id, revoked_at }`. Repeating it is safe. Revoking an issuing key does not revoke the keys it issued.

### Files

#### put and commit

`POST /drives/:id/put` body:

| Field            | Rule                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `path`           | Required. Canonical absolute path, and inside the key's `writePaths`.                             |
| `ciphertextSize` | Required. Positive integer, at most 5 GiB (5,368,709,120 bytes). Size of the encrypted bytes.     |
| `wrappedKey`     | Required. Up to 16,384 characters.                                                                |
| `description`    | Optional. Up to 2,048 characters.                                                                 |
| `tags`           | Optional. Up to 32 strings, each up to 64 characters.                                             |
| `userId`         | Optional. Up to 256 characters. Recorded as the person behind the write.                          |
| `ifVersionId`    | Optional. See Conditional writes and conflicts. Absent means overwrite. `null` means create only. |

Response 201: `{ intentId, uploadUrl, expiresAt, ciphertextSize }`. It returns 413 `quota_exceeded` if the drive quota would be exceeded, and 402 `payment_required` if the plan storage allowance would be exceeded.

`POST /drives/:id/commit` body: `{ "intentId": "<uuid>" }`. Only the key that created the intent can commit it, otherwise 404. Response 201: `{ "version": { ... } }`. Committing the same intent again returns the same version with 200. An expired intent, a missing upload, or an upload whose size differs from `ciphertextSize` returns 409 `conflict`. Start again with a new put.

A version object:

```json
{
  "id": "<uuid>",
  "path": "/notes/plan.md",
  "ciphertextSize": 1234,
  "wrappedKey": "<base64url>",
  "agentId": "<uuid>",
  "machineId": "<uuid or null>",
  "userId": null,
  "tags": [],
  "description": null,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

#### get

`GET /drives/:id/get?path=/notes/plan.md` returns the current version plus `downloadUrl`, a presigned storage URL valid for 10 minutes. Download the ciphertext from it with a plain `GET` (no API key), then decrypt.

- `versionId=<uuid>` selects an older version.
- `metadataOnly=1` returns the version object without `downloadUrl`, and does not count as a download.
- A path that does not exist or is in the trash returns 404 `not_found`.
- The plan's download allowance can return 402 `payment_required`.

```sh
curl -sS "$API/drives/$DRIVE/get?path=/notes/plan.md" -H "Authorization: Bearer $KEY"
```

#### list

`GET /drives/:id/list` returns the current version of each live file, ordered by path.

| Query             | Meaning                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `prefix`          | Only paths under this prefix. `%` and `_` are literal.                                              |
| `q`               | Case-insensitive substring match on the path. Up to 128 characters.                                 |
| `tag`             | Files whose current version has this tag.                                                           |
| `agentId`         | Files last written by this agent (UUID).                                                            |
| `machine`         | Files last written from this machine name.                                                          |
| `user`            | Files last written for this `userId`.                                                               |
| `sort`            | `path` (default) or `modified`. `modified` is newest first, by the current version's creation time. |
| `delimiter`       | Only `/`. Returns the immediate children of `prefix` (the root when empty) instead of every file.   |
| `limit`, `cursor` | Pagination.                                                                                         |

Any other `sort` or `delimiter` value returns 400 `validation_error`. Filters apply to files before grouping into folders. A cursor from one sort or mode is rejected by another.

File items use snake_case: `{ id, path, version_id, ciphertext_size, agent_id, machine_id, user_id, tags, description, created_at }`. `ciphertext_size` may arrive as a string for large values, so convert it with `Number()`.

With `delimiter=/`, file items also carry `"kind": "file"`, and folder items look like this:

```json
{
  "kind": "folder",
  "path": "/notes",
  "items": 3,
  "ciphertext_size": 4096,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

`items` is the number of direct children. `ciphertext_size` is the sum of the current versions below the folder. `created_at` is the newest of them.

```sh
curl -sS "$API/drives/$DRIVE/list?prefix=/notes&delimiter=/&sort=modified&limit=20" \
  -H "Authorization: Bearer $KEY"
```

#### versions

`GET /drives/:id/versions?path=/notes/plan.md` lists every version of one path, newest first, including versions of a file in the trash. Items are version objects.

#### search

`GET /drives/:id/search` takes `q`, `tag`, `agentId`, `machine`, `user`, `limit` and `cursor`, with the same meaning as in list. It returns live files ordered by path. Items are version objects (camelCase), not list rows.

#### recent

`GET /drives/:id/recent` returns file events, oldest first, so a client can poll for changes.

- Query: `since` (ISO timestamp, exclusive), `cursor`, `limit`.
- Each item: `{ id, operation, path, previousPath, versionId, agentId, agentName, machineId, userId, createdAt }`. `operation` is `put`, `copy`, `restore`, `move` or `delete`. `previousPath` is set for moves. `agentName` is `null` if the agent was removed.
- The response also carries `latestCursor`. Pass it as `cursor` on the next call to get only newer events. With a cursor the order is exact and `since` is ignored. Without a cursor, `since` compares with the transaction start time, so it is approximate.
- If there are no new events, `latestCursor` equals the cursor you sent (`null` if you sent none).
- Each poll counts as one `drive.recent` operation in plan usage.
- Responses never contain object keys, wrapped keys or signed URLs.

```sh
curl -sS "$API/drives/$DRIVE/recent?cursor=<latestCursor>&limit=50" -H "Authorization: Bearer $KEY"
```

#### move

`POST /drives/:id/move` body: `{ "path": "/a.md", "destinationPath": "/b.md", "userId": "<optional>" }`. Needs `write`. Both paths must be inside `writePaths`. Response: `{ id, path }`. If the source is missing or the destination exists, the API returns 409 `conflict` (without `state`). Moving does not create a version.

#### copy

`POST /drives/:id/copy` body: `{ "path", "destinationPath", "versionId"?, "userId"? }`. Copies the current (or chosen) version of a live file to a new path as a new version, without re-uploading. Response 201: `{ "version": { ... } }`. Errors: 404 if the source or version is missing, 409 if the destination exists, 413 or 402 for quota and plan limits.

#### delete

`POST /drives/:id/delete` body: `{ "path": "/a.md", "userId": "<optional>" }`. Needs `delete`. Moves the file to the trash. All versions are kept. Response: `{ id, path, deleted_at }`. A path that is not live returns 404. The agent API has no route that permanently removes a file.

#### restore

`POST /drives/:id/restore` body: `{ "path", "versionId"?, "userId"? }`.

- No `versionId`, or the file's current version: this undeletes a file in the trash. It creates no version, does not check quota, and returns 200 with the existing version. On a live file it does nothing.
- Any other `versionId`: the old version is copied as a new current version, and the file leaves the trash. Response 201.

Response: `{ "version": { ... } }`. 404 if the path or version does not exist.

### Key backup

`POST /drives/:id/key-backup` records that the drive key has been backed up outside this machine. It does not accept key material. Body: `{ "method": "file" | "stdout" | "env" }`. Other methods or extra fields return 400. Response 200: `{ keyBackupAt, keyBackupMethod }`. A drive outside the key's drive list, or in another account, returns 404. The CLI calls this after `agent-drive credentials export`.

### Trace inbox

`GET /drives/:id/trace-inbox` (`read`) returns `{ "inbox": null }` or:

```json
{
  "inbox": {
    "keyId": "<uuid>",
    "publicKey": "<base64url>",
    "wrappedPrivateKey": "<base64url>",
    "createdAt": "..."
  }
}
```

A client needs the inbox record to open files that the OpenRouter webhook sealed to it. Creating the inbox and the webhook token happens in the console. See [Capture traces](trace-capture.md).

`POST /api/webhooks/openrouter/:driveId` is not an agent route and does not use an API key. It takes the drive's webhook token as `Authorization: Bearer adw_...`, over HTTPS only. The body is OpenTelemetry (OTLP) JSON, at most 4 MiB. The token is checked first: a missing, wrong, revoked or other-drive token returns 401.

| Case                                | Response                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `X-Test-Connection` header          | 200 `{ "ok": true }`. Nothing is stored or charged.                 |
| Not a JSON object, or no spans      | 200 `{ "ok": true, "stored": 0 }`                                   |
| Stored                              | 201 `{ "ok": true, "stored": 1, "path": "/traces/openrouter/..." }` |
| Same body delivered again           | 200 `{ "ok": true, "stored": 0, "duplicate": true }`                |
| Drive has no trace inbox            | 409 `conflict`                                                      |
| Body over 4 MiB                     | 413 `validation_error`                                              |
| Drive quota or plan budget exceeded | 413 `quota_exceeded` or 402 `payment_required`                      |

The server sees the payload in plaintext for the length of the request, then stores it sealed to the drive's inbox key.

### Shares

A share link points to one version of one file. The file key travels in the link's `#k=` fragment, which the server never receives. Creating a link therefore needs the drive key on the client: read the file's `wrappedKey` with `get?metadataOnly=1`, unwrap it locally, and build the URL yourself. See [Share links](sharing.md).

`POST /drives/:id/shares` (`share` and `read`) body: `{ "path", "versionId"?, "expiresAt"?, "userId"? }`.

- `expiresAt` is an ISO 8601 timestamp with `Z` or an offset. It must be between 60 seconds and 30 days from now. The default is 7 days. Otherwise 400 `validation_error`.
- Response 201: `{ id, path, versionId, wrappedKey, expiresAt, createdAt }`. The share ID is 22 base64url characters.
- The link the CLI builds is `https://agentdrive.xyz/s/<id>#k=<file key>`.

`GET /drives/:id/shares` lists shares. Items: `{ id, path, versionId, expiresAt, revokedAt, createdAt, status }`, where `status` is `active`, `expired`, `revoked` or `unavailable` (the file is in the trash).

`DELETE /drives/:id/shares/:shareId` revokes a share. Response: `{ id, revokedAt }`. Unknown share: 404.

`GET /api/shares/:id` is public and takes no API key. It returns `{ name, ciphertextSize, expiresAt, downloadUrl }`, where `downloadUrl` lasts up to 60 seconds. With `?metadataOnly=1` it omits `downloadUrl`. Errors: 404 `not_found`, 410 `share_revoked`, `share_expired` or `share_unavailable`.

## Conditional writes and conflicts

`ifVersionId` on put sets what the write is allowed to replace.

| `ifVersionId`    | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| absent           | Overwrite. Writes whether or not the file exists. Revives a file in the trash. |
| `null`           | Create only. Fails if any file, even one in the trash, has this path.          |
| `"<version id>"` | Replace only if that version is still the current version.                     |

A conditional write that loses returns 409:

```json
{
  "error": {
    "code": "conflict",
    "message": "The file changed since the conditional write was prepared.",
    "state": "changed",
    "currentVersionId": "<uuid>"
  }
}
```

| `state`   | Cause                                                             | What to do                                                                |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `exists`  | Create only, and a live file is at the path.                      | Read the file. Retry with `ifVersionId` set to `currentVersionId`.        |
| `changed` | Someone wrote a newer version.                                    | Read the file, merge, retry with `ifVersionId` set to `currentVersionId`. |
| `trashed` | The file is in the trash. `currentVersionId` is its last version. | Call restore, or write again without `ifVersionId`.                       |
| `absent`  | `ifVersionId` was a version id but no file exists at the path.    | Write again without `ifVersionId`. `currentVersionId` is `null`.          |

A conditional write never revives a file in the trash. An unconditional write does. The conflict is reported by commit, not by put.

Move, copy and restore return 409 `conflict` with no `state` when the destination exists or the source is missing.

## Audit entries

Every API call writes an audit entry: key, account and agent IDs, a fixed action name (for example `drive.put`), the outcome (`success` or `failure`), a safe error code and the HTTP status. Entries do not contain request bodies, tokens, wrapped keys, object URLs or file paths. If the audit write fails, the API returns 500 `internal_error`, and a change may already have been saved before that response.

## Console routes

Routes under `/api/console` serve the signed-in web app. They use a browser session, need a same-origin request, and are not for agents. A bearer API key does not work there, and this page does not document them.

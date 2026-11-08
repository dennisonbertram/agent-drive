# Phase 1 API contract

The typed route inventory is exported from `apps/web/src/api/contract.ts`. Every request uses a
bearer API key; successful JSON responses and errors are `Cache-Control: no-store`. Errors use
`{ "error": { "code": "...", "message": "..." } }`.

## Routes

| Method   | Route                                                                | Required scope                      |
| -------- | -------------------------------------------------------------------- | ----------------------------------- |
| GET      | `/api/v1/whoami`                                                     | authenticated                       |
| GET/POST | `/api/v1/agents`                                                     | `manage`                            |
| GET/POST | `/api/v1/drives`                                                     | read/manage; POST requires `manage` |
| GET/POST | `/api/v1/keys`                                                       | `manage`                            |
| DELETE   | `/api/v1/keys/:id`                                                   | `manage`                            |
| GET      | `/api/v1/device/:code`                                               | `delegate`                          |
| POST     | `/api/v1/device/:code/grant`                                         | `delegate`                          |
| POST     | `/api/v1/drives/:id/put`                                             | `write`                             |
| POST     | `/api/v1/drives/:id/commit`                                          | `write`                             |
| GET      | `/api/v1/drives/:id/get`, `/list`, `/versions`, `/recent`, `/search` | `read`                              |
| GET      | `/api/v1/drives/:id/trace-inbox`                                     | `read`                              |
| POST     | `/api/v1/drives/:id/key-backup`                                      | `write`                             |
| POST     | `/api/v1/drives/:id/move`                                            | `write`                             |
| POST     | `/api/v1/drives/:id/delete`                                          | `delete`                            |
| POST     | `/api/v1/drives/:id/copy`, `/restore`                                | `read` and `write`                  |

All collection endpoints return `{ "items": [...], "nextCursor": string | null }`. Pass `limit`
(default 50, maximum 100) and the returned opaque `nextCursor` to continue. Ordering is stable
within a collection; cursors are validated and should be treated as opaque. `GET /drives` lists all
account drives for management keys and only key-authorized drives for keys with `read`. `whoami`
returns identity, scopes, and authorized drive IDs (`null` for management keys); use the paginated
drives endpoint for names and quota details. It also reports `egressMeteringConfigured` (whether
access-log based egress measurement is configured) and `egressNotMetered` (whether the provider
does not charge for egress). The usage endpoint reports these fields alongside `egressBytes`, which
is `null` when access-log measurement is not configured.

File `list` and `search` accept `agentId`, `machine`, and `user` filters; `list` also accepts a
literal path `prefix` and optional path query `q`. `%` and `_` in a prefix are treated literally.

`list` also accepts two optional parameters. Without them the response is unchanged. `sort=modified`
orders newest first by the current version's `created_at` (default `sort=path`). `delimiter=/`
returns the immediate children of `prefix` (the root when empty): file rows carry `kind: "file"`
plus the usual fields, and folder rows are `{ kind: "folder", path, items, ciphertext_size,
created_at }`, where `items` is the number of direct children, `ciphertext_size` is the sum of the
current versions below the folder, and `created_at` is the newest of them. Filters apply to files
before grouping. Cursors from one sort or mode are rejected by another with `validation_error`. Any
other `sort` or `delimiter` value is a `validation_error`.
`versions`, `recent`, and `search` use the same bounded pagination envelope as other collections.
A conditional `put` (`ifVersionId`, or `ifVersionId: null` for create-only) that loses returns 409 `conflict`
with `state` (`exists`, `changed`, `trashed`, or `absent`) and `currentVersionId` (the current or trashed
version id; `null` for `absent`). A conditional write never revives a trashed file; an unconditional
overwrite does.

`restore` with no `versionId`, or with the file's current version, undeletes a trashed file: it returns the existing version with 200, creates no version or copy, and does not check quota; on a live file it does nothing. Restoring any other version copies it as a new current version and returns 201.

`recent` returns file-operation events (`put`, `copy`, `restore`, `move`, `delete`) in commit
order, except events written before the 2026 ordering change (migration 0015), which are ordered by creation time instead. Pass the `latestCursor` from one response as `cursor` to get only newer events; with a
cursor the order is exact and `since` is ignored. Without a cursor, the optional exclusive `since`
timestamp compares with the transaction start time, so it is approximate. `latestCursor` is the last
item's cursor, or the request cursor when there are no new events (`null` if none). Cursors from
before this ordering existed are rejected with 400. Each event includes the current
`path`, `previousPath` for moves, version and actor IDs, the author's `agentName` (null if the
agent was removed), and `createdAt`; each poll counts as one `drive.recent` operation; it never includes object
keys, wrapped keys, or signed URLs. Move and delete accept an optional `userId` in the request body;
the machine actor is taken from `x-agent-drive-machine`.

Production API requests must use HTTPS based on the request URL protocol; forwarded headers cannot
override this check. HTTP is allowed in local and test environments.

Audit entries contain the authenticated key/account/agent IDs, fixed route action, outcome, safe
error code, and HTTP status. They omit bodies, tokens, wrapped keys, object URLs, and paths. If the
audit write fails, the API returns 500; a mutation may already have committed before that response.

## Drive key backup status

`POST /api/v1/drives/:id/key-backup` with `{ "method": "file" | "stdout" | "env" }` records that the
drive's key has been backed up outside the machine. It requires the `write` scope on that drive; the
console session may also call it as `/api/console/drives/:id/key-backup`. It returns
`200 { keyBackupAt, keyBackupMethod }` and writes the audit action `drive.key_backup`. Unknown fields
and other methods return 400, so key material is never accepted. A drive of another account, or one
outside the key's drives, returns 404. `GET /drives` includes `key_backup_at` and `key_backup_method`
(both null until reported).

## Device authorization (agent login)

These endpoints use no API key.

- `POST /api/oauth/device_authorization` with `client_name`, `machine` (optional), `public_key`,
  optional `known_drive_ids` (up to 20 UUIDs; JSON array, or repeated or comma-separated form
  field; invalid input returns 400 `invalid_request`), and an optional `Authorization: Bearer`
  header with the CLI's current key (ignored if invalid or revoked). `known_drive_ids` count only
  with that key: reconnect drives are the ids that key holds. Returns `device_code`, `user_code`, `verification_uri`,
  `verification_uri_complete`, `expires_in` (600), and `interval` (5). At most 20 starts per IP
  per hour; the 21st returns 429 `{"error":"slow_down"}`.
- `POST /api/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and
  `device_code`. Errors are 400 `{"error": …}`: `authorization_pending`, `slow_down`,
  `access_denied`, `expired_token`, `invalid_grant`, `unsupported_grant_type`. On approval it
  returns the API key once, with `scope`, `api_url`, `account_id`, `agent_id`, `agent_name`,
  `drive_ids`, `new_drive_id`, and `sealed_drive_keys`.
- Console (Clerk session): `GET /api/console/device/{user_code}`,
  `POST /api/console/device/{user_code}/approve`, and `POST /api/console/device/{user_code}/deny`.
  The lookup also returns `drives` (`[{id, name}]`, the requested drives that still belong to the
  account) and `creates_drive`. Approving with `{}` grants read, write, delete, and share on those
  drives, or on a new drive named after the agent (`name`, `name (machine)`, `name 2`, ...;
  drives pending deletion keep their names). Token issuance revokes exactly the bearer key sent at
  start, if it belongs to the same account and agent. Defaults apply only to an empty body.
  Any other body is explicit approval: `scopes` (required, never `manage`), `driveIds`,
  `newDriveName`, optional `agentId`, and optional `sealedDriveKeys`. A `newDriveName` that matches an existing drive returns 409. Each
  account gets 30 device calls and 10 `not_found` results per 10 minutes; beyond that, 429
  `rate_limited`. Revoking an agent denies its approved but unredeemed requests.
- A key missing a scope gets 403 `permission_denied`: `The API key lacks the "<scope>" scope.`
- Grant by an existing agent (delegation). `GET /api/v1/device/:code` with a `delegate` key returns `{ user_code, client_name, machine, created_at, expires_at, public_key }` for a pending, unexpired request, else 404. `POST /api/v1/device/:code/grant` with `{ driveId, scopes, writePaths, sealedDriveKey: { epk, iv, ct } }` records an offer for the caller's account and returns `{ status: 'offered', revision }`; a repeat replaces the offer and raises the revision. It must pass `assertDelegation` (403). It does not approve: the human approves on `/connect`. Both routes share the console device-code budget per account: 30 calls, and 10 `not_found` results, per 10 minutes; past either, 429 `rate_limited`. Audit actions `device.read` and `device.grant`. The console `GET /device/:code` also returns `offer` and `offerRevision`; the approve body carries `offerRevision`, and a stale one returns 409 `The request changed; reload the page.`
- A key with `writePaths` (`POST /api/v1/keys` and the approve body accept `writePaths`: at most 16 canonical absolute paths, not `/`; `GET /keys` returns `write_paths`; `whoami` returns `writePaths`) may only put, move, copy, delete and restore at or under those paths, else 403 `permission_denied`: `The API key may only write under <paths>.` An empty list means no limit. Reads are not limited. The console is not affected.
- Delegated `POST /api/v1/keys`: a key that holds `delegate` but not `manage` may call it with `agentName` (1 to 64 characters) instead of `agentId`, plus `label`, `driveIds`, `scopes` and optional `writePaths`. The request must pass `assertDelegation` (403 `A key cannot grant more than it holds.`; 403 naming the scope without `delegate`). The server always creates a new agent of that name; an existing name returns 409 `conflict`: `An agent named "<name>" already exists; choose another name.` `agentId` from such a caller returns 400. The key records `issued_by_agent_id` (the caller's agent), which `GET /keys` returns. `DELETE /keys/:id` (a `manage` call) revokes the issued key alone; revoking the issuer does not cascade. Audit action stays `keys.create`.
- Audit actions: `device.authorize`, `device.token`, `console.device.read`,
  `console.device.approve`, `console.device.deny`.

## Account key (passphrase unlock, console only)

Clerk-session routes under `/api/console/`. There are no bearer routes: agents, the CLI and MCP
never see the public key, the wrapped private key or slots. The server stores opaque records and
checks structure and size only. It never receives a passphrase, KEK, private key, drive key or
plaintext. Slots are not backups and never touch `key_backup_at` / `key_backup_method`.

**strict** routes need a recent Clerk `strict` reverification. When it is missing they return
exactly Clerk's `reverificationErrorResponse('strict')` (403) so `useReverification` can recover.
`DELETE /api/console/account` is now **strict** too. Test auth always counts as reverified.

| Route                                 | Body, response                                                                                                                                                                                                                                             | Audit action                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /account-key`                    | `{ accountKey: { id, accountId, format, publicKey, wrappedPrivateKey, wrapGeneration, kdf: { name, iterations, salt }, createdAt, updatedAt } \| null }`                                                                                                   | `console.account_key.read`         |
| `POST /account-key` (**strict**)      | `{ id, publicKey, wrappedPrivateKey, kdf }` returns 201 with the record. 409 if one exists.                                                                                                                                                                | `console.account_key.create`       |
| `PATCH /account-key` (**strict**)     | `{ expectedKeyId, expectedGeneration, wrappedPrivateKey, kdf }` returns the record with `wrapGeneration + 1`. 409 unless both match; 404 if none.                                                                                                          | `console.account_key.update`       |
| `DELETE /account-key` (**strict**)    | `{ expectedKeyId, confirmation: "RESET" }` returns `{ deletedSlots }`. 409 if the id is not current; 404 if none.                                                                                                                                          | `console.account_key.reset`        |
| `GET /account-key/slots?limit&cursor` | `{ items: [{ driveId, keyId, format, sealed, revision }], nextCursor }` for live drives, ordered by drive id                                                                                                                                               | `console.account_key.slots`        |
| `POST /drives/:id/account-key`        | `{ keyId, expectedRevision: number \| null, sealed: { epk, iv, ct } }` returns `{ revision }`. `null` creates (409 if a slot exists); a number replaces that revision (409 otherwise). 409 if `keyId` is not current; 404 for a foreign or deleting drive. | `console.drive.account_key.put`    |
| `DELETE /drives/:id/account-key`      | `{ keyId, expectedRevision }` returns `{ deleted: true }`. 409 on a stale key or revision; 404 if no slot.                                                                                                                                                 | `console.drive.account_key.delete` |

Validation: unknown fields are 400. All base64url values are canonical and unpadded. `publicKey` and
`sealed.epk` are 65 bytes starting with `0x04`; `kdf.name` is `PBKDF2-SHA256`; `kdf.iterations` is an
integer from 600000 to 2000000; `kdf.salt` is 16 bytes; `wrappedPrivateKey` is `0x01 || iv(12) ||
ciphertext+tag` of 1+12+16+32..256 bytes; `sealed.iv` is 12 bytes and `sealed.ct` is 59 bytes.

Writes lock the account row (shared, `deleting_at` must be null, else 409), then the account key
row, then for slot routes the drive row (`deleting_at` must be null, else 404). Drive deletion
removes the drive's slot; account deletion removes the account key (slots cascade).

## Trace inbox and webhook token

A drive can hold one trace inbox: an ECDH public key plus its private key wrapped by the client
with the drive key, so the server can store it but not open it. A drive can also hold one active
webhook token. Console routes need a Clerk session and the same-origin check; they are not
reverification-gated because they reveal or change no key the server can use. A bearer key can
only read the inbox. Every other route below returns 404 on `/api/v1`.

| Route                              | Body, response                                                                                                                                                                                                                             | Audit action                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `GET /drives/:id/trace-inbox`      | `{ inbox: { keyId, publicKey, wrappedPrivateKey, createdAt } \| null }`. On `/api/v1` the key needs `read` on the drive; counts as one operation like `get`.                                                                               | `drive.trace_inbox.read`             |
| `POST /drives/:id/trace-inbox`     | Console only. `{ keyId, publicKey, wrappedPrivateKey }` returns 201 with the same shape. 409 if the drive already has an inbox. Unknown fields are 400.                                                                                    | `console.drive.trace_inbox.create`   |
| `GET /drives/:id/webhook-token`    | Console only. `{ token: { id, createdAt } \| null }`. Never the secret or its hash.                                                                                                                                                        | `console.drive.webhook_token.read`   |
| `POST /drives/:id/webhook-token`   | Console only. Returns 201 `{ id, token, url, createdAt }`; `token` is `adw_` plus 64 hex characters and is shown once (only its SHA-256 is stored). Revokes the active token in the same transaction. 409 if the drive has no trace inbox. | `console.drive.webhook_token.create` |
| `DELETE /drives/:id/webhook-token` | Console only. Revokes the active token and returns `{ revokedAt }`; 404 if none is active.                                                                                                                                                 | `console.drive.webhook_token.revoke` |

Tokens belong to the account's `openrouter` agent, which is created on first use. Deleting a drive
removes its inbox and tokens.

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
`versions`, `recent`, and `search` use the same bounded pagination envelope as other collections.
A conditional `put` (`ifVersionId`, or `ifVersionId: null` for create-only) that loses returns 409 `conflict`
with `state` (`exists`, `changed`, `trashed`, or `absent`) and `currentVersionId` (the current or trashed
version id; `null` for `absent`). A conditional write never revives a trashed file; an unconditional
overwrite does.

`restore` with no `versionId`, or with the file's current version, undeletes a trashed file: it returns the existing version with 200, creates no version or copy, and does not check quota; on a live file it does nothing. Restoring any other version copies it as a new current version and returns 201.

`recent` returns file-operation events (`put`, `copy`, `restore`, `move`, `delete`) in commit
order. Pass the `latestCursor` from one response as `cursor` to get only newer events; with a
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

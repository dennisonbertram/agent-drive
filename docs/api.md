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
| POST     | `/api/v1/drives/:id/put`                                             | `write`                             |
| POST     | `/api/v1/drives/:id/commit`                                          | `write`                             |
| GET      | `/api/v1/drives/:id/get`, `/list`, `/versions`, `/recent`, `/search` | `read`                              |
| POST     | `/api/v1/drives/:id/move`                                            | `write`                             |
| POST     | `/api/v1/drives/:id/delete`                                          | `delete`                            |
| POST     | `/api/v1/drives/:id/copy`, `/restore`                                | `read` and `write`                  |

All collection endpoints return `{ "items": [...], "nextCursor": string | null }`. Pass `limit`
(default 50, maximum 100) and the returned opaque `nextCursor` to continue. Ordering is stable
within a collection; cursors are validated and should be treated as opaque. `GET /drives` lists all
account drives for management keys and only key-authorized drives for keys with `read`. `whoami`
returns identity, scopes, and authorized drive IDs (`null` for management keys); use the paginated
drives endpoint for names and quota details.

File `list` and `search` accept `agentId`, `machine`, and `user` filters; `list` also accepts a
literal path `prefix` and optional path query `q`. `%` and `_` in a prefix are treated literally.
`versions`, `recent`, and `search` use the same bounded pagination envelope as other collections.

Audit entries contain the authenticated key/account/agent IDs, fixed route action, outcome, safe
error code, and HTTP status. They omit bodies, tokens, wrapped keys, object URLs, and paths. If the
audit write fails, the API returns 500; a mutation may already have committed before that response.

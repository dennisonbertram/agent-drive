# HTTP API: device login and delegation

Use this page to get an API key for an agent without a person copying secrets: the OAuth device flow that `agent-drive login` runs, and the delegation routes that let one agent offer a drive to another. The general API is in [HTTP API](api.md). Most people should run `agent-drive login` instead (see [Connect an agent](connect-an-agent.md)).

## Overview

The login follows the OAuth 2.0 Device Authorization Grant (RFC 8628). The `/api/oauth` endpoints need no API key. They accept `application/x-www-form-urlencoded` or `application/json`, and every response has `Cache-Control: no-store`.

The agent never receives a drive key in the clear. It sends a public key when it starts, and the person's browser seals the drive key to that public key before approval.

## Flow

1. The agent generates a P-256 key pair and calls `POST /api/oauth/device_authorization` with its public key.
2. The response has a `user_code` and a `verification_uri_complete`. The agent shows both to the person.
3. The person opens `https://agentdrive.xyz/connect`, signs in, checks that the code matches, chooses access, and approves. The browser seals the drive keys to the agent's public key.
4. The agent polls `POST /api/oauth/token` every `interval` seconds.
5. After approval, the token response returns the API key once, the drive IDs, and the sealed drive keys.
6. The agent unseals each drive key with its private key and saves the API key and drive keys.

A request expires after 600 seconds. The API key is issued by the first successful token call; later calls with the same `device_code` return `invalid_grant`.

## Start: POST /api/oauth/device_authorization

```sh
curl -sS -X POST https://agentdrive.xyz/api/oauth/device_authorization \
  -H "Content-Type: application/json" \
  -d '{"client_name":"<your agent name>","machine":"<machine name>","public_key":"<P-256 public key>"}'
```

| Field             | Rule                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client_name`     | Required. Up to 64 characters. The agent name. Also the default name of a new drive.                                        |
| `machine`         | Optional. Up to 128 characters.                                                                                             |
| `public_key`      | Required. The raw uncompressed P-256 point (65 bytes) as 87 base64url characters.                                           |
| `known_drive_ids` | Optional. Up to 20 drive UUIDs the agent already holds keys for. A JSON array, or a repeated or comma-separated form field. |

Invalid input returns 400 `{ "error": "invalid_request" }`, with an `error_description` when there is one.

To reconnect, send the agent's current API key as `Authorization: Bearer <key>`. An invalid or revoked key is ignored. `known_drive_ids` count only when this key is valid: the reconnect drives are the requested ids that this key holds. When the new key is issued, the server revokes exactly the key sent here, if it belongs to the same account and agent.

Response 200:

```json
{
  "device_code": "<secret, keep private>",
  "user_code": "BCDF-GHJK",
  "verification_uri": "https://agentdrive.xyz/connect",
  "verification_uri_complete": "https://agentdrive.xyz/connect?code=BCDF-GHJK",
  "expires_in": 600,
  "interval": 5
}
```

Rate limit: at most 20 starts per IP address per hour. The 21st returns 429 `{ "error": "slow_down" }`.

## Poll: POST /api/oauth/token

```sh
curl -sS -X POST https://agentdrive.xyz/api/oauth/token \
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
  -d device_code=<device_code>
```

Wait `interval` seconds between calls. Polling faster returns `slow_down`, and the server adds 5 seconds to the interval.

Errors are 400 `{ "error": "<code>" }`:

| `error`                  | Meaning                                                                                          | What to do                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `authorization_pending`  | The person has not decided yet.                                                                  | Keep polling.                                       |
| `slow_down`              | You polled too fast.                                                                             | Add 5 seconds to your interval and continue.        |
| `access_denied`          | The person denied it, or an offer or previous key was withdrawn. `error_description` says which. | Stop. Run login again if the person wants to retry. |
| `expired_token`          | The 600 seconds passed.                                                                          | Start again.                                        |
| `invalid_grant`          | Unknown or already used `device_code`, or the agent or account is gone.                          | Start again.                                        |
| `unsupported_grant_type` | `grant_type` is not the device-code value.                                                       | Fix the request.                                    |
| `invalid_request`        | A required field is missing or too long.                                                         | Fix the request.                                    |
| `server_error`           | 500. An internal failure.                                                                        | Retry later.                                        |

Success, 200:

```json
{
  "access_token": "adk_...",
  "token_type": "Bearer",
  "scope": "read write delete share",
  "write_paths": [],
  "api_url": "https://agentdrive.xyz/api",
  "account_id": "<uuid>",
  "agent_id": "<uuid>",
  "agent_name": "<your agent name>",
  "drive_ids": ["<uuid>"],
  "new_drive_id": null,
  "sealed_drive_keys": {
    "<drive id>": { "epk": "<base64url>", "iv": "<base64url>", "ct": "<base64url>" }
  }
}
```

`access_token` is the API key. It is shown once and the server stores only a hash. `scope` is space-separated. `new_drive_id` is set when the approval created a drive for this agent. The agent generates that drive's key itself, so it has no entry in `sealed_drive_keys`. A drive with neither a sealed key nor a saved key has no usable key on this machine.

## Approval (browser session)

The `/connect` page approves a request through routes under `/api/console/device/:userCode`. They use a signed-in browser session and are not for agents. For reference:

- An approval with an empty body (apart from the `delegate` and `offerRevision` fields) grants `read`, `write`, `delete` and `share`. It reconnects the drives the previous key held, or creates a new drive named after the agent (`name`, then `name (machine)`, then `name 2`, and so on). A reconnect keeps the previous key's scopes and write paths.
- Any other body is an explicit approval: `scopes` (required, from `read write delete share delegate`, never `manage`), `driveIds`, `newDriveName`, `writePaths`, `agentId` and `sealedDriveKeys`.
- `delegate` is never inherited from a previous key or an offer. Only the person's choice on the page adds it.

## Delegation: one agent offers a drive to another

An agent whose key holds the `delegate` scope can offer a drive to a new agent that is waiting for approval. The person still approves on `/connect`.

`GET /api/v1/device/:code` (bearer key with `delegate`). `:code` is the user code shown by the new agent's login. Response 200 for a pending, unexpired request, else 404 `not_found`:

```json
{
  "user_code": "BCDF-GHJK",
  "client_name": "<agent name>",
  "machine": "<machine name or null>",
  "created_at": "...",
  "expires_at": "...",
  "public_key": "<base64url>"
}
```

`POST /api/v1/device/:code/grant` records an offer.

```sh
export API=https://agentdrive.xyz/api/v1
export KEY=<your API key>
curl -sS -X POST "$API/device/<user code>/grant" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"driveId":"<drive id>","scopes":["read","write"],"writePaths":["/inbox"],"sealedDriveKey":{"epk":"<base64url>","iv":"<base64url>","ct":"<base64url>"}}'
```

| Field            | Rule                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `driveId`        | Required. A drive in the caller's account.                                                                                                                    |
| `scopes`         | Required, not empty. Each value must be one of `read write delete share delegate`, but only `read`, `write`, `delete` and `share` can be granted (see below). |
| `writePaths`     | Optional. Up to 16 canonical absolute paths.                                                                                                                  |
| `sealedDriveKey` | Required. `{ epk, iv, ct }`, each base64url. The drive key sealed to the request's `public_key`.                                                              |

The caller can offer only what it holds: the drive must be in its drive list, each scope must be one it holds and may grant (`read`, `write`, `delete`, `share`), and a caller with write paths must name write paths inside its own. Otherwise 403 `permission_denied` with `A key cannot grant more than it holds.`

Response 200: `{ "status": "offered", "revision": 1 }`. A repeat offer for the same request replaces the first and raises `revision`. Granting does not approve anything. When the person approves, the console must send the `offerRevision` it showed. A newer offer makes the approval fail with 409 `The request changed; reload the page.` At token time the server checks that the offering key is still valid and still holds what it offered. If not, the token call returns `access_denied`.

The CLI command for this is `agent-drive grant CODE`. See [CLI reference](cli.md).

### Issue a key directly: POST /api/v1/keys with agentName

A key with `delegate` but without `manage` can create a new agent and its key in one call, without any browser approval:

```sh
curl -sS -X POST "$API/keys" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"agentName":"<new agent name>","label":"<label>","driveIds":["<drive id>"],"scopes":["read","write"],"writePaths":["/inbox"]}'
```

- `agentName` is 1 to 64 characters. The server always creates a new agent. A name that exists returns 409 `conflict`. Sending `agentId` returns 400.
- The same limits as a grant apply: the new key cannot hold more than the caller, and cannot have `manage` or `delegate`.
- Response 201 has the key fields and `token`, shown once. The key records `issued_by_agent_id`. Revoking the issuer does not revoke this key. A person revokes it in the console under Agents, or a `manage` key calls `DELETE /keys/:id`.

`agent-drive credentials issue` uses this route and prints a credentials bundle for a sandbox. Run `agent-drive credentials issue --help` for its flags. The drive key is not sent to the server by this route. The bundle includes the drive key that the issuing machine already holds.

## Rate limits

- Device authorization start: 20 per IP address per hour.
- Device lookups, approvals, denials and grants share one budget per account: 30 calls per 10 minutes, and 10 `not_found` results per 10 minutes. Past either limit, every device call returns 429 `rate_limited` until the window ends.
- Ordinary API calls are limited per key. See [HTTP API](api.md).

## Sealed key format

A sealed drive key is `{ epk, iv, ct }`. In the current code: `epk` is the sealer's ephemeral P-256 public key (raw, base64url). The shared secret from ECDH is run through HKDF-SHA256 with salt `agent-drive-device-v1` and the drive ID as `info`. The result is an AES-256-GCM key. `iv` is the nonce and `ct` is the encrypted drive key with its tag. The drive ID is the AES-GCM additional data. The server only checks that the three fields are base64url strings. It cannot open them. For how drive keys are made and backed up, see [Keys and recovery](keys-and-recovery.md) and [Encryption format](crypto.md). The reference code is `packages/agent-drive/src/seal.ts` in the repository.

## Audit

These calls write the audit actions `device.authorize`, `device.token`, `device.read` and `device.grant`. Browser approval writes `console.device.read`, `console.device.approve` and `console.device.deny`. Revoking an agent denies its approved but unredeemed requests.

# Agent login, CLI distribution, and machine backup

Design contract for three connected features. Backend, CLI, and web implementations must match
this document exactly; change the document first if a detail has to change.

## Goals

- An agent connects with one instruction a human pastes into it:
  `Set up Agent Drive: https://agent-drive.vercel.app/llms.txt`
- The agent installs the CLI from this site, starts an OAuth 2.0 Device Authorization Grant
  (RFC 8628), and the human approves it in the browser. No API key is copied by hand.
- It works where the agent has no browser (sandboxes, containers, remote hosts): the CLI prints a
  link and a code; the human approves on any device.
- The agent can back up a directory from the machine it runs on.
- The server never sees a drive key or file plaintext, as today.

Out of scope: hosted remote-MCP connectors (claude.ai, ChatGPT). They would need the server to
hold drive keys, which breaks client-side encryption.

## 1. CLI distribution

- The Vercel build packs `packages/agent-drive` into `apps/web/public/cli/agent-drive.tgz`
  (`npm pack`), served at `/cli/agent-drive.tgz`. The package's `files` lists only `dist` (and
  README if present); it has no workspace dependencies.
- Install options shown to agents:
  - `npm install -g https://agent-drive.vercel.app/cli/agent-drive.tgz`
  - Sandboxes without global installs: `npx -y https://agent-drive.vercel.app/cli/agent-drive.tgz <command>`
- The CLI's default API URL is `https://agent-drive.vercel.app/api`, overridable by `--api` or
  `AGENT_DRIVE_API_URL`.

## 2. Device authorization (RFC 8628)

### Data: table `device_authorizations` (migration 0010)

| column                  | type                               | notes                                                                     |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| id                      | uuid pk                            |                                                                           |
| device_code_hash        | text unique not null               | SHA-256 hex of the device code                                            |
| user_code               | text not null                      | `XXXX-XXXX`, alphabet `BCDFGHJKLMNPQRSTVWXZ`; unique among unexpired rows |
| client_name             | text not null                      | requested agent name, 1–64 chars, same rules as agent names               |
| machine                 | text                               | ≤ 128 chars                                                               |
| public_key              | text not null                      | agent's ECDH P-256 public key, raw uncompressed point, base64url          |
| ip_hash                 | text not null                      | SHA-256 hex of the first `x-forwarded-for` address (or `unknown`)         |
| status                  | text not null                      | `pending`, `approved`, `denied`, `consumed` (check constraint)            |
| account_id              | uuid null → accounts               | set on approve/deny                                                       |
| agent_id                | uuid null → agents                 | set on approve                                                            |
| drive_ids               | uuid[] not null default '{}'       | drives the key may use                                                    |
| scopes                  | text[] not null default '{}'       | subset of read, write, delete, share. Never manage.                       |
| new_drive_id            | uuid null                          | a drive created at approval whose key the agent generates                 |
| sealed_drive_keys       | jsonb null                         | see §4                                                                    |
| api_key_id              | uuid null → api_keys               | set when the token is issued                                              |
| interval_seconds        | int not null default 5             |                                                                           |
| last_polled_at          | timestamptz null                   |                                                                           |
| created_at              | timestamptz not null default now() |                                                                           |
| expires_at              | timestamptz not null               | created_at + 10 minutes                                                   |
| decided_at, consumed_at | timestamptz null                   |                                                                           |

Rows past `expires_at` behave as expired; maintenance (`cleanup` cron job) deletes rows older
than 24 hours.

### Public endpoints (no auth), under `/api/oauth/`

Both accept `application/x-www-form-urlencoded` (RFC 8628) and `application/json`. Responses are
JSON with `Cache-Control: no-store`.

`POST /api/oauth/device_authorization`

- Body: `client_name` (required), `machine` (optional), `public_key` (required).
- Rate limit: at most 20 requests per `ip_hash` per hour → 429 `{ "error": "slow_down" }`.
- 200: `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in: 600, interval: 5 }`
  - `device_code`: 32 random bytes, base64url. Only its hash is stored.
  - `verification_uri`: `{origin}/connect`; `verification_uri_complete`: `{origin}/connect?code={user_code}`.
    `{origin}` is `AGENT_DRIVE_PUBLIC_URL`.
- 400 `{ "error": "invalid_request", "error_description": "…" }` for bad input.

`POST /api/oauth/token`

- Body: `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`.
- Errors are 400 with `{ "error": … }`:
  - `authorization_pending` — still pending.
  - `slow_down` — polled sooner than `interval_seconds` since `last_polled_at`; the server adds 5
    to `interval_seconds`.
  - `access_denied` — human denied.
  - `expired_token` — past `expires_at`.
  - `invalid_grant` — unknown code, or already consumed.
  - `unsupported_grant_type`.
- 200 on approval, exactly once (row locked, status → `consumed`, in one transaction that also
  creates the API key):
  ```json
  {
    "access_token": "adk_…",
    "token_type": "Bearer",
    "scope": "read write",
    "api_url": "{origin}/api",
    "account_id": "…",
    "agent_id": "…",
    "agent_name": "…",
    "drive_ids": ["…"],
    "new_drive_id": "… or null",
    "sealed_drive_keys": { "<driveId>": { "epk": "…", "iv": "…", "ct": "…" } }
  }
  ```
  The key is created with label `{client_name} on {machine}` (or `{client_name}` without a
  machine), the approved scopes, and the approved drives. The successful `device.token` audit row
  is written in the same transaction. If any part fails, nothing commits, the request stays
  `approved`, and the client can poll again.
- Revocation: `agents.revoke` also sets the agent's `approved` requests to `denied`, so an
  approved but unredeemed login returns `access_denied` and creates no key. Redemption locks the
  account, then the agent, then the request row; `agents.revoke` and approval lock the agent
  before touching requests. A revoke that races a redemption therefore either denies the request
  or waits and then revokes the new key. Deleting the account also makes redemption return
  `invalid_grant`.

### Console endpoints (Clerk session, through `/api/console/…`)

- `GET /api/console/device/{user_code}` → `{ user_code, client_name, machine, created_at, expires_at, public_key }`
  for a pending, unexpired row; otherwise 404 `not_found`.
- `POST /api/console/device/{user_code}/approve` with JSON:

  ```json
  {
    "agentId": "existing agent id (optional)",
    "driveIds": ["existing drive ids the key may use"],
    "newDriveName": "optional: create a drive for the agent",
    "scopes": ["read", "write"],
    "sealedDriveKeys": { "<driveId>": { "epk": "…", "iv": "…", "ct": "…" } }
  }
  ```

  - At least one of `driveIds` or `newDriveName`. Every drive id must belong to the account.
  - `scopes`: non-empty subset of read, write, delete, share; `manage` is rejected.
  - Without `agentId`, the agent named `client_name` is reused if it exists, otherwise created.
  - `sealedDriveKeys` keys must be a subset of `driveIds`.
  - The drive from `newDriveName` is added to `drive_ids` and stored in `new_drive_id`.
  - Free-plan drive limits and other existing creation rules still apply.
  - 200 `{ status: "approved" }`; 404 if not pending or expired.

- `POST /api/console/device/{user_code}/deny` → 200 `{ status: "denied" }`.
- Attempt limit (table `device_console_limits`, migration 0011): each account may make at most 30
  device calls (lookup, approve, deny) and have at most 10 `not_found` results per 10 minutes.
  Malformed, unknown, expired, and already-decided codes all return the same 404 and count as
  failures. Once either budget is spent, every device call returns 429 `rate_limited`, even for a
  real code, until 10 minutes after the window started.
- Audit actions: `device.authorize` (public start), `device.token` (successful issue),
  `console.device.read`, `console.device.approve`, `console.device.deny`.

## 3. Approval page `/connect`

- Clerk-protected like `/console` (signed-out visitors go to `/sign-in` and come back).
- `?code=XXXX-XXXX` prefills a code field; the page loads the request and shows: agent name,
  machine, requested time, and "Check that this code matches the one in your agent's terminal."
- Choices:
  - Drive: an existing drive, or "Create a new drive for this agent" (name defaults to the
    agent name). The new-drive option explains that the agent will hold that drive's key.
  - For an existing drive, optionally give the agent its key: a drive key field or recovery
    file, plus an option to reuse a key already loaded in this tab. It is sealed in the browser
    (§4). Without it, the agent can list names but not decrypt; the page says so.
  - Permissions: read and write checked by default; delete and share optional; no manage.
- Primary action "Approve agent", secondary "Deny". Success state: "Approved. Return to your
  agent; it will finish setup on its own."
- Expired or unknown codes show a clear message with how to start again (`agent-drive login`).

## 4. Drive-key sealing (browser → agent)

Identical in browser WebCrypto and Node `crypto.webcrypto`:

1. The agent generates an ECDH P-256 key pair for each login. `public_key` is the raw
   uncompressed public point (65 bytes), base64url without padding.
2. For each drive, the browser generates an ephemeral ECDH P-256 key pair and derives 256 bits
   with `deriveBits({ name: 'ECDH', public: agentPublicKey }, ephemeralPrivateKey, 256)`.
3. HKDF-SHA256 over those bits with `salt = UTF-8("agent-drive-device-v1")` and
   `info = UTF-8(driveId)` gives an AES-GCM 256-bit key.
4. Encrypt UTF-8(drive key string exactly as the console shows it) with AES-GCM, a random
   12-byte `iv`, and `additionalData = UTF-8(driveId)`.
5. Send `{ epk: base64url(raw ephemeral public key), iv: base64url(iv), ct: base64url(ciphertext‖tag) }`.

The agent reverses this with its private key and saves each drive key in its private config. A
failed unseal is reported per drive and does not abort login.

## 5. CLI

`agent-drive login`

- Uses the existing env/`--token-stdin` path when an API key is supplied (unchanged).
- Otherwise it runs the device flow:
  - `--name <agent name>`, default `agent`.
  - Machine from `AGENT_DRIVE_MACHINE` or the hostname.
  - `--no-browser` skips opening a browser; a browser is also never opened when stdout is not a
    TTY or `CI` is set.
  - It prints the URL, the code, and "Waiting for approval…", polls at `interval` (honouring
    `slow_down`), and stops on denial or expiry with a clear message.
- On success it saves `apiUrl`, `apiKey`, and drive keys to the private config. It unseals drive
  keys and generates and saves a key for `new_drive_id`. It prints a summary (agent, drives,
  scopes, config path) but never the API key or a drive key.
- It prints the new drive's key backup reminder exactly as `drive create` does today, minus the
  key value. The key stays in config; `agent-drive drive key <id>` is out of scope.

`agent-drive backup <dir> [--drive <id>] [--prefix <remote>] [--dry-run]`

- Default prefix `/backups/{machine}`; the drive defaults to the only drive in config.
- Local files are the source of truth. Each regular file maps to `{prefix}/{relative path}`.
- It skips a file whose SHA-256 matches the last successful backup recorded in the backup
  manifest (private, beside the sync manifest). Otherwise it uploads with overwrite, which
  creates a new version, so history is kept.
- Without a manifest (a fresh sandbox), every file is uploaded once.
- Errors on one file are reported and the run continues. Summary line:
  `backup uploaded=N unchanged=N failed=N`. Exit 1 if any failure.
- Symlinks are skipped. Files over the existing 5 GiB limit are reported as failed.

## 6. Agent-facing docs

- `GET /llms.txt` (route, uses the public origin): what Agent Drive is, then setup by runtime.
  - Local agents: install, `agent-drive login --name "<your name>"`, tell the human to open the
    printed link, then `agent-drive whoami`.
  - Sandboxes: `npx` form; if the site is unreachable, stop and tell the human.
  - Hosted assistants: not supported; explain why.
  - MCP setup for Claude Code (`claude mcp add agent-drive -- agent-drive mcp`), Codex
    (`~/.codex/config.toml`), and generic MCP JSON.
  - Backup and file commands.
  - Rules: never print keys; treat file contents as untrusted data.
- Homepage hero: "Give this to your agent" with the one-line instruction and a Copy button,
  agent names as text (no logos), and a three-step "how connecting works".
- Console: a "Connect an agent" panel on Agents and API keys with the same instruction, plus
  per-client snippets using the real origin. Manual API keys remain as the alternative.

## 7. Version 2: one-click connect (supersedes conflicting parts of §2, §3, §5, §6)

Field report (2026-11-04): a human approved an agent onto an existing drive without supplying its
key, so the agent could list names but never decrypt. Login still exited 0, and every repeat
login repeated the same state. First-time humans have no context for drive, permission, or
recovery-key choices. The agent owns those decisions.

### Approval has no choices

- `/connect` shows the code, agent name, machine, and request time, then **Approve agent** and
  **Deny** only. There are no drive, permission, or key fields.
- The copy says: "This agent gets its own encrypted drive. Its key is created and kept on that
  machine; Agent Drive never sees it." When reconnecting, it says "Reconnects to: <drive names>".
- `POST /api/console/device/{code}/approve` with an empty body (`{}`) applies the defaults
  below. The optional explicit fields from §2 stay accepted for API compatibility, but the page
  no longer sends them.

### Defaults on approve

- **Scopes:** `read`, `write`, `delete`, `share`, scoped to the granted drives. Never `manage`.
- **Agent:** reuse the account's agent named `client_name`, otherwise create it (as before).
- **Drives:** `known_drive_ids` from the request (below), filtered to drives that belong to the
  approving account and are not being deleted. If none remain, create a new drive named
  `client_name`; if that name is taken, use `client_name (machine)`, then append ` 2`, ` 3`, …
  The new drive is returned as `new_drive_id`.
- **Previous keys:** when issuing the token, revoke the account's active API keys for the same
  agent with the same label (`client_name on machine`), so a repeat login replaces that
  machine's key instead of accumulating keys.

### Request: `known_drive_ids`

- `POST /api/oauth/device_authorization` accepts an optional `known_drive_ids`: up to 20 UUIDs,
  the drives whose keys the CLI already holds for this API origin. They are stored in a new
  column, `requested_drive_ids uuid[] not null default '{}'` (migration 0012).
- `GET /api/console/device/{code}` additionally returns
  `drives: [{ id, name }]` (the requested drives that pass the account filter) and
  `creates_drive: boolean`.

### Errors

- Missing-scope errors name the scope: `The API key lacks the "<scope>" scope.` The CLI adds:
  "Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope."

### CLI changes

- `login` sends `known_drive_ids`, the saved drive-key IDs for the target origin (none on a
  fresh machine).
- `login` counts usable drives: granted drives with a saved, unsealed, or newly generated key.
  - If there are none, it exits 1 with: "Login finished but this agent has no usable drive key.
    Run `agent-drive login` again; the owner's approval will create a drive for this agent."
  - Otherwise it prints the usable drives by name/ID and the config path, never secrets.
- Default `--name` is `<machine> agent`, where machine is `AGENT_DRIVE_MACHINE` or the
  hostname.
- `whoami` adds `localDriveKeys: { "<driveId>": true|false }` for the authorized drives.
- New `agent-drive check [--drive ID]` is the final setup check. It needs one usable drive
  (the only one, or `--drive`). It writes a small random file to `/.agent-drive/check.txt` with
  overwrite, reads it back, and compares bytes. It prints `check ok drive=<id>`, or a clear
  failure with exit 1.
- `drive create` no longer prints `driveKey`. It prints the drive and "Drive key saved to <config
  path>; back it up." (It still needs `manage`; agents should not use it.)

### llms.txt changes

- **Steps:** install → `agent-drive login --name "<your name>"` → tell the human to open the
  link and click Approve → `agent-drive check`. Setup is complete only when `check ok` prints.
- **Troubleshooting:**
  - No usable drive key: run `login` again.
  - Missing-scope error: run `login` again; do not use `drive create`.
  - The `/connect` page requires the human to be signed in.

## 8. Version 2.1: reconnect requires proof (supersedes `known_drive_ids` trust in §7)

The security review found that trusting requester-supplied `known_drive_ids` let an agent that
knew a drive ID obtain write/delete access to it with one approval. Replacing keys by label also
revoked unrelated keys.

- `POST /api/oauth/device_authorization` accepts an optional `Authorization: Bearer <api key>`
  header: the CLI's current key for this origin.
  - If the key is valid and unrevoked, the server records it as `previous_api_key_id` (new
    column, migration 0013).
  - An invalid or revoked key is ignored, never an error, and is never logged.
- **Reconnect drives** = `known_drive_ids` ∩ the previous key's `drive_ids`, filtered to
  non-deleting drives of the approving account. The previous key must also belong to the
  approving account and to the agent being approved, otherwise it is ignored. With no previous
  key, `known_drive_ids` are ignored entirely, and the approval creates a new drive.
- **Replacement:** token issuance revokes exactly `previous_api_key_id`, and only when it
  belongs to the same account and agent. Label-based revocation is removed.
- **Defaults** apply only to an empty approve body. A non-empty legacy body keeps the §2 rules,
  so `scopes` is required.
- **Drive names:** allocation treats drives pending deletion as occupied, because the unique
  index includes them.
- **CLI:**
  - It sends its saved API key as the bearer header only when the saved `apiUrl` origin equals
    the login origin.
  - Drive keys gain a per-key origin: config `driveKeyOrigins: { "<driveId>": "<origin>" }`,
    written whenever a key is saved. Keys whose origin is unknown or different are not sent and
    don't count as usable.
  - Keys must decode to 32 bytes to be sent or counted.
  - The default name is truncated so the result is at most 64 characters.
- **`check`:** before writing, it lists the drive and, if any file other than the check file
  exists, downloads the most recent one and requires decryption to succeed. Then it does the
  round trip. A wrong key fails `check` with "This drive key cannot decrypt existing files."

### Fixes to v2.1

- **Redemption rechecks the previous key.** Inside the redemption transaction, after the account,
  agent and request locks, the server locks the previous key's row (`FOR UPDATE`; key revoke only
  touches that one row, so no lock cycle). It must still be unrevoked, with the same account and
  agent. For a reconnect that creates no drive, a key that no longer qualifies marks the request
  `denied` and returns `access_denied` ("The previous key was revoked; run agent-drive login
  again.") without issuing. Of two approved requests citing the same key, only the first issues.
  The revoking `UPDATE` must affect exactly one row.
- **Legacy key origins.** `readConfig` assigns the saved `apiUrl` origin to any drive key with no
  `driveKeyOrigins` entry (persisted on the next write). Without a valid saved `apiUrl` such keys
  stay untrusted.
- **`check`** finds the newest existing file with the `recent` feed (newest first, skipping the
  check file) instead of the first page of `list`; with no other file it does the round trip only.

## 9. Credential backup, proactive skill, and setup step 4

The agent holds its drive key only in its config file. If that file is lost, which happens
whenever a sandbox is deleted, the drive's files can never be decrypted. A new sandbox also
cannot reconnect, because it has no previous API key. Backup is done on the agent's side: the
human never handles the key.

### Credentials bundle

- `agent-drive credentials export (--to <path> | --stdout)` writes a bundle.
  - Contents: base64url of JSON `{"v":1,"apiUrl","apiKey","driveKeys":{id:key},"driveKeyOrigins":{id:origin}}`, prefixed `adcred1.`.
  - `--to` writes the file with mode 600 and refuses an existing path unless `--force`.
  - `--stdout` prints only when stdout is not a TTY (meant for a pipe into a secret store) and
    otherwise refuses with a hint.
  - Both record `keyBackup: { "<driveId>": { "at": ISO time, "method": "file"|"stdout" } }` in
    the config for every drive key in the bundle.
- `agent-drive credentials import (--from <path> | stdin)` merges a bundle into the config.
- Environment variable `AGENT_DRIVE_CREDENTIALS=<bundle>`:
  - When present, it is merged in memory at startup and never written to disk unless
    `credentials import` runs.
  - Drives it supplies count as backed up, since the bundle already lives outside the machine.
  - It is never printed.
- `agent-drive credentials status` prints, for each drive key: whether it is backed up, when, and
  how.

### Enforcement

- `login` and `drive create`, when they create a new drive key, end with:
  > Back up this agent's credentials before this machine or sandbox goes away: `agent-drive credentials export --to <a path that survives>` or `agent-drive credentials export --stdout | <your secret store>`. Until then `agent-drive check` will not pass.
- `check` prints `check ok` only when every usable drive key is backed up. Otherwise it exits 1
  with "drive key not backed up" plus the commands above.
- `whoami` includes `keyBackup`.

### Skill and install

- `agent-drive skill install [--target claude|codex|<dir>]` writes the packaged `SKILL.md`.
  - Default targets: `~/.claude/skills/agent-drive/SKILL.md` when `~/.claude` exists, and
    `~/.codex/skills/agent-drive/SKILL.md` when `~/.codex` exists.
  - It prints the paths written, and with no target found it prints the file location.
  - The skill ships inside the CLI package.
- The skill tells the agent to save proactively:
  - It checks `/memory` and recent files at the start of a task.
  - It saves deliverables to `/outputs` when done, durable decisions to `/memory`, task
    material to `/work/<task>`, a handoff at the end of a session, and `backup` of the working
    directory before a sandbox ends.
  - It may save secrets and traces in file contents, since they are encrypted. It never puts
    secrets in paths, names, tags, or descriptions. It never stores a drive key in the drive it
    unlocks. It never shares files containing secrets.
- **llms.txt setup:** step 4 is "Back up your credentials" (`credentials export`). Step 5 is
  `agent-drive skill install`. `check` is the final step and enforces step 4. A sandboxes
  section explains `AGENT_DRIVE_CREDENTIALS`.

### Trace archive

`archive-traces.sh` no longer holds back secret-looking files by default. `--hold-back-secrets`
restores the old behaviour, which still exits 3 when files are held back.

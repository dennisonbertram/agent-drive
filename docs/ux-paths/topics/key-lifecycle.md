# Topic 8: Key lifecycle and access control

Scopes: `read`, `write`, `delete`, `share`, `manage`. Server enforcement in `apps/web/src/api/handler.ts` (`need`, `manage`); rate limit in `apps/web/src/billing/ledger.ts` (`enforceKeyRateLimit`, default 600 requests/minute per key). Console UI in `apps/web/app/(app)/console/console.tsx`.

## STORY-001: Rotating an API key without downtime (issue new, update agent, revoke old)

**Type**: long
**Topic**: Key lifecycle
**Persona**: Priya Raman, rotating the quarterly key for her "Research assistant" agent that runs continuously on a laptop
**Goal**: Replace the "Research laptop" key with a fresh one and make sure the old one is dead
**Preconditions**: Active key "Research laptop" (read, write) on drive "Priya research memory"; agent running `agent-drive mcp` under Claude Code with the key in env and a saved config
**Ideal path**: 6 — create replacement, update agent config, restart MCP, verify, revoke old, verify dead
**Alternate paths**: Console Agents tab "Revoke access" (kills all keys at once, no overlap); CLI `agent-drive key create` + `agent-drive key revoke ID` (needs a manage key; CLI has no `key list`, so the old key ID must come from the console or the original create output); REST `POST /api/v1/keys` then `DELETE /api/v1/keys/:id`

### Steps

1. Open `/console`, click "API keys" and read the guide text → "To rotate access, create a replacement API key, update the agent, then revoke the old key. Decryption keys and API keys are different: neither replaces the other."
2. Click "+ New API key", label "Research laptop Q1-2027", agent "Research assistant", same drive, "read" + "write" → "Save your API key" dialog with new `adk_...` token
3. Copy the token, tick "I saved my API key securely", click "Done" → Two Active rows listed (both "Research assistant · read, write")
4. In the terminal run `read -rs -p "API key: " AGENT_DRIVE_API_KEY; export AGENT_DRIVE_API_KEY` with the new token and `agent-drive login --api https://agent-drive.vercel.app` → Prints whoami JSON with the new `keyId`
5. Restart the MCP host (config changes need a restart of the MCP process) → New process authenticates with the new key; she calls the MCP `whoami` tool to confirm the `keyId`
6. Return to the console, find the old "Research laptop" row (the rows show label, agent, scopes, drives but not creation date or last-used) and click "Revoke" → Confirm "Revoke Research laptop? Commands using this key will stop working."
7. Accept → Notice "API key revoked. It can no longer authenticate."; row badge changes "Active" -> "Revoked" and the Revoke button disables
8. Run `agent-drive whoami` with the old key exported in a second shell → Stderr "The API key is invalid or revoked." and exit code 1

### Variations

- She revokes first by mistake, breaking the live agent, then must do steps 2-5 under pressure
- Labels identical for old and new ("Research laptop") so she cannot tell which row to revoke

### Edge Cases

- No "last used" or created-at column; labels are the only way to tell keys apart
- `login` overwrites `~/.config/agent-drive/config.json` apiKey, but an `AGENT_DRIVE_API_KEY` env var still wins in `resolveConnection`; a stale env var keeps the old key in use
- Revocation is idempotent server side (COALESCE on revoked_at); double-click is harmless
- Rotating the API key never changes the drive key (separate secret)

## STORY-002: Emergency revoke-all for a suspected leaked agent

**Type**: medium
**Topic**: Key lifecycle
**Persona**: Marcus Webb, who just spotted an `adk_` token in a public GitHub gist
**Goal**: Cut off every key belonging to the agent immediately
**Preconditions**: Agent "Ops bot" has 3 active keys across two drives
**Ideal path**: 2 — revoke access, confirm
**Alternate paths**: Revoke each key individually from the API keys tab; CLI `agent-drive key revoke ID` x3 (manage key required); REST `POST /api/console/agents/:id/revoke` is console-session only (no `/api/v1` equivalent)

### Steps

1. Open `/console` and click "Agents" → Row "Ops bot" with the agent ID code and badge "3 active keys"
2. Click "Revoke access" → Browser confirm: "Revoke all API keys for Ops bot? This stops this agent's current access."
3. Click OK → Notice "All API keys for Ops bot have been revoked."; badge becomes "0 active keys"
4. Click "API keys" to verify → All three rows show badge "Revoked"
5. Check "Usage" tab -> "Usage by author" for operations after the leak → Rows per agent show OPERATIONS; no per-key breakdown
6. Open "Activity & deletion" (`/console/settings`) -> "Audit log" → Look for key-use and revoke events by Action/Actor/Result

### Variations

- He confirms the wrong agent because two agents have similar names; no undo exists (there is no un-revoke; he must create new keys)
- He cancels the confirm dialog: nothing happens, no message

### Edge Cases

- "Revoke access" is disabled while busy; the label does not say "all keys" (only the confirm dialog does)
- Revoking the agent does not touch existing share links; those stay valid until expiry or `agent-drive share revoke SHARE_ID --drive ID`; the drive key may also have leaked with the token and cannot be rotated
- The agent identity itself remains in the list (no delete/rename); a new key can be issued for it later
- Leaked drive key: nothing in the UI re-encrypts a drive; the only path is create a new drive and move files

## STORY-003: Least-privilege key for a read-only reporting agent

**Type**: medium
**Topic**: Key lifecycle
**Persona**: Naledi Mokoena, who wants a dashboard agent that can read and summarize but never change files
**Goal**: Issue a read-only key and prove it cannot write
**Preconditions**: Drive "Quarterly reports" with files; agent "Report reader" exists
**Ideal path**: 5 — create key with read only, login, ls works, put fails, understand why
**Alternate paths**: CLI `agent-drive key create --agent ID --drive ID --label LABEL --scope read`

### Steps

1. API keys -> "+ New API key"; label "Dashboard reader", agent "Report reader", drive "Quarterly reports" → Form shown with read/write pre-checked
2. Untick "write" (leave "read") and click "Create API key" → Receipt shows token; tick "I saved my API key securely"; "Done"; row reads "Report reader · read"
3. In a terminal run `agent-drive login --api https://agent-drive.vercel.app` with the key and `agent-drive whoami` → JSON `scopes: ["read"]`, one drive ID
4. Run `agent-drive ls --drive <id>` with the drive key set → Lists encrypted sizes and paths
5. Run `agent-drive put ./notes.md /notes.md --drive <id>` → Error on stderr from the server: "The API key lacks this scope." (HTTP 403, code permission_denied)
6. Run `agent-drive rm /old.md --drive <id>` → Same permission error (needs `delete`)
7. Run `agent-drive share /reports/q3.csv --drive <id> --expires-in 24h` → Permission error because sharing needs `share` and `read`

### Variations

- The same agent through MCP: the failure text is generic: "The API key does not have permission for this operation." (MCP replaces server messages with fixed strings, so the agent cannot tell which scope is missing)
- She adds "share" later by creating another key (scopes of an existing key cannot be edited)

### Edge Cases

- Keys cannot be edited: changing scopes or drives means a new key and revoke of the old
- Scope-to-operation mapping is not shown in the UI: `read` get/list/search/versions/recent; `write` put/commit/move/copy/restore; `delete` rm; `share` share create/revoke (plus `read` for create); `manage` agents/drives/keys admin
- Console "Permissions" checkboxes only offer bare names with no explanations except the `manage` hint

## STORY-004: Key scoped to the wrong drive

**Type**: short
**Topic**: Key lifecycle
**Persona**: Jonas Weber, an agent builder with two drives ("Prod memory", "Scratch")
**Goal**: Let the agent write to "Scratch" only
**Preconditions**: Both drives exist; the console has "Prod memory" selected
**Ideal path**: 3 — tick correct drive, create, put succeeds
**Alternate paths**: CLI `key create ... --drive <scratch-id>` (repeatable `--drive`)

### Steps

1. Click "+ New API key" → "Allowed drives" has the currently selected drive ("Prod memory") pre-checked (defaultChecked uses the selected drive); Jonas does not notice
2. Create the key and finish the receipt → Row lists "Prod memory" as the drive
3. Run `agent-drive put ./a.md /a.md --drive <scratch-id>` → Error: "The API key is not scoped to this drive." (403)
4. Create a second key with "Scratch" checked and revoke the first → Row 1 "Revoked", row 2 "Active"

### Variations

- Whoami's `driveIds` quickly shows the problem: `agent-drive whoami`

### Edge Cases

- Drive selection in the key dialog depends on which tab drive was last selected; pre-check can mislead
- New keys "do not grant access to future drives automatically": a later-created drive needs another key
- Deleting a drive removes its ID from all keys (server `array_remove`), so a key may end up with "No drive access"

## STORY-005: Revoked key meets a live agent (CLI and MCP behavior)

**Type**: medium
**Topic**: Key lifecycle
**Persona**: Lena Fischer, whose teammate revoked the key her overnight agent was using
**Goal**: Diagnose why the agent suddenly fails and recover
**Preconditions**: Agent runs `agent-drive mcp` with a saved config; key was revoked in the console at 02:00
**Ideal path**: 4 — see the unauthorized error, get a new key, update config, restart
**Alternate paths**: Console Agents "Revoke access"; per-key "Revoke"

### Steps

1. The agent calls the MCP `put` tool → Tool result is an error: code `unauthorized`, message "Authentication failed." (fixed string; the server's own text "The API key is invalid or revoked." is not shown)
2. Lena runs `agent-drive whoami` in a shell → Stderr "The API key is invalid or revoked." exit 1
3. Lena asks the human owner; the owner opens API keys and sees the row with badge "Revoked" and the label
4. Owner creates a replacement key (STORY-001 steps 2-3) and sends it through a secret channel
5. Lena runs `agent-drive login --api https://agent-drive.vercel.app --token-stdin` with the new token piped in → whoami JSON prints, config saved
6. She restarts the MCP host (the saved config is read at process start) → MCP `whoami` succeeds

### Variations

- The agent has `AGENT_DRIVE_API_KEY` in its environment config; `login` would not override it
- The agent is mid-upload when the key is revoked: the commit call fails with the same unauthorized error and a staged upload is left for the cleanup cron

### Edge Cases

- No way for the agent to distinguish "revoked" from "wrong key typed" via MCP
- No notification to the agent owner when keys are revoked by someone else

## STORY-006: Hitting the per-key rate limit during a bulk sync

**Type**: short
**Topic**: Key lifecycle
**Persona**: Ravi Patel, syncing 4,000 small notes with `agent-drive sync`
**Goal**: Finish the sync without being blocked
**Preconditions**: Key active; server limit `API_KEY_REQUESTS_PER_MINUTE` default 600
**Ideal path**: 2 — wait the advertised delay, rerun
**Alternate paths**: Use a second key for a second machine (limit is per key); MCP `put` calls get a `retryAfter` field in the JSON error

### Steps

1. Run `agent-drive sync ./notes --drive <id> --prefix /notes` → After many requests it fails with "This API key has reached its request limit. Retry shortly." followed by the line "Retry after: 23 seconds"
2. Wait 30 seconds and re-run the same command → Unchanged files are skipped from the manifest and only the remainder uploads; output JSON `{uploaded, skipped, conflicts, accountId, manifestPath}`

### Variations

- MCP: error code `rate_limited`, message "The API key has exceeded its request rate limit.", `retryAfter` number

### Edge Cases

- Console usage is by `__console__` and does not use these keys
- Rate-limit window resets each clock minute; retry-after is at least 1 second
- Using one key per agent or machine, which the key dialog recommends ("Use a different key for each agent or machine"), also spreads the limit

## STORY-007: Granting a second machine access with its own key and attributing activity

**Type**: medium
**Topic**: Key lifecycle
**Persona**: Ben Alvarez, adding his desktop to the laptop agent's drive
**Goal**: Give the desktop its own key under the same agent and see who wrote what
**Preconditions**: Agent "Research assistant" with key "Research laptop"
**Ideal path**: 5 — new key labeled for the desktop, login on desktop, put, check author/machine
**Alternate paths**: Reuse the same token on both machines (works, but no per-machine revocation); `AGENT_DRIVE_MACHINE` sets machine name explicitly

### Steps

1. Console API keys -> "+ New API key"; label "Research desktop", agent "Research assistant", same drive, read + write → Receipt; save token
2. On the desktop run `agent-drive login --api https://agent-drive.vercel.app` with the token → whoami shows the same `agentId` as the laptop but a different `keyId`
3. Run `agent-drive put ./a.md /work/t1/a.md --drive <id>` with the drive key from the recovery file → Version JSON
4. Run `agent-drive ls --drive <id> --machine <desktop-hostname>` → Only desktop-written files
5. Console Files tab: the AUTHOR column shows "Research assistant" for both machines; Usage -> "Usage by author" aggregates both
6. Desktop is lost; owner clicks "Revoke" on "Research desktop" only → The laptop continues to work

### Variations

- Machine not set: hostname is used, which may be unhelpful like "localhost"

### Edge Cases

- Console shows author at agent level only, not key or machine; machine filtering is CLI-only
- The drive key must be copied to the desktop through a second channel because API keys do not carry it

## STORY-008: Over-broad key: ticking "manage" by habit and then narrowing

**Type**: medium
**Topic**: Key lifecycle
**Persona**: Ines Castillo, an IT admin setting up an agent and unsure what the checkboxes mean
**Goal**: Issue the narrowest key that still lets her agent list and download files
**Preconditions**: Drive and agent exist
**Ideal path**: 3 — leave defaults, create, done
**Alternate paths**: none found for editing a key

### Steps

1. Click "+ New API key" and read the "Permissions" fieldset → read, write pre-checked; delete, share unchecked; "manage — account-wide administration; use sparingly"
2. She ticks every box and creates the key → Row shows "Ops agent · read, write, delete, share, manage"
3. She reads the agent's key row and realizes manage lets the key create agents, drives and more keys; she cannot edit it
4. She creates a second key with read + write only and revokes the first → New row scopes "read, write"; old row "Revoked"
5. She tests with `agent-drive whoami` → `scopes: ["read","write"]`, drive list limited to the allowed ones (a manage key would show `driveIds: null`)

### Variations

- She unticks "write" for a pure backup-reader agent

### Edge Cases

- A manage key listing drives with `GET /api/v1/drives` sees all drives of the account, but still cannot read files from drives not in its `driveIds`
- A key with only "manage" can create keys with scopes it does not itself have (no escalation check in the key-create handler), so "manage" is effectively full control; the UI hint says "account-wide administration"
- Pre-checked "read" and "write" are the CLI default as well when `--scope` is omitted

## STORY-009: Rotating the drive key is not possible: the "other" key lifecycle

**Type**: short
**Topic**: Key lifecycle
**Persona**: Hannah Okafor, a new hire wondering whether she can rotate the encryption key after a laptop was stolen
**Goal**: Replace the drive key
**Preconditions**: Drive with files; the recovery file was on the stolen laptop
**Ideal path**: none exists as a single step — the product has no drive-key rotation; the ideal would be a "rotate drive key" action
**Alternate paths**: Revoke API keys (Agents "Revoke access") to stop server access; create a new drive with "+ New drive" and re-upload via CLI/MCP with the new drive key; CLI `drive create`; delete the old drive in Activity & deletion (`/console/settings`) -> "Delete one drive"

### Steps

1. Hannah searches the console for a rotate option on the Files tab → Only "Load drive key", "Forget key" exist; "Forget key" only clears page memory ("Drive key removed from this browser session.")
2. She reads the README/guide: "Decryption keys and API keys are different: neither replaces the other." → Confirms rotation of API keys does not help
3. She revokes all agent keys via "Revoke access" → Server access ends; ciphertext in storage remains decryptable by anyone who holds the stolen drive key and obtains the ciphertext (presigned URLs require API access)
4. She creates "Research workspace v2" (new key), downloads files with the old key, and re-uploads via CLI with the new key → Manual migration
5. She deletes the old drive: Settings -> "Delete one drive", type the exact drive name, "Permanently delete drive" → Deletion request appears in "Deletion requests" with status pending/running/done

### Variations

- Share links to old files must be revoked via `agent-drive share revoke SHARE_ID --drive ID` before deletion

### Edge Cases

- Browser `Forget key` is the only one-click "key" action, easily mistaken for rotation

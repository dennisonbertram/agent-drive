# App Discovery: Agent Drive

## Application Type

Hybrid developer product: (1) a Next.js web app (marketing, pricing, Clerk auth, human "Operator Console", billing, settings/deletion, public share-download page) and (2) an agent-facing toolchain (CLI `agent-drive`, typed client library, local stdio MCP server, `skills/agent-drive/SKILL.md`). Zero-knowledge encrypted file drive: file contents are AES-256-GCM encrypted client-side ("ADRV v1"); server and R2 only hold ciphertext; paths, tags, descriptions, sizes and authorship are plaintext. Primary user is an AI agent; humans provision and oversee. Production: https://agent-drive.vercel.app (Clerk dev instance, Stripe test mode, Cloudflare R2, egress not charged/not metered).

Applicable path-category taxonomy: Authentication & Identity, Onboarding, Core CRUD, Navigation, Settings/Billing, Error States, Data Management (import/export, pagination), Content Management (upload, version history), Web responsive, CLI/Agent categories.

## Tech Stack

- Monorepo, pnpm 11 workspaces, Node 24. `apps/web` = Next.js (App Router, route group `(app)`, `proxy.ts` middleware), TypeScript, plain CSS files, Drizzle + PostgreSQL (10 migrations), Vercel hosting with 2 crons.
- `packages/agent-drive` = CLI (`cli.ts`, `node:util parseArgs`), `client.ts`, `mcp.ts` (@modelcontextprotocol sdk, stdio), `sync.ts`, `crypto.ts`, `config.ts`. Not yet published to npm (build from checkout; `pnpm agent-drive ...`).
- Storage: S3-compatible (R2 in prod, MinIO locally), presigned PUT/GET; `staging/` and `objects/` prefixes.
- Auth: Clerk (human, optionally GitHub OAuth); bearer API keys (SHA-256 hashed) for agents.
- Billing: Stripe (checkout, portal, webhook, metered usage), Resend email alerts.
- Tests: Vitest unit/integration/MCP, Playwright e2e with a stubbed test-session provider (`/api/test-session`, loopback only).

## User Roles

- Visitor / receiving party: anonymous; sees landing, /pricing, and opens `/s/<id>#k=<key>` share links with no account.
- Human operator (Clerk user, "Personal workspace"): owns an account; console (Files/Agents/API keys/Usage/Trash), billing, settings/deletion. Account is auto-provisioned on first authenticated console load.
- Plans (calendar-month allowances): Free (3 drives, 5 GiB storage, 5 GiB downloads, 1M ops, no card); Developer (25 drives, 100 GiB, 100 GiB, 10M ops, proposed $20/mo); Team (250 drives, 1 TiB, 1 TiB, 100M ops, proposed $200/mo). Overage rates per drive-month/GiB/GiB egress/1,000 ops; egress shows "Not charged" on R2. Paid checkout is disabled unless Stripe prices, rates and metering are configured ("Paid checkout is not enabled" banner). Optional spend cap blocks writes only. No per-seat team roles in code (single owner; "OWNER ONLY" audit pill).
- Agent API key: bearer token tied to one agent, a set of drives, and scopes `read`, `write`, `delete`, `share`, `manage` (management key: create agents/drives/keys; not auto-granted drive access). Drive key (separate secret, client-side) is required to decrypt/encrypt.
- Human console actor shows as `__console__` / "Human console" in usage and audit.
- Operator (self-host): `provision:local`, `billing:run`, `maintenance:cleanup-expired-uploads`, cron secret.

## Feature Map

### Marketing and public pages

- `/` landing: nav "Pricing", "Sign in"; hero "Your agents. Their own drive."; CTAs "Create your workspace" (-> /sign-up), "Open console"; terminal preview `agent-drive put ./handoff.md /memory/handoff.md`; three feature cards.
- `/pricing`: plan cards (CTA "Start with Free" / "Manage your plan"), "How usage works", "Additional usage on paid plans" (rates; "Not charged" for egress when unmetered), Private contents / Built around agents / Leave on your terms.

### Authentication (Clerk)

- `/sign-in`, `/sign-up` (Clerk components, optional GitHub); redirect to `/console`. If Clerk is not configured the pages show "Sign-up is not configured on this installation" panels.
- `/console*` is protected; `/console` redirects to `/sign-in` when unauthenticated. `UserButton` ("Your account") for sign-out/profile; test mode shows "Local test session".

### Console `/console` (single client component, tabs in sidebar "WORKSPACE")

- Header: "Refresh"; breadcrumb "Workspace / {tab}"; badge "CLIENT-SIDE ENCRYPTED"; sidebar note "Keys stay with you."
- Loading "Opening your workspace…"; error "Workspace unavailable".
- Files: empty-state onboarding "Give your first agent a home." with "Create your first drive" and steps 01 Create a drive / 02 Save your key / 03 Connect an agent. "+ New drive" modal ("Create a drive": name, e.g. "Research workspace") -> receipt modal with generated drive key (Web Crypto), "Save recovery key" (downloads `agent-drive-<id>.key.json`), checkbox "I saved my drive key securely", "Continue to drive". Duplicate name error "A drive with this name already exists. Load its original drive key instead."
  - Drive selector ("Selected drive"), drive ID code, badge "Key loaded" / "Key required for downloads", "Load drive key" (password input or recovery JSON file chooser; "Load key"), "Forget key"; key lives in page memory only, lost on reload.
  - File table (FILE PATH, ENCRYPTED SIZE, AUTHOR, Actions): filter "Filter loaded files…", row buttons "Download" (disabled until key loaded; decrypts in browser, notice "File decrypted in your browser. Download started."), "Trash" (confirm "Move … to trash?"), "Versions" (modal "Version history" with "Restore this version"), pagination (limit 100 / next cursor). Browsing names works while locked. No browser upload, rename or move (uploads are CLI/MCP only).
- Trash tab: deleted files with DELETED and RECOVERY columns, "Restore" (creates new current version).
- Agents tab: "+ New agent" (modal "Create an agent", e.g. "Research assistant"; notice "Agent created. Create an API key to connect it."), per-agent key counts, "Revoke access" (revokes all the agent's keys, confirm), empty state "Who's doing the work?".
- API keys tab: "+ New API key" (disabled until a drive and active agent exist; modal: agent select, Key label e.g. "Research laptop", "Allowed drives" checkboxes, "Permissions" scope checkboxes), receipt modal showing the key once ("This secret is shown only once"), checkbox "I saved my API key securely", "Done". Rows with Active/Revoked badge and "Revoke" (confirm). Empty state "Your agent's connection starts here." Connection guide "Connect without sharing your identity." (agent-drive login steps), link to billing.
- Usage tab: cards ENCRYPTED STORAGE, API OPERATIONS, EGRESS & COST; "Storage by drive"; "Usage by author" (AGENT, STORAGE, VERSIONS, OPERATIONS); empty "No storage used yet."

### Billing `/console/billing`

- "Billing & limits": current usage/estimate (excludes tax), RETAINED STORAGE, OBSERVED DOWNLOADS ("Not connected" when no egress metering), plan cards with buttons "Current plan" / "Included by default" / "Choose developer|team" / "Change to …" (Stripe Checkout redirect; prorations on invoice; notice "Plan updated. Stripe will apply prorations on your next invoice."), billing portal button (invoices/payment/cancel), configured overage rates, "Boundaries, not surprises." spending controls (spend cap in dollars, blank = no cap, 0 blocks writes; alert threshold; alert email; "Save spending controls"), "Usage by agent" with month selector ("Current month" / past statements), 5 GiB max file size note. Stripe webhook updates plan state.

### Activity and deletion `/console/settings`

- "Activity & deletion": "Audit log" (OWNER ONLY, Action/Actor/Result, "Load older events", metadata only); "Delete your data": "Delete one drive" (select drive, type exact name, "Permanently delete drive"); "Delete your account" (type `DELETE MY ACCOUNT`, "Permanently delete account"); "Deletion requests" list with status (pending/running/"Needs retry"/done), "Load older requests"; explainer "When is data actually removed?" (grace >= 10 minutes, async purge via cron).

### Public share page `/s/[id]#k=...`

- No sign-in. Shows file name, TRANSFER SIZE, LINK EXPIRES, "Download" (button label "Decrypting…" while busy). Error states: "This link is missing a valid decryption key", "Share link not found", "Share link revoked", "Share link expired", "Shared file unavailable". HTTPS required in production (403 otherwise). Key never sent to server; presigned URL valid <= 60 s.

### Agent CLI (`agent-drive`; config `~/.config/agent-drive/config.json` 0600; env `AGENT_DRIVE_API_URL`, `AGENT_DRIVE_API_KEY`, `AGENT_DRIVE_KEY[_<DRIVE_ID>]`, `AGENT_DRIVE_CONFIG`, `AGENT_DRIVE_MACHINE`)

- Identity/provisioning: `login --api URL --token-stdin` (or env vars; verifies via whoami, saves config), `whoami`, `agent create --name`, `drive create --name [--quota]` (idempotent; prints drive key once with backup warning; refuses if existing drive and key backup missing), `key create --agent --drive --label --scope ...` (default read+write), `key revoke ID`.
- Files: `put LOCAL REMOTE --drive ID [--overwrite | --if-version ID] [--description] [--tag]... [--user]` (create-only default; prints version JSON), `get REMOTE --drive ID [--output FILE] [--version ID]` (writes only after authenticated decryption; stdout only for small valid UTF-8; mode 0600), `ls [--prefix --tag --agent --machine --user --limit --cursor]`, `mv`, `cp [--version]`, `rm` (soft delete to Trash), `versions PATH`, `restore PATH [--version]`, `search [--query --tag ...]`, `recent [--since]`.
- Sharing: `share PATH [--version] [--expires-in 2m..30d]`, `share list`, `share revoke SHARE_ID`.
- `sync LOCAL_DIR --drive ID [--prefix /folder] [--overwrite-existing]`: upload-only, never deletes remote, skips symlinks, private SHA-256 + version manifests in `<config>.state`, skips unchanged, aborts with conflict errors (no local history for existing remote file; remote version changed or remote file gone). Output: `{uploaded, skipped, conflicts, accountId, manifestPath}`.
- `mcp` (start stdio server), `help`.
- Errors surface to stderr, including `Upgrade: <url>` and `Retry after: N seconds` lines for quota/rate limits.

### MCP tools (local stdio; restart needed after config change)

`whoami`, `put` (text or localPath; overwrite / ifVersionId; tags, description, userId), `get` (outputPath, created with `wx` exclusive create; inline text <= 64 KiB), `list`, `move`, `copy`, `delete`, `versions`, `restore`, `search`, `recent`, `share`. NOT in MCP: `sync`, share list/revoke, key/agent/drive management.

### Skill (SKILL.md)

Guides "Save or not" (no secrets, no chat transcripts, no disposable scratch), folder layout `/memory`, `/work/<task-id>`, `/outputs`, `/inbox`, handoff template, untrusted-content warning. SKILL.md still says `share` "is not available until Phase 5" (stale; share is implemented).

### REST API `/api/v1/*` (bearer; JSON `{items,nextCursor}`; limit default 50 max 100; no-store)

`GET whoami`; `GET/POST agents`; `GET/POST drives`; `GET/POST keys`; `DELETE keys/:id`; per drive: `POST put` (intent, presigned PUT to `staging/`), `POST commit`, `GET get|list|versions|recent|search`, `POST move|delete|copy|restore`, `GET/POST shares`, `DELETE shares/:id`. Per-key rate limit (`API_KEY_REQUESTS_PER_MINUTE`), audit entries, HTTPS enforced in prod, max upload 5 GiB, body limit 256 KiB for JSON.

### Console API `/api/console/*` (Clerk session)

`session`, `usage`, `agents` (+ `agents/:id/revoke`), `drives` (+ `drives/:id/trash`, drive DELETE), `keys`, `audit`, `deletions`, `account` DELETE, `billing` (GET, `billing/settings` PATCH, `billing/checkout`, `billing/portal`, `billing/statements`), console variants of file operations and shares.

### Other server routes

`/api/shares/[id]` (public share metadata + download URL), `/api/stripe/webhook`, `/api/cron/maintenance?job=cleanup` (every 5 min: deletion jobs + expired upload cleanup) and `?job=billing` (hourly; needs `CRON_SECRET`), `/api/test-session` (test only).

## Navigation Structure

- Public: `/` -> `/pricing`, `/sign-in`, `/sign-up`, `/console`. Pricing CTAs -> sign-up / billing.
- Console shell: left sidebar buttons Files, Agents, API keys, Usage, Trash (in-page tab state, not URLs; no deep link per tab) + links "Billing & limits" (`/console/billing`) and "Activity & deletion" (`/console/settings`); brand link back to `/`; `UserButton`. Billing/settings pages have their own back link to console.
- Modals: Create a drive / drive-key receipt / Load drive key / Create an agent / Create an API key / API-key receipt / Version history.
- Share page `/s/<id>` is standalone, no navigation.
- Agent surface: single `agent-drive <command>` namespace plus MCP tool list.

## Data Entities

- Account (human owner; Clerk user mapping, tombstones on deletion) - create on first console load, delete via account deletion.
- Agent (named identity) - create (console/CLI/API idempotent by name), list, revoke access (disable all keys). No rename/delete.
- Machine (per-agent host name from `AGENT_DRIVE_MACHINE`/hostname header) - auto-created on write.
- Drive (name, quota, plan limits) - create (idempotent by name), list, delete (async job). No rename.
- API key (agent, drives, scopes, label, hash, revoked_at) - create (secret shown once), list, revoke.
- File (path per drive) and Version (immutable, ciphertext size, wrapped file key, tags, description, agent/machine/user attribution) - put (create/overwrite/if-version), get, list, search, versions, move, copy, delete (soft), restore (new version). No hard purge of single files; only drive/account deletion purges.
- Upload intent (staging, expiring; cleaned by cron).
- Share (pinned file/version, expiry 60 s - 30 d, default 7 d, revoked_at) - create, list, revoke.
- File events (put/copy/restore/move/delete; surfaced via `recent`), Audit events (console Audit log).
- Billing: billing account, periods, egress events, meter reports, notifications, Stripe events, log objects, rate limits; Deletion jobs and receipts.

## Integrations

- Clerk: human sign-up/in, session for console API; dev instance in prod; optional GitHub. Unconfigured fallback panels.
- Stripe (test mode): Checkout, customer portal, webhook, metered usage price; `STRIPE_*` env; checkout gated by `checkoutConfigured`.
- Cloudflare R2 (S3 API): presigned PUT/GET, `ListObjectsV2` purge; `S3_EGRESS_METERING=none`; bucket CORS GET/HEAD/PUT; `staging/` 1-day lifecycle.
- Resend: spend/usage alert emails (`RESEND_API_KEY`, `EMAIL_FROM`); undelivered work stays pending.
- Vercel Cron: maintenance cleanup (*/5) and billing (hourly), bearer `CRON_SECRET`.
- PostgreSQL via `DATABASE_URL`. MCP hosts: Claude Code (`claude mcp add --transport stdio agent-drive ... cli.js mcp`), Codex (`config.toml`).
- Env-gated behavior: Clerk keys (auth pages/console protection), `AGENT_DRIVE_TEST_AUTH` (e2e stub), Stripe prices/rates (checkout buttons disabled), `S3_EGRESS_METERING`/`S3_LOGS_*` (egress "Not connected"/"Not charged"), `CRON_SECRET` (503 without), HTTPS-only share/API in production.

## Error, Empty and Loading States (notable)

Console: "Opening your workspace…", "Workspace unavailable", onboarding empty state, "Load your drive key first" tooltip, locked-key banner ("You can browse file names without a key"), invalid key file ("This is not a valid drive key file", "Choose a JSON recovery key file..."), wrong key on download (decrypt fails), "The encrypted file could not be downloaded." Billing: "Billing could not be loaded.", checkout disabled banner, "Enter a dollar amount with at most two decimal places." Settings: "No audit events loaded.", "No active drives", "No deletion requests loaded.", deletion accepted-but-status-stale message. Share: revoked/expired/not found/missing key. API/CLI: quota exceeded / payment required with Upgrade URL, rate-limit Retry-After, conflict on create-only put and stale `--if-version`, "Binary output requires --output", missing/wrong drive key, sync conflicts.

## Weekly Trace-Archive Journey: capability findings

- Upload: `put LOCAL REMOTE` (single file; reads whole file into memory; max 5 GiB; encrypted before upload; accepts `--tag`, `--description`). `sync DIR --prefix` handles a directory upload-only with idempotent skip of unchanged files. MCP has `put` with `localPath` but no directory sync.
- List/verify metadata: `ls --prefix`, `search --tag`, `versions PATH`, `recent --since` (returns version id, ciphertext size, author, machine). `put` prints the committed version JSON (the commit step runs before it returns), and `sync` records SHA-256 + version ID in a private manifest.
- Overwrite/versioning: put is create-only by default (re-uploading same path fails); `--overwrite` or `--if-version` replaces and keeps prior versions (counts toward quota); weekly archives should use dated paths (e.g. `/traces/2026-W45/...`), or sync with a stable prefix.
- There is NO dedicated "verify upload then delete local" command, no `--delete-after`, no checksum comparison command, and `sync` never deletes anything locally. The only strong verification is manual: `get REMOTE --output TMP` (authenticated decryption must succeed) then compare bytes/hash with the local file, optionally cross-check `ls` ciphertextSize; only then delete locally.
- `rm` on the drive is a soft delete (Trash, restorable); there is no remote TTL/retention or lifecycle for traces. Storage counts toward plan (Free 5 GiB), with ongoing retained-version cost; quota exhaustion returns payment-required with upgrade URL.
- Policy tension: docs/user-stories.md decisions say "Agent transcripts and training traces are not part of the product", and SKILL.md says not to save chat transcripts or disposable scratch; logs may also contain secrets. A trace-archive story must flag these (and the plaintext-metadata caveat for paths/tags).
- Unattended scheduling: needs non-interactive auth (`AGENT_DRIVE_API_KEY` env + `AGENT_DRIVE_KEY_<DRIVE_ID>` env, scoped key with `read`+`write` only, no `delete`), and humans retrieve later via console Files -> Load drive key -> Download, or `get`/`share`.

## Recommended Story Topics

1. Landing, pricing and plan discovery (anonymous visitor) — covers `/`, `/pricing`, CTAs, plan allowances, "Not charged" egress, unconfigured-Clerk fallbacks, mobile/desktop layouts.
2. Sign-up, sign-in and first console load — Clerk flows, redirect rules for protected `/console`, auto-provisioned account, sign-out via UserButton, session expiry, unauthenticated deep links.
3. Human provisioning: first drive, recovery key, agent and scoped API key — the console onboarding chain (Create your first drive -> Save recovery key -> checkbox -> New agent -> New API key -> one-time secret -> Done), duplicate-name and disabled-button edge cases, hand-off to `agent-drive login`.
4. Agent CLI file workflows and MCP tools — login (env/--token-stdin), whoami, put/get/ls/search/versions/restore/mv/cp/rm/recent, create-only vs `--overwrite` vs `--if-version`, tags/attribution filters, MCP tool equivalents and gaps (no sync/share list in MCP), missing/wrong drive key and scope errors.
5. Weekly trace-archive journey — agent uploads its own trace/log files weekly (dated paths, put/sync, env-based unattended auth with no delete scope), verifies via `get --output` + hash/ls size since no verify-then-delete command exists, deletes locally, later retrieves/restores; includes quota/payment-required, conflict on re-run, and the transcript-policy caveat.
6. Console file management: browse, unlock, download, trash, restore, versions — locked vs unlocked key states, Forget key, wrong key, filter, pagination, Trash tab restore, Version history restore, browser-side decryption.
7. Share links end to end — agent/CLI `share --expires-in`, `share list/revoke`, MCP `share`, receiving human opens `/s/<id>#k=` and Download, expired/revoked/missing-key/HTTP states.
8. Key lifecycle and access control — rotate key (issue new, revoke old), per-key Revoke, per-agent "Revoke access", scoped keys (read/write/delete/share), revoked key behavior from CLI/MCP, rate limiting.
9. Usage, billing and plan changes — Usage tab, Billing & limits, Stripe test checkout (Choose developer / Change to team), portal, spend cap/alerts, disabled-checkout state, quota-exceeded recovery from the agent side with the Upgrade URL.
10. Audit, deletion and account teardown — Activity & deletion: Audit log, delete one drive (typed confirm), delete account (`DELETE MY ACCOUNT`), deletion job statuses, async cron purge, post-deletion behavior of keys and share links.
11. Directory sync and multi-agent handoff — `sync` upload-only semantics, manifests, conflict/`--overwrite-existing` paths, `/memory` `/work` `/outputs` `/inbox` layout from the skill, two agents/machines on one drive with `recent`, `--agent/--machine` filters, human oversight in Usage-by-author.

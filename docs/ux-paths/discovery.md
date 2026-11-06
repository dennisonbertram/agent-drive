# App Discovery: Agent Drive

Source: code at main 2870d7a (branch docs/ux-review-2). Everything below is read from code, not observed in a running app. The older catalog and topics were treated as hints only.

## Application Type

Hybrid product: (1) a Next.js web app (landing, pricing, Clerk sign-in/sign-up, `/connect` approval page, human console, billing, settings/deletion, public share-download page) and (2) an agent toolchain (`agent-drive` CLI, typed client, local stdio MCP server, SKILL.md, and `/llms.txt` setup instructions). It is zero-knowledge encrypted file storage for AI agents. File contents are encrypted on the agent's machine (or in the browser for console downloads and share pages). The server and S3/R2 hold only ciphertext. Paths, tags, descriptions, sizes and authorship are visible to the service. Primary user is an agent; the human signs up, approves agents, oversees and recovers.

## Tech Stack

- `apps/web`: Next.js 16 app router, route group `(app)`, TypeScript, plain CSS (`app/styles/*.css`), no component library.
- Auth: Clerk for humans (`/sign-in`, `/sign-up`, `UserButton`). Local test-auth mode (`AGENT_DRIVE_TEST_AUTH=1`, development only): `POST /api/test-session` (loopback only, bearer secret, `userId` must match `e2e_*`) sets a signed cookie; the console shows "Local test session" and `/connect` shows "Local test session" as the account. Agents use bearer API keys (hashed server-side).
- Data: Postgres via Drizzle. Tables: accounts, agents, machines, drives, api*keys, files, versions, shares, upload_intents, audit_events, file_events, billing*\* (accounts, periods, egress events, meter reports, notifications, log objects), stripe_events, deletion_jobs, device_authorizations, device_offers, rate-limit tables.
- Storage: S3-compatible (R2 in production, MinIO locally), presigned PUT/GET. Max 5 GiB per encrypted upload.
- Billing: Stripe (checkout, portal, webhook at `/api/stripe/webhook`), email alerts, cron maintenance at `/api/cron/maintenance`.
- `packages/agent-drive`: CLI (`cli.ts`), `client.ts`, `mcp.ts` (12 tools), `sync.ts`, `backup.ts`, `check.ts`, `credentials.ts`, `device.ts`/`seal.ts` (device login and key sealing), `skill.ts`. Distributed as a tarball from the app: `npm install -g <origin>/cli/agent-drive.tgz`.
- Configuration switches that change what a user sees:
  - Clerk configured or not: sign-in and sign-up pages show "Sign-in is not configured on this installation" style panels when not.
  - Billing configured or not (rates plus checkout): pricing shows "Paid checkout is not enabled on this deployment" and disables paid buttons ("Coming soon").
  - `S3_EGRESS_METERING=none`: downloads shown as "Not metered".
  - Test auth (development only).

## Routes and Pages

| Route                     | Auth                                                                     | Purpose                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                       | public                                                                   | Landing: hero with copyable agent instruction `Set up Agent Drive: <origin>/llms.txt` and `npm install -g <origin>/cli/agent-drive.tgz`; problem section; multi-agent section with a mock "Connect trace-bot?" approval; plan cards; nav: Docs, Pricing, llms.txt, Sign in, Console |
| `/pricing`                | public                                                                   | Free / Developer / Team cards, "How usage works", overage rates, availability banner                                                                                                                                                                                                |
| `/sign-in`, `/sign-up`    | public                                                                   | Clerk components (fallback redirect `/console`), or "not configured" panel                                                                                                                                                                                                          |
| `/connect?code=XXXX-XXXX` | signed in (else redirect to `/sign-in?redirect_url=...`, code preserved) | Approve an agent's device login                                                                                                                                                                                                                                                     |
| `/console`                | signed in (else redirect to sign-in)                                     | Single client component with tabs Files, Agents, API keys, Usage, Trash                                                                                                                                                                                                             |
| `/console/billing`        | signed in                                                                | Plans, spending controls, usage by agent, statements                                                                                                                                                                                                                                |
| `/console/settings`       | signed in                                                                | Titled "Activity & deletion": audit log, delete drive, delete account, deletion requests                                                                                                                                                                                            |
| `/s/[id]#k=<key>`         | public                                                                   | Encrypted share download page (noindex)                                                                                                                                                                                                                                             |
| `/llms.txt`               | public                                                                   | Plain-text setup instructions for agents (origin-aware, adds `--api <origin>/api` on non-public hosts)                                                                                                                                                                              |
| `/cli/agent-drive.tgz`    | public                                                                   | CLI tarball (referenced by landing and llms.txt; not verified as a route file in `app/`)                                                                                                                                                                                            |
| `/api/test-session`       | dev only                                                                 | Test login                                                                                                                                                                                                                                                                          |

API groups (`apps/web/src/api/handler.ts`, `contract.ts`): `/api/v1/*` (agent bearer API: whoami, drives, agents, keys, device login and grant, per-drive put/commit/get/list/move/copy/delete/restore/versions/recent/search/shares/trash/key-backup), `/api/console/*` (cookie-auth mirror used by the console UI, plus billing endpoints, `deletions`, `audit`, `account`, `usage`, device endpoints for `/connect`), `/api/shares/:id` (public share metadata and short-lived download URL), `/api/oauth/*`, `/api/stripe/webhook`, `/api/cron/maintenance`.

## User Roles

- Signed-out visitor: landing, pricing, llms.txt, CLI tarball, sign-in/up. `/console`, `/connect`, `/console/billing` and `/console/settings` redirect to sign-in.
- Signed-in owner (one human per account, no teams or roles): all console views, approves agents on `/connect`, holds recovery files. Console actions appear in usage and audit as the reserved agent `__console__` (shown as "Console"; creating an agent with that name is refused).
- Agents (bearer keys, differ by scope and write path):
  - scopes: `read`, `write`, `delete`, `share`, `manage`, plus `delegate` (granted via the "Let this agent add other agents to its drives" checkbox on `/connect`).
  - write path: a key may be limited to writing under specific folders (`--write-path`, "Only allow writes under").
  - read-only agent: `check` prints `check ok ... (read-only)` only if the drive already holds a file, otherwise `check not verified`.
  - delegate agent: can `grant` or `credentials issue` to other agents, never more than it holds, and not `delegate` itself.
  - Hosted chat assistants without a shell are explicitly unsupported (llms.txt).
- Share-link recipient: no account; needs the full link including the `#k=` fragment.
- Operator (self-host): provisioning and maintenance CLIs, cron secret (not user-facing).

Plans (`src/billing/policy.ts`): Free $0 (3 drives, 5 GiB stored, 5 GiB downloads, 1M ops/month); Developer $20 (25 drives, 100 GiB, 100 GiB, 10M ops); Team $200 (250 drives, 1 TiB, 1 TiB, 100M ops).

## Feature Map

### Marketing and discovery

- Landing explains the problem (sandbox ends, machine changes, platform switches), has copy buttons for the agent instruction and the npm install line, plan cards, and a mock approval card.
- Pricing: plan cards ("Start with Free" goes to `/sign-up`; paid cards link to `/console/billing` when billing is configured, otherwise a disabled "Coming soon" button), usage rules (all retained versions and trash count toward storage; 5 GiB upload max; free accounts stop at allowances), overage rate list.
- `/llms.txt` is the primary onboarding doc and doubles as the agent's setup script.

### Sign-up / sign-in

- Clerk forms embedded at `/sign-up` and `/sign-in`; redirect to `/console`; `redirect_url` honoured when arriving from `/connect`.
- Account is provisioned on first authenticated console load. Sign out and profile through Clerk `UserButton` ("Your account"); no sign-out control in test mode.
- Not configured: a panel instead of a form. No password reset or profile pages in this app (Clerk handles them).
- Console API 401: "Your session expired. Sign in again."

### First-run setup (human + agent)

1. Human pastes `Set up Agent Drive: <origin>/llms.txt` into the agent (copyable from the landing page and from the console "Connect an agent" panel).
2. Agent installs the CLI (or uses `npx -y <tarball>`), runs `agent-drive login --name "<agent>" [--api <origin>/api]`, prints a link and code `XXXX-XXXX`.
3. Human opens `/connect?code=...` (signs in first if needed). Page shows "Connect <agent>?" with Agent, Machine, Account, Requested, the pairing code, and a warning to match the terminal code. Choices: the delegate checkbox "Let this agent add other agents to its drives"; "Add to an existing drive instead" (offered only when the account already has drives, the request would create a drive, and it has no prior scopes). In that mode: pick a drive, paste a drive key or `adcred1.` bundle or choose a recovery or bundle file (files and bundles are checked against the selected drive, a pasted raw key is not), "Read only" checkbox, "Only allow writes under (optional)" folder, "Use a new drive instead" link. Approve button, then an "Approved" state.
   - Variants: reconnect ("Reconnects to: <drives>", "Keeps its previous permissions"), offer from an existing agent's `grant` ("Offered by <agent>: drive X, scopes, writes under ..."), no code or bad code form (enter code XXXX-XXXX), expired or unknown request errors, "The request changed; review it again" race notice.
4. Agent finishes login by itself, then must back up credentials (`credentials export --to PATH`, or `--stdout | store && credentials confirm`), run `skill install`, and run `agent-drive check`, which refuses until backup is confirmed and prints `check ok`.

- Alternative human-first path in the console: "Create your first drive" onboarding (drive name, key generated in the browser, copy or "Save recovery key" as `agent-drive-<id>.key.json`, checkbox "I saved my drive key securely", "Continue to drive"), then Agents tab "Create your first agent", then API keys tab "Create API key" (label, agent, allowed drives, permission checkboxes read/write/delete/share/manage, default read+write). Secret is shown once with "I saved my API key securely". Agent then uses `login --token-stdin` or the terminal snippet.
- Sandbox continuity: `AGENT_DRIVE_CREDENTIALS` holds a bundle merged in memory (counts as backed up).

### Console as a cloud drive (Files tab), facts from code

- Layout: left sidebar ("Personal workspace / OPERATOR CONSOLE", nav buttons Files, Agents, API keys, Usage, Trash, links to "Billing & limits" and "Activity & deletion", privacy note, profile row); topbar with static text "Workspace / <tab>" and a "CLIENT-SIDE ENCRYPTED" label; a drives strip with one button per drive (name, size, file count) and "+ your next agent" to add a drive. On narrow screens the sidebar collapses behind a toggle.
- File list: ONE FLAT TABLE of full paths. Columns FILE PATH (directory prefix dimmed, file name emphasised), SIZE (encrypted size), AUTHOR (agent name, "Console" for the human), MODIFIED, actions. Loaded 100 at a time with "Load more files". Footer: "N loaded" and "File contents encrypted - Paths and metadata visible to the service".
- Row actions: Download (disabled until the drive key is loaded, tooltip "Load your drive key first"), Versions, Trash (immediate, no confirmation; notice "Moved <path> to Trash. Restore it from the Trash tab.").
- Drive key: badge "Key loaded" / "Key required for downloads"; "Load drive key" dialog accepts a pasted key, `adcred1.` bundle, or file; the key lives only in page memory and is gone on reload; "Forget key" button.
- Download: fetches ciphertext via presigned URL, decrypts in the browser, saves under the file name; notice "File decrypted in your browser. Download started."
- Key backup banner: when not backed up, a red banner "This drive's key hasn't been backed up..." with a copy button for `agent-drive credentials export`; once confirmed, an info line "Key backed up <date> (<method>)". "Download recovery file" appears when the key is loaded (records backup method `file`).
- Drive ID shown with a copy button on every drive view.
- Filter: a box "Filter loaded files" does a case-insensitive substring match on the path, only over pages already loaded; disabled with no files; empty result "No loaded files match ...".
- Versions dialog (from Files or Trash): version list with size, time, author, version ID, and Restore per version (creates a new version; "Previous versions are preserved").
- Trash tab: same table with DELETED date, "Versions preserved", actions Restore and Versions. Empty: "Nothing in the trash."
- Empty/loading/error: no drives ("Give your first agent a home"), no files ("Ready for your first file", button "Connect an agent" that jumps to the API keys tab), "Loading files...", "Could not load files." with Retry, full-page "Workspace unavailable".
- Absent in the console (no matching code in `console.tsx`): folder tree or folder navigation, in-drive breadcrumbs (the topbar crumb is only "Workspace / <tab>"), browser upload (the empty state says files come from the CLI or MCP), drag and drop, new folder, rename/move/copy, file preview or thumbnails, grid view, sort controls, multi-select or bulk actions, server-side search, a recents or activity feed for files, share-link creation or management, tag or description display, file detail page, deep links to a tab, drive or file (tab and drive are client state).

Differences from Dropbox / Google Drive (factual): flat path list instead of folders; no upload from the browser; no preview; download only after pasting the drive key each session; filter covers loaded rows only; no sharing UI; recents, search by tag/author/machine, move/copy and share exist only via CLI/MCP/API.

### Drives

- Create in console: name (max 128), key generated in the browser, receipt dialog requires acknowledgement. Drive count is limited by plan.
- Drives created by the device flow appear in the strip. Delete a drive from Activity & deletion.
- Usage tab shows storage by drive with bars (per-drive quota in the data model).

### Agents and API keys

- Agents tab: "Agent identities" list (name, id, "N active keys", "issued by <agent>" for keys made by `credentials issue`), "Revoke access" (confirm; revokes all of an agent's keys), "Create your first agent". "Connect an agent" panel (copy instruction, link to llms.txt, MCP setup snippets for Claude Code, Codex, Cursor).
- API keys tab: "Agent access" list (label, agent, scopes, drives, "issued by", Active/Revoked), Revoke per key (confirm), Create API key dialog, terminal instructions "Connect without sharing your identity" (rotate by creating a replacement, updating the agent, revoking the old key).
- Guard states: "Create a drive first.", "Create an agent first.", "Your agent's connection starts here."

### Usage, billing, settings

- Usage tab: stat cards (Encrypted storage incl. all versions and trash, API operations this month, link to Billing & limits), "Storage by drive" bars, "Usage by author" table (agent, storage, versions, operations).
- `/console/billing`: plan cards (upgrade through Stripe checkout; plan change message "Stripe will apply prorations on your next invoice"; portal), configured overage rates, spending controls (spend cap, alert threshold, alert email; validation "Enter a dollar amount with at most two decimal places"; max $10,000,000), usage by agent with a statement-period selector, egress "Not metered" note, banners when payment provider is not configured or payment setup needs restoring ("You can keep using the Free plan."). Spend cap blocks writes only.
- `/console/settings` ("Activity & deletion"): audit log (time, action, actor, key label, outcome pending/success/denied, HTTP status; "Load older events"), delete one drive (type exact drive name), delete account (type `DELETE MY ACCOUNT`), deletion requests with status (background job), "Load older requests", Refresh.
- No theme, language or notification preferences in the app.

### Sharing

- Create (CLI/MCP/API only): `agent-drive share PATH --drive ID [--version ID] [--expires-in 30m|24h|7d]` (2 minutes to 30 days). Output: `<origin>/s/<22-char id>#k=<file key>`; the key is in the URL fragment so the server never sees it. `share list`, `share revoke SHARE_ID`. Needs the `share` scope. MCP tool `share` creates links.
- Recipient page `/s/[id]`: file name, "TRANSFER SIZE ... encrypted", "LINK EXPIRES", Download button ("Decrypting..." while busy), footer "Your browser decrypts this file and the key never leaves it. No sign-in required."
- Errors: "This link is missing a valid decryption key" (with a paste-the-full-link form that validates: not a full link, link for a different share, no valid key), "Share link not found", "Share link revoked", "Share link expired", "Shared file unavailable", generic "Share unavailable" with Retry; "Checking this share link..." while loading.
- Share downloads count as egress.

### Agent CLI (`agent-drive`)

Commands: `login [--name] [--no-browser] [--api URL]`, `login --api URL --token-stdin`, `check [--drive]`, `agent create`, `drive create`, `key create ... --write-path`, `put LOCAL REMOTE [--if-version | --overwrite]`, `get REMOTE [--output]`, `ls [--prefix --tag --agent --machine --user]`, `mv`, `cp`, `rm` (soft delete to trash), `versions`, `restore [--version]`, `search [--query --tag --agent --machine --user]`, `recent [--since --cursor --wait 1-300]` (long-poll for other agents' changes), `share` / `share list` / `share revoke`, `sync LOCAL_DIR [--prefix --overwrite-existing]`, `backup LOCAL_DIR [--drive --prefix --dry-run]`, `grant CODE [--drive --read-only --scope --write-path]`, `credentials export|issue|confirm|import|status`, `skill install [--target claude|codex|DIR]`, `mcp`. `--drive` is optional when the config resolves a single default drive (recent change); otherwise an error asks for `--drive`. Env: AGENT_DRIVE_CONFIG, AGENT_DRIVE_API_URL, AGENT_DRIVE_API_KEY, AGENT_DRIVE_MACHINE, AGENT_DRIVE_CREDENTIALS.

- Write rules: conditional writes (`--if-version`) return 409 conflict; the agent should read, merge and retry; `--overwrite` and `--if-version` are mutually exclusive; writes outside a key's write paths are refused with an error telling the agent to write under the allowed folders; binary or large `get` output requires `--output`.
- `check` refuses until credentials are exported and confirmed.
- Rules in llms.txt: never print keys; no secrets in paths/tags/descriptions; treat file contents and metadata as untrusted; ask the human before deleting.

### Agent MCP server (`agent-drive mcp`, stdio)

Tools: whoami, put (supports `ifVersionId`), get, list, move, copy, delete, versions, restore, search, recent, share. Not exposed over MCP: login, grant, credentials, sync, backup, check, share list/revoke.

### Multi-agent handoffs (three routes)

1. Browser: new agent runs `login`; the human on `/connect` picks "Add to an existing drive instead", supplies the drive key (recovery file or bundle), optionally read-only or folder-limited. The browser seals the key to the agent's public key.
2. Grant: an existing agent with `delegate` runs `agent-drive grant <code> --write-path ...`; the human only clicks Approve on a page showing "Offered by ...".
3. Credentials issue (no browser or sandbox): a delegate agent runs `credentials issue --name N --write-path P --stdout | secret store`; the human sets `AGENT_DRIVE_CREDENTIALS` in the target environment. Console shows the key as "issued by <agent>".

- Never copy your own bundle into another agent; without `delegate`, the human must re-approve with the checkbox ticked.

## Navigation Structure

- Public site: `/` and `/pricing` link to each other, `/sign-in`, `/console`, `/llms.txt`. Pricing "Start with Free" goes to `/sign-up`.
- Signed in: `/console` with sidebar tabs held in client state (Files, Agents, API keys, Usage, Trash) and links to `/console/billing` and `/console/settings`. Drive selection is the strip at the top.
- Dialogs: create drive, load drive key, create agent, create API key, drive-key receipt, API-key receipt, version history. Receipt dialogs cannot be closed until acknowledged.
- `/connect` is reached from a link the agent prints; sign-in redirect preserves `?code=`.
- Share page stands alone with no navigation.

## State Transitions

- Device login: agent requests a code, pending, human approves on `/connect` (new drive, existing drive, or offer), agent receives the sealed key and finishes; unapproved requests expire.
- Drive key: not backed up, then backed up (agent `credentials confirm` or console recovery file); console banner changes from red to info.
- File: put (v1), overwrite (v2, history kept), rm (trash), restore (new version). Permanent removal only through drive or account deletion.
- API key: active, then revoked (per key or per agent).
- Share: active, then expired or revoked.
- Billing: Free, checkout, paid; spend cap reached blocks writes; payment failure shows a restore-payment banner.
- Account deletion: requested, background job, status in "Deletion requests".

## Data Entities

- Account: created on first console visit; deleted via settings.
- Drive: create (console, CLI, device login), read, delete (settings). No rename found.
- Agent: create (console, CLI, login), read, revoke access. No rename found.
- API key: create (console, CLI, device login, `credentials issue`), read, revoke. Scopes and write paths fixed at creation.
- Machine: recorded at login; used in `ls --machine` and recent events.
- File / Version: put, get, list, move, copy, delete (trash), restore, versions; tags and descriptions through client and CLI.
- Share: create, list, revoke (agent only).
- File event ("recent"): read via `recent`.
- Device authorization and offer: created by login and grant, approved on `/connect`.
- Audit event: read-only in settings.
- Billing account, period, statement; deletion job: read plus control actions.

## Integrations

- Clerk: human auth, UserButton, redirects.
- Stripe: checkout, portal, webhooks, metered usage.
- S3/R2 (MinIO locally): presigned ciphertext upload and download, billing log objects.
- Email provider: spend alerts.
- Vercel cron: maintenance (upload-intent cleanup, billing).
- MCP clients: Claude Code, Codex, Cursor.
- Secret stores (GitHub, Vercel examples in llms.txt) for `AGENT_DRIVE_CREDENTIALS`.

## Error, Empty and Loading States (summary)

- Console: workspace loading/unavailable, files loading/empty/failed/filter-empty, trash empty, no drives/agents/keys, session expired, reserved name `__console__`, key file errors ("This is not a valid drive key file", "Choose a JSON recovery key file...", "This recovery file does not belong to the selected drive", "Load the drive key to download file contents", "The encrypted file could not be downloaded").
- `/connect`: missing or invalid code, request not found or expired, session expired, wrong key file for the drive, "Paste the drive key or choose a recovery file", "This request has no agent key. Start again.", approval failure.
- Share: see Sharing.
- Billing: not configured, load failure, validation errors, provider URL errors.
- Settings: pagination failure; deletion accepted but status refresh failed (job continues).
- API: 409 conflict, scope denied, write-path denied, plan limits, rate limits, 401.

## Recommended Story Topics

1. Sign-up, sign-in and first console visit — landing to Clerk to empty console, Clerk-not-configured panel, session expiry, redirect back from /connect.
2. First-run agent setup via one pasted line — llms.txt, login, /connect approval, delegate checkbox, credentials backup, `check ok`, reconnect and expired-code variants.
3. Console as a cloud drive: browsing — flat file list, drive switcher, filter, load more, empty/loading/error states, and where it falls short of Dropbox/Google Drive (no folders, upload, preview).
4. Download and decrypt in the browser — loading the drive key (paste, bundle, file), forget key, key-backup banner, recovery file, wrong or missing key.
5. Search, recents and activity — CLI/MCP `search`, `ls` filters, `recent --wait`, console filter limits, audit log in settings.
6. Sharing — agent creates an expiring link, recipient opens /s/id (success, missing key, expired, revoked, not found), share list and revoke.
7. Trash, versions and restore — console Trash tab, Versions dialog, restore-as-new-version, CLI `rm`/`versions`/`restore`, `--if-version` conflicts.
8. Multi-agent handoffs — add to existing drive in the browser, `grant` offer, `credentials issue` for sandboxes, read-only and write-path limits, delegate rules.
9. Agents and API keys management — create agent and key in console, scopes, revoke key vs revoke agent, issued-by labels, rotation.
10. Billing, usage and limits — Usage tab, pricing page, billing page with and without Stripe configured, spend cap, plan limits reached.
11. Settings and data lifecycle — audit log, delete a drive, delete the account, deletion request status.
12. Agent CLI/MCP daily use and edge cases — put/get/ls/mv/cp, sync and backup dry-run, multiple drives and `--drive`, MCP tools, skill install, scope/write-path/size/binary-output errors.

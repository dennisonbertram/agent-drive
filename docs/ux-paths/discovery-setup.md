# Discovery: Agent Drive first-time setup flow

Source: worktree `/Users/dennison/develop/agent-drive-ux-setup`, branch `ux/setup-flow-review-nov27`, at origin/main `bcbb2f1` (CLI 0.5.1). Everything below was read from code and docs. Nothing was run in a browser or terminal. The Nov 6 catalog in `docs/ux-paths/` was used only for orientation, and much of it is stale (the install path, the console layout, the connect page, account keys and passkeys have all changed).

## Application Type

Hybrid product with several surfaces that a new user crosses during setup:

1. A Next.js marketing site and signed-in console (`apps/web`), at agentdrive.xyz.
2. A CLI and local MCP server (`packages/agent-drive`, npm package `@dennisonbertram/agent-drive`).
3. A signed macOS Finder app (File Provider), downloaded from GitHub Releases (`finder-v0.3.1`), driven by the CLI. Source in `native/macos`.
4. A Linux FUSE mount helper bundled inside the npm package (`native/mount`).
5. Agent skills (`skills/agent-drive`, `skills/agent-drive-trace-archive`) and a plain-text setup script for agents at `/llms.txt`.

The primary actor is an AI agent running a shell. The human signs up, approves the agent, and holds recovery material. File contents are encrypted on the agent's machine (or in the browser).

## Tech Stack

- Web: Next.js app router, route group `apps/web/app/(app)`, TypeScript, plain CSS in `apps/web/app/styles/`. Middleware is `apps/web/proxy.ts` (Clerk middleware on console, connect, sign-in and sign-up routes; Markdown twin rewrite for public docs pages).
- Auth for humans: Clerk (`/sign-in`, `/sign-up`, `UserButton`, `useReverification` for strict reverification). If Clerk keys are missing, pages show a "not configured" panel. A dev-only test auth mode (`AGENT_DRIVE_TEST_AUTH=1`) shows "Local test session".
- Auth for agents: bearer API keys (hashed server-side), issued by the device flow (RFC 8628, `docs/agent-login.md`).
- Data: Postgres via Drizzle (`apps/web/src/db/schema.ts`). Storage: S3-compatible object store holding ciphertext.
- Crypto: AES-256-GCM per-file keys wrapped by a 32-byte drive key; ECDH P-256 sealing of drive keys to a device login public key and to the account key; PBKDF2 passphrase wrapping of the account private key; WebAuthn PRF passkey wrapping.
- CLI: Node 24 or newer (`engines.node >=24.0.0`). Config in `~/.config/agent-drive/config.json` (mode 600), mount registry in `mounts.json` next to it, state in `<config>.state/`.
- Install artifacts: npm package (primary). Vercel build also runs `apps/web/scripts/prepare-cli-tarball.mjs`, which writes a gitignored `apps/web/public/cli/agent-drive.tgz` (so `/cli/agent-drive.tgz` is a static file, not a route; `docs/agent-login.md:24` keeps it "for older instructions").
- Billing: Stripe (checkout, portal, webhook). Paid checkout can be off per deployment.
- External CLI: `instabox` (third-party sandbox CLI) is required for live workspace mounts (`connect`).

## User Roles and personas relevant to setup

- Signed-out visitor (reads landing, pricing, docs, llms.txt).
- New owner (human), first sign-up. Has no drive, no agent, no account key.
- Owner coming from a CLI link: arrives at `/connect?code=XXXX-XXXX` signed out, is redirected to `/sign-in?redirect_url=...`, and must find the sign-up link if they have no account.
- Returning owner adding a second agent or second device (has drives and possibly a passphrase and passkey).
- The agent (Claude Code, Codex, Cursor, pi, opencode, a CI job). Persona variants: local agent with a shell; agent in a disposable sandbox using `AGENT_DRIVE_CREDENTIALS`; delegate agent (holds `delegate` scope, can `grant` or `credentials issue`); read-only agent; MCP-only agent; desktop coordinator agent mounting a remote sandbox workspace.
- macOS desktop user who wants Finder access to a drive or to a sandbox workspace.
- Linux user mounting a drive via FUSE.
- Trace-capture user (OpenRouter webhook or `agent-drive capture`).
- Unsupported: hosted chat assistants with no shell; Windows native mount.
- Self-hoster (passes `--api <origin>/api`). Touched here only where llms.txt adds that flag.

## Setup Feature Map

### 1. Landing, sign-up, first console visit

Landing `/` (`apps/web/app/(app)/page.tsx`, copy in `apps/web/src/content/home.ts`):
- Header (`apps/web/app/site-header.tsx`): links `Pricing`, `Docs`, `Sign in`; CTA `Sign up free` (to `/sign-up`). There is no "llms.txt" link in the header any more.
- Hero: tag "Portable storage for agents", h1 "Agent files that outlive the sandbox.", panel "Give this to your agent" with `> Set up Agent Drive: https://agentdrive.xyz/llms.txt` and button "Copy prompt" (aria label "Copy agent instruction"). Line "Free to start. Your agent shows a pairing code, and you approve it in your account." Then "or in a terminal:" `npm install -g @dennisonbertram/agent-drive` with "Copy command".
- Sections: problem ("Sandboxes end. Machines change. Platforms switch."), use cases, "See every file your agents saved.", "Encrypted. Sharable. Works anywhere.", comparisons (`/compare/...`), FAQ, "Start free." plan cards with `Choose plan` (to `/pricing`) and `Sign up free`, closing "Give your agent a drive." with `Sign up free`.
- FAQ entry "What happens if I lose the drive key?" says: save the recovery file when you create a drive, or ask the agent to run `agent-drive credentials export --to <a safe path>`.
- Footer: `apps/web/app/site-footer.tsx` (sign-up CTA, GitHub icon, Contact mailto).

Pricing `/pricing`: cards Free ($0), Developer ($20), Team ($200). Free card button `Start with Free` (to `/sign-up`). Paid cards `Choose Developer` / `Choose Team` (to `/console/billing`, which requires sign-in), or a disabled `Coming soon` when paid checkout is off. Plan choice is not part of onboarding: every account starts on Free.

Sign-up `/sign-up` and sign-in `/sign-in`: Clerk components (`apps/web/app/(app)/sign-up/[[...sign-up]]/page.tsx`, `.../sign-in/[[...sign-in]]/page.tsx`), `fallbackRedirectUrl="/console"`. A validated `redirect_url` is honored (`safeRedirect` in `site-header.tsx`). If Clerk is not configured: panel "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access." Page links to the other form via `AuthLinks`.

First console visit `/console` (`apps/web/app/(app)/console/page.tsx`, `console.tsx`, 4,635 lines):
- Unauthenticated: redirect to `/sign-in`. Note this redirect drops any intended return page (it is plain `redirect('/sign-in')`).
- Loading: "Opening your workspace…" / "Loading your drives and access settings."
- Load failure: "Workspace unavailable" / "Check the connection, then refresh to try again." with `Try again`.
- No drives (the real first-run state): onboarding panel. Eyebrow "CONNECT YOUR AGENT", h2 "Give your first agent a home.", text "Paste this line into your agent. It installs the CLI and gives you a link; open it and click Approve. The agent sets up its own encrypted drive.", the line `Set up Agent Drive: <origin>/llms.txt` with `Copy`, steps "1 Paste one line into your agent. 2 The agent shows a pairing code. 3 You approve it once.", and "Prefer to set up a drive yourself?" with `New drive`.
- Page header buttons: `Refresh`; on Files with drives, `Connect an agent` (opens the same panel body as a dialog); Agents tab `+ New agent`; API keys tab `+ New API key`.
- Sidebar tabs: Files, Agents, API keys, Usage, Trash; links `Billing & limits` (`/console/billing`) and `Activity & deletion` (`/console/settings`). Note: "Keys stay with you." privacy note; `UserButton` row "Your account".
- Passphrase banner, shown on Files while the account has no account key: "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." with button `Set up` (`data-testid="setup-passphrase-banner"`).

Human-first drive creation (alternative to the agent path), `New drive` dialog:
- Text: "We’ll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it." Field `Drive name` (placeholder "Research workspace", default "my-drive" when first drive), checkbox "Agent-only — never add this drive to passphrase unlock", button `Create drive`.
- Receipt dialog: "This key decrypts your drive. Without it nobody, including us, can open this drive. It is not sent to the service or saved in browser storage." `Show drive key`, `Copy drive key`, warning "The recovery file contains a secret in plaintext...", button `Download recovery file and continue`, then "Did the recovery file save?" with `I saved it` and `Download again`. `I saved it` records the backup (`recordBackup`).
- Name collision: "A drive with this name already exists. Load its original drive key instead."

Agents and API keys (manual path, console.tsx ~3680-3800, 4408-4560):
- Agents tab: collapsible "Connect an agent" panel (open when there are no agents and no keys) with the instruction, link "Read what your agent will see (llms.txt)", and MCP snippets for Claude Code (`claude mcp add agent-drive -- agent-drive mcp`), Codex (`~/.codex/config.toml` snippet), and "Cursor or any MCP client". Empty state "Who’s doing the work?" / "Create an identity for your first agent, then issue a scoped API key." / `Create your first agent`.
- API keys tab empty guards: "Create a drive first." / "Create an agent first." Secret shown once with the checkbox "I saved my API key securely".

Passphrase, key menu and unlock (account key), `unlock-dialog.tsx`, `vault-forms.tsx`, `key-chip.tsx`, `apps/web/src/console/vault.ts`:
- Key chip states: `Key needed`, `Key loaded`, `Locked`, `Unlocked`, suffix ` · Not backed up`. Help text "Not backed up. If the agent’s machine is lost, these files can’t be opened."
- Menu items: `Set up passphrase unlock`, `Download recovery file` / `Download recovery file again`, `Lock this browser`, `Forgot or exposed passphrase?`, Add a passkey (offered in a notice after setup, `data-testid="passkey-offer"`).
- Setup form: generated 20-character passphrase ("Your passphrase: we generated it in your browser. Save it in your password manager...") with `Copy passphrase`, or own passphrase ("at least 14 characters", "Type it again"), button text "Working… this takes a few seconds." while deriving; `Use a generated passphrase` / `Use my own passphrase` toggle. Checkbox `Keep this browser unlocked` (default on).
- Unlock dialog modes: passphrase, passkey ("Unlock with passkey", "Waiting for your passkey…", "Use your passphrase instead"), recovery file (`Choose recovery file`, `Paste a key instead`, `Load key`), setup, change ("Change passphrase"), reset ("Type RESET to continue", `Reset and remove all drives`), passkey enroll (`Add a passkey`, "Confirm with your passphrase"; needs strict reverification).
- Recovery help text inside the dialog: "No recovery file? An agent that has this drive’s key can add it to your account: run `agent-drive account seal --drive <id>` on its machine ... If it reports `unverified`, re-run it with `--fingerprint` set to the account-key fingerprint under Settings." with `Copy account seal command`.
- Settings (`/console/settings`, `settings-client.tsx`): card "Passphrase unlock" showing "Not set up." or "Passphrase set up <date>, fingerprint a1b2 c3d4 e5f6 7890, N drives added." and button `Manage in Files`. This is where the owner reads the fingerprint to give the CLI.

### 2. CLI install, login, approval, key transfer

Install (all in docs; no installer script):
- `npm install -g @dennisonbertram/agent-drive` (Node 24+). Fallback with no global install: `npx -y @dennisonbertram/agent-drive@latest <command>`. Sources: `docs/quickstart.md`, `docs/cli.md`, `apps/web/app/llms.txt/route.ts`, `docs/sandboxes.md`.
- Self-host: `agent-drive login --name "<n>" --api https://<origin>/api` (`llms.txt` adds ` --api <origin>/api` on non-public origins automatically).
- No Node version check is present in `packages/agent-drive/src/cli.ts` (I found none); the docs state the requirement.
- `agent-drive --help` prints the command list (`cli.ts:1715`). `agent-drive version` prints the version.

`/llms.txt` (`apps/web/app/llms.txt/route.ts`, plus `llmsIndex` in `apps/web/src/content/site.ts`, also `/llms-full.txt`): the agent script. Sections: "Set up (local agent with a shell)" steps 1 to 6 (install, connect, human approves, back up credentials, install skill, check), "Troubleshooting", "Sandboxes", "Adding another agent to your drive", "Several agents on one drive", "Hosted assistants", "MCP setup (optional)". Tells the human: open the link, check the code, type the verification code, click Approve.

`agent-drive login [--name AGENT] [--no-browser]` (`cli.ts:657`, `device.ts`):
- Prints exactly, in order: `Open this link to approve: <origin>/connect?code=XXXX-XXXX`, `Check that the code matches: XXXX-XXXX`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...`. Opens the browser when stdout is a terminal and `CI` is unset; `--no-browser` prints only.
- Polls `POST /api/oauth/token` every 5 seconds (adds 5 on `slow_down`). Code lifetime 10 minutes.
- Success output: `Logged in as agent <name>.`, `Usable drives: <ids>`, `Scopes: ...`, optional `Writes limited to: ...`, `Config: <path>`, and for a new drive `New drive <id> created; its key is saved in the config file.` then `BACKUP_HINT` (credentials.ts:33). Reconnect prints `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.`
- `agent-drive login --api URL --token-stdin` saves an existing key. `AGENT_DRIVE_API_KEY` makes login save that key instead of starting the browser flow.
- After login the CLI runs account-key sealing in the background (`sealSavedConnectionAfterKeyChange`).

Approval page `/connect?code=XXXX-XXXX` (`apps/web/app/(app)/connect/page.tsx`, `connect.tsx`, `/api/console/device/:code[/approve]`):
- Signed out: redirect to `/sign-in?redirect_url=/connect?code=...`.
- No code: card tag "Awaiting code", h1 "Connect an agent", "Enter the code your agent printed after running `agent-drive login`.", field "Code from your agent" (placeholder `XXXX-XXXX`), button `Continue` (`Looking up…`). Errors: "Enter the code your agent printed." / "Enter the code in the form XXXX-XXXX." / "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." Tag becomes "No pairing".
- Review: tag "Pairing request", h1 "Connect <agent name>?", one-line summary (for example "New encrypted drive · full access"), collapsible `Details` (Machine, Account, Drive, Access, Writes, Offered by, Requested; link `Use one of my drives instead (needs its recovery file)`; checkbox "Let this agent add other agents to its drives" with small print), an explanation line, then "Does this code match your terminal?" with the code in large type, "If it does not, close this page; the request expires on its own.", a field `Verification code` (placeholder `a1b2 c3d4 e5f6 7890`, hint "Type the code from your agent’s terminal. This page never shows it."), button `Approve agent` (`Working…`), note "You can revoke access any time in Console, Agents."
- Existing-drive mode: select `Drive`, `Drive key` (password input, "Paste the drive key or an adcred1… bundle"), `Or choose a file`, checkbox `Read only`, `Only allow writes under (optional)` (placeholder `/inbox/x`), `Use a new drive instead`. Hint "The key is checked against the drive before it is sent. A drive with no files or trace inbox has nothing to check it against."
- Verification gate errors: "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." and "This code does not match the one your agent printed. Check the terminal again and type it exactly."
- Key errors: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle." / "This key does not open the selected drive. Check the drive and paste its own key." / "This drive is no longer available. Reload the page and pick it again." / "The key could not be checked against the drive. Try again."
- Folder error: "Enter a folder that starts with / and does not end with /, for example /inbox/agent."
- Race: "The request changed; review it again." and, after an agent `grant` offer arrives: "<agent> offered a drive for this login. Review it before you approve." (refetch on window focus only, at most 10 times).
- Expired or used at approve time: "This request expired or was already used. Run `agent-drive login` in your agent to get a new code."
- Session expiry: redirects to `/sign-in`.
- Done: tag "Approval saved", h1 "Access approved for <name>", "You approved <name> to <access> <drive>. Return to your agent to finish setup and confirm it is ready." Optional note "This drive has nothing to check the key against, so it could not be checked before sending." Button `Open console` (to `/console`).
- There is no Deny control anywhere on this page, although the API has `POST /api/console/device/:code/deny` and the CLI handles `access_denied`.

Add another agent / device (`docs/connect-an-agent.md`):
- `agent-drive grant CODE --verify "a1b2 c3d4 e5f6 7890" [--drive ID] [--read-only] [--scope S]... [--write-path P]...` from an agent with `delegate`. Checks the verification code against the request public key before sealing; the owner then approves on `/connect` ("Offered by").
- `agent-drive credentials issue --name NAME [--drive ID] [--scope S]... [--write-path P]... [--label L] (--to PATH [--force] | --stdout)` for sandboxes; prints `AGENT_DRIVE_CREDENTIALS=adcred1....`.
- Recovery-file handoff on `/connect` (Details, "Use one of my drives instead").

First-time account key transfer (agent seals drive key to the owner's account key), `packages/agent-drive/src/account-seal.ts`, `cli.ts:1095`:
- Automatic: on `login`, `drive create`, `credentials import`, MCP start, and at most every 24 hours on commands that load a key. Best effort, never fails the command.
- First use needs a human-verified fingerprint: `agent-drive account seal [--drive ID] [--fingerprint "a1b2 c3d4 e5f6 7890"] [--repin]` or env `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT`. Output per drive: `<drive id>: sealed | already sealed | unverified | no account key | agent-only | unknown type`.
- Warnings: NO_ACCOUNT_KEY ("Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then."), UNVERIFIED_HINT ("The account key has not been verified on this machine. Copy its fingerprint from the console (Settings) and run `agent-drive account seal --fingerprint "<the fingerprint>"`. Sealing stays off until then."), fingerprint mismatch and pin mismatch errors, `--repin requires --fingerprint.`, `--fingerprint must look like "a1b2 c3d4 e5f6 7890", exactly as the console shows it.`
- Loop: owner sets passphrase in Files, reads fingerprint in Settings, types it into the agent terminal, agent seals, owner opens drive in Files with the passphrase.

Backup, then check (`quickstart.md` steps 4 and 5):
- `agent-drive credentials export --to 1password [--vault NAME]` (counts as backup at once), `--to clipboard [--keep-clipboard]` then `agent-drive credentials confirm`, `--to PATH [--force]` (mode 600, counts as backup), `--stdout | STORE && agent-drive credentials confirm`. `credentials import [--from PATH]`, `credentials status`.
- `agent-drive check [--drive ID]` prints `check ok`, refuses with `drive key not backed up: <ids>` plus the hint, or for read-only keys `check ok ... (read-only)` / `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.`
- First file: `put`, `get`, `share` (quickstart step 6).

### 3. macOS Finder app

- Where documented: `docs/cli.md` (lines 20, 240-266), `native/macos/README.md`, `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157`. It is not mentioned on the landing page, the console, or `/llms.txt`.
- Download: "Agent Drive Finder 0.3.1" zip from GitHub Releases `finder-v0.3.1`. Requires macOS 13 or later (tested on 15.7.7). Open the zip, drag `Agent Drive.app` to `/Applications`. The CLI does not install the app.
- First launch: the app shows no window. Documented variants: "Opening the app from Finder does not open a window; Finder adds the provider location when the CLI starts a mount" (`docs/cli.md`, native README) versus "open it once" (`README`, `SKILL.md`).
- There is no sign-in inside the app. It uses the CLI's credentials: install the CLI, run `agent-drive login`, then `agent-drive mount "$HOME/AgentDrive" [--drive ID] [--read-only]`.
- File Provider enablement: if startup fails, Finder shows the banner "Agent Drive is not enabled. To access Agent Drive click Enable." in the Agent Drive sidebar row; click `Enable` and rerun the mount. If macOS does not discover the extension, `/usr/bin/pluginkit -a "/Applications/Agent Drive.app/Contents/PlugIns/AgentDriveFileProvider.appex"`. Helper path override: `AGENT_DRIVE_FINDER_HELPER`.
- CLI diagnostics (`mount-mac.ts:27-58`): "Agent Drive Finder cannot access its shared container. Reinstall Agent Drive.app from the official download, then retry.", "The Agent Drive File Provider extension is disabled. Enable it in System Settings, then retry.", "macOS could not register the Agent Drive File Provider. Open Agent Drive.app from /Applications and retry.", "The Finder app and CLI could not establish their local connection. Update or reinstall Agent Drive.app, then retry.", "The macOS File Provider service is unavailable. Check the Agent Drive extension in System Settings and retry.", "macOS has not authenticated the Agent Drive File Provider. Open Agent Drive.app and retry.", "macOS cannot reach the Agent Drive File Provider...", "macOS could not start the Agent Drive File Provider extension...".
- First folder visible: Finder sidebar, Locations, row named `Agent Drive` (first 8 characters of the drive ID are added when several drives are registered). The CLI keeps running in the foreground; Ctrl+C once to stop; it creates a symlink at the requested mountpoint when it is free.

### 4. `connect`, mounts, sandboxes, Linux

Two different meanings of "sandbox" appear in the docs:
- A disposable machine where an agent runs. Persistence uses `AGENT_DRIVE_CREDENTIALS` (`docs/sandboxes.md`).
- An Instabox sandbox whose folder you mount on your desktop (`docs/cli.md` "Live workspace mounts", `packages/agent-drive/README.md` "Mount an existing Instabox workspace", `skills/agent-drive/SKILL.md:171`).

Live workspace commands (`cli.ts:840-1056`):
- `agent-drive connect NAME MOUNTPOINT --sandbox ID --root /WORKSPACE/PATH [--read-only] [--wake-on-access | --no-wake-on-access] [--persist]`. Usage error text identical to the help line. "Use only one of --wake-on-access or --no-wake-on-access."
- Release example: `agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" --sandbox "$SANDBOX_ID" --root "$WORKSPACE_ROOT" --persist`.
- `agent-drive mounts wake NAME on|off`; `mounts list`; `mounts status [NAME]`; `mounts forget NAME`; `mounts service install|status|remove NAME`; `mounts add NAME MOUNTPOINT [--drive ID] [--api URL] [--read-only] [--sandbox ID]`; `agent-drive mount --name NAME`.
- Does not use Agent Drive credentials. Needs the local `instabox` CLI (searched in PATH, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`). Error: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." No docs say where to get Instabox.
- Behaviors and errors: wake runs on first file access; "Instabox machine is <state>; wake-on-access is disabled."; "Instabox machine is in unsupported state: <state>."; "Instabox workspace wake timed out."; "Instabox machine did not reach the running state."; "Cannot forget '<name>' while its login service is <state>. Remove or repair it with `agent-drive mounts service remove <name>` first."; "Cannot forget '<name>' while its Finder mountpoint is present. Stop the mount and try again."; "Workspace service '<name>' did not become active."; "Cannot change wake policy because the managed service '<name>' is not the exact owned definition."
- Live mounts: read existing files, create new files; saving over an existing file fails safely with a read-only error. Hidden files such as `.env` are visible. `cp -n "$LOCAL_ENV_FILE" ".../.env"` copies a local `.env` only if none exists. macOS allows one registered mount per sandbox folder.
- Readiness messages (`workspace-service-readiness.ts`): "No exact Agent Drive FUSE mount is attached at the requested path.", "The expected File Provider domain UUID is unavailable.", "The requested Finder alias is not present.", "The requested mountpoint is not an Agent Drive Finder alias."

Linux drive mount (`agent-drive mount MOUNTPOINT [--drive ID] [--read-only]`, `docs/cli.md`): needs FUSE, `/dev/fuse`, `fusermount3` or `fusermount`; packaged helpers for x64 and arm64; mountpoint must be an empty directory owned by the user and not a symlink; Ctrl+C once; manual unmount `fusermount3 -u "$HOME/AgentDrive"`. Override helper with `AGENT_DRIVE_MOUNT_HELPER` (absolute path). Unsupported platform error (`mount.ts:1230`): "No packaged Agent Drive mount helper is available for this platform." or "...for <arch>." There is no Windows-specific message or documentation of Windows mount support.

Sandbox persistence (`docs/sandboxes.md`): `agent-drive credentials export --stdout | <secret store> && agent-drive credentials confirm`, set secret `AGENT_DRIVE_CREDENTIALS`, new sandbox runs `whoami` and `check`. `AGENT_DRIVE_MACHINE` sets a stable machine name. Failures table: network blocked, `no usable drive key`, `AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.`, `drive key not backed up`, `check not verified`, Codex approval message.

### 5. MCP and skills

- MCP: `claude mcp add agent-drive -- agent-drive mcp`; Codex `~/.codex/config.toml` with `[mcp_servers.agent-drive] command = "agent-drive" args = ["mcp"]` plus per-tool `approval_mode = "approve"` for `put` and `download`; any client `{"mcpServers":{"agent-drive":{"command":"agent-drive","args":["mcp"]}}}`. 13 tools (`docs/mcp-tools.md`, `packages/agent-drive/src/mcp.ts`). Under `codex exec` non-read-only tools fail with "MCP tool call requires approval, but approval policy is never". Tools take optional `driveId`; with several drive keys the tool errors and lists IDs. No MCP tool exists for login, check, credentials, grant or capture. "Restart the client after you change the saved credentials."
- Console panel "Connect an agent" shows the MCP snippets for Claude Code, Codex and "Cursor or any MCP client", but the Codex snippet there has no approval settings.
- Skills: `agent-drive skill install [--target claude|codex|DIR]` writes `~/.claude/skills/agent-drive/SKILL.md` and/or `~/.codex/skills/agent-drive/SKILL.md`; with neither directory it prints "No ~/.claude or ~/.codex directory found. The skill is at <path>; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>." `npx skills add dennisonbertram/agent-drive` installs both skills (`docs/skills.md`). `skills/agent-drive-trace-archive` comes only from skills.sh or the repo.
- The skill tells the agent to read `/memory` and recent files first, save outputs, and back up credentials.

### 6. OpenRouter webhook (trace capture)

- Entry points: Files tab, drive menu `Traces` / `Capture…` (`drive-menu.tsx`), or the "No traces yet." empty state link "add an OpenRouter webhook". Dialog `traces-dialog.tsx`.
- Dialog sections: "Local agents" (install command and `agent-drive capture --drive <id> -- claude`, with `Copy install command`, `Copy capture command`), "OpenRouter webhook".
- Webhook states: `Loading…`; "Could not load the webhook." with `Retry`; none: button `Add webhook`; active: "Created <time>", state `Active` or `Needs replacement`, buttons `Replace` and Revoke (confirm "Stop this webhook?" / `Revoke webhook`); stale note "The inbox changed after this token was created. Replace the token to resume trace delivery."; busy "Setting up…"; failure shows the error plus `Retry`.
- Flow (`apps/web/src/console/webhook-setup.ts`): needs the drive key in the tab (otherwise the unlock dialog opens, with "After <unlock step>, you can set up the OpenRouter webhook."); verifies the key belongs to the drive (`MISMATCH` "This key does not open this drive’s files."; `EMPTY_DRIVE` "This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive."); creates the trace inbox if missing; then two strict (Clerk reverification) calls: inbox challenge plus enroll, then challenge plus issue token. A 409 re-reads the inbox another tab created. Existing tokens need `Replace`.
- Result: "Copy these now. The token is shown once. In OpenRouter, add a Webhook destination." Fields `Webhook URL` (`https://<origin>/api/webhooks/openrouter/<drive id>`) and `Headers` (`{"Authorization":"Bearer adw_..."}`) with `Copy webhook URL` and `Copy headers JSON`; "In OpenRouter, leave Privacy Mode off for this destination, or traces will contain no prompts or replies."; footer "OpenRouter sends this trace to our server over TLS. The server reads it once to encrypt it to this drive’s inbox key; it never holds your drive key."
- Reverification: Clerk shows its own prompt. The dialog is suspended while the Clerk prompt is open (`native-dialog-suspension.ts`, `console.tsx` `strictFetcher`). If the user cancels, the error shown comes from `reason.message` in `traces-dialog.tsx` (the friendlier "Confirm it’s you to <doing>." from `vaultFailure` in `console.tsx:515` is used for vault actions, not for the webhook dialog; I did not confirm what Clerk's cancel message reads).
- Endpoint `POST /api/webhooks/openrouter/:driveId` (`docs/trace-capture.md`, response table).
- CLI capture alternative: `agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]`, fresh per-run proxy secret, messages `capture disabled: <reason>; running <command> without capture`, `capture: uploads stopped (<cause>); traces stay in <spool dir> for the next run`.

## Navigation Structure of the setup (handoffs between surfaces)

Primary loop, agent-first (the path the product promotes):
1. Website `/` (copy `Set up Agent Drive: https://agentdrive.xyz/llms.txt`) to the human's agent (chat, outside any Agent Drive surface).
2. Agent reads `/llms.txt`, runs npm install in a terminal, runs `agent-drive login`.
3. CLI prints link, code and verification code; opens browser (if a TTY) at `/connect?code=...`.
4. Browser: signed out leads to `/sign-in?redirect_url=/connect?code=...`; new users must switch to `/sign-up`; after auth Clerk returns to `/connect?code=...`.
5. Human reads the terminal (verification code), types it on `/connect`, clicks `Approve agent`.
6. CLI (polling) finishes, prints the drive and backup hint. Human is told by the agent (not by the page) to finish: the `/connect` done page says "Return to your agent..." and offers `Open console`.
7. Agent asks the human to choose a backup (1Password, clipboard, file), runs `credentials export`/`confirm`, `skill install`, `check`.
8. Human opens `/console` (first visit: no onboarding because a drive now exists, but a passphrase banner and Not backed up chip appear), sets a passphrase in Files (banner `Set up`), reads the fingerprint in `/console/settings`, goes back to the terminal: `agent-drive account seal --fingerprint "..."`, then returns to Files to open files.

Human-first loop: `/sign-up` to `/console` onboarding (`New drive`) to receipt dialog and recovery file download to Agents tab (`Create your first agent`) to API keys tab (`+ New API key`, secret shown once) to terminal `agent-drive login --api <origin>/api --token-stdin`.

Second agent loops: (a) `/connect` Details "Use one of my drives instead" with recovery file; (b) existing agent runs `grant` then human approves "Offered by"; (c) `credentials issue` to the sandbox platform secret store.

Desktop loops: CLI `agent-drive mount` to macOS Finder app (GitHub download) to System Settings or Finder `Enable` banner back to the CLI rerun. `connect` to `instabox` CLI to Finder or FUSE mount.

Trace loop: Console Files `Capture…` dialog, unlock dialog if no key, Clerk reverification prompt, back to dialog, copy URL and headers, switch to OpenRouter's site (outside), return to Files and watch `/traces` fill.

## Data Entities created during setup

Server (Postgres, `apps/web/src/db/schema.ts`): `accounts` (on first authenticated console or connect load), `drives` (name, `agentOnly`), `agents`, `machines`, `api_keys` (hashed, scopes, drive ids, write paths, label, issued-by), `device_authorizations` (pending, approved, denied, consumed; 10-minute expiry; public key; sealed drive keys) and `device_offers` (grant offers), `device_console_limits` (rate budget), `account_keys` (public key, wrapped private key, passkey wrapper), `account_key_slots` (one sealed drive key per drive), `drive_trace_inboxes`, `drive_trace_inbox_challenges`, `drive_webhook_tokens` (SHA-256 only), `audit_events`, `billing_accounts` (Free by default), key-backup records per drive (reported by the CLI after export or confirm).

Local machine: `~/.config/agent-drive/config.json` (API URL, API key, drive keys and their origins, key backup records), `mounts.json`, `<config>.state/` (account-key pins, seal throttle, capture spool, agent-only list), `~/.claude/skills/agent-drive/SKILL.md` and `~/.codex/skills/agent-drive/SKILL.md`, `~/.config/agent-drive/mount-writeback/` journals, login service definitions (macOS launchd or Linux user service) for `--persist`, `/Applications/Agent Drive.app`.

Human-held: recovery file `agent-drive-<drive id>.key.json`, credentials bundle (`adcred1.…`), account passphrase, passkey, webhook token (`adw_…`) and URL.

Browser: account private key in IndexedDB as non-extractable CryptoKey when "Keep this browser unlocked" is on; drive key in tab memory (cleared on reload or after 30 minutes idle).

## Integrations

Clerk (sign-up, sign-in, reverification, WebAuthn account). npm registry. GitHub Releases (Finder app, issues, repo link). Stripe (plans, from `/console/billing`). 1Password CLI `op`. Clipboard tools (`pbcopy`, `clip`, PowerShell). OpenRouter webhooks (OTLP JSON). Instabox CLI and sandboxes. macOS File Provider (`pluginkit`, System Settings extension toggle). Linux FUSE. MCP clients (Claude Code, Codex, Cursor). skills.sh (`npx skills add`). S3/R2 object storage. Vercel (build step prepares the CLI tarball).

## Error, empty, loading and recovery states

Website and console:
- Clerk not configured (sign-in, sign-up panels).
- Console session expired during API call: "Your session expired. Sign in again." and redirect to `/sign-in`.
- Console loading ("Opening your workspace…"), failure ("Workspace unavailable", `Try again`), first-run empty (onboarding panel), "No drives yet." on Trash, "Ready for your first file." / "Connect an agent with the CLI or MCP to upload encrypted files.", "No recent files.", "No traces yet.", "Nothing in the trash.", "Who’s doing the work?", "Create a drive first.", "Create an agent first.", "No storage used yet."
- Key and unlock states: `Key needed`, `Locked`, `Not backed up`; "This drive’s account copy is invalid — load its recovery file to repair it." (`MISMATCH` in console.tsx:497); "Agent-only: open with a recovery file."; "Checking passphrase status…" and "Couldn’t check passphrase status. Retry or use a recovery file."; "The passphrases don’t match."; "That key is not valid."; "That file could not be read."; "Passkey unlock is unavailable."; "Passkey setup is unavailable."; reset path "Type RESET to continue".
- Reverification cancelled: "Confirm it’s you to <doing>." for vault actions (`console.tsx:515-520`); webhook dialog shows the raw error with `Retry`.
- `/connect` states: all listed in feature map 2 (wrong/expired/used code, mismatched verification code, bad key, wrong drive, key unverifiable, folder format, changed request, expired at approve, session expired). Not present: a Deny button, a countdown or visible expiry time, a "wrong account" warning (the page only shows `Account` inside collapsed `Details`).

CLI:
- `login`: "Could not reach Agent Drive at <base>. Check the network and try again.", "Agent Drive refused the login request: ...", "Agent Drive returned an invalid user code. Run `agent-drive login` again.", "The login code expired. Run `agent-drive login` again.", "Approval was denied. No access was granted.", "Lost contact with Agent Drive at <base>. Run `agent-drive login` again.", "Login failed: <code>. Run `agent-drive login` again.", "Login finished but this agent has no usable drive key. Run `agent-drive login` again; the owner's approval will create a drive for this agent.", "Could not unseal the key for drive <id>; it is not saved.", "No usable key for: <ids>. You can list names but not read contents.", "Ignored a different API URL returned by the server."
- Config missing: "API configuration is missing. Run `agent-drive login` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY."
- Backup: 1Password errors ("Nothing was exported. Install the 1Password CLI ... check that `op whoami` succeeds, then run this again."), clipboard on Linux or WSL exits non-zero, "Could not clear the clipboard; clear it yourself.", "--method must be "stdout" or "file"."
- `check`: `drive key not backed up: <ids>` plus hint; `check not verified ...`.
- Mounts: Linux and Finder diagnostics above; "Usage: ..." strings for `connect`, `mounts ...`, `mount`.
- Skill install with no target directory: message above.
- Hosted chat assistants and Windows mount: only described in docs as unsupported (Windows mount not documented at all beyond the runtime error).

## Inconsistencies noticed (docs vs CLI help vs UI copy)

1. Verification code is missing from three newcomer-facing places that still describe the old "match the code" flow.
   - `docs/quickstart.md:35`: "The CLI prints a link and a code. Open the link while signed in, check that the code matches the one in the terminal, and click Approve." No mention of the verification code, which `/connect` now requires before Approve works.
   - `apps/web/src/content/home.ts:8`: "Your agent shows a pairing code, and you approve it in your account."
   - `apps/web/app/(app)/console/console.tsx:316` (and the same text in the onboarding panel at ~2858): "It installs the CLI and gives you a link; open it and click Approve." Onboarding step list at ~2874-2876: "The agent shows a pairing code." / "You approve it once."
   - Compare `apps/web/app/llms.txt/route.ts:33` and `docs/connect-an-agent.md:7`, which do describe typing the verification code. A human reading only the website or quickstart meets an unexplained required field.
2. A CLI warning points the owner to the wrong page for passphrase setup.
   - `packages/agent-drive/src/account-seal.ts:31`: "Set a passphrase in the console under Settings; agents will add the drive then."
   - `apps/web/app/(app)/console/settings/settings-client.tsx:103`: "Status only. Setting up, unlocking, changing and resetting all happen in Files." The Settings card only has `Manage in Files`. The console banner (`console.tsx` ~2835) and `docs/console.md` send the user to Files (`Set up` / "Set up passphrase unlock").
   - Related: the owner needs to read the fingerprint in Settings but set the passphrase in Files, and no single place states that order.
3. macOS Finder first launch is described two ways.
   - `packages/agent-drive/README.md:38` and `skills/agent-drive/SKILL.md:157`: "open it once" / "open it once before mounting".
   - `docs/cli.md:20` and `:240`, `native/macos/README.md:9`: "Opening the app from Finder does not open a window; the Finder location appears when the CLI starts a mount."
   - `mount-mac.ts` hints say "Open Agent Drive.app from /Applications and retry" or "Enable it in System Settings", while the docs say to click `Enable` on a Finder sidebar banner. Three different recovery locations for one problem.
4. The Finder app and the live-workspace feature are invisible on the website. `grep` of `apps/web` finds no reference to Finder, `connect`, `instabox` or the release download. `docs/sandboxes.md` (a site docs page, slug `sandboxes`) covers only the credentials-bundle meaning of "sandbox" and never mentions `connect`; `docs/cli.md` (slug `cli`) uses "sandbox" for Instabox machines. Instabox itself has no install or account instructions anywhere (`docs/cli.md:139`, only the error "Could not find an executable Instabox CLI in PATH or ~/.local/bin."). Windows: no doc says native mount is unavailable; the only signal is the runtime error "No packaged Agent Drive mount helper is available for this platform."
5. Deny is half-built. `connect.tsx` has no Deny or Cancel control and tells the user "If it does not, close this page; the request expires on its own." (`connect.tsx:836`), yet the API implements `POST .../deny` (`apps/web/src/api/device.ts:924`), the CLI prints "Approval was denied. No access was granted." (`device.ts:193`), and `docs/api-device-login.md:72` documents `access_denied` as "The person denied it".
6. Install path: `docs/agent-login.md:24` says the site still serves `/cli/agent-drive.tgz`, and `docs/deployment.md:287` describes it, but it is a gitignored build output (`apps/web/public/cli/`, `.gitignore:15`), not a route; every public surface now says npm. The old Nov 6 catalog and `docs/ux-paths/discovery.md` still describe the tarball as the install command.
7. `docs/quickstart.md` Step 1 "Create your account at /sign-up" is not part of the agent-driven path in `/llms.txt`, and `/connect` sends signed-out users to `/sign-in` (`connect/page.tsx`), not `/sign-up`. A brand-new user from the CLI link lands on the sign-in form and must notice the sign-up link.
8. Codex MCP setup differs by surface. `docs/mcp-tools.md` and `llms.txt` add per-tool `approval_mode = "approve"` for `put` and `download`; the console "Connect an agent" snippet (`console.tsx` ~303-309) shows the bare server block only, so an agent run under `codex exec` fails on first write with "MCP tool call requires approval".
9. Minor: the `/connect` link label "Use one of my drives instead (needs its recovery file)" (`connect.tsx:685`) under-describes the inputs; the form also accepts a pasted key or an `adcred1.` bundle. The Nov 6 discovery counts 12 MCP tools; `docs/mcp-tools.md` and `mcp.ts` have 13.
10. The `/console` unauthenticated redirect (`console/page.tsx`: `redirect('/sign-in')`) drops the return path, unlike `/connect` which preserves `redirect_url`. Clerk's `auth.protect()` in `proxy.ts` may add its own redirect; not verified at runtime.

## Recommended Story Topics

Eight topics that together cover the setup flow end to end. Each should include happy path, short exercises, and the error/recovery cases listed.

1. **Land, evaluate and sign up (website to first console visit).** Landing hero copy and copy buttons, docs/pricing/compare reading, `Sign up free` vs `Start with Free`, Clerk sign-up, first `/console` load with no drives (onboarding panel, loading and failure states), Clerk-not-configured panel, plan choice (Free default, `Choose Developer` path, `Coming soon`).
2. **Agent-first install and login (CLI and /llms.txt).** Give agent the instruction, npm install and npx fallback, Node version, `agent-drive login` output, browser open vs `--no-browser`, `--api` self-host, `--token-stdin`, polling, success output, expired code, network loss, and the bounce through `/sign-in` or `/sign-up` for a new user.
3. **Approve on /connect (device grant approval).** Code entry, review card and Details, verification code typing and mismatch, delegate checkbox, reconnect vs new drive, expired or already-used code, "request changed", no Deny, done page, wrong-account risk, and the `Use one of my drives instead` branch with recovery file, bundle, pasted key, read only and folder limit.
4. **Back up, check, first file, skill (end of agent setup).** Choose 1Password, clipboard, file or stdout export, `credentials confirm`, `check` outcomes (not backed up, ok, read-only, not verified), first `put`/`get`/`share`, `skill install` cases, console "Not backed up" chip clearing.
5. **Owner keys in the console: recovery file, passphrase, fingerprint, passkey.** Human-first `New drive` and receipt dialog, passphrase banner `Set up`, generated vs own passphrase, Keep this browser unlocked, Settings fingerprint, `agent-drive account seal --fingerprint`, outcomes (`sealed`, `unverified`, `no account key`, `agent-only`), passkey enrollment with reverification, lost passphrase, `Reset and remove all drives`, lost recovery file, Agent-only drives, key chip states.
6. **Second agent and sandbox continuity.** `grant --verify` with "Offered by", `credentials issue` and `AGENT_DRIVE_CREDENTIALS` in a sandbox, console Agents and API keys manual path (`Create your first agent`, `+ New API key`, secret shown once), revoke, MCP snippets and Codex approval failure, delegate scope, read-only agent.
7. **Desktop mounts: Finder app, Linux FUSE, live workspace `connect`.** Download and drag Agent Drive Finder, first launch with no window, `Enable` banner, System Settings and `pluginkit` recovery, first folder in Locations, Linux requirements and unmount, `connect coordinator ... --persist`, `mounts wake coordinator off`, Instabox missing or sandbox asleep, create-only live mounts, one-mount-per-folder, unsupported platforms including Windows.
8. **OpenRouter webhook and trace capture setup.** `Capture…` dialog, local `agent-drive capture`, `Add webhook` with locked drive (unlock then resume), key mismatch and empty-drive errors, Clerk reverification prompt (completed and cancelled), copying URL and headers once, Privacy Mode warning, `Replace` for existing users and `Needs replacement` state, revoke, empty `/traces` state.

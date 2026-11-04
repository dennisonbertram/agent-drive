# Topic 3: Human provisioning: first drive, recovery key, agent and scoped API key

Production: https://agent-drive.vercel.app (Clerk development instance, Stripe test mode). All console behavior below is in `apps/web/app/(app)/console/console.tsx`; CLI in `packages/agent-drive/src/cli.ts`.

## STORY-001: First drive via the onboarding empty state (happy path to a saved recovery key)

**Type**: medium
**Topic**: Human provisioning
**Persona**: Priya Raman, a freelance ML engineer who just signed up to give her research agent persistent memory
**Goal**: Create her first drive and safely store its recovery key
**Preconditions**: Signed in to https://agent-drive.vercel.app/console with a brand-new Clerk account; no drives exist
**Ideal path**: 3 — name the drive, save the key file, confirm (no extra step to reach the form if the empty-state button opens it directly)
**Alternate paths**: "+ New drive" header button on the Files tab (same modal); the API keys tab empty state "Create a drive first." -> "Create drive" button (same modal); CLI `agent-drive drive create --name NAME` (generates the key locally, prints it once, writes it to the config file); REST `POST /api/v1/drives` with a management key (no key generation; the client must make one)

### Steps

1. Open `/console` after sign-up → Page shows "Opening your workspace…" then the Files tab, heading "Drives & files", empty state "Give your first agent a home." with steps "01 Create a drive", "02 Save your key", "03 Connect an agent" and a "Create your first drive" button
2. Click "Create your first drive" → Dialog "Create a drive" opens: text "We'll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it.", field "Drive name" with placeholder "Research workspace"
3. Type "Priya research memory" and click "Create drive" → Dialog changes to "Your drive. Your key." showing a read-only "Drive key" textarea, "Save recovery key" button, warning "The recovery file contains a secret in plaintext. Store it in a password manager or another secure location. Losing this key means losing access to file contents."; "Continue to drive" is disabled; the close control is not offered
4. Click "Save recovery key" → Browser downloads `agent-drive-<drive-id>.key.json` (JSON with `format: "agent-drive-key-v1"`, `driveId`, `key`)
5. Move the file into her password manager's attachments, then tick "I saved my drive key securely" → "Continue to drive" becomes enabled
6. Click "Continue to drive" → Dialog closes, Files tab shows the new drive in "Selected drive", the drive ID in a code element, badge "Key loaded", and a "Forget key" button

### Variations

- Priya copies the key text from the textarea instead of downloading the file (two ways to capture the same secret)
- She uses the Chrome "Save as" prompt and picks a synced Downloads folder, not realizing the file now sits in plaintext in cloud sync

### Edge Cases

- She ticks the checkbox without actually saving; nothing verifies the save, and the key exists only in page memory afterwards
- She tries to reload during the receipt: the browser shows a native "Leave site?" prompt (beforeunload handler) and the key is lost if she proceeds
- The same drive key text appears in the textarea and inside the JSON file (same information on two surfaces)

## STORY-002: Duplicate drive name rejected, then recovered by loading the original key

**Type**: short
**Topic**: Human provisioning
**Persona**: Tomas Berg, an indie dev who half-remembers making a "Research workspace" drive last week
**Goal**: Create a drive named "Research workspace"
**Preconditions**: A drive named "Research workspace" already exists; Tomas has since reloaded the page so its key is not loaded
**Ideal path**: 2 — the form should detect the existing name and point to Load drive key
**Alternate paths**: CLI `agent-drive drive create --name "Research workspace"` is idempotent and returns the existing drive without a new key, but errors "Drive <id> already exists; load its backup through AGENT*DRIVE_KEY*<ID>." if no key is found locally

### Steps

1. Click "+ New drive", enter "Research workspace", click "Create drive" → Error banner in the dialog: "A drive with this name already exists. Load its original drive key instead."
2. Close the dialog, notice the existing drive in the "Selected drive" selector with badge "Key required for downloads", click "Load drive key" → Dialog "Load drive key" opens with "For Research workspace. Your key stays in this page's memory and is cleared when you reload."
3. Choose his old `agent-drive-<id>.key.json` via "Or choose a recovery file" → Key accepted, notice about the key being loaded

### Variations

- He pastes the raw key in the password-type "Drive key" input and clicks "Load key"

### Edge Cases

- The browser silently generated a new key during step 1 before the server rejected the name; it is discarded, so no key is shown (good) but the wording "Load its original drive key" assumes he still has it
- Name matching: "research workspace" with different casing or trailing spaces; the code trims but the server's idempotency is by exact name

## STORY-003: Creating an agent and its first scoped API key (default scopes)

**Type**: medium
**Topic**: Human provisioning
**Persona**: Priya Raman connecting her "Research assistant" agent running on her laptop
**Goal**: Get an API key that lets the agent read and write the one drive
**Preconditions**: One drive exists; no agents
**Ideal path**: 4 — agent name, key label, create, copy
**Alternate paths**: Agents tab "Create your first agent" button; Agents tab "+ New agent"; API keys tab empty state "Create an agent first." -> "Create agent"; "Connect an agent" button in the empty Files table; CLI `agent-drive agent create --name NAME` followed by `agent-drive key create --agent ID --drive ID --label LABEL --scope read --scope write` (needs an existing management key); REST `POST /api/v1/agents`, `POST /api/v1/keys`

### Steps

1. Click "API keys" in the sidebar → Heading "API keys"; "+ New API key" is disabled (no active agent); panel shows "Create an agent first." with a "Create agent" button
2. Click "Create agent" → Dialog "Create an agent": "An agent identity groups its keys, file versions, and activity." Field "Agent name" placeholder "Research assistant"
3. Enter "Research assistant", click "Create agent" → Dialog closes, tab switches to API keys, notice "Agent created. Create an API key to connect it."; "+ New API key" is now enabled; empty state "Your agent's connection starts here." ("Issue a scoped key. You'll see the secret only once.")
4. Click "Create API key" (or "+ New API key") → Dialog "Create API key": "Use a different key for each agent or machine. New keys do not grant access to future drives automatically."
5. Fill "Key label" with "Research laptop"; "Agent" select already shows "Research assistant"; under "Allowed drives" the selected drive is pre-checked; under "Permissions" "read" and "write" are pre-checked, "delete", "share" and "manage — account-wide administration; use sparingly" unchecked → Form ready
6. Click "Create API key" → Dialog "Save your API key": "This secret is shown only once. Store it securely and use it with agent-drive login. The service keeps only a hash." Read-only "API key" textarea with an `adk_...` token
7. Copy the token into her password manager, tick "I saved my API key securely", click "Done" → Dialog closes; row "Research laptop" shows "Research assistant · read, write", the drive name, badge "Active" and a "Revoke" button; connection guide "Connect without sharing your identity." below

### Variations

- Priya adds "delete" because she wants the agent to clean up; or leaves the defaults
- She creates the key from the Agents tab flow after reading "Separate identities. Purpose-built permissions."

### Edge Cases

- The agent named "**console**" is reserved: "That name is reserved for the human console."; it is filtered out of the Agents list
- Creating an agent with an existing name silently succeeds (server upserts by name), so a typo-duplicate is not flagged
- Unticking every "Permissions" box: the server rejects with a validation error "scopes must be a non-empty list of valid scopes." (no client-side prevention; no required attribute on the checkboxes)
- Unticking every "Allowed drives" box is accepted (empty drive list): the row shows "No drive access"

## STORY-004: Handing off from console to terminal: login and first put with a console-made drive

**Type**: long
**Topic**: Human provisioning
**Persona**: Priya Raman, comfortable in a shell, wiring the key into `agent-drive login` on her laptop
**Goal**: Make the CLI upload an encrypted file to the console-created drive
**Preconditions**: STORY-001 and STORY-003 done; CLI built from a checkout (`pnpm --filter agent-drive build`; not on npm); API key and recovery file saved in password manager
**Ideal path**: 4 — paste API key, paste drive key, put, verify
**Alternate paths**: Env-only (no `login`): export `AGENT_DRIVE_API_URL` and `AGENT_DRIVE_API_KEY`, never write config; `login --api URL --token-stdin` piping the key from a secret manager; `--key-file` flag on any command points to the recovery JSON (not listed in `help`, and the file is JSON, whereas `resolveDriveKey` reads it as the raw key text); MCP server via `agent-drive mcp` after the same env setup

### Steps

1. In the console API keys tab, read the "FROM YOUR TERMINAL" guide → Shows `read -rs -p "API key: " AGENT_DRIVE_API_KEY; export AGENT_DRIVE_API_KEY`, `agent-drive login --api https://your-agent-drive-host`, `read -rs -p "Drive key: " AGENT_DRIVE_KEY; export AGENT_DRIVE_KEY`, `agent-drive put ./handoff.md /memory/handoff.md --drive <drive-id>`, `agent-drive mcp`
2. In a terminal run the first line and paste the `adk_...` token at the hidden prompt → Variable set (no echo)
3. Run `agent-drive login --api https://agent-drive.vercel.app` → On success stdout prints JSON from whoami (accountId, agentId, keyId, scopes `["read","write"]`, driveIds [drive id]); config saved at `~/.config/agent-drive/config.json` (mode 0600)
4. Run `agent-drive put ./handoff.md /memory/handoff.md --drive <drive-id>` before setting a drive key → Fails because no drive key is found for that drive (she forgot step 5 of the guide)
5. Open the recovery JSON, copy the `key` value, run `read -rs -p "Drive key: " AGENT_DRIVE_KEY; export AGENT_DRIVE_KEY` and paste → Variable set
6. Re-run `agent-drive put ./handoff.md /memory/handoff.md --drive <drive-id>` → Prints committed version JSON
7. Switch to the console Files tab, click "Refresh" → Row `/memory/handoff.md` appears with ENCRYPTED SIZE and author "Research assistant"
8. Click "Load drive key", choose the recovery file, click "Download" on the row → Notice "File decrypted in your browser. Download started."

### Variations

- She runs `agent-drive login` without the env var and with `--token-stdin`: `printf '%s' "$KEY" | agent-drive login --api URL --token-stdin`
- She sets only `AGENT_DRIVE_KEY_<DRIVE_ID>` (uppercased, non-alphanumerics to underscores) because she has two drives

### Edge Cases

- `login` with missing values: "Set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY, or use --token-stdin."
- Pasting a stale or revoked key into `login`: whoami fails with the server message "The API key is invalid or revoked." and nothing is saved
- `login` reaches `connect()` before whoami only for later commands: later commands with no config print "API configuration is missing. Run `agent-drive login` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY."
- The console key textarea warning mentions `agent-drive login` but not the drive key; the drive key and API key are separate secrets on separate screens (the guide's closing line says "Decryption keys and API keys are different: neither replaces the other.")
- Different drive key in env vs. recovery file leads to decrypt failure on download, not at put time

## STORY-005: Disabled "+ New API key" button confusion with no drive or no agent

**Type**: short
**Topic**: Human provisioning
**Persona**: Hannah Okafor, skipping the onboarding steps and heading straight to API keys
**Goal**: Issue a key without having created anything yet
**Preconditions**: Fresh account: no drives, no agents
**Ideal path**: 2 — the empty state should lead straight into the missing prerequisite
**Alternate paths**: Sidebar order Files, Agents, API keys; Files onboarding steps 01-03

### Steps

1. Click "API keys" → "+ New API key" is greyed out (disabled when no drive or no active agent); panel says "Create a drive first." / "API keys belong to an agent and authorize specific drives." with button "Create drive"
2. Hesitate over the disabled header button, then click "Create drive" → Dialog "Create a drive" opens (note the tab remains API keys)
3. Complete the drive receipt flow (see STORY-001); then "Continue to drive" jumps back to the Files tab, not API keys → She must click "API keys" again, where the panel now reads "Create an agent first." with "Create agent"

### Variations

- Drive exists but no agent: she sees only the second message

### Edge Cases

- The disabled header button has no tooltip explaining why
- Same three-step prerequisite chain is described in the Files empty state (01/02/03), the Agents empty state ("Who's doing the work?"), and the API keys empty state: three surfaces

## STORY-006: Closing a receipt dialog by mistake and losing the secret

**Type**: medium
**Topic**: Human provisioning
**Persona**: Marcus Webb, rushing between meetings
**Goal**: Capture the API key and drive key shown in the receipts
**Preconditions**: Drive and agent exist
**Ideal path**: 2 — copy token, confirm
**Alternate paths**: none found for re-displaying a key (only revoke and re-issue); CLI `key create` also prints the token once

### Steps

1. Create a key (STORY-003 steps 4-6) → "Save your API key" dialog shows the token
2. Try to dismiss it by pressing Escape or clicking the backdrop → Dialog is not closable (closable is false for `driveReceipt` and `keyReceipt`); only "Done" works and it is disabled until the checkbox is ticked
3. Tick "I saved my API key securely" without copying, click "Done" → Dialog closes; token is gone forever
4. Notice later that the API keys row has no way to show the token → Row offers only "Revoke"
5. Create a replacement key with a new label ("Research laptop 2"), copy it properly, then revoke the first key via "Revoke" → Confirm "Revoke Research laptop? Commands using this key will stop working."; notice "API key revoked. It can no longer authenticate."

### Variations

- He reloads the tab at step 1: native prompt due to beforeunload; if confirmed, the token is lost
- A copy of the drive key: same pattern, but the drive key can be reloaded only from the recovery file

### Edge Cases

- Clipboard permission blocked in an iframe-less page; he must select the textarea manually
- Checkbox gate is honor-system, no copy confirmation

## STORY-007: Management key bootstrap from console for CLI-based provisioning

**Type**: long
**Topic**: Human provisioning
**Persona**: Devon Lindqvist, a platform engineer who wants a CI agent to create its own drives and per-machine keys with the CLI
**Goal**: Hand a "manage" key to a provisioning agent and let it create an agent, drive, and a narrow file key
**Preconditions**: Signed in; one console-made drive "Shared handoff" exists; an agent "provisioner" exists
**Ideal path**: 8 — one console key, then three CLI commands, then a narrower key swap
**Alternate paths**: Console only (STORY-003) with no CLI provisioning; REST calls against `/api/v1/agents|drives|keys` with the management key; the README describes "provisioning a local management key" for self-host (`provision:local` operator command, not available on the hosted site)

### Steps

1. API keys tab -> "+ New API key" → Dialog "Create API key"
2. Label "CI provisioner", Agent "provisioner", leave "Allowed drives" untouched, tick "manage" (hint "account-wide administration; use sparingly"), untick "read" and "write" → Form ready
3. Click "Create API key", copy token, tick "I saved my API key securely", click "Done" → Row shows "provisioner · manage" and "Shared handoff"
4. On the CI host export `AGENT_DRIVE_API_KEY` and run `agent-drive login --api https://agent-drive.vercel.app` → whoami prints `scopes: ["manage"]` and `driveIds: null` (a manage key reports no drive limit)
5. Run `agent-drive agent create --name nightly-indexer` → JSON with the new agent id (idempotent by name)
6. Run `agent-drive drive create --name "Index store"` → JSON includes `driveKey` and `warning: "Back up this drive key; it cannot be recovered."`; the key is also written to the CI host's config under `driveKeys`
7. Run `agent-drive key create --agent <agent-id> --drive <drive-id> --label ci-indexer --scope read --scope write` → JSON with `token` once
8. Replace the management key in the environment with the new scoped token and run `agent-drive whoami` → Shows scopes `["read","write"]` and only the one drive id
9. Return to the console Files tab, press "Refresh" → "Index store" appears in "Selected drive" with badge "Key required for downloads" (the drive key lives only in CI's config; the human has no copy)

### Variations

- Devon skips step 8 and keeps the manage key on the agent (the broad key stays active)
- Passing `--scope` more than once vs. omitting it (default `read` + `write`)

### Edge Cases

- A manage-only key cannot read files: `need(auth, 'read', driveId)` fails with "The API key lacks this scope." (HTTP 403); also the manage key does not auto-gain access to drives
- `key create` has no `--scope` validation client-side; a bad name returns "scopes must be a non-empty list of valid scopes."
- Human cannot download from "Index store" in the console until the CI host's drive key is transferred out of band; CLI offers no `drive export-key` command (key is in `~/.config/agent-drive/config.json`)
- `agent create` with an existing name returns the existing agent (no error)

## STORY-008: Opening the console on a new browser: drive visible, key missing

**Type**: short
**Topic**: Human provisioning
**Persona**: Aiko Tanaka, back on a different laptop two days after setup
**Goal**: Download a file the agent saved
**Preconditions**: Drive exists with files; recovery file is in her password manager
**Ideal path**: 3 — open Load drive key, choose file, Download
**Alternate paths**: CLI `agent-drive get REMOTE --drive ID --output FILE` with the key in env; share link

### Steps

1. Open `/console` and see the file table with badge "Key required for downloads" and banner "You can browse file names without a key. Load your drive key to decrypt and download contents. Keys are kept only in this page's memory." → "Download" buttons are disabled with tooltip "Load your drive key first"
2. Click "Load drive key", paste the key into the password input, click "Load key" → Notice "Key loaded into page memory. A download will verify that it matches this drive."
3. Click "Download" → "File decrypted in your browser. Download started."

### Variations

- She picks the wrong recovery JSON for another drive: error "This recovery file does not belong to the selected drive."
- She picks a non-key file: "This is not a valid drive key file." or "Choose a JSON recovery key file downloaded from this console."

### Edge Cases

- A wrong but well-formed key is accepted at load time and fails only at Download (the notice warns about this)
- Reload clears the key again; she must repeat each visit

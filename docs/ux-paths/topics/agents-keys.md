# Topic: Agents and API keys

Code read: `apps/web/app/(app)/console/console.tsx` (Agents tab, API keys tab, `agent` and `key` dialogs, `keyReceipt`), `apps/web/src/api/handler.ts` (keys, agents/revoke), `packages/agent-drive/src/cli.ts` (`agent create`, `key create`, `key revoke`, `login --token-stdin`, `credentials issue`).

Facts used below: Agents tab lists every non-`__console__` agent with "N active keys" and a "Revoke access" button (confirm dialog, revokes all of that agent's keys and also denies approved-but-unredeemed device logins). The agent row is NOT removed after revoke: it stays with "0 active keys". The API keys tab lists all keys ever made, including revoked ones (badge "Revoked", Revoke button disabled). The console Create API key dialog offers label, Agent select, Allowed drives checkboxes (current drive pre-checked), and Permissions checkboxes read, write, delete, share, manage (read and write pre-checked; manage carries the note "account-wide administration; use sparingly"). There is no write-path field and no delegate checkbox in the console dialog. The secret is shown once in "Save your API key" with Copy API key and checkbox "I saved my API key securely" before Done. No rename or edit of an agent or key exists.

## STORY-063: Human creates an agent and a read-only key in the console

**Type**: medium
**Topic**: Agents and API keys
**Persona**: Mara Okafor, a solo developer who wants a read-only "report-reader" agent to pull her notes drive into a dashboard job.
**Goal**: Have a key that can read the drive but not change it.
**Preconditions**: Signed in, one drive "Notes" exists, no agents yet.
**Ideal path**: 4 — name the agent, tick read only, create, copy the secret.
**Alternate paths**: CLI `agent create --name report-reader` then `key create --agent ID --drive ID --label L --scope read` (needs a key with `manage`). Device flow `login --name report-reader` then tick "Read only" on /connect only works when adding to an existing drive.

### Steps

1. Open /console, click "Agents" in the sidebar → heading "Who's doing the work?" with a "Create your first agent" button, plus a collapsed "Connect an agent" panel.
2. Click "Create your first agent" → "Create an agent" dialog, field "Agent name" (placeholder "Research assistant").
3. Type `report-reader`, click "Create agent" → dialog closes, UI jumps to the API keys tab, notice "Agent created. Create an API key to connect it."
4. On API keys, see "Your agent's connection starts here." with "Create API key"; click it → "Create API key" dialog.
5. Type label `dashboard job`; Agent select already shows report-reader; "Notes" is checked under Allowed drives; Permissions shows read and write checked.
6. Untick "write", leave "read", click "Create API key" → "Save your API key" dialog showing the secret in a textarea.
7. Click "Copy API key", paste it into the job's secret store, tick "I saved my API key securely", click "Done" → list shows "dashboard job", "report-reader · read", "Notes", badge Active.

### Variations

- She ticks "delete" or "share" by habit; nothing explains what they do besides the word.
- She makes the key before the agent: with no agent, the API keys tab shows "Create an agent first." with a "Create agent" button.

### Edge Cases

- Unticking every Permission box and submitting: no client-side guard seen in the dialog; the server decides (validation error shown in the dialog banner).
- Unticking every drive: key is created with "No drive access" shown in the list.
- Naming the agent `__console__` → "That name is reserved for the human console."
- Information about the secret and the "only shown once" warning appears three times (empty state, dialog text, receipt).

## STORY-064: Connect the new key to an agent with login --token-stdin

**Type**: medium
**Topic**: Agents and API keys
**Persona**: Mara, now at her server terminal with the secret on her clipboard.
**Goal**: Make the CLI on the server authenticate as report-reader.
**Preconditions**: Key from the previous story; CLI installed.
**Ideal path**: 2 — paste secret into one command; verify with whoami.
**Alternate paths**: Set `AGENT_DRIVE_API_KEY` in the environment (login saves it); the terminal snippet on the API keys tab ("Connect without sharing your identity") shows `read -rs ...; agent-drive login --api <origin>`; device flow (`login --name`) avoids pasting a secret at all.

### Steps

1. Scroll the API keys tab to the panel "Connect without sharing your identity." → a Bash snippet that reads the key silently, then `agent-drive login --api https://app.example`, then `agent-drive put ./handoff.md ...`.
2. Run `printf '%s' "$SECRET" | agent-drive login --api https://app.example --token-stdin` → CLI calls whoami and prints the identity JSON; config saved.
3. Run `agent-drive whoami` → shows agent name, scopes `read`, drive IDs, and `localDriveKeys` (empty on this machine).
4. Run `agent-drive ls --drive <id>` → listing works (shows ciphertext metadata) but `get` fails: this machine has no drive key.

### Variations

- She first follows the snippet literally and runs `agent-drive login --api ... ` without the key set → it falls into the device flow and prints a link and code instead (surprising; she did not want a browser).
- She types the secret as an argument instead of stdin; no such flag exists, so she is pushed to stdin.

### Edge Cases

- The snippet tells her to export `AGENT_DRIVE_KEY` (the drive key) separately; the page says "Decryption keys and API keys are different". A console-made key never brings a drive key with it, so a new machine cannot decrypt until she moves the drive key by hand (gap: no single "give this agent access and the drive key" action in the console; only /connect "Add to an existing drive" or `credentials issue` do that).
- The snippet text says "Run the CLI from the repository after building it", which is wrong for someone who installed from the tarball (gap).
- Pasted secret with trailing newline or spaces: login trims via stdin read; a truncated paste gives "The API key is invalid or revoked."

## STORY-065: Rotate a key without breaking the agent

**Type**: long
**Topic**: Agents and API keys
**Persona**: Dev Patel, who pasted a key into a chat transcript by mistake and wants it replaced before his nightly job runs.
**Goal**: Replace the key for agent "nightly-sync" with no failed run.
**Preconditions**: Agent "nightly-sync" with key "nightly laptop" (read, write, Notes), job runs at 02:00.
**Ideal path**: 3 — one "Rotate" action that creates the new key, shows the secret, and revokes the old one after confirmation.
**Alternate paths**: CLI `key create ...` then `key revoke ID` (needs a manage-scope key); no rotate command or button exists (gap).

### Steps

1. Open /console, click "API keys" → list with "nightly laptop", "nightly-sync · read, write", "Notes", Active.
2. Read the panel text: "To rotate access, create a replacement API key, update the agent, then revoke the old key." → the only rotation guidance, in the small terminal panel at the bottom.
3. Click "+ New API key" in the page header (the same button as the empty-state one; header buttons are "+ New agent" on Agents and "+ New API key" here) → "Create API key" dialog.
4. Dialog hint reads "Use a different key for each agent or machine."; nothing offers "replace this key" (gap: no rotate action).
5. In the dialog set label `nightly laptop 2`, agent nightly-sync, Notes, read and write → "Save your API key" appears with the new secret.
6. Copy, tick "I saved my API key securely", click Done → list now shows two Active keys for nightly-sync.
7. On the server run `printf '%s' "$NEW" | agent-drive login --api https://app.example --token-stdin` → whoami output prints; config replaced.
8. Back in the console click "Revoke" on "nightly laptop" → browser confirm "Revoke nightly laptop? Commands using this key will stop working." → OK → notice "API key revoked. It can no longer authenticate." and badge becomes Revoked, Revoke disabled.
9. Run `agent-drive whoami` on the old laptop → "The API key is invalid or revoked."

### Variations

- He revokes the old key first by mistake; the 02:00 job fails with an auth error until the new key is installed.
- He picks Revoke on the wrong row because both labels look alike (labels are free text, no key id shown in the row).

### Edge Cases

- A native `window.confirm` is used for revoke, not an in-app dialog.
- Revoked keys never disappear, so the list grows after repeated rotation and the badge "N active keys" is the only summary.
- Machine name of where a key is used is not shown in the keys list (gap), so he cannot tell which key is on which machine.

## STORY-066: Revoke one leaked key versus revoking the whole agent

**Type**: medium
**Topic**: Agents and API keys
**Persona**: Hana Ito, who sees a coworker's laptop was stolen and knows it held one of two keys for agent "ci-bot".
**Goal**: Cut off the stolen laptop but keep CI running.
**Preconditions**: "ci-bot" has keys "ci runner" and "hana laptop", both Active.
**Ideal path**: 2 — click Revoke on the one key and confirm.
**Alternate paths**: Agents tab "Revoke access" kills both keys; CLI `key revoke ID`.

### Steps

1. Click "Agents" → row "ci-bot", id, badge "2 active keys", button "Revoke access". Hesitates: the button label does not say it revokes every key.
2. Click "Revoke access" → confirm text "Revoke all API keys for ci-bot? This stops this agent's current access." She reads it, cancels.
3. Click "API keys" → rows "ci runner" and "hana laptop", each with Revoke.
4. Click Revoke on "hana laptop" → confirm "Revoke hana laptop? Commands using this key will stop working." → OK → notice "API key revoked. It can no longer authenticate."
5. Return to Agents → badge now reads "1 active key".

### Variations

- She clicks "Revoke access" and confirms; badge becomes "0 active keys" and CI breaks. Row stays on the Agents tab.
- To recover, she must create a new key for ci-bot and update CI (no undo).

### Edge Cases

- The same facts (agent, active key count) appear on both tabs with different revoke buttons.
- Revoking an agent also denies any approved but unredeemed device login for it.
- File versions authored by the revoked agent stay and keep the author name in Files and Usage.

## STORY-067: Scope check, "manage" is the dangerous box

**Type**: short
**Topic**: Agents and API keys
**Persona**: Luis Romero, creating a key for a untrusted script and unsure what the checkboxes mean.
**Goal**: Give the script only what it needs: write new notes but not delete or share.
**Preconditions**: Agent "script-1" exists.
**Ideal path**: 3 — pick scopes, create, copy.
**Alternate paths**: CLI `key create --scope write --scope read` (default when no --scope given: read and write).

### Steps

1. API keys → "Create API key" → Permissions list: read, write, delete, share, manage (with "— account-wide administration; use sparingly").
2. Leaves read and write on, hovers for help → no tooltips or descriptions for read, write, delete, share (gap).
3. Ticks only "read" and "write", creates, copies the secret.
4. On the script machine `agent-drive rm /notes/a.md --drive ID` → refused: the API key does not have permission for this operation.

### Variations

- He ticks "manage" because the label sounds like normal management; that key can list all keys and drives account-wide and create drives and keys.
- He wants the script to only write under /inbox: console dialog has no write-path field (gap); he must use CLI `key create ... --write-path /inbox` with a manage key, or `credentials issue --write-path`.

### Edge Cases

- `delegate` exists as a scope but the console never offers it; it is only granted via the /connect checkbox "Let this agent add other agents to its drives".
- Scopes cannot be edited later; changing means a new key and revoking the old one.

## STORY-068: Reading "issued by" labels after a sandbox handoff

**Type**: medium
**Topic**: Agents and API keys
**Persona**: Priya Nair, whose main agent "planner" issued credentials for a CI sandbox agent "sandbox-ci" and she now audits what exists.
**Goal**: Confirm who created the sandbox's key and revoke it when the job ends.
**Preconditions**: "planner" has `delegate`; it ran `credentials issue --name sandbox-ci --write-path /inbox/sandbox-ci --stdout`.
**Ideal path**: 2 — open API keys, read the row, revoke it.
**Alternate paths**: Agents tab shows the same "issued by planner" line under the agent id.

### Steps

1. Click "API keys" → row label (e.g. "sandbox-ci credentials"), "sandbox-ci · read, write · issued by planner", drive name below.
2. Click "Agents" → row "sandbox-ci" with id and small text "issued by planner" and "1 active key".
3. Decides the job is done; clicks "Revoke access" → confirm "Revoke all API keys for sandbox-ci? ..." → OK → notice "All API keys for sandbox-ci have been revoked."

### Variations

- planner agent has been revoked since; label still says "issued by planner" (looked up from the agents list).
- If the issuer id is unknown, the label reads "issued by another agent".

### Edge Cases

- The key list does not show write paths (only scopes and drives), so Priya cannot confirm "/inbox/sandbox-ci" is the only allowed folder from the console (gap).
- On the Agents tab the "issued by" line is taken from the first issued key only.

## STORY-069: Wrong agent picked, then the one-agent-two-machines question

**Type**: medium
**Topic**: Agents and API keys
**Persona**: Sam Whitfield, who runs the same assistant on a laptop and a desktop.
**Goal**: Decide between one agent with two keys and two agents; end with attributable history.
**Preconditions**: Agent "desk-assistant" exists with key "laptop".
**Ideal path**: 3 — add a second key with label "desktop" under the same agent.
**Alternate paths**: Run `login --name desk-assistant-2` on the desktop (device flow creates a second agent), CLI `key create`.

### Steps

1. API keys → click "+ New API key" → dialog's hint: "Use a different key for each agent or machine."
2. Select Agent "desk-assistant", label "desktop", create, copy secret, save.
3. Open Usage tab → "Usage by author" shows ONE row "desk-assistant" combining both machines (gap: machine is not an author column).

### Variations

- He makes a second agent "desk-assistant-2" to split attribution; Usage and Files author columns now distinguish them.
- A new agent with the same name as an existing one: behavior not verified in the UI (name uniqueness not checked in the console code).

### Edge Cases

- The Agents tab never shows machine; machines show up only in `ls --machine` and `recent`.
- Agents cannot be renamed after creation.

## STORY-070: Key revoked mid-session, agent sees the failure

**Type**: short
**Topic**: Agents and API keys
**Persona**: Tomas Berg, an agent operator watching an agent run `sync` when the owner revokes its key.
**Goal**: Understand why writes stopped and recover.
**Preconditions**: Agent "trace-bot" syncing /inbox/trace-bot/2026-11-05.jsonl.
**Ideal path**: 2 — read the error, ask the human for a new key.
**Alternate paths**: Re-run `agent-drive login --name trace-bot` to restart device approval.

### Steps

1. Owner clicks Revoke on the key → notice "API key revoked. It can no longer authenticate."
2. Agent's next call fails with "The API key is invalid or revoked." (HTTP 401).
3. Agent runs `agent-drive login --name trace-bot` → prints link and code; human approves on /connect; new key stored.

### Variations

- Owner used "Revoke access" on the agent; if a device login had been approved but not yet redeemed, that login is denied too.

### Edge Cases

- MCP shows "Authentication failed." for the same failure (mapped generic text), less specific than the CLI/API message.
- Agents cannot tell "revoked" from "mistyped" key.

## STORY-071: Delegated agent cannot manage keys

**Type**: short
**Topic**: Agents and API keys
**Persona**: Ines Duarte, an agent developer whose "planner" agent (delegate) tries to list all keys.
**Goal**: Learn what a delegate may do.
**Preconditions**: planner has read, write, delegate; no manage.
**Ideal path**: 1 — read the error.
**Alternate paths**: none found.

### Steps

1. planner runs `agent-drive key create --agent ID --drive D --label x` → delegated keys must not pass agentId; request is refused (validation: "agentId is not allowed; pass agentName.").
2. planner runs `agent-drive credentials issue --name worker --stdout` → works; a new agent and key appear in the console as "issued by planner".
3. planner tries `agent-drive key revoke ID` → permission denied (revoke needs manage).

### Variations

- Without delegate, `credentials issue` returns "The API key needs the delegate scope."

### Edge Cases

- `key create` CLI requires --agent, --drive, --label even for delegates, so the documented path is `credentials issue` (CLI usage text lists both without saying which needs which scope).

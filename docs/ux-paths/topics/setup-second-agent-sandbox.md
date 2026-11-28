# Setup topic: Second agent and sandbox continuity

> ID note: stories in this file now use catalog IDs SETUP-043 to SETUP-050 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-043, 02 = SETUP-044, 03 = SETUP-045, 04 = SETUP-046, 05 = SETUP-047, 06 = SETUP-048, 07 = SETUP-049, 08 = SETUP-050.

Source: worktree `/Users/dennison/develop/agent-drive-ux-setup`, code read only, nothing run. Temporary IDs `STORY-SECOND-AGENT-SANDBOX-NN`.

Key code anchors used below:

- CLI: `packages/agent-drive/src/cli.ts` (grant 1065, credentials issue 780, help 1715), `device.ts` `grantLogin` (~285-340), `credentials.ts` `issueCredentials` (~240-300).
- Web: `apps/web/app/(app)/console/console.tsx` (ConnectAgentBody ~300-330, Agents tab ~3676-3745, API keys tab ~3765-3895, agent/key dialogs ~4408-4545), `apps/web/app/(app)/connect/connect.tsx`, `apps/web/src/api/device.ts:795`.
- Docs: `docs/connect-an-agent.md`, `docs/sandboxes.md`, `docs/mcp-tools.md`, `apps/web/app/llms.txt/route.ts:88-140`.

---

## SETUP-043: Hand a drive to a second laptop agent with grant --verify

**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Priya Raman, a freelance data engineer. Her Claude Code agent "priya-mbp agent" already holds drive `research-notes` and was approved with "Let this agent add other agents to its drives" ticked. She now wants her Codex agent on a desktop to share the same drive, limited to `/codex`.
**Goal**: Codex agent can read the drive and write only under `/codex`, without Priya ever handling the drive key.
**Preconditions**: Priya is signed in at agentdrive.xyz. Claude Code agent key has `delegate`. Codex machine has the CLI installed, not logged in. Both CLIs are a version that requires `--verify`.
**Surface**: mixed (CLI on two machines, web `/connect`)
**Ideal path**: 7 — login on new agent, relay verification code, grant, open link, type code, Approve, confirm with `whoami`.
**Alternate paths**: (a) recovery file on `/connect` Details, "Use one of my drives instead (needs its recovery file)"; (b) `credentials issue` if the new agent had no browser; (c) manual console Agents plus `+ New API key` plus `login --token-stdin` (gives an API key but no drive key, see SETUP-047).

### Steps

1. On the Codex machine, run `agent-drive login --name "codex-desktop"` → prints `Open this link to approve: https://agentdrive.xyz/connect?code=K7QM-2XPD`, `Check that the code matches: K7QM-2XPD`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...`. The browser may open on this machine (TTY, `CI` unset).
2. Priya stops here. She does not click Approve yet, because she wants the Claude Code agent to seal the key first. She tells Claude Code the code and the verification code (typed into the chat).
3. On the first machine the agent runs `agent-drive grant K7QM-2XPD --verify "a1b2 c3d4 e5f6 7890" --write-path /codex` → prints `Request from codex-desktop on <machine>, made <timestamp>.` then `Offered drive <drive id> to codex-desktop (read write; writes under /codex). The owner approves at https://agentdrive.xyz/connect?code=K7QM-2XPD.`
4. Priya opens (or reloads) `/connect?code=K7QM-2XPD`. Tag "Pairing request", h1 "Connect codex-desktop?". Details lists "Offered by" `priya-mbp agent`. Banner after refocus: "priya-mbp agent offered a drive for this login. Review it before you approve."
5. She types `a1b2 c3d4 e5f6 7890` into `Verification code` (hint: "Type the code from your agent’s terminal. This page never shows it.") and clicks `Approve agent`.
6. Page shows tag "Approval saved", h1 "Access approved for codex-desktop", "Return to your agent to finish setup and confirm it is ready." with `Open console`.
7. The Codex terminal prints `Logged in as agent codex-desktop.`, `Usable drives: <id>`, `Scopes: read write`, `Writes limited to: /codex`, `Config: ~/.config/agent-drive/config.json`. Agent runs `agent-drive whoami` and `agent-drive check`.

### Variations

- Priya relays the code in the wrong order of operations: she approves on the page before the grant arrives. The approval then creates a new empty drive for codex-desktop (default path) instead of sharing `research-notes`. This is the biggest trap: the page does not warn that a grant is still expected (only `/connect` copy "does this code match your terminal?").
- `--read-only` instead of `--write-path`: Scopes line shows `read`; `check` later prints `check ok ... (read-only)` or `check not verified` on an empty drive.
- Two drive keys on the first machine: `grant` fails with "Pass --drive <id>; this machine holds no single default drive key."

### Edge Cases

- Verification typo on the CLI: error "The verification code does not match this request. Check the code the new agent printed; if it is right, do not grant — the request may have been tampered with." The alarming wording for a typo.
- Omitting `--verify`: "grant requires --verify <verification code>: the code the new agent printed under "Verification code:" when it ran `agent-drive login`. Ask the human for it."
- Granting key lacks `delegate`: server error "The API key needs the delegate scope." (`apps/web/src/api/device.ts:795`). Nothing in the grant error tells the agent how to fix it; the fix (ask Priya to re-approve with the checkbox) is only in docs and llms.txt.
- Grant key has `read write` but new scopes requested outside them: "This key does not hold read and write; pass --scope for what it may grant." (only when no `--scope` was passed).
- Request expired (10 minutes): grant fails at the lookup; Codex prints "The login code expired. Run `agent-drive login` again."
- Same fact on several surfaces: the verification code appears in the Codex terminal, the chat message, the grant command and the web field. The pairing code appears in the terminal, the URL, the large type on `/connect` and the grant command.
- Contradiction: `docs/quickstart.md:35`, `apps/web/app/(app)/console/console.tsx:316` and `apps/web/src/content/home.ts:8` describe approval as "check that the code matches"/"click Approve" without the verification code that `/connect` requires.

---

## SETUP-044: Persist an agent into a CI sandbox with credentials issue

**Type**: long
**Topic**: Second agent and sandbox continuity
**Persona**: Marcus Webb, platform engineer at a 6-person startup. His laptop agent "marcus-dev agent" has `delegate`. Nightly CI jobs run in disposable containers on a hosted runner, no browser. A GitHub Actions secret store and 1Password are available.
**Goal**: Every nightly sandbox starts with its own agent identity, writes only under `/ci/nightly`, and can be revoked on its own.
**Preconditions**: Laptop agent logged in, drive `team-memory` backed up via `credentials export`. `agent-drive check` prints `check ok`.
**Surface**: mixed (CLI, CI secret store, web console)
**Ideal path**: 6 — issue to secret store, set secret, run `whoami` and `check` in the sandbox, confirm `Agents` row, done.
**Alternate paths**: (a) `--to PATH` mode 600 file then copy by hand; (b) grant needs a browser and human, so not viable here; (c) manual API key in console (no drive key, so the sandbox could not decrypt); (d) copying the laptop bundle into CI, which docs forbid.

### Steps

1. On the laptop, agent runs `agent-drive whoami` → checks scopes include `delegate`.
2. Agent runs `agent-drive credentials issue --name "ci-nightly" --write-path /ci/nightly --stdout` directly in a terminal. → Error: "Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials issue --name <agent> --stdout | <your secret store>`, or use --to <path>." (Marcus hesitates, thinks it failed.)
3. Agent reruns with a pipe: `set -o pipefail; agent-drive credentials issue --name "ci-nightly" --write-path /ci/nightly --stdout | op item create --category "API Credential" --title "agent-drive ci-nightly" ...` → stderr: `Created agent "ci-nightly" with key <key id>: scopes read write, writes only under /ci/nightly.` then `Store this line as a secret in the sandbox. Revoke it from the console under Agents.`
4. Marcus opens GitHub repo settings, creates secret `AGENT_DRIVE_CREDENTIALS`, pastes the value. He pastes the whole line `AGENT_DRIVE_CREDENTIALS=adcred1.…` including the prefix (the printed line includes the name).
5. First CI run executes `agent-drive whoami` → fails: "AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle." Marcus rereads `docs/sandboxes.md` common failures: "Do not paste the `AGENT_DRIVE_CREDENTIALS=` prefix into the value." He edits the secret to start with `adcred1.`.
6. Rerun: `agent-drive whoami` lists drive and `localDriveKeys`; `agent-drive check` → `check ok`. The bundle's drives count as backed up (method `env`).
7. Marcus opens `/console`, tab Agents. New row "ci-nightly" with badge "1 active key" and small text "issued by marcus-dev agent". Tab API keys shows label `ci-nightly (issued by <machine>)`, scopes, "Write paths:" `/ci/nightly`, note "Write paths do not restrict reads. Reading still requires read permission on an allowed drive."
8. Later he sets `AGENT_DRIVE_MACHINE=gha-nightly` so uploads show a stable machine name.

### Variations

- Name collision: running step 3 again with the same `--name` returns 409. Doc: "A name that already exists returns 409; pick another." No CLI-side hint seen.
- `--to ./ci.env` file: mode 600; if it exists, "`./ci.env` already exists; pass --force to overwrite it."
- `--stdout` and `--to` both or neither: "Pass exactly one of --to <path> or --stdout."
- Sandbox with no global install: prefix with `npx -y @dennisonbertram/agent-drive@latest`.
- Custom scopes: `--scope read` only, then `check` prints `check not verified` on an empty drive.

### Edge Cases

- Sandbox lacks network egress: docs say "Stop and tell the human. Do not try to work around it."
- Sandbox API URL differs from the bundle's recorded origin: `no usable drive key`; fix `AGENT_DRIVE_API_URL`.
- The issued bundle is never written to disk in the sandbox, so a second job step reading the config file finds nothing, but env still works.
- The issuing agent's key may be limited to write paths; the new agent's write paths must sit inside them or the request fails (`docs/connect-an-agent.md`).
- Same fact on several surfaces: "revoke from the console under Agents" appears in the CLI stderr line and `docs/sandboxes.md`, but the console shows this agent only as a generic identity row.
- Contradiction: the CLI help says "Mint a new agent's key (needs the delegate scope) and print its AGENT_DRIVE_CREDENTIALS line" and `docs/sandboxes.md` says the value is "the part after `=`"; the printed line has the prefix, so the natural copy is wrong. No in-product hint beside the line.

---

## SETUP-045: Revoke a leaked sandbox key

**Type**: short
**Topic**: Second agent and sandbox continuity
**Persona**: Marcus Webb (from SETUP-044), after a CI log accidentally printed the bundle.
**Goal**: Cut off `ci-nightly` quickly without affecting his laptop agent.
**Preconditions**: Console has agent `ci-nightly` with 1 active key.
**Surface**: web (browser)
**Ideal path**: 3 — Agents tab, `Revoke access`, confirm.
**Alternate paths**: API keys tab, `Revoke` on the single key; `agent-drive key revoke <key id>` from a CLI that holds `manage`.

### Steps

1. `/console`, tab Agents → row "ci-nightly", badge "1 active key", button `Revoke access` (aria-label "Revoke access for ci-nightly").
2. Click it → confirm dialog titled "Revoke access for ci-nightly?" with message "1 active API key stops working now. Commands and MCP sessions that use it fail at their next request. Files this agent wrote stay in your drives." and button `Revoke 1 key`.
3. Click `Revoke 1 key` → toast "Revoked access for ci-nightly." Badge becomes "Access revoked" and the button disappears.

### Variations

- Via API keys tab: `Revoke ci-nightly (issued by …)` → title "Revoke <label>?", message "Commands using this key stop working at their next request. This cannot be undone.", confirm `Revoke key`, toast "Revoked <label>.", badge "Revoked".
- CLI: `agent-drive key revoke <key id>`; the key id was printed by `credentials issue` ("with key <id>").

### Edge Cases

- Revoking does not remove the drive key from the sandbox config. The leaked bundle also contains the drive key, which cannot be rotated here. Nothing in the dialog says the drive key is still known to whoever has the bundle. (Observation from code and docs, not verified at runtime.)
- The "Access revoked" agent row stays; there is no delete control in the row.
- Same fact on several surfaces: revoke is described in `docs/connect-an-agent.md`, `docs/sandboxes.md`, the connect page note "You can revoke access any time in Console, Agents.", and the CLI stderr line.
- Copy difference: "This cannot be undone." on the per-key dialog but not the agent dialog, though both are permanent.
- What the revoked sandbox sees at its next call is not shown in docs (unverified).

---

## SETUP-046: Add a second agent using the recovery file on /connect

**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Tomoko Ishida, a researcher with a Cursor agent on her work laptop and an older Claude Code agent she set up months ago on a retired laptop. The old agent no longer has `delegate`, and the old machine is gone, but she downloaded `agent-drive-<drive id>.key.json` when she created the drive.
**Goal**: Give a new Claude Code agent access to the existing drive `thesis`, read only.
**Preconditions**: Account has drive `thesis`. Recovery file is in Downloads. New agent has the CLI.
**Surface**: mixed (CLI, web)
**Ideal path**: 6 — login, open link, Details, choose existing drive, supply file, Approve.
**Alternate paths**: `grant` (no agent with `delegate` is available), `credentials issue` (same reason), manual key (no drive key).

### Steps

1. New agent runs `agent-drive login --name "thesis-claude"` → link, code, verification code printed.
2. Tomoko opens the link. Page tag "Pairing request", h1 "Connect thesis-claude?", summary "New encrypted drive · full access".
3. She hesitates: she wants the existing drive, not a new one. She clicks `Details`. She finds "Use one of my drives instead (needs its recovery file)".
4. Page now shows `Drive` select, `Drive key` ("Paste the drive key or an adcred1… bundle"), `Or choose a file`, checkbox `Read only`, `Only allow writes under (optional)`, link `Use a new drive instead`.
5. She selects `thesis`, clicks `Or choose a file` and picks the file, ticks `Read only`.
6. She types `Verification code` from the terminal, clicks `Approve agent`.
7. Done page "Access approved for thesis-claude". Terminal prints `Logged in as agent thesis-claude.` and `Usable drives: <thesis id>`. `agent-drive check` prints `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.` only if the drive is empty; here the drive has files, so `check ok ... (read-only)`.

### Variations

- She pastes a drive key instead of choosing a file: allowed. If the drive has no files or trace inbox, the key cannot be checked: page note "This drive has nothing to check the key against, so it could not be checked before sending."
- Wrong key: "This key does not open the selected drive. Check the drive and paste its own key."
- Garbage file: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle."
- Bad folder in writes field: "Enter a folder that starts with / and does not end with /, for example /inbox/agent."

### Edge Cases

- Hesitation point: summary line says "New encrypted drive · full access", and nothing on the first screen says existing drives are possible. The option is inside collapsed `Details`, and its label "(needs its recovery file)" omits that a pasted key or `adcred1.` bundle also works (`connect.tsx:685`).
- The option appears only on a new request and when the account already has a drive. On a reconnect it is absent.
- If Tomoko lost both the file and any agent holding the key, this path is closed. The recovery message on the unlock dialog suggests `agent-drive account seal --drive <id>` from an agent that holds the key, a different fix.
- Same fact on several surfaces: the three handoff choices appear in `docs/connect-an-agent.md` (table), `/llms.txt`, and the console "Connect an agent" panel intro ("or you add it to a drive your other agents already use"), but the console panel does not say how.

---

## SETUP-047: Manual Agents and API keys path from the console

**Type**: long
**Topic**: Second agent and sandbox continuity
**Persona**: Dev Patel, cautious backend developer who dislikes pasting a one-line prompt into an agent. He wants to create an identity and key himself and then connect a script on his server.
**Goal**: Create an agent named "invoice-bot", issue an API key limited to `read` and `write` on drive `finance-archive`, and connect a script.
**Preconditions**: Signed in, one drive `finance-archive` exists (created via `New drive`, recovery file saved). No agents yet.
**Surface**: mixed (web, CLI)
**Ideal path**: 9 — this path has more steps than the agent-first path and still ends without a usable drive key on the server.
**Alternate paths**: llms.txt prompt path (login device flow); `credentials issue` from an agent with `delegate`; recovery file on `/connect`.

### Steps

1. `/console`, tab API keys. Header button `+ New API key`. Panel empty state: "Create an agent first." / "API keys belong to an agent and authorize specific drives." with button `Create agent`. (Dev had expected a key to be creatable directly.)
2. Click `Create agent` → dialog "An agent identity groups its keys, file versions, and activity." Field `Agent name` placeholder "Research assistant". He types `invoice-bot`, clicks `Create agent`. Reserved name `__console__` gives "That name is reserved for the human console."
3. Dialog closes, tab switches to API keys with notice "Agent created. Create an API key to connect it." Empty state now says "Your agent’s connection starts here." / "Issue a scoped key. You’ll see the secret only once." with `Create API key`.
4. Click `Create API key` → form: "Use a different key for each agent or machine. New keys do not grant access to future drives automatically." Fields `Key label` (placeholder "Research laptop"), `Agent`, fieldset `Allowed drives`, fieldset `Permissions` with `read`, `write`, `delete`, `share`, `manage` (read and write ticked). Dev enters label `invoice-bot prod`, ticks `finance-archive`, leaves read and write. There is no `delegate` and no write-path field here; a note appears only when restricted keys already exist ("This form cannot set write-path restrictions...").
5. Click `Create API key` → receipt: "This secret is shown only once. Store it securely and use it with `agent-drive login`. The service keeps only a hash." Textarea, `Copy API key`, checkbox `I saved my API key securely`, button `Done` (disabled until ticked).
6. On the server, Dev follows the panel "Connect without sharing your identity." but its text says "Run the CLI from the repository after building it." He already installed from npm and is confused; he continues with the shown block: `read -rs -p "API key: " AGENT_DRIVE_API_KEY; export AGENT_DRIVE_API_KEY`, `agent-drive login --api https://agentdrive.xyz`, `read -rs -p "Drive key: " AGENT_DRIVE_KEY; export AGENT_DRIVE_KEY`, `agent-drive put ./handoff.md /memory/handoff.md --drive <id>`, `agent-drive mcp`.
7. He must supply the drive key. He opens `finance-archive`'s recovery file and pastes the key at the second prompt. Without it, `agent-drive put` fails with "no usable drive key".
8. `agent-drive check` → `drive key not backed up: <id>` plus a hint, because the key came from `AGENT_DRIVE_KEY` (docs: keys supplied through `AGENT_DRIVE_KEY*` "do not need a backup record for `check`", so this may pass; behavior not verified).
9. Tab Agents shows `invoice-bot` with "1 active key"; tab API keys row shows `invoice-bot prod`, `read, write`, badge `Active`.

### Variations

- Dev closes the receipt dialog before copying: no way to view the key again; he must revoke and create another ("To rotate access, create a replacement API key, update the agent, then revoke the old key.").
- Uses `printf '%s' "<key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin` (from `docs/connect-an-agent.md`): saves API key only and "does not give the machine any drive key".
- Chooses `manage` by mistake: label text "manage — account-wide administration; use sparingly".
- Opens Agents tab first: `Create your first agent`, with copy "Create an identity for your first agent, then issue a scoped API key."

### Edge Cases

- Console panel contradicts docs: the Agents/API keys tab panel text "Run the CLI from the repository after building it." (`console.tsx` connection-guide) while every other surface says `npm install -g @dennisonbertram/agent-drive`.
- `--api` form differs: console block uses `--api <origin>` (no `/api`), docs use `--api https://agentdrive.xyz/api`. The CLI client rewrites the path to `/api/v1/` (`client.ts:387`), so both likely work; not run.
- Manual path never gives the server a sealed drive key, so the account-key seal (`account seal`) does not apply until an agent holds the key.
- Receipt text says "use it with `agent-drive login`", but plain `login` starts the device flow unless `AGENT_DRIVE_API_KEY` is set; the explicit `--token-stdin` form is not mentioned in the dialog.
- Same fact on several surfaces: "Keys stay with you." (sidebar) versus the receipt's "The service keeps only a hash."; both refer to different keys (drive vs API).

---

## SETUP-048: Codex agent cannot write because MCP approval is "never"

**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Aisha Bello, runs `codex exec` in scripts. She added Agent Drive MCP by copying the Codex snippet from the console panel.
**Goal**: Let the scripted Codex agent save a file with MCP `put`.
**Preconditions**: CLI logged in on her machine, `agent-drive check` prints `check ok`. MCP server configured from the console snippet.
**Surface**: mixed (web console, CLI, Codex)
**Ideal path**: 4 — copy snippet from llms.txt or `docs/mcp-tools.md` with approval blocks, restart Codex, run.
**Alternate paths**: CLI `agent-drive put` bypasses MCP; `default_tools_approval_mode = "approve"`.

### Steps

1. In `/console`, tab Agents, expand "Connect an agent". Section for `Codex (~/.codex/config.toml)` shows `[mcp_servers.agent-drive]\ncommand = "agent-drive"\nargs = ["mcp"]`. She copies it into `~/.codex/config.toml`.
2. She runs `codex exec "save notes.md to Agent Drive"`. MCP `whoami` and `list` work (read-only).
3. `put` fails with "MCP tool call requires approval, but approval policy is never".
4. She reads `docs/mcp-tools.md` "Codex approval" and adds `[mcp_servers.agent-drive.tools.put]` and `[mcp_servers.agent-drive.tools.download]` with `approval_mode = "approve"`. She restarts Codex ("Restart the client after you change the saved credentials.").
5. Rerun succeeds.

### Variations

- Aisha uses `default_tools_approval_mode = "approve"`: approves `delete`, `move`, `restore` and `share` too. Docs warn about it.
- She also needs `move`, `copy`, `delete`, `restore` or `share`: each fails with the same message until added; docs name 7 refused tools but the sample block shows only `put` and `download`.
- Claude Code via `claude mcp add agent-drive -- agent-drive mcp` needs no approval edit.

### Edge Cases

- Contradiction: console snippet lacks approval blocks; `docs/mcp-tools.md` and `llms.txt` (`apps/web/app/llms.txt/route.ts:126-140`) include them.
- Several drive keys on the machine: MCP tools return an error listing drive IDs and she must pass `driveId`.
- MCP cannot do login, check, credentials or grant. If `AGENT_DRIVE_CREDENTIALS` is set in the Codex sandbox, MCP reads it at start; a bundle change needs a restart.
- Same fact: "13 tools" in the docs versus tool list of 7 refused and 6 allowed (counts differ by page; not exact in the prompt copy).

---

## SETUP-049: Sandbox with a read-only credentials bundle and an empty drive

**Type**: short
**Topic**: Second agent and sandbox continuity
**Persona**: Leila Haddad, security reviewer. Her agent "auditor" runs in a sandbox with a read-only bundle and must report setup done only when `check ok` appears.
**Goal**: Confirm the read-only sandbox works.
**Preconditions**: Bundle issued by `credentials issue --name auditor --scope read --stdout | <store>` and set as `AGENT_DRIVE_CREDENTIALS`. Drive is empty.
**Surface**: CLI
**Ideal path**: 3 — `whoami`, `check`, wait for another agent to write, `check` again.
**Alternate paths**: ask a writer agent to `put` a file first, then run `check`.

### Steps

1. `agent-drive whoami` → shows agent `auditor`, scopes `read`.
2. `agent-drive check` → `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.` Exit code 1.
3. Another agent runs `agent-drive put ./hello.md /memory/hello.md --drive <id>`. Leila reruns `agent-drive check` → `check ok ... (read-only)`.

### Variations

- A sandbox run that treats exit 1 as "broken" and retries login: docs say "Do not report setup as complete until it prints `check ok`."

### Edge Cases

- A read-only agent cannot be told apart from broken by the exit code and wording ("not verified" reads like failure).
- Same fact on `docs/sandboxes.md` (common failures) and the CLI help string for `check`; the web console does not mention it.

---

## SETUP-050: Agent loses delegate and the owner re-approves

**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Jonas Keller, indie developer. His agent was approved last month with default options (no `delegate`). Today he asks it to set up a second sandbox agent.
**Goal**: Get `delegate` onto the existing agent, then issue credentials for the sandbox.
**Preconditions**: Agent `jonas-dev agent` logged in without `delegate`. Sandbox has no browser.
**Surface**: mixed (CLI, web)
**Ideal path**: 5 — try issue, read error, re-run login with same name, tick the checkbox on `/connect`, issue again.
**Alternate paths**: recovery file on `/connect` for the sandbox (sandbox has no browser, but Jonas does, so the new agent's `login --no-browser` can still print a link); manual API key (no drive key).

### Steps

1. Agent runs `agent-drive credentials issue --name "sandbox-1" --stdout | <store>` → API rejects with "The API key needs the delegate scope." (surfacing format not verified).
2. Per docs the agent runs `agent-drive login --name "jonas-dev agent"` again (reconnect, same name and API origin). CLI sends saved key as proof.
3. Jonas opens `/connect?code=…`. Summary shows reconnect. In `Details`, he ticks "Let this agent add other agents to its drives" (small print about handing out the drive).
4. He types the verification code and clicks `Approve agent`.
5. CLI prints `Logged in as agent jonas-dev agent.` and, since this is a reconnect: `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.`
6. Agent re-exports credentials then reruns `credentials issue`.

### Variations

- Jonas ticks the checkbox on `/connect` but also leaves defaults; delegate is never inherited on reconnect, he must tick again each time (`device.ts:664-683`).
- Jonas forgets to re-export after the reconnect; next sandbox fails with `drive key not backed up`.

### Edge Cases

- Old bundles issued by this agent still work? Unknown from code; not stated in docs.
- The checkbox is visible only inside collapsed `Details`; the summary line does not mention it.
- Same fact across surfaces: "Let this agent add other agents to its drives" (connect page) versus "Let this agent add other agents" (`docs/sandboxes.md`, llms.txt line 113). Wording differs between surfaces.
- Consequence of reconnect: it issues a new API key, so every earlier bundle is out of date; docs state this for backups, but do not say whether the old key stops working.

---

## Notes

- Counts: short 2 (03, 07), medium 4 (01, 04, 06, 08), long 2 (02, 05).

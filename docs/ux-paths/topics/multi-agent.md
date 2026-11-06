# Topic: Multi-agent handoffs

Source: code at main 2870d7a. `apps/web/app/(app)/connect/connect.tsx`, `apps/web/src/api/device.ts`, `validation.ts`, `packages/agent-drive/src/cli.ts`, `device.ts`, `credentials.ts`.

## STORY-056: Owner adds a second agent to the existing drive in the browser
**Type**: long
**Topic**: Multi-agent handoffs
**Persona**: Mara Ellis, who already has "report-bot" and now installs "trace-bot" on a second laptop.
**Goal**: Give trace-bot access to the drive report-bot uses, without creating a new drive.
**Preconditions**: Mara is signed in; her account has one drive "Reports"; she has its recovery file `agent-drive-<id>.key.json`.
**Ideal path**: 4 — run login, open link, pick existing drive plus key file, approve.
**Alternate paths**: `grant` from an existing delegate agent (next stories); `credentials issue` for sandboxes.
### Steps
1. On the new laptop trace-bot runs `agent-drive login --name "trace-bot"` → prints a link and code such as BCDF-GHJK, waits.
2. Mara opens the link (/connect?code=BCDF-GHJK); signs in if needed, and the code is preserved → card "Connect trace-bot?" with Agent, Machine, Account, Requested, pairing code, and a banner "This agent gets its own encrypted drive..."
3. She does not want a new drive and notices the link "Add to an existing drive instead" below the banner; clicks it → fields Drive (select), "Drive key or credentials bundle (adcred1.…)", file input "Or choose a recovery file or credentials bundle", "Read only" checkbox, "Only allow writes under (optional)", link "Use a new drive instead".
4. She selects "Reports", chooses the recovery file → on approve the file is checked against the selected drive.
5. She hesitates at "Let this agent add other agents to its drives" (small print: cannot pass this on), leaves it unticked, clicks "Approve agent" → "Approved. Return to your agent; it will finish setup on its own."
6. trace-bot finishes login on its own; `agent-drive check` still refuses until the key backup is confirmed; after `credentials export`/`confirm` it prints `check ok`.
7. Mara opens Console, Agents → trace-bot listed with active key.
### Variations
- She pastes the raw key into the password field instead; the page cannot check it ("a wrong key gives the agent a drive it cannot read").
- She picks a file for another drive: "This recovery file does not belong to the selected drive".
- She leaves the key field empty: "Paste the drive key or choose a recovery file".
- The link "Add to an existing drive instead" never appears if the account has no drives, or the request is a reconnect with previous scopes.
### Edge Cases
- Browser route grants scopes read, write, delete, share (read only if ticked); never manage.
- Backing up the key again is needed on the new machine (the agent holds a copy now).
- Code typed by hand: "Enter the code in the form XXXX-XXXX."; wrong or expired: "This code is wrong, expired, or already used."

## STORY-057: Existing agent offers a drive with grant; owner only approves
**Type**: long
**Topic**: Multi-agent handoffs
**Persona**: Agent "report-bot" (has `delegate`) on behalf of Mara Ellis, adding "trace-bot" limited to /traces.
**Goal**: Hand over the drive with minimal human work.
**Preconditions**: report-bot was approved with the delegate checkbox ticked, holds the drive key and a single drive.
**Ideal path**: 3 — new agent logs in, existing agent grants, human clicks Approve.
**Alternate paths**: Browser key paste (previous story); `credentials issue`.
### Steps
1. trace-bot runs `agent-drive login --name trace-bot` → code BCDF-GHJK and link.
2. Mara tells report-bot the code. It runs `agent-drive grant BCDF-GHJK --write-path /traces` → prints "Request from trace-bot on <machine>, made <time>." then "Offered drive <id> to trace-bot (read write; writes under /traces). The owner approves at <origin>/connect?code=BCDF-GHJK."
3. Mara opens that link → banner "Offered by report-bot: drive Reports, read, write, writes under /traces. That agent sealed the drive key for this login; Agent Drive never sees it." No drive picker or key field.
4. Delegate checkbox unticked, she clicks "Approve agent" → "Approved."
5. trace-bot completes login; writes under /traces work; `put` under /reports is refused.
### Variations
- `--read-only` offers only `read`. With no `--drive` and several drive keys: "Pass --drive <id>; this machine holds no single default drive key."
- report-bot runs `grant` again with new scopes before Mara approves: the page reloads on approve with "The request changed; review it again." and she must re-read it.
- Mara had the /connect page open before the grant arrived; the offer appears only after that notice.
### Edge Cases
- Offer from an agent without delegate: "The API key needs the delegate scope."
- grant defaults: scopes read+write unless `--scope`; write paths default to the granting key's own.
- The code can be mistyped lower case; the CLI uppercases it.

## STORY-058: Sandbox agent gets credentials with credentials issue
**Type**: long
**Topic**: Multi-agent handoffs
**Persona**: Agent "ci-orchestrator" for Tomás Rivera, creating a key for a GitHub Actions job with no browser.
**Goal**: Give the CI job read and write under /ci/artifacts.
**Preconditions**: ci-orchestrator has `delegate`, holds the drive key locally.
**Ideal path**: 3 — issue to stdout into a secret store, human sets one secret, job runs.
**Alternate paths**: Browser add-to-drive; grant (needs a browser for approval).
### Steps
1. Agent runs `agent-drive credentials issue --name ci-job --write-path /ci/artifacts --stdout | gh secret set AGENT_DRIVE_CREDENTIALS` → nothing printed on the terminal; stderr "Created agent "ci-job" with key <id>: scopes read write, writes only under /ci/artifacts. Store this line as a secret in the sandbox. Revoke it from the console under Agents."
2. Tomás verifies the secret exists in GitHub; no further /connect step.
3. In the job the CLI reads `AGENT_DRIVE_CREDENTIALS`; it runs `agent-drive check` and prints `check ok`; credentials count as backed up.
4. Tomás opens Console, Agents (and API keys) → "ci-job" with "issued by ci-orchestrator".
### Variations
- Running with `--stdout` to a terminal: "Refusing to print credentials to a terminal. Pipe them to a secret store..."
- `--to ./creds.env`: refused if it exists without `--force`.
- Missing `--name`: "--name is required."; both or neither of `--to`/`--stdout`: "Pass exactly one of --to <path> or --stdout."
### Edge Cases
- If a delegate has write paths, `--write-path` is mandatory and must sit inside them: "A key cannot grant more than it holds."
- `issue` cannot grant `manage` or `delegate`.
- No human approval happens for `issue` (gap vs. grant): the owner sees it only after the fact, as "issued by".
- The line contains the drive key; pasting it into chat or logs leaks it.

## STORY-059: Limited agent tries to write outside its folder
**Type**: short
**Topic**: Multi-agent handoffs
**Persona**: trace-bot, limited to /traces, asked by a user to save /reports/q3.md.
**Goal**: Understand why a write was refused and recover.
**Preconditions**: key with `--write-path /traces`.
**Ideal path**: 2 — error names the allowed folder, agent retries under it.
**Alternate paths**: owner issues a wider key.
### Steps
1. Agent runs `agent-drive put ./q3.md /reports/q3.md` → exit 1, "The API key may only write under /traces."
2. Agent retries `agent-drive put ./q3.md /traces/q3.md` → success.
3. Agent runs `agent-drive ls --prefix /reports` → works; reads are not limited.
### Variations
- `mv /traces/a /reports/a` refused (destination checked).
- `check` for such a key writes to its allowed folder, not the root.
### Edge Cases
- The allowed folder matches itself and anything beneath it only (/traces2 is not allowed).
- Write paths can only be changed by issuing a new key (no edit in the console: scopes and paths are fixed at creation).

## STORY-060: Read-only agent runs check and tries to write
**Type**: medium
**Topic**: Multi-agent handoffs
**Persona**: Agent "auditor" added with "Read only" ticked by Luis Ferreira.
**Goal**: Confirm it can read the drive.
**Preconditions**: Approved with Read only; drive contains at least one file.
**Ideal path**: 2 — check, then read a file.
**Alternate paths**: none found.
### Steps
1. `agent-drive check` → `check ok ... (read-only)` because it decrypted an existing file.
2. `agent-drive put ./x.txt /x.txt` → permission denied on the write scope with the reconnect hint.
3. `agent-drive get /reports/q3.md` → text printed.
### Variations
- Empty drive: `check not verified`, since there is nothing to decrypt; the agent may wrongly conclude the key is broken.
- Auditor asks the owner for write; Luis must re-run the flow: ask the agent to run `login` again and approve with Read only unticked.
### Edge Cases
- Read-only agents cannot `share` (needs share scope) or `rm`.
- On reconnect the previous permissions are kept ("Keeps its previous permissions (read)"), so the owner cannot widen access on the same agent through the page (gap).

## STORY-061: Delegate cannot pass on delegate or exceed its own rights
**Type**: medium
**Topic**: Multi-agent handoffs
**Persona**: Agent "lead-agent" holding read, write, delegate on /project, trying to over-grant.
**Goal**: Hand a helper broad rights; learn the limits.
**Preconditions**: lead-agent approved with the delegate checkbox; write path /project.
**Ideal path**: 2 — attempt and be refused with one clear sentence.
**Alternate paths**: none found.
### Steps
1. `agent-drive credentials issue --name helper --scope delete --stdout | store` → refused: "A key cannot grant more than it holds." (lead has no delete scope).
2. `agent-drive credentials issue --name helper --scope delegate --stdout | store` → refused (delegate is never grantable).
3. `agent-drive credentials issue --name helper --stdout | store` without `--write-path` → refused because the caller is path-limited and the new key must name paths inside /project.
4. `agent-drive credentials issue --name helper --write-path /project/helper --stdout | store` → works.
### Variations
- The owner ticks the checkbox on /connect only; the agent can't acquire delegate by itself.
- A grant offer never carries delegate; Mara must tick "Let this agent add other agents to its drives" for the new login herself.
### Edge Cases
- Using a name that already exists: "An agent named "helper" already exists; choose another name."
- Reserved name `__console__` is refused.

## STORY-062: Owner revokes a handed-off agent
**Type**: medium
**Topic**: Multi-agent handoffs
**Persona**: Tomás Rivera, after the CI job leaked its secret in a log.
**Goal**: Cut off ci-job immediately.
**Preconditions**: ci-job issued by ci-orchestrator is active.
**Ideal path**: 3 — open Agents, revoke, confirm.
**Alternate paths**: API keys tab, Revoke on the single key.
### Steps
1. Open /console, "Agents" tab → "Agent identities": ci-job, "1 active keys", "issued by ci-orchestrator".
2. Click "Revoke access" → confirm text "Revoke all API keys for ci-job? This stops this agent’s current access."
3. Confirm → notice "All API keys for ci-job have been revoked."
4. In the job, `agent-drive check` now fails with an authentication error.
5. Tomás opens API keys tab → the key shows "Revoked".
### Variations
- He revokes from API keys with "Revoke <label>? Commands using this key will stop working." → notice "API key revoked. It can no longer authenticate."
- Realises the leaked line contained the drive key: revoking the API key does not remove the key from the leaked copy; ciphertext is still readable by someone who also gets the storage objects (gap: no rotate drive key action visible in the console).
### Edge Cases
- Revoking ci-job does not revoke keys of agents it issued (check Agents list).
- Revocation information appears on three surfaces: Agents tab, API keys tab, and the audit log in Activity & deletion.

# Topic: First-run agent setup from one pasted line

Source: `apps/web/app/llms.txt/route.ts`, `apps/web/app/(app)/connect/connect.tsx` and `page.tsx`, `packages/agent-drive/src/device.ts`, `cli.ts` (`login`, `credentials`, `check`, `skill install`), `check.ts`, `credentials.ts`. Device codes expire in 600 s, the CLI polls every 5 s (adds 5 s on `slow_down`). Code format is XXXX-XXXX using consonants only.

## STORY-009: Happy path from the landing page to check ok

**Type**: long
**Topic**: First-run agent setup from one pasted line
**Persona**: Priya Nair, running Claude Code in a macOS terminal, already has an account and no drives.
**Goal**: Give Claude Code a drive that survives the session.
**Preconditions**: Signed in to Agent Drive in the browser; Node 20+ in the terminal; no previous login.
**Ideal path**: 4 — paste the line, click the printed link, click Approve, tell the agent to finish (the agent does the rest: install, backup, skill, check).
**Alternate paths**: copy the same line from the console Agents tab "Connect an agent" panel; copy `npm install -g agent-drive` from the landing page and run `agent-drive login` yourself; console-first route via "Create your first drive" and "Create API key" then `login --token-stdin`.

### Steps

1. On `/`, click Copy in the "Give this to your agent" panel → clipboard holds `Set up Agent Drive: https://agentdrive.xyz/llms.txt`.
2. Paste it into Claude Code → agent fetches `/llms.txt`, reads the setup steps.
3. Agent runs `npm install -g agent-drive` → CLI installed (llms.txt offers `npx -y agent-drive@latest` if global installs are blocked).
4. Agent runs `agent-drive login --name "claude-code"` → prints `Open this link to approve: https://agentdrive.xyz/connect?code=BKQD-MWRT`, `Check that the code matches: BKQD-MWRT`, `Waiting for approval...`; if stdout is a terminal and CI is unset it also opens the browser.
5. Agent tells Priya to open the link, check the code and click Approve (llms.txt wording: "There is nothing else for the human to choose") → she sees the page in the next step.
6. `/connect` shows the Pairing code, "Connect claude-code?", Agent, Machine, Account (her email), Requested time, and the banner "This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it." plus the checkbox "Let this agent add other agents to its drives" left unticked.
7. Priya matches the code and clicks "Approve agent" → "Approved" tag "Paired": "Approved. Return to your agent; it will finish setup on its own."
8. The login command's next poll succeeds → prints `Logged in as agent claude-code.`, `Usable drives: ...`, `Scopes: ...`, `Config: ~/.config/...`, `New drive ... created; its key is saved in the config file.` and the BACKUP_HINT.
9. Agent runs `agent-drive credentials export --to ~/Backups/agent-drive.cred` (a path outside the sandbox) → `Backed up credentials for 1 drive(s) (file).` and the server is told the key is backed up.
10. Agent runs `agent-drive skill install` → `wrote ~/.claude/skills/agent-drive/SKILL.md` (and codex path if present).
11. Agent runs `agent-drive check` → `check ok drive=<id>`; agent reports done.

### Variations

- Backup via secret store: `agent-drive credentials export --stdout | gh secret set AGENT_DRIVE_CREDENTIALS && agent-drive credentials confirm` prints `Recorded the credential backup for 1 drive(s) (stdout).`
- `--no-browser` or a non-terminal run: no automatic browser; only the printed link.
- User never types a command; every step above except 5 and 7 is the agent's work.

### Edge Cases

- The same facts appear in four places: the landing hero line, the console Agents panel, `/llms.txt`, and the `/connect` page (code, agent, machine).
- Priya must watch two windows (terminal and browser) and trust that the agent relays the link correctly; if the agent paraphrases the link, she types the code into `/connect` herself.

## STORY-010: Human is signed out when the agent's link arrives

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: Jonas Weber, new to Agent Drive, has only pasted the line into Codex.
**Goal**: Approve the agent without creating confusion.
**Preconditions**: No Agent Drive account; agent has printed `https://agentdrive.xyz/connect?code=HGLR-QSTV`.
**Ideal path**: 3 — sign up, return to the approval page automatically, click Approve.
**Alternate paths**: sign in with existing account; open `/connect` directly and type the code.

### Steps

1. Click the link → redirected to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DHGLR-QSTV` with the Clerk sign-in card.
2. Jonas has no account: he looks for "Sign up" → Clerk's link under the form; he follows it.
3. After sign-up he reaches `/console` or `/connect` depending on whether Clerk kept `redirect_url` (not verifiable from this repo; the sign-up page itself only sets the `/console` fallback).
4. If he lands on `/console` → "Give your first agent a home." with no mention of the pending code (gap). He returns to the terminal link and clicks it again.
5. `/connect` now loads (code preserved in the URL) → he approves.

### Variations

- The 10-minute code lifetime runs out during sign-up: banner "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new one." The CLI itself says "The login code expired. Run `agent-drive login` again."
- Jonas opens `/connect` without a code → card "Connect an agent": "Enter the code your agent printed after running `agent-drive login`." with the field "Code from your agent" (placeholder XXXX-XXXX) and button "Continue".

### Edge Cases

- Typing the code in lowercase or without the hyphen (`bkqdmwrt`) works because `normalizeCode` uppercases and inserts the hyphen; a code with a vowel is rejected with "Enter the code in the form XXXX-XXXX."
- llms.txt tells the agent to say "you must be signed in", which tells Jonas to sign in but not that signing up is needed.

## STORY-011: Approving a machine that is not the one he started

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: Mei Lin, who pasted the line into two agents (a laptop agent and a cloud VM) within a minute.
**Goal**: Approve only the laptop agent.
**Preconditions**: Two pending requests with different codes and machines (`mei-laptop`, `build-vm-2`).
**Ideal path**: 3 — open the right link, verify the code and machine, approve.
**Alternate paths**: type the code in `/connect`'s code form; let the other request expire (unapproved requests expire on their own).

### Steps

1. Mei opens the link from the VM's terminal by mistake → `/connect` shows "Connect claude-code?" with Machine `build-vm-2` and a pairing code.
2. She notices the machine name, hesitates, and compares to her laptop terminal → code does not match.
3. The page tells her to close it if codes differ: "Check that this matches your agent's terminal. If it does not, close this page; unapproved requests expire on their own." She closes the tab (no Deny button exists, gap).
4. She opens the laptop's link → code and Machine `mei-laptop` match → "Approve agent" → "Approved".

### Variations

- Both agents use the default agent name (`defaultAgentName()`), so "Connect <agent>?" looks identical; only Machine and the code distinguish them.
- Mei approves both by mistake: two agents, each with its own drive, and the console lists both under Agents.

### Edge Cases

- If the CLI receives `access_denied` it says "Approval was denied. No access was granted." but the `/connect` page has no control that produces it (not verified in the page code), so this message is not reachable by the human here.
- Machine is optional in the page (`request.machine &&`); an agent without a machine name shows no Machine row, weakening verification.

## STORY-012: Delegate checkbox on the first approval

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: Carlos Reyes, plans to run one lead agent that will onboard two helper agents later.
**Goal**: Allow the lead agent to add others.
**Preconditions**: Signed in; pending request from agent `lead-bot`.
**Ideal path**: 3 — tick the checkbox, approve, agent finishes.
**Alternate paths**: approve without the box and later re-approve (`agent-drive login` again, tick the box); `credentials issue` only works with delegate.

### Steps

1. On `/connect`, read "Let this agent add other agents to its drives" with the small text "It can hand another agent the key and permissions it holds itself, never more, and it cannot pass this permission on. You still approve each new agent here."
2. Carlos wonders if ticking gives the agent full account power; the text says "never more" and "cannot pass this permission on" → he ticks it.
3. Click "Approve agent" → body includes `delegate: true`; page shows "Approved".
4. Agent finishes login; `Scopes:` lists the granted scopes including delegate.
5. Later, a helper agent runs `agent-drive login`; lead-bot runs `agent-drive grant <code> --write-path /inbox/helper` and Carlos clicks Approve on a page showing "Offered by lead-bot" (see sync-multi-agent topic).

### Variations

- Carlos forgets the box. Later `agent-drive grant` fails with a permission message and llms.txt tells the agent to ask the human to approve again with "Let this agent add other agents" ticked.
- In "Add to an existing drive" mode the same checkbox adds `delegate` to the scopes next to read/write/delete/share.

### Edge Cases

- The checkbox sits below the Approve-relevant banner and above the button, but nothing on the first screen tells a new user that it is optional and that skipping it is the safe default.
- llms.txt step 2 says "There is nothing else for the human to choose," which is untrue when the checkbox or "Add to an existing drive instead" is relevant.

## STORY-013: Agent waits, the code expires, agent retries

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: Ravi Patel, got a phone call after pasting the line and came back 15 minutes later.
**Goal**: Finish setup after the delay.
**Preconditions**: Agent ran `login`; no approval for over 10 minutes.
**Ideal path**: 3 — rerun login, open the new link, approve.
**Alternate paths**: none found.

### Steps

1. Terminal shows `Waiting for approval...` then, after the 600 s lifetime, `The login code expired. Run \`agent-drive login\` again.`
2. Ravi opens the old browser tab and presses Approve → the approval fails and the page shows the banner/error from the server (request not found or expired); on reload with the old code: "This code is wrong, expired, or already used. Run agent-drive login in your agent to get a new one."
3. He asks the agent to run `agent-drive login` again → new link and new code.
4. Opens the new link, matches the code, clicks "Approve agent" → "Approved".
5. Agent finishes (`Logged in as agent ...`) and continues the setup.

### Variations

- Network drops while polling: after 5 consecutive failures the CLI prints "Lost contact with Agent Drive at <base>. Run `agent-drive login` again."
- Server too busy: `slow_down` adds 5 s to the polling interval silently.
- Ravi reuses a code that was already approved: same "wrong, expired, or already used" message.

### Edge Cases

- The same message covers three situations (wrong, expired, already used), so Ravi cannot tell which happened.
- The `/connect` page lists "Requested <date/time>" but not when it expires, so he cannot see how much time is left.

## STORY-014: Agent in a sandbox forgets to back up credentials

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: A coding agent in a disposable cloud container, supervised by Anya Kowalski.
**Goal**: Finish setup so files survive the container.
**Preconditions**: Login approved; credentials not yet exported.
**Ideal path**: 2 — export credentials once to a surviving place, run check.
**Alternate paths**: `AGENT_DRIVE_CREDENTIALS` secret holds a bundle merged in memory, which counts as backed up; console "Download recovery file" (records method `file`).

### Steps

1. After login, the agent skips step 4 and runs `agent-drive skill install` → `wrote ...`.
2. Runs `agent-drive check` → fails with `drive key not backed up: <drive id>` followed by the BACKUP_HINT.
3. Agent tries `agent-drive credentials export --stdout` on its own terminal without a store → prints the `adcred1.` bundle to stdout and `Exported. After the secret store has saved it, run agent-drive credentials confirm.` (nothing recorded yet; and printing the bundle breaks the llms.txt rule "Never print... keys" if it lands in a log, a mistake worth noting).
4. Anya sets `AGENT_DRIVE_CREDENTIALS` in the platform's secrets; agent runs `agent-drive credentials confirm` → `Recorded the credential backup for 1 drive(s) (stdout).`
5. `agent-drive check` → `check ok drive=<id>`.
6. Anya opens the console Files tab: the red key banner "This drive's key hasn't been backed up..." is now an info line "Key backed up <date> (stdout)".

### Variations

- Agent writes the bundle to a path that dies with the sandbox: `credentials export --to /tmp/x` records method `file`; the CLI cannot know the path will not survive (gap).
- Read-only agent on an empty drive: `check` prints `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.`

### Edge Cases

- Re-running `login` changes the API key, which clears earlier backups: "The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again."
- More than one usable drive: `check` errors "More than one usable drive. Pass --drive ID."; with none: "There is no usable drive key on this machine. Run `agent-drive login` again."

## STORY-015: Self-hosted or staging origin needs --api

**Type**: medium
**Topic**: First-run agent setup from one pasted line
**Persona**: Tomas Rivera, testing a staging deployment at https://staging.agentdrive.example.
**Goal**: Have the agent log in to staging, not production.
**Preconditions**: Staging instance running; Tomas pastes `Set up Agent Drive: https://staging.agentdrive.example/llms.txt`.
**Ideal path**: 3 — paste the line, approve, verify.
**Alternate paths**: `AGENT_DRIVE_API_URL` environment variable; `--api` flag typed manually.

### Steps

1. The agent fetches that `llms.txt`; because the origin is not `https://agentdrive.xyz`, every `login` example includes `--api https://staging.agentdrive.example/api`.
2. Agent runs `agent-drive login --name "staging-bot" --api https://staging.agentdrive.example/api` → link printed on the staging origin.
3. Tomas opens it; Clerk on the staging app asks him to sign in (a different Clerk instance than production, so the production account does not work).
4. Approves; agent saves config for that API origin.

### Variations

- Agent drops `--api` and logs in to production: a link on agentdrive.xyz appears; Tomas notices the origin in the URL and the missing Machine.
- Plain `http://` non-loopback origin: the CLI's URL validation rejects it ("HTTPS, or exact loopback HTTP").

### Edge Cases

- Keys are trusted only for the origin they were saved for, so a later switch of origin discards the saved keys for sealing.
- The landing hero line and the console panel both use the current host, so a human copying from staging gets staging; copying from production docs gets production.

## STORY-016: Hosted chat assistant cannot complete setup

**Type**: short
**Topic**: First-run agent setup from one pasted line
**Persona**: Nadia Hossain, pastes the line into a cloud chat assistant with no shell.
**Goal**: Connect it anyway.
**Preconditions**: Assistant can fetch URLs but cannot run commands.
**Ideal path**: 1 — the assistant says it is not supported.
**Alternate paths**: none found (MCP also needs a local `agent-drive mcp` process).

### Steps

1. Assistant fetches `/llms.txt` → sees "Hosted assistants: Chat assistants that run in a vendor's cloud and have no shell on your machine are not supported, because encryption happens on the agent's own machine. Tell the human this."
2. It replies it cannot install the CLI. Nadia is stuck; the landing hero and console panel do not say this before she pastes (gap: the limitation is only in llms.txt, the last place she looks).
3. Nadia tries the console route: "Create API key" then gives the key to the chat → llms.txt rules say never to paste keys, and the assistant still has no shell.

### Variations

- Nadia installs the CLI on her own laptop, runs `agent-drive login` herself and approves; this is the supported route for her.

### Edge Cases

- llms.txt also instructs "If origin is unreachable, stop and tell the human. Do not try to work around it."

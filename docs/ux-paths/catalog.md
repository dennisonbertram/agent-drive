# UX Path Catalog: Agent Drive

Generated: 2026-11-06 (code at main 2870d7a, branch docs/ux-review-2)
Total Stories: 97 (93 after folding 4 duplicates, see Cross-references)
Coverage: 41 / 45 (91%) of the feature rows in the matrix below. The 4 uncovered rows are internal or operator surfaces.

Sources: `docs/ux-paths/discovery.md` and the twelve files in `docs/ux-paths/topics/`. Full steps, variations and edge cases live in the topic files; this catalog lists each story's goal, benchmark and alternate paths.

## Summary

| Type      | Count  |
| --------- | ------ |
| Short     | 31     |
| Medium    | 49     |
| Long      | 17     |
| **Total** | **97** |

Stories marked "(gap)" in a step or title: 54 of 97 stories carry at least one; 77 gap marks in total.

| Topic                                      | File                           | Stories | IDs                    |
| ------------------------------------------ | ------------------------------ | ------- | ---------------------- |
| Sign-up, sign-in and first console visit   | `topics/signup-signin.md`      | 8       | STORY-001 to STORY-008 |
| First-run agent setup from one pasted line | `topics/first-run-setup.md`    | 8       | STORY-009 to STORY-016 |
| Console as a cloud drive                   | `topics/console-drive.md`      | 8       | STORY-017 to STORY-024 |
| Download and decrypt in the browser        | `topics/download-decrypt.md`   | 8       | STORY-025 to STORY-032 |
| Search, recents and activity               | `topics/search-recents.md`     | 8       | STORY-033 to STORY-040 |
| Sharing                                    | `topics/sharing.md`            | 7       | STORY-041 to STORY-047 |
| Trash, versions and restore                | `topics/trash-versions.md`     | 8       | STORY-048 to STORY-055 |
| Multi-agent handoffs                       | `topics/multi-agent.md`        | 7       | STORY-056 to STORY-062 |
| Agents and API keys                        | `topics/agents-keys.md`        | 9       | STORY-063 to STORY-071 |
| Billing, usage and limits                  | `topics/billing-usage.md`      | 8       | STORY-072 to STORY-079 |
| Settings and data lifecycle                | `topics/settings-lifecycle.md` | 8       | STORY-080 to STORY-087 |
| Agent CLI/MCP daily use and edge cases     | `topics/agent-daily-use.md`    | 10      | STORY-088 to STORY-097 |

## Cross-references and duplicates

Duplicates are kept in the topic files so IDs stay stable. In a walk, run the canonical story and skip the duplicate.

| Duplicate                                           | Canonical | Why                                                                                                           |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| STORY-089 (two agents edit one file)                | STORY-052 | Same `--if-version` race and merge-retry; 089 uses the CLI default drive, 052 adds the console Versions view. |
| STORY-090 (restricted agent writes outside folder)  | STORY-059 | Same write-path refusal; 059 is the multi-agent view of it.                                                   |
| STORY-091 (read-only agent attempts write or share) | STORY-060 | Same scope refusal; 060 adds `check` behaviour.                                                               |
| STORY-080 (owner reviews what agents did)           | STORY-039 | Same audit-log read; 039 adds the Usage-by-author comparison.                                                 |

Topic overlaps (different goals, shared screens or commands):

- Sign-in redirect from an agent link: STORY-006 (sign-in topic) and STORY-010 (first-run topic) are two views of the same `/connect` to `/sign-in` bounce.
- Drive key: STORY-029 to STORY-031 (backup, recovery file) connect to STORY-014 (agent backup), STORY-056 (add existing drive) and STORY-058 (credentials issue).
- First drive: STORY-003 (console onboarding), STORY-024 (empty drive) and STORY-009 (agent-created drive) all end in the same empty Files state.
- Restore: STORY-049 (Trash tab), STORY-050 (Versions dialog) and STORY-051 (CLI) reach the same outcome.
- Trashed-path write: STORY-053 connects to STORY-052 and STORY-089.
- Key lifecycle: STORY-063 to STORY-066 (console), STORY-062 (revoke handed-off agent), STORY-068 (issued-by) and STORY-070 (revoked mid-session).
- Share: STORY-041 and STORY-047 (agent side), STORY-042 to STORY-044 (recipient), STORY-045 (list/revoke), STORY-046 (human asks for a console control that does not exist).
- Usage and limits: STORY-072 (Usage tab), STORY-074 to STORY-077 (billing) and STORY-079 (failure) do not share steps but share the numbers.
- Audit and activity: STORY-039, STORY-080 and STORY-081 against STORY-022 and STORY-038 (console has no recents).

## Coverage Matrix

| Feature Area                                                                   | Stories                                | Gaps                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Landing page (hero copy line, npm line, plans, mock approval card)             | 001, 009, 073                          | Mock 'Connect trace-bot?' card and footer links are only mentioned in passing                        |
| Pricing page (plans, usage rules, overage rates, not-configured banner)        | 001, 073, 074, 077                     |                                                                                                      |
| Clerk sign-up / sign-in, redirects, UserButton sign-out                        | 001, 002, 006, 007, 010                |                                                                                                      |
| Clerk not configured panel                                                     | 004                                    |                                                                                                      |
| Session expiry (401 'Your session expired')                                    | 005, 079, 087                          |                                                                                                      |
| Account provisioned on first console load; first-visit onboarding              | 003, 024                               |                                                                                                      |
| /llms.txt as setup script                                                      | 009, 015, 016, 040                     |                                                                                                      |
| Device login and /connect approval (new, reconnect, offer, bad/expired code)   | 006, 009, 010, 011, 012, 013, 056, 057 | 'Request changed; review it again' race notice has no story                                          |
| Delegate checkbox and delegate rules                                           | 012, 057, 061, 071                     |                                                                                                      |
| Credentials export / confirm / check ok; sandbox continuity                    | 009, 014, 029, 031, 058, 060           |                                                                                                      |
| Skill install                                                                  | 009, 097                               |                                                                                                      |
| Console Files tab: flat list, load more, filter, drive strip                   | 017, 018, 019, 023, 024                |                                                                                                      |
| Console absent features (folders, upload, preview, recents, sort, share, move) | 019, 020, 021, 022, 038, 046           | Stories document the absence; rename/move/copy in the console has no dedicated story (CLI only: 093) |
| Create drive and drive-key receipt                                             | 003, 024, 030                          |                                                                                                      |
| Load drive key, Forget key, download and decrypt in browser                    | 025, 026, 027, 028, 032                |                                                                                                      |
| Key backup banner and recovery file                                            | 029, 030, 031                          |                                                                                                      |
| Versions dialog, restore as new version                                        | 050, 051                               |                                                                                                      |
| Trash tab, console trash, restore                                              | 048, 049, 054                          |                                                                                                      |
| Conditional writes / --if-version conflicts                                    | 052, 053, 089                          |                                                                                                      |
| CLI put/get/ls/mv/cp, default drive, binary output                             | 088, 092, 093                          |                                                                                                      |
| sync and backup (dry run)                                                      | 094, 095                               |                                                                                                      |
| Search, ls filters, pagination                                                 | 033, 034, 035, 040                     |                                                                                                      |
| recent (cursor, --since, --wait long-poll)                                     | 036, 037, 040                          |                                                                                                      |
| Share create (CLI/MCP) with expiry                                             | 041, 047                               |                                                                                                      |
| Share recipient page: success and all error states                             | 042, 043, 044                          |                                                                                                      |
| Share list and revoke                                                          | 045                                    | MCP cannot list or revoke (047)                                                                      |
| Multi-agent: browser add-to-drive, grant, credentials issue                    | 056, 057, 058                          |                                                                                                      |
| Read-only and write-path limits; 'issued by'                                   | 059, 060, 068, 090, 091                |                                                                                                      |
| Agents tab: create agent, revoke access, Connect an agent panel (MCP snippets) | 003, 063, 066, 069, 096                | The MCP setup snippets in the panel are only touched by 096                                          |
| API keys tab: create key, scopes, receipt, revoke, rotation                    | 063, 064, 065, 066, 067, 070           |                                                                                                      |
| Key revoked mid-session; delegate cannot manage keys                           | 070, 071                               |                                                                                                      |
| Usage tab (storage by drive, usage by author)                                  | 072, 069                               |                                                                                                      |
| Billing page: upgrade through Stripe, portal, spend cap, alert, statements/CSV | 074, 075, 078                          |                                                                                                      |
| Plan limits, spend cap hit, payment banners, 'Not metered' egress              | 076, 077, 079                          |                                                                                                      |
| Audit log (Activity & deletion)                                                | 039, 080, 081                          |                                                                                                      |
| Delete drive, delete account, deletion requests                                | 082, 083, 084, 085, 086                |                                                                                                      |
| Settings on narrow screens / responsive sidebar                                | 087                                    | Only the settings page is checked on a phone; the console sidebar toggle has no dedicated story      |
| MCP server (12 tools) from an editor                                           | 096                                    |                                                                                                      |
| Reserved agent `__console__` / reserved-name refusal                           | 063 (edge), 068                        |                                                                                                      |
| Machines (recorded at login, `ls --machine`)                                   | 034, 069                               |                                                                                                      |
| Tags and descriptions (client/CLI only; not shown in console)                  | 034, 038                               |                                                                                                      |
| /api/oauth/\*                                                                  | none                                   | No UI or user path found in the discovery; may be internal                                           |
| /api/test-session (dev-only test auth)                                         | 004 (alt path only)                    | Intentionally not a user story                                                                       |
| Cron maintenance, Stripe webhook, operator CLIs                                | none                                   | Operator-facing, not user paths                                                                      |
| Landing mock approval card interaction                                         | 001 (passing)                          | Static mock; no step exercises it                                                                    |

Covered: 41 of 45 rows (91%).

## Story Dependency Graph

```text
STORY-001 (Landing + sign up)                    STORY-004 (No Clerk panel)  [standalone]
├── STORY-002 (Returning sign-in)
│   ├── STORY-005 (Session expires)
│   ├── STORY-007 (Account controls)
│   └── STORY-008 (Console unreachable)
├── STORY-003 (First-visit onboarding)
│   ├── STORY-024 (Empty drive)
│   │   ├── STORY-017 (Find in long list)  -> STORY-018, 019, 020, 021, 022, 023, 038
│   │   └── STORY-029 (Backup banner) -> STORY-030, STORY-031
│   ├── STORY-063 (Create agent + key) -> STORY-064 -> STORY-065 (Rotate), 066, 067, 070, 071
│   └── STORY-072 (Usage) -> STORY-074 (Upgrade) -> STORY-075 (Cap) -> STORY-076 (Cap hit)
│                         ├── STORY-077 (Free limits)  ├── STORY-078 (CSV)  └── STORY-079 (Failure)
└── STORY-009 (Landing -> check ok)  [long, needs STORY-001 or 002]
    ├── STORY-006, 010 (Signed-out link), 011 (Wrong machine), 012 (Delegate), 013 (Expired), 014 (No backup), 015 (--api), 016 (Chat assistant)
    ├── STORY-088 (First save)
    │   ├── STORY-092 (Binary get), 093 (mv/cp), 094 (sync), 095 (backup), 096 (MCP), 097 (Skill)
    │   ├── STORY-033 (Search) -> STORY-034 -> STORY-035, STORY-040 (Compare tools)
    │   │                        └── STORY-036 (Wait) -> STORY-037 (Resume)
    │   ├── STORY-048 (Trash) -> STORY-049 (Restore), 050 (Versions), 051 (CLI), 054 (Long trash)
    │   │                       └── STORY-052 (Race) -> STORY-053 (Trashed path), STORY-055 (Limited delete)
    │   ├── STORY-025 (Download, needs a file) -> STORY-026 -> STORY-027, STORY-028, STORY-032
    │   └── STORY-041 (Create share, needs share scope) -> STORY-042, 043, 044, 045, 047 -> STORY-046
    ├── STORY-056 (Add to existing drive)  [needs STORY-029 for the key]
    │   ├── STORY-057 (Grant, needs STORY-012)
    │   ├── STORY-058 (credentials issue, needs STORY-012) -> STORY-068 (Issued by)
    │   ├── STORY-059, 060, 061 (limits) -> STORY-062 (Revoke handed-off agent), STORY-069
    └── STORY-039 (Audit) -> STORY-081 (File history), STORY-082 (Delete drive)
        -> STORY-083 (Duplicate names) -> STORY-084 (Delete account) -> STORY-085 (Status) -> STORY-086 (Last drive) ; STORY-087 (Phone)
```

Run order for a first full walk: 001, 003, 024, 009, 088, 025, 029, 041 to 044, 048 to 051, 052, 056 to 061, 063 to 066, 072 to 077, 039, 082, 084. Run destructive stories (082 to 086) last.

## All Stories

### Sign-up, sign-in and first console visit

Full steps: `topics/signup-signin.md`

#### STORY-001: Visitor reads the landing page, then signs up through the pricing page

- Type: medium
- Persona: Priya Nair, a developer who runs Claude Code on a laptop and saw a link to agentdrive.xyz in a thread.
- Goal: Create an account to try the Free plan.
- Ideal path: 2 — one visible "Sign up" action on the landing page, then one Clerk form that lands in the console.
- Alternate paths: Landing "Console" link (redirects to `/sign-in`, then the Clerk form has its own sign-up link); pricing "Start with Free" (`/sign-up`); typing `/sign-up` directly; `/connect?code=` link from an agent (redirects to `/sign-in`).
- Gap marks in steps: 1

#### STORY-002: Returning owner signs in and lands in the console

- Type: short
- Persona: Marcus Webb, an existing user returning after two weeks.
- Goal: Open his files.
- Ideal path: 2 — click Sign in, authenticate, land in the console.
- Alternate paths: Go straight to `/console` (server redirect to `/sign-in`); Clerk keeps a live session so `/console` opens directly.

#### STORY-003: Brand-new account sees the first-visit onboarding

- Type: medium
- Persona: Lena Fischer, just finished the Clerk sign-up, has not touched an agent yet.
- Goal: Understand what to do next and get a first drive.
- Ideal path: 3 — create a drive, save the key, continue (or skip the console entirely and paste the agent line).
- Alternate paths: The "Connect an agent" panel on the Agents tab (copy the llms.txt line, no drive needed first); the sidebar "Connect an agent" button in the empty Files state; paste the line into an agent, which creates the drive during `/connect` approval.
- Gap marks in steps: 2

#### STORY-004: Visitor opens a sign-in page on an installation with no Clerk

- Type: short
- Persona: Tomas Rivera, self-hosting Agent Drive for a weekend project without Clerk keys.
- Goal: Sign in to the console.
- Ideal path: 1 — a clear message with the fix, since no human sign-in can exist.
- Alternate paths: development test auth (`AGENT_DRIVE_TEST_AUTH=1`, `POST /api/test-session` from loopback with a bearer secret) gives a signed cookie.

#### STORY-005: Session expires while the console is open

- Type: medium
- Persona: Aisha Khan, leaves the console tab open overnight with a half-typed API key label.
- Goal: Continue working the next morning.
- Ideal path: 2 — sign in again and return to what she was doing.
- Alternate paths: reload the page (server redirect to `/sign-in`).
- Gap marks in steps: 1

#### STORY-006: Agent-printed approval link sends a signed-out human through sign-in

- Type: medium
- Persona: Diego Alvarez, signed out of his laptop browser, clicks the link his terminal agent printed.
- Goal: Approve the agent without losing the pairing code.
- Ideal path: 2 — sign in, land on the approval page with the code filled in.
- Alternate paths: new user: use the Clerk sign-up link from the sign-in card (Clerk then decides the redirect, see edge cases); the CLI opens the browser itself when stdout is a terminal and `CI` is unset.
- Gap marks in steps: 2

#### STORY-007: Signed-in owner finds sign-out and account controls

- Type: short
- Persona: Hana Sato, on a shared office laptop who wants to end her session.
- Goal: Sign out.
- Ideal path: 2 — open the account menu, click sign out.
- Alternate paths: none found in this app (no sign-out link on billing or settings pages).

#### STORY-008: Console is unreachable on first load

- Type: short
- Persona: Owen Brooks, on hotel wifi that drops the API request.
- Goal: Open his workspace.
- Ideal path: 1 — one visible retry action.
- Alternate paths: browser refresh.
- Gap marks in steps: 1

### First-run agent setup from one pasted line

Full steps: `topics/first-run-setup.md`

#### STORY-009: Happy path from the landing page to check ok

- Type: long
- Persona: Priya Nair, running Claude Code in a macOS terminal, already has an account and no drives.
- Goal: Give Claude Code a drive that survives the session.
- Ideal path: 4 — paste the line, click the printed link, click Approve, tell the agent to finish (the agent does the rest: install, backup, skill, check).
- Alternate paths: copy the same line from the console Agents tab "Connect an agent" panel; copy `npm install -g <origin>/cli/agent-drive.tgz` from the landing page and run `agent-drive login` yourself; console-first route via "Create your first drive" and "Create API key" then `login --token-stdin`.

#### STORY-010: Human is signed out when the agent's link arrives

- Type: medium
- Persona: Jonas Weber, new to Agent Drive, has only pasted the line into Codex.
- Goal: Approve the agent without creating confusion.
- Ideal path: 3 — sign up, return to the approval page automatically, click Approve.
- Alternate paths: sign in with existing account; open `/connect` directly and type the code.
- Gap marks in steps: 1

#### STORY-011: Approving a machine that is not the one he started

- Type: medium
- Persona: Mei Lin, who pasted the line into two agents (a laptop agent and a cloud VM) within a minute.
- Goal: Approve only the laptop agent.
- Ideal path: 3 — open the right link, verify the code and machine, approve.
- Alternate paths: type the code in `/connect`'s code form; let the other request expire (unapproved requests expire on their own).

#### STORY-012: Delegate checkbox on the first approval

- Type: medium
- Persona: Carlos Reyes, plans to run one lead agent that will onboard two helper agents later.
- Goal: Allow the lead agent to add others.
- Ideal path: 3 — tick the checkbox, approve, agent finishes.
- Alternate paths: approve without the box and later re-approve (`agent-drive login` again, tick the box); `credentials issue` only works with delegate.

#### STORY-013: Agent waits, the code expires, agent retries

- Type: medium
- Persona: Ravi Patel, got a phone call after pasting the line and came back 15 minutes later.
- Goal: Finish setup after the delay.
- Ideal path: 3 — rerun login, open the new link, approve.
- Alternate paths: none found.

#### STORY-014: Agent in a sandbox forgets to back up credentials

- Type: medium
- Persona: A coding agent in a disposable cloud container, supervised by Anya Kowalski.
- Goal: Finish setup so files survive the container.
- Ideal path: 2 — export credentials once to a surviving place, run check.
- Alternate paths: `AGENT_DRIVE_CREDENTIALS` secret holds a bundle merged in memory, which counts as backed up; console "Download recovery file" (records method `file`).
- Gap marks in steps: 1

#### STORY-015: Self-hosted or staging origin needs --api

- Type: medium
- Persona: Tomas Rivera, testing a staging deployment at https://staging.agentdrive.example.
- Goal: Have the agent log in to staging, not production.
- Ideal path: 3 — paste the line, approve, verify.
- Alternate paths: `AGENT_DRIVE_API_URL` environment variable; `--api` flag typed manually.

#### STORY-016: Hosted chat assistant cannot complete setup

- Type: short
- Persona: Nadia Hossain, pastes the line into a cloud chat assistant with no shell.
- Goal: Connect it anyway.
- Ideal path: 1 — the assistant says it is not supported.
- Alternate paths: none found (MCP also needs a local `agent-drive mcp` process).
- Gap marks in steps: 1

### Console as a cloud drive

Full steps: `topics/console-drive.md`

#### STORY-017: Find yesterday's trace file in a long flat list

- Type: medium
- Persona: Priya, a founder whose agent "trace-bot" writes daily logs such as /inbox/trace-bot/2026-11-05.jsonl. She opens the console on her laptop to check one.
- Goal: Locate /inbox/trace-bot/2026-11-05.jsonl and see who wrote it and when.
- Ideal path: 3 — open Files, type part of the name, read the row.
- Alternate paths: CLI `agent-drive ls --prefix /inbox/trace-bot` or `search --query`; MCP `list` and `search` (server-side, cover all files). No console equivalent beyond the filter.
- Gap marks in steps: 2

#### STORY-018: Switch between drives and notice the filter and key reset

- Type: short
- Persona: Marcus, who runs two agents on drives "research" and "client-acme".
- Goal: Look at client-acme's files after working in research.
- Ideal path: 1 — one click on the drive.
- Alternate paths: none found (no drive picker elsewhere; selection is client state, not in the URL).
- Gap marks in steps: 1

#### STORY-019: Open a folder like in Dropbox (gap)

- Type: short
- Persona: Hana, new to Agent Drive, used to Dropbox. Her agent wrote /reports/q3/summary.md and /reports/q4/summary.md.
- Goal: Click "reports", then "q3", and see only the files in it.
- Ideal path: 2 — click a folder, click a subfolder.
- Alternate paths: filter box with "/reports/q3/" (substring on loaded rows only); CLI `ls --prefix /reports/q3`; MCP `list` with a prefix.
- Gap marks in steps: 2

#### STORY-020: Upload a file from the browser (gap)

- Type: short
- Persona: Tomás, who has a PDF contract he wants his agent to read; he expects to drag it onto the drive.
- Goal: Put contract.pdf into the drive from the console.
- Ideal path: 2 — drag the file onto the page, confirm.
- Alternate paths: `agent-drive put ./contract.pdf /clients/acme/contract.pdf --drive ID`; MCP `put`; `agent-drive sync LOCAL_DIR`. The agent or CLI is the only writer.
- Gap marks in steps: 3

#### STORY-021: Preview a file before downloading (gap)

- Type: short
- Persona: Aisha, checking whether notes.md in /memory/agent-notes/ is the right version before sending it on.
- Goal: Read the first lines in the console.
- Ideal path: 1 — click the file name to open a preview.
- Alternate paths: CLI `agent-drive get /memory/agent-notes/notes.md` (prints text; binary needs `--output`); MCP `get`; or Download then open locally.
- Gap marks in steps: 3

#### STORY-022: See what changed recently (gap)

- Type: medium
- Persona: Jonas, who left two agents running overnight and wants a "Recent" view like Google Drive.
- Goal: See which files were added or changed since yesterday.
- Ideal path: 1 — open a Recent view.
- Alternate paths: CLI `agent-drive recent --since ... [--wait]`; MCP `recent`; `ls --agent NAME`; Activity & deletion page (audit log of actions, not file lists).
- Gap marks in steps: 2

#### STORY-023: Recover from a failed file list

- Type: medium
- Persona: Elena on hotel Wi-Fi, opening the console while the connection drops.
- Goal: Get the file list to load.
- Ideal path: 2 — see the error, click retry.
- Alternate paths: "Refresh" button in the page heading; full browser reload.

#### STORY-024: Brand-new user with an empty drive

- Type: long
- Persona: Wei, just signed up, no agent yet.
- Goal: Get from an empty console to seeing a first file.
- Ideal path: 5 — create drive, save key, paste instruction to agent, agent puts file, see it.
- Alternate paths: agent-first setup with `/llms.txt` and `/connect` (drive created by the device flow); API keys tab "Create API key".

### Download and decrypt in the browser

Full steps: `topics/download-decrypt.md`

#### STORY-025: First download of a file with a pasted drive key

- Type: medium
- Persona: Priya, who has the key in her password manager and wants /reports/q3/summary.md.
- Goal: Download the decrypted file.
- Ideal path: 3 — load key once, click Download, open file.
- Alternate paths: CLI `agent-drive get /reports/q3/summary.md --output ./summary.md` (key comes from config); share link page (`/s/id#k=...`) for a single file; MCP `get`.

#### STORY-026: Load the key from a recovery file

- Type: medium
- Persona: Marcus, who saved agent-drive-drv_8f2a.key.json to his Downloads folder two weeks ago.
- Goal: Unlock the drive without copying the key text.
- Ideal path: 2 — choose the file, confirm.
- Alternate paths: paste key text; choose an `adcred1.` bundle file.
- Gap marks in steps: 1

#### STORY-027: Wrong key accepted, then decryption fails

- Type: long
- Persona: Jonas, who has two drives and two similar-looking keys in his notes.
- Goal: Download a file and understand why it fails.
- Ideal path: 3 — paste key, see an immediate mismatch error, paste the right key.
- Alternate paths: use the recovery file for the drive (checked against the drive id); use CLI `get`, which uses its own stored key.
- Gap marks in steps: 1

#### STORY-028: Forget the key on a shared computer

- Type: short
- Persona: Elena, using a hotel business-center PC and about to leave.
- Goal: Make sure the drive key is gone from the browser.
- Ideal path: 1 — one action that clears all keys (sign out).
- Alternate paths: reload or close the tab (memory only; nothing in localStorage, per dialog text); Clerk sign-out via "Your account".
- Gap marks in steps: 1

#### STORY-029: Key-backup banner on an agent-created drive

- Type: medium
- Persona: Hana, whose agent trace-bot made the drive through `/connect` but has not run `credentials confirm`.
- Goal: Understand the red banner and make it go away.
- Ideal path: 2 — read the banner, act on it (confirm backup or save a recovery file).
- Alternate paths: agent runs `credentials export --to PATH` then `credentials confirm`; the human loads the key and clicks "Download recovery file".

#### STORY-030: Save a recovery file twice

- Type: medium
- Persona: Wei, creating a drive in the console and trying to do the right thing.
- Goal: Back up the key and have the console agree.
- Ideal path: 2 — save the recovery file at creation, banner shows backed up.
- Alternate paths: copy key from the receipt into a password manager (not recorded by the service); "Download recovery file" on the Files tab.

#### STORY-031: Recovery file made with a wrong key

- Type: medium
- Persona: Aisha, who loads an old key from her notes without testing it.
- Goal: Create a trustworthy backup.
- Ideal path: 3 — load key, verify it decrypts something, save recovery file.
- Alternate paths: CLI `agent-drive check` after `credentials export`, which tests the key against a file.
- Gap marks in steps: 1

#### STORY-032: Download from a restored or large file list

- Type: long
- Persona: Tomás recovering after his agent's laptop died.
- Goal: Pull back three files from a drive via the console.
- Ideal path: 6 — load key, filter, download x3 (could be 5 with multi-select).
- Alternate paths: new machine: `login` then `/connect` "Add to an existing drive instead", then `agent-drive sync`/`get`.
- Gap marks in steps: 1

### Search, recents and activity

Full steps: `topics/search-recents.md`

#### STORY-033: Agent finds last week's trace files with a text search

- Type: short
- Persona: A coding agent ("planner-bot") working for Maya Okafor, who asked it to "reopen the notes about the billing migration".
- Goal: Locate files whose path mentions "billing" without listing the whole drive.
- Ideal path: 1 — one search command returns matching paths.
- Alternate paths: `agent-drive ls --prefix /notes` (narrower, needs the folder guess); MCP `search` tool with `q`; console "Filter loaded files…" (human only, loaded rows only).
- Gap marks in steps: 1

#### STORY-034: Agent narrows by tag, author and machine

- Type: medium
- Persona: "audit-bot", an agent asked by Luis Ferreira to find everything that "trace-bot" wrote from the laptop named `luis-mbp` and tagged `daily`.
- Goal: Combine attribution filters to get a short list.
- Ideal path: 3 — find the agent id, run one filtered command, read the result.
- Alternate paths: `ls --agent ... --machine ... --tag daily` (same filters, without `--query`); MCP `search` with `agentId`, `machine`, `tag`.

#### STORY-035: Agent pages through a large result

- Type: short
- Persona: "indexer-bot" cataloguing a 2,400-file drive for Priya Nair.
- Goal: Read every file entry.
- Ideal path: 1 — one call would be ideal; practically one call per page (48 pages at 50, 24 at the 100 maximum).
- Alternate paths: MCP `list` with `limit` and `cursor`; `sync` is for local directories, not for listing.

#### STORY-036: Agent waits for a teammate agent's file to appear

- Type: medium
- Persona: "reviewer-bot" (Codex on Sam Whitfield's desktop) must start only after "writer-bot" on another machine uploads `/handoff/spec-v3.md`.
- Goal: Block until another agent changes the drive, then read the new file.
- Ideal path: 2 — one blocking wait, one read.
- Alternate paths: MCP `recent` with `waitSeconds` (max 30, so loop); a shell loop around `recent`.
- Gap marks in steps: 1

#### STORY-037: Agent resumes from the last cursor after a restart

- Type: medium
- Persona: "sync-bot" running overnight for Dana Ruiz, restarted by its supervisor at 03:10.
- Goal: Process every event once, without replaying or missing any.
- Ideal path: 1 — one command with the saved cursor.
- Alternate paths: `recent --since 2026-11-06T03:00:00Z` (approximate, by transaction start time; may duplicate or skip near the boundary).

#### STORY-038: Human tries to find a file in the console

- Type: medium
- Persona: Maya Okafor (non-technical owner) wants `/inbox/trace-bot/2026-11-05.jsonl`, which her agent said it saved yesterday. The drive has 1,800 files.
- Goal: Find and open a specific file by name, and see what changed recently.
- Ideal path: 3 — type part of the name in a search box that covers the whole drive, click the result, download.
- Alternate paths: Ask the agent to run `agent-drive search --query 2026-11-05`; the Trash tab if the file may have been deleted.
- Gap marks in steps: 3

#### STORY-039: Owner checks the audit log after a suspicious spike

- Type: long
- Persona: Luis Ferreira got an email alert that API operations hit 80% of the month's allowance on the 6th. He wants to know which agent caused it.
- Goal: Identify which agent and key made the calls.
- Ideal path: 4 — open settings, find the actor, open Agents, revoke.
- Alternate paths: Usage tab "Usage by author" table (operations per agent, no timeline); `/console/billing` "usage by agent" with a statement period selector.
- Gap marks in steps: 1

#### STORY-040: Agent compares search, ls and recent to choose the right tool

- Type: long
- Persona: A new agent, "notes-bot", set up by Priya Nair using the llms.txt instructions. The instruction file lists only `backup`, `put`, `get`, `ls --prefix` and `share`.
- Goal: Learn that search and recents exist, and use them for "what changed since I was last here?".
- Ideal path: 2 — one `recent --cursor` call replaces the list-and-compare.
- Alternate paths: MCP `recent` tool; `ls` and diff against a local copy of the listing.
- Gap marks in steps: 1

### Sharing

Full steps: `topics/sharing.md`

#### STORY-041: Agent creates a 24-hour link for a report

- Type: short
- Persona: "report-bot" for Dana Ruiz, who needs to send a client `/reports/q3-summary.pdf` by email.
- Goal: Produce a link that works for a day and then dies.
- Ideal path: 1 — one command returns the link.
- Alternate paths: MCP `share` tool with `path` and `expiresAt`.

#### STORY-042: Recipient opens a valid link

- Type: short
- Persona: Tomas Berg, a client with no account, opens Dana's email on his phone.
- Goal: Download the PDF.
- Ideal path: 2 — open link, tap Download.
- Alternate paths: none found (no preview, no "open in browser").

#### STORY-043: Recipient has a link with the key cut off

- Type: medium
- Persona: Tomas copies the link out of a chat app that dropped everything after `#`.
- Goal: Get the file anyway.
- Ideal path: 3 — see the error, paste the full link, download.
- Alternate paths: Ask Dana for the link again.

#### STORY-044: Recipient finds a link expired or revoked

- Type: medium
- Persona: Aisha Karim opens a link Dana sent two days ago (24h expiry). Another recipient opens a link Dana revoked this morning.
- Goal: Understand why it fails and what to do.
- Ideal path: 2 — open link, read the error, contact sender.
- Alternate paths: none found (recipient cannot request a new link from the page).

#### STORY-045: Agent lists shares and revokes one

- Type: medium
- Persona: "report-bot" after Dana says "I sent the wrong file to the client, turn it off".
- Goal: Find the share for `/reports/q3-draft.pdf` and revoke it.
- Ideal path: 2 — list, revoke.
- Alternate paths: none for humans in the console (gap).
- Gap marks in steps: 2

#### STORY-046: Human wants to share a file from the console

- Type: medium
- Persona: Maya Okafor wants to send a contract PDF from her drive to her lawyer, and expects a "Share" button as in Google Drive.
- Goal: Create a link for the lawyer.
- Ideal path: 3 — click Share on the row, pick expiry, copy link.
- Alternate paths: Ask her agent: "Share /contracts/lease-2026.pdf for 3 days" (works through MCP `share` or the CLI); or download the file in the console and send it by email.
- Gap marks in steps: 2

#### STORY-047: Agent shares from an MCP session, then checks the audit trail

- Type: long
- Persona: Claude Code with the Agent Drive MCP server, working for Sam Whitfield, who then asks "who has been downloading that file?".
- Goal: Create a link through MCP, and let the owner verify share activity.
- Ideal path: 3 — create, send, check.
- Alternate paths: `agent-drive share list` shows status, not downloads.
- Gap marks in steps: 1

### Trash, versions and restore

Full steps: `topics/trash-versions.md`

#### STORY-048: Owner trashes a stale report from the console and sees the notice

- Type: short
- Persona: Mara Ellis, a solo founder, cleaning up after her agent "report-bot" wrote a wrong file.
- Goal: Remove /reports/2026-11-04-draft.md from the drive's file list.
- Ideal path: 2 — find the row, press one remove action (undo offered afterward).
- Alternate paths: CLI `agent-drive rm /reports/2026-11-04-draft.md` (needs the `delete` scope). MCP tool `delete`.
- Gap marks in steps: 1

#### STORY-049: Owner restores a trashed file from the Trash tab

- Type: short
- Persona: Mara Ellis, the next morning, realises the "wrong" file was the right one.
- Goal: Get /reports/2026-11-04-draft.md back.
- Ideal path: 2 — open Trash, press Restore.
- Alternate paths: CLI `agent-drive restore /reports/2026-11-04-draft.md --drive ID` (needs read and write scopes, not `delete`). Versions dialog per-version "Restore this version" (Trash tab Versions button).

#### STORY-050: Owner rolls back to yesterday's version in the Versions dialog

- Type: medium
- Persona: Dev Patel, an engineer whose agent "notes-bot" overwrote /notes/design.md with a bad summary.
- Goal: Make the previous content current again.
- Ideal path: 3 — open the history, pick the older version, confirm it became current.
- Alternate paths: CLI `agent-drive versions /notes/design.md --drive ID` then `restore /notes/design.md --version ID`. MCP `versions` and `restore`.
- Gap marks in steps: 1

#### STORY-051: Agent deletes a file and restores it from the CLI after the human objects

- Type: medium
- Persona: An agent "build-agent" working for Tomás Rivera; Tomás says "wait, I needed that log".
- Goal: Delete /logs/run-0412.txt, then bring it back.
- Ideal path: 2 — one `rm`, one `restore`.
- Alternate paths: MCP `delete` then `restore`; console Trash tab restore.
- Gap marks in steps: 1

#### STORY-052: Two agents race on one file and the loser hits a --if-version conflict

- Type: long
- Persona: Agents "planner" and "writer" sharing /plan/status.md for the human Ines Okafor.
- Goal: Update the status file without clobbering the other's change.
- Ideal path: 4 — read, write with condition, on conflict re-read and retry.
- Alternate paths: MCP `put` with `ifVersionId`. `sync` and `backup` do their own handling.

#### STORY-053: Conditional write hits a trashed file

- Type: medium
- Persona: Agent "sync-bot" for Priya Nair, after Priya trashed /data/config.json in the console.
- Goal: Write a new config.json.
- Ideal path: 2 — be told the file is trashed, then restore or overwrite.
- Alternate paths: console Trash tab Restore first.
- Gap marks in steps: 1

#### STORY-054: Owner looks for a deleted file but cannot find it in a long Trash list

- Type: medium
- Persona: Hannah Cho, an operator who has 300 files in trash after an agent cleanup run.
- Goal: Restore /exports/customer-list-2026-10.csv only.
- Ideal path: 3 — search the trash, restore one file, verify it.
- Alternate paths: CLI cannot list trash; `agent-drive restore PATH` works if she knows the exact path.
- Gap marks in steps: 1

#### STORY-055: Read-only or path-limited agent tries to delete and restore

- Type: medium
- Persona: Agent "viewer-bot" (read only) and "inbox-bot" (writes under /inbox/x) for Luis Ferreira.
- Goal: See which destructive actions each limited key may perform.
- Ideal path: 2 — one attempt, one clear refusal each.
- Alternate paths: none found.

### Multi-agent handoffs

Full steps: `topics/multi-agent.md`

#### STORY-056: Owner adds a second agent to the existing drive in the browser

- Type: long
- Persona: Mara Ellis, who already has "report-bot" and now installs "trace-bot" on a second laptop.
- Goal: Give trace-bot access to the drive report-bot uses, without creating a new drive.
- Ideal path: 4 — run login, open link, pick existing drive plus key file, approve.
- Alternate paths: `grant` from an existing delegate agent (next stories); `credentials issue` for sandboxes.

#### STORY-057: Existing agent offers a drive with grant; owner only approves

- Type: long
- Persona: Agent "report-bot" (has `delegate`) on behalf of Mara Ellis, adding "trace-bot" limited to /traces.
- Goal: Hand over the drive with minimal human work.
- Ideal path: 3 — new agent logs in, existing agent grants, human clicks Approve.
- Alternate paths: Browser key paste (previous story); `credentials issue`.

#### STORY-058: Sandbox agent gets credentials with credentials issue

- Type: long
- Persona: Agent "ci-orchestrator" for Tomás Rivera, creating a key for a GitHub Actions job with no browser.
- Goal: Give the CI job read and write under /ci/artifacts.
- Ideal path: 3 — issue to stdout into a secret store, human sets one secret, job runs.
- Alternate paths: Browser add-to-drive; grant (needs a browser for approval).
- Gap marks in steps: 1

#### STORY-059: Limited agent tries to write outside its folder

- Type: short
- Persona: trace-bot, limited to /traces, asked by a user to save /reports/q3.md.
- Goal: Understand why a write was refused and recover.
- Ideal path: 2 — error names the allowed folder, agent retries under it.
- Alternate paths: owner issues a wider key.

#### STORY-060: Read-only agent runs check and tries to write

- Type: medium
- Persona: Agent "auditor" added with "Read only" ticked by Luis Ferreira.
- Goal: Confirm it can read the drive.
- Ideal path: 2 — check, then read a file.
- Alternate paths: none found.
- Gap marks in steps: 1

#### STORY-061: Delegate cannot pass on delegate or exceed its own rights

- Type: medium
- Persona: Agent "lead-agent" holding read, write, delegate on /project, trying to over-grant.
- Goal: Hand a helper broad rights; learn the limits.
- Ideal path: 2 — attempt and be refused with one clear sentence.
- Alternate paths: none found.

#### STORY-062: Owner revokes a handed-off agent

- Type: medium
- Persona: Tomás Rivera, after the CI job leaked its secret in a log.
- Goal: Cut off ci-job immediately.
- Ideal path: 3 — open Agents, revoke, confirm.
- Alternate paths: API keys tab, Revoke on the single key.
- Gap marks in steps: 1

### Agents and API keys

Full steps: `topics/agents-keys.md`

#### STORY-063: Human creates an agent and a read-only key in the console

- Type: medium
- Persona: Mara Okafor, a solo developer who wants a read-only "report-reader" agent to pull her notes drive into a dashboard job.
- Goal: Have a key that can read the drive but not change it.
- Ideal path: 4 — name the agent, tick read only, create, copy the secret.
- Alternate paths: CLI `agent create --name report-reader` then `key create --agent ID --drive ID --label L --scope read` (needs a key with `manage`). Device flow `login --name report-reader` then tick "Read only" on /connect only works when adding to an existing drive.

#### STORY-064: Connect the new key to an agent with login --token-stdin

- Type: medium
- Persona: Mara, now at her server terminal with the secret on her clipboard.
- Goal: Make the CLI on the server authenticate as report-reader.
- Ideal path: 2 — paste secret into one command; verify with whoami.
- Alternate paths: Set `AGENT_DRIVE_API_KEY` in the environment (login saves it); the terminal snippet on the API keys tab ("Connect without sharing your identity") shows `read -rs ...; agent-drive login --api <origin>`; device flow (`login --name`) avoids pasting a secret at all.
- Gap marks in steps: 2

#### STORY-065: Rotate a key without breaking the agent

- Type: long
- Persona: Dev Patel, who pasted a key into a chat transcript by mistake and wants it replaced before his nightly job runs.
- Goal: Replace the key for agent "nightly-sync" with no failed run.
- Ideal path: 3 — one "Rotate" action that creates the new key, shows the secret, and revokes the old one after confirmation.
- Alternate paths: CLI `key create ...` then `key revoke ID` (needs a manage-scope key); no rotate command or button exists (gap).
- Gap marks in steps: 3

#### STORY-066: Revoke one leaked key versus revoking the whole agent

- Type: medium
- Persona: Hana Ito, who sees a coworker's laptop was stolen and knows it held one of two keys for agent "ci-bot".
- Goal: Cut off the stolen laptop but keep CI running.
- Ideal path: 2 — click Revoke on the one key and confirm.
- Alternate paths: Agents tab "Revoke access" kills both keys; CLI `key revoke ID`.

#### STORY-067: Scope check, "manage" is the dangerous box

- Type: short
- Persona: Luis Romero, creating a key for a untrusted script and unsure what the checkboxes mean.
- Goal: Give the script only what it needs: write new notes but not delete or share.
- Ideal path: 3 — pick scopes, create, copy.
- Alternate paths: CLI `key create --scope write --scope read` (default when no --scope given: read and write).
- Gap marks in steps: 2

#### STORY-068: Reading "issued by" labels after a sandbox handoff

- Type: medium
- Persona: Priya Nair, whose main agent "planner" issued credentials for a CI sandbox agent "sandbox-ci" and she now audits what exists.
- Goal: Confirm who created the sandbox's key and revoke it when the job ends.
- Ideal path: 2 — open API keys, read the row, revoke it.
- Alternate paths: Agents tab shows the same "issued by planner" line under the agent id.
- Gap marks in steps: 1

#### STORY-069: Wrong agent picked, then the one-agent-two-machines question

- Type: medium
- Persona: Sam Whitfield, who runs the same assistant on a laptop and a desktop.
- Goal: Decide between one agent with two keys and two agents; end with attributable history.
- Ideal path: 3 — add a second key with label "desktop" under the same agent.
- Alternate paths: Run `login --name desk-assistant-2` on the desktop (device flow creates a second agent), CLI `key create`.
- Gap marks in steps: 1

#### STORY-070: Key revoked mid-session, agent sees the failure

- Type: short
- Persona: Tomas Berg, an agent operator watching an agent run `sync` when the owner revokes its key.
- Goal: Understand why writes stopped and recover.
- Ideal path: 2 — read the error, ask the human for a new key.
- Alternate paths: Re-run `agent-drive login --name trace-bot` to restart device approval.

#### STORY-071: Delegated agent cannot manage keys

- Type: short
- Persona: Ines Duarte, an agent developer whose "planner" agent (delegate) tries to list all keys.
- Goal: Learn what a delegate may do.
- Ideal path: 1 — read the error.
- Alternate paths: none found.

### Billing, usage and limits

Full steps: `topics/billing-usage.md`

#### STORY-072: Check usage after a heavy week

- Type: short
- Persona: Mara Okafor, a solo developer whose agents have been syncing logs and who wants to know if she is near the Free limits.
- Goal: See how much storage and how many operations she has used.
- Ideal path: 2 — open the Usage view and read it.
- Alternate paths: /console/billing shows storage vs included allowance ("5.0 GiB included · 2 drives"); the same number appears in both places.
- Gap marks in steps: 2

#### STORY-073: A prospect reads pricing with checkout not configured

- Type: short
- Persona: Noor Hassan, evaluating Agent Drive for a team, on a self-hosted deployment without Stripe.
- Goal: Find out what the paid plans cost and subscribe.
- Ideal path: 2 — read pricing, click a paid plan.
- Alternate paths: /console/billing when signed in shows the same limitation.

#### STORY-074: Upgrade from Free to Developer through Stripe

- Type: long
- Persona: Dev Patel, whose agent just got "Your plan allowance would be exceeded" and who is ready to pay $20.
- Goal: Move to the Developer plan and keep writing.
- Ideal path: 3 — click Choose developer, complete card form, return.
- Alternate paths: Pricing page card "Choose Developer" leads to the same billing page.

#### STORY-075: Set a monthly spend cap and an alert

- Type: medium
- Persona: Hana Ito, a team lead who fears a runaway agent loop on the Developer plan.
- Goal: Stop writes at $50 and get an email at $30.
- Ideal path: 2 — type two amounts and the email, save.
- Alternate paths: none found (no CLI or API for humans other than PATCH /api/console/billing/settings).

#### STORY-076: Agent hits the spend cap and tells the human

- Type: long
- Persona: Tomas Berg's agent "trace-bot", uploading /inbox/trace-bot/2026-11-05.jsonl when the monthly cap is reached.
- Goal: Understand the failure, still read earlier files, and get the human to raise the cap.
- Ideal path: 3 — see the cap message, tell the human, human raises the cap.
- Alternate paths: Human can wait for the next UTC month.
- Gap marks in steps: 2

#### STORY-077: Free account hits download and operation limits

- Type: medium
- Persona: Luis Romero, running a backup restore that fetches many files from a Free account.
- Goal: Understand why `get` and `share` start failing.
- Ideal path: 2 — read the error, open Billing.
- Alternate paths: Console Download button for files draws on the same monthly download allowance.

#### STORY-078: Export a past month's usage as CSV

- Type: medium
- Persona: Priya Nair, preparing an expense note for October.
- Goal: Download per-agent usage for last month.
- Ideal path: 3 — pick the period, click Download CSV, open it.
- Alternate paths: none found.
- Gap marks in steps: 1

#### STORY-079: Billing page fails to load or the session expires

- Type: short
- Persona: Noor Hassan, returning to billing after a long day.
- Goal: Reach billing details; recover from errors.
- Ideal path: 1 — sign in again.
- Alternate paths: none found.
- Gap marks in steps: 2

### Settings and data lifecycle

Full steps: `topics/settings-lifecycle.md`

#### STORY-080: Owner reviews what the agents did last night

- Type: short; duplicate of STORY-039
- Persona: Priya, a solo developer whose two agents (trace-bot, notes-bot) ran overnight, wondering whether anything was refused.
- Goal: See recent activity and spot failed or denied requests.
- Ideal path: 2 — open the page, read the newest rows; the log should be one click from the console.
- Alternate paths: Files tab has no activity feed (gap); `agent-drive recent --drive ID` shows file events only, not denied requests; Usage tab "Usage by author" shows operation counts, not individual events.
- Gap marks in steps: 2

#### STORY-081: Owner cannot find file-level history in the audit log

- Type: short
- Persona: Marcus, who thinks a teammate's agent deleted /inbox/vendor/2026-11-05.jsonl.
- Goal: Find who deleted a specific file and when.
- Ideal path: 3 — open Trash tab, see "Deleted" date and author on the row, done.
- Alternate paths: Trash tab (DELETED date, author); Versions dialog; `agent-drive recent`; audit log (action name only).
- Gap marks in steps: 1

#### STORY-082: Delete one drive after finishing a project

- Type: medium
- Persona: Hana, finished a contract; wants the drive "client-acme-q3" gone but keeps her other drive "personal-notes".
- Goal: Permanently delete one drive.
- Ideal path: 3 — pick drive, type name, confirm.
- Alternate paths: Per-drive delete exists only on this page; no delete in the Files tab or CLI (`drive delete` does not exist).
- Gap marks in steps: 2

#### STORY-083: Duplicate drive names make the delete dropdown ambiguous

- Type: short
- Persona: Tomas, who created two drives both named "scratch" while testing.
- Goal: Delete only the older "scratch" drive.
- Ideal path: 3 — pick the right one by id or date, type name, confirm.
- Alternate paths: Drive IDs are visible with copy buttons in the Files tab drive view.
- Gap marks in steps: 1

#### STORY-084: Delete the whole account

- Type: long
- Persona: Elena, closing her workspace after moving to another tool; she has a paid Developer plan.
- Goal: End the account and know when data is really gone.
- Ideal path: 4 — open settings, read what happens, type phrase, confirm (cancel-plan step should be automatic).
- Alternate paths: Billing page offers plan changes and the portal but no account closure; the settings page notes "This is not a plan downgrade".
- Gap marks in steps: 1

#### STORY-085: Checking whether the deletion has finished

- Type: medium
- Persona: Hana, ten minutes after requesting drive deletion, wants proof it is purged.
- Goal: See the job status.
- Ideal path: 2 — open settings, read the status line; ideally it updates itself.
- Alternate paths: none found (no email, no push notice, no CLI command for status).
- Gap marks in steps: 2

#### STORY-086: Last drive deleted, then the owner returns to the console

- Type: medium
- Persona: Jonas, deletes his only drive, then wants a fresh start with a new agent.
- Goal: Recreate a workspace after deleting the last drive.
- Ideal path: 3 — delete, create new drive, connect agent.
- Alternate paths: A new drive can also come from the agent's `login` flow.
- Gap marks in steps: 1

#### STORY-087: Settings page on a phone, second session, and signed-out access

- Type: short
- Persona: Aisha, checking the audit log from her phone while travelling.
- Goal: Read audit rows on a narrow screen and handle an expired session.
- Ideal path: 2 — open `/console/settings`, read.
- Alternate paths: none found.
- Gap marks in steps: 1

### Agent CLI/MCP daily use and edge cases

Full steps: `topics/agent-daily-use.md`

#### STORY-088: First save of a handoff note with the default drive

- Type: short
- Persona: An agent named "trace-bot" on a laptop that already passed `login` and `check ok`.
- Goal: Write /work/triage/handoff.md.
- Ideal path: 1 — a single put command with no drive argument.
- Alternate paths: MCP `put` with `text`; `sync` of a directory.

#### STORY-089: Two agents edit the same file and one loses the race

- Type: medium; duplicate of STORY-052
- Persona: notes-bot and trace-bot both update /memory/decisions.md.
- Goal: Update without clobbering the other agent's change.
- Ideal path: 3 — read with version, merge, write with guard.
- Alternate paths: MCP `put` with `ifVersionId`; `agent-drive versions` to see the history.

#### STORY-090: Restricted agent writes outside its allowed folder

- Type: medium; duplicate of STORY-059
- Persona: intake-bot, issued a key with `--write-path /inbox/intake-bot`, saving a scraped export.
- Goal: Save /inbox/vendor/2026-11-05.jsonl, then recover.
- Ideal path: 2 — the error names the allowed folder, retry under it.
- Alternate paths: Ask the owner to re-approve with a wider folder on `/connect`; `whoami` shows `writePaths`.

#### STORY-091: Read-only agent attempts a write or share

- Type: short; duplicate of STORY-060
- Persona: audit-bot with scopes `read` only.
- Goal: Upload a summary; then share a link.
- Ideal path: 1 — fail fast and tell the human what is missing.
- Alternate paths: none found.

#### STORY-092: Reading a binary or large file

- Type: short
- Persona: An agent fetching /outputs/report.pdf and a 3 MB log.
- Goal: Get the bytes onto local disk.
- Ideal path: 1 — one command that writes a file.
- Alternate paths: MCP `get` with `outputPath` (main) or the `download` tool (fix/mcp-defaults).

#### STORY-093: Reorganising paths with mv and cp

- Type: medium
- Persona: An agent tidying /work/triage after a task.
- Goal: Move final files to /outputs and keep a copy of an old version.
- Ideal path: 2 — one command per file, no folders to create.
- Alternate paths: MCP `move` and `copy`.
- Gap marks in steps: 1

#### STORY-094: Sync a working directory, then hit a remote conflict

- Type: long
- Persona: An agent syncing ./out/ to /outputs/run-42 before its sandbox ends; later a second agent edits one file.
- Goal: Keep the remote copy current without overwriting someone else's edits.
- Ideal path: 1 — one command.
- Alternate paths: `backup` for one-way uploads that always overwrite; CLI `put` per file.
- Gap marks in steps: 1

#### STORY-095: Back up a workspace with a dry run first

- Type: medium
- Persona: An agent about to lose its container; the human said "back up everything but be careful".
- Goal: Preview, then upload ./workdir.
- Ideal path: 2 — dry run, then real run.
- Alternate paths: `sync` (conflict-checked) instead of backup (overwrites by design).

#### STORY-096: Using the MCP tools from an editor agent

- Type: long
- Persona: A coding assistant in Cursor connected with `agent-drive mcp` (stdio), keys in the environment.
- Goal: Read prior decisions, write a result, wait for a teammate agent's change.
- Ideal path: 3 — list, get, put; drive should not need to be restated.
- Alternate paths: CLI equivalents; login, grant, credentials, sync, backup, check, share list and revoke are not exposed over MCP.

#### STORY-097: Installing the skill on a fresh machine

- Type: short
- Persona: An agent in a clean container with neither ~/.claude nor ~/.codex.
- Goal: Get the SKILL.md in place so future sessions use the drive proactively.
- Ideal path: 1 — one command.
- Alternate paths: Copy the file by hand from the path printed.

## Cloud-drive expectations vs. today

What a Dropbox or Google Drive user expects, what the console does today, and the stories that mark it "(gap)". This feeds the dashboard redesign. Most items are CLI/MCP-only features, not missing capabilities of the product.

| Dropbox habit                                                              | Today in the console                                                                                                                 | Stories                    | Where it exists today                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------- |
| Folders, folder navigation, breadcrumbs                                    | One flat table of full paths; topbar crumb is "Workspace / Files"                                                                    | 019, 017, 018              | CLI `ls --prefix`, MCP `list`                                 |
| Upload from the browser, drag and drop, "+ New"                            | No upload; "+ New drive" sits where Upload would be; no hint that uploads are CLI-only                                               | 020, 024                   | CLI `put`, `sync`, `backup`; MCP `put`                        |
| Preview or thumbnail before download                                       | Download only; Versions dialog shows metadata, no content                                                                            | 021, 050                   | CLI `get` (text prints)                                       |
| Recents / activity feed                                                    | None in the console                                                                                                                  | 022, 038, 080, 081         | CLI `recent`, MCP `recent`; audit log shows action names only |
| Sharing from the file row                                                  | No Share action, no shares page                                                                                                      | 046, 045, 047              | CLI/MCP `share`; list and revoke CLI only                     |
| Search (server-side, by tag, author, date)                                 | "Filter loaded files" matches path text on already-loaded rows only; does not match AUTHOR; no content search (content is encrypted) | 017, 038, 033              | CLI/MCP `search`, `ls` filters                                |
| Sort by name, size, modified                                               | Column headers are not clickable                                                                                                     | 038, 017                   | None                                                          |
| Rename, move, copy                                                         | No console control                                                                                                                   | 093                        | CLI/MCP `mv`, `cp`; no prefix move                            |
| Multi-select, bulk restore or delete, download all / zip                   | One row at a time                                                                                                                    | 054, 032                   | None                                                          |
| Open a file without a key step                                             | Download disabled until the drive key is pasted each session; key lost on reload; no "forget all"                                    | 025, 026, 027, 028         | CLI uses stored key                                           |
| Deep links to a tab, drive or file; return to where you were after sign-in | Tab and drive are client state; sign-in returns to Files                                                                             | 002, 005, 079, 087         | `/connect` only                                               |
| Trash that can be listed and bulk-restored                                 | Trash tab exists; `ls` cannot list trash; delete has no confirmation                                                                 | 048, 051, 054              | Trash tab                                                     |
| Version preview and compare                                                | Metadata only                                                                                                                        | 050                        | None                                                          |
| Account area: sign out, switch account, close account                      | Sign-out via Clerk UserButton only; no pointer to deletion from Billing                                                              | 007, 006, 084              | Settings                                                      |
| Notifications (email on deletion done, cap reached)                        | Only spend alert email; no in-app cap indicator, no deletion completion notice                                                       | 076, 085                   | None                                                          |
| Rename/describe agents and drives                                          | Not possible                                                                                                                         | 054, 083 (duplicate names) | None                                                          |
| Mobile-friendly console                                                    | Sidebar collapses behind a toggle; only the settings page checked                                                                    | 087                        | n/a                                                           |

## Redundancy Candidates

Input for `/ux-flow`. Built from the stories' Alternate paths and multi-surface notes.

### Duplicate paths (same goal, multiple routes)

- Sign up: landing "Sign in", landing "Console", pricing "Start with Free", direct `/sign-up`, and the `/connect` bounce all end at a Clerk form; the landing page has no "Sign up" button. Same result via different doors. (001, 006, 010)
- Getting a first drive: console "Create your first drive", sidebar "Connect an agent" button, Agents-tab panel, `/connect` approval creating a drive, API keys tab "Create API key". Different outcomes (some produce a drive key, some do not). (003, 009, 024, 063)
- Connect an agent: pasted llms.txt line, npm install then `login`, console-first `login --token-stdin`, device flow with `/connect`. Divergent: the token route leaves the agent without the drive key. (009, 064)
- Giving a second agent access: browser "Add to an existing drive", `grant`, `credentials issue`. Three routes with different human involvement and different secrets. (056, 057, 058)
- Restore a file: Trash tab Restore, Versions dialog "Restore this version", CLI/MCP `restore`. Same result; the console has two surfaces for it. (049, 050, 051)
- Delete a file: console Trash button (no confirmation), CLI `rm`, MCP `delete`. (048, 051)
- Revoke access: API keys tab per-key Revoke, Agents tab "Revoke access" (all keys), CLI `key revoke`. Different scope, same screen family. (062, 066)
- Find a file: console filter, CLI `ls --prefix`, CLI `search`, MCP `list`, MCP `search`. Overlapping capability, different coverage (loaded rows vs whole drive). (017, 033, 038, 040)
- See what changed: CLI/MCP `recent`, `ls --agent`, audit log, Usage by author. Four partial answers to one question. (022, 039, 040, 080)
- Load the drive key in the console: paste text, choose a `.key.json` recovery file, choose an `adcred1.` bundle; the file choice does not submit. (025, 026)
- Back up the drive key: `credentials export --to`, `--stdout | store && confirm`, `AGENT_DRIVE_CREDENTIALS`, console "Download recovery file". (014, 029, 030)
- Billing details: Usage tab, `/console/billing`, pricing page. Plan upgrades from pricing "Choose Developer" and from billing plan cards reach the same checkout. (072, 074)
- Create a share: CLI `share` and MCP `share`; list and revoke only on the CLI. (041, 045, 047)
- Sync versus backup: `sync` (conflict-checked, two-way intent) versus `backup` (always overwrites); `put` per file is a third. (094, 095)
- Conflict-aware write: `--if-version` versus `--overwrite` (mutually exclusive) versus `sync`'s own handling. (052, 089, 094)

### Duplicate information (same fact, multiple surfaces)

- Storage used versus plan allowance: Usage tab (no allowance) and Billing (with allowance, "5.0 GiB included"); Pricing lists the limits again. (072, 077)
- Usage by agent/author: Usage tab "Usage by author" and Billing "usage by agent" with statement selector. (039, 072, 078)
- File metadata (path, size, author, modified): Files table, Trash table, Versions dialog, CLI `ls`, `search` and `recent`. (017, 049, 050)
- Drive ID: shown with a copy button on every drive view; also on the receipt, in recovery file names and in the `/connect` page. (024, 030, 083)
- Key backup state: red banner on the Files tab, info line after confirmation, `check` output, receipt checkbox. (029, 030)
- "Sign in" and "Console" links appear in the landing nav and footer and both reach sign-in when signed out. (001)
- Agent instruction line and install command: landing hero, console Agents panel, llms.txt, SKILL.md; the empty Files state button "Connect an agent" jumps elsewhere. (003, 009, 097)
- Scopes and drives of an agent: API keys list, Agents tab "N active keys", `whoami`, `/connect` "Requested" row. Write paths are not shown in the keys list. (068, 090)
- "Issued by": API keys list and Agents tab both show it. (068)
- Account email: `/connect` Account row and the Clerk UserButton; console has no account row in test mode. (006, 007)
- Audit events versus file history: the audit log records action names, Trash and Versions record file events, `recent` records file events again. (081)
- Deletion status: Deletion requests list and its Refresh; API keys of a deleted drive remain listed. (085, 086)

### Overlapping features/tools

- Console Files filter and CLI/MCP `search`: both find files by text; the filter is smaller (loaded rows, path only). Keep both only if the console gets real search. (017, 033, 038)
- `recent`, audit log, Usage by author, Trash DELETED column: all answer "what happened", none answer all of it. Candidate for one Activity view. (022, 039, 080, 081)
- Agents tab and API keys tab: agent identity and keys are managed in two tabs with overlapping revoke actions; "Create your first agent" then "Create API key" is a two-tab flow for one goal. Candidate to merge. (063, 064, 066, 068)
- Console key actions and `/connect` "Add to an existing drive": both move a drive key to an agent; the console has no equivalent that does both key and access. (056, 064)
- `grant` and `credentials issue`: both hand access from one agent to another; grant needs a browser approval, issue does not. Distinct enough to keep, but the choice is not explained. (057, 058)
- `sync` and `backup`: overlapping upload intent with different conflict rules. (094, 095)
- Trash tab and Versions dialog: both restore; Versions is reachable from Files and from Trash. (049, 050)
- Settings "Activity & deletion" combines an audit log with destructive account actions; Billing links to it for neither. Two unrelated jobs on one page. (080, 084)
- MCP versus CLI: MCP lacks login, grant, credentials, sync, backup, check, share list and revoke. Two surfaces with different capability sets. (096, 047)
- Pricing page and Billing plan cards: same plans rendered twice. (073, 074)

## Gaps & Recommendations

Not covered by any story:

- `/api/oauth/*`: no user path found in discovery. Confirm whether it is dead code.
- `/api/test-session`, cron maintenance, Stripe webhook, operator CLIs: operator-facing, deliberately out of scope.
- Landing "Connect trace-bot?" mock card: static; no step.
- "The request changed; review it again" race on `/connect`: edge case, no story.
- Console sidebar toggle on narrow screens: only the settings page is covered by a phone story.
- Rename, move or copy from the console: documented only as absent; no story drives a real attempt.
- Tags and descriptions in the console: not displayed anywhere, so no console story.

Suggested additional stories:

- Human renames or moves a file (expecting Dropbox behaviour) and discovers the CLI-only route.
- Console narrow-screen walk across Files, Agents, API keys, Usage, Trash.
- Two-tab flow: owner approves `/connect` while a console tab is open on another account.
- A fresh-machine restore walk: new laptop, login, add to existing drive, download a file in the console.

Notes on story quality: several stories are written as "(gap)" titles (STORY-019 to STORY-022) because the console lacks the feature. Walkers should treat them as expectation checks, not pass/fail flows.

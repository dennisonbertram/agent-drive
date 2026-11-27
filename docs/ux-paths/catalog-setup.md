# Catalog: Agent Drive first-time setup flow (SETUP-001 to SETUP-068)

Source: Phase 3 consolidation of `docs/ux-paths/discovery-setup.md` and the eight `docs/ux-paths/topics/setup-*.md` files, worktree `/Users/dennison/develop/agent-drive-ux-setup`, branch `ux/setup-flow-review-nov27`. All stories were written from code and docs; nothing in them has been run in a browser or terminal. This file does not replace `docs/ux-paths/catalog.md` (the Nov 6 catalog).

Contents: 1 Summary, 2 ID mapping, 3 Duplicates and cross-references, 4 Dependency graph, 5 Coverage matrix, 6 Gaps, 7 Redundancy Candidates, 8 Copy contradictions, 9 Stories by topic.

## 1. Summary

- Stories: 68 written, 61 after dedupe (7 stories are duplicates of another story and are kept in full, marked `Duplicate of`).
- Setup features in `discovery-setup.md` tracked in the coverage matrix: 78. Fully covered 66, partly covered 8, not covered 4. Coverage counting partial as covered: 95%. Full coverage only: 85%.

### By type

| Type | Stories | Share |
|---|---|---|
| short | 21 | 31% |
| medium | 31 | 46% |
| long | 16 | 24% |
| Total | 68 | 100% |

### By surface

Surface is normalized from each story's `Surface` line: `web` (browser only, including OpenRouter's own site), `CLI` (terminal only), `Finder` (Finder alone; no story is Finder-only because every Finder story also runs the CLI), `mixed` (more than one of web, CLI, Finder).

| Surface | Stories | short | medium | long |
|---|---|---|---|---|
| web | 22 | 10 | 9 | 3 |
| CLI | 11 | 6 | 4 | 1 |
| Finder | 0 | 0 | 0 | 0 |
| mixed | 35 | 5 | 18 | 12 |
| Total | 68 | 21 | 31 | 16 |

Stories that involve the Finder app (all counted as mixed): 4 (SETUP-051, SETUP-052, SETUP-055, SETUP-057).

### By topic

| Topic | IDs | Stories | short | medium | long | web | CLI | mixed |
|---|---|---|---|---|---|---|---|---|
| Land, evaluate and sign up | SETUP-001 to SETUP-008 | 8 | 4 | 3 | 1 | 7 | 0 | 1 |
| Agent-first install and login | SETUP-009 to SETUP-015 | 7 | 2 | 3 | 2 | 1 | 0 | 6 |
| Approve on /connect | SETUP-016 to SETUP-025 | 10 | 3 | 5 | 2 | 2 | 0 | 8 |
| Back up, check, first file, skill | SETUP-026 to SETUP-033 | 8 | 2 | 4 | 2 | 0 | 6 | 2 |
| Owner keys in the console | SETUP-034 to SETUP-042 | 9 | 3 | 4 | 2 | 3 | 0 | 6 |
| Second agent and sandbox continuity | SETUP-043 to SETUP-050 | 8 | 2 | 4 | 2 | 1 | 1 | 6 |
| Desktop mounts | SETUP-051 to SETUP-058 | 8 | 3 | 3 | 2 | 0 | 4 | 4 |
| OpenRouter webhook and trace capture | SETUP-059 to SETUP-068 | 10 | 2 | 5 | 3 | 8 | 0 | 2 |

## 2. ID mapping (temporary ID to catalog ID)

| Catalog ID | Temporary ID | Type | Surface | Title |
|---|---|---|---|---|
| SETUP-001 | STORY-LAND-SIGNUP-01 | short | web | Hand the setup line to Claude Code from the landing page |
| SETUP-002 | STORY-LAND-SIGNUP-02 | short | web | Compare plans and pick Free from the pricing page |
| SETUP-003 | STORY-LAND-SIGNUP-03 | medium | web | First sign-up with Clerk and arrival at an empty console |
| SETUP-004 | STORY-LAND-SIGNUP-04 | medium | web | The "Set up a drive myself" detour from the empty console |
| SETUP-005 | STORY-LAND-SIGNUP-05 | short | web | Console cannot load the workspace on first visit |
| SETUP-006 | STORY-LAND-SIGNUP-06 | long | mixed | Agent-driven setup where the human has no account yet |
| SETUP-007 | STORY-LAND-SIGNUP-07 | medium | web | Evaluate before committing (docs, compare, FAQ, llms.txt) |
| SETUP-008 | STORY-LAND-SIGNUP-08 | short | web | Visiting a deployment where sign-in is not configured |
| SETUP-009 | STORY-INSTALL-LOGIN-01 | long | mixed | Pasting the llms.txt line into a local agent, happy path for an existing account |
| SETUP-010 | STORY-INSTALL-LOGIN-02 | long | mixed | Brand-new user follows the CLI link while signed out and lands on the sign-in form |
| SETUP-011 | STORY-INSTALL-LOGIN-03 | medium | mixed | Sandbox agent with no global installs uses npx and `--no-browser` |
| SETUP-012 | STORY-INSTALL-LOGIN-04 | medium | mixed | The login code expires, and the user runs login again |
| SETUP-013 | STORY-INSTALL-LOGIN-05 | short | mixed | Typing the verification code wrong, and the approve that never shows a Deny |
| SETUP-014 | STORY-INSTALL-LOGIN-06 | short | web | Reading llms.txt directly in a browser and trying the old tarball |
| SETUP-015 | STORY-INSTALL-LOGIN-07 | medium | mixed | Human-first alternative: console API key and `login --token-stdin` |
| SETUP-016 | STORY-APPROVE-CONNECT-01 | short | mixed | First approval, everything matches (happy path) |
| SETUP-017 | STORY-APPROVE-CONNECT-02 | short | mixed | Code entered by hand on a bare /connect (agent on another machine) |
| SETUP-018 | STORY-APPROVE-CONNECT-03 | long | mixed | Brand-new user arrives from the CLI link and is signed out |
| SETUP-019 | STORY-APPROVE-CONNECT-04 | medium | mixed | Wrong and malformed verification codes |
| SETUP-020 | STORY-APPROVE-CONNECT-05 | short | web | The code does not match the terminal, and there is no Deny button |
| SETUP-021 | STORY-APPROVE-CONNECT-06 | medium | mixed | Reconnect an agent that was approved before |
| SETUP-022 | STORY-APPROVE-CONNECT-07 | long | mixed | Use one of my drives instead (recovery file handoff) |
| SETUP-023 | STORY-APPROVE-CONNECT-08 | medium | mixed | Delegate checkbox for an orchestrator agent |
| SETUP-024 | STORY-APPROVE-CONNECT-09 | medium | mixed | Code expired, already used, or rate limited |
| SETUP-025 | STORY-APPROVE-CONNECT-10 | medium | web | Approving while signed in to the wrong account |
| SETUP-026 | STORY-BACKUP-FIRST-FILE-01 | short | CLI | Back up by clipboard and confirm in Apple Passwords |
| SETUP-027 | STORY-BACKUP-FIRST-FILE-02 | short | CLI | Run `check` before any backup |
| SETUP-028 | STORY-BACKUP-FIRST-FILE-03 | medium | CLI | 1Password is not signed in, fall back to a file |
| SETUP-029 | STORY-BACKUP-FIRST-FILE-04 | medium | mixed | First put, get, compare and share |
| SETUP-030 | STORY-BACKUP-FIRST-FILE-05 | medium | CLI | Read-only agent runs `check` on an empty drive |
| SETUP-031 | STORY-BACKUP-FIRST-FILE-06 | medium | CLI | Install the skill where no agent folder exists |
| SETUP-032 | STORY-BACKUP-FIRST-FILE-07 | long | mixed | Finish setup end to end and watch the console chip change |
| SETUP-033 | STORY-BACKUP-FIRST-FILE-08 | long | CLI | Keep a drive across disposable CI sandboxes |
| SETUP-034 | STORY-OWNER-KEYS-01 | medium | mixed | Maya creates her own drive in the browser and saves the recovery file |
| SETUP-035 | STORY-OWNER-KEYS-02 | long | mixed | Priya finishes agent setup, sets a passphrase, and enters the fingerprint so her agent can seal the drive |
| SETUP-036 | STORY-OWNER-KEYS-03 | short | mixed | Dev copies the fingerprint with a trailing comma |
| SETUP-037 | STORY-OWNER-KEYS-04 | medium | web | Tomás adds a passkey and unlocks on a second laptop |
| SETUP-038 | STORY-OWNER-KEYS-05 | long | mixed | Dana forgets her passphrase, resets it, and re-pins her agent |
| SETUP-039 | STORY-OWNER-KEYS-06 | short | mixed | Ken lost his recovery file but the agent still has the key |
| SETUP-040 | STORY-OWNER-KEYS-07 | medium | mixed | Lena keeps a client drive out of passphrase unlock |
| SETUP-041 | STORY-OWNER-KEYS-08 | short | web | Passphrase setup interrupted by the Clerk confirmation prompt |
| SETUP-042 | STORY-OWNER-KEYS-09 | medium | web | Jo uses a coworking Mac and wants nothing left behind |
| SETUP-043 | STORY-SECOND-AGENT-SANDBOX-01 | medium | mixed | Hand a drive to a second laptop agent with grant --verify |
| SETUP-044 | STORY-SECOND-AGENT-SANDBOX-02 | long | mixed | Persist an agent into a CI sandbox with credentials issue |
| SETUP-045 | STORY-SECOND-AGENT-SANDBOX-03 | short | web | Revoke a leaked sandbox key |
| SETUP-046 | STORY-SECOND-AGENT-SANDBOX-04 | medium | mixed | Add a second agent using the recovery file on /connect |
| SETUP-047 | STORY-SECOND-AGENT-SANDBOX-05 | long | mixed | Manual Agents and API keys path from the console |
| SETUP-048 | STORY-SECOND-AGENT-SANDBOX-06 | medium | mixed | Codex agent cannot write because MCP approval is "never" |
| SETUP-049 | STORY-SECOND-AGENT-SANDBOX-07 | short | CLI | Sandbox with a read-only credentials bundle and an empty drive |
| SETUP-050 | STORY-SECOND-AGENT-SANDBOX-08 | medium | mixed | Agent loses delegate and the owner re-approves |
| SETUP-051 | STORY-DESKTOP-MOUNTS-01 | long | mixed | Mount a drive in Finder for the first time |
| SETUP-052 | STORY-DESKTOP-MOUNTS-02 | medium | mixed | Finder shows "Agent Drive is not enabled" |
| SETUP-053 | STORY-DESKTOP-MOUNTS-03 | medium | CLI | Mount a drive on a Linux server with FUSE |
| SETUP-054 | STORY-DESKTOP-MOUNTS-04 | short | CLI | Windows user tries to mount |
| SETUP-055 | STORY-DESKTOP-MOUNTS-05 | long | mixed | Connect a live Instabox workspace and keep it across logins |
| SETUP-056 | STORY-DESKTOP-MOUNTS-06 | short | CLI | Instabox CLI is missing |
| SETUP-057 | STORY-DESKTOP-MOUNTS-07 | medium | mixed | Sandbox is asleep and wake is off |
| SETUP-058 | STORY-DESKTOP-MOUNTS-08 | short | CLI | Forget and clean up a mount |
| SETUP-059 | STORY-WEBHOOK-CAPTURE-01 | medium | web | Add the first webhook on an unlocked drive with a loaded key |
| SETUP-060 | STORY-WEBHOOK-CAPTURE-02 | long | web | Click Add webhook on a locked drive, unlock, and resume |
| SETUP-061 | STORY-WEBHOOK-CAPTURE-03 | long | web | Agent-only drive: recovery file needed, mismatched file chosen |
| SETUP-062 | STORY-WEBHOOK-CAPTURE-04 | medium | mixed | Empty new drive with a pasted key |
| SETUP-063 | STORY-WEBHOOK-CAPTURE-05 | short | web | Cancel Clerk reverification, then retry |
| SETUP-064 | STORY-WEBHOOK-CAPTURE-06 | medium | web | Save the token for later, lose it, then Replace |
| SETUP-065 | STORY-WEBHOOK-CAPTURE-07 | medium | web | Stale token ("Needs replacement") after the inbox changed |
| SETUP-066 | STORY-WEBHOOK-CAPTURE-08 | short | web | Revoke a webhook, with confirm and cancel |
| SETUP-067 | STORY-WEBHOOK-CAPTURE-09 | medium | mixed | Local capture with the CLI instead of OpenRouter |
| SETUP-068 | STORY-WEBHOOK-CAPTURE-10 | long | web | Key from another tab wins (409 race) and traces folder empty state |

The same new IDs are now written inside each `docs/ux-paths/topics/setup-*.md` file. Short in-text references such as "story 03" or "see 02" were left as written; each topic file now has a note under its title that maps them.

## 3. Duplicates and cross-references

### Duplicates (kept in full, marked in section 9)

| Duplicate | Duplicate of | Why |
|---|---|---|
| SETUP-013 | SETUP-019, SETUP-020 | The wrong-verification-code and no-Deny scenarios are written in full in the approve topic. |
| SETUP-012 | SETUP-024 | Same expired-code recovery; the approve-topic story also covers used and rate-limited codes. |
| SETUP-018 | SETUP-010 | Same signed-out new user bounced to sign-in and back to /connect (three tellings of one journey). |
| SETUP-006 | SETUP-010 | Same signed-out new user bounced to sign-in and back to /connect. |
| SETUP-046 | SETUP-022 | Same recovery-file handoff on /connect to give a new agent an existing drive. |
| SETUP-004 | SETUP-034 | Same human-first New drive and recovery-file save, written in more depth in the owner-keys topic. |
| SETUP-049 | SETUP-030 | Same read-only `check` on an empty drive. |

Canonical stories are the ones a walker should run first; the duplicate adds persona or wording variants only.

### Cross-references (stories that share steps or features)

| Story | Overlaps with |
|---|---|
| SETUP-001 | SETUP-009, SETUP-014 |
| SETUP-002 | SETUP-007 |
| SETUP-003 | SETUP-018, SETUP-004 |
| SETUP-007 | SETUP-002, SETUP-014 |
| SETUP-008 | SETUP-003 |
| SETUP-009 | SETUP-016, SETUP-001, SETUP-032, SETUP-017 |
| SETUP-010 | SETUP-018, SETUP-006, SETUP-003 |
| SETUP-011 | SETUP-009, SETUP-017, SETUP-015 |
| SETUP-012 | SETUP-024 |
| SETUP-013 | SETUP-019, SETUP-020 |
| SETUP-014 | SETUP-007, SETUP-001 |
| SETUP-015 | SETUP-047 |
| SETUP-016 | SETUP-009, SETUP-017 |
| SETUP-017 | SETUP-011, SETUP-024 |
| SETUP-018 | SETUP-010, SETUP-006 |
| SETUP-019 | SETUP-013, SETUP-036 |
| SETUP-020 | SETUP-013 |
| SETUP-021 | SETUP-012 |
| SETUP-022 | SETUP-046, SETUP-030 |
| SETUP-023 | SETUP-050, SETUP-044 |
| SETUP-024 | SETUP-012, SETUP-017 |
| SETUP-026 | SETUP-028, SETUP-039 |
| SETUP-027 | SETUP-030, SETUP-049 |
| SETUP-028 | SETUP-026 |
| SETUP-029 | SETUP-016 |
| SETUP-030 | SETUP-027, SETUP-049 |
| SETUP-032 | SETUP-009, SETUP-035, SETUP-016 |
| SETUP-033 | SETUP-044 |
| SETUP-034 | SETUP-004, SETUP-022 |
| SETUP-035 | SETUP-036, SETUP-032 |
| SETUP-036 | SETUP-035 |
| SETUP-037 | SETUP-042 |
| SETUP-038 | SETUP-035, SETUP-039 |
| SETUP-039 | SETUP-035, SETUP-026, SETUP-061 |
| SETUP-040 | SETUP-034, SETUP-061 |
| SETUP-041 | SETUP-063, SETUP-035 |
| SETUP-042 | SETUP-037 |
| SETUP-043 | SETUP-046, SETUP-023, SETUP-022 |
| SETUP-044 | SETUP-033, SETUP-043, SETUP-023 |
| SETUP-045 | SETUP-047 |
| SETUP-046 | SETUP-022, SETUP-043 |
| SETUP-047 | SETUP-015, SETUP-044 |
| SETUP-049 | SETUP-030, SETUP-027 |
| SETUP-050 | SETUP-023, SETUP-044 |
| SETUP-051 | SETUP-052, SETUP-053 |
| SETUP-052 | SETUP-051 |
| SETUP-053 | SETUP-051, SETUP-054 |
| SETUP-054 | SETUP-053 |
| SETUP-055 | SETUP-056, SETUP-057, SETUP-058 |
| SETUP-056 | SETUP-055 |
| SETUP-057 | SETUP-055, SETUP-056 |
| SETUP-058 | SETUP-055 |
| SETUP-059 | SETUP-060, SETUP-067 |
| SETUP-060 | SETUP-059, SETUP-037, SETUP-039 |
| SETUP-061 | SETUP-060, SETUP-039, SETUP-040 |
| SETUP-062 | SETUP-059, SETUP-067 |
| SETUP-063 | SETUP-041 |
| SETUP-064 | SETUP-065, SETUP-066 |
| SETUP-065 | SETUP-064, SETUP-066 |
| SETUP-066 | SETUP-064 |
| SETUP-067 | SETUP-059, SETUP-062 |
| SETUP-068 | SETUP-059, SETUP-063 |

## 4. Dependency graph

Read as "must have happened first". Entries at the same depth under one parent are independent. Starred entries are optional for the main path.

```
SETUP-007 evaluate the product (optional, no account needed)
SETUP-008 sign-in not configured (dead end on a deployment without Clerk)
Account exists (SETUP-003 first sign-up, or SETUP-010 sign-up in the middle of the CLI flow)
|-- SETUP-005 console fails to load on first visit (recovery only)
|-- SETUP-002 pricing and Free plan (optional)
|-- SETUP-001 hand the setup line to an agent
|    +-- SETUP-011 npx and --no-browser variant (no global install)
|    +-- SETUP-009 install llms.txt line, login (existing account)
|         |-- SETUP-014 read llms.txt first (optional)
|         |-- SETUP-010 new user bounced to sign-in, signs up, returns to /connect
|         |-- SETUP-016 approve on /connect (everything matches)
|         |    |-- SETUP-017 bare /connect and typed code (agent on another machine)
|         |    |-- SETUP-019 wrong or malformed verification code
|         |    |-- SETUP-020 no Deny control
|         |    |-- SETUP-024 expired, used, rate-limited code
|         |    |-- SETUP-025 wrong account
|         |    |-- SETUP-021 reconnect an agent approved before
|         |    |-- SETUP-022 use one of my drives (recovery file)
|         |    +-- SETUP-023 delegate checkbox
|         +-- logged in, drive exists
|              |-- SETUP-026 back up by clipboard
|              |-- SETUP-028 1Password fails, fall back to file
|              |-- SETUP-027 check (before and after backup)
|              |    +-- SETUP-030 read-only check on empty drive
|              |-- SETUP-031 skill install
|              |-- SETUP-029 first put, get, share   (needs backup and check)
|              |-- SETUP-032 full setup end to end (joins all of the above)
|              |-- Owner opens drive in console
|              |    |-- SETUP-035 passphrase, fingerprint, account seal
|              |    |    |-- SETUP-036 fingerprint with a trailing comma
|              |    |    |-- SETUP-037 passkey and second laptop
|              |    |    |-- SETUP-038 forgot passphrase, reset, re-pin
|              |    |    +-- SETUP-042 shared computer, nothing left behind
|              |    |-- SETUP-039 lost recovery file, agent still has key
|              |    +-- SETUP-041 Clerk confirmation interrupts passphrase setup
|              |-- Add another agent (needs an agent with delegate, or the recovery file)
|              |    |-- SETUP-043 grant --verify
|              |    |-- SETUP-044 credentials issue into a CI sandbox
|              |    |-- SETUP-033 keep a drive across disposable CI sandboxes
|              |    |-- SETUP-050 agent loses delegate, owner re-approves
|              |    |-- SETUP-048 Codex MCP approval "never"
|              |    +-- SETUP-045 revoke a leaked key (needs a key to exist)
|              |-- SETUP-015 console API key and login --token-stdin  (human-first; no device flow)
|              |    +-- SETUP-047 manual Agents and API keys path
|              |-- SETUP-051 Finder mount (needs login and CLI)
|              |    +-- SETUP-052 "Agent Drive is not enabled"
|              |-- SETUP-053 Linux FUSE mount (needs login)
|              |-- SETUP-054 Windows attempt (error path)
|              |-- SETUP-055 connect live Instabox workspace (needs Instabox CLI, not Agent Drive login)
|              |    |-- SETUP-056 Instabox CLI missing
|              |    |-- SETUP-057 sandbox asleep, wake off
|              |    +-- SETUP-058 forget and clean up
|              +-- Trace capture (needs a drive and, for the webhook, its key in the tab)
|                   |-- SETUP-067 local capture with the CLI
|                   |-- SETUP-059 first webhook, unlocked drive
|                   |    |-- SETUP-060 locked drive, unlock, resume
|                   |    |-- SETUP-061 agent-only drive, wrong recovery file
|                   |    |-- SETUP-062 empty new drive
|                   |    |-- SETUP-063 cancel reverification, retry
|                   |    |-- SETUP-068 two-tab 409 race
|                   |    +-- SETUP-064 SETUP-065 SETUP-066 token lost, stale, revoke (need an existing webhook)
Human-first (no agent first)
|-- SETUP-004 / SETUP-034 New drive in the browser, save recovery file
|    +-- SETUP-040 agent-only drive
```

## 5. Coverage matrix

Features come from "Setup Feature Map" in `discovery-setup.md`. Status: Covered (a story exercises it as a main step), Partial (only mentioned in steps, variations or edge cases), None (no story).

| Section | Feature | Stories | Status |
|---|---|---|---|
| 1 Landing, sign-up, console | Landing hero "Give this to your agent" panel and Copy prompt / Copy command | SETUP-001, SETUP-009 | Covered |
| 1 Landing, sign-up, console | Landing sections, comparisons, FAQ, footer, Markdown twins | SETUP-007 | Covered |
| 1 Landing, sign-up, console | Pricing page (Free, Developer, Team; Start with Free; Choose plan; Coming soon) | SETUP-002 | Covered |
| 1 Landing, sign-up, console | Paid plan checkout and /console/billing after sign-up | SETUP-002 | Partial |
| 1 Landing, sign-up, console | Clerk sign-up and sign-in pages, redirect_url handling | SETUP-003, SETUP-010, SETUP-018, SETUP-006 | Covered |
| 1 Landing, sign-up, console | Clerk "not configured" panel and dev test auth | SETUP-008 | Covered |
| 1 Landing, sign-up, console | /console unauthenticated redirect that drops the return path | SETUP-002, SETUP-003 | Partial |
| 1 Landing, sign-up, console | Console loading and "Workspace unavailable" / Try again | SETUP-005 | Covered |
| 1 Landing, sign-up, console | Console empty-state onboarding panel "Give your first agent a home." | SETUP-003 | Covered |
| 1 Landing, sign-up, console | Files toolbar "Connect an agent" dialog and Agents-tab Connect panel (MCP snippets) | SETUP-047, SETUP-048 | Covered |
| 1 Landing, sign-up, console | Sidebar tabs Usage, Trash, Activity & deletion | SETUP-003 | Partial |
| 1 Landing, sign-up, console | Passphrase banner on Files ("Set up") | SETUP-035 | Covered |
| 1 Landing, sign-up, console | Human-first New drive dialog and recovery-file receipt (incl. name collision) | SETUP-034, SETUP-004, SETUP-040 | Covered |
| 1 Landing, sign-up, console | Agents tab empty state and "Create your first agent" | SETUP-047, SETUP-004 | Covered |
| 1 Landing, sign-up, console | API keys tab (empty guards, secret shown once, Revoke) | SETUP-047, SETUP-045 | Covered |
| 1 Landing, sign-up, console | Key chip states and menu (Key needed, Locked, Not backed up, fingerprint) | SETUP-032, SETUP-035, SETUP-039, SETUP-042 | Covered |
| 1 Landing, sign-up, console | Passphrase setup form (generated or own, 14 characters) | SETUP-035, SETUP-041 | Covered |
| 1 Landing, sign-up, console | Unlock dialog: passphrase, passkey, recovery file, pasted key | SETUP-037, SETUP-039, SETUP-060, SETUP-061 | Covered |
| 1 Landing, sign-up, console | Change passphrase | - | None |
| 1 Landing, sign-up, console | Reset passphrase ("Forgot or exposed passphrase?") | SETUP-038 | Covered |
| 1 Landing, sign-up, console | Passkey enrollment and unlock | SETUP-037 | Covered |
| 1 Landing, sign-up, console | Lock this browser, sign-out clears stored key | SETUP-042 | Covered |
| 1 Landing, sign-up, console | Settings page: passphrase status, fingerprint, Manage in Files | SETUP-035, SETUP-036 | Covered |
| 2 CLI install, login, approval | npm global install and npx fallback | SETUP-009, SETUP-011 | Covered |
| 2 CLI install, login, approval | Node 24 requirement / no Node version check (failure text) | - | None |
| 2 CLI install, login, approval | Self-host login with --api | SETUP-011, SETUP-047 | Partial |
| 2 CLI install, login, approval | /llms.txt agent script (index, setup, troubleshooting, sandboxes) | SETUP-009, SETUP-014, SETUP-033 | Covered |
| 2 CLI install, login, approval | /cli/agent-drive.tgz legacy tarball | SETUP-014 | Covered |
| 2 CLI install, login, approval | agent-drive login output, polling, --no-browser, name default | SETUP-009, SETUP-011, SETUP-012 | Covered |
| 2 CLI install, login, approval | Login success output and BACKUP_HINT; reconnect output | SETUP-009, SETUP-021 | Covered |
| 2 CLI install, login, approval | login --token-stdin and AGENT_DRIVE_API_KEY | SETUP-015, SETUP-047 | Covered |
| 2 CLI install, login, approval | /connect with no code (bare entry, code format) | SETUP-017 | Covered |
| 2 CLI install, login, approval | /connect review card, Details, new-drive summary | SETUP-016, SETUP-003 | Covered |
| 2 CLI install, login, approval | Verification code gate and its errors | SETUP-019, SETUP-013 | Covered |
| 2 CLI install, login, approval | Existing-drive mode (select drive, key, file, read-only, write path) | SETUP-022, SETUP-046 | Covered |
| 2 CLI install, login, approval | Key and folder validation errors on /connect | SETUP-022 | Covered |
| 2 CLI install, login, approval | Race: "request changed" and agent-offered drive notice | SETUP-043, SETUP-050 | Covered |
| 2 CLI install, login, approval | Expired, used and rate-limited codes | SETUP-024, SETUP-012 | Covered |
| 2 CLI install, login, approval | Session expiry during approval (redirect to /sign-in) | - | None |
| 2 CLI install, login, approval | Approval done page and Open console | SETUP-016 | Covered |
| 2 CLI install, login, approval | Deny / refuse (no Deny control) | SETUP-020, SETUP-013 | Covered |
| 2 CLI install, login, approval | Reconnect an agent approved before | SETUP-021 | Covered |
| 2 CLI install, login, approval | Approve in the wrong account | SETUP-025 | Covered |
| 2 CLI install, login, approval | Delegate checkbox and delegate scope | SETUP-023, SETUP-050 | Covered |
| 2 CLI install, login, approval | grant --verify (Offered by) | SETUP-043 | Covered |
| 2 CLI install, login, approval | credentials issue and AGENT_DRIVE_CREDENTIALS | SETUP-044, SETUP-033 | Covered |
| 2 CLI install, login, approval | Recovery-file handoff on /connect | SETUP-022, SETUP-046 | Covered |
| 2 CLI install, login, approval | Revoke a key (console Revoke, key revoke) | SETUP-045 | Covered |
| 2 CLI install, login, approval | Account-key sealing and fingerprint loop (account seal) | SETUP-035, SETUP-036, SETUP-039 | Covered |
| 2 CLI install, login, approval | Agent-only drives | SETUP-040 | Covered |
| 2 CLI install, login, approval | credentials export targets (1password, clipboard, file, stdout) and confirm | SETUP-026, SETUP-028, SETUP-033 | Covered |
| 2 CLI install, login, approval | credentials import and credentials status (restore on a new machine) | SETUP-027, SETUP-033 | Partial |
| 2 CLI install, login, approval | check outcomes (not backed up, ok, read-only, not verified) | SETUP-027, SETUP-030, SETUP-049 | Covered |
| 2 CLI install, login, approval | First put, get, share | SETUP-029, SETUP-032 | Covered |
| 3 macOS Finder app | Finder app download, install and first launch | SETUP-051 | Covered |
| 3 macOS Finder app | "Agent Drive is not enabled" banner, pluginkit, System Settings | SETUP-052 | Covered |
| 3 macOS Finder app | mount to a Finder location (CLI keeps running, Ctrl+C) | SETUP-051 | Covered |
| 3 macOS Finder app | Finder CLI diagnostics (shared container, disabled extension, registration) | SETUP-052 | Partial |
| 4 connect, mounts, Linux | connect live workspace and --persist | SETUP-055 | Covered |
| 4 connect, mounts, Linux | mounts wake on/off and wake errors | SETUP-057 | Covered |
| 4 connect, mounts, Linux | mounts forget, service remove, status, list | SETUP-058, SETUP-055 | Covered |
| 4 connect, mounts, Linux | Missing Instabox CLI | SETUP-056 | Covered |
| 4 connect, mounts, Linux | Linux FUSE drive mount | SETUP-053 | Covered |
| 4 connect, mounts, Linux | Windows / unsupported platforms | SETUP-054 | Covered |
| 4 connect, mounts, Linux | Sandbox persistence via AGENT_DRIVE_CREDENTIALS and failure table | SETUP-033, SETUP-044 | Covered |
| 4 connect, mounts, Linux | Workspace-service readiness messages | SETUP-055 | Partial |
| 5 MCP and skills | MCP setup for Claude Code, Codex (approval), any client | SETUP-048 | Covered |
| 5 MCP and skills | MCP-only agent with no CLI shell | - | None |
| 5 MCP and skills | skill install (targets, no agent folder) and npx skills add | SETUP-031 | Covered |
| 5 MCP and skills | agent-drive-trace-archive skill | SETUP-031 | Partial |
| 6 OpenRouter webhook, capture | Capture dialog entry points (Capture..., drive menu, /traces empty state) | SETUP-059, SETUP-068 | Covered |
| 6 OpenRouter webhook, capture | Add webhook flow and token shown once | SETUP-059, SETUP-064 | Covered |
| 6 OpenRouter webhook, capture | Add webhook on locked drive (unlock then resume) | SETUP-060 | Covered |
| 6 OpenRouter webhook, capture | Key mismatch and empty-drive errors | SETUP-061, SETUP-062 | Covered |
| 6 OpenRouter webhook, capture | Clerk reverification prompt and cancel | SETUP-063, SETUP-041 | Covered |
| 6 OpenRouter webhook, capture | Replace, stale ("Needs replacement"), Revoke webhook | SETUP-064, SETUP-065, SETUP-066 | Covered |
| 6 OpenRouter webhook, capture | Local agent-drive capture | SETUP-067 | Covered |
| 6 OpenRouter webhook, capture | 409 inbox race and empty traces folder | SETUP-068 | Covered |

Totals: 78 features, 66 covered, 8 partial, 4 none. Coverage (covered plus partial): 95%. Full coverage only: 85%.

Stories per story-count by surface of the product (how many stories touch each setup section): website and console stories 17 (landing and owner keys), CLI and approval 33, desktop mounts 8, webhook capture 10.

## 6. Gaps

### Top 5 story gaps (ranked by how likely a new user is to hit them)

1. **Restore from a backup on a fresh machine.** `credentials import --from PATH`, `credentials status` and `whoami` appear only as alternate paths (SETUP-027, SETUP-033, SETUP-021). No story takes a person who lost their laptop, has only the 1Password item or file, and rebuilds a working agent from it. This is the reason the backup step exists, and nothing tests it.
2. **Install failures and the Node 24 requirement.** No story covers `npm install -g` failing (permissions, offline, Node older than 24) because no code checks the Node version and the failure text is unverified. SETUP-011 covers only a blocked global install, with `npx` as the fix.
3. **Session expiry or sign-out in the middle of approval.** The discovery lists "Session expiry: redirects to /sign-in" on `/connect`. No story checks that the pairing code survives, or what happens when the 10-minute code lapses during sign-in (SETUP-010 and SETUP-024 each touch one half).
4. **Self-hosted login with `--api`.** Only alternates mention it (SETUP-011, SETUP-047). No story checks that `llms.txt` adds ` --api <origin>/api` on a non-public origin, or that the `--api` forms with and without `/api` both work (a copy conflict, see contradiction 44).
5. **Agents that have MCP but no shell, and clients other than Claude Code and Codex.** SETUP-048 covers Codex only. Cursor, opencode, pi and "any MCP client" snippets, and the hosted-assistant limitation the discovery calls unsupported, have no story. The console Codex snippet is already known to lack approval settings.

### Other gaps

- Paid upgrade from setup: only a line in SETUP-002 (signed-out Choose Developer drops the return path). No story completes Stripe checkout or reads the Billing and limits page after sign-up.
- Console tabs Usage, Trash and the Activity and deletion page are never opened in a setup story.
- Change passphrase (a dialog mode in the unlock dialog) has no story; SETUP-038 covers reset only.
- Browser without WebAuthn or a failed passkey prompt: SETUP-037 covers the success path.
- Finder app update, removal, and several drives (the 8-character drive ID suffix in the Finder row name) have no story; SETUP-051 and SETUP-052 cover first install only.
- Workspace-service readiness messages are listed in the discovery but no story reproduces them beyond SETUP-055.
- WSL as a Windows route is called unverified in SETUP-054; no story checks it.
- Clerk's real wording for an unknown email and whether `redirect_url` survives email verification were not verified in any story (SETUP-010, SETUP-018, SETUP-063).
- Instabox install and sign-in: SETUP-056 ends at "not documented"; there is no story for getting Instabox itself working.
- Two-device concurrent use of the same account key (second laptop with a different passphrase state) beyond SETUP-037 and the stale-tab lock in SETUP-038.
- None of the 68 stories has been run. All coverage is on paper until the walkers run them.

## 7. Redundancy Candidates

These come from the `Alternate paths` fields and the multi-surface notes in the topic files. They are candidates for a later simplification pass, not decisions.

### 7.1 Duplicate paths (several ways to reach one outcome)

| Outcome | Paths | Stories |
|---|---|---|
| Start agent setup (the same one-line instruction) | Landing hero `Copy prompt`, landing closing section second `Copy`, console empty-state panel `Copy`, Files `Connect an agent` dialog, Agents tab `Connect an agent` panel, `docs/quickstart.md`, `/index.md` twin, reading `/llms.txt` directly; plus a typed `npm install` on the hero ("or in a terminal:"). | SETUP-001, SETUP-009, SETUP-014, SETUP-003, SETUP-047 |
| Reach the approval page | Click the printed link; open it by hand with `--no-browser`; open bare `/connect` and type the 8-letter code; copy the whole link from an SSH session. | SETUP-016, SETUP-017, SETUP-011 |
| Create an account | Header `Sign up free`, hero, pricing `Start with Free`, landing plan table, closing section, footer, the sign-in page line "New here? Sign up free", Clerk's own switch link, and the quickstart step 1. | SETUP-003, SETUP-010, SETUP-018, SETUP-006, SETUP-002 |
| Create the first drive | The agent creates it at `login`; `agent-drive drive create`; console `New drive` from the onboarding "Set up a drive myself" path; console drive menu `New drive`. | SETUP-034, SETUP-004, SETUP-016 |
| Record a backup | `credentials export` to 1Password, clipboard, a file, or `--stdout` plus `confirm`; the console key menu `Download recovery file` and `I saved it`; setting `AGENT_DRIVE_CREDENTIALS`. | SETUP-026, SETUP-028, SETUP-032, SETUP-033, SETUP-034 |
| Open a drive in the console | Passphrase, passkey, recovery file, pasted key or `adcred1.` bundle, or agent `account seal`. | SETUP-035, SETUP-037, SETUP-039, SETUP-060, SETUP-061 |
| Give a second agent access | `grant --verify`, `credentials issue`, recovery file on `/connect`, re-run `login`, or manual console Agents plus `+ New API key` plus `login --token-stdin` (the last gives no drive key). | SETUP-043, SETUP-044, SETUP-046, SETUP-047, SETUP-022, SETUP-023, SETUP-015 |
| Revoke access | API keys tab `Revoke` versus `agent-drive key revoke`. | SETUP-045 |
| Install the skill | `agent-drive skill install` (with or without `--target`), `npx skills add dennisonbertram/agent-drive` (adds the trace-archive skill too), copying `SKILL.md` by hand, or MCP only. | SETUP-031 |
| Capture traces | Files toolbar `Capture…`, drive menu `Capture traces…`, the `/traces` empty-state link, and, as an alternate route, local `agent-drive capture` instead of the OpenRouter webhook. | SETUP-059, SETUP-067, SETUP-068 |
| Mount a drive | `mount MOUNTPOINT`, `mounts add` then `mount --name`, `mounts service install`; the `connect` command for Instabox workspaces with or without `--persist`. | SETUP-051, SETUP-053, SETUP-055 |
| Stop or remove a mount | Ctrl+C, `mounts forget`, `mounts service remove` (no command named disconnect or unmount for live workspaces). | SETUP-058, SETUP-057 |

### 7.2 Duplicate information (the same fact stated in several places)

| Fact | Where it appears | Stories |
|---|---|---|
| The pairing steps (human types a verification code) | Omitted in `home.ts:8`, `console.tsx:316/2857-2858/2874-2877`, `docs/quickstart.md:35`; present in `/llms.txt`, `docs/connect-an-agent.md:7`, CLI `device.ts:159`, `connect.tsx`. See contradiction 1. | SETUP-001, SETUP-003, SETUP-009, SETUP-016 |
| The setup line `Set up Agent Drive: <origin>/llms.txt` | Landing hero, landing closing, console onboarding, Connect dialog, quickstart, `/index.md`, `/llms.txt`. | SETUP-001, SETUP-047 |
| Backup order "1Password, clipboard, file" | `llms.txt` step 4, quickstart step 4, `docs/backup-and-recovery.md`, `docs/skills.md`, `SKILL.md`, CLI help. | SETUP-026, SETUP-028 |
| Backup state | CLI `BACKUP_HINT`, `credentials status`, `whoami keyBackup`, console chip `Not backed up`, chip menu, `Key backed up <date> (<method>)`. The console and CLI keep separate records. | SETUP-032, SETUP-035, SETUP-027 |
| Account-key fingerprint | Key chip menu, Settings (inside a sentence), CLI error messages, `docs/console.md:103`, `docs/keys-and-recovery.md`. It has the same shape as the login verification code. | SETUP-035, SETUP-036, SETUP-038 |
| Finder app download and enable | `docs/cli.md:20,240`, `native/macos/README.md:9`, `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157`; nothing on the website, console or `/llms.txt`. | SETUP-051, SETUP-052 |
| Codex MCP setup | `docs/mcp-tools.md`, `/llms.txt`, console snippet (the console copy lacks the approval blocks). | SETUP-048 |
| "Free to start" and plan facts | Hero text, pricing cards, landing plan table, billing page. | SETUP-002, SETUP-007 |
| Wake policy | `docs/cli.md:162,176,209`, `cli.ts:1730,1733`. | SETUP-057 |
| Token is shown once | Dialog text and `docs/trace-capture.md:134`; the stale state and Replace text repeat the consequence. | SETUP-059, SETUP-064, SETUP-065 |
| Trace-capture privacy sentence ("OpenRouter sends this trace to our server over TLS...") | Shown under both the Local agents and OpenRouter webhook sections, though it does not apply to local capture. | SETUP-059, SETUP-067 |
| Share link secret in `#k=` | `docs/sharing.md`, quickstart step 6. | SETUP-029 |
| Sandbox persistence steps | `docs/sandboxes.md`, `llms.txt`, `BACKUP_HINT`, quickstart. | SETUP-033, SETUP-044 |

### 7.3 Overlapping features (different features that do nearly the same job)

| Features | Overlap | Stories |
|---|---|---|
| `grant --verify` vs `credentials issue` vs recovery file on `/connect` vs manual API key | All give another agent access. They differ in who needs a browser, who needs `delegate`, and whether the drive key is shared. | SETUP-043, SETUP-044, SETUP-046, SETUP-047 |
| Two meanings of "sandbox" | A disposable machine running an agent (`AGENT_DRIVE_CREDENTIALS`) vs an Instabox workspace mounted on a desktop (`connect`). | SETUP-033, SETUP-044, SETUP-055 |
| Automatic vs manual account seal | The CLI seals in the background after login, drive create, import, MCP start and every 24 hours; `account seal` does the same by hand and is the only way to pin a first fingerprint. | SETUP-035, SETUP-036 |
| Passphrase vs passkey vs recovery file vs pasted key | Four ways to put a drive key in the browser tab. | SETUP-035, SETUP-037, SETUP-039 |
| `Traces` button vs `Capture…` button | Different actions with near-identical names (Traces opens `/traces` Recent; Capture… opens the dialog). | SETUP-059 |
| "Connect an agent" in three places | Onboarding panel, Files dialog, Agents tab panel carry overlapping text with different completeness (npm line, MCP snippets, the "Run the CLI from the repository" sentence). | SETUP-003, SETUP-047, SETUP-048 |
| Two drive-creation entry points in the console | Onboarding "Set up a drive myself" and drive menu `New drive`. | SETUP-004, SETUP-034 |
| Two backup records | Console `key_backup_at` (from `Download recovery file` and the CLI report) vs the CLI config record behind `check`. | SETUP-032, SETUP-034 |
| Mount commands | `mount`, `mounts add`, `connect`, `mounts service install`, `--persist`. | SETUP-051, SETUP-053, SETUP-055 |
| Reverification prompts | Clerk confirmation inside vault actions (friendly text) and inside Capture (raw message). | SETUP-041, SETUP-063 |
| Sign-up and sign-in pages | Same Clerk card; the only route from one to the other for a new user is the small "New here?" line. | SETUP-003, SETUP-010 |

## 8. Copy contradictions

Every cross-surface copy contradiction cited by the topic files. "Cited at" gives the catalog-topic file and line where the topic file states it (after the ID rewrite). "Code or doc" gives the file:line references the topic file uses as evidence. Items are only from the topic files; none was re-checked in the product.

| # | Contradiction | Code or doc evidence | Cited at |
|---|---|---|---|
| 1 | Approval needs a typed verification code, but newcomer-facing copy says only "match the code" or "click Approve". | `apps/web/src/content/home.ts:8`, `apps/web/app/(app)/console/console.tsx:316,2857-2858,2874-2877`, `docs/quickstart.md:35` omit it; `apps/web/app/llms.txt/route.ts:32-34`, `docs/connect-an-agent.md:7`, `packages/agent-drive/src/device.ts:159`, `connect.tsx:~838-845,871` include it. The button is `Approve agent`, not "Approve". | `setup-approve-connect.md:278`; `setup-install-login.md:201`; `setup-land-signup.md:16`; `setup-owner-keys.md:100`; `setup-second-agent-sandbox.md:47` |
| 2 | Quickstart says sign up first; the agent path never does, and `/connect` sends signed-out users to sign-in. | `docs/quickstart.md` step 1 vs `apps/web/app/llms.txt/route.ts` vs `apps/web/app/(app)/connect/page.tsx:19`; `AuthLinks` in `site-header.tsx`. | `setup-land-signup.md:17`; `setup-install-login.md:201` |
| 3 | `/connect` keeps `redirect_url`; `/console` and `/console/billing` drop the return path. | `apps/web/app/(app)/console/page.tsx:11`, `billing/page.tsx:15`, `proxy.ts:18` (`auth.protect()`, not verified at runtime). | `setup-land-signup.md:18` |
| 4 | Paid plan labels differ between landing and `/pricing`, and the disabled-state footer is written for self-hosters. | Landing `page.tsx:405` (`Choose plan`) vs pricing `Choose Developer` / `Choose Team`; `apps/web/src/content/pricing.ts:16`. | `setup-land-signup.md:19` |
| 5 | One job, three names: "Give your first agent a home." / `CONNECT YOUR AGENT`, `Connect an agent`, "Give your agent a drive." | Console onboarding panel, Files toolbar, landing closing section. | `setup-land-signup.md:20` |
| 6 | `docs/agent-login.md` says there is no fingerprint in the recovery-file handoff; the same file and `connect.tsx` require `deviceVerification` on every approval. | `docs/agent-login.md:509-510` vs `docs/agent-login.md:131,155`. | `setup-approve-connect.md:278` |
| 7 | Literal backticks shown around `agent-drive login` in one plain string, rendered as code in another. | `connect.tsx:517` vs `connect.tsx:583`. | `setup-approve-connect.md:278` |
| 8 | "Enter the code in the form XXXX-XXXX." is shown for a correctly shaped code that uses vowels or Y; the page never says only consonants are used. | `connect.tsx:199` vs pattern at `connect.tsx:40`. | `setup-approve-connect.md:278` |
| 9 | "Use one of my drives instead (needs its recovery file)" under-describes the inputs (also a pasted key or `adcred1.` bundle). | `connect.tsx:685`. | `setup-approve-connect.md:278`; `setup-second-agent-sandbox.md:145` |
| 10 | "Close this page; the request expires on its own" while a deny API and CLI message exist. | `connect.tsx:836` vs `apps/web/src/api/device.ts:924` and `packages/agent-drive/src/device.ts:193`. | `setup-approve-connect.md:278`; `setup-install-login.md:139` |
| 11 | Delegate text says "You still approve each new agent here." and the granting agent "cannot pass this permission on", yet the checkbox appears on every request including agent-offered ones. | `connect.tsx:696`. | `setup-approve-connect.md:278`; `setup-approve-connect.md:205` |
| 12 | Site still describes a `/cli/agent-drive.tgz` install; everything else uses npm, and the file is a gitignored build output. | `docs/agent-login.md:24`, `docs/deployment.md:287`, `.gitignore:15`. | `setup-install-login.md:168` |
| 13 | The CLI says to set the passphrase "under Settings"; Settings only shows status and links to Files, where the passphrase is set. | `packages/agent-drive/src/account-seal.ts:30-31` vs `settings-client.tsx:103,141`; banner `console.tsx:2770`. | `setup-owner-keys.md:334`; `setup-install-login.md:201` |
| 14 | Account fingerprint and login "Verification code" have the same `a1b2 c3d4 e5f6 7890` shape but different purposes. | `verification.ts`, `cli.ts:1153`, `account-seal.ts:37-39`. | `setup-owner-keys.md:335` |
| 15 | Fingerprint is "under Settings" in instructions, but also in the key chip menu and inside a sentence with a trailing comma. | `unlock-dialog.tsx:242`, `key-chip.tsx:111`, `settings-client.tsx`. | `setup-owner-keys.md:336`; `setup-owner-keys.md:18` |
| 16 | Docs say the "Keep this browser unlocked" checkbox is used by setup; the setup form has no checkbox, yet setup stores the key anyway. | `vault-forms.tsx:75` (unlock only), `unlock-dialog.tsx:312`, `docs/keys-and-recovery.md`, `vault.ts` `setup`. | `setup-owner-keys.md:337`; `setup-owner-keys.md:17` |
| 17 | Reset is reachable only from the key menu; the stuck-user unlock dialog never links to it. Also "Forgot or exposed passphrase?" appears nowhere else. | `key-chip.tsx:264` vs `vault-forms.tsx:85`. | `setup-owner-keys.md:338`; `setup-owner-keys.md:19` |
| 18 | "Ask the agent that created this drive" is wrong for a drive created in the browser. | `unlock-dialog.tsx:263`. | `setup-owner-keys.md:265` |
| 19 | Passkey wording differs between chip, title and links. | `key-chip.tsx:137`, `console.tsx:4170`, `unlock-dialog.tsx:114,328`. | `setup-owner-keys.md:340` |
| 20 | The idle lock message mentions only the passphrase. | `console.tsx:494`. | `setup-owner-keys.md:341` |
| 21 | The recovery-file error quoted in docs is shorter than the real string. | `docs/backup-and-recovery.md` vs `apps/web/src/console/recovery-file.ts:7-8`. | `setup-owner-keys.md:343` |
| 22 | Agent-only drives have no badge in the drive menu; only the key menu and unlock dialog show it (correction to discovery). | `drive-menu.tsx`. | `setup-owner-keys.md:20` |
| 23 | Skill order: llms.txt makes `skill install` step 5, before `check`, not optional; quickstart lists it as optional step 7, after `check`. | `apps/web/app/llms.txt/route.ts:52` vs `docs/quickstart.md:90`. | `setup-backup-first-file.md:20` |
| 24 | CLI help shows `--drive ID` as if required; code falls back to the single saved drive. | `cli.ts:1721`, `requiredDrive` `cli.ts:273`, `resolveDriveId` `config.ts:34`; quickstart step 6. | `setup-backup-first-file.md:21` |
| 25 | Console backup label shows the raw method: 1Password and `confirm` show "(stdout)". | `console.tsx:929`. | `setup-backup-first-file.md:22` |
| 26 | `BACKUP_HINT` omits the `--stdout | STORE && credentials confirm` route that `docs/sandboxes.md` teaches. | `packages/agent-drive/src/credentials.ts:34` vs `docs/sandboxes.md`. | `setup-backup-first-file.md:13` |
| 27 | Docs say `--stdout` prints only when stdout is not a terminal, but an agent shell is usually not a terminal, so the secret lands in the agent transcript. | `docs/backup-and-recovery.md` vs guard `credentials.ts:318`. | `setup-backup-first-file.md:24` |
| 28 | Clipboard wording: docs say macOS and Windows; CLI help says "a file outside the repo", docs and `BACKUP_HINT` say "outside the sandbox". | CLI help, `docs/backup-and-recovery.md`, `credentials.ts:34`. | `setup-backup-first-file.md:25` |
| 29 | Two skill-install routes (`skill install` and `npx skills add`) are described side by side without guidance, and install to different places. | `docs/skills.md:10`. | `setup-backup-first-file.md:26` |
| 30 | Finder first launch: "open it once" vs "does not open a window". | `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157` vs `docs/cli.md:20`, `native/macos/README.md:9`. | `setup-desktop-mounts.md:47` |
| 31 | Finder failures: CLI errors point to System Settings or Agent Drive.app; docs point to the Finder `Enable` banner. | `packages/agent-drive/src/mount-mac.ts:27-58` vs `docs/cli.md:260`, `README.md:38`, `SKILL.md:157`. | `setup-desktop-mounts.md:212` |
| 32 | `mounts wake` "does not call Instabox" in docs, but changing the setting resolves the Instabox executable, so a missing Instabox fails it. | `docs/cli.md:176-178` vs `cli.ts:1019-1026`. | `setup-desktop-mounts.md:185` |
| 33 | Docs say `SANDBOX_ID`; the CLI requires an exact `m_...` ID. | `mount-registry.ts:199`. | `setup-desktop-mounts.md:212` |
| 34 | Docs say `mkdir -p` of the parent only; `connect` rejects an existing mountpoint. Linux FUSE says the opposite for drives (empty existing directory). | `mount-registry.ts:149,162` vs `docs/cli.md:221`. | `setup-desktop-mounts.md:212` |
| 35 | Windows native mount is unsupported but never stated; the only signal is a missing-helper error, while clipboard export does support Windows. | `mount.ts:1231,1235`, `docs/cli.md:628`. | `setup-desktop-mounts.md:19` |
| 36 | Same action, three labels: `Capture…` (toolbar), `Capture traces…` (drive menu), "Capture traces" (dialog); the nearby `Traces` button is a different action. | `console.tsx:3063,3069`, `drive-menu.tsx:77`, `docs/trace-capture.md:122`, `docs/console.md:74`. | `setup-webhook-capture.md:17` |
| 37 | `MISMATCH` means two things: "This key does not open this drive's files." vs "This drive's account copy is invalid". | `webhook-setup.ts:17` vs `console.tsx:497`. | `setup-webhook-capture.md:18` |
| 38 | Empty drive with a pasted key: two wordings. | `console.tsx:2600` vs `webhook-setup.ts:18`. | `setup-webhook-capture.md:19` |
| 39 | Reverification cancel: vault actions show "Confirm it's you to <doing>."; the Capture dialog shows the raw `reason.message`. | `console.tsx:515-520` vs `traces-dialog.tsx:107`. | `setup-webhook-capture.md:20` |
| 40 | `docs/console.md:79` implies one fresh sign-in; the code makes up to three strict calls in one Add. | `docs/console.md:79`, `webhook-setup.ts`, `console.tsx` `strictFetcher`. | `setup-webhook-capture.md:21` |
| 41 | The TLS and server-encrypts sentence sits under Local agents too, where capture encrypts locally. | `traces-dialog.tsx`. | `setup-webhook-capture.md:23` |
| 42 | The Privacy Mode warning appears only after a token exists, not before leaving for OpenRouter. | `traces-dialog.tsx:238` vs `docs/trace-capture.md:132`. | `setup-webhook-capture.md:24` |
| 43 | Console Codex MCP snippet has no approval settings; docs and llms.txt add per-tool `approval_mode = "approve"` for `put` and `download`. | `console.tsx:~303-309` vs `docs/mcp-tools.md`, `apps/web/app/llms.txt/route.ts:126-140`. | `setup-second-agent-sandbox.md:213` |
| 44 | Console connection guide says "Run the CLI from the repository after building it."; every other surface says `npm install -g`. | `console.tsx` connection-guide. | `setup-second-agent-sandbox.md:181` |
| 45 | `--api` with and without `/api`: console uses `--api <origin>`, docs use `--api https://agentdrive.xyz/api`. | `client.ts:387` rewrites the path. | `setup-second-agent-sandbox.md:182` |
| 46 | `credentials issue` prints `AGENT_DRIVE_CREDENTIALS=adcred1....`; docs say the value is "the part after `=`", so copying the whole line is wrong. | CLI help, `docs/sandboxes.md`. | `setup-second-agent-sandbox.md:85` |
| 47 | Delegate wording differs: "Let this agent add other agents to its drives" (connect page) vs "Let this agent add other agents" (docs, llms.txt line 113). | `connect.tsx`, `docs/sandboxes.md`, `llms.txt`. | `setup-second-agent-sandbox.md:271` |
| 48 | "13 tools" in docs vs a tool list of 7 refused and 6 allowed. | `docs/mcp-tools.md`. | `setup-second-agent-sandbox.md:216` |
| 49 | "Keys stay with you." (sidebar) vs "The service keeps only a hash." (receipt); they describe different keys. | Sidebar, API-key receipt. | `setup-second-agent-sandbox.md:185` |
| 50 | Backup status is two separate records (console `key_backup_at`, CLI config) that can disagree; the console stays `Not backed up` if the report fails. | `console.tsx`, `credentials.ts` `reportKeyBackup`. | `setup-owner-keys.md:58`; `setup-backup-first-file.md:231` |
| 51 | Terminal says "Check that the code matches", the page says "Does this code match your terminal?" (same fact, different wording). | `device.ts`, `connect.tsx`. | `setup-install-login.md:44` |
| 52 | llms.txt says to type the verification code; quickstart only says "check that the code matches". | `docs/quickstart.md:35` vs llms.txt. | `setup-install-login.md:170` |
| 53 | Install success output: login with a token shows no "Usable drives" line, unlike device login. | `cli.ts` token login vs `device.ts`. | `setup-install-login.md:196` |

## 9. Stories by topic

Each story below is copied in full from its topic file with the catalog ID. Headings are demoted two levels. A line "Catalog notes" has been added under each heading.

### Topic: Land, evaluate and sign up (SETUP-001 to SETUP-008)

Source file: `docs/ux-paths/topics/setup-land-signup.md`.

#### SETUP-001: Hand the setup line to Claude Code from the landing page
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-01`; surface class web; overlaps SETUP-009, SETUP-014.

**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Priya, a solo developer who lost a Claude Code sandbox's notes yesterday, reading the landing page on her laptop.
**Goal**: Start setup by copying the line and pasting it into her agent.
**Preconditions**: Signed out, no account.
**Surface**: web (browser)
**Ideal path**: 3 — read the hero, click `Copy`, paste into the agent.
**Alternate paths**: Terminal: `Copy command` for `npm install -g @dennisonbertram/agent-drive` (hero, "or in a terminal:"); closing section "Give your agent a drive." has a second `Copy` ("Copy agent instruction again"); `/index.md` twin text; read `/llms.txt` directly; `docs/quickstart.md` (starts with "1. Sign up").
##### Steps
1. Open `/` → hero "Agent files that outlive the sandbox." with lede "Agents get a cloud drive to save work that outlives a session or sandbox."
2. Read panel tag "Give this to your agent" with `> Set up Agent Drive: https://agentdrive.xyz/llms.txt`; click `Copy prompt` caption button (aria label "Copy agent instruction") → button feedback (copied state).
3. Read under it: "Free to start. Your agent shows a pairing code, and you approve it in your account." → Priya notes she has no account yet and wonders whether she must sign up first.
4. Paste into Claude Code → agent fetches `/llms.txt` (see Agent install topic).
##### Variations
- She uses `Copy command` instead and runs the npm command herself, then does not know the next command (the landing never shows `agent-drive login`).
##### Edge Cases
- Clipboard permission denied: `CopyButton` behavior in `copy-button.tsx` (check feedback text in walkers).
- The hero shows no "Sign up" requirement before the paste; the header CTA `Sign up free` is the only sign-up cue on screen.

---

#### SETUP-002: Compare plans and pick Free from the pricing page
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-02`; surface class web; overlaps SETUP-007.

**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Marcus, a research engineer who needs to store multi-GB protein files and wants to know limits before signing up.
**Goal**: Find drive count, storage and download limits and start on Free.
**Preconditions**: Signed out. Deployment with paid checkout ON for one run, OFF for the variation.
**Surface**: web (browser)
**Ideal path**: 3 — header `Pricing`, read cards, `Start with Free`.
**Alternate paths**: Landing plan table ("Start free.") with the same facts and `Sign up free`; `/pricing.md`; header `Sign up free` directly.
##### Steps
1. On `/`, click header link `Pricing` → `/pricing` heading "A home for every agent." eyebrow "START SMALL. KEEP YOUR KEYS."
2. Read three cards Free ($0), Developer ($20), Team ($200), each listing drives, storage, downloads, operations → he compares storage against his file sizes.
3. Read "How usage works" ("NO SURPRISES IN THE FINE PRINT") including the per-upload size limit → decides Free is enough to try.
4. Click `Start with Free` → `/sign-up`.
##### Variations
- Paid checkout off: a status line "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans." and disabled `Coming soon` buttons. Marcus cannot tell if paid plans are ever coming for the hosted site.
- Paid on: he clicks `Choose Developer` while signed out → `/console/billing` → redirect to `/sign-in` with no return path (CONTRADICTION C). After signing up he lands on `/console`, not billing, and must find `Billing & limits`.
##### Edge Cases
- Landing table says `Choose plan` (to `/pricing`), so a paid-plan click on the landing costs one extra page.
- Egress not metered (`S3_EGRESS_METERING=none`) changes the downloads row wording.

---

#### SETUP-003: First sign-up with Clerk and arrival at an empty console
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-03`; surface class web; overlaps SETUP-018, SETUP-004.

**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Aisha, a platform engineer at a 5-person startup, signing up with a work email.
**Goal**: Create an account and understand what to do on the first console screen.
**Preconditions**: Signed out, Clerk configured.
**Surface**: web (browser)
**Ideal path**: 5 — `Sign up free`, complete Clerk form, land on onboarding, `Copy`, paste into agent.
**Alternate paths**: `Start with Free` on `/pricing`; `Sign up free` in landing plan table or closing section or footer; `/sign-up` directly; from `/sign-in` the line "New here? Sign up free"; Clerk's own switch link on the sign-in form; social sign-in if the Clerk instance enables it (not defined in this repo).
##### Steps
1. On `/`, click header `Sign up free` → `/sign-up` (header now marks this link current; page has "Already have an account? Sign in · Pricing · Docs" links).
2. Fill the Clerk `SignUp` form (fields and email verification are defined by the Clerk instance, not this repo) → verification step.
3. After success Clerk redirects to `fallbackRedirectUrl` `/console` → brief card "Opening your workspace…" with "Loading your drives and access settings." (account row is created on first authenticated load).
4. The Files tab shows the onboarding panel: eyebrow "CONNECT YOUR AGENT", h2 "Give your first agent a home.", text "Paste this line into your agent. It installs the CLI and gives you a link; open it and click Approve. The agent sets up its own encrypted drive.", code `Set up Agent Drive: https://agentdrive.xyz/llms.txt`, button `Copy`, numbered steps "Paste one line into your agent." / "The agent shows a pairing code." / "You approve it once.", and "Prefer to set up a drive yourself?" with `New drive`.
5. Aisha clicks `Copy`, switches to her terminal agent and pastes → agent starts setup.
6. She sees tabs Files, Agents, API keys, Usage, Trash and Files toolbar `Refresh`; the `Connect an agent` button is NOT shown yet (only when drives exist), so the panel is the only path.
##### Variations
- She had arrived via `/sign-up?redirect_url=/connect?code=ABCD-EFGH` from a CLI link: Clerk should return her to `/connect`, so she never sees the onboarding panel on this visit.
- She uses Google/GitHub social sign-up if enabled.
##### Edge Cases
- Email verification code expired or wrong: shown by Clerk, not by this repo.
- She expects a plan choice step; there is none (every account starts on Free).
- Panel says "click Approve" but the page she will later see needs a typed "Verification code" and a button `Approve agent` (CONTRADICTION A).

---

#### SETUP-004: The "Set up a drive myself" detour from the empty console
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-04`; surface class web; **Duplicate of** SETUP-034.

**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Tomás, a cautious engineer who does not want an agent to create his drive before he has seen the console.
**Goal**: Create a drive by hand and keep the recovery file safe before involving any agent.
**Preconditions**: Just signed up, no drives, onboarding panel visible.
**Surface**: web (browser)
**Ideal path**: 5 — `New drive`, name it, `Create drive`, `Download recovery file and continue`, confirm.
**Alternate paths**: Drive-menu `New drive` appears only after a drive exists; Agent-first (stories 01/03) lets the agent create the drive; Agents tab "Create your first agent" is gated by "Create a drive first." text.
##### Steps
1. In the onboarding panel, under "Prefer to set up a drive yourself?", click `New drive` → dialog with field `Drive name`.
2. Type "research-notes", click `Create drive` → a receipt step warning "The recovery file contains a secret in plaintext. Store it in a password manager or ..." with `Download recovery file and continue`.
3. Click it → browser downloads the file; the dialog asks "Did the recovery file save?" (confirm control exists; exact buttons to be checked by walkers).
4. Dialog closes → Files shows the new empty drive with "Ready for your first file." and "Connect an agent with the CLI or MCP to upload encrypted files."; toolbar now shows `Connect an agent`.
5. Tomás clicks `Connect an agent` → dialog with the same setup line, link "Read what your agent will see (llms.txt)", and MCP snippets for "Claude Code", "Codex (~/.codex/config.toml)", "Cursor or any MCP client".
##### Variations
- Skips downloading the file (closes the dialog): a "Not backed up" chip and passphrase banner appear (other topic).
- The landing and onboarding text say "The agent sets up its own encrypted drive", so Tomás wonders whether the agent will create a second drive. The approval page offers "Use one of my drives instead (needs its recovery file)".
##### Edge Cases
- Download blocked by the browser: dialog text "Use Download recovery file, then I saved it, to try again." (`console.tsx` ~2620 area).
- Free plan drive limit (see `/pricing` Free card) reached on a second `New drive`.

---

#### SETUP-005: Console cannot load the workspace on first visit
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-05`; surface class web.

**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Jun, signing up on hotel Wi-Fi that drops requests.
**Goal**: Get past a failed first load.
**Preconditions**: Signed in with a fresh account; the `/api/console/...` calls fail or return an unexpected response.
**Surface**: web (browser)
**Ideal path**: 2 — read the message, click `Try again`.
**Alternate paths**: Browser refresh (the card says "refresh to try again"); sign out and back in via `UserButton` ("Your account").
##### Steps
1. Land on `/console` after sign-up → card "Opening your workspace…" / "Loading your drives and access settings."
2. The load fails → card changes to h2 "Workspace unavailable" with "Check the connection, then refresh to try again." and button `Try again`.
3. Click `Try again` (disabled while `busy`) → returns to the loading card, then the onboarding panel when the call succeeds.
##### Variations
- Session expired mid-call: "Your session expired. Sign in again." then redirect to `/sign-in` (no return path).
- Unexpected response body: error text "Agent Drive returned an unexpected response. Try again." (`console.tsx:282`) is only used in some paths; the failure card itself shows the fixed text above, not the specific error (`setError(reason.message)` at line 1088 only toggles the failure state).
##### Edge Cases
- No toast or detail tells Jun what failed (server vs network); the card text blames the connection in all cases.
- The failure card is the same whether it is the first visit or a returning owner's visit; the toolbar buttons (`Refresh`) are present but the content is hidden.
- Screen reader: the loading card has no announced status (check by walkers).

---

#### SETUP-006: Agent-driven setup where the human has no account yet
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-06`; surface class mixed; **Duplicate of** SETUP-010.

**Type**: long
**Topic**: Land, evaluate and sign up
**Persona**: Elena, a game developer using Codex on a MacBook who has never opened agentdrive.xyz; she pastes the line from a friend's tweet without visiting the site.
**Goal**: Finish first setup from the CLI link, signing up in the middle.
**Preconditions**: No Agent Drive account, Node 24+, agent has a shell.
**Surface**: mixed (CLI + web)
**Ideal path**: 12 — agent install, login, open link, sign up, return to `/connect`, type verification code, `Approve agent`, agent finishes.
**Alternate paths**: Sign up first at `/sign-up`, then paste the line (stories 03 then 01); `agent-drive login --no-browser`; `npx -y @dennisonbertram/agent-drive@latest login --name "<your agent name>"` when global installs are blocked.
##### Steps
1. Elena pastes "Set up Agent Drive: https://agentdrive.xyz/llms.txt" into Codex → agent fetches `/llms.txt`, runs `npm install -g @dennisonbertram/agent-drive`.
2. Agent runs `agent-drive login --name "Elena Codex"` → terminal prints "Open this link to approve: https://agentdrive.xyz/connect?code=ABCD-EFGH", "Check that the code matches: ABCD-EFGH", "Verification code: a1b2 c3d4 e5f6 7890", "Waiting for approval...". The CLI also opens the browser (`--no-browser` disables it).
3. Agent tells Elena to open the link, check the code, type the verification code, and click Approve (per `/llms.txt` step 2).
4. Browser opens `/connect?code=ABCD-EFGH` while signed out → redirect to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DABCD-EFGH`.
5. Elena sees a sign-in form; she has no account. She looks for a way to create one. The visible cue is "New here? Sign up free" under the card (and Clerk's own link) → clicks it; `authHref` keeps `redirect_url`.
6. She completes Clerk sign-up → returns to `/connect?code=ABCD-EFGH`.
7. Page tag "Pairing request", h1 "Connect Elena Codex?", summary (for example "New encrypted drive · full access"), `Details` collapsed; question "Does this code match your terminal?"
8. She types the verification code into the "Verification code" field → no mismatch error.
9. Clicks `Approve agent` → done page: tag "Approval saved", h1 "Access approved for Elena Codex", button `Open console`.
10. Back in the terminal, the CLI finishes login and prints drive info and a backup hint.
11. Agent runs the backup and check steps (`agent-drive credentials export --to ...`, `agent-drive check`; other topics).
12. Elena clicks `Open console` → `/console` shows the new drive (no onboarding panel, because a drive exists), with a passphrase banner and "Not backed up" chip until step 11 completes.
##### Variations
- The code is expired (10-minute lifetime): the page shows an expired state; the agent re-runs `agent-drive login`.
- She skips typing the verification code: field error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890."
- She clicks the link in a browser already signed in to another Clerk account: the page shows "Account" in `Details`; she may approve into the wrong account.
##### Edge Cases
- Elena never saw the landing or pricing page, so nothing told her plans exist; billing is reachable only via `Billing & limits` in the console.
- Clerk sign-up verification email arrives slowly; the 10-minute code expiry can lapse.
- `docs/quickstart.md` step 1 says sign up first; the agent path does not (CONTRADICTION B).

---

#### SETUP-007: Evaluate before committing (docs, compare, FAQ, llms.txt)
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-07`; surface class web; overlaps SETUP-002, SETUP-014.

**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Dana, a security-minded tech lead who must justify the tool to her CTO before anyone signs up.
**Goal**: Confirm encryption, key loss behavior, pricing and supported agents without creating an account.
**Preconditions**: Signed out.
**Surface**: web (browser)
**Ideal path**: 6 — landing sections, FAQ, `Docs`, `Pricing`.
**Alternate paths**: `/index.md`, `/pricing.md`, `/docs.md`, `/compare.md` Markdown twins (reachable by URL, Accept header or `types: text/markdown` alternate); `/llms.txt` as plain text; footer links (Contact mailto, GitHub icon, `/privacy`, `/terms`).
##### Steps
1. On `/`, scroll the hero and "The problem" section ("Sandboxes end. Machines change. Platforms switch.").
2. Reach "Encrypted. Sharable. Works anywhere." → reads "We store only ciphertext and never see your drive keys."
3. In "Why not S3, git or Dropbox?" click a `/compare/<slug>` row, or `See …` link `/compare`.
4. Open the FAQ ("Questions, answered.") → "What happens if I lose the drive key?" answer: "Nobody can open the files, including us. Save the recovery file when you create a drive, or ask your agent to run `agent-drive credentials export --to <a safe path>`." She notes the file is saved at drive creation, but with the agent-first path the human never creates the drive.
5. Reads "Can a chat assistant in a vendor's cloud use it?" → "Not yet." Realizes her team uses ChatGPT, not a shell agent, and may stop here.
6. Clicks header `Docs` → docs index; finds quickstart, which says "1. Sign up" first.
##### Variations
- Reads the "See every file your agents saved." console screenshot and wonders whether the console can read files (it decrypts in the browser).
- Reads "Which agents work with it?" "Claude Code, Codex, pi and opencode."
##### Edge Cases
- The landing says "Free to start" but the Free allowances are only on the plan table; the hero does not link to them.
- Landing is `force-dynamic` and calls `billingRates()`/`checkoutConfigured()`; a failure there silently shows `Coming soon` instead of an error.

---

#### SETUP-008: Visiting a deployment where sign-in is not configured
**Catalog notes**: temporary ID `STORY-LAND-SIGNUP-08`; surface class web; overlaps SETUP-003.

**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Ravi, a developer self-hosting Agent Drive from the repo for the first time with no Clerk keys.
**Goal**: Understand why he cannot create an account.
**Preconditions**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` unset (or `AGENT_DRIVE_TEST_AUTH=1`).
**Surface**: web (browser)
**Ideal path**: 2 — click `Sign up free`, read the panel.
**Alternate paths**: `/sign-in` shows the equivalent panel; `AGENT_DRIVE_TEST_AUTH=1` with secret in development shows "Local test session" (dev only).
##### Steps
1. Click header `Sign up free` → `/sign-up` with panel h1 "Create your account" and "Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
2. Click "Already have an account? Sign in" → `/sign-in` with h1 "Sign in" and "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
3. Visit `/console` → `consoleUserId()` has no user → redirect to `/sign-in`, the same panel.
##### Variations
- Pricing page shows "Paid checkout is not enabled on this deployment..." in addition.
##### Edge Cases
- The two panels say "human access" and "Clerk instance" with no link to self-host docs.
- Dead end: the page offers no next step beyond the header.

---

### Topic: Agent-first install and login (SETUP-009 to SETUP-015)

Source file: `docs/ux-paths/topics/setup-install-login.md`.

#### SETUP-009: Pasting the llms.txt line into a local agent, happy path for an existing account
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-01`; surface class mixed; overlaps SETUP-016, SETUP-001, SETUP-032, SETUP-017.

**Type**: long
**Topic**: Agent-first install and login
**Persona**: Priya Raman, a backend developer on macOS, already has an Agent Drive account (signed in to agentdrive.xyz in Chrome yesterday). She runs Claude Code in `~/work/billing-api`.
**Goal**: Her agent is connected to a drive and `check ok` prints.
**Preconditions**: Node 24 installed, npm global installs allowed, signed in to the web app, no `~/.config/agent-drive/config.json`.
**Surface**: mixed
**Ideal path**: 6 — paste line (1), approve in browser (3 actions: read code, type verification code, click) and the agent does install, login, backup, skill, check on its own; the human touches 4 times.
**Alternate paths**: Human types `npm install -g @dennisonbertram/agent-drive` then `agent-drive login` herself (hero "or in a terminal:" on `/`); `docs/quickstart.md` step list (sign up, install, login); console `/console` onboarding panel "Give your first agent a home." with `Copy`; console Agents tab "Connect an agent" panel.
##### Steps
1. On `/` in the hero panel "Give this to your agent", click `Copy prompt` → clipboard holds `Set up Agent Drive: https://agentdrive.xyz/llms.txt`; hint line "Free to start. Your agent shows a pairing code, and you approve it in your account."
2. Paste the line into Claude Code and press Enter → agent fetches `/llms.txt` (served by `apps/web/app/llms.txt/route.ts`), which starts with the index ("# Agent Drive", Docs/Pages lists) then "## Set up (local agent with a shell)".
3. Agent runs `npm install -g @dennisonbertram/agent-drive` (step 1 of llms.txt) → installs; `agent-drive` is on PATH.
4. Agent runs `agent-drive login --name "billing-api agent"` → prints `Open this link to approve: https://agentdrive.xyz/connect?code=KBDF-MWNP`, `Check that the code matches: KBDF-MWNP`, `Verification code: 3f9a 07c2 b8e1 5d44`, `Waiting for approval...`. Chrome opens (stdout is a TTY inside her terminal only if the agent runs it in a TTY; many agent shells are not TTYs, so no browser opens, see Variations).
5. Agent tells Priya, per llms.txt: "Open this link (you must be signed in to Agent Drive), check that the code matches the one I printed, type the verification code into the page — it never shows it — and click Approve." Priya clicks the link.
6. `/connect?code=KBDF-MWNP` loads (already signed in) → tag "Pairing request", h1 "Connect billing-api agent?", summary like "New encrypted drive · full access".
7. Priya compares "Does this code match your terminal?" code with the terminal → matches.
8. She types `3f9a 07c2 b8e1 5d44` into `Verification code` (placeholder `a1b2 c3d4 e5f6 7890`, hint "Type the code from your agent’s terminal. This page never shows it.") and clicks `Approve agent` → button shows `Working…`, then tag "Approval saved", h1 "Access approved for billing-api agent", "Return to your agent to finish setup and confirm it is ready."; button `Open console`.
9. Terminal, within 5 s, prints `Logged in as agent billing-api agent.`, `Usable drives: <id>`, `Scopes: read, write...`, `Config: /Users/priya/.config/agent-drive/config.json`, `New drive <id> created; its key is saved in the config file.` and the BACKUP_HINT paragraph.
10. Agent offers backup choices (1Password, clipboard, file). Priya picks 1Password; agent runs `agent-drive credentials export --to 1password` → stderr "Saved the credentials for 1 drive(s) to 1Password."
11. Agent runs `agent-drive skill install` → `wrote /Users/priya/.claude/skills/agent-drive/SKILL.md`.
12. Agent runs `agent-drive check` → `check ok`. Agent reports setup done.
##### Variations
- Agent runs `login` in a non-TTY shell: browser does not open; the agent must relay the link. If the agent forgets to tell her about the "Verification code:" line, she reaches `/connect` and sees a required field with no source (the page itself never shows it).
- Priya's console is open in another tab; `/console` shows the passphrase banner "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." with `Set up` after the first login (not part of this story's goal).
##### Edge Cases
- Same fact on several surfaces: the pairing step is described as "a pairing code" and "click Approve" on `/` (`home.ts:8`) and in `console.tsx:316` ("It installs the CLI and gives you a link; open it and click Approve."), but `/llms.txt` and `docs/connect-an-agent.md:7` add the verification code. Priya reading only the website hears about one code, then meets two (the 8-letter code and the 16-hex verification code).
- Name the terminal prints for the code: "Check that the code matches" (CLI) vs "Does this code match your terminal?" (page): same fact, different wording, both fine.
- Priya presses `Approve agent` with an empty field: error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890."

---

#### SETUP-010: Brand-new user follows the CLI link while signed out and lands on the sign-in form
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-02`; surface class mixed; canonical for SETUP-018, SETUP-006; overlaps SETUP-018, SETUP-006, SETUP-003.

**Type**: long
**Topic**: Agent-first install and login (sign-in vs sign-up bounce)
**Persona**: Tomás Herrera, a freelance ML engineer on Ubuntu 24.04, has never visited agentdrive.xyz. A colleague gave him the line `Set up Agent Drive: https://agentdrive.xyz/llms.txt`. He runs Codex in a terminal.
**Goal**: Create an account and approve his agent without losing the pairing request.
**Preconditions**: No Agent Drive account, no Clerk session, Node 24, config absent.
**Surface**: mixed
**Ideal path**: 9 — agent steps then link, Clerk sign-up (email, verify), return to `/connect`, type code, Approve.
**Alternate paths**: Sign up first at `/sign-up` via header `Sign up free` or hero, then run the line (quickstart step 1 "Create your account at /sign-up"); on the sign-in page use "New here? Sign up free"; the console route `/console` does not carry a return path (`redirect('/sign-in')`), so signing up from the console loses nothing but also is not the CLI path.
##### Steps
1. Tomás pastes the line into Codex → agent reads `/llms.txt`, installs with `npm install -g @dennisonbertram/agent-drive`, runs `agent-drive login --name "tomas-laptop codex"` → four lines printed; `xdg-open` opens the link because stdout is a TTY.
2. Browser opens `https://agentdrive.xyz/connect?code=LTRH-QZVK` → server sees no user and redirects to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DLTRH-QZVK`. Page title "Sign in | Agent Drive", header links `Pricing`, `Docs`, and a Clerk Sign in card.
3. Tomás has no account. He hesitates: the card is a sign-in form (email, Continue). He looks for a way to register → below the card: "New here? Sign up free · Pricing · Docs".
4. He clicks `Sign up free` → `/sign-up?redirect_url=%2Fconnect%3Fcode%3DLTRH-QZVK` (via `authHref`, `site-header.tsx`), Clerk sign-up card.
5. He enters his email, completes Clerk's verification step → Clerk follows `redirect_url` (pages set `fallbackRedirectUrl="/console"`, so `/console` only if redirect is lost).
6. Lands on `/connect?code=LTRH-QZVK` → "Connect tomas-laptop codex?" with "New encrypted drive · full access" (first-time account: `accounts` row created on first authenticated load).
7. He reads `Details` is collapsed; the `Account` row is inside it. He checks the code, types `Verification code`, clicks `Approve agent` → "Access approved for tomas-laptop codex".
8. Terminal prints `Logged in as agent tomas-laptop codex.` ... `New drive <id> created; its key is saved in the config file.`
##### Variations
- Tomás types his email on the sign-in card first and Clerk reports no such account (exact Clerk wording not verified): he then finds the sign-up link.
- He signs in with a social provider if Clerk offers it (not verified which providers are enabled).
- He opens the printed link on his phone because the agent runs on a remote server: sign-up works the same; the code is typed from another device, which the page allows (it never shows the code).
##### Edge Cases
- Clarity risk: `/connect` always redirects to `/sign-in`, never `/sign-up` (`connect/page.tsx`), so the first thing a new user sees is a login form, and the only route to registration is a small line under the card.
- Ten-minute clock: sign-up plus email verification eats into the code lifetime (`expires_in` 600 s). If Tomás takes 11 minutes, `/connect` shows "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." and the terminal shows `The login code expired. Run `agent-drive login` again.` (see SETUP-012).
- `docs/quickstart.md` step 1 is "Sign up" before install, but `/llms.txt` has no sign-up step (only "The approval link asks the human to sign in: they must sign in first, then click Approve." in Troubleshooting). The two surfaces give different orders.
- If the account was created but Clerk drops `redirect_url`, he lands on `/console` showing "Give your first agent a home." and the CLI link is gone; he must reopen the printed link (still valid for the remaining minutes) or the page's "Enter the code your agent printed after running `agent-drive login`." entry form at `/connect`.

---

#### SETUP-011: Sandbox agent with no global installs uses npx and `--no-browser`
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-03`; surface class mixed; overlaps SETUP-009, SETUP-017, SETUP-015.

**Type**: medium
**Topic**: Agent-first install and login (npx fallback)
**Persona**: A CI-style research agent in a Docker container (no GUI, `CI=1`, npm global dir read-only). Its owner, Mei Lin Chen, watches the log from her laptop.
**Goal**: Log in using npx and get Mei Lin to approve from her own browser.
**Preconditions**: Mei Lin has an account and is signed in on her laptop. Container has Node 24.
**Surface**: mixed
**Ideal path**: 5 — npx login, relay link and code, Mei Lin types verification code, Approve, agent continues.
**Alternate paths**: `agent-drive login --no-browser` explicitly (help text `login [--name AGENT] [--no-browser]`); install globally with `npm install -g @dennisonbertram/agent-drive` where allowed; or skip the browser entirely with `AGENT_DRIVE_API_KEY` or `login --api URL --token-stdin` using a key made in the console API keys tab (human-first path).
##### Steps
1. Agent tries `npm install -g @dennisonbertram/agent-drive` → fails (EACCES). llms.txt anticipates this: "No global installs allowed (sandbox)? Run it with npx instead".
2. Agent runs `npx -y @dennisonbertram/agent-drive@latest login --name "research-bot"` → prints the four lines; no browser opens because `CI` is set and stdout is not a TTY.
3. Agent posts to Mei Lin: link `https://agentdrive.xyz/connect?code=NPGD-BHSX`, code, and `Verification code: 9c01 e4aa 17d3 6b82`.
4. Mei Lin opens the link on her laptop, checks the code, types the verification code, clicks `Approve agent` → "Access approved for research-bot".
5. Agent's npx process finishes: `Logged in as agent research-bot.` etc. The agent must keep using the `npx -y @dennisonbertram/agent-drive@latest` prefix "for every command below" (llms.txt), e.g. `npx -y @dennisonbertram/agent-drive@latest credentials export --stdout | <secret store>`.
##### Variations
- Container destroyed after login: config at `~/.config/agent-drive/config.json` is lost; `docs/sandboxes.md` says use `AGENT_DRIVE_CREDENTIALS`. Next run begins the whole flow again unless the bundle was stored.
- The agent names itself with the default: no `--name`, so the page shows "Connect 3b1f9c2a7d4e agent?" (container hostname + " agent"), meaningless to Mei Lin; she can't tell which sandbox it is except via `Details` > `Machine`.
- Slow npx cold start: each `npx -y ...@latest` call re-resolves the latest version; no offline cache assumed.
##### Edge Cases
- Node older than 24: package declares `engines.node >=24.0.0`; I found no explicit version check in `cli.ts`, so the failure shape is whatever npm or Node emits (not verified).
- `CI` set on a developer's laptop suppresses the browser silently; the printed link is the only cue.
- Self-hosted origin: llms.txt appends ` --api <origin>/api` to every command only when served from a non-public origin. A user who copies the commands from `docs/quickstart.md` on the public site gets the default API.

---

#### SETUP-012: The login code expires, and the user runs login again
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-04`; surface class mixed; **Duplicate of** SETUP-024; overlaps SETUP-024.

**Type**: medium
**Topic**: Agent-first install and login (expired code and polling)
**Persona**: Jonas Weber, an iOS developer, runs `agent-drive login` and then goes to a meeting for 15 minutes.
**Goal**: Recover from an expired pairing request.
**Preconditions**: CLI installed, Jonas has an account.
**Surface**: mixed
**Ideal path**: 3 — see the expiry message, rerun `agent-drive login`, approve the new link.
**Alternate paths**: Re-enter the new code manually at `/connect` ("Code from your agent", `Continue`) instead of using the link; ask the agent to rerun login.
##### Steps
1. `agent-drive login` → prints link `.../connect?code=FWXT-GDCN`, code, `Verification code: 5e21 90ab c7d3 48f6`, `Waiting for approval...`. Browser opens.
2. Jonas leaves the tab unapproved for 15 minutes. CLI polls `/api/oauth/token` every 5 s (`authorization_pending`).
3. At 10 minutes the CLI stops: `The login code expired. Run `agent-drive login` again.` (also triggered by `expired_token` from the server). Exit code non-zero.
4. Jonas returns, clicks `Approve agent` in the old tab (verification code typed) → inline error "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." Alternatively, the review page loads at all? On a fresh load of the old link the card shows tag "No pairing" and "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code."
5. He runs `agent-drive login` again → new code `BJRK-VTLM` and new verification code; the old code does not carry over; `known_drive_ids` from any saved keys is sent so reconnects reuse his drive.
6. He opens the new link and approves → success lines.
##### Variations
- Jonas types the new verification code against the old code page: "This code does not match the one your agent printed. Check the terminal again and type it exactly."
- Laptop sleeps mid-poll: on wake, fetch failures count; five in a row abort with `Lost contact with Agent Drive at https://agentdrive.xyz/api. Run `agent-drive login` again.`
- Rate limit: starting more than 20 logins per IP per hour returns 429 `slow_down` (`docs/agent-login.md` and `api-device-login.md:54`); the CLI shows `Agent Drive refused the login request: ...` with the server description; the word `slow_down` in a start response is not the polling meaning.
##### Edge Cases
- Neither the CLI nor `/connect` shows a time limit before it happens; the "10 minutes" appears in docs only (`docs/agent-login.md`). The page refetches on window focus at most 10 times and stops at expiry (`connect.tsx:285-341`), so a stale card can look valid until Approve.
- A `/connect` page left open does not poll; a second `login` leaves two pending rows, both valid until expiry (approve the right one by checking the code).

---

#### SETUP-013: Typing the verification code wrong, and the approve that never shows a Deny
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-05`; surface class mixed; **Duplicate of** SETUP-019, SETUP-020; overlaps SETUP-019, SETUP-020.

**Type**: short
**Topic**: Agent-first install and login (approval page, verification code)
**Persona**: Aisha Okonkwo, cautious, security-minded; she distrusts a link an agent printed.
**Goal**: Confirm the request is hers and approve it, or refuse it.
**Preconditions**: Signed in; a pending `/connect?code=` from her own `login`.
**Surface**: mixed
**Ideal path**: 3 — read the card, type verification code, `Approve agent`.
**Alternate paths**: To refuse: close the page and let it expire (no `Deny` button on `/connect`, although `POST /api/console/device/:code/deny` exists and the CLI handles `access_denied`).
##### Steps
1. Aisha opens `/connect?code=HQRM-ZVWD` → "Connect nightly-sync?" with `Details` closed.
2. She opens `Details` → rows Machine, Account, Drive, Access, Writes, Requested (and "Offered by" only for `grant` offers).
3. She types the verification code with a typo `a1b2 c3d4 e5f6 7891` → error "This code does not match the one your agent printed. Check the terminal again and type it exactly."
4. She retypes (spacing is flexible per `normalizeVerificationCode`; not verified in detail) → success page "Access approved for nightly-sync".
##### Variations
- She sees an unexpected `Machine` name and wants to deny: page says "If it does not, close this page; the request expires on its own." and the note "You can revoke access any time in Console, Agents." is shown near the button.
##### Edge Cases
- "Does this code match your terminal?" shows the 8-letter code, but the real protection is the 16-hex verification code; the page's wording makes the first sound like the check.
- The `Account` fact is only inside `Details`; a user with two Clerk accounts could approve under the wrong one without seeing the email unless Details is opened.

---

#### SETUP-014: Reading llms.txt directly in a browser and trying the old tarball
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-06`; surface class web; overlaps SETUP-007, SETUP-001.

**Type**: short
**Topic**: Agent-first install and login (the llms.txt document)
**Persona**: Devon Park, an indie developer, follows a link to `https://agentdrive.xyz/llms.txt` from a blog post to see what his agent will be told.
**Goal**: Understand what the agent does before pasting.
**Preconditions**: None.
**Surface**: web (browser)
**Ideal path**: 2 — open `/llms.txt`, scroll to "## Set up (local agent with a shell)".
**Alternate paths**: `/llms-full.txt` (index plus full docs); `/docs/quickstart` human page; console Agents tab link "Read what your agent will see (llms.txt)"; Markdown twins like `/pricing.md`.
##### Steps
1. Visit `/llms.txt` → plain text, starting "# Agent Drive", "> Encrypted file storage for agents..." then Docs and Pages lists ending with "[Everything in one file](.../llms-full.txt)".
2. Scrolls; steps 1 to 6 are numbered. Step 4 offers three backup options; step 6 says "Setup is complete only when it prints `check ok`."
3. Notes sections "Sandboxes", "Adding another agent to your drive", "Hosted assistants" ("not supported").
##### Variations
- A user on the header looks for an `llms.txt` link: not there; only reachable via the hero prompt text, console panels, docs, or typing the URL.
- Devon searches an old blog for `curl .../cli/agent-drive.tgz`: `docs/agent-login.md:24` still says "The site still serves `/cli/agent-drive.tgz` for older instructions", but it is a build artifact (gitignored), not an advertised route; all current surfaces say npm.
##### Edge Cases
- llms.txt tells the human to "type the verification code into the page — it never shows it", while `docs/quickstart.md:35` tells them only to "check that the code matches", so the same instruction differs by surface.
- A hosted chat assistant (no shell) pasted the line: llms.txt says "Chat assistants ... are not supported ... Tell the human this."

---

#### SETUP-015: Human-first alternative: console API key and `login --token-stdin`
**Catalog notes**: temporary ID `STORY-INSTALL-LOGIN-07`; surface class mixed; overlaps SETUP-047.

**Type**: medium
**Topic**: Agent-first install and login (alternate to device flow)
**Persona**: Rafael Souza, ops engineer who dislikes browser pairing and wants to wire a long-lived server agent by pasting a key.
**Goal**: Log the CLI in without the device flow.
**Preconditions**: Signed up, console open at `/console`, CLI installed.
**Surface**: mixed
**Ideal path**: 7 — console onboarding "Prefer to set up a drive yourself?" → `New drive`, recovery file, Agents `Create your first agent`, API keys `+ New API key`, copy secret, terminal pipe.
**Alternate paths**: Device flow (SETUP-009); `AGENT_DRIVE_API_KEY` env var, which makes `login` save that key instead of starting browser approval.
##### Steps
1. In `/console` onboarding click `New drive` → dialog "We’ll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it." Type `Drive name` `ops-archive`, click `Create drive`.
2. Receipt dialog → `Download recovery file and continue`, then `I saved it`.
3. Agents tab → `Create your first agent`.
4. API keys tab → `+ New API key`; secret shown once; tick "I saved my API key securely".
5. In terminal: `printf '%s' "<your API key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin` → prints whoami JSON (no "Logged in as agent" lines); config saved.
6. The drive key is not in the CLI config; `agent-drive check` refuses with `drive key not backed up` or no key; Rafael must run `agent-drive credentials import --from <recovery file>`.
##### Variations
- He forgets `--api`: default API is used (same value for public site).
- He pipes the key without `--token-stdin`: `login` starts the device flow instead (the stdin is ignored), which is surprising.
##### Edge Cases
- `--token-stdin` outside `login`: "--token-stdin is only supported by `login`."
- The success output differs from device login: no "Usable drives" line.

---

### Topic: Approve on /connect (SETUP-016 to SETUP-025)

Source file: `docs/ux-paths/topics/setup-approve-connect.md`.

#### SETUP-016: First approval, everything matches (happy path)
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-01`; surface class mixed; overlaps SETUP-009, SETUP-017.

**Type**: short
**Topic**: Approve on /connect
**Persona**: Priya Raman, indie developer, just signed up, has Claude Code running in a terminal and a browser already signed in to agentdrive.xyz.
**Goal**: Approve her agent and get a new encrypted drive.
**Preconditions**: Signed in. No drives. `agent-drive login --name "priya-claude"` has printed its output and the browser opened because stdout is a terminal.
**Surface**: mixed (CLI + web)
**Ideal path**: 4 — read the verification code, type it, click Approve, return to the terminal.
**Alternate paths**: Open the link by hand with `--no-browser`; open `/connect` with no code and type the code (see 02); `agent-drive grant` is only for a second agent.
##### Steps
1. In the terminal Priya reads `Open this link to approve: https://agentdrive.xyz/connect?code=BCDF-GHJK`, `Check that the code matches: BCDF-GHJK`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...` → the browser tab is already at `/connect?code=BCDF-GHJK`.
2. The page shows the tag "Pairing request", h1 "Connect priya-claude?", and the line "New encrypted drive · full access". Below it: "This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it." → she compares the big code under "Does this code match your terminal?" with the terminal. They match.
3. She clicks into the field `Verification code` (placeholder `a1b2 c3d4 e5f6 7890`, hint "Type the code from your agent’s terminal. This page never shows it.") and types `a1b2 c3d4 e5f6 7890`.
4. She clicks `Approve agent` → the button reads `Working…`, then the card changes to tag "Approval saved", h1 "Access approved for priya-claude", "You approved priya-claude to read, write, delete and share its new drive. Return to your agent to finish setup and confirm it is ready." and a button `Open console`.
5. She returns to the terminal → within about 5 seconds the CLI prints `Logged in as agent priya-claude.` and `New drive <id> created; its key is saved in the config file.` followed by the backup hint.
##### Variations
- She clicks `Open console` before looking at the terminal. Console shows a drive, a passphrase banner and a "Not backed up" chip; the agent has not yet been told to back up.
- She types the code in capitals or without spaces (`A1B2C3D4E5F67890`). It is accepted.
##### Edge Cases
- Nothing on the page says how long the code lives (10 minutes) or that the CLI polls every 5 seconds, so a user who sees no instant change may think approval failed.
- The same pairing code appears in three places (CLI line 2, URL, big code on the page). The verification code appears only in the CLI and must be typed by hand, even though the browser was opened by the CLI itself.

---

#### SETUP-017: Code entered by hand on a bare /connect (agent on another machine)
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-02`; surface class mixed; overlaps SETUP-011, SETUP-024.

**Type**: short
**Topic**: Approve on /connect
**Persona**: Tomás Herrera, runs Codex over SSH on a cloud VM; his laptop browser is where he is signed in.
**Goal**: Approve an agent whose terminal he cannot open a browser from.
**Preconditions**: Signed in on laptop. On the VM `agent-drive login --name "tomas-codex" --no-browser` printed the link and codes.
**Surface**: mixed
**Ideal path**: 5 — go to `/connect`, type the code, `Continue`, type verification code, `Approve agent`.
**Alternate paths**: Copy the whole link `.../connect?code=XXXX-XXXX` from the SSH session into the laptop browser (3 steps, skips code typing). Visit `/connect` from nowhere in the UI: there is no link to `/connect` in the site header or console nav (console reaches it only through the text instructions), so a user must know the URL.
##### Steps
1. On the VM Tomás reads `Check that the code matches: QTWN-ZLRK` and `Verification code: 09fe 4a21 77bc d3e0`.
2. On the laptop he opens `https://agentdrive.xyz/connect` → card tag "Awaiting code", h1 "Connect an agent", "Enter the code your agent printed after running `agent-drive login`." and the field "Code from your agent" (placeholder `XXXX-XXXX`).
3. He types `qtwnzlrk` → the field shows `QTWN-ZLRK`.
4. He clicks `Continue` (`Looking up…`) → the page moves to "Pairing request" and "Connect tomas-codex?".
5. He types the verification code and clicks `Approve agent` → "Access approved for tomas-codex".
##### Variations
- He pastes `QTWN-ZLRK` with spaces or lowercase: formatting normalizes it.
- He makes a typo, `QTWN-ZLRL` (valid letters): "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." and the tag becomes "No pairing". The message does not say which of the three it is.
##### Edge Cases
- If he reads the code aloud wrong and types `QTWN-AEIO` (vowels), the box accepts the text but `Continue` says "Enter the code in the form XXXX-XXXX." This is misleading: the form is right, the letters are not allowed. The page never says which letters are used.
- Pressing `Continue` with an empty box: "Enter the code your agent printed."
- If he is signed out, `/connect` (no code) redirects to `/sign-in?redirect_url=%2Fconnect`.

---

#### SETUP-018: Brand-new user arrives from the CLI link and is signed out
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-03`; surface class mixed; **Duplicate of** SETUP-010; overlaps SETUP-010, SETUP-006.

**Type**: long
**Topic**: Approve on /connect
**Persona**: Mei Lin Chen, product designer, asked her agent to "Set up Agent Drive: https://agentdrive.xyz/llms.txt". She has no account.
**Goal**: Create an account and approve her agent before the code expires.
**Preconditions**: Agent ran `agent-drive login --name "mei-cursor"`; the browser opened on `https://agentdrive.xyz/connect?code=KWPD-RSTV`. Mei is signed out. Code lifetime is 10 minutes.
**Surface**: mixed
**Ideal path**: 7 — sign up, return to /connect, type verification code, approve.
**Alternate paths**: Go to `/sign-up` first from the landing page and then open the link; sign in with an existing account; if the code expires, the agent reruns `agent-drive login` and she starts again with a new link.
##### Steps
1. The agent tells her: "Open this link (you must be signed in to Agent Drive), check that the code matches..." (the `/llms.txt` wording). She opens the link → redirect to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DKWPD-RSTV` (`page.tsx` redirect).
2. She sees the Clerk sign-in form and no account. She looks for the link to the other form (`AuthLinks`) and clicks it → sign-up form.
3. She finishes sign-up (email code, etc.) → Clerk returns her to `/connect?code=KWPD-RSTV` because `redirect_url` is preserved (unverified for the sign-up to sign-in switch: the redirect parameter may be lost when she changes forms; this was not run).
4. The page loads "Connect mei-cursor?" with "New encrypted drive · full access".
5. She does not know what to do with "Verification code". She goes back to the agent chat or terminal, scrolls up and finds `Verification code: 5d70 aa13 90e2 b4c8`.
6. She types it and clicks `Approve agent` → "Access approved for mei-cursor".
7. She returns to the agent, which finishes and now asks her to choose a backup option.
##### Variations
- Spent 10 minutes on sign-up: step 4 shows "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." with tag "No pairing" (the page was loaded with the code but the lookup returned 404). She must ask the agent to rerun login, and gets a new code AND a new verification code; the old verification code no longer works.
- Her agent's terminal is not visible to her (a chat UI that summarizes tool output): she cannot find the verification code and must ask the agent to repeat the exact line.
##### Edge Cases
- `docs/quickstart.md:35` and `home.ts:8` ("Your agent shows a pairing code, and you approve it in your account.") do not mention a verification code at all, so a user who read only those has no warning.
- `console.tsx:316` says "open it and click Approve" (no typing). The page then blocks Approve until a code is typed.
- A user who opens `/console` directly instead of the link would be redirected to `/sign-in` with no return page (discovery item 10).

---

#### SETUP-019: Wrong and malformed verification codes
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-04`; surface class mixed; canonical for SETUP-013; overlaps SETUP-013, SETUP-036.

**Type**: medium
**Topic**: Approve on /connect
**Persona**: Jamal Okafor, backend engineer, in a hurry, reading the code off a tiled tmux pane where the font makes `0` and `o` look similar.
**Goal**: Get past the verification gate without approving the wrong thing.
**Preconditions**: Signed in; pending request for `jamal-pi` at `/connect?code=HBGN-CXZM`; terminal shows `Verification code: 7c0e b91d 2f48 a0d6`.
**Surface**: mixed
**Ideal path**: 3 — type the code correctly and click `Approve agent`.
**Alternate paths**: None to bypass; the page requires the code on every approval shape, and the server checks it again (`docs/connect-an-agent.md:7`).
##### Steps
1. He clicks `Approve agent` with the `Verification code` field empty → the field gets focus and shows "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." No request is sent.
2. He types `7coe b91d 2f48 a0d6` (letter `o` instead of zero) → he clicks `Approve agent`. Because `o` is not a hex digit, the same "Enter the verification code your agent printed..." error shows. The message does not say the character is invalid.
3. He types `7c0e b91d 2f48 a0d7` (last digit wrong) → `Approve agent` shows `Working…` briefly, then "This code does not match the one your agent printed. Check the terminal again and type it exactly." The check runs in the browser against the request's public key, before the approve call.
4. He retypes `7c0e b91d 2f48 a0d6` → "Access approved for jamal-pi".
##### Variations
- Pasting the code with the `Verification code:` label included: the label contains letters outside `a-f` (`V`, `r`, `i`, ...), so it is rejected with the "four groups" message.
- Pasting with dots or hyphens (`7c0e-b91d-2f48-a0d6`) works.
##### Edge Cases
- The mismatch message says "Check the terminal again" and never mentions the other cause: the service returning a different key. A user who typed correctly and still sees the mismatch is told only to retype.
- Another process printed a similar line to the same terminal: the `device.unit.test.ts` cases show the CLI sanitizes embedded newlines, so a forged second `Verification code:` line should not appear (verified in tests only).
- Each failed local check does not call the server, so it does not consume the "30 per 10 minute" console budget (the check is before `api(... /approve)`; by code reading).

---

#### SETUP-020: The code does not match the terminal, and there is no Deny button
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-05`; surface class web; canonical for SETUP-013; overlaps SETUP-013.

**Type**: short
**Topic**: Approve on /connect
**Persona**: Dana Whitfield, security-minded engineering manager. A colleague sent her a link "to approve my agent", and the code on the page differs from what the colleague's terminal screenshot shows.
**Goal**: Refuse a request she does not trust.
**Preconditions**: Signed in; request for `dev-box-3` is pending.
**Surface**: web
**Ideal path**: 1 — close the page (only option on the page).
**Alternate paths**: None in the UI. The API has `POST /api/console/device/:code/deny` (`device.ts:924`) and the CLI handles `access_denied` ("Approval was denied. No access was granted."), but no control calls it.
##### Steps
1. She opens the link → "Connect dev-box-3?" with a big code under "Does this code match your terminal?" that she compares with the screenshot. It differs.
2. She looks for a refuse control. The only buttons are `Approve agent`, the `Details` toggle and the delegate checkbox. The page says "If it does not, close this page; the request expires on its own." (line 836) → she closes the tab.
##### Variations
- She opens `Details` to see Machine, Account, Drive, Access, Writes and Requested first. Machine shows the hostname the agent reported (not verified).
- The request stays pending for up to 10 minutes. If the colleague's real agent was a different request, nothing is lost.
##### Edge Cases
- The text "You can revoke access any time in Console, Agents." (line 874) is the only safety net after a wrong Approve, but the console has no mention of which approval came from `/connect`.
- Someone else's valid code could be approved by anyone signed in who also types the right verification code; without the verification code the approve fails. Dana's refusal is safe only because the verification code is not on the page.

---

#### SETUP-021: Reconnect an agent that was approved before
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-06`; surface class mixed; overlaps SETUP-012.

**Type**: medium
**Topic**: Approve on /connect
**Persona**: Luis Navarro, runs `agent-drive login --name "luis-claude"` again after reinstalling his laptop OS and losing `~/.config/agent-drive/config.json`; the credential backup was never done.
**Goal**: Get his agent working again against its old drive.
**Preconditions**: Account has agent `luis-claude` with an earlier approval and one drive, `luis-claude`. New login uses the same agent name.
**Surface**: mixed
**Ideal path**: 3 — type verification code, `Approve agent`, then restore the key from backup.
**Alternate paths**: `agent-drive credentials import` from a backup (no browser); `Use one of my drives instead` is not offered here because the request already has previous scopes (the link requires `!request.scopes`); a different agent name would create a new drive (see 01).
##### Steps
1. CLI prints the link and codes → `/connect?code=...` opens.
2. The page shows h1 "Connect luis-claude?" and the summary line with the old drive name and its access, for example "luis-claude · full access". The text below reads "It reconnects to the drive it used before and keeps its previous permissions." Details lists Drive with the old drive name.
3. He types the verification code and clicks `Approve agent` → "You approved luis-claude to read, write, delete and share luis-claude. Return to your agent to finish setup and confirm it is ready." (the done sentence reads awkwardly when agent and drive share a name).
4. CLI: `Logged in as agent luis-claude.` and `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.` The key for the old drive is not on this machine, so the CLI cannot read old files. The CLI line "Login finished but this agent has no usable drive key..." or "No usable key for: <ids>. You can list names but not read contents." applies.
##### Variations
- Previous permissions were read-only: summary says "read only", Writes "No writes" and the user cannot change that here.
- Previous approval had `delegate`: the checkbox is NOT pre-ticked (server drops `delegate` on reconnect, `device.ts:679`), so he must tick it again; the page does not say so.
##### Edge Cases
- The word "reconnect" never appears as a choice. A user who wanted a fresh drive has no option on this screen (the "Use a new drive instead" button only appears after choosing the existing-drive mode, which is hidden here). To get a new drive he must rerun login with a different `--name`.
- The page says "keeps its previous permissions" but does not say the old drive's key is not recovered by the approval; this is only learned from the CLI.

---

#### SETUP-022: Use one of my drives instead (recovery file handoff)
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-07`; surface class mixed; canonical for SETUP-046; overlaps SETUP-046, SETUP-030.

**Type**: long
**Topic**: Approve on /connect
**Persona**: Amara Nwosu, runs Agent Drive for a small research team. Her old sandbox vanished, she kept `agent-drive-<id>.key.json` from the console. She starts a new agent `amara-codex`.
**Goal**: Give the new agent the existing drive with read-only access limited to the folder `/papers`.
**Preconditions**: Account has drive `research` and its recovery file on disk. `agent-drive login --name "amara-codex"` pending, new name so no previous scopes.
**Surface**: mixed
**Ideal path**: 9 — open Details, switch mode, choose drive, choose file, tick Read only, fill folder, type verification code, approve.
**Alternate paths**: Paste the key into `Drive key` instead of choosing a file; paste an `adcred1.` bundle (accepted); `agent-drive grant` from another agent that already holds the key; `credentials issue` for a sandbox; approve the default new drive instead.
##### Steps
1. `/connect?code=...` shows "Connect amara-codex?" and "New encrypted drive · full access". She expands `Details` and clicks `Use one of my drives instead (needs its recovery file)` → Details closes (the page removes the `open` attribute) and the form shows `Drive` (select), `Drive key` (password input, placeholder "Paste the drive key or an adcred1… bundle"), `Or choose a file`, `Read only`, `Only allow writes under (optional)` (placeholder `/inbox/x`), and `Use a new drive instead`. Summary line becomes "Existing drive · choose below".
2. She picks `research` in the `Drive` select (the first drive is preselected; up to 100 drives load, then `Load more drives`).
3. She clicks `Or choose a file` and selects the recovery file. The hint reads "The key is checked against the drive before it is sent. A drive with no files or trace inbox has nothing to check it against."
4. She ticks `Read only` and types `/papers` in `Only allow writes under (optional)`. (Read only plus a write folder is allowed in the form; read only wins, scopes become `read`.)
5. She types the verification code and clicks `Approve agent` → the browser checks the key against the drive, seals it to the agent's public key, and posts only the sealed blob.
6. Done card: "You approved amara-codex to read the drive research." with `Open console`.
##### Variations
- Choosing a file AND pasting text: the file wins (`keyFile ? keyFile.text() : pasted`).
- A file over 16 KB: "This is not a valid drive key file."
- Drive has no files and no trace inbox: approval works, and the done card adds "This drive has nothing to check the key against, so it could not be checked before sending."
- She clicks `Use a new drive instead` mid-way: key, file and field error are cleared, the form returns to the new-drive summary.
##### Edge Cases
- Wrong drive's key: "This key does not open the selected drive. Check the drive and paste its own key."
- Garbage text: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle."
- Key field empty and no file: "Paste the drive key or choose a recovery file." appears as a key error.
- Drive deleted in another tab: "This drive is no longer available. Reload the page and pick it again."
- Network drop during the check: "The key could not be checked against the drive. Try again." (a form-level banner, not a field error).
- Folder `papers/` or `papers`: "Enter a folder that starts with / and does not end with /, for example /inbox/agent." The error comes back from the server after the key was sealed, not before.
- The link text says "needs its recovery file" but the form also takes a pasted key or bundle (discovery item 9). The folder limit applies only to this mode; in the default mode "Writes" shows "Anywhere in the drive" with no way to restrict it.
- The link is hidden if the account has no drives, so a user with a recovery file but a new account will not see it.
- The sentence "You can revoke access any time in Console, Agents." stays the same.

---

#### SETUP-023: Delegate checkbox for an orchestrator agent
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-08`; surface class mixed; overlaps SETUP-050, SETUP-044.

**Type**: medium
**Topic**: Approve on /connect
**Persona**: Ravi Subramanian, runs a coordinator agent `ravi-lead` that will spin up worker sandboxes and give each its own scoped access.
**Goal**: Approve `ravi-lead` so it can add other agents, then add one worker.
**Preconditions**: Signed in; request for `ravi-lead` pending.
**Surface**: mixed
**Ideal path**: 6 — expand Details, tick delegate, verify code, approve, then `grant` from the CLI and approve the worker.
**Alternate paths**: `agent-drive credentials issue --name worker-1 --to PATH` (no browser approval per worker, needs `delegate`); approve without delegate and add workers by hand with the console `+ New API key`.
##### Steps
1. The page shows "Connect ravi-lead?" and "New encrypted drive · full access". He does not see the delegate option: it is inside the collapsed `Details`.
2. He clicks `Details` and sees the checkbox "Let this agent add other agents to its drives" with the small text "It can hand another agent the key and permissions it holds itself, never more, and it cannot pass this permission on. You still approve each new agent here."
3. He ticks it → the summary line changes to "New encrypted drive · full access · can add other agents".
4. He types the verification code and clicks `Approve agent`; the done card names no delegate status ("You approved ravi-lead to read, write, delete and share its new drive.").
5. Later `ravi-lead` runs `agent-drive grant QMPT-WZVK --verify "..."` for the worker. Ravi opens that worker's `/connect` link → Details now shows "Offered by ravi-lead"; the summary says "<drive> · full access · offered by ravi-lead"; the explanation reads "ravi-lead sealed the drive key for this login; Agent Drive never sees it."
##### Variations
- He forgets the checkbox: `grant` from `ravi-lead` fails with "The API key needs the delegate scope." (`device.ts:795`). He must reconnect, which needs a second approval; see 06 (delegate is not pre-ticked).
- The worker's request also shows the delegate checkbox, unticked by default; delegate is never inherited from the offer (`device.ts:664`).
- A worker approved with `delegate` ticked can add more agents; the page text says the granting agent "cannot pass this permission on", which contradicts allowing the checkbox on an offered request unless the human ticks it again.
##### Edge Cases
- The checkbox is shown on every request, including a read-only offer. Ticking it on an offer with `read` only still produces a delegate that can only pass on `read`.
- Delegate is only mentioned inside a collapsed `<details>`, so many users never see it; `/llms.txt` says "Other options on the page are optional; the defaults are right."
- The summary line reflects delegate but the final "Approval saved" card does not.
- While the page is open, the agent's `grant` can arrive. The page re-fetches on window focus (at most 10 times, stopped at expiry or on any error) and shows "ravi-lead offered a drive for this login. Review it before you approve." Without refocusing, he approves the older view and gets: "The request changed; review it again." after an automatic reload.

---

#### SETUP-024: Code expired, already used, or rate limited
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-09`; surface class mixed; canonical for SETUP-012; overlaps SETUP-012, SETUP-017.

**Type**: medium
**Topic**: Approve on /connect
**Persona**: Hana Sato, left the browser tab open over lunch, then clicks Approve. She also double-clicked once.
**Goal**: Recover from an expired approval and a second attempt.
**Preconditions**: Request was created 14 minutes ago (lifetime 10 minutes); the CLI has already printed `The login code expired. Run `agent-drive login` again.`
**Surface**: mixed
**Ideal path**: 4 — rerun login, open new link, type new verification code, approve.
**Alternate paths**: Rerun with `--no-browser` and paste the URL; enter the new code at bare `/connect` (see 02).
##### Steps
1. She returns to the tab still showing "Connect hana-cursor?" and types the verification code. She clicks `Approve agent` → browser check passes locally.
2. The server answers 404 → banner "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." The backticks are plain text in this string (line 517), unlike the "wrong, expired" message on the entry card, which renders `agent-drive login` as code.
3. In the terminal she runs `agent-drive login --name "hana-cursor"` again → new link, new code, new verification code (the old one is now useless).
4. She opens the new link and approves with the new verification code → success.
##### Variations
- She refreshes the old URL before step 2: the page loads with tag "No pairing" and "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code."
- She double-clicks `Approve agent`: the first click sets `busyRef`; the second is ignored, button reads `Working…`. Only one approval is posted.
- She opens the same link on her phone after approving on the laptop: the code is consumed, so "wrong, expired, or already used".
- Trying many codes: after too many attempts the API returns "Too many device code attempts. Wait 10 minutes and try again." (`device.ts:746`), shown as the form error or as the entry-card error. The budget (30 per 10 minutes, shared with the agent's `grant` calls) is not mentioned on the page.
##### Edge Cases
- The page never shows a countdown or the expiry time; `expires_at` is fetched and used only to stop refetching.
- If her session expires while the page is open, any call returns 401, the page redirects to `/sign-in` (no `redirect_url`), and the typed verification code and any key text are lost. After sign-in she lands on `/console`, not `/connect`.
- The CLI side: `The login code expired. Run `agent-drive login` again.` is on the terminal; the page and CLI both name the same command but only the CLI knows the state.

---

#### SETUP-025: Approving while signed in to the wrong account
**Catalog notes**: temporary ID `STORY-APPROVE-CONNECT-10`; surface class web.

**Type**: medium
**Topic**: Approve on /connect
**Persona**: Elena Petrova, has a personal account (`elena@gmail.example`) and a work account (`elena@labcorp.example`). Her browser is signed in to the personal one. The agent she is setting up belongs to work.
**Goal**: Approve the agent into the work account's drives.
**Preconditions**: Browser session is the personal account; work drives live in the other account.
**Surface**: web
**Ideal path**: 5 — notice the account, sign out, sign in as work, reopen the link, approve.
**Alternate paths**: Open the link in a private window and sign in there; skip the check and approve (agent gets a drive in the wrong account).
##### Steps
1. She opens `/connect?code=...` → "Connect work-pi?" and the summary "New encrypted drive · full access". The signed-in email is shown only as `Account` inside the collapsed `Details`; nothing in the card header names the account.
2. She does not expand `Details`. She types the verification code and clicks `Approve agent` → "Access approved for work-pi". The drive is created under the personal account.
3. She later sees no drive in the work console and has to revoke the agent in the personal console under Agents, then rerun `agent-drive login`.
##### Variations
- She expands `Details` first, sees `Account: elena@gmail.example`, and recognizes the problem: she clicks the Clerk `UserButton` in the header to sign out and returns to the link (the `redirect_url` path preserves the code).
- Her account has existing drives: `Use one of my drives instead` appears and shows the personal drives, which is a second hint she is in the wrong account.
##### Edge Cases
- In test mode (no Clerk) the account shows "Local test session"; if Clerk has no primary email, "Signed-in account".
- The page gives no warning, and the server cannot know which account the person meant. The email address is the only evidence.
- The `Open console` button after approval goes to `/console` of the same (wrong) account.

---

### Topic: Back up, check, first file, skill (SETUP-026 to SETUP-033)

Source file: `docs/ux-paths/topics/setup-backup-first-file.md`.

#### SETUP-026: Back up by clipboard and confirm in Apple Passwords
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-01`; surface class CLI; overlaps SETUP-028, SETUP-039.

**Type**: short
**Topic**: Credentials export targets and confirm
**Persona**: Maya Okafor, a freelance data analyst on a MacBook. She approved her agent a minute ago and uses Apple Passwords, not 1Password.
**Goal**: Record a credentials backup so `check` can pass.
**Preconditions**: `agent-drive login` finished. Config has one drive key and no `keyBackup`. macOS. Terminal is open, Passwords app is available.
**Surface**: CLI
**Ideal path**: 3 — export, paste, confirm.
**Alternate paths**: `--to 1password`; `--to /path/agent-drive-credentials.txt` (recorded at once, no confirm); `--stdout | STORE && agent-drive credentials confirm`; `--to clipboard --keep-clipboard`.

##### Steps
1. The agent offers three choices (from `llms.txt` step 4). Maya says "clipboard". Agent runs `agent-drive credentials export --to clipboard` → stderr: `Copied the credentials to the clipboard. Paste them into Apple Passwords or your password manager, then run \`agent-drive credentials confirm\`. The clipboard is cleared in 60 seconds.` The command keeps running for 60 seconds (it waits in-process to clear the clipboard).
2. Maya opens Passwords, makes a new password item, pastes (the value begins `adcred1.`) and saves → clipboard still holds the bundle.
3. In a second terminal tab the agent runs `agent-drive credentials confirm` → `Recorded the credential backup for 1 drive(s) (stdout).`
4. The first command ends about a minute after it started; if the clipboard still holds the bundle it is cleared silently. If clearing failed it prints `Could not clear the clipboard; clear it yourself.`

##### Variations
- Maya pastes, then runs `confirm` before the 60 seconds end: the export process is still waiting, so the agent must use another shell. An agent that runs commands one at a time waits a minute before it can run `confirm`.
- She adds `--keep-clipboard`: the message ends `The clipboard is not cleared (--keep-clipboard).` and the command returns at once.
- She copies something else within 60 seconds: the clear step reports `unchanged` and leaves her new clipboard alone.

##### Edge Cases
- Ctrl+C during the 60-second wait leaves the bundle on the clipboard (code comment in `backup-targets.ts`). No message says so.
- `confirm` before any export: `There is no matching credentials export to confirm. Run \`agent-drive credentials export\` first.`
- Running `confirm` after a new login changed the API key: the pending marker no longer matches, same error as above.
- The name "stdout" in `(stdout)` confuses a clipboard user; she never used stdout.

---

#### SETUP-027: Run `check` before any backup
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-02`; surface class CLI; overlaps SETUP-030, SETUP-049.

**Type**: short
**Topic**: `check` outcomes
**Persona**: Tomas Vega, an impatient indie developer who pastes "Set up Agent Drive: https://agentdrive.xyz/llms.txt" into Codex and wants to be done.
**Goal**: See `check ok`.
**Preconditions**: Login succeeded, no backup recorded, one drive.
**Surface**: CLI
**Ideal path**: 2 — export a backup, then `check`.
**Alternate paths**: Any of the export targets; `AGENT_DRIVE_CREDENTIALS` in the environment (counts as backed up); `agent-drive credentials import`.

##### Steps
1. Agent runs `agent-drive check` → exit 1, stderr: `drive key not backed up: <drive id>` followed by the full `BACKUP_HINT` ("Back up this agent's credentials before this machine or sandbox goes away: ... Until then `agent-drive check` will not pass.").
2. Tomas answers "just do the file one" and the agent runs `agent-drive credentials export --to ~/Documents/agent-drive-credentials.txt` → `Backed up credentials for 1 drive(s) (file).`
3. Agent runs `agent-drive check` → `check ok drive=<drive id>`.

##### Variations
- The agent runs `agent-drive credentials status` first → JSON `{"drives":{"<id>":{"backedUp":false}}}`.
- Tomas picks a path inside a project folder: the CLI does not stop him (help says "outside the repo", code does not enforce it), and the file with the secret may be committed.

##### Edge Cases
- Path already exists: `<path> already exists; pass --force to overwrite it.`
- Path named `1password`, `op` or `clipboard` is read as a target, not a file; `./clipboard` is needed.
- Several drives with keys: `check` without `--drive` errors `More than one usable drive. Pass --drive ID.`; the unbacked-up list in the refusal names all of them.

---

#### SETUP-028: 1Password is not signed in, fall back to a file
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-03`; surface class CLI; overlaps SETUP-026.

**Type**: medium
**Topic**: Export targets and recovery from failure
**Persona**: Priya Natarajan, a platform engineer. She installed 1Password long ago, never installed the `op` CLI.
**Goal**: Back up to 1Password; settle for a file when that fails.
**Preconditions**: Login done, no backup. `op` is not on PATH.
**Surface**: CLI
**Ideal path**: 3 — try 1Password, read the error, export to a file.
**Alternate paths**: install `op`, turn on desktop integration, `op whoami`, retry; `--to clipboard` then paste into the 1Password app and `confirm`; `--vault NAME`.

##### Steps
1. Priya chooses 1Password. Agent runs `agent-drive credentials export --to 1password` → exit 1: `The 1Password CLI (\`op\`) is not installed. Nothing was exported. Install the 1Password CLI (https://developer.1password.com/docs/cli/get-started/), turn on its desktop-app integration or run \`eval $(op signin)\`, check that \`op whoami\` succeeds, then run this again.`
2. Priya hesitates: installing a CLI feels like a detour. She asks "can I paste it into the 1Password app instead?" The agent offers `--to clipboard`.
3. Agent runs `agent-drive credentials export --to clipboard`, Priya pastes into a new 1Password item and saves, agent runs `agent-drive credentials confirm` → `Recorded the credential backup for 1 drive(s) (stdout).`
4. Agent runs `agent-drive credentials status` → JSON with `backedUp: true`, `at`, `method: "stdout"`.
5. Agent runs `agent-drive check` → `check ok drive=<id>`.

##### Variations
- Priya installs `op` but is signed out: `The 1Password CLI (\`op\`) is not signed in. Nothing was exported. ...`
- `op item create` fails (vault locked): `The 1Password CLI could not create the item. Nothing was recorded as backed up.`
- On success with `--vault Personal` the item is titled `Agent Drive – <drive ids>` with a concealed field `credentials`; stderr says `Saved the credentials for 1 drive(s) to 1Password.`
- Linux or WSL: clipboard route fails as in contradiction 6; only file or `--stdout` remain.

##### Edge Cases
- The llms.txt and quickstart sentence "Offer these choices in this order" nudges the agent to lead with a path that needs an extra install for most people.
- Priya's pasted bundle might wrap lines in a note app; the bundle is one line and `decodeBundle` rejects `Not a valid Agent Drive credentials bundle.` at import time. Nothing verifies the copy at backup time.

---

#### SETUP-029: First put, get, compare and share
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-04`; surface class mixed; overlaps SETUP-016.

**Type**: medium
**Topic**: First file
**Persona**: Jonas Albrecht, a researcher who wants to hand a one-page PDF summary to a colleague with no account.
**Goal**: Store a file, confirm it round-trips, send a 24-hour link.
**Preconditions**: `check ok` already printed. One drive. Local file `./summary.pdf`.
**Surface**: mixed (CLI, then browser)
**Ideal path**: 3 — `put`, `share`, send the URL. (`get` and `cmp` are a verification, not required.)
**Alternate paths**: MCP tools `put`, `download`, `share` from the client; console file row menu then share dialog (`Link expires after`, `Copy link`); `put LOCAL -` from stdin; `put` the `folderUrl` it prints to open the folder in the console.

##### Steps
1. Agent runs `agent-drive put ./summary.pdf /outputs/summary.pdf` → one line of JSON with the version and `folderUrl` (`<origin>/console?drive=<id>&path=/outputs`). The agent shows Jonas the `folderUrl` (SKILL.md says to).
2. Agent runs `agent-drive get /outputs/summary.pdf --output ./summary-copy.pdf` → JSON status; then `cmp ./summary.pdf ./summary-copy.pdf` → no output.
3. Agent runs `agent-drive share /outputs/summary.pdf --expires-in 24h` → JSON with `id`, `path`, `versionId`, `expiresAt`, `url`.
4. Jonas pastes the `url` (`https://agentdrive.xyz/s/<id>#k=...`) to his colleague. The colleague opens it → page tag `ENCRYPTED FILE TRANSFER`, the file name as heading, button `Download`; after the click, `Download started: summary.pdf. Check your downloads.`
5. Later Jonas asks "which links are live?" Agent runs `agent-drive share list` → rows with `status` `active`.

##### Variations
- Jonas opens `folderUrl` before setting a passphrase: Files shows the file row but the key chip reads `Key needed · Not backed up` or `Key needed`; preview and download ask for a key (`Choose recovery file`).
- `--expires-in 90s` → `--expires-in must be between 2m and 30d to allow for API request transit (API minimum: 60 seconds).` `--expires-in 24` → `--expires-in must use a duration such as 30m, 24h, or 7d.` No flag: the service uses 7 days.
- The console route: row menu, share dialog `Link expires after` (1 hour, 24 hours, 7 days, 30 days) and `Copy link`; the URL lands on the clipboard and is not displayed unless `Copy failed`.
- `get /x.txt` without `--output` prints the text; a PDF or file over 1 MiB fails with `Binary or large output requires --output.` or `Binary output requires --output.`

##### Edge Cases
- Re-running the same `put` with the same path: writes are create-only unless `--overwrite` or `--if-version`; the CLI returns a conflict error with a hint.
- Key without `share` scope: permission error that names the scope; see `SCOPE_HINT`.
- Colleague opens the link after 24 hours: heading `Share link expired`, text `This link passed its expiry date. Ask the sender for a new link.` After `share revoke <id>`: `Share link revoked`. Colleague's link lost its fragment: `This link is missing a valid decryption key`.
- Jonas trashes the file: `share list` shows `unavailable` and the colleague sees `Shared file unavailable`.
- Help shows `--drive ID` on every command, so Jonas assumes it is required (contradiction 2).

---

#### SETUP-030: Read-only agent runs `check` on an empty drive
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-05`; surface class CLI; canonical for SETUP-049; overlaps SETUP-027, SETUP-049.

**Type**: medium
**Topic**: `check` outcomes
**Persona**: Lena Fischer, a security-minded engineer who approved a second agent as read-only (`--read-only` grant) to review a report folder.
**Goal**: Get `check ok ... (read-only)` for the reviewer agent.
**Preconditions**: Reviewer agent logged in with read-only access to an existing drive; drive holds no files yet; the reviewer holds the drive key and has a recorded backup (for example from `credentials import`).
**Surface**: CLI
**Ideal path**: 4 — check fails, ask the writer agent for a file, writer `put`s, check again.
**Alternate paths**: Ignore the failure because read-only agents need no write test (no doc says this explicitly); run `agent-drive ls` or `recent` to see that nothing is there.

##### Steps
1. Reviewer runs `agent-drive check` → exit 1, stderr: `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.`
2. Lena hesitates: "not verified" reads like the key is wrong. She asks the writer agent to run `agent-drive put ./notes.md /work/notes.md`.
3. Reviewer runs `agent-drive check` again → `check ok drive=<id> (read-only)`.
4. Reviewer runs `agent-drive get /work/notes.md` → text of the note. Lena confirms the key opens real content.

##### Variations
- The reviewer's key has `write` but a `--write-path /inbox/reviewer`: `check` writes `/inbox/reviewer/.agent-drive/check.txt` (uses the first write path), still in her inbox folder.
- Wrong drive key on the reviewer: `This drive key cannot decrypt existing files.` Lena must load the right key or repeat login.
- Reviewer machine key not backed up: `check` refuses first with `drive key not backed up` unless the key came from `AGENT_DRIVE_KEY`, `AGENT_DRIVE_KEY_<ID>`, `--key-file`, or `AGENT_DRIVE_CREDENTIALS`.

##### Edge Cases
- Only `/.agent-drive/check.txt` files exist: `readOnlyCheck` skips them and still reports not verified.
- A read-only key cannot report the backup (403 on `key-backup`, silently ignored), so the console chip can stay `Not backed up` even after the reviewer backs up locally.
- The error goes to stderr with exit code 1 although the message wording ("run check again") sounds like a retry, not a failure.

---

#### SETUP-031: Install the skill where no agent folder exists
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-06`; surface class CLI.

**Type**: medium
**Topic**: `skill install`
**Persona**: Devon Brooks, running Cursor and a throwaway Docker dev container. `~/.claude` and `~/.codex` do not exist.
**Goal**: Have the agent save and recall files without being asked.
**Preconditions**: CLI installed and logged in. No `~/.claude` or `~/.codex`.
**Surface**: CLI
**Ideal path**: 2 — `agent-drive skill install --target <dir>`; point the agent at that folder.
**Alternate paths**: `agent-drive skill install --target claude` or `--target codex` (creates the folder); `npx skills add dennisonbertram/agent-drive` (both skills); copy `SKILL.md` by hand from the printed path; skip it (llms.txt allows skipping in a sandbox); MCP (`claude mcp add agent-drive -- agent-drive mcp`) instead.

##### Steps
1. Following llms.txt step 5, agent runs `agent-drive skill install` → `No ~/.claude or ~/.codex directory found. The skill is at <packaged path>; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>.` Exit code 0.
2. Devon asks where Cursor reads skills. Neither the CLI output nor llms.txt says (Cursor is named only in the MCP snippet). He tries `agent-drive skill install --target ./.cursor/skills/agent-drive` and the agent runs it → `wrote ./.cursor/skills/agent-drive/SKILL.md`... Note the code appends `agent-drive` only for `claude`/`codex`; a custom `DIR` gets `SKILL.md` written directly inside it, so the path printed is `<DIR>/SKILL.md`.
3. Devon starts a new Cursor chat and asks "what do you remember about this project?". Whether the skill loads depends on Cursor; nothing in Agent Drive confirms it.

##### Variations
- Home with `~/.claude` only: one file written, `wrote /Users/devon/.claude/skills/agent-drive/SKILL.md`.
- Both folders: both written (two `wrote` lines).
- `--target claude` on a machine with no `~/.claude`: folder is created with `mkdir -p`.
- Running it twice overwrites the file (`overwrite: true`); local edits to the skill are lost silently.

##### Edge Cases
- Exit code is 0 when nothing was written, so a script cannot detect the miss.
- In a sandbox the skill is lost when the sandbox ends; `docs/sandboxes.md` says to skip it or use `--target`.
- Quickstart lists the skill as optional after `check` (contradiction 1), so a reader following the doc may never run it while an agent following llms.txt always does.
- `agent-drive-trace-archive` is not installed by this command (docs/skills.md:26).

---

#### SETUP-032: Finish setup end to end and watch the console chip change
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-07`; surface class mixed; overlaps SETUP-009, SETUP-035, SETUP-016.

**Type**: long
**Topic**: Backup, check, first file, skill, console confirmation
**Persona**: Aisha Rahman, a startup founder, non-technical about terminals. She gave Claude Code the line `Set up Agent Drive: https://agentdrive.xyz/llms.txt`, signed up and approved the pairing. She wants to see her first file in the browser.
**Goal**: Complete setup, store a first file, open it in the console, know the key is safe.
**Preconditions**: `agent-drive login` just printed `Logged in as agent ...`, `New drive <id> created; its key is saved in the config file.` and `BACKUP_HINT`. `/connect` shows `Access approved for ...` with `Open console`. Aisha has not set a passphrase.
**Surface**: mixed (CLI, browser)
**Ideal path**: 9 — export, confirm if needed, check, skill, put, share optional, open console, refresh, set passphrase.
**Alternate paths**: Aisha clicks `Open console` before backup; downloads a recovery file from the key menu (`Download recovery file`, then `I saved it`) which records the backup from the browser (`console.tsx:2617`); the agent writes a file backup and she chooses that file under `Choose recovery file`.

##### Steps
1. Claude Code says the login finished and asks how to back up. Aisha does not know what "credentials" are; she reads the three options and picks the file, naming `~/Documents/agent-drive-credentials.txt`. Agent runs `agent-drive credentials export --to ~/Documents/agent-drive-credentials.txt` → `Backed up credentials for 1 drive(s) (file).`
2. Aisha clicks `Open console` on the `/connect` done page → `/console`. The Files tab shows `Ready for your first file.` / `Connect an agent with the CLI or MCP to upload encrypted files.` The key chip shows `Key needed`. If the page loaded before the backup was reported it also shows `· Not backed up`.
3. She returns to the terminal. Agent runs `agent-drive skill install` → `wrote /Users/aisha/.claude/skills/agent-drive/SKILL.md`.
4. Agent runs `agent-drive check` → `check ok drive=<id>`. Agent tells Aisha setup is complete.
5. Aisha asks for proof. Agent runs `printf 'hello from an agent\n' > sample.txt`, then `agent-drive put ./sample.txt /sample.txt` → JSON with `folderUrl`.
6. Agent runs `agent-drive get /sample.txt --output ./downloaded.txt` and `cmp ./sample.txt ./downloaded.txt` → no output.
7. Aisha clicks the `folderUrl`, or `Refresh` in the console header. The row `sample.txt` appears. The key chip now reads (menu text) `Key backed up <date> (file)` and the `Not backed up` suffix is gone, provided the CLI's backup report reached the server.
8. She clicks the file. Preview asks for a key: unlock dialog with `Choose recovery file`, `Paste a key instead`, `Load key`. She does not have a recovery file; she chooses `~/Documents/agent-drive-credentials.txt` (the console accepts a bundle file) → text preview `hello from an agent`.
9. The passphrase banner on Files offers `Set up`; she defers it (next topic, account seal).

##### Variations
- Aisha refreshes before the CLI finished reporting: chip still `Not backed up`; no auto-refresh.
- Self-host: `check` and `folderUrl` use the configured origin.
- The agent installs the skill before backup (llms.txt order): same result, only order differs.
- Aisha asks Claude Code to share the file with a friend: `agent-drive share /sample.txt --expires-in 24h` and the console `Shared` view lists it.

##### Edge Cases
- If `reportKeyBackup` fails (offline, 5 second deadline), the CLI prints `Warning: could not report the key backup for drive <id> to Agent Drive.`, `check` still passes (local record), and the console keeps showing `Not backed up`. The two surfaces disagree until the report succeeds. No command re-reports besides running export or confirm again.
- She uses 1Password: the console label reads `(stdout)` (contradiction 3).
- She saves the credentials file in `~/Documents`, which is synced to a cloud drive; no text warns about that. The first sandbox-ending question in llms.txt is the only guidance ("a path that survives it").
- The agent prints the bundle in chat despite warnings: the `--stdout` guard does not catch a non-TTY agent shell (contradiction 5).

---

#### SETUP-033: Keep a drive across disposable CI sandboxes
**Catalog notes**: temporary ID `STORY-BACKUP-FIRST-FILE-08`; surface class CLI; overlaps SETUP-044.

**Type**: long
**Topic**: Backup by stdout pipe, `AGENT_DRIVE_CREDENTIALS`, check in a new sandbox
**Persona**: Hannah Cole, a DevOps engineer. Her coding agent runs in an ephemeral Linux container each night. She stores secrets in a company secret manager with a CLI, `vault kv put` style.
**Goal**: The agent keeps the same drive and `check ok` in every new sandbox.
**Preconditions**: Agent logged in once on her laptop (macOS) with a drive. No backup yet. Secret manager CLI works on the laptop. CI platform has a secret named `AGENT_DRIVE_CREDENTIALS` to be set.
**Surface**: CLI (plus the CI platform's secret UI)
**Ideal path**: 6 — export to the secret store, confirm, set the CI secret, new sandbox `whoami`, `check`, first `put`.
**Alternate paths**: `credentials export --to <path>` then copy by hand; `credentials issue --name ... --stdout` (needs `delegate`) to mint a separate key for the sandbox; `agent-drive credentials import --from <path>` inside the sandbox.

##### Steps
1. Hannah reads `docs/sandboxes.md`. Agent runs (in bash) `set -o pipefail; agent-drive credentials export --stdout | <secret store command> && agent-drive credentials confirm` → stderr `Exported. After the secret store has saved it, run \`agent-drive credentials confirm\`.` then `Recorded the credential backup for 1 drive(s) (stdout).`
2. Hannah, being cautious, reads the secret back from the store and confirms it starts with `adcred1.`.
3. In the CI platform she creates the secret `AGENT_DRIVE_CREDENTIALS` with that value (docs warn not to use the CI secret as the only copy).
4. The nightly container starts. It installs the CLI (`npm install -g @dennisonbertram/agent-drive`, Node 24+) and runs `agent-drive whoami` → agent name, drives, scopes, `localDriveKeys` showing the drive has a key here.
5. It runs `agent-drive check` → `check ok drive=<id>` (the bundle's drives count as backed up, method `env`). The first command also reports the backup to the service once.
6. It runs `agent-drive put ./report.md /outputs/nightly/report.md` → JSON with `folderUrl`.
7. The next night the container is gone; the new one repeats steps 4 to 6 and the file from the earlier night is visible with `agent-drive ls --prefix /outputs`.

##### Variations
- Hannah forgets `set -o pipefail`: the pipeline status is the secret store's, so a failed `export` that still lets the store exit 0 with empty input would run `confirm`. `confirm` then fails with `There is no matching credentials export to confirm...` because no pending export was written. The doc explains `pipefail` but not this outcome.
- She runs `agent-drive credentials export --stdout` directly in her laptop terminal: `Refusing to print credentials to a terminal. Pipe them to a secret store: \`agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm\`, or use --to <path>.`
- Both `AGENT_DRIVE_CREDENTIALS` and a saved config exist: saved values win (docs/sandboxes.md).
- Bundle typo: `AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.`
- Network blocked to agentdrive.xyz: `Could not reach Agent Drive at <base>. Check the network and try again.`; llms.txt tells the agent to stop and tell the human.

##### Edge Cases
- Hannah's key differs after a re-login: `The API key changed, so earlier credential backups are out of date. Run \`agent-drive credentials export\` again.` The stored CI secret holds an old API key and old sandboxes fail until she updates it.
- She uses the sandbox's bundle as the only copy: documented as wrong, but `BACKUP_HINT` does not repeat it.
- An agent in the sandbox runs `agent-drive credentials export --to clipboard` on Linux: `The clipboard target works on macOS and Windows only. ...`
- `skill install` in the container: llms.txt says use `--target <dir>` or skip; the skill file vanishes with the container.
- The same secret in many sandboxes gives every sandbox full drive access; `credentials issue --write-path` is the scoped alternative and is documented only in `connect-an-agent.md`, not the quickstart.

---

### Topic: Owner keys in the console (SETUP-034 to SETUP-042)

Source file: `docs/ux-paths/topics/setup-owner-keys.md`.

#### SETUP-034: Maya creates her own drive in the browser and saves the recovery file
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-01`; surface class mixed; canonical for SETUP-004; overlaps SETUP-004, SETUP-022.


**Type**: medium
**Topic**: Owner keys in the console: New drive and recovery file
**Persona**: Maya Okafor, freelance data analyst, signed up five minutes ago. She does not trust "an agent makes the key for me" and wants to hold the key before any agent exists.
**Goal**: Create a drive named "research-notes", save its recovery file, and later hand the drive to her agent.
**Preconditions**: Signed in, no drives, no agent. Chrome on a Mac. No passphrase set.
**Surface**: mixed (web, then CLI)
**Ideal path**: 4 — `New drive` (under "Prefer to set up a drive yourself?"), `Create drive`, `Download recovery file and continue`, `I saved it`.
**Alternate paths**: (a) agent-first: `agent-drive login` creates the drive and the CLI keeps the key (`BACKUP_HINT`, `credentials.ts:33`); (b) CLI `agent-drive drive create --name research-notes`; (c) after creation, the key chip menu offers `Download recovery file` / `Download recovery file again` at any time while the key is loaded in the tab; (d) the drive menu (top of Files) also has `New drive` (`drive-menu.tsx:139`) once a drive exists.

##### Steps
1. Open `/console`. → Onboarding panel, eyebrow "CONNECT YOUR AGENT", h2 "Give your first agent a home." Above it in the heading area the banner reads "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." with a `Set up` button (`console.tsx:2770-2778`). Maya sees two calls to action and no explanation of how they relate.
2. She reads "Prefer to set up a drive yourself?" and clicks `New drive`. → Dialog "Create a drive": "We’ll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it."
3. Field `Drive name` is prefilled and selected with "my-drive" (first drive only). She types "research-notes". She leaves the checkbox "Agent-only — never add this drive to passphrase unlock" unticked, unsure what it means (she hesitates, then moves on). She clicks `Create drive`. → Dialog title becomes "Your drive. Your key.": "This key decrypts your drive. Without it nobody, including us, can open this drive. It is not sent to the service or saved in browser storage."
4. She opens `Show drive key` (a collapsed details), sees a 43-character string, closes it, and clicks `Copy drive key` by mistake before realising the file is the real backup. → The clipboard now holds a plaintext key. No clipboard warning is shown.
5. She reads "The recovery file contains a secret in plaintext. Store it in a password manager or another secure location." and clicks `Download recovery file and continue`. → Browser saves `agent-drive-<drive id>.key.json`. Dialog changes to a group "Did the recovery file save?" with `I saved it` and `Download again`.
6. She opens Downloads, drags the file into 1Password, then clicks `I saved it`. → Dialog closes, tab is Files, notice "Recovery file saved. Store it in a password manager."
7. She opens the key chip. → Chip reads "Key loaded" (no "· Not backed up"). Menu: "Key loaded in this tab." and "Key backed up <date> (file)". It also offers `Set up passphrase unlock` and `Forget key`.
8. Files shows the empty state "Ready for your first file." / "Connect an agent with the CLI or MCP to upload encrypted files."
9. In her terminal she asks her agent to run `agent-drive login --name "claude-code"`. The CLI prints `Open this link to approve: <origin>/connect?code=XXXX-XXXX`, `Check that the code matches: XXXX-XXXX`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...`.
10. On `/connect` she clicks `Details`, then "Use one of my drives instead (needs its recovery file)". → Form with `Drive`, `Drive key` ("Paste the drive key or an adcred1… bundle"), `Or choose a file`, `Read only`, `Only allow writes under (optional)`. She picks "research-notes", chooses the downloaded `agent-drive-<id>.key.json`, types the verification code into `Verification code`, clicks `Approve agent`. → "Access approved for claude-code".

##### Variations
- She clicks the browser Back button or presses Esc while the receipt is open: the receipt dialog is not closable (`console.tsx:4187-4192` excludes `driveReceipt`), so Esc does nothing; there is no `Close` and no way to skip the download.
- She clicks `Download again`: a second identical file is saved (names collide as `(1)`).
- Name already used: error "A drive with this name already exists. Load its original drive key instead."
- `I saved it` records the backup after the dialog is already closed (`console.tsx:4266-4274`). If the record call fails, the notice says "The backup was not recorded. Use Download recovery file, then I saved it, to try again." and the chip stays "· Not backed up".
- She ticks "Agent-only" by accident: see SETUP-040.

##### Edge Cases
- If she reloads the tab before step 5 the key exists nowhere (it is in tab memory only), and the drive is an empty, unrecoverable shell. The receipt text states this, but no copy warns about reloading.
- The `/connect` link label says "needs its recovery file" but the form also accepts a pasted key or `adcred1.` bundle (`connect.tsx:685`).
- Unverified (not traced in code): whether `agent-drive check` passes immediately after step 10 for a key the agent received through approval. The console already has a backup record, but the CLI keeps its own backup records.
- Same fact shown on several surfaces: "backed up" status appears in the key chip label, key chip menu text, and (for the CLI) `agent-drive check`; they are separate records (console `key_backup_at` vs the CLI's config) and can disagree.

---

#### SETUP-035: Priya finishes agent setup, sets a passphrase, and enters the fingerprint so her agent can seal the drive
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-02`; surface class mixed; overlaps SETUP-036, SETUP-032.


**Type**: long
**Topic**: Owner keys in the console: passphrase setup, Settings fingerprint, `account seal --fingerprint`
**Persona**: Priya Raman, ML engineer. Her Claude Code agent just ran `agent-drive login` and she approved it. She has never set a passphrase and wants to read her agent's files in the browser without handing a key around.
**Goal**: Open the agent's files in Files with a passphrase and no recovery file.
**Preconditions**: Account has one agent-created drive (`drv_7QK2`) and no account key. Local agent and CLI 0.5.1. Chrome. Password manager available.
**Surface**: mixed (CLI, web, CLI, web)
**Ideal path**: 6 — `Set up`, tick `I saved it`, `Create`, copy fingerprint from key menu, run `agent-drive account seal --fingerprint "<print>"`, click a file.
**Alternate paths**: (a) set the passphrase first, then run `agent-drive login` with `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT` in the environment so the automatic seal after login works; (b) skip the passphrase and have the agent run `agent-drive credentials export --to <path>`, then `Choose recovery file` (see SETUP-039); (c) key chip menu `Set up passphrase unlock` instead of the banner `Set up`; (d) read the fingerprint from the key menu instead of Settings.

##### Steps
1. The agent's `login` finishes in the terminal. → Output includes `Logged in as agent claude-code.`, `New drive drv_7QK2 created; its key is saved in the config file.`, the backup hint, and a warning: "Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then." (`account-seal.ts:30-31`).
2. Priya follows the warning literally. She opens `/console/settings` (sidebar link `Activity & deletion`). → Card "Passphrase unlock" says "Not set up." with one button `Manage in Files`. She expected a setup form. She hesitates, then clicks `Manage in Files`. (Settings says "Status only. Setting up, unlocking, changing and resetting all happen in Files." only in a code comment, `settings-client.tsx:103`, not on screen.)
3. On Files the heading area shows the banner "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." She clicks `Set up`. → Dialog "Set up passphrase unlock".
4. The dialog says "Your passphrase: we generated it in your browser. Save it in your password manager. If you lose it you can reset it, but every drive must be added again." A 20-character code appears in groups of four, with `Copy passphrase`. She clicks `Copy passphrase` and saves it in 1Password.
5. `Create` is disabled until she ticks `I saved it`. She ticks it. She considers `Use my own passphrase` ("at least 14 characters", "Type it again"), decides the generated one is safer, and clicks `Create`.
6. The button shows "Creating… this takes a few seconds." and a line "Working… this takes a few seconds." A Clerk prompt appears asking her to confirm it is her (the account-key write uses strict reverification, `vault.ts` `setup`). She completes it. → Dialog closes, notice: "Passphrase set up. Your agent can now add its drives to your account." (no keys are loaded in this tab, so "0 drives" text is not used, `console.tsx:2476-2478`). If her browser supports passkeys, an `Add a passkey` button is shown next to the notice.
7. The key chip reads "Unlocked · Not backed up". She opens it. → "Unlocked. Drives you added to your account open when you use them. Fingerprint 9c1e 4b7a 02d8 f356". She notices the chip says Unlocked but no file has been decrypted yet.
8. She clicks a file `notes.md` anyway. → Dialog "Load the key for research" with "No recovery file? An agent that has this drive’s key can add it to your account: run `agent-drive account seal --drive drv_7QK2` on its machine ... If it reports `unverified`, re-run it with `--fingerprint` set to the account-key fingerprint under Settings." and `Copy account seal command`. Because the vault is unlocked: "After it runs, close this dialog and try the file again."
9. She clicks `Copy account seal command`, switches to the terminal, pastes it. → Output `drv_7QK2: unverified`; stderr: "The account key has not been verified on this machine. Copy its fingerprint from the console (Settings) and run `agent-drive account seal --fingerprint "<the fingerprint>"`. Sealing stays off until then." Exit code 1.
10. She goes back to the browser and opens `/console/settings`. → "Passphrase set up 11/27/2026, fingerprint 9c1e 4b7a 02d8 f356, 0 drives added." There is no copy button; she selects the four groups by hand. (The key menu already showed the same value in step 7.)
11. In the terminal: `agent-drive account seal --drive drv_7QK2 --fingerprint "9c1e 4b7a 02d8 f356"`. → `drv_7QK2: sealed`. Exit code 0.
12. Back in the dialog she closes it and clicks `notes.md` again. → File decrypts with no prompt (the account slot supplies the key). Key chip shows "Unlocked".
13. She refreshes Settings. → "…fingerprint 9c1e 4b7a 02d8 f356, 1 drive added."
14. The chip still says "· Not backed up". She opens the key menu and clicks `Download recovery file` (offered because a slot exists, `key-chip.tsx` `canReproduce`), saves the file, clicks `I saved it`. → Chip drops "· Not backed up". Meanwhile her agent also prints the backup hint; she tells it to run `agent-drive credentials export --to 1password`, which clears the CLI side.

##### Variations
- At step 6 she cancels the Clerk prompt: see SETUP-041.
- At step 9 she runs the command without `--drive`; all held keys are sealed and one line is printed per drive.
- If she is on a machine with several agents, every machine needs its own `--fingerprint` run once; the pin is per machine and per API origin (`account-seal.ts`, state in `<config>.state/account-seal.json`).
- If she never runs step 11, a later automatic seal on the agent prints the same unverified warning at most once per 24 hours per drive (`SEAL_THROTTLE_MS`).

##### Edge Cases
- Settings is named in three CLI strings (`account-seal.ts:31`, `:37-39`, `cli.ts:1153`) and in `unlock-dialog.tsx:242`, but passphrase setup is not in Settings. The step-1 warning sends the user to the wrong page for setup, then Settings sends her back to Files.
- The fingerprint has the same shape as the `Verification code: a1b2 c3d4 e5f6 7890` printed by `login` (`verification.ts`). The two values are different and used in different places. A user who keeps the login output open may type the verification code at step 11 and get: "The supplied fingerprint (…) does not match the account key the service returned (…). Check the fingerprint in the console under Settings; if it is right, the API may be answering with a different account key."
- `notes.md` opened before step 11 would, with the vault unlocked, show NOT_IN_ACCOUNT: "Load this drive’s recovery file to open it. We’ll try to save its key for passphrase unlock." (`console.tsx:495`).
- Same fact on several surfaces: account-key fingerprint (key menu, Settings, CLI error messages, `docs/console.md:103`, `docs/keys-and-recovery.md`); drive "sealed" state (CLI line `sealed`, Settings count "1 drive added", key menu text).
- Copy conflict: `docs/quickstart.md:35`, `home.ts:8`, `console.tsx:2858` and `:2874` tell the owner only to "match the code" / "click Approve", while `/connect` requires typing the verification code (`llms.txt/route.ts`, `docs/connect-an-agent.md:7`). This story starts after that step but the same owner meets it right before.

---

#### SETUP-036: Dev copies the fingerprint with a trailing comma
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-03`; surface class mixed; overlaps SETUP-035.


**Type**: short
**Topic**: Owner keys in the console: Settings fingerprint and `account seal --fingerprint`
**Persona**: Dev Anand, backend engineer, double-clicks and drags quickly.
**Goal**: Pin his account key on his laptop with `--fingerprint`.
**Preconditions**: Passphrase set up. Agent machine has not been pinned. Settings is open.
**Surface**: mixed (web, CLI)
**Ideal path**: 2 — copy the four groups from Settings (or key menu), run `agent-drive account seal --fingerprint "<print>"`.
**Alternate paths**: `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT="9c1e 4b7a 02d8 f356" agent-drive account seal`; open the key chip menu and copy `Fingerprint …` from there.

##### Steps
1. On `/console/settings` the card reads "Passphrase set up 11/27/2026, fingerprint 9c1e 4b7a 02d8 f356, 2 drives added." He drags from "9c1e" to the comma after "f356", so the selection ends with ",".
2. He runs `agent-drive account seal --fingerprint "9c1e 4b7a 02d8 f356,"`. → Error: `--fingerprint must look like "a1b2 c3d4 e5f6 7890", exactly as the console shows it.` (`cli.ts:1151-1153`; the pattern accepts spaces, dots and dashes but not commas, `verification.ts`).
3. He deletes the comma and re-runs. → One line per drive, `<id>: sealed`.

##### Variations
- He pastes the 16 hex digits with no spaces, or in capitals: accepted (spaces optional, case-insensitive).
- He uses a hyphen-separated copy ("9c1e-4b7a-02d8-f356"): accepted.
- He sets the env var wrongly: `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT must look like "a1b2 c3d4 e5f6 7890".`
- He adds `--fingerprint` to another command (`agent-drive put ...`): `--fingerprint is only supported by `account seal`.`

##### Edge Cases
- The Settings value sits inside a prose sentence with a comma after it. The key menu line `Fingerprint 9c1e 4b7a 02d8 f356` has no trailing punctuation.
- Settings and the key menu show the date as `toLocaleDateString()`, so a non-US browser gives a different date format from the CLI.

---

#### SETUP-037: Tomás adds a passkey and unlocks on a second laptop
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-04`; surface class web; overlaps SETUP-042.


**Type**: medium
**Topic**: Owner keys in the console: passkey and reverification
**Persona**: Tomás Herrera, designer with an iPhone and two Macs, passwords in iCloud Keychain. Tired of typing a 20-character passphrase.
**Goal**: Unlock his drives with Touch ID on the work laptop.
**Preconditions**: Passphrase set up and unlocked on laptop A. Drive sealed. Safari or Chrome with passkey support (WebAuthn PRF). No passkey yet.
**Surface**: web
**Ideal path**: 4 — key menu `Add a passkey`, type passphrase and `Add a passkey`, device prompt, then on laptop B `Unlock with passkey`.
**Alternate paths**: the `Add a passkey` button shown beside the "Passphrase set up." notice right after setup (`console.tsx:2747-2757`, `data-testid="passkey-offer"`); the passphrase stays available as a fallback at all times.

##### Steps
1. On laptop A, Files, he opens the key chip. → Menu shows `Add a passkey` (only visible when unlocked, no passkey yet, and the browser may support one, `key-chip.tsx:238-249`). He clicks it.
2. Dialog "Add a passkey": "Confirm your account passphrase, then follow the device prompt. You can use the same passkey wherever your password manager syncs it." Field `Confirm with your passphrase`. He pastes the passphrase, clicks `Add a passkey` (shows "Adding passkey…").
3. A Clerk reverification prompt appears (the passkey write is strict, `vault.ts` `addPasskey`). He confirms. Then the browser passkey sheet appears and he approves with Touch ID.
4. Dialog closes, notice: "Passkey added. Use it to unlock this account on this device." The menu no longer shows `Add a passkey`.
5. Next day on laptop B (iCloud Keychain synced) he signs in to `/console`, opens a drive, clicks a file. → Dialog "Unlock with your passkey": "Use your fingerprint, face, security key or device PIN when your browser asks." Checkbox `Keep this browser unlocked` (ticked). Buttons `Unlock with passkey` and `Use your passphrase instead`.
6. He clicks `Unlock with passkey`. → Button shows "Waiting for your passkey…", Touch ID prompt, then the dialog closes and the file he clicked opens or downloads (pending action resumes).

##### Variations
- Cancelled Clerk prompt: "Confirm it’s you to add the passkey."
- Wrong passphrase at step 2: "That passphrase is not correct."
- Browser has no WebAuthn: "This browser cannot use passkeys." Device lacks PRF: "This passkey cannot protect the account key." Other failure: "Passkey setup did not complete."
- Second enrollment attempt (another tab): "This account key already has a passkey." The console supports one passkey per account key (`docs/keys-and-recovery.md`).
- On a laptop without a synced passkey, `unlockEntry()` falls back to the passphrase dialog (`console.tsx:633`); if a passkey exists it also says "This account has a passkey too. Use the passkey instead" (`unlock-dialog.tsx:114`).
- Passkey fails at unlock: "This passkey could not unlock the account key."

##### Edge Cases
- Wording drifts: chip button `Unlock with passkey` (`key-chip.tsx:137`), dialog title "Unlock with your passkey" (`console.tsx:4170`), link "Use the passkey instead" (`unlock-dialog.tsx:114`), link "Use your passphrase instead" (`unlock-dialog.tsx:328`), chip button `Unlock with passphrase`.
- The idle message says "Locked after 30 minutes without use. Enter your passphrase to continue." (`console.tsx:494`) even for a passkey user.
- A passkey is not a drive-key backup; agent-only drives still need a recovery file (`docs/keys-and-recovery.md`).

---

#### SETUP-038: Dana forgets her passphrase, resets it, and re-pins her agent
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-05`; surface class mixed; overlaps SETUP-035, SETUP-039.


**Type**: long
**Topic**: Owner keys in the console: reset, lost passphrase, `account seal --repin`
**Persona**: Dana Whitfield, startup founder. Set a passphrase six weeks ago, never saved the generated one, no passkey, never downloaded a recovery file. Her agent on a Mac mini still holds all drive keys.
**Goal**: Get the console working again and keep her files.
**Preconditions**: Account key exists; two drives (`drv_A1`, `drv_B2`) both sealed earlier; agent machine pinned to the old fingerprint `9c1e 4b7a 02d8 f356`. New laptop, browser has no stored key.
**Surface**: mixed (web, CLI)
**Ideal path**: 8 — chip menu, `Forgot or exposed passphrase?`, type RESET, `Reset and remove all drives`, tick `I saved it`, `Create`, read new fingerprint, `agent-drive account seal --repin --fingerprint "<print>"`.
**Alternate paths**: (a) load each recovery file instead of resetting (she has none); (b) ask the agent for `agent-drive credentials export --to <path>` and use `Choose recovery file` per drive (no reset needed to read files, but the passphrase stays lost); (c) if a key is loaded in the tab before reset, setup re-adds it automatically (`console.tsx:2464-2472`); (d) a passkey would have opened the drives without the passphrase (`docs/keys-and-recovery.md`).

##### Steps
1. She opens `/console`, clicks a file. → Dialog "Unlock with your passphrase": "Type your passphrase to open the drives you added to your account. The keys stay in this browser only." Two buttons: `Unlock` and `Use a recovery file instead`.
2. She tries three guesses. → Each time: "That passphrase is not correct."
3. She looks for "forgot" and finds none in the dialog. She clicks `Use a recovery file instead`. → Dialog "Load the key for <drive>": `Choose recovery file`, "Paste a key instead", the line "No recovery file? An agent that has this drive’s key can add it to your account… Your passphrase then opens this drive — no file needed." (it still assumes the passphrase works), and `Use my passphrase instead`. She is in a loop.
4. She closes the dialog. The chip says "Locked". She opens it. → Menu text "Locked. Your passphrase opens the drives you added to your account." Buttons `Unlock with passphrase`, `Load key`, `Lock`? (no), and at the bottom `Forgot or exposed passphrase?`. She clicks it.
5. Dialog "Reset passphrase": "Resetting deletes your account key and removes every drive from it. Files are not deleted. You will add each drive again by loading its recovery file. Anyone who already opened a drive keeps its key." Field `Type RESET to continue`. The danger button `Reset and remove all drives` stays disabled until she types RESET exactly. She hesitates over "removes every drive" (it only means from the passphrase list) and "loading its recovery file" (she has none).
6. She types RESET and clicks `Reset and remove all drives` ("Resetting…"). A Clerk reverification prompt appears; she confirms. → The dialog changes to "Set up passphrase unlock" without any message about what happened.
7. She accepts the generated passphrase, copies it to 1Password, ticks `I saved it`, clicks `Create`. → "Passphrase set up. Your agent can now add its drives to your account." (0 keys in the tab.)
8. She opens the key menu: `Fingerprint 51ab 7e20 c9d3 1f08` (new). Settings shows "Passphrase set up 11/27/2026, fingerprint 51ab 7e20 c9d3 1f08, 0 drives added."
9. On the Mac mini the agent's next command tries its automatic seal. → A warning that the account key changed: "The account public key changed (pinned fingerprint 9c1e 4b7a 02d8 f356, server returned 51ab 7e20 c9d3 1f08). If the owner reset the passphrase in the console, verify its Settings fingerprint and run `agent-drive account seal --repin --fingerprint <fingerprint>` to pin the new key." (`account-seal.ts`, `AccountKeyPinMismatch`; I did not trace whether automatic runs print this text or a shorter one.)
10. She runs `agent-drive account seal --repin --fingerprint "51ab 7e20 c9d3 1f08"`. → `drv_A1: sealed`, `drv_B2: sealed`.
11. In Files she clicks a file. → It decrypts through the new account key. Settings later says "2 drives added."
12. She downloads a recovery file for each drive from the key menu and clicks `I saved it` each time.

##### Variations
- Without `--fingerprint`: `--repin requires --fingerprint. Copy the account-key fingerprint shown in the console (Settings) and pass --fingerprint.`
- Other browser tabs still open on the old account key lock themselves: "Your passphrase was changed elsewhere. Enter it again to continue." (`console.tsx` lock reason `stale`) or "Your passphrase was changed elsewhere. Reload the page."
- If she tries to type `reset` in lower case, the button stays disabled with no message.
- If she had loaded a drive's recovery file in the tab before resetting, the new setup says "Passphrase set up. 1 drive added to your account." and that drive does not need step 10.
- Agent-only drives are never re-added; they still need a recovery file.

##### Edge Cases
- The reset link is reachable only from the key menu; the Unlock dialog (the screen she is on when she is stuck) has no path to it (`vault-forms.tsx:85`, `key-chip.tsx:264`).
- "Remove every drive" and "Files are not deleted" appear together in one paragraph; "every drive must be added again" (generated-passphrase copy, `vault-forms.tsx:178`) means the same thing in other words.
- `docs/keys-and-recovery.md` says a passkey wrapper "goes with" the reset; the reset dialog does not mention passkeys.
- Same fact on several surfaces: the new fingerprint (key menu, Settings, CLI mismatch error).

---

#### SETUP-039: Ken lost his recovery file but the agent still has the key
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-06`; surface class mixed; overlaps SETUP-035, SETUP-026, SETUP-061.


**Type**: short
**Topic**: Owner keys in the console: lost recovery file
**Persona**: Ken Ito, consultant. His Downloads folder was wiped in an OS reinstall. He has no passphrase and no 1Password copy. His agent's machine still has the drive key.
**Goal**: Open `invoices` in the console and get a new recovery file.
**Preconditions**: One drive `drv_K9`, key in the agent's config, no account key, key chip "Key needed · Not backed up" (console record absent).
**Surface**: mixed (web, CLI)
**Ideal path**: 4 — click file, agent runs `agent-drive credentials export --to <path>`, `Choose recovery file`, `Download recovery file` + `I saved it`.
**Alternate paths**: (a) set a passphrase and run `agent-drive account seal --fingerprint "<print>"` (SETUP-035); (b) `Paste a key instead` with the bundle (not advised: the bundle includes an API key); (c) `agent-drive credentials export --to 1password`.

##### Steps
1. In Files he clicks a file. → Dialog "Load the key for invoices": "Choose the recovery file for this drive. The key stays in this tab only. It is cleared when you reload, or after 30 minutes without use." The key chip says "Key needed".
2. He reads the lower help text: "No recovery file? An agent that has this drive’s key can add it to your account: run `agent-drive account seal --drive drv_K9`…" and, because no passphrase exists, "Set up a passphrase below first — sealing needs your account key." and `Set up passphrase unlock`. He wants the fast path instead, and finds the second help line: "Or ask the agent to run `agent-drive credentials export`, then choose or paste what it gives you." with `Copy credentials export command`.
3. He copies the command and asks the agent to run it with a path: `agent-drive credentials export --to ~/Desktop/agent-drive-credentials.txt`. → A file with mode 600 is written and counts as the backup at once.
4. In the dialog he clicks `Choose recovery file` and selects that file. → Dialog closes, the file opens, chip "Key loaded".
5. He opens the chip menu and clicks `Download recovery file`, saves it into 1Password, clicks `I saved it`. → Notice "Recovery file saved. Store it in a password manager."

##### Variations
- If the vault is unlocked when he loads the key, the console adds the drive to the account: "Added to your account. Next time your passphrase opens it." (`console.tsx:1832`).
- Wrong file: "That is not a recovery file. Choose the agent-drive-….key.json file you downloaded." Wrong drive: "That recovery file is not for this drive." Bundle without this drive: "That credentials bundle has no key for this drive." Unreadable bundle: "That credentials bundle could not be read." File over 16,384 characters is treated as not a recovery file.
- Pasted raw key that is not 43 characters: "That key is not valid. Paste the whole key or credentials bundle."
- If no copy of the key exists anywhere: `docs/keys-and-recovery.md` and `docs/backup-and-recovery.md` say the files can never be decrypted; the dialog does not say this.

##### Edge Cases
- The dialog offers `account seal` first, which is the slower path when no passphrase exists, and `credentials export` last.
- `docs/backup-and-recovery.md` quotes the error as `That is not a recovery file.` The code string is longer (`recovery-file.ts:7-8`).
- The `Choose recovery file` label is the same for a `.key.json` file and an `adcred1.` bundle saved as text; nothing says the bundle works there except `docs/console.md:23`.

---

#### SETUP-040: Lena keeps a client drive out of passphrase unlock
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-07`; surface class mixed; overlaps SETUP-034, SETUP-061.


**Type**: medium
**Topic**: Owner keys in the console: agent-only drives
**Persona**: Lena Fischer, security consultant. Her agent may store raw client exports. She wants the browser never to hold that key through the account.
**Goal**: Create an agent-only drive, give it to an agent, and know how she will open it later.
**Preconditions**: Passphrase set up and unlocked. One normal drive already exists, so the drive menu is available.
**Surface**: mixed (web, CLI)
**Ideal path**: 9 — drive menu `New drive`, tick "Agent-only", `Create drive`, `Download recovery file and continue`, `I saved it`, then agent `login`, `Use one of my drives instead`, choose file, `Approve agent`.
**Alternate paths**: CLI `agent-drive drive create --name client-exports --agent-only` (the agent keeps the key; no recovery file exists until `credentials export`); the agent creates a normal drive and she does not tick the box (it will seal to her account).

##### Steps
1. In Files she opens the drive menu and clicks `New drive` (`drive-menu.tsx:139`). → Dialog "Create a drive".
2. She types "client-exports", ticks "Agent-only — never add this drive to passphrase unlock", clicks `Create drive`. → Receipt "Your drive. Your key.", same as SETUP-034.
3. `Download recovery file and continue`, then `I saved it`. → Files, the new drive selected.
4. She opens the key chip. → "Unlocked" with menu line "Unlocked, but this drive’s key is loaded in this tab." (hasKey) or, after a reload, "Unlocked. This drive is agent-only — only its recovery file opens it." The `Download recovery file` button is missing after a reload because a fresh file needs the key loaded (`key-chip.tsx` `canReproduce`).
5. In the terminal the agent runs `agent-drive login --name "exports-bot"`. She opens `/connect?code=…`, clicks `Details`, "Use one of my drives instead (needs its recovery file)", picks "client-exports", chooses the file, types the verification code, `Approve agent`. → "Access approved for exports-bot".
6. The agent runs `agent-drive account seal`. → `<drive id>: agent-only`, no failure.
7. Later she reloads, clicks a file in "client-exports". → Dialog "Load the key for client-exports" with the note "Agent-only: open with a recovery file." and no `account seal` help. Instead: "No recovery file? Ask the agent that created this drive to run `agent-drive credentials export`, then choose or paste what it gives you."
8. She chooses the saved file. → Key loaded.

##### Variations
- Passphrase setup after this drive exists never adds it (`console.tsx:2469-2471`).
- Keeping a recovery file is the only backup. If she loses it, only the agent's config or a bundle can recover the key (`docs/keys-and-recovery.md`).
- CLI-created agent-only drive: `agent-drive drive create --name N --agent-only` records the intent locally before the API call (`cli.ts:1369-1373`).
- If an agent runs `account seal --drive <agent-only id>` the result is `agent-only`; if the key lacks `read` scope and cannot list drives, the status can be `unknown type` with "unknown drive type: run 'agent-drive account seal --drive ID' with a key that can read drives" (`account-seal.ts:34-35`).

##### Edge Cases
- The dialog line "Ask the agent that created this drive" (`unlock-dialog.tsx:263`) is wrong for Lena: she created the drive in the browser; no agent created it.
- The drive menu has no visible agent-only marker. A drive named like another normal drive is indistinguishable until the key chip or unlock dialog is opened.
- Tick-box wording ("never add this drive to passphrase unlock") uses product words the new owner has not met yet; `docs/console.md` spells out that the API refuses a slot.
- I found no UI or CLI path to change an existing drive from normal to agent-only or the reverse; not confirmed beyond the code read.

---

#### SETUP-041: Passphrase setup interrupted by the Clerk confirmation prompt
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-08`; surface class web; overlaps SETUP-063, SETUP-035.


**Type**: short
**Topic**: Owner keys in the console: reverification
**Persona**: Ali Hassan, product manager. Taps away from prompts. Chose his own passphrase.
**Goal**: Finish setting a passphrase after cancelling the "confirm it's you" step once.
**Preconditions**: Signed in a while ago (Clerk session older than the strict window), no account key.
**Surface**: web
**Ideal path**: 3 — `Set up`, type passphrase twice, `Create`.
**Alternate paths**: generated passphrase (adds `I saved it`, skips typing).

##### Steps
1. He clicks `Set up`, then `Use my own passphrase`. Field label "Passphrase (at least 14 characters)", second field `Type it again`. He types "correct horse battery staple 2026" in both.
2. He clicks `Create`. → "Creating… this takes a few seconds." then a Clerk prompt. He closes it.
3. → The form shows: "Confirm it’s you to set up the passphrase." Both fields are now empty (typed values leave state before the slow work, `vault-forms.tsx` `submit`). He retypes both and clicks `Create` again, completes the prompt. → Notice "Passphrase set up. Your agent can now add its drives to your account." or "Passphrase set up. 1 drive added to your account."

##### Variations
- Too short: "Use at least 14 characters." Obvious pattern: "That passphrase is too easy to guess: it contains a common word." (or "it uses too few different characters", "it repeats one character", "it contains an ascending or descending sequence", "it contains a keyboard row pattern", "it contains your email name"). Mismatch: "The passphrases don’t match."
- With a generated passphrase the code stays on screen after a cancel, so he can click `Create` again.
- Network failure: "Could not reach Agent Drive. Check your connection and try again." Expired session: "Your session expired. Sign in again."
- Dialog is not closable while the setup is busy.

##### Edge Cases
- While the Clerk prompt is open the console dialog is hidden (`native-dialog-suspension.ts`) and comes back after.
- The "At least 14 characters" label and "Use at least 14 characters." error are the same fact twice; the generated passphrase is 20 characters and the copy never says why a longer one is better except the small print "The generated one can’t."

---

#### SETUP-042: Jo uses a coworking Mac and wants nothing left behind
**Catalog notes**: temporary ID `STORY-OWNER-KEYS-09`; surface class web; overlaps SETUP-037.


**Type**: medium
**Topic**: Owner keys in the console: passphrase unlock, "Keep this browser unlocked", lock
**Persona**: Jo Park, consultant, borrowing a shared iMac for an afternoon.
**Goal**: Read two files, then leave without the next person being able to open her drives.
**Preconditions**: Passphrase set up (no passkey). Shared Mac, Chrome profile used by others.
**Surface**: web
**Ideal path**: 4 — untick `Keep this browser unlocked`, `Unlock`, use files, key menu `Lock this browser`.
**Alternate paths**: sign out through `UserButton` ("Your account"), which also clears the stored key (`docs/console.md`); key menu `Lock` (clears the tab only).

##### Steps
1. Jo signs in and clicks a file. → Dialog "Unlock with your passphrase": "Type your passphrase to open the drives you added to your account. The keys stay in this browser only." The checkbox `Keep this browser unlocked` is ticked by default.
2. She reads "stay in this browser only" and does not realise the box means the browser keeps a key after she leaves. She types her passphrase and clicks `Unlock`. (Hesitation: the box is easy to skip.)
3. File opens. After 40 minutes away: notice "Locked after 30 minutes without use. Enter your passphrase to continue."
4. She finishes. She opens the key chip: buttons `Lock`, `Lock this browser`, `Change passphrase`, `Forgot or exposed passphrase?`. She clicks `Lock` first, reloads, and from the code I read the key restores without a prompt because the stored browser key survives `Lock` (`vault.ts` `lock` does not clear it; `restorePersisted` runs on load). She then picks `Lock this browser`, reloads, and sees chip "Locked".

##### Variations
- `Lock this browser` fails: "The stored key could not be removed; clear this browser’s site data to finish locking it."
- She changes her passphrase on another device: "Your passphrase was changed elsewhere. Enter it again to continue."
- Setup path: the setup form has no checkbox and still stores the key, so a user who sets up a passphrase on a shared machine is never asked.
- Passkey users see the same checkbox on the passkey form.

##### Edge Cases
- `Lock` and `Lock this browser` sit next to each other; only the second deletes the stored key (`docs/console.md:26`).
- `docs/console.md:28` says the tab key clears "when you leave the Files page" while `docs/backup-and-recovery.md` says only "reload ... or after 30 minutes".
- Idle lock text promises to ask for a passphrase; whether a reload after an idle lock reopens silently with "Keep this browser unlocked" is from code reading, not observed. A walker should check this.

---

### Topic: Second agent and sandbox continuity (SETUP-043 to SETUP-050)

Source file: `docs/ux-paths/topics/setup-second-agent-sandbox.md`.

#### SETUP-043: Hand a drive to a second laptop agent with grant --verify
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-01`; surface class mixed; overlaps SETUP-046, SETUP-023, SETUP-022.


**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Priya Raman, a freelance data engineer. Her Claude Code agent "priya-mbp agent" already holds drive `research-notes` and was approved with "Let this agent add other agents to its drives" ticked. She now wants her Codex agent on a desktop to share the same drive, limited to `/codex`.
**Goal**: Codex agent can read the drive and write only under `/codex`, without Priya ever handling the drive key.
**Preconditions**: Priya is signed in at agentdrive.xyz. Claude Code agent key has `delegate`. Codex machine has the CLI installed, not logged in. Both CLIs are a version that requires `--verify`.
**Surface**: mixed (CLI on two machines, web `/connect`)
**Ideal path**: 7 — login on new agent, relay verification code, grant, open link, type code, Approve, confirm with `whoami`.
**Alternate paths**: (a) recovery file on `/connect` Details, "Use one of my drives instead (needs its recovery file)"; (b) `credentials issue` if the new agent had no browser; (c) manual console Agents plus `+ New API key` plus `login --token-stdin` (gives an API key but no drive key, see SETUP-047).

##### Steps
1. On the Codex machine, run `agent-drive login --name "codex-desktop"` → prints `Open this link to approve: https://agentdrive.xyz/connect?code=K7QM-2XPD`, `Check that the code matches: K7QM-2XPD`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...`. The browser may open on this machine (TTY, `CI` unset).
2. Priya stops here. She does not click Approve yet, because she wants the Claude Code agent to seal the key first. She tells Claude Code the code and the verification code (typed into the chat).
3. On the first machine the agent runs `agent-drive grant K7QM-2XPD --verify "a1b2 c3d4 e5f6 7890" --write-path /codex` → prints `Request from codex-desktop on <machine>, made <timestamp>.` then `Offered drive <drive id> to codex-desktop (read write; writes under /codex). The owner approves at https://agentdrive.xyz/connect?code=K7QM-2XPD.`
4. Priya opens (or reloads) `/connect?code=K7QM-2XPD`. Tag "Pairing request", h1 "Connect codex-desktop?". Details lists "Offered by" `priya-mbp agent`. Banner after refocus: "priya-mbp agent offered a drive for this login. Review it before you approve."
5. She types `a1b2 c3d4 e5f6 7890` into `Verification code` (hint: "Type the code from your agent’s terminal. This page never shows it.") and clicks `Approve agent`.
6. Page shows tag "Approval saved", h1 "Access approved for codex-desktop", "Return to your agent to finish setup and confirm it is ready." with `Open console`.
7. The Codex terminal prints `Logged in as agent codex-desktop.`, `Usable drives: <id>`, `Scopes: read write`, `Writes limited to: /codex`, `Config: ~/.config/agent-drive/config.json`. Agent runs `agent-drive whoami` and `agent-drive check`.

##### Variations
- Priya relays the code in the wrong order of operations: she approves on the page before the grant arrives. The approval then creates a new empty drive for codex-desktop (default path) instead of sharing `research-notes`. This is the biggest trap: the page does not warn that a grant is still expected (only `/connect` copy "does this code match your terminal?").
- `--read-only` instead of `--write-path`: Scopes line shows `read`; `check` later prints `check ok ... (read-only)` or `check not verified` on an empty drive.
- Two drive keys on the first machine: `grant` fails with "Pass --drive <id>; this machine holds no single default drive key."

##### Edge Cases
- Verification typo on the CLI: error "The verification code does not match this request. Check the code the new agent printed; if it is right, do not grant — the request may have been tampered with." The alarming wording for a typo.
- Omitting `--verify`: "grant requires --verify <verification code>: the code the new agent printed under "Verification code:" when it ran `agent-drive login`. Ask the human for it."
- Granting key lacks `delegate`: server error "The API key needs the delegate scope." (`apps/web/src/api/device.ts:795`). Nothing in the grant error tells the agent how to fix it; the fix (ask Priya to re-approve with the checkbox) is only in docs and llms.txt.
- Grant key has `read write` but new scopes requested outside them: "This key does not hold read and write; pass --scope for what it may grant." (only when no `--scope` was passed).
- Request expired (10 minutes): grant fails at the lookup; Codex prints "The login code expired. Run `agent-drive login` again."
- Same fact on several surfaces: the verification code appears in the Codex terminal, the chat message, the grant command and the web field. The pairing code appears in the terminal, the URL, the large type on `/connect` and the grant command.
- Contradiction: `docs/quickstart.md:35`, `apps/web/app/(app)/console/console.tsx:316` and `apps/web/src/content/home.ts:8` describe approval as "check that the code matches"/"click Approve" without the verification code that `/connect` requires.

---

#### SETUP-044: Persist an agent into a CI sandbox with credentials issue
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-02`; surface class mixed; overlaps SETUP-033, SETUP-043, SETUP-023.


**Type**: long
**Topic**: Second agent and sandbox continuity
**Persona**: Marcus Webb, platform engineer at a 6-person startup. His laptop agent "marcus-dev agent" has `delegate`. Nightly CI jobs run in disposable containers on a hosted runner, no browser. A GitHub Actions secret store and 1Password are available.
**Goal**: Every nightly sandbox starts with its own agent identity, writes only under `/ci/nightly`, and can be revoked on its own.
**Preconditions**: Laptop agent logged in, drive `team-memory` backed up via `credentials export`. `agent-drive check` prints `check ok`.
**Surface**: mixed (CLI, CI secret store, web console)
**Ideal path**: 6 — issue to secret store, set secret, run `whoami` and `check` in the sandbox, confirm `Agents` row, done.
**Alternate paths**: (a) `--to PATH` mode 600 file then copy by hand; (b) grant needs a browser and human, so not viable here; (c) manual API key in console (no drive key, so the sandbox could not decrypt); (d) copying the laptop bundle into CI, which docs forbid.

##### Steps
1. On the laptop, agent runs `agent-drive whoami` → checks scopes include `delegate`.
2. Agent runs `agent-drive credentials issue --name "ci-nightly" --write-path /ci/nightly --stdout` directly in a terminal. → Error: "Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials issue --name <agent> --stdout | <your secret store>`, or use --to <path>." (Marcus hesitates, thinks it failed.)
3. Agent reruns with a pipe: `set -o pipefail; agent-drive credentials issue --name "ci-nightly" --write-path /ci/nightly --stdout | op item create --category "API Credential" --title "agent-drive ci-nightly" ...` → stderr: `Created agent "ci-nightly" with key <key id>: scopes read write, writes only under /ci/nightly.` then `Store this line as a secret in the sandbox. Revoke it from the console under Agents.`
4. Marcus opens GitHub repo settings, creates secret `AGENT_DRIVE_CREDENTIALS`, pastes the value. He pastes the whole line `AGENT_DRIVE_CREDENTIALS=adcred1.…` including the prefix (the printed line includes the name).
5. First CI run executes `agent-drive whoami` → fails: "AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle." Marcus rereads `docs/sandboxes.md` common failures: "Do not paste the `AGENT_DRIVE_CREDENTIALS=` prefix into the value." He edits the secret to start with `adcred1.`.
6. Rerun: `agent-drive whoami` lists drive and `localDriveKeys`; `agent-drive check` → `check ok`. The bundle's drives count as backed up (method `env`).
7. Marcus opens `/console`, tab Agents. New row "ci-nightly" with badge "1 active key" and small text "issued by marcus-dev agent". Tab API keys shows label `ci-nightly (issued by <machine>)`, scopes, "Write paths:" `/ci/nightly`, note "Write paths do not restrict reads. Reading still requires read permission on an allowed drive."
8. Later he sets `AGENT_DRIVE_MACHINE=gha-nightly` so uploads show a stable machine name.

##### Variations
- Name collision: running step 3 again with the same `--name` returns 409. Doc: "A name that already exists returns 409; pick another." No CLI-side hint seen.
- `--to ./ci.env` file: mode 600; if it exists, "`./ci.env` already exists; pass --force to overwrite it."
- `--stdout` and `--to` both or neither: "Pass exactly one of --to <path> or --stdout."
- Sandbox with no global install: prefix with `npx -y @dennisonbertram/agent-drive@latest`.
- Custom scopes: `--scope read` only, then `check` prints `check not verified` on an empty drive.

##### Edge Cases
- Sandbox lacks network egress: docs say "Stop and tell the human. Do not try to work around it."
- Sandbox API URL differs from the bundle's recorded origin: `no usable drive key`; fix `AGENT_DRIVE_API_URL`.
- The issued bundle is never written to disk in the sandbox, so a second job step reading the config file finds nothing, but env still works.
- The issuing agent's key may be limited to write paths; the new agent's write paths must sit inside them or the request fails (`docs/connect-an-agent.md`).
- Same fact on several surfaces: "revoke from the console under Agents" appears in the CLI stderr line and `docs/sandboxes.md`, but the console shows this agent only as a generic identity row.
- Contradiction: the CLI help says "Mint a new agent's key (needs the delegate scope) and print its AGENT_DRIVE_CREDENTIALS line" and `docs/sandboxes.md` says the value is "the part after `=`"; the printed line has the prefix, so the natural copy is wrong. No in-product hint beside the line.

---

#### SETUP-045: Revoke a leaked sandbox key
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-03`; surface class web; overlaps SETUP-047.


**Type**: short
**Topic**: Second agent and sandbox continuity
**Persona**: Marcus Webb (from SETUP-044), after a CI log accidentally printed the bundle.
**Goal**: Cut off `ci-nightly` quickly without affecting his laptop agent.
**Preconditions**: Console has agent `ci-nightly` with 1 active key.
**Surface**: web (browser)
**Ideal path**: 3 — Agents tab, `Revoke access`, confirm.
**Alternate paths**: API keys tab, `Revoke` on the single key; `agent-drive key revoke <key id>` from a CLI that holds `manage`.

##### Steps
1. `/console`, tab Agents → row "ci-nightly", badge "1 active key", button `Revoke access` (aria-label "Revoke access for ci-nightly").
2. Click it → confirm dialog titled "Revoke access for ci-nightly?" with message "1 active API key stops working now. Commands and MCP sessions that use it fail at their next request. Files this agent wrote stay in your drives." and button `Revoke 1 key`.
3. Click `Revoke 1 key` → toast "Revoked access for ci-nightly." Badge becomes "Access revoked" and the button disappears.

##### Variations
- Via API keys tab: `Revoke ci-nightly (issued by …)` → title "Revoke <label>?", message "Commands using this key stop working at their next request. This cannot be undone.", confirm `Revoke key`, toast "Revoked <label>.", badge "Revoked".
- CLI: `agent-drive key revoke <key id>`; the key id was printed by `credentials issue` ("with key <id>").

##### Edge Cases
- Revoking does not remove the drive key from the sandbox config. The leaked bundle also contains the drive key, which cannot be rotated here. Nothing in the dialog says the drive key is still known to whoever has the bundle. (Observation from code and docs, not verified at runtime.)
- The "Access revoked" agent row stays; there is no delete control in the row.
- Same fact on several surfaces: revoke is described in `docs/connect-an-agent.md`, `docs/sandboxes.md`, the connect page note "You can revoke access any time in Console, Agents.", and the CLI stderr line.
- Copy difference: "This cannot be undone." on the per-key dialog but not the agent dialog, though both are permanent.
- What the revoked sandbox sees at its next call is not shown in docs (unverified).

---

#### SETUP-046: Add a second agent using the recovery file on /connect
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-04`; surface class mixed; **Duplicate of** SETUP-022; overlaps SETUP-022, SETUP-043.


**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Tomoko Ishida, a researcher with a Cursor agent on her work laptop and an older Claude Code agent she set up months ago on a retired laptop. The old agent no longer has `delegate`, and the old machine is gone, but she downloaded `agent-drive-<drive id>.key.json` when she created the drive.
**Goal**: Give a new Claude Code agent access to the existing drive `thesis`, read only.
**Preconditions**: Account has drive `thesis`. Recovery file is in Downloads. New agent has the CLI.
**Surface**: mixed (CLI, web)
**Ideal path**: 6 — login, open link, Details, choose existing drive, supply file, Approve.
**Alternate paths**: `grant` (no agent with `delegate` is available), `credentials issue` (same reason), manual key (no drive key).

##### Steps
1. New agent runs `agent-drive login --name "thesis-claude"` → link, code, verification code printed.
2. Tomoko opens the link. Page tag "Pairing request", h1 "Connect thesis-claude?", summary "New encrypted drive · full access".
3. She hesitates: she wants the existing drive, not a new one. She clicks `Details`. She finds "Use one of my drives instead (needs its recovery file)".
4. Page now shows `Drive` select, `Drive key` ("Paste the drive key or an adcred1… bundle"), `Or choose a file`, checkbox `Read only`, `Only allow writes under (optional)`, link `Use a new drive instead`.
5. She selects `thesis`, clicks `Or choose a file` and picks the file, ticks `Read only`.
6. She types `Verification code` from the terminal, clicks `Approve agent`.
7. Done page "Access approved for thesis-claude". Terminal prints `Logged in as agent thesis-claude.` and `Usable drives: <thesis id>`. `agent-drive check` prints `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.` only if the drive is empty; here the drive has files, so `check ok ... (read-only)`.

##### Variations
- She pastes a drive key instead of choosing a file: allowed. If the drive has no files or trace inbox, the key cannot be checked: page note "This drive has nothing to check the key against, so it could not be checked before sending."
- Wrong key: "This key does not open the selected drive. Check the drive and paste its own key."
- Garbage file: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle."
- Bad folder in writes field: "Enter a folder that starts with / and does not end with /, for example /inbox/agent."

##### Edge Cases
- Hesitation point: summary line says "New encrypted drive · full access", and nothing on the first screen says existing drives are possible. The option is inside collapsed `Details`, and its label "(needs its recovery file)" omits that a pasted key or `adcred1.` bundle also works (`connect.tsx:685`).
- The option appears only on a new request and when the account already has a drive. On a reconnect it is absent.
- If Tomoko lost both the file and any agent holding the key, this path is closed. The recovery message on the unlock dialog suggests `agent-drive account seal --drive <id>` from an agent that holds the key, a different fix.
- Same fact on several surfaces: the three handoff choices appear in `docs/connect-an-agent.md` (table), `/llms.txt`, and the console "Connect an agent" panel intro ("or you add it to a drive your other agents already use"), but the console panel does not say how.

---

#### SETUP-047: Manual Agents and API keys path from the console
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-05`; surface class mixed; overlaps SETUP-015, SETUP-044.


**Type**: long
**Topic**: Second agent and sandbox continuity
**Persona**: Dev Patel, cautious backend developer who dislikes pasting a one-line prompt into an agent. He wants to create an identity and key himself and then connect a script on his server.
**Goal**: Create an agent named "invoice-bot", issue an API key limited to `read` and `write` on drive `finance-archive`, and connect a script.
**Preconditions**: Signed in, one drive `finance-archive` exists (created via `New drive`, recovery file saved). No agents yet.
**Surface**: mixed (web, CLI)
**Ideal path**: 9 — this path has more steps than the agent-first path and still ends without a usable drive key on the server.
**Alternate paths**: llms.txt prompt path (login device flow); `credentials issue` from an agent with `delegate`; recovery file on `/connect`.

##### Steps
1. `/console`, tab API keys. Header button `+ New API key`. Panel empty state: "Create an agent first." / "API keys belong to an agent and authorize specific drives." with button `Create agent`. (Dev had expected a key to be creatable directly.)
2. Click `Create agent` → dialog "An agent identity groups its keys, file versions, and activity." Field `Agent name` placeholder "Research assistant". He types `invoice-bot`, clicks `Create agent`. Reserved name `__console__` gives "That name is reserved for the human console."
3. Dialog closes, tab switches to API keys with notice "Agent created. Create an API key to connect it." Empty state now says "Your agent’s connection starts here." / "Issue a scoped key. You’ll see the secret only once." with `Create API key`.
4. Click `Create API key` → form: "Use a different key for each agent or machine. New keys do not grant access to future drives automatically." Fields `Key label` (placeholder "Research laptop"), `Agent`, fieldset `Allowed drives`, fieldset `Permissions` with `read`, `write`, `delete`, `share`, `manage` (read and write ticked). Dev enters label `invoice-bot prod`, ticks `finance-archive`, leaves read and write. There is no `delegate` and no write-path field here; a note appears only when restricted keys already exist ("This form cannot set write-path restrictions...").
5. Click `Create API key` → receipt: "This secret is shown only once. Store it securely and use it with `agent-drive login`. The service keeps only a hash." Textarea, `Copy API key`, checkbox `I saved my API key securely`, button `Done` (disabled until ticked).
6. On the server, Dev follows the panel "Connect without sharing your identity." but its text says "Run the CLI from the repository after building it." He already installed from npm and is confused; he continues with the shown block: `read -rs -p "API key: " AGENT_DRIVE_API_KEY; export AGENT_DRIVE_API_KEY`, `agent-drive login --api https://agentdrive.xyz`, `read -rs -p "Drive key: " AGENT_DRIVE_KEY; export AGENT_DRIVE_KEY`, `agent-drive put ./handoff.md /memory/handoff.md --drive <id>`, `agent-drive mcp`.
7. He must supply the drive key. He opens `finance-archive`'s recovery file and pastes the key at the second prompt. Without it, `agent-drive put` fails with "no usable drive key".
8. `agent-drive check` → `drive key not backed up: <id>` plus a hint, because the key came from `AGENT_DRIVE_KEY` (docs: keys supplied through `AGENT_DRIVE_KEY*` "do not need a backup record for `check`", so this may pass; behavior not verified).
9. Tab Agents shows `invoice-bot` with "1 active key"; tab API keys row shows `invoice-bot prod`, `read, write`, badge `Active`.

##### Variations
- Dev closes the receipt dialog before copying: no way to view the key again; he must revoke and create another ("To rotate access, create a replacement API key, update the agent, then revoke the old key.").
- Uses `printf '%s' "<key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin` (from `docs/connect-an-agent.md`): saves API key only and "does not give the machine any drive key".
- Chooses `manage` by mistake: label text "manage — account-wide administration; use sparingly".
- Opens Agents tab first: `Create your first agent`, with copy "Create an identity for your first agent, then issue a scoped API key."

##### Edge Cases
- Console panel contradicts docs: the Agents/API keys tab panel text "Run the CLI from the repository after building it." (`console.tsx` connection-guide) while every other surface says `npm install -g @dennisonbertram/agent-drive`.
- `--api` form differs: console block uses `--api <origin>` (no `/api`), docs use `--api https://agentdrive.xyz/api`. The CLI client rewrites the path to `/api/v1/` (`client.ts:387`), so both likely work; not run.
- Manual path never gives the server a sealed drive key, so the account-key seal (`account seal`) does not apply until an agent holds the key.
- Receipt text says "use it with `agent-drive login`", but plain `login` starts the device flow unless `AGENT_DRIVE_API_KEY` is set; the explicit `--token-stdin` form is not mentioned in the dialog.
- Same fact on several surfaces: "Keys stay with you." (sidebar) versus the receipt's "The service keeps only a hash."; both refer to different keys (drive vs API).

---

#### SETUP-048: Codex agent cannot write because MCP approval is "never"
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-06`; surface class mixed.


**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Aisha Bello, runs `codex exec` in scripts. She added Agent Drive MCP by copying the Codex snippet from the console panel.
**Goal**: Let the scripted Codex agent save a file with MCP `put`.
**Preconditions**: CLI logged in on her machine, `agent-drive check` prints `check ok`. MCP server configured from the console snippet.
**Surface**: mixed (web console, CLI, Codex)
**Ideal path**: 4 — copy snippet from llms.txt or `docs/mcp-tools.md` with approval blocks, restart Codex, run.
**Alternate paths**: CLI `agent-drive put` bypasses MCP; `default_tools_approval_mode = "approve"`.

##### Steps
1. In `/console`, tab Agents, expand "Connect an agent". Section for `Codex (~/.codex/config.toml)` shows `[mcp_servers.agent-drive]\ncommand = "agent-drive"\nargs = ["mcp"]`. She copies it into `~/.codex/config.toml`.
2. She runs `codex exec "save notes.md to Agent Drive"`. MCP `whoami` and `list` work (read-only).
3. `put` fails with "MCP tool call requires approval, but approval policy is never".
4. She reads `docs/mcp-tools.md` "Codex approval" and adds `[mcp_servers.agent-drive.tools.put]` and `[mcp_servers.agent-drive.tools.download]` with `approval_mode = "approve"`. She restarts Codex ("Restart the client after you change the saved credentials.").
5. Rerun succeeds.

##### Variations
- Aisha uses `default_tools_approval_mode = "approve"`: approves `delete`, `move`, `restore` and `share` too. Docs warn about it.
- She also needs `move`, `copy`, `delete`, `restore` or `share`: each fails with the same message until added; docs name 7 refused tools but the sample block shows only `put` and `download`.
- Claude Code via `claude mcp add agent-drive -- agent-drive mcp` needs no approval edit.

##### Edge Cases
- Contradiction: console snippet lacks approval blocks; `docs/mcp-tools.md` and `llms.txt` (`apps/web/app/llms.txt/route.ts:126-140`) include them.
- Several drive keys on the machine: MCP tools return an error listing drive IDs and she must pass `driveId`.
- MCP cannot do login, check, credentials or grant. If `AGENT_DRIVE_CREDENTIALS` is set in the Codex sandbox, MCP reads it at start; a bundle change needs a restart.
- Same fact: "13 tools" in the docs versus tool list of 7 refused and 6 allowed (counts differ by page; not exact in the prompt copy).

---

#### SETUP-049: Sandbox with a read-only credentials bundle and an empty drive
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-07`; surface class CLI; **Duplicate of** SETUP-030; overlaps SETUP-030, SETUP-027.


**Type**: short
**Topic**: Second agent and sandbox continuity
**Persona**: Leila Haddad, security reviewer. Her agent "auditor" runs in a sandbox with a read-only bundle and must report setup done only when `check ok` appears.
**Goal**: Confirm the read-only sandbox works.
**Preconditions**: Bundle issued by `credentials issue --name auditor --scope read --stdout | <store>` and set as `AGENT_DRIVE_CREDENTIALS`. Drive is empty.
**Surface**: CLI
**Ideal path**: 3 — `whoami`, `check`, wait for another agent to write, `check` again.
**Alternate paths**: ask a writer agent to `put` a file first, then run `check`.

##### Steps
1. `agent-drive whoami` → shows agent `auditor`, scopes `read`.
2. `agent-drive check` → `check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.` Exit code 1.
3. Another agent runs `agent-drive put ./hello.md /memory/hello.md --drive <id>`. Leila reruns `agent-drive check` → `check ok ... (read-only)`.

##### Variations
- A sandbox run that treats exit 1 as "broken" and retries login: docs say "Do not report setup as complete until it prints `check ok`."

##### Edge Cases
- A read-only agent cannot be told apart from broken by the exit code and wording ("not verified" reads like failure).
- Same fact on `docs/sandboxes.md` (common failures) and the CLI help string for `check`; the web console does not mention it.

---

#### SETUP-050: Agent loses delegate and the owner re-approves
**Catalog notes**: temporary ID `STORY-SECOND-AGENT-SANDBOX-08`; surface class mixed; overlaps SETUP-023, SETUP-044.


**Type**: medium
**Topic**: Second agent and sandbox continuity
**Persona**: Jonas Keller, indie developer. His agent was approved last month with default options (no `delegate`). Today he asks it to set up a second sandbox agent.
**Goal**: Get `delegate` onto the existing agent, then issue credentials for the sandbox.
**Preconditions**: Agent `jonas-dev agent` logged in without `delegate`. Sandbox has no browser.
**Surface**: mixed (CLI, web)
**Ideal path**: 5 — try issue, read error, re-run login with same name, tick the checkbox on `/connect`, issue again.
**Alternate paths**: recovery file on `/connect` for the sandbox (sandbox has no browser, but Jonas does, so the new agent's `login --no-browser` can still print a link); manual API key (no drive key).

##### Steps
1. Agent runs `agent-drive credentials issue --name "sandbox-1" --stdout | <store>` → API rejects with "The API key needs the delegate scope." (surfacing format not verified).
2. Per docs the agent runs `agent-drive login --name "jonas-dev agent"` again (reconnect, same name and API origin). CLI sends saved key as proof.
3. Jonas opens `/connect?code=…`. Summary shows reconnect. In `Details`, he ticks "Let this agent add other agents to its drives" (small print about handing out the drive).
4. He types the verification code and clicks `Approve agent`.
5. CLI prints `Logged in as agent jonas-dev agent.` and, since this is a reconnect: `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.`
6. Agent re-exports credentials then reruns `credentials issue`.

##### Variations
- Jonas ticks the checkbox on `/connect` but also leaves defaults; delegate is never inherited on reconnect, he must tick again each time (`device.ts:664-683`).
- Jonas forgets to re-export after the reconnect; next sandbox fails with `drive key not backed up`.

##### Edge Cases
- Old bundles issued by this agent still work? Unknown from code; not stated in docs.
- The checkbox is visible only inside collapsed `Details`; the summary line does not mention it.
- Same fact across surfaces: "Let this agent add other agents to its drives" (connect page) versus "Let this agent add other agents" (`docs/sandboxes.md`, llms.txt line 113). Wording differs between surfaces.
- Consequence of reconnect: it issues a new API key, so every earlier bundle is out of date; docs state this for backups, but do not say whether the old key stops working.

---

### Topic: Desktop mounts (SETUP-051 to SETUP-058)

Source file: `docs/ux-paths/topics/setup-desktop-mounts.md`.

#### SETUP-051: Mount a drive in Finder for the first time
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-01`; surface class mixed; overlaps SETUP-052, SETUP-053.

**Type**: long
**Topic**: Desktop mounts
**Persona**: Priya Nair, a freelance data analyst on a MacBook (macOS 15.7), already finished `agent-drive login` yesterday with Claude Code. She wants to drag report PDFs into the drive from Finder.
**Goal**: See her drive as a folder in Finder and drop a file into it.
**Preconditions**: CLI installed and logged in, one drive key saved, backup confirmed. Finder app not downloaded.
**Surface**: mixed (CLI, Finder, web docs)
**Ideal path**: 5 — download zip, drag to /Applications, run one mount command, open Finder row, drop file.
**Alternate paths**: Ask the agent to run it (the skill `skills/agent-drive/SKILL.md:157` tells it to download and mount); `agent-drive mounts add NAME MOUNTPOINT --drive ID` then `agent-drive mount --name NAME`; install the app from source via `native/macos/build-app.sh` (developers only).
##### Steps
1. Priya opens agentdrive.xyz and looks for "Finder" or "mount" in the header (`Pricing`, `Docs`, `Sign in`, `Sign up free`) → finds nothing on the landing page. She types "mount" in her search engine and ends on the Docs page `cli` (`docs/cli.md`). The only place the app link lives is the long paragraph at `docs/cli.md:20` and the section "macOS requirements and unmounting".
2. She clicks the link "Agent Drive Finder 0.3.1" → GitHub release `finder-v0.3.1` downloads `Agent-Drive-Finder-0.3.1.zip`.
3. She double-clicks the zip, then drags `Agent Drive.app` to `/Applications` → no feedback; the app has no installer.
4. She double-clicks `Agent Drive.app` "to see if it works" (the README says "open it once", `packages/agent-drive/README.md:38`) → nothing visible happens. `docs/cli.md:20` says "Opening the app from Finder does not open a window", so she may still wonder whether it failed. Hesitation point.
5. In Terminal she runs `agent-drive mount "$HOME/AgentDrive"` → the command stays in the foreground (no prompt returns). No success line is documented.
6. She opens Finder → under Locations a row `Agent Drive` appears. She drags `Q3-report.pdf` in → file appears; it encrypts on her machine.
7. She presses Ctrl+C once in Terminal → the CLI disconnects the Finder domain and returns; the Finder row goes away.
##### Variations
- With two drives saved the CLI exits asking for `--drive ID`; the Finder row then reads `Agent Drive` plus the first 8 characters of the drive ID (`docs/cli.md:258-260`).
- `--read-only` for browse-only.
- Mountpoint path differs from what Finder chooses: the CLI creates a symlink at the requested path if it is free and removes it on exit (`docs/cli.md:264-266`).
##### Edge Cases
- She closes Terminal to tidy up: the mount disappears (foreground process). Nothing explains this on first read; `--persist` exists only for `connect`, and the drive mount needs `mounts service install NAME`, which needs a prior `mounts add`.
- App placed in `~/Downloads` instead of `/Applications`: the helper path is not found. The documented fix is `AGENT_DRIVE_FINDER_HELPER` with an absolute path (`docs/cli.md:248`); the exact user-facing error text for a missing helper was not confirmed.
- Same fact on several surfaces: app download link appears in `docs/cli.md:20,240`, `native/macos/README.md:9`, `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157`. None on the web app or `/llms.txt`.
- Contradiction: "open it once" (`packages/agent-drive/README.md:38`, `SKILL.md:157`) versus "Opening the app from Finder does not open a window; the Finder location appears when the CLI starts a mount" (`docs/cli.md:20`, `native/macos/README.md:9`).

---

#### SETUP-052: Finder shows "Agent Drive is not enabled"
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-02`; surface class mixed; overlaps SETUP-051.

**Type**: medium
**Topic**: Desktop mounts
**Persona**: Marcus Webb, indie developer, new MacBook Air. He just dragged the app into `/Applications` and runs the mount.
**Goal**: Get the Finder extension enabled and the mount working.
**Preconditions**: App in `/Applications`, CLI logged in, extension not yet enabled in System Settings.
**Surface**: mixed (CLI, Finder, System Settings)
**Ideal path**: 4 — run mount, click `Enable` in the Finder banner, rerun mount, open row.
**Alternate paths**: Enable the extension in System Settings (the CLI error says so); run `/usr/bin/pluginkit -a "$APP_PATH/Contents/PlugIns/AgentDriveFileProvider.appex"` when macOS never discovers it (`docs/cli.md:250-256`).
##### Steps
1. Marcus runs `agent-drive mount "$HOME/AgentDrive"` → the CLI fails with one of the safe diagnostics, for example "The Agent Drive File Provider extension is disabled. Enable it in System Settings, then retry." (`mount-mac.ts:32`).
2. He opens Finder; the sidebar has an `Agent Drive` row with the banner "Agent Drive is not enabled. To access Agent Drive click Enable." (docs `docs/cli.md:260-261`). He is unsure whether to follow the terminal text (System Settings) or the Finder banner (`Enable`). Hesitation point: two different instructions for one problem.
3. He clicks `Enable` in the banner → the extension is turned on.
4. He reruns `agent-drive mount "$HOME/AgentDrive"` → the mount holds; the `Agent Drive` row opens a folder.
##### Variations
- Other CLI diagnostics point elsewhere: "macOS could not register the Agent Drive File Provider. Open Agent Drive.app from /Applications and retry." (`mount-mac.ts:36`), "macOS has not authenticated the Agent Drive File Provider. Open Agent Drive.app and retry." (`:48`), "The macOS File Provider service is unavailable. Check the Agent Drive extension in System Settings and retry." (`:44`). Three different places to go (System Settings, the app, the Finder banner).
- "Agent Drive Finder cannot access its shared container. Reinstall Agent Drive.app from the official download, then retry." (`mount-mac.ts:28`) if he used an unsigned local build.
##### Edge Cases
- The banner never appears because Finder was closed: he has to find the row himself.
- The extension is toggled in System Settings, but the Settings location is not named (no path like "General > Login Items & Extensions" in any copy).
- If macOS never discovers the extension, the only fix is a `pluginkit` command that only appears in `docs/cli.md`, not in any error message.
- Copy mismatch: the Finder banner fix (`Enable`) is in docs, while three CLI messages point to System Settings or Agent Drive.app instead.

---

#### SETUP-053: Mount a drive on a Linux server with FUSE
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-03`; surface class CLI; overlaps SETUP-051, SETUP-054.

**Type**: medium
**Topic**: Desktop mounts
**Persona**: Tomasz Kowalski, DevOps engineer on Ubuntu 24.04 x64 laptop, Node 24, logged in as `tomasz`.
**Goal**: Browse his drive as a directory under `~/AgentDrive`.
**Preconditions**: CLI installed globally from npm, logged in, drive key saved. FUSE userspace tools may be missing.
**Surface**: CLI
**Ideal path**: 2 — `mkdir`-free `agent-drive mount "$HOME/AgentDrive"`, then browse (the CLI creates the directory if its parent exists).
**Alternate paths**: `agent-drive mounts add NAME ...` plus `mounts service install NAME` for login startup; `AGENT_DRIVE_MOUNT_HELPER` for a custom helper.
##### Steps
1. Tomasz runs `agent-drive mount "$HOME/AgentDrive"` → on a machine without `fusermount3` the command fails. The docs say "The CLI does not install system FUSE support" (`docs/cli.md:20`) and list the needs: working FUSE, `/dev/fuse`, `fusermount3` or `fusermount` (`docs/cli.md:217-219`). The exact error text for missing `fusermount` was not confirmed.
2. He installs the distribution's fuse package himself, reruns → the command stays in the foreground.
3. In a second terminal he runs `ls "$HOME/AgentDrive"` → his files list.
4. He tries `echo hi > "$HOME/AgentDrive/notes.txt"` → succeeds only if the key has `write` scope; `--read-only` or a read-only key blocks it. Deleting or replacing needs `delete` too (`packages/agent-drive/README.md` and `SKILL.md:150-153` area).
5. He presses Ctrl+C once in the mount terminal and waits → unmounts after flushing staged writes.
##### Variations
- Mountpoint is an existing non-empty directory: refused ("empty directory owned by the current user and must not be a symlink", `docs/cli.md:221`).
- He has an arm64 box; the package ships helpers for x64 and arm64 only.
- A second Ctrl+C forces exit and can interrupt writes; a stale mount is cleared with `fusermount3 -u "$HOME/AgentDrive"` (or `fusermount -u`).
##### Edge Cases
- Running in a Docker container without `/dev/fuse`: fails; the docs name the requirement but no container hint.
- Alpine or musl hosts are not mentioned; only "x64 and arm64".
- Trap: on macOS the docs say the mountpoint is used by Finder and a free path gets a symlink; on Linux an existing directory must be empty. Same command, opposite mountpoint expectations.

---

#### SETUP-054: Windows user tries to mount
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-04`; surface class CLI; overlaps SETUP-053.

**Type**: short
**Topic**: Desktop mounts
**Persona**: Aisha Rahman, product manager on Windows 11 (PowerShell), whose engineer set up Agent Drive for her team. She wants a drive letter or folder.
**Goal**: Mount the drive on Windows.
**Preconditions**: Node 24 installed, CLI installed with `npm install -g @dennisonbertram/agent-drive`, logged in.
**Surface**: CLI
**Ideal path**: 1 — none; the supported route is the console in the browser or `get`/`put`. Mount is not available on Windows.
**Alternate paths**: Use the web console Files tab (`/console`); use `agent-drive get REMOTE --output FILE`; use WSL (Linux FUSE) if it works, unverified.
##### Steps
1. Aisha runs `agent-drive mount "$HOME\AgentDrive"` → "No packaged Agent Drive mount helper is available for this platform." (`mount.ts:1231`). She cannot tell if she did something wrong or if Windows is unsupported.
2. She searches the docs; `docs/cli.md` describes only Linux x64/arm64 and macOS 13+. No document says "Windows is not supported" (discovery-setup.md section 4).
3. She falls back to the console Files tab at `/console`.
##### Variations
- She tries `agent-drive connect coordinator C:\Work --sandbox m_abc --root /workspace` → the mountpoint is validated as an absolute path and the mount fails similarly on a non-darwin non-Linux platform (not confirmed).
- Windows-specific hint that exists elsewhere: `credentials export --to clipboard` explicitly supports "macOS and Windows" (`docs/cli.md:628`), which suggests Windows is a supported CLI platform, making the mount error more surprising.
##### Edge Cases
- WSL: the clipboard doc treats WSL as Linux (`docs/cli.md:628`); whether FUSE works there is undocumented.
- An 8-character-wide Windows path such as `C:\` fails mountpoint validation ("Invalid mountpoint; use an absolute path." depends on POSIX `isAbsolute`; unverified on Windows).

---

#### SETUP-055: Connect a live Instabox workspace and keep it across logins
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-05`; surface class mixed; overlaps SETUP-056, SETUP-057, SETUP-058.

**Type**: long
**Topic**: Desktop mounts
**Persona**: Dana Okafor, engineer coordinating three coding agents in Instabox sandboxes from her Mac. She wants each agent's `/workspace/project` folder visible in Finder, and the mount to survive reboots.
**Goal**: Mount sandbox `m_7f3a...` folder `/workspace/project` at `~/AgentWorkspaces/coordinator` and start it automatically at login.
**Preconditions**: macOS, Finder app installed and enabled, CLI installed (no Agent Drive login needed), `instabox` CLI installed in `/opt/homebrew/bin`.
**Surface**: mixed (CLI, Finder)
**Ideal path**: 3 — `mkdir -p`, `connect ... --persist`, open Finder.
**Alternate paths**: `connect ...` without `--persist`, then `mounts service install coordinator`; `mounts add NAME MOUNTPOINT --sandbox ID`; ask the agent (skill `skills/agent-drive/SKILL.md:171` has the exact commands).
##### Steps
1. Dana reads `docs/cli.md` "Live workspace mounts" and runs `mkdir -p "$HOME/AgentWorkspaces"` → ok. She does not know the doc's `SANDBOX_ID` placeholder must be an `m_...` machine ID.
2. She runs `agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" --sandbox "my-sandbox" --root /workspace/project --persist` → "Invalid Instabox sandbox ID; use its exact m_... ID, not a name or alias." (`mount-registry.ts:199`). Error recovery is clear but the docs never say where to find the ID.
3. She finds the ID with the Instabox tool and reruns with `--sandbox m_7f3a... --root /workspace/project --persist` → the CLI prints the saved entry as JSON, then the service runtime status (`cli.ts:870-872`), then returns (no foreground process).
4. She opens Finder → a location row for `coordinator` (the Finder row name for live mounts was not confirmed) shows the sandbox files including hidden `.env`.
5. She drops a new file in it → creates fine. She edits an existing file and saves → fails with a read-only error (`docs/cli.md:186-189`).
6. She copies her local env: `cp -n "$LOCAL_ENV_FILE" "$HOME/AgentWorkspaces/coordinator/.env"` → copies only if none exists.
7. She reboots → the login service restores the mount; `agent-drive mounts status coordinator` reports the local mountpoint state.
##### Variations
- `--read-only` saves a read-only definition.
- `mounts list` reads the registry only and never wakes the sandbox.
- Registering a second name for the same sandbox folder is rejected: "This workspace is already registered as 'coordinator' at <path>. Use that Finder mount instead of adding an alias." (`mount-registry.ts:412`).
##### Edge Cases
- She runs `mkdir -p "$HOME/AgentWorkspaces/coordinator"` too: "Finder mountpoint already exists: <path>" (`mount-registry.ts:162`). The docs only mkdir the parent but a natural habit is to mkdir the whole path. Hesitation and error point.
- Parent missing: "Finder mountpoint parent does not exist: <path>".
- Name violates the pattern: "Invalid mount name; use 1-64 letters, digits, "-" or "_", starting with a letter or digit."
- Typo in `--root` (not absolute or not normalized): "Invalid workspace root; use a normalized absolute sandbox path." (`mount-registry.ts:217`).
- Service does not start: "Workspace service 'coordinator' did not become active." (`cli.ts:424`).
- Naming mismatch: the feature is called a "sandbox" here but `docs/sandboxes.md` uses "sandbox" for a disposable machine running the agent; a reader landing on `/docs/sandboxes` finds nothing about `connect`.

---

#### SETUP-056: Instabox CLI is missing
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-06`; surface class CLI; overlaps SETUP-055.

**Type**: short
**Topic**: Desktop mounts
**Persona**: Leo Martin, designer on a fresh Mac who was told by a teammate to "just connect the workspace". He has never heard of Instabox.
**Goal**: Mount a teammate's sandbox folder.
**Preconditions**: Agent Drive CLI installed, Finder app installed, no `instabox` binary.
**Surface**: CLI
**Ideal path**: 3 — install Instabox, rerun `connect`, open Finder.
**Alternate paths**: none found (Instabox install is not documented anywhere in this repo).
##### Steps
1. Leo runs `agent-drive connect design "$HOME/AgentWorkspaces/design" --sandbox m_91c2 --root /workspace/site --persist` → the CLI cannot start the service: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." (`workspace-service.ts:159`; the code also searches `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, so the message under-lists the search paths).
2. He searches the docs for "Instabox" → `docs/cli.md` and `packages/agent-drive/README.md:49` ("Mount an existing Instabox workspace") use the word with no install link or account hint. Dead end for a newcomer.
3. He asks his teammate, installs Instabox, reruns `connect` → works.
##### Variations
- Without `--persist` the foreground mount path wakes the sandbox through the same CLI on first access and fails the first read instead.
##### Edge Cases
- The first failed `connect` may already have saved a registration. Rerunning with the same name could hit "A mount named 'design' is already registered." (`mount-registry.ts:410`). `cli.ts:878` unregisters on a foreground failure only when unchanged; whether the `--persist` path rolls back was not confirmed.
- Instabox installed to a custom path outside the searched directories is not found even though it is on `PATH` for the user's shell if launchd's PATH differs (service environment not confirmed).

---

#### SETUP-057: Sandbox is asleep and wake is off
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-07`; surface class mixed; overlaps SETUP-055, SETUP-056.

**Type**: medium
**Topic**: Desktop mounts
**Persona**: Grace Liu, platform engineer who pays per running sandbox. She wants her mount to leave a sleeping sandbox alone until she decides.
**Goal**: Turn wake-on-access off for `coordinator`, then turn it on when she needs the files.
**Preconditions**: `coordinator` registered with `--persist` (service active); the sandbox is stopped.
**Surface**: CLI and Finder
**Ideal path**: 3 — `mounts wake coordinator off`, check, `mounts wake coordinator on`.
**Alternate paths**: reconnect with `--no-wake-on-access` at creation; `mounts service remove coordinator` to stop it entirely.
##### Steps
1. Grace runs `agent-drive mounts wake coordinator off` → the saved entry prints with `wakeOnAccess: false`; the managed service is restarted after a graceful stop (`docs/cli.md:179-181`, `cli.ts:1009-1056`).
2. She opens `~/AgentWorkspaces/coordinator` in Finder → the folder fails to read. The CLI side error is "Instabox machine is stopped; wake-on-access is disabled." (`workspace-wake.ts:240`), but it appears in the service log, not in Finder. What Finder shows to the user was not confirmed.
3. She runs `agent-drive mounts wake coordinator on` → the policy flips back and the service restarts again.
4. She opens the folder → the first file access starts the sandbox; this can take a while.
5. If the sandbox is stuck: "Instabox workspace wake timed out." or "Instabox machine did not reach the running state." (`workspace-wake.ts:261,272`).
##### Variations
- A foreground mount uses the wake setting loaded at startup; she must stop it cleanly and rerun `agent-drive mount --name coordinator` (`docs/cli.md:181-182`).
- `mounts wake` with an unmanaged conflicting service: "Cannot change wake policy because the managed service 'coordinator' is not the exact owned definition." (`cli.ts:1033`).
- Unknown state such as `error`: "Instabox machine is in unsupported state: error."
- Wrong usage: `agent-drive mounts wake coordinator maybe` → "Usage: mounts wake NAME on|off".
##### Edge Cases
- Contradictory copy: `docs/cli.md:176-178` says wake runs on first file I/O and "does not call Instabox" when changing the setting, yet changing the setting resolves the Instabox executable (`cli.ts:1019-1026`), so a missing Instabox fails `mounts wake`.
- Finder or Spotlight indexing can wake the sandbox unintentionally (`docs/cli.md:209-211` warns "Finder or another file browser can therefore wake the sandbox"). This warning sits far from the `--no-wake-on-access` flag description.

---

#### SETUP-058: Forget and clean up a mount
**Catalog notes**: temporary ID `STORY-DESKTOP-MOUNTS-08`; surface class CLI; overlaps SETUP-055.

**Type**: short
**Topic**: Desktop mounts
**Persona**: Ben Hart, tidying up after a project ends. He no longer wants the `coordinator` login service or mount.
**Goal**: Remove the service and forget the mount without touching sandbox files.
**Preconditions**: `coordinator` registered with `--persist`.
**Surface**: CLI
**Ideal path**: 2 — `mounts service remove coordinator`, `mounts forget coordinator`.
**Alternate paths**: none found.
##### Steps
1. Ben runs `agent-drive mounts forget coordinator` first → refused: "Cannot forget 'coordinator' while its login service is <state>. Remove or repair it with `agent-drive mounts service remove coordinator` first." (discovery section 4).
2. He runs `agent-drive mounts service remove coordinator` → the owned startup definition is removed; registration and sandbox files remain.
3. He runs `agent-drive mounts forget coordinator` → if the Finder mountpoint is still present: "Cannot forget 'coordinator' while its Finder mountpoint is present. Stop the mount and try again."; otherwise prints `{"forgotten":"coordinator"}`.
##### Variations
- After Ctrl+C on a foreground mount, `mounts forget` succeeds directly.
##### Edge Cases
- Unknown name: "No mount registered as 'coordinator'." (`mount-registry.ts:330`).
- Missing name: "Usage: mounts forget NAME" (`cli.ts:972`).
- No command is named "disconnect" or "unmount" for live workspaces; the verb split (`mounts forget` versus Ctrl+C versus `mounts service remove`) is not summarized in `agent-drive --help` (`cli.ts:1722-1745` lists `mounts forget NAME` as "Forget an offline live workspace registration").

---

### Topic: OpenRouter webhook and trace capture (SETUP-059 to SETUP-068)

Source file: `docs/ux-paths/topics/setup-webhook-capture.md`.

#### SETUP-059: Add the first webhook on an unlocked drive with a loaded key
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-01`; surface class web; overlaps SETUP-060, SETUP-067.

**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Priya Raman, a developer running agents through OpenRouter. She created the drive "priya-agents" in this tab ten minutes ago and has just clicked "I saved it" on the receipt.
**Goal**: Send OpenRouter traces into the drive.
**Preconditions**: Signed in with Clerk; drive has at least one file or was created in this tab (so the key is "trusted"); no trace inbox, no webhook token.
**Surface**: web (browser) plus OpenRouter's site (outside the app)
**Ideal path**: 4 — click `Capture…`, click `Add webhook`, click `Copy webhook URL`, click `Copy headers JSON` (then paste into OpenRouter).
**Alternate paths**: Drive menu `Capture traces…`; the `/traces` empty-state link `add an OpenRouter webhook`; local `agent-drive capture --drive <id> -- claude` instead (no OpenRouter, traces under `/traces/<agent>/`).
##### Steps
1. On Files, click `Capture…` in the toolbar → dialog "Capture traces" opens with "Local agents" (install and capture commands) and "OpenRouter webhook" with `Loading…`, then button `Add webhook`.
2. Click `Add webhook` → "Setting up…" shows. The key is already in the tab, so no unlock dialog. Console reads `drives/<id>/trace-inbox`, finds none, verifies the key against a drive file, creates the inbox in the browser, then makes strict calls.
3. Clerk shows its own reverification prompt; Priya confirms her sign-in. The dialog is hidden while Clerk's prompt is open (`native-dialog-suspension`) and returns afterward.
4. Dialog shows "Copy these now. The token is shown once. In OpenRouter, add a Webhook destination." with `Webhook URL` (`https://<origin>/api/webhooks/openrouter/<drive id>`) and `Headers` (`{"Authorization":"Bearer adw_..."}`). Row now reads "Created <time>" `Active` with `Replace` and `Revoke`.
5. Click `Copy webhook URL`, then `Copy headers JSON` → copy buttons confirm. She pastes each into OpenRouter's Webhook destination form, leaves Privacy Mode off per the note "In OpenRouter, leave Privacy Mode off for this destination, or traces will contain no prompts or replies."
6. She closes the dialog and returns to Files; the account now has an agent named `openrouter` (created by the token, `handler.ts:2745`), and the console reloads (`refresh()`).
##### Variations
- Priya copies only the URL and forgets the header; OpenRouter's test returns 401 (docs `trace-capture.md:142`).
- She uses the terminal check from `docs/trace-capture.md:158` with `X-Test-Connection: 1` and expects `{"ok":true}`.
##### Edge Cases
- Hesitation: step 1, she looks for "webhook" in the toolbar and finds `Traces` first. That button opens the folder, not the setup.
- Closing the dialog while "Setting up…" is not possible (`closable` false while `tracesBusy`).
- She is not told the setup also creates an `openrouter` agent; she may see it in the Agents tab later.

---

#### SETUP-060: Click Add webhook on a locked drive, unlock, and resume
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-02`; surface class web; overlaps SETUP-059, SETUP-037, SETUP-039.

**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Marcus Webb, a returning user on a new laptop. He signed in to Clerk, has an account passphrase, and the drive "research-bots" is sealed into his account. The vault is locked.
**Goal**: Add an OpenRouter webhook for "research-bots".
**Preconditions**: Vault locked; drive key not in this tab; drive not agent-only; has files.
**Surface**: web (browser)
**Ideal path**: 5 — `Capture…`, `Add webhook`, type passphrase and `Unlock`, (Clerk confirm), copy URL; headers copy is a sixth click.
**Alternate paths**: If he has a passkey, the unlock dialog opens in passkey mode ("Unlock with your passkey", button `Unlock with passkey`); `Use your passphrase instead`; `Choose recovery file`; "Paste a key instead" with `Load key`.
##### Steps
1. Click `Capture…` → dialog "Capture traces" opens.
2. Click `Add webhook` → `webhookKey()` finds no cached key and the vault is locked. The Capture dialog closes and the unlock dialog opens, title "Unlock with your passphrase", containing the note "After you unlock, you can set up the OpenRouter webhook." (`console.tsx:4295`).
3. Marcus types his passphrase and clicks `Unlock` → vault opens, slot key is read, Capture dialog reopens and starts setting up on its own (`resume` → `resumeWebhook` → `openTraces(found)`); "Setting up…" appears without a second click on `Add webhook`.
4. Clerk reverification prompt; he confirms.
5. Token appears with `Webhook URL` and `Headers`; he copies both.
##### Variations
- Passkey account: step 2 opens "Unlock with your passkey" with note; button `Unlock with passkey` shows "Waiting for your passkey…".
- "No recovery file?" help in the recovery mode mentions `agent-drive account seal --drive <id>`.
- He has "keep unlocked" checked; vault stays open 30 minutes, then "Locked after 30 minutes without use. Enter your passphrase to continue." (`console.tsx:494`).
##### Edge Cases
- After unlocking Marcus may be confused that he is back in a fresh Capture dialog and not on Files. The unlock note promises this ("you can set up"), but it reads as if he must click again, while the code actually continues automatically.
- If he closes the unlock dialog, nothing resumes; he must click `Add webhook` again.
- Wrong passphrase: PassphraseForm shows its own error; Capture dialog stays closed.

---

#### SETUP-061: Agent-only drive: recovery file needed, mismatched file chosen
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-03`; surface class web; overlaps SETUP-060, SETUP-039, SETUP-040.

**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Lena Okafor, ops engineer. An agent created "ci-traces" for her; its key is on the CI machine only. She has two recovery files in Downloads: `agent-drive-drv_ci.key.json` and an older `agent-drive-drv_old.key.json`.
**Goal**: Add a webhook to "ci-traces".
**Preconditions**: Drive is agent-only (not in her account); unlocked vault; drive has files.
**Surface**: web (browser)
**Ideal path**: 5 — `Capture…`, `Add webhook`, `Choose recovery file`, pick file, (Clerk confirm), copy URL.
**Alternate paths**: "Paste a key instead" → `Drive key or credentials bundle (adcred1.…)` → `Load key`; on the CI machine run `agent-drive credentials export` (shown in the dialog as `Copy credentials export command`).
##### Steps
1. `Capture…` → `Add webhook` → unlock dialog opens in recovery mode titled "Load the key for ci-traces" with the notice "Agent-only: open with a recovery file." (`console.tsx:498`) and the note "After the key loads, you can set up the OpenRouter webhook."
2. Lena chooses the old file by mistake via `Choose recovery file` → the dialog verifies the key against the drive; the wrong key is rejected with the unlock-side text (not the Capture-side text).
3. She chooses the right file → Capture dialog reopens and sets up automatically; Clerk prompt; token shown.
##### Variations
- Pasted key whose source is `pasted` and drive has files: verification against a file succeeds, setup proceeds.
- A credentials bundle `adcred1.…` counts as drive-bound (`isDriveBoundSource`), so it works even on an empty drive.
##### Edge Cases
- Where the mismatch is caught depends on where the key came from: unlock dialog (`MISMATCH`, `console.tsx:497`, "account copy is invalid") versus Capture dialog (`webhook-setup.ts:17`, "This key does not open this drive’s files."). Different words for one failure (copy finding 2).
- The "account seal" instruction is hidden for agent-only drives (`!agentOnly`), so Lena has only recovery file or paste.

---

#### SETUP-062: Empty new drive with a pasted key
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-04`; surface class mixed; overlaps SETUP-059, SETUP-067.

**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Tomás Ibarra, set up a drive for a small side project on the CLI and wants traces before any file exists.
**Goal**: Set up the webhook on a drive with no files and no inbox.
**Preconditions**: Drive has zero files and no trace inbox; key not in tab; Tomás has the plain base key text only (not the file or bundle).
**Surface**: mixed (CLI then web)
**Ideal path**: 6 — `Capture…`, `Add webhook`, "Paste a key instead", paste, `Load key`, then read error and switch to `Choose recovery file`.
**Alternate paths**: Use the credentials bundle (`agent-drive credentials export`); use recovery file; or write any file first (`agent-drive put`) so the key can be checked; or `agent-drive capture` locally.
##### Steps
1. `Capture…` → `Add webhook` → unlock dialog (recovery mode, since signed-out of vault or not enrolled) with note about setting up the webhook.
2. Open "Paste a key instead", type the key into `Drive key or credentials bundle (adcred1.…)` → `Load key`.
3. Console cannot find a file or inbox to check the key against. Either the unlock dialog rejects it with "This drive has no file or trace inbox to confirm the key. Use a recovery file or credentials bundle for an empty drive." (`console.tsx:2600`) or, once the key reaches the Capture dialog, the error reads "This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive." with a `Retry` button (`traces-dialog.tsx:211`).
4. Tomás clicks `Retry`: the same error returns, because the pasted key is the same. Retry does not reopen the unlock dialog.
5. He exports a bundle on the CLI with `agent-drive credentials export`, pastes `adcred1.…`, and succeeds.
##### Variations
- Recovery file from the drive's receipt works the first time.
##### Edge Cases
- `Retry` offered for an error that retrying cannot fix is a clarity problem.
- Two wordings for the same fact (copy finding 3).
- Wrong-drive key on an empty drive cannot be detected at all; only recovery material that names the drive is accepted.

---

#### SETUP-063: Cancel Clerk reverification, then retry
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-05`; surface class web; overlaps SETUP-041.

**Type**: short
**Topic**: OpenRouter webhook and trace capture
**Persona**: Hana Sato, who clicked `Add webhook` while on a shared desk and is interrupted when Clerk asks for her password.
**Goal**: Get a token after cancelling once.
**Preconditions**: Drive unlocked, key loaded; Clerk prompt requires strict reverification.
**Surface**: web (browser)
**Ideal path**: 3 — `Add webhook`, cancel prompt, `Retry`.
**Alternate paths**: Reclick `Add webhook` is not available; only `Retry` is (the add button is still visible when no token exists, so clicking `Add webhook` again also works).
##### Steps
1. Click `Add webhook` → "Setting up…" → Clerk prompt appears (dialog hidden).
2. Cancel the Clerk prompt → the Capture dialog returns and shows an error row (`role="alert"`) with a `Retry` button. The text is the raw error message from Clerk's cancel (`traces-dialog.tsx:107`); it is not the "Confirm it’s you to …" wording that vault actions use (`console.tsx:515`).
3. Click `Retry` → Clerk prompt appears again; she confirms.
4. Token shown as in SETUP-059.
##### Variations
- Cancel at the second prompt (token challenge): inbox is already created; the next attempt skips creation and goes straight to issuing the token.
- Session already freshly verified: no prompt at all.
##### Edge Cases
- Hesitation: after cancel the dialog looks like it did before except for the error; some users will not know whether anything was created. In fact an inbox may exist but no token.
- The dialog cannot be closed while `Setting up…`, so while Clerk's prompt is up Hana cannot back out of the Capture dialog itself.

---

#### SETUP-064: Save the token for later, lose it, then Replace
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-06`; surface class web; overlaps SETUP-065, SETUP-066.

**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Ravi Menon, who closed the dialog before pasting the header into OpenRouter, then comes back the next day.
**Goal**: Recover a lost one-time token.
**Preconditions**: A token exists (`Active`), secret was never copied.
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Replace`, copy headers.
**Alternate paths**: `Revoke` then `Revoke webhook` then `Add webhook` (more clicks, same result); nothing in the UI or CLI can show the old token (`docs/trace-capture.md:134`: "a lost token cannot be shown again. Replace it.").
##### Steps
1. `Capture…` → row shows "Created <time>", state `Active`, buttons `Replace` and `Revoke`. No URL or header is visible.
2. Ravi looks for a "show token" option; there is none. He clicks `Replace`.
3. Same flow as `Add webhook` (key check, Clerk prompt) → new `Webhook URL` and `Headers` appear with the "shown once" copy.
4. In OpenRouter he updates the destination's header with the new `Authorization` value. The old token has already been revoked server-side when the new one was issued (`handler.ts:2737-2739`).
##### Variations
- If the previous OpenRouter destination is still live, its deliveries return 401 until updated (docs table).
- Webhook URL itself does not change, so only the header needs updating, but the dialog does not say that.
##### Edge Cases
- `Replace` has no confirmation and silently breaks the current destination; copy under the button does not warn about it.
- Same `Webhook URL` is also derivable (`https://<origin>/api/webhooks/openrouter/<drive id>`), but the dialog does not show it for an existing token.

---

#### SETUP-065: Stale token ("Needs replacement") after the inbox changed
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-07`; surface class web; overlaps SETUP-064, SETUP-066.

**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Dana Whitfield, a team admin. A teammate re-enrolled the drive's trace inbox through the API; Dana's OpenRouter dashboard begins showing failures.
**Goal**: Restore trace delivery.
**Preconditions**: Active token whose bound inbox record no longer matches the current record (`status: 'stale'`, `handler.ts:2718`).
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Replace`, update header in OpenRouter.
**Alternate paths**: `Revoke` then `Add webhook`.
##### Steps
1. `Capture…` → row shows state `Needs replacement` and "The inbox changed after this token was created. Replace the token to resume trace delivery."
2. Click `Replace` → key proof runs against the current inbox; if the key opens that inbox, a new token is issued after Clerk reverification.
3. If the key does not open the new inbox: error "This key does not open this drive’s files." with `Retry`. Dana needs the correct recovery file.
4. Success: update OpenRouter with the new header. Deliveries go from 409 `conflict` (docs table, "token's bound inbox record was changed") to 201.
##### Variations
- Legacy token (issued before binding) never shows `Needs replacement` (docs `trace-capture.md:125`).
##### Edge Cases
- The dialog never says why the inbox changed or who did it.
- The stale text says "Replace the token" but she may not know the old token stops working immediately.
- OpenRouter's own error for 409 does not mention Agent Drive; she must connect OpenRouter failures to this badge.

---

#### SETUP-066: Revoke a webhook, with confirm and cancel
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-08`; surface class web; overlaps SETUP-064.

**Type**: short
**Topic**: OpenRouter webhook and trace capture
**Persona**: Eli Brandt, who rotated away from OpenRouter and wants the URL dead.
**Goal**: Stop deliveries.
**Preconditions**: Active token.
**Surface**: web (browser)
**Ideal path**: 3 — `Capture…`, `Revoke`, `Revoke webhook`.
**Alternate paths**: `Replace` (does not stop deliveries, swaps the token); nothing on the CLI revokes a webhook token.
##### Steps
1. `Capture…` → click `Revoke` → inline confirm "Stop this webhook?" with `Revoke webhook` and `Cancel`.
2. He clicks `Cancel` by reflex → back to `Revoke`. Clicks `Revoke` again, then `Revoke webhook` → row replaced by `Add webhook`; focus moves to `Add webhook`.
##### Variations
- Network error on revoke: confirm text is replaced by the error (default "Could not revoke the link." from the shared control — the word "link" is wrong for a webhook, `share-dialog.tsx:~96`).
##### Edge Cases
- Existing traces stay in `/traces/openrouter/`; the dialog does not say so.
- The `openrouter` agent created at first token stays; revoke does not remove it.
- After revoke, OpenRouter requests get 401.

---

#### SETUP-067: Local capture with the CLI instead of OpenRouter
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-09`; surface class mixed; overlaps SETUP-059, SETUP-062.

**Type**: medium
**Topic**: OpenRouter webhook and trace capture
**Persona**: Jonas Albrecht, using Claude Code in API-key mode on a server, no OpenRouter account.
**Goal**: See traces appear under `/traces`.
**Preconditions**: CLI logged in with a drive key saved for one drive; `ANTHROPIC_BASE_URL` not set.
**Surface**: mixed (web to copy commands, CLI to run, web to check)
**Ideal path**: 4 — `Capture…`, `Copy install command` (if CLI missing), `Copy capture command`, paste and run in terminal.
**Alternate paths**: Type `agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]` by hand; `--drive` can be omitted when only one drive key is saved.
##### Steps
1. `Capture…` → "Local agents": text "Connect to Agent Drive and load this drive’s key on your agent’s machine first. Run Claude Code or Codex through capture to save encrypted traces under /traces."
2. Click `Copy install command` (`npm install -g @dennisonbertram/agent-drive`) then `Copy capture command` (`agent-drive capture --drive <drive id> -- claude`).
3. In a terminal: runs. Each call logs `capture: POST /v1/messages 200 842ms captured`. On exit: `capture: 3 uploaded, 0 queued (0.0 MiB in <spool dir>), 0 not captured (...), 0 invalid`.
4. Back in the console, click `Traces` → `/traces` Recent view lists files under `/traces/claude/<date>/`.
##### Variations
- `ANTHROPIC_BASE_URL` already set → `capture disabled: ANTHROPIC_BASE_URL is already set; running claude without capture`; agent runs unwrapped.
- No drive key: `capture disabled: no drive key for drive <id>; running claude without capture`.
- Upload rejected (e.g. 402 quota): `capture: uploads stopped (<cause>); traces stay in <spool dir> for the next run`.
- Invalid `--agent` value (uppercase): error `--agent must be 1-40 characters: lowercase letters, digits, ".", "_" or "-".`
- Missing `--`: `Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]`.
##### Edge Cases
- The TLS/"server reads it once" footer in the dialog is about the webhook, but is placed below both sections.
- The dialog tells the user to check terminal output for "disabled / queued / not captured", but does not list those messages; they are in `docs/trace-capture.md`.
- The Claude desktop app is not captured (docs `trace-capture.md:81`); the dialog does not say so.

---

#### SETUP-068: Key from another tab wins (409 race) and traces folder empty state
**Catalog notes**: temporary ID `STORY-WEBHOOK-CAPTURE-10`; surface class web; overlaps SETUP-059, SETUP-063.

**Type**: long
**Topic**: OpenRouter webhook and trace capture
**Persona**: Ines Duarte, who opened the console in two tabs and clicked `Add webhook` in both while setting up for a demo.
**Goal**: End with one working webhook and see traces arrive.
**Preconditions**: No inbox, no token; two tabs both with the key.
**Surface**: web (browser) plus OpenRouter
**Ideal path**: 6 — `Capture…`, `Add webhook`, copy URL, copy headers, paste into OpenRouter, click `Traces`.
**Alternate paths**: Let only one tab finish; `Replace` in the other.
##### Steps
1. In tab A she clicks `Capture…` then `Add webhook`, confirms Clerk.
2. In tab B (stale view: still shows `Add webhook`) she does the same. The inbox now exists; the code treats a 409 as "another tab created it" and re-reads it (`webhook-setup.ts:100-111`), proves her key opens it, then issues a second token.
3. Tab B shows its own URL and header. Tab A's token is revoked by B's issue (`handler.ts:2737`). If she pasted tab A's header into OpenRouter, it now returns 401.
4. She runs a test request in OpenRouter; then in the console clicks `Traces`. With nothing yet: "No traces yet." / "Run an agent through agent-drive capture, or add an OpenRouter webhook." The link `add an OpenRouter webhook` reopens the same dialog.
5. After the first delivery the folder shows `/traces/openrouter/<date>/…json`.
##### Variations
- If the OpenRouter request has Privacy Mode on, a file is stored but contains no prompts or replies.
- Duplicate delivery of the same body: stored once (docs table).
##### Edge Cases
- Tab A keeps showing the old token's `Webhook URL` and `Headers` as valid after tab B replaced it; nothing refreshes it.
- Hesitation: she cannot tell which header is current, since "Created <time>" is only on the saved row, not the one-time block.
- The `/traces` empty state tells users how to start capture but not where OpenRouter traces will land (`/traces/openrouter/`).

---

Story count by Type: short 2 (05, 08), medium 5 (01, 04, 06, 07, 09), long 3 (02, 03, 10).

---
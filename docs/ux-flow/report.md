# UX Flow Critique - 2026-11-06

Owner priorities used for ranking: the console should feel like a clear cloud drive (Dropbox-style), and sign-up and setup should work well. Journeys on those paths weigh most.

## Run Summary
| Metric | Value |
|--------|-------|
| Journeys critiqued | 8 (signup, first-run-setup, find-open-file, download-decrypt, versions-trash, sharing, second-agent, agents-keys-billing) |
| Evidence source | Live pass on a local seeded server (http://localhost:3500, seeded user e2e_uxreview, drives research-bot and nightly-builds) on 2026-11-06. Clerk is not configured locally, so the real sign-up form was not seen. |
| Verdicts | 0 minimal - 5 acceptable - 3 convoluted |
| Redundancy | 8 duplicate paths - 10 duplicate information - 6 overlapping features - 10 hierarchy/IA findings (`redundancy.md`) |

Verdict sources: signup, first-run-setup, versions-trash and sharing carry a verdict written in their own critique (sharing: convoluted for the human sender, the recipient page is minimal). The other four critiques did not state a verdict; I assigned find-open-file (acceptable), second-agent (acceptable), download-decrypt (convoluted) and agents-keys-billing (convoluted) from their scorecards.

Limits of this run:
- The machine was under heavy load (a load average above 300 was recorded in first-run-setup and above 230 in versions-trash), and the local MinIO storage at 127.0.0.1:19000 accepted connections but stopped answering. As a result the download in download-decrypt was never observed finishing: the Download button stayed disabled for over 25 seconds. The key-loading screens were seen; the file save, the success notice and the next-visit behaviour were not (next-visit behaviour comes from code reading and dialog text only).
- find-open-file has no mobile file-list screenshot (09 shows only an error state).
- Some timings (console calls of 5 to 10 minutes in agents-keys-billing, a Trash tab stuck on "Loading files" in versions-trash) are attributed to the environment, not the product; the missing timeout or retry message on those screens is a product observation.
- One critic's mis-click trashed a seeded file and restored it; the weekly report's AUTHOR now reads Console (find-open-file, Functional note).

## Friction Scorecard
| Journey | Steps (actual/ideal) | Needless decisions | Re-entry | Dead ends | Verdict |
|---------|----------------------|--------------------|----------|-----------|---------|
| signup | 3+/2 landing to console; 5/3 first drive and key saved (signup.md) | 3 (drive name with no default; Sign in vs Console vs Start with Free) | 1 (key lost on reload) | 2 (local sign-in pages; "Connect an agent" jumps away) | acceptable |
| first-run-setup | Human 3/3; agent 5 commands/3-4 (first-run-setup.md) | 2 (delegate checkbox; backup path) | 0 | 2 ("Approved" card; files not openable without key) | acceptable |
| find-open-file | 3/2 to the row; +5 vs 1 to read the content (find-open-file.md) | 2 (which drive; which weekly file is newest) | 1 (filter cleared on tab switch) | 1 (no "recent" answer) | acceptable (assigned) |
| download-decrypt | 6/2 (download-decrypt.md) | 1 | 1 (key again after every reload) | 1 (disabled Download) | convoluted (assigned) |
| versions-trash | Restore version 6/3; restore from Trash 3/2 (versions-trash.md) | 1 | 1 (filter text) | 2 (restore notice in header; no "View file") | acceptable |
| sharing | Human sender 0 of 3 possible in console; recipient 2/2; list/revoke 0 in console (sharing.md) | 1 | 0 | 2 (no Share action; `share list` has no URL) | convoluted (sender); recipient minimal |
| second-agent | Route A 6/4 (story ideal); route B 2; route C 0 (second-agent.md) | 5 on route A; 2 on route B | 1 (recovery file on route A) | 1 ("Approved" screen) | acceptable (assigned) |
| agents-keys-billing | Rotate a key 11/3; usage vs plan 3 screens/1; revoke an agent 2/2 (agents-keys-billing.md) | 2 (New key dialog defaults) | 0 | 1 (revoke gives no notice) | convoluted (assigned) |

## Redundancy Map
Condensed from `redundancy.md`.

Duplicate paths (8). Sign-up has five doors and no "Sign up" button (signup/01, 05, 06): recommend one "Sign up free" button. First drive/agent creation has five entry points with different outcomes (signup/07, 10; abb/01): recommend one primary and one secondary. Second-agent access has three routes (second-agent/01, 02, 06): keep all, explain once. Restore has two surfaces (versions/03, 06): keep both, one notice. Revoke has two scopes under one verb (abb/01, 05): name the target on the button. The drive key can be loaded three ways (download/05, 06): file first, auto-submit. Finding files and "what changed" is weakest in the console (find/03): add Recent and server-side search. Plan usage is spread over Usage, Billing and Pricing (abb/07, 08, 09): show the allowance on Usage.

Duplicate information (10). Storage shown as 9.5 KB and 9.4 KiB (abb/07, 08); "Usage by author" and "Usage by agent" (abb/07, 08); plan cards on Pricing and Billing (abb/08, 09); key state in badge, button and banner with red meaning both good and bad (download/07, find/07, signup/10); drive ID with Copy on every view (signup/10); two nav links to sign-in (signup/01); UUIDs on every Agents and Versions row (abb/01, versions/03); AUTHOR overwritten by "Console" after restore (find/07); title echoes on Trash (versions/06).

Overlapping features (6). Agents and API keys tabs (merge); Trash tab and Versions dialog (keep, share notice); Usage and Billing; five partial "what happened" sources (one Activity view); Pricing and Billing plan cards; Activity & deletion mixing an audit log with account deletion (split).

Hierarchy and IA (10). Drive/workspace/Drives & files naming; drive vs agent (the "YOUR NEXT AGENT" tile creates a drive; drive and agent both named `claude-code`); author vs agent; five names for the drive key; storage naming; one "revoke" for two scopes; 7 sidebar items for a user with an empty account; upload, share, recents and search missing from the console; drive strip on account-level tabs; alphabetically-first default drive and mixed colour meaning.

## Simplification Proposals (ranked)
Ranking: (journeys improved x steps or elements removed) / effort, weighted toward the owner's two priorities (console as a clear cloud drive; sign-up and setup).

### 1. Unlock on demand: one prompt, auto-submit, remember on this device
- **Now**: Download is disabled until the key is loaded; 6 steps to a decrypted download (download-decrypt Scorecard, screens 02, 05, 06, 07). Choosing a recovery file does not submit; a dots field shows a secret the user did not type (06). Key is lost on reload.
- **Proposed**: Download is always enabled. If the key is missing it opens a prompt with the file chooser first; choosing the file loads the key and starts the download. Optional "Remember on this device".
- **Saves**: 4 steps and 1 confirmation per download; helps download-decrypt, find-open-file (+5 to read), versions-trash (Download greyed, versions/01), sharing (share needs the same prompt), second-agent route A (second-agent/02) and first-run (files not openable, first-run/03). 6 journeys.
- **Effort**: M
- **Evidence**: download-decrypt.md (Simpler Version); find-open-file.md; first-run-setup.md (03); second-agent.md (route A). Download completion not observed (see Run Summary).

### 2. Sign-up front door
- **Now**: Landing nav has "Sign in" and "Console", no sign-up button; the final CTA repeats the agent Copy button (signup/01, 02); the only labelled path is "Start with Free" on Pricing (signup/05); at 390 px the header nav is hidden (signup/12).
- **Proposed**: One orange "Sign up free" next to "Sign in"; drop "Console" while signed out; "Create a free account" beside the final Copy button; keep a mobile header link.
- **Saves**: 1 to 2 steps and 1 decision; one journey but the entry to every other journey.
- **Effort**: S
- **Evidence**: signup.md (Take-away Pass 01, 02, 05, 12). The Clerk form itself was not evaluated.

### 3. First console visit leads with "Connect your agent"
- **Now**: 5 steps to a drive with a saved key (signup/07 to 10); drive name has no default (08); the key dialog has four actions (09); right after saving, a red banner says the key is not backed up (10, which I opened).
- **Proposed**: Open on the connect-an-agent panel with the llms.txt line and Copy; "New drive" becomes secondary. If a drive is created: default name, one "Download recovery file and continue" button as the save confirmation, no contradictory banner.
- **Saves**: about 2 steps and 1 decision; 1 competing first action removed; helps signup and first-run.
- **Effort**: S to M
- **Evidence**: signup.md (Simpler Version); signup/07, 08, 09, 10.

### 4. Make the file list behave like a cloud drive
- **Now**: Opens on the alphabetically first drive (find Scorecard; abb/01); one flat list with full paths, no sort (find/02), filter matches loaded paths only (03), both weekly files show the same MODIFIED time (03), no Recents, no breadcrumbs, no preview (catalog Cloud-drive table).
- **Proposed**: Open on the last-used drive; sortable columns, default newest first; a Recent view using the existing `recent` API; path breadcrumb; inline preview for text files; remember the last drive for the Add-to-existing form too.
- **Saves**: 1 step and 1 decision on find-open-file; 1 trap removed on second-agent (second-agent/02); answers the "latest report" question that is unanswerable today.
- **Effort**: M to L
- **Evidence**: find-open-file.md (Simpler Version, Clarity Issues); second-agent.md (Trap); catalog "Cloud-drive expectations vs. today".

### 5. Share from the file row, with a Shared links list
- **Now**: Sharing cannot be done in the console; the Files row has Download, Versions, Trash (sharing/01); `share list` prints raw JSON with no URL and revoke takes an id only (sharing.md).
- **Proposed**: A Share action on the row (expiry default 7 days, Copy link) and a "Shared links" list with created, expires, status, Revoke.
- **Saves**: makes a 3-step job possible; list and revoke go from 0 to 2 steps in the console.
- **Effort**: M
- **Evidence**: sharing.md (Scorecard, Simpler Version).

### 6. One key-status chip and consistent colours
- **Now**: Key state in a badge, a button and a banner; red is used for both good and bad states; "Download recovery file" shown beside "Key backed up" (download/07, find/07, signup/10).
- **Proposed**: One status chip (green for loaded or backed up, red for required or not backed up); hide "Download recovery file" once backed up or explain it makes another copy; add a busy label on the clicked row while downloading (download/08).
- **Saves**: 2 duplicate indicators and a contradiction; 3 journeys (download-decrypt, find-open-file, signup).
- **Effort**: S
- **Evidence**: download-decrypt.md (Take-away 07, 08); signup.md (10).

### 7. First-run setup: one `setup` command and a useful Approved page
- **Now**: Agent runs 5 commands (install, login, credentials export, skill install, check) and must choose a backup path (first-run Scorecard); the Approved card has no link to the console and no status (first-run/02); `/.agent-drive/check.txt` shows as user content (first-run/03); the delegate checkbox is the heaviest element on /connect (01).
- **Proposed**: One `setup` command folding login, export, skill install and check; Approved page links to the console and says it will update; hide self-test files by default; put the delegate checkbox behind a disclosure on every route.
- **Saves**: llms.txt steps 6 to 2; 1 dead end on first-run and second-agent (second-agent/05).
- **Effort**: M
- **Evidence**: first-run-setup.md (Simpler Version); second-agent.md (Take-away 05).

### 8. Feedback where the action happens (toasts with Undo / Show file, in-app confirms)
- **Now**: Trash is immediate with no Undo (find/04-accidental-trash, versions/08); the restore notice appears in the page header and does not name the file (versions/04, 07); the revoke notice is above a changed row that is off screen (abb/06); revoking an agent gives no notice (abb/02) and uses native `confirm()` dialogs; the agent row stays "Revoke access" at 0 active keys (abb/01).
- **Proposed**: Toasts near the action that name the file or agent, with Undo or "Show file"; row-level state after revoke; named in-app confirm for revoke.
- **Saves**: 4 dead ends; 3 journeys (find-open-file, versions-trash, agents-keys-billing).
- **Effort**: S to M
- **Evidence**: versions-trash.md; agents-keys-billing.md; find-open-file.md (Functional note).

### 9. Usage against the plan in one place
- **Now**: Allowance only on Billing; Usage shows no limit (abb/07, 08); 9.5 KB vs 9.4 KiB; "Usage by author" vs "Usage by agent"; plan cards duplicated on Pricing; "EGRESS & COST" card has no figures; "Not connected" in every row (abb/08, which I opened).
- **Proposed**: Usage shows "9.4 KiB of 5 GiB" and links to Billing; one unit and one name; one plan component; remove empty cards and the "Not connected" column for Free users.
- **Saves**: 2 screens on "am I near the plan" (3 to 1); 4 duplicated facts.
- **Effort**: S
- **Evidence**: agents-keys-billing.md (Scorecard, Take-away 07 to 09, Clarity Issues).

### 10. Agents and keys as one table; Replace key
- **Now**: Two tabs with overlapping revoke; neither shows drive or write path (abb/01, 05); rotate takes 11 steps (abb Scorecard); the New key dialog defaults to the first agent and drive (abb/03).
- **Proposed**: One agent table with drives, permissions, last used and how access was granted; "Replace key" that issues, shows the secret once, and revokes the old key; buttons named by target.
- **Saves**: rotate 11 to about 3; 1 tab; helps agents-keys-billing and second-agent (second-agent/07, 08).
- **Effort**: L
- **Evidence**: agents-keys-billing.md (Simpler Version); second-agent.md (Take-away 07/08).

### 11. One concept, one name (cheap copy pass; do alongside 2 and 3)
- **Now**: drive/workspace/Drives & files; "YOUR NEXT AGENT" tile creates a drive; author vs agent; five names for the drive key; three names for storage (see redundancy.md Hierarchy & IA 1 to 5).
- **Proposed**: "Drive" for the store, "agent" for the identity, one word for the key, one storage term; replace filler subtitles ("A home for the work...") with plain text.
- **Saves**: 0 steps; removes the naming confusion on all 8 journeys.
- **Effort**: S
- **Evidence**: redundancy.md; signup.md and first-run-setup.md Clarity Issues.

## Already Minimal
- Recipient share page: open, click Download, 2 of 2 steps, shows filename, size, local-time expiry and no sign-in; the revoked page has a clear next step (sharing/04, 06; sharing.md). Keep as is.
- Human side of first-run setup: 3 actions, 1 confirmation, no re-entry; /connect has one orange primary and works on mobile (first-run-setup Scorecard; first-run/01, 05).
- The `grant` route: owner opens a link and clicks Approve; the card states who offered what in one sentence; no key handling (second-agent/06, called "the best screen").
- Restore flows: both cost 2 to 3 clicks with no confirmation (versions-trash Verdict). The gaps there are information and feedback (proposal 8), not step count.
- Smaller items: the key dialog line "Your key stays in this page's memory..." (download/05), the file panel footer "File contents encrypted - Paths and metadata visible to the service" (download Clarity Issues), the Versions text "Restore creates a new current version" (find/04-versions), and the mobile console layout (signup/11, abb/10).

No GitHub issues were filed (`--no-issues`).

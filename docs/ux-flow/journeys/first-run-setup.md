# Journey: first-run-setup (STORY-009)

Screens: `first-run-setup-screens/` (01-05). Driven live with the real CLI (isolated `AGENT_DRIVE_CONFIG`, npm `--prefix`, and HOME under the scratchpad; nothing installed globally), `--api http://localhost:3500/api` as localhost llms.txt says, fresh user `e2e_uxfirstrun182` (throwaway; created drive `claude-code`). I played the agent and the human; the human had no drive and no prior login.

## Story

STORY-009: paste the line into an agent, the agent installs and logs in, the human approves on /connect, agent backs up, installs the skill and runs check, console shows the drive. Ideal path from the catalog: 4 (paste, click link, Approve, tell the agent to finish).

## Friction Scorecard

| Measure                          | Actual                                                                                                                                                                                                                                                                                 | Ideal     | Evidence                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| Human actions                    | 3 (paste line, open link, click Approve) plus 1 optional (open console)                                                                                                                                                                                                                | 3         | 01, 02                         |
| Agent commands                   | 5 (npm install, login, credentials export, skill install, check) plus llms.txt read                                                                                                                                                                                                    | 3-4       | llms.txt steps 1-6; CLI output |
| Decisions for the human          | 1 real (verify code) + 1 checkbox "Let this agent add other agents" (default off)                                                                                                                                                                                                      | 1         | 01                             |
| Decisions for the agent          | where to back up credentials (path "outside the sandbox" or a secret store)                                                                                                                                                                                                            | default   | llms.txt step 4                |
| Confirmations                    | 1 (Approve); none redundant                                                                                                                                                                                                                                                            | 1         | 01                             |
| Re-entry                         | none; code in URL. But the human must watch two windows                                                                                                                                                                                                                                | -         | 01                             |
| Dead ends                        | "Approved. Return to your agent" card has no link to the console or to what the agent will do (02); check hard-fails until backup done (by design)                                                                                                                                     | next link | 02                             |
| Hesitations (measured/suspected) | measured: `check` first said "The upload intent has expired" (server commit 409) and backup failed with the same error once, then passed on retry minutes later; machine load average was 309 at the time, so likely load, not product. Suspected: human wonders what "Approve" grants | -         | CLI output, server log         |

Wall-clock: install 3.6 s; login prompt immediate; approval then login finished within the CLI poll interval (5 s).

## Take-away Pass

- 01 /connect: pairing code at 48px, agent, machine, account, requested time, grey banner "This agent gets its own encrypted drive...", checkbox, Approve. One orange primary: good. The Account row says "Local test session" here (fine). Take-away candidates: "Requested" timestamp (nothing for the human to act on); the pairing-code sentence appears above the question "Connect claude-code?" so the code and the question are separated by explanatory text.
- Delegate checkbox with three lines of help text is the heaviest element and affects 10 percent of users (STORY-012); move behind a "More options" disclosure.
- 02 Approved: correct and brief, but a dead end: no "Open console", no "Waiting for your agent..." progress, no revoke pointer (the revoke note shown on 01 disappears).
- 03 Console after setup: the drive appears with name `claude-code` (named after the agent; user never chose a name), "176 B · 2 files", green banner "Key backed up 11/6/2026 (file)". Files listed are `/.agent-drive/check.txt` (agent's self-test file, 57 B) and `/backups/MacBook-Pro-2.local/notes.md`. The self-test file is shown as if it were user content. The console cannot download either file until "Load drive key" is used (Download buttons disabled), and the key sits on the agent's machine; so the human cannot open a file the agent just saved without copying credentials back. Status line "Key backed up ... (file)" is useful.
- 04 Agents tab: "Connect an agent" is a collapsed bar above the list; agent row shows UUID, "1 ACTIVE KEY", "Revoke access". UUID dominates over the useful fact (when it last wrote).
- 05 /connect with bad code (390 px): clear message, usable on mobile.

## The Simpler Version

1. Human pastes one line into the agent. (unchanged)
2. Agent runs one command, e.g. `npx -y <tgz> setup --name X`, that does install-less login, then export, skill install and check (llms.txt step list shrinks from 6 to 2). The backup path prompt becomes a default (`~/.agent-drive-backup` if the home dir persists; otherwise the agent says so).
3. Human opens link, matches code, clicks Approve. The Approved card links to the console and says "Your agent is finishing setup. This page will update when it is done."
4. Console opens on the new drive with the success state; hide `/.agent-drive/check.txt` from the default file list.
   Concrete changes: (a) one `setup` CLI command folding login+export+skill+check; (b) Approved page onward link and live status; (c) delegate checkbox behind disclosure; (d) hide system self-test files; (e) name the drive from the agent name but let the human rename later (add Rename).

## Clarity Issues

- llms.txt step 4 is the hardest sentence for an agent: "a path that survives, outside the sandbox" with two alternative commands. An agent in a plain laptop shell has no clear answer (workable default missing).
- `check` refusing until backup is done is good but the error ("drive key not backed up") comes before the hint; the hint is the actionable part.
- Messages "The upload intent has expired." (CLI, check and backup) does not say what to do; one retry fixed it. The CLI could retry automatically on this error.
- Vocabulary: "pairing code", "code", "link", "approve", "connect", "login" are all used for one step (01, CLI output).
- Naming: drive and agent both called `claude-code` (03, 04) which makes "drive" vs "agent" unclear for a newcomer.

## Cloud-drive comparison

Dropbox desktop: install app, sign in in a browser, click Allow, files sync; no backup-of-keys step and no second terminal. Here the user-facing part is similarly short (3 human actions) but the agent has 5 commands and the final state includes a key-backup obligation no cloud drive has. A Dropbox user would also expect to open the files in the web UI right after: here, files are listed but Download is disabled until the drive key is pasted (03), and there is no preview or upload button.

Verdict: acceptable (human side minimal, agent side and post-approval screens could be shorter).

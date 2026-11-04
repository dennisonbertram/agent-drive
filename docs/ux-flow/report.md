# UX Flow Critique — 2026-11-03

## Run Summary

| Metric             | Value                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Journeys critiqued | 8 (STORY-011, 021+023, 024, 030, 037, 069, 080 with 082 as a variation)                                    |
| Evidence source    | Live pass on https://agent-drive.vercel.app: 14 screenshots in `screens/`, plus live CLI/MCP runs and code |
| Verdicts           | 0 minimal · 5 acceptable (011, 030, 037, 069 with the script, 080) · 2 convoluted (021+023, 024)           |

## Friction Scorecard

| Journey                                    | Steps (actual/ideal)          | Main friction                                                                           | Verdict                                    |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| STORY-011 Landing → pricing → sign-up      | 3–4 / 3                       | "Open console" for anonymous visitors; "Manage your plan" on plans the visitor lacks    | acceptable                                 |
| STORY-021+023 First drive, agent and key   | ~14 / 7                       | Separate agent and key dialogs; two "I saved…" checkboxes; permissions shown up front   | convoluted                                 |
| STORY-024 Console → terminal hand-off      | ~9 / 4                        | Placeholder host and drive id in the terminal block; drive key not saved by `login`     | convoluted                                 |
| STORY-030 Unlock with recovery file        | 5 / 3                         | Choosing the file doesn't load the key; Download dimmed instead of opening unlock       | acceptable                                 |
| STORY-037 Share via CLI, recipient, revoke | sender 3 / 1; recipient 2 / 2 | JSON output instead of the URL; `share list` lacks path and expiry; no console share UI | acceptable                                 |
| STORY-069 Weekly trace archive             | 1 command with script / 1     | Not a built-in CLI command; skill steps repeat the script                               | acceptable (convoluted without the script) |
| STORY-080 Upgrade Free → Developer         | 5 / 3                         | Pricing hops to the billing hub; plan cards duplicated; checkout button below the fold  | acceptable                                 |

## Redundancy Map

Full detail is in [redundancy.md](redundancy.md): 9 duplicate paths, 9 duplicated facts, 8 overlapping features and 10 IA findings.

- **Duplicate paths:** two routes to Billing inside the console (Usage "EGRESS & COST" card holds only a link); drive selector + "Load drive key" repeated on Files and Trash; "Restore this version" offered on the only version (`screens/13`). Recommendation: one canonical control each.
- **Duplicate information:** storage shown as "3.8 MB" (Usage) and "3.8 MiB" (Billing); plan allowances worded differently on /pricing and /console/billing ("1024 GiB" vs "1.0 TiB"); the console author is "Human console", "Console" and "Console user"; sidebar Files badge shows 1 while 9 files are listed (`screens/02`).
- **Overlapping features:** sharing exists only in the CLI and MCP; the console can't create, list or revoke links. Billing repeats the Usage-by-agent table.
- **IA:** five in-page tabs plus two separate pages with different "Back" labels; Usage/Billing and Agents/API keys each split one concept in two.

## Simplification Proposals (ranked)

Ranked by how central the journey is, then by steps removed, then by effort.

### 1. Put the real host and drive id in the console's terminal block

- **Now:** `agent-drive login --api https://your-agent-drive-host` and `--drive <drive-id>` are placeholders (`screens/04`, `console.tsx:860`). The console knows both values.
- **Proposed:** render `window.location.origin` and the selected drive id, plus the exact `AGENT_DRIVE_KEY_<ID>` variable name, with a Copy button.
- **Saves:** 2–3 steps and the most likely first-run failure in STORY-024 and STORY-021+023.
- **Effort:** S. **Evidence:** journeys/STORY-024.md, journeys/STORY-021-023.md.

### 2. One "Connect an agent" dialog

- **Now:** Agents → Create agent → automatic jump to API keys → Create API key → Save key (~7 steps, `screens/03`, `screens/04`).
- **Proposed:** a single dialog with the agent name, a key label defaulting to the agent name, read+write on the current drive by default with "Change access" collapsed, then one screen showing the key, the drive key and the filled-in terminal block with Copy buttons.
- **Saves:** about 4 steps in the onboarding journey.
- **Effort:** M. **Evidence:** journeys/STORY-021-023.md.

### 3. `agent-drive connect` that saves both keys

- **Now:** `login` saves only the API URL and key, so the drive key has to be exported in every new shell (`cli.ts` login branch).
- **Proposed:** `agent-drive connect --api HOST --drive ID` prompts with hidden input for the API key and drive key, saves both in the private config, and makes `--drive` optional when only one drive is configured. `--key-file` should accept the recovery JSON the console downloads.
- **Saves:** 2+ steps per new shell or machine. **Effort:** M. **Evidence:** journeys/STORY-024.md.

### 4. Upgrade straight from /pricing

- **Now:** "Manage your plan" (also shown to visitors without a plan) → /console/billing → scroll past three stat cards → "Choose developer" (`screens/01`, `screens/07`).
- **Proposed:** an "Upgrade to Developer/Team" button that opens checkout directly (or `/console/billing?upgrade=developer`). Free users see one upgrade panel instead of repeated plan cards.
- **Saves:** 2 steps on the money path. **Effort:** S–M. **Evidence:** journeys/STORY-080.md.

### 5. Choosing a recovery file unlocks the drive

- **Now:** the file input fills a masked field, then the user clicks "Load key"; Download is dimmed while locked (`screens/12`, `console.tsx:331-350`).
- **Proposed:** selecting a valid file loads the key and closes the dialog; clicking Download on a locked row opens the unlock dialog.
- **Saves:** 2 steps. **Effort:** S. **Evidence:** journeys/STORY-030.md.

### 6. Share CLI prints the link

- **Now:** `share` prints a JSON object; `share list` has no path or expiry.
- **Proposed:** print the URL and expiry by default, with `--json` for the object; add path and expiry to `share list`.
- **Saves:** a parsing step for every share. **Effort:** S. **Evidence:** journeys/STORY-037.md.

### 7. One name and one unit per concept

- **Now:** "drive key" / "recovery key" / "decryption key"; MB vs MiB; "1024 GiB" vs "1.0 TiB"; three names for the console author; "1 agents", "1 drives"; the Files badge counts drives.
- **Proposed:** pick one term and one unit each; fix the plurals and the badge.
- **Effort:** S. **Evidence:** redundancy.md.

### 8. Built-in verified archive command

- **Now:** the weekly trace archive works through a skill script (`skills/agent-drive-trace-archive/archive-traces.sh` on branch `feat/trace-archive-skill`), which parses CLI JSON with `sed` and `grep`.
- **Proposed:** `agent-drive archive DIR --drive ID --verify --delete-local [--dry-run]`, with distinct exit codes (the script now exits 3 when files are held back as possible secrets).
- **Effort:** M. **Evidence:** journeys/STORY-069.md.

### 9. Share management in the console

- **Now:** no way to create, list or revoke a share from the web.
- **Proposed:** a Share action on file rows and a shares list per drive.
- **Effort:** M–L. **Evidence:** redundancy.md, journeys/STORY-037.md.

### 10. Show a revoked or expired message without the key fragment

- **Now:** a share link opened without its `#k=` fragment says "This link is missing a valid decryption key" even when it was revoked (`screens/11`, `share-client.tsx:67`). With the fragment, the page correctly says "Share link revoked" (checked live).
- **Proposed:** fetch the share status before checking for the fragment.
- **Effort:** S. **Evidence:** journeys/STORY-037.md.

## Already Minimal

- The recipient side of a share link: open the link, then Download (STORY-037).
- `agent-drive put LOCAL REMOTE` itself, and the put → download → hash → delete order of the archive script, which holds back rather than prompts (STORY-069).
- The direct landing → "Start with Free" → sign-up route matches its ideal (STORY-011).

## Not covered

- Stripe checkout and the return trip were not clicked; everything after "Choose developer" comes from code.
- The empty-state and create/save dialogs were observed live by the lead but not screenshotted.

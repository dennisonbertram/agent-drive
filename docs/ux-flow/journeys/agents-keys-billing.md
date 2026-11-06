# Journey 8: agents-keys-billing (review access, revoke, rotate, check usage against the plan)

Stories: STORY-066 (revoke an agent versus a key), STORY-065 (rotate a key), STORY-072 (check usage), with STORY-073/074 for pricing. Live at http://localhost:3500 as e2e_uxreview, 1440x900 plus one 390x844 pass (10-mobile-main.png). Screens: `agents-keys-billing-screens/`. Destructive steps used throwaway agents: trace-a (agent revoke) and trace-b (rotate, then revoke the old key). The seeded old-laptop was already revoked (0 ACTIVE KEYS, key REVOKED), so I did not revoke it again; no seeded key was revoked.

Ideal path: one screen answers "who can reach what"; revoke is one click; rotate is one action; usage is shown against the plan limit in one place.

## Friction Scorecard

| Task | Steps actual | Steps ideal | Notes |
|---|---|---|---|
| Review who can access what | 2 tabs (01, 05) and still no full answer | 1 | Neither lists drives or write paths. API keys shows scopes (research-bot: read, write, delete, share, delegate). |
| Revoke old-laptop | 0 (already revoked) | 1 | Agents row still shows "0 ACTIVE KEYS" with an enabled "Revoke access" button (01). |
| Revoke an agent (trace-a) | 2 (click, native confirm) | 2 | Row stays; badge becomes 0 ACTIVE KEYS; no notice (02). |
| Rotate a key (trace-b) | 11: API keys tab, New API key, label, agent, drives, Create, copy, tick "I saved", Done, find old row, Revoke, confirm | 3 | No rotate action. Dialog defaults to agent assistant and drive nightly-builds (03). |
| Usage versus plan | 3 screens: Usage (07), Billing (08), Pricing (09) | 1 | The allowance appears only on Billing ("5.0 GiB included"). |

Hesitations (measured): I clicked "Revoke access" on the wrong agent (research-bot instead of trace-a) because the nine rows have identical buttons. Only the confirm text named the agent, and I dismissed it. Confirmations are native browser `confirm()` dialogs, which screenshots cannot capture.

Environment note: during this run a console API call took 5 to 10 minutes (the shared server was busy with another session's drive delete and restore). The Agents page showed all buttons greyed with no progress text, then, after a reload, "Opening your workspace..." for several minutes. Environment cause, but the page has no timeout or error state.

## Take-away Pass (per screen)

- 01 Agents: avatar letter, full agent id, "issued by", key badge and button per row. The full id is used by no story step. The drive an agent can reach is missing. The drive tab strip above (nightly-builds, research-bot, "YOUR NEXT AGENT") does not apply on this tab. A "Connect an agent" bar repeats above the list.
- 02 After revoke: no success notice; only the badge changes and the row stays.
- 03 New API key dialog: label, agent, allowed drives, permissions. Manage carries a warning. Defaults are the first agent and first drive, not the context the owner came from.
- 04 Secret shown once: clear, with Copy and a required "I saved my API key securely" checkbox. A key made here carries no drive key, so the agent can authenticate but cannot read encrypted file contents until a drive key is supplied.
- 05 API keys: label, "agent · scopes", drive name, badge, Revoke. After rotation the old and new labels look alike ("trace-b on ux-tb", "trace-b key 2").
- 06 After revoking a key: "API key revoked. It can no longer authenticate." appears at the top with Dismiss, while the changed row is below the fold.
- 07 Usage: three stat cards (ENCRYPTED STORAGE 9.5 KB, API OPERATIONS 286, EGRESS & COST holding only a "Billing & limits" button), Storage by drive ("account limits apply"), Usage by author. No limit and no percentage.
- 08 Billing: the answer to "am I near the plan?" is here: RETAINED STORAGE 9.4 KiB, "5.0 GiB included · 2 drives". It also holds the estimate ($0.00), downloads "Not connected", three plan cards with Free selected, spend controls, and Usage by agent with CSV. It is the densest page and repeats the pricing cards.
- 09 Pricing: public page with the same three plans and "Coming soon" buttons. Wording differs from 08 ("stored ciphertext" versus "encrypted storage"; "API operations" versus "operations").
- 10 Mobile: a single-column file list with SIZE / AUTHOR / MODIFIED labels and wrapped buttons; the header collapses to a "Files" dropdown. The drive tab strip clips its third tab at the right edge.

## The Simpler Version

1. Agents is one table: agent, drives, permissions including write path, last used, how it got access, keys. The row button names its target ("Revoke trace-a").
2. A key row has "Replace key": it creates the new key with the same agent, drives and permissions, shows the secret once, and revokes the old key after the owner confirms.
3. The Usage tab shows storage and operations against the plan ("9.4 KiB of 5 GiB") and links to Billing to change plan. Billing keeps spend controls and the CSV.
4. Pricing and the Billing plan cards share one component and one set of words.

Concrete changes, in priority order:
- Show drive and write path per agent and per key row.
- Add Replace key, and default the New key dialog from where the owner came from.
- Show the plan allowance on the Usage tab.
- Give revoke feedback in the row itself, and disable "Revoke access" when an agent has 0 active keys.
- Replace native confirms with an in-app confirm that repeats the agent name, drives and consequence.

## Clarity Issues

- "Revoke access" on Agents revokes every key; "Revoke" on API keys revokes one. The same verb covers two scopes (01, 05).
- "Usage by author" (07) versus "Usage by agent" (08); "Encrypted storage" (07), "Retained storage" (08), "stored ciphertext" (09); 9.5 KB (07) versus 9.4 KiB (08) for one quantity, with different units and no explanation.
- The "EGRESS & COST" card on 07 has no figures. "Observed downloads: Not connected" (08) tells a Free user nothing.
- "9 AGENTS" and "7 ACTIVE KEYS" on adjacent tabs count different things.
- Functional bugs: none, apart from the long console stall noted above.

## Cloud-drive comparison

- Dropbox and Google Drive: "Manage access" lists each person or app with the folder it reaches and a role, and one remove action with an undo toast. Here the list shows no drive.
- App tokens in those products show "last used" and one Revoke; there is no rotate task for users. Here there is no last-used time.
- Both show a storage bar on the main screen ("9.4 KiB of 5 GiB") with an Upgrade link in the sidebar. Here the number is on three pages and the allowance on one.

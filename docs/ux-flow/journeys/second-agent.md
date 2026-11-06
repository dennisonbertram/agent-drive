# Journey 7: second-agent (give a second agent access to research-bot)

Story: STORY-056 (browser "Add to an existing drive instead"), compared with STORY-057 (`grant`) and STORY-058 (`credentials issue`). Run live against http://localhost:3500 as e2e_uxreview, CLI logins with isolated configs (`ad ta`, `ad tb`, `ad rb`) and `--api http://localhost:3500/api`. Screens: `second-agent-screens/`. Throwaway agents created: trace-a (browser route), trace-b (grant), trace-c (issue). Seeded items were not touched.

Ideal path (STORY-056): 4 steps. Ideal overall: the owner says "give agent X access to drive Y" once, with no key handling.

## Friction Scorecard (measured)

| Route | Owner steps | Agent-side steps | Owner decisions | Secrets owner handles | Dead ends |
|---|---|---|---|---|---|
| A. Browser "Add to an existing drive" | 6: open link (01), click "Add to an existing drive instead" (02), pick drive, load recovery file, optional read-only / write path, Approve (05) | 1 (`login`) | 5: drive, key source, read-only, write path, delegate checkbox | Yes: must find and upload the recovery file | Approved screen (05) has no link to the console or Agents |
| B. `grant` | 2: open link (06), Approve | 2 (`login`, then research-bot runs `grant CODE --write-path /outputs`) | 2: delegate checkbox, approve | None | Same Approved screen |
| C. `credentials issue` | 0 | 1 (`credentials issue --name trace-c --write-path /outputs --to FILE`) | 0 | None (file is mode 600) | Owner sees nothing until they open Agents or API keys; no approval |

- Re-entry: route A makes the owner supply a secret (screen 02: "Drive key or credentials bundle", "Or choose a recovery file"). The seeded recovery file was on disk; in real use it may be lost.
- Hesitation: route A, screen 01. The banner says "This agent gets its own encrypted drive", and the way out is a small underlined link. An owner who wants the existing drive reads the banner as the only option.
- Trap (screen 02): the Drive select defaults to `nightly-builds`, not the main drive research-bot. Approving without changing it gives the agent the wrong drive. The file check catches it only if a recovery file is chosen.
- Extra confirmations: none.

## Take-away Pass (per screen)

- 01 (new-drive card): the pairing code is large and clear. The grey "Check that this matches..." sentence, the banner and the delegate checkbox with three lines of small print are more text than needed. Primary action is clear.
- 02 (existing-drive form): two inputs for one secret (text field and file). Read-only and write-path are optional but inline. "Use a new drive instead" and the delegate checkbox sit between the optional fields and the button.
- 03 (empty-key error): "Paste the drive key or choose a recovery file." appears above the button, below the fold at 1440x900. The click looks like it did nothing until the owner scrolls.
- 04 (file chosen): choosing the file does not submit and gives no "matches drive research-bot" confirmation. The first check happens on Approve.
- 05 (approved): a dead end. "Approved. Return to your agent; it will finish setup on its own." No link to Agents, no summary of what was approved.
- 06 (grant card): the best screen. One sentence states who offered what: "Offered by research-bot: drive research-bot, read, write, writes under /outputs." No drive or key controls. The delegate checkbox is still shown.
- 07/08 (Agents / API keys after the handoff): neither shows which drive an agent can reach or its write path. API keys rows show scopes but not paths. trace-a and trace-b (browser and grant routes) show no "issued by"; only trace-c (issue route) does, so the list cannot show how an agent got access.

## The Simpler Version

1. Agent runs `agent-drive login --name trace-bot`; the link opens `/connect`.
2. The card shows the owner's drives with the most recently used one preselected, and shows scopes as one sentence.
3. Owner clicks Approve. If this browser already holds the drive key, no file is requested.
4. The Approved screen links to "View trace-bot in Agents".

Concrete changes:
- Make the existing-drive choice a visible control on screen 01 (a drive select above the banner), not a link under a banner about new drives.
- Do not ask for the drive key when the console already has it loaded in this browser.
- Preselect the most recently used drive, not the alphabetically first.
- Show the validation error beside the field, or scroll to it (screen 03).
- Put the delegate checkbox behind an "Advanced" disclosure on every route, default off.
- Link from the Approved screen to the Agents tab.
- Explain the three routes in one place. `agent-drive credentials issue --help` prints the whole CLI help, so the choice between grant and issue is not explained anywhere I found.
- Show drive and write path on each Agents and API keys row.

## Clarity Issues

- "Connect trace-a?" with "gets its own encrypted drive" misleads an owner who wants sharing (01).
- "Drive key or credentials bundle (adcred1....)" assumes the owner knows both terms. The help line "a wrong key gives the agent a drive it cannot read" is a warning without a fix (02).
- The delegate checkbox appears on all routes; owners cannot tell if it matters.
- Route C gives the owner no approval or notice; the result is visible only afterwards (07). That is a design choice, but the owner is never told the route exists.
- Functional bugs: none. All three routes worked: trace-a got read write delete share on research-bot, trace-b got read write limited to /outputs, trace-c was issued in one command.

## Cloud-drive comparison

- Google Drive and Dropbox: sharing is "Share" on the item, pick the person and a role, done. The owner passes no secret, and the share list shows each person's role and what they reach. Route A makes the owner find and upload a secret, and neither Agents nor API keys lists the drive or path per agent.
- Both default to the least privilege (Viewer). Here read and write is the default and read-only is a checkbox.
- Both show pending invitations. Here a pending request exists only as a link in the agent's terminal.

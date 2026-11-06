# Journey: sharing (send /outputs/reports/summary.pdf to a colleague)

Stories: STORY-046 (human wants to share from the console; ideal 3), STORY-042 (recipient opens a valid link; ideal 2), STORY-045 (list and revoke; ideal 2). Walked live at 1440x900 as e2e_uxreview, recipient in a fresh signed-out session. Screens: `sharing-screens/`. I did not touch the seeded link. To test revoke I created my own link (CLI, 1 h expiry) and revoked it; it shows "revoked" in the list now.

## Story

Ideal: select the file, press Share, choose expiry, copy link (3). Recipient: open link, press Download (2). Owner later: see links, turn one off (2).

## Friction Scorecard

|                      | Human in the console                                                                                                   | Recipient                                                                                                      | List / revoke                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Steps actual / ideal | cannot be done: 0 of 3 possible. Workaround = ask agent to run `share` (outside console)                               | 2 / 2 (open, Download)                                                                                         | 2 / 2 on the CLI only; 0 in the console                                         |
| Decisions            | which tab has sharing (none does)                                                                                      | 0                                                                                                              | which id (path is rejected; id only)                                            |
| Dead ends            | Files row has Download / Versions / Trash only (01); Agents tab and Activity & deletion contain no share text (02, 03) | no feedback visible after Download click in the headless run (05; the file save itself is not observable here) | `share list` returns raw JSON, no link (see below)                              |
| Hesitations          | Download is disabled until the drive key is loaded (01)                                                                | none                                                                                                           | which of two identical-path links to revoke: the list has no recipient or label |

## Take-away Pass (per screen)

- Files row (01): no Share action. Nothing on the screen mentions sharing.
- Agents tab (02): 9 agents, each with "Revoke access" as the only loud button; nothing about links.
- Activity & deletion (03): audit log is mostly the console's own `drives.list` / `console.audit.list` calls; it would bury a share event.
- Recipient page (04): good. Filename, "439 B encrypted", expiry in local time with zone, one big Download button, footer says no sign-in. "439 B encrypted" and "Encrypted file transfer" are the only slightly technical terms.
- Revoked page (06): "Share link revoked. The sender turned this link off. Ask them for a new link..." clear, with a next step.

## The Simpler Version

1. In Files, hover the row, press "Share".
2. Popover: expiry (default 7 days), Create link; copy button (the URL with the #k= part is shown once, since only the client can build it).
3. A "Shared links" list per file (and one global page) shows each link: created, expires, status, Copy, Revoke.
   Concrete changes:

- Add Share to the row (needs drive key loaded; if not, the same "Load drive key" prompt as Download).
- Add a Shared links section listing id, file, expiry, status with a Revoke button.
- CLI `share list` should print a table (path, status, expiry) rather than raw JSON, and `share revoke` should accept a path.
- Keep the recipient page as is.

## Clarity Issues

- The recipient page is clear, but nothing on the owner side tells a human that link sharing exists at all (01-03).
- Links cannot be retrieved after creation: `share list` shows id, path, expiry, status but no URL (list output). Losing the message means creating a second link; the old one stays active and unlabeled.
- After revoking, the list keeps the revoked row mixed with active ones (list output); no filter.
- Functional note: Download click on the recipient page gave no visible page change in the headless browser (05).

## Cloud-drive comparison

Dropbox/Google Drive: Share button on the row, dialog with "anyone with the link" plus expiry, Copy link, and a manage-access view where each link can be disabled. Recipient sees a preview and a Download button. Here the recipient experience is on par (and requires no sign-in); the owner side (create, see, revoke) exists only through the CLI/MCP, so a human who is not running an agent cannot do it from the console.

## Verdict: convoluted for the human sender (recipient page minimal)

Recipient: minimal. Human owner: the job cannot be finished in the console; they must ask an agent or run the CLI, and then cannot see or revoke links without the CLI.

Three most valuable changes: (1) Share button on the Files row with expiry and Copy; (2) a Shared links list with Revoke; (3) readable `share list` output and revoke by path.

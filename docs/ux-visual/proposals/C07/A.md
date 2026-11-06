# C07-A Minimal: re-order and shrink the existing card

Effort: S to M. Files: `apps/web/app/(app)/connect/connect.tsx`, `apps/web/app/styles/connect.css`. No new components.

## Change

Keep the card, the facts list and the banners. Change order, size and a few controls:

1. Heading first, large: `Connect vis-agent-a?` at 1.75rem/1.15 (the largest text on the card). Under it one line: `vis-agent-a on vis-b, requested 2:16 PM` (replaces the Agent, Machine, Requested rows).
2. The pairing code moves below the heading into a compact strip (`Code SZZN-LQVT`, mono 1rem, led dot) with the existing check sentence shortened to "Matches your terminal? Then approve."
3. Permissions are a `<dl class="connect-facts">` with three rows: Drive, Access, Writes under. Used for the offer and for new-drive review. Account stays as a fourth row only when more than one account exists (otherwise dropped; it is the signed-in user).
4. Delegate checkbox goes inside `<details class="connect-more"><summary>More options</summary>`, collapsed, after Approve (below the button, above the revoke note).
5. "Add to an existing drive instead" becomes `button.button.secondary` (min-height 44px), full width, directly under Approve.
6. Existing-drive form: one label, "Drive key" (same word as the console), remove the second "Or choose a recovery file" label; the file input is hidden behind a secondary "Choose file" button inside the same field row. Labels use gap 6px and 20px between fields. Read-only and Writes-under move into the same `<details>`.
7. Checkboxes get `accent-color: var(--sig)`, `width/height 20px`, and the label is `min-height: 44px; display:flex; gap:10px` (hit area at least 24 px).
8. `formError` renders inside the field wrapper that failed (`aria-describedby`, `border-color: var(--sig-dark)`), and `scrollIntoView({block:'nearest'})` after set.
9. Approved: `Approved vis-agent-a` heading; body "Access: read, write. Drive: research-bot." plus `Open the console` link to `/console/agents` and "The console will show it within a minute."
10. Code input: `autoFocus`, `onChange` uppercases and inserts the hyphen after 4 letters; the "missing" banner uses `banner error`; its slot is reserved (`min-height` on the form's error row) so no shift.
11. Brand mark: reuse `BrandMark` with the same wrapper class as `/sign-in` (`.auth-brand`), 24 px top.

## Before / after (review-new, 1440x900, approx.)

```
BEFORE (card 670 px)         AFTER (card ~520 px)
PAIRING CODE  *              Connect vis-agent-c?     (28px)
MJRQ-QBXZ (34px)             vis-agent-c on vis-c
check sentence (2 lines)     DRIVE   research-bot
Connect vis-agent-c? (20px)  ACCESS  read, write
AGENT/MACHINE/ACCOUNT/REQ    WRITES  /outputs
banner (permissions prose)   [ Approve agent ]
[] delegate + small text     [ Add to an existing drive ]
[ Approve agent ]            > More options
revoke note                  Code MJRQ-QBXZ  matches your terminal?
                             Revoke any time in Console, Agents.
```

## Offer arriving later

Before Approve: poll `GET device/<code>` every 5 s while the card is open and not busy; if `offerRevision` changed, `setRequest` and show the existing "The request changed" notice inline in the permissions block. Keep the 409 path as the fallback.

## Acceptance

1. Approve at about y 470 (review-new), inside 900/1024/844. Met.
2. Existing form: heading 28 + strip 36 + 4 rows of 44 + labels + Approve about 760 px at 1440; at 390 Approve is about 250 px below the fold. Met if the long banner is cut to one sentence (needed; the current 4-line banner costs 100 px).
3. 1.75rem heading vs 1rem code. Met. 4. details + 44 px button. Met. 5. dl. Met. 6. 20 px control, 44 px label, hint 16 px above button via `margin-block`. Met. 7. One word "Drive key", file button styled as secondary. Met. 8. Inline error plus scroll. Met. 9. Met by item 9. 10. Met. 11. Met.

## Risks

`<details>` hides the delegate permission: a user who wants delegation must open it (intended). Polling adds one request per 5 s per open card; stop after 10 minutes. The copy "Drive key" must also replace "recovery key" in the console (C10).

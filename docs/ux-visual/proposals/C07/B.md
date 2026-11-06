# C07-B Restructure: decision card with a drive choice and a sticky action bar

Effort: M. Files: `connect.tsx` (split into `ReviewCard`, `ExistingDriveFields`, `ApprovedCard` inside the same file), `connect.css`. New design-system pattern: segmented radio group (also useful in the Share dialog, C08-B).

## Change

The card becomes three zones: header (decision), body (what is granted), footer (actions, always visible).

```
+----------------------------------------------+
| (logo)                              ? Help   |
|                                              |
|  Connect vis-agent-a to Personal workspace?  |  28px, the focal point
|  vis-agent-a on vis-b · asked 2 min ago      |
|                                              |
|  Where should it work?                       |
|  (o) New drive, made for this agent          |  radio cards, 56 px each
|  ( ) A drive you already have  [nightly v]   |
|                                              |
|  It will get                                 |
|   Access   read, write, delete               |
|   Writes   anywhere   (change)               |
|                                              |
|  [Drive key .........................] [Choose file]   (only if "existing")
|  > Advanced: read only, let it add agents    |
|----------------------------------------------|
|  Code MJRQ-QBXZ  matches your terminal?      |
|  [ Not now ]            [ Approve agent ]    |  sticky footer
+----------------------------------------------+
```

- The drive choice replaces the hidden "Add to an existing drive" link: both options are visible, so the branch is discoverable and is a 56 px target. Only shown when `creates_drive` and the account has drives; otherwise the section is a fixed sentence.
- The pairing code is demoted to the footer line (it is a check, not a headline).
- Delegate, read only and write-path restriction all live in one `details` named "Advanced", closed by default. The write-path field shows as "Writes anywhere (change)" and expands inline.
- Existing drive: fields stack in the body; the body scrolls inside the card (`max-height: calc(100dvh - 220px)`), the footer never scrolls away, so Approve is always visible (L2).
- Inline errors per field (`aria-live`), and a summary line in the footer next to Approve for non-field errors.
- A "Not now" secondary button calls `device/<code>/deny` (the route `console.device.deny` already exists; the UI has none today).
- Approved: replace the card with a result: check mark, "vis-agent-a is connected", the permissions list, `Open the console` (primary link) and "Close this tab". The result polls `agents` once to show the agent row appearing: "It will appear under Agents when it finishes setup."
- Offer arrives later: the permissions block subscribes (poll 5 s). A new offer swaps the radio default to "Offered drive: research-bot" with a "New offer" tag and focus stays put.

## Acceptance

1. Footer sticky; Approve always in viewport. Met at all three sizes. 2. Body scrolls internally, so Approve visible at 1440 and 390 (0 px scroll needed). Met. 3. 28 px heading vs 1rem code. Met. 4. Advanced `details`; existing branch is a visible radio card of 56 px. Met. 5. dl list. Met. 6. 44 px radio rows, native `accent-color` checkboxes, 16 px gap above footer. Met. 7. One label "Drive key"; file picker as inline button. Met. 8. Field-level error and `scrollIntoView` inside the body container. Met. 9. Met. 10/11. As in A.

## Risks

More restructuring and a new pattern (radio cards) to add to the spec sheet; sticky footer inside a card needs testing with the mobile keyboard open. Adds Deny, which is new behaviour: confirm the route is meant for UI use.

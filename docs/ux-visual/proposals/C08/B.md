# C08-B Restructure: sharing lives on the file, with a Shared filter on the table

Effort: M to L. Files: `console.tsx`, `console.css`, `console-panels.css`. Adds a segmented control to the design system (also proposed in C07-B).

## Feasibility
Same as C08-A (client-side: metadata GET, `unwrapFileKey`, POST shares, URL with `#k=`; the console holds the drive key; the key travels only in the fragment). The list API returns no URL; only a link made in this session is copyable.

## Change
- A segmented control above the table: `All files | Shared (3)`. The Shared view lists links, not files: File, Created, Expires, Status, Revoke (same table component, different columns). It sits where users already look for files, so there is no extra button or dialog to find it.
- A file row with active links shows a small chip `Shared` in the Path cell (title attribute: "2 active links"). Clicking the chip opens the Share dialog on that file.
- Share dialog is two parts in one panel:
```
 Share inbox/2026-11-01.jsonl
 New link   expires [ 7 days v ]   [ Copy link ]
 ---------------------------------------------
 Links for this file
  Nov 6 -> Nov 13   Active    [ Revoke ]
  Oct 2 -> Oct 9    Expired
```
  So a sender can create and revoke in one place, per file.
- Revoke is a two-step inline button in the row ("Revoke" turns into "Revoke link to x? Confirm / Cancel"), avoiding a nested dialog.
- Unlock: Share opens the unlock modal first (same as Download).
- Trash: when the row has the Shared chip, the Trash button opens a small confirm: "inbox/x has 2 active links. They stop working while it is in Trash." [Move to Trash] [Cancel]. Without links, trashing stays one click.

## Before / after
```
BEFORE  /inbox/x.jsonl        577 B  bot  Nov 6   Download Versions Trash
AFTER   /inbox/x.jsonl [Shared] 577 B  bot  Nov 6  Download Share  Versions Trash
```

## Acceptance
1. Share dialog default 7 days, Copy link copies full URL, toast "Link copied". Met. 2. Shared view and per-file list show the five fields; confirm names the file; in-place update. Met. 3. Met. 4. Confirm dialog states links. Met (stronger than a toast). 5. Share (1), Copy link (2); two clicks. Met.

## Risks
Two places list links (Shared view and per-file) from one fetch, so they must share state. The chip needs a share count per row, which needs the whole share list loaded when the Files tab opens (one extra request, paginated). More work than A.

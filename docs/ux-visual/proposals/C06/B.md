# C06-B Restructure: replace the empty panel with a single guided checklist, receipt becomes a backup step

## Change

Stop treating first run as an empty state plus a modal sequence. Show one **Get started** card whose steps are live rows, each with a status and its own action, the way the landing's "How it works" list reads. The card stays on Files until all steps are done, then collapses into the normal drive list.

```
Get started with Agent Drive
 [done]    1  Create your account
 [current] 2  Connect your agent
              > Set up Agent Drive: https://host/llms.txt       [ Copy ]  (orange, the only primary)
              Your agent creates its own drive and keeps the key.
 [todo]    3  Or make a drive here   name [ my-drive ]            [ Create ]  (secondary)
 [todo]    4  Back up the drive key  Download recovery file       (appears once a drive exists)
```

- Step 2 is expanded and carries the single orange button (Copy). The panel header "+ New drive" stays secondary.
- Step 3 is an inline form (default "my-drive", Enter submits), not a dialog: the key is generated in the browser exactly as now (`generateDriveKey()`), the drive appears, and step 4 opens in place with one button **Download recovery file** that saves the file, POSTs `key-backup`, and flips the row to a green "Backed up" state. There is no receipt dialog and no checkbox; the key textarea sits behind a "Show key" disclosure on step 4.
- Row states are derived: step 2 done when an agent exists (`activeAgents.length`), step 3 done when `drives.length`, step 4 done when `drive.key_backup_at`.
- The checklist is the same component the banner uses for state, so "Key backed up" appears in the row and on the Files banner from the same `drive.key_backup_at` value.

## Why this differs from A

A keeps the modal receipt and reorders. B removes the receipt dialog, so the backup step cannot be separated from the drive by a dismissed modal. Users who create a drive and leave mid-receipt today reach the console with a key in memory and no backup; here the backup row stays visible as the current step until it is done.

## Files

New `GetStarted` component in `console.tsx` (or `get-started.tsx` beside it); `console-panels.css` (replace `.onboarding`, `.setup-steps` with `.checklist`, `.checklist-row[data-state]`); `globals.css` (`--ok`); shared `downloadRecoveryFile(id, key)` as in A; remove `driveReceipt` modal path and its tests.

## Effort

M to L. New component, new state machine, and the receipt tests in `apps/web` e2e need rewriting.

## Risks and encryption

- Key handling: the key still lives in `driveKeys` state in memory only; the "Show key" disclosure shows plaintext on screen (the receipt already does). Closing the tab before backing up loses it; the row says "Required: without this file the drive cannot be opened".
- Inline create has no modal focus trap, so keep `autoFocus` on the name field only on first render.
- More logic in the page than A; a wrong step state would mislead. Mitigate by deriving each state from API data, not local flags.

## Acceptance criteria

1. One orange primary (Copy in step 2); drive creation secondary; no "↗". Met.
2. Inline name field with default "my-drive", Enter submits. Met.
3. One "Download recovery file" action that saves and records the backup (no separate continue). Met, stronger than "and continue" since there is no dialog to close.
4. Row and banner read "Key backed up" (green) immediately after. Met.
5. The checklist is roughly 4 rows of 64 px plus a 120 px Copy block, about 45% of 900 px, vertically centred. Met.
6. Numerals with done/current/todo from data. Met.

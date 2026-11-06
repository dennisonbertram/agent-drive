# C06-A Minimal: fix the backup call, default name, Connect panel on top, numbered state steps

## Root cause confirmed in code
F19 / walker F-024-01 is a real code bug, not a headless artifact. In the receipt dialog (`console.tsx` ~line 1330) "Save recovery key" only calls `save(blob)`. The call that records the backup, `POST drives/{id}/key-backup`, lives only in `downloadRecoveryFile()` (line 495), which the banner button uses. So saving from the receipt never sets `key_backup_at`, and the banner then says "hasn't been backed up".

## Change
1. **Receipt:** make `downloadRecoveryFile` take the drive id and key as arguments and call it from the receipt. Replace the three controls (Copy, "Save recovery key", checkbox + "Continue to drive") with one primary **Download recovery file and continue**. It saves the file, POSTs `key-backup` (method `file`), refreshes drives, closes the dialog, sets `tab` to Files. Keep the key textarea and the existing CopyButton as a quiet secondary row for people who use a password manager. Delete the "I saved my drive key securely" checkbox: the click is the confirmation.
2. **Banner:** after refresh the drive has `key_backup_at`, so the existing code shows `backupText` ("Key backed up <date> (file)"). Give the banner `info` state a green dot: add `--ok` to `:root` (a design-system addition; today `--positive` is aliased to `--sig-dark`, an orange, so no green exists). Hide "Download recovery file" once backed up (it is already hidden for the Copy button, make the same condition apply).
3. **Drive name default:** `defaultValue="my-drive"` on the input, `autoFocus` plus `onFocus={e => e.target.select()}` so typing replaces it. The form already submits on Enter. Only when `drives.length === 0`; otherwise leave empty (a second "my-drive" returns "A drive with this name already exists").
4. **First-run panel:** add a "Connect your agent" block above the button, reusing the landing's instruction line and the existing `CopyButton` with `className="button primary"`: `> Set up Agent Drive: {origin}/llms.txt`. "Create a drive" becomes `.button.secondary`; the toolbar "+ New drive" already is secondary when `drives.length === 0`. Remove the "↗". Panel gets `min-height: 60vh` with the content centred (`display:grid; place-content:center`) so it is vertically balanced.
5. **Steps:** replace `01 Create a drive` mono labels with the landing's numeral list: `1`, `2`, `3` with state classes `done` (check mark, muted), `current` (ink, bold), `todo` (muted). State derives from data: step 1 done when `drives.length>0`, step 2 done when the selected drive has `key_backup_at`, step 3 done when `activeAgents.length>0`. First visit: step 1 current.

## Before / after
```
Before                                    After
  A LITTLE SETUP...                         Give your first agent a home.
  Give your first agent a home.             Give this to your agent
  Create a drive, save...                   +---------------------------------+
  [ Create your first drive ^ ]  (orange)   | > Set up Agent Drive: .../llms.txt |
  01 Create  02 Save  03 Connect            | [ Copy ] (orange)               |
  (11% of viewport used)                    +---------------------------------+
                                            or  [ Create a drive ]  (secondary)
                                            1 Connect an agent   (current)
                                            2 Create a drive
                                            3 Save your key
```
Step order follows the new lead: connect first, then drive (an agent that connects creates its own drive through `/connect`).

## Files
`apps/web/app/(app)/console/console.tsx` (lines ~495-509, 709-735, 1292-1370), `apps/web/app/styles/console-panels.css` (`.onboarding`, `.setup-steps`), `apps/web/app/globals.css` (`--ok`). No API change: `key-backup` exists.

## Effort
S to M (half a day plus an e2e update for the removed checkbox and the new button label).

## Risks and encryption
- The key still never leaves the page; only `{ method: 'file' }` is sent. A browser cannot confirm that the download finished, so "backed up" means "download started" (same as today's banner button). State this in the toast: "Recovery file downloaded. Store it in a password manager."
- Removing the checkbox removes a speed bump. The dialog is non-closable until the button is pressed (`closable` is already false for `driveReceipt`), so the user cannot skip the save.
- If the POST fails after the download, show the existing error banner and leave the dialog open so the user can retry; the file is simply downloaded again.

## Acceptance criteria
1. One orange primary: the Copy button in the Connect panel; "Create a drive" and "+ New drive" secondary; no "↗". Met.
2. `defaultValue="my-drive"`, Enter submits. Met.
3. One "Download recovery file and continue" that saves and closes. Met.
4. Banner reads "Key backed up <date> (file)" with a green dot straight after, because the POST and `refresh()` run before close. Met (needs `--ok`).
5. Panel centred in `min-height: 60vh`, content about 40% of the 900 px viewport. Met.
6. Numbered steps with done/current/todo classes driven by data. Met.

# Decisions index (ux-visual run 2)

Phase 5 only. External MUSE Wonder and Gemini Argon judges were skipped in this run; each decision uses the three internal judge lenses (usability, visual craft, engineering). Implementation is done in /ux-auto-improve.

## Decisions
| Cluster | Decision |
|---|---|
| C01 | A (shared SiteHeader, details menu at 390) + hero secondary "Create a free account" + SiteHeader above auth cards + shared auth footer line |
| C02 | B (shared ListState and one status value per list), first; Files and Trash first; A's friendlyError and min-height; keep footer line |
| C03 | A (menu, Toast with Undo, ConfirmDialog, in-place revoke) with C's wording, Dropbox version labels, Trash as danger item; receipt dropped (C06) |
| C04 | A + C grafts (breadcrumb with drive dropdown, view switcher in URL, sort, icons, one primary, remembered drive, 56-60 px mobile rows, load cap); covers C14 |
| C05 | A (Download never disabled, unlock dialog, one key chip, --ok/--danger) + 30 min idle lock; "Remember on this device" deferred |
| C06 | A (one "Download recovery file and continue" that POSTs key-backup) + C's Step line, sentence and hidden key |
| C07 | A + C's order (heading, capability list, code above Approve), delegate disclosure, existing-drive inline step, polling; no Deny |
| C08 | A (Share in menu and row, dialog with expiry, links for this file, Shared view) + no-key POST test |

## Build order
C02 -> C06 -> C05 -> C04 -> C03 -> C08 -> C07 -> C01.
C07 and C01 do not touch `console.tsx` and can run in parallel with each other and with the console clusters. Clusters editing `console.tsx` run sequentially.

## Shared tokens and components
- Tokens `--ok` (green) and `--danger` (red): defined once in `apps/web/app/globals.css` (by C02/C05, whichever lands first, `--danger` in C02), documented in `docs/design/spec-brief.md`; status only, never decoration. Orange stays for the primary action and LED.
- `ListState` + `useListLoad` (C02): used by C04 rows and the Shared view.
- `Toast` and `ConfirmDialog` on the existing `Dialog` (C03): used by C05 (Saved), C06 (recovery downloaded), C08 (Link copied).
- Row "⋯" menu (C03, keyboard operable): holds Versions, Share (C08), Trash.
- View switcher `Browse | Recent | Shared` (C04): Shared filled by C08.
- Key chip and unlock Dialog with `pendingAction` (C05): used by Download and Share; chip menu shows backup state set by C06.
- Backup helper (C06): download plus POST key-backup, shared by banner action and receipt.
- `SiteHeader` (C01).

## Conflicts resolved
- Receipt dialog: C06 owns it; C03's receipt criterion dropped.
- Banner vs chip: C05 chip replaces the banner, badge and Load/Forget; C06's "Key backed up" is the chip menu line.
- Drive strip: replaced by C04's breadcrumb drive dropdown; account tabs show no drives.
- Skeleton column template (C02) vs C04 columns: template exposed as a CSS variable.
- Deny on /connect: not added (owner decision), despite judges proposing it.
- Remember on this device: deferred out of C05 to its own PR (opt-in, off by default, warning; no CSP found).
- Trash share notice (C03) depends on C08's background share count.
- Judges' picks differing from the lead: C04 usability judge picked C; C05 usability judge picked C; C07 judges split. Lead decisions follow the notes in each file.

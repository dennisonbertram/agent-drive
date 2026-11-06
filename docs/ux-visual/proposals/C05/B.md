# C05 / B: Restructure (key state lives on the drive; unlock sheet and drop-anywhere)

Pairs with C04/B (drive switcher tile, details pane, Sheet pattern).

## Change
Treat the key as a property of the drive, shown once on the drive switcher tile, and make unlocking a non-modal sheet.
1. Key state appears in one place: the drive switcher tile (C04/B), as a status line with a lock icon: red "Locked" or green "Unlocked". No toolbar badge, no banner, no separate Load/Forget button. Backup state is a second line in the tile menu ("Recovery file saved Nov 6" or red "Not backed up: Download recovery file").
2. Download is always enabled (no disabled state). While locked, Download opens the unlock Sheet anchored to the details pane (desktop: slides over the pane; 390: bottom sheet). Sheet content: a drop target "Drop your recovery file here" with a "Choose file" button; "Paste a key" in a disclosure.
3. Drop anywhere: a recovery file dropped on the file list while locked shows an overlay "Release to unlock research-bot" and unlocks. Keyboard and touch users use the Choose file button (the drop is an extra, not the only path).
4. After unlock, the sheet closes and the pending download starts. Errors render in a reserved line inside the sheet ("That recovery file is not for this drive.").
5. Row busy label while downloading; toast "Saved <name>" when done (same toast as C03).
6. Remember on this device: a switch in the unlock sheet and in the tile menu, same mechanism as A (non-extractable WebCrypto AES-GCM key plus ciphertext in IndexedDB). Adds an idle lock: the key leaves memory after 30 minutes without use unless remembered.
7. Tokens: `--ok`, `--danger` as in A; disabled text without opacity.

## Before / after (1440)
```
 [ research-bot v ]  (lock) Locked        details pane
 ...                                      2026-11-01.jsonl  [Download]
 Download ->  +-- Unlock research-bot --------+
              | Drop your recovery file here  |
              | [Choose file]                 |
              | (error line reserved)         |
              | > Paste a key  [x] Remember   |
              +-------------------------------+
```
At 390 the tile lives in the top bar; the sheet rises from the bottom (48 px controls, thumb reachable).

## Files touched
`console.tsx` (download, loadKeyFile), new `unlock-sheet.tsx` (uses the C04/B Sheet), new `remembered-key.ts`, `drive-switcher.tsx` from C04/B, `console.css`/`console-panels.css` (remove `.keyline`, `.badge.positive`), `globals.css` tokens. Effort: L (M if built after C04/B).

## Risks
- Depends on C04/B shipping the Sheet and switcher; if C04 picks A or C, use C05/A or C05/C instead.
- Drop-anywhere handler must call `preventDefault` only for files and only while locked, so it does not swallow browser drag behavior.
- Same storage trade-off as A for Remember: anyone with this browser profile, or script on the origin, can use the stored key. Say so next to the switch.
- Idle lock can surprise a user mid-task; show a toast "Locked after 30 minutes. Click Download to unlock."

## Acceptance criteria
1. No disabled Download; one prompt with file first: items 2-3.
2. File choice or drop loads key and starts download; paste in a disclosure: items 3-4.
3. 0 px shift and plain error: item 4.
4. Busy label and toast: item 5.
5. One signal (tile status line), green/red, recovery download shown only when not backed up: item 1.
6. Remember on this device: item 6.
7. Contrast: item 7.

# Journey: download and decrypt (slug download-decrypt)

Signed in as e2e_uxreview, 1440x900, research-bot drive. Screens: `download-decrypt-screens/` (copies of the key-loading shots from the find-open-file run).

## Status of this journey

Observed: key-required state, Load drive key dialog, loading from the recovery file, Key loaded state, the Download click. NOT observed: the download finishing, /outputs/reports/summary.pdf, an image, the success notice, and the next-visit behaviour. After the Download click the buttons stayed disabled for 25+ seconds (08-downloaded) and the local MinIO storage at 127.0.0.1:19000 was not answering (TCP accepted, no HTTP reply). I did not restart it. Next-visit behaviour is from code reading only (console.tsx line 262 area and the dialog text "cleared when you reload"), not from a live reload.

## Story

STORY-026 (load the key from a recovery file) combined with STORY-025 (first download) and STORY-029 (key-backup banner).
Ideal path (2 steps): click Download; if the key is missing, pick the recovery file in the same prompt and the download starts.

## Friction Scorecard

| Measure                           | Actual                                                                                                               | Ideal           | Evidence       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | -------------- |
| Steps to first decrypted download | 6: find row, click disabled Download (nothing), Load drive key, Choose File, Load key, Download                      | 2               | 02, 05, 06, 07 |
| Decisions                         | Paste or choose a file                                                                                               | 0               | 05             |
| Re-entry                          | Key held in page memory only, so every reload and visit repeats steps 3-5 (per the dialog text and STORY-025)        | once per device | 05 text        |
| Confirmations                     | Extra "Load key" click after choosing a file                                                                         | 0               | 06             |
| Dead ends                         | Disabled Download button gives only a tooltip and a "KEY REQUIRED FOR DOWNLOADS" badge, not an action                |                 | 02             |
| Hesitations                       | After choosing the file the field shows 43 dots and the file input shows the filename; nothing says the key was read |                 | 06             |

## Take-away Pass

- 05 Dialog: the password field comes first and is large and black, while most users arrive with a file, so the secondary path (file) is the main one for them. The line "For research-bot. Your key stays in this page's memory and is cleared when you reload." is the right text and clear.
- 06 After choosing the file: the dots field is a pointless display of a secret the user did not type. The orange Load key button is the single primary action, which is correct.
- 07 Key loaded: the badge "KEY LOADED" has a red dot, the same colour as the "key required" badge dot and the backup banner, so red means both good and bad. "Download recovery file" appears in the banner row even though the banner says "Key backed up 11/6/2026 (file)"; the two statements read as contradictory.
- 08 During download: Refresh, New drive and all row actions are disabled, with no spinner or progress text on screen.

## The Simpler Version

1. Click Download on a row.
2. If the key is not loaded, a prompt opens at that point: "Choose your recovery file" (file picker first, paste as a text link), and choosing the file loads it and starts the download in one go.
3. File downloads; the drive stays unlocked for this tab and, optionally with a "Remember on this device" checkbox, for later visits (stored encrypted in the browser).
   Changes: (a) enabled Download that opens the key prompt, (b) auto-submit on file selection, (c) hide the key characters, show "Key read from research-bot-recovery", (d) one colour meaning per state (green for loaded/backed up), (e) show a busy label on the clicked row, (f) hide "Download recovery file" once the banner says it is backed up, or explain that it makes another copy.

## Clarity Issues

- "Key required for downloads" appears before the user knows what the drive key is; no link explains it.
- Backup banner wording and the recovery-file button disagree (07).
- Header "File contents encrypted · Paths and metadata visible to the service" in the table footer is a good, honest line.
- The 4 states of the key (required, loaded, backed up, not backed up) are shown in three places (badge, button label, banner).

## Cloud-drive comparison

Dropbox and Google Drive never ask for a key: click a file, it opens. The nearest equivalent is a password-protected zip or a password manager unlock, where you unlock once per session or per device and the app offers "remember me". Here the unlock repeats on every visit and every reload. A cloud-drive user would expect the unlock prompt only at the moment of need, a preview, and a progress state while downloading.

## Functional note

The download did not complete in this run; the cause was the unresponsive local storage service, not shown to be a console bug. The button stays disabled while it waits, and no timeout message appeared within 25 seconds.

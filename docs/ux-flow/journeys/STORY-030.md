# STORY-030: Unlock with the recovery key file

Verdict: **acceptable**. Actual 5 steps vs ideal 3 (catalog Ideal path: choose file, load key, download).
Evidence legend: [M] measured live by lead, [S] screenshot in docs/ux-flow/screens/, [C] code, [Cat] catalog text, [?] suspected, not observed.

## Friction Scorecard

| Check          | Finding                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Steps vs ideal | Actual 5 (open console, click Load drive key, choose file, click Load key, click Download). Ideal 3. The two extra steps are the dialog open and the separate "Load key" button after the file is chosen.                                                                                                                                                                   | [Cat] steps 1-5; [S] 12                    |
| Decisions      | Dialog shows two ways to give a key (paste, or file). A user holding the file must first see that the file input is the one to use. The text field comes first and the file option is labelled "Or choose a recovery file".                                                                                                                                                 | [S] 12                                     |
| Re-entry       | The key is held in page memory only, so every reload repeats the whole sequence. Recovery file must be found again each time (Downloads folder).                                                                                                                                                                                                                            | [M] dialog text; [C] console.tsx:1071      |
| Confirmations  | No confirmation dialogs. The only gate is "Load key", which is a submit, not a confirm.                                                                                                                                                                                                                                                                                     | [C] console.tsx:1094                       |
| Dead ends      | If the file is lost, no UI path. Catalog says the same. Wrong-drive file gives a clear red error.                                                                                                                                                                                                                                                                           | [Cat] edge cases; [C] console.tsx:348      |
| Hesitations    | (1) After choosing the file, the only visible change is a masked field filling with dots, so the user cannot tell the file was accepted. (2) After "Load key" the notice says "A download will verify that it matches this drive", so "Key loaded" does not mean the key works. (3) Download buttons look disabled until key loaded, with no inline explanation on the row. | [Cat] step 3; [C] console.tsx:1066; [S] 02 |

## Take-away Pass

**Files tab (02-console-files)**

- Drive id in monospace next to the selector: not used by this journey. Collapse or move into a tooltip. [S] 02. (Might help when matching file `agent-drive-<id>.key.json`; that is the one use. Hidden behind the selector it still serves that.)
- "Key required for downloads" chip, the banner "You can browse file names without a key... Keys are kept only in this page's memory.", and the dimmed Download buttons all say one thing three times. Keep the chip, drop the banner once a key is loaded, and make the row action say "Unlock" instead. [S] 02, [M] banner text.
- Sidebar "Files 1" badge counts something other than the 9 files shown (it appears to count drives). It adds a false number to the screen. Remove or relabel. [M] lead measurement; [S] 02.
- "Refresh" button: not used in this journey. Low-priority; keep.
- Filter box "Filter loaded files...": not used here.

**Load drive key dialog (12-dialog-load-drive-key)**

- Paste field is shown first and is the visual primary, but a user following this story will use the file input. Put "Choose recovery file" first, or put the paste field behind "Paste key instead".
- "Load key" button is required even after a file is chosen. Remove it for the file path (see below).
- Intro sentence has two ideas (stays in memory, cleared on reload). Keep one sentence; the second is already stated in the page banner.

**Trash tab (06-console-trash)**

- Duplicates drive selector and Load drive key controls [M]. The key already loaded on Files applies per drive (keys held by drive id, [Cat] edge cases), so one shared lock control is enough.

## The Simpler Version

1. Open /console. The locked state is the entry point. A single "Unlock drive" button replaces the chip + banner + button trio.
2. Click "Unlock drive" (or any dimmed Download button, which opens the same dialog).
3. Choose the recovery file. On a valid file the dialog loads the key and closes itself. Notice: "Unlocked agent-traces." No separate "Load key" click.
4. Click Download on a row. If the user came from a Download click, the download starts automatically after unlock (remember the pending row).

That brings 5 steps down to 3 for the click-Download-first user (click Download, choose file, done) and 4 for the browse-first user.

Concrete changes

- File input `onChange` in `loadKeyFile` already validates and decodes the key (console.tsx:331-350). Call the same `setDriveKeys` + `setModal(null)` there instead of only `setKeyInput`. About 3 lines. [C]
- Make Download on a locked row open the unlock dialog instead of being disabled. [C: currently disabled with title "Load your drive key first", per Cat.]
- Show the file name next to the file input after selection, or a green "Recovery file accepted", if the dialog is kept open.
- Drop the Trash tab's duplicate unlock controls and reuse the Files state.

## Clarity Issues

- "Key loaded" misleads: the notice admits the key is only verified at download [C console.tsx:1066]. Either verify at load time (decrypt one small file or check a key-check value), or word it "Key set. It is checked when you download." [Cat STORY-031]
- "Drive key" and "recovery file" are two names for one secret in the same dialog. Use one term, e.g. "Drive key (paste, or choose the file you saved)". [S] 12
- Error "This recovery file does not belong to the selected drive." gives no next step. Say which drive the file is for if its driveId is known, and offer the drive switch. [C console.tsx:348]
- Dimmed Download buttons: it is unclear without hovering why they are dimmed. [S] 02
- Lost-file case has no UI help. One line pointing to where the key was saved (password manager) is already said at creation, not here. [Cat edge cases]

Already minimal: no confirmation dialogs; wrong-drive and non-JSON errors are specific and immediate.

# Topic: Download and decrypt in the browser

Source: `apps/web/app/(app)/console/console.tsx`, `apps/web/src/console/credentials-bundle.ts`, `packages/agent-drive/src/crypto.ts` at main 2870d7a (read from code, not run).

## STORY-025: First download of a file with a pasted drive key

**Type**: medium
**Topic**: download-decrypt
**Persona**: Priya, who has the key in her password manager and wants /reports/q3/summary.md.
**Goal**: Download the decrypted file.
**Preconditions**: Signed in; key not yet loaded this session.
**Ideal path**: 3 — load key once, click Download, open file.
**Alternate paths**: CLI `agent-drive get /reports/q3/summary.md --output ./summary.md` (key comes from config); share link page (`/s/id#k=...`) for a single file; MCP `get`.

### Steps

1. Open Files → badge "Key required for downloads"; every Download button is disabled with tooltip "Load your drive key first".
2. Click "Load drive key" → dialog "Load drive key": "For research. Your key stays in this page's memory and is cleared when you reload."
3. Paste the 43-character key into "Drive key or credentials bundle (adcred1.…)" (a password-type field) → click "Load key".
4. Dialog closes; badge turns "Key loaded" and "Forget key" replaces the load button.
5. Click "Download" on the row → file is fetched as ciphertext, decrypted in the browser, saved as summary.md; notice "File decrypted in your browser. Download started."

### Variations

- Pasting with a trailing newline is fine (the value is trimmed).
- Pasting an `adcred1.` bundle works; the drive's key is picked out of it.

### Edge Cases

- Clicking a disabled Download shows only a tooltip, no message, so a user may not see why it is dead (mouse users only).
- Reload clears the key; the user repeats steps 2-4 each session.
- Files with the same name in different folders save under only the last path segment.

## STORY-026: Load the key from a recovery file

**Type**: medium
**Topic**: download-decrypt
**Persona**: Marcus, who saved agent-drive-drv_8f2a.key.json to his Downloads folder two weeks ago.
**Goal**: Unlock the drive without copying the key text.
**Preconditions**: Recovery file exists; drive "research" selected.
**Ideal path**: 2 — choose the file, confirm.
**Alternate paths**: paste key text; choose an `adcred1.` bundle file.

### Steps

1. Click "Load drive key" → dialog opens.
2. Use the "Or choose a recovery file or credentials bundle" file input and pick the .key.json → the key text fills the password field (nothing visible indicates success; the field shows dots).
3. Hesitate: nothing seems to have happened; click "Load key" → dialog closes, badge "Key loaded".

### Variations

- File picked for the wrong drive → banner inside the dialog "This recovery file does not belong to the selected drive."
- A file over 16 KB → "This is not a valid drive key file."
- A random JSON or text file → "Choose a JSON recovery key file downloaded from this console."
- Bundle without this drive → "The bundle does not contain a key for this drive."

### Edge Cases

- Choosing a file does not submit; the extra "Load key" click is easy to miss (gap).
- The same recovery file used while another drive is selected fails by design (driveId check), but a pasted raw key is never checked against the drive.

## STORY-027: Wrong key accepted, then decryption fails

**Type**: long
**Topic**: download-decrypt
**Persona**: Jonas, who has two drives and two similar-looking keys in his notes.
**Goal**: Download a file and understand why it fails.
**Preconditions**: Drive "client-acme" selected; Jonas pastes the key for "research".
**Ideal path**: 3 — paste key, see an immediate mismatch error, paste the right key.
**Alternate paths**: use the recovery file for the drive (checked against the drive id); use CLI `get`, which uses its own stored key.

### Steps

1. Click "Load drive key", paste the research key, click "Load key" → accepted: format check only (43 characters, canonical base64url); badge "Key loaded" (gap: no check that it belongs to this drive).
2. Click "Download" on /clients/acme/contract.pdf → request runs, then the banner shows "Unable to decrypt: the drive key is wrong, or the file is damaged or incomplete."
3. Retry Download → same error.
4. Click "Forget key" → notice "Drive key removed from this browser session."; badge "Key required for downloads".
5. Click "Load drive key", paste the right key → Download works.

### Variations

- Typo in a pasted key → immediately "Invalid drive key. Expected a base64url-encoded 32-byte key." in the dialog (this one is caught up front).
- Key with spaces inside → same invalid-key error.

### Edge Cases

- The first error appears only after the ciphertext is fetched, so egress is spent on a failed attempt.
- The same message covers wrong key, corrupt file, and incomplete upload, so the user cannot tell which.
- Bad "Download recovery file" with a wrong key: see the recovery-file story.

## STORY-028: Forget the key on a shared computer

**Type**: short
**Topic**: download-decrypt
**Persona**: Elena, using a hotel business-center PC and about to leave.
**Goal**: Make sure the drive key is gone from the browser.
**Preconditions**: Two drives with keys loaded.
**Ideal path**: 1 — one action that clears all keys (sign out).
**Alternate paths**: reload or close the tab (memory only; nothing in localStorage, per dialog text); Clerk sign-out via "Your account".

### Steps

1. On drive "research" click "Forget key" → notice "Drive key removed from this browser session."; badge changes.
2. Switch to "client-acme" in the Drives strip → still "Key loaded" (keys are per drive).
3. Click "Forget key" there too.
4. Sign out through "Your account" and close the tab.

### Variations

- Elena just closes the tab → keys vanish (memory only).
- Elena forgets only the visible drive and walks away → the other drive's key remains in the open tab (gap: no "forget all").

### Edge Cases

- The notice text clears as soon as another action starts.
- Trash tab also shows Forget key although Trash has no Download; the state is the same per drive.
- The drive receipt page lists the plain key in a textarea; leaving it open on a shared PC is a risk (dialog cannot be closed until acknowledged).

## STORY-029: Key-backup banner on an agent-created drive

**Type**: medium
**Topic**: download-decrypt
**Persona**: Hana, whose agent trace-bot made the drive through `/connect` but has not run `credentials confirm`.
**Goal**: Understand the red banner and make it go away.
**Preconditions**: Drive exists without a backup record.
**Ideal path**: 2 — read the banner, act on it (confirm backup or save a recovery file).
**Alternate paths**: agent runs `credentials export --to PATH` then `credentials confirm`; the human loads the key and clicks "Download recovery file".

### Steps

1. Open Files → red banner "This drive's key hasn't been backed up. If the agent's machine is lost, these files can't be opened. Ask the agent to run agent-drive credentials export", with a copy button ("Copy credentials export command").
2. Click the copy button and paste it into a terminal herself → she has no key locally; the command belongs to the agent's machine (confusion).
3. Tell the agent; the agent exports and runs `credentials confirm`.
4. Click "Refresh" → banner becomes the info line "Key backed up 11/5/2026 (stdout)" with a dimmed LED.

### Variations

- Hana has the key from an old recovery file: "Load drive key", then "Download recovery file" appears in the banner; click it → file saved, notice "Recovery file saved. Store it in a password manager or another secure location.", banner changes to "(file)".
- Banner stays red until Refresh or the next list load for agent-side confirms.

### Edge Cases

- The banner text is clipped in a single line; the full text is in the title tooltip.
- The same fact (backed up or not) also appears in CLI `check` ("check ok" only after confirm) and `credentials status`.
- The banner appears only after the file list has loaded.

## STORY-030: Save a recovery file twice

**Type**: medium
**Topic**: download-decrypt
**Persona**: Wei, creating a drive in the console and trying to do the right thing.
**Goal**: Back up the key and have the console agree.
**Preconditions**: Drive just created in the console.
**Ideal path**: 2 — save the recovery file at creation, banner shows backed up.
**Alternate paths**: copy key from the receipt into a password manager (not recorded by the service); "Download recovery file" on the Files tab.

### Steps

1. Create drive → receipt "Your drive. Your key." shows the key textarea; click "Save recovery key" → file agent-drive-drv_91c.key.json downloads.
2. Tick "I saved my drive key securely" → "Continue to drive".
3. On Files, the banner is red ("hasn't been backed up") although she just saved it.
4. Click "Download recovery file" (shown because the key is already loaded) → second copy saved; notice "Recovery file saved..."; banner turns "Key backed up ... (file)".

### Variations

- Wei skips the file at the receipt and ticks the box anyway → no check that a copy was made.
- Wei copies the key to a password manager at the receipt; banner stays red until she also downloads a file or the agent confirms (the service cannot know).

### Edge Cases

- Two identical files with different names in Downloads, e.g. "agent-drive-drv_91c (1).key.json".
- The banner advice ("Ask the agent to run ...") does not fit a drive that no agent has used yet.

## STORY-031: Recovery file made with a wrong key

**Type**: medium
**Topic**: download-decrypt
**Persona**: Aisha, who loads an old key from her notes without testing it.
**Goal**: Create a trustworthy backup.
**Preconditions**: Drive without backup; Aisha loads a valid-format but wrong key.
**Ideal path**: 3 — load key, verify it decrypts something, save recovery file.
**Alternate paths**: CLI `agent-drive check` after `credentials export`, which tests the key against a file.

### Steps

1. "Load drive key" → paste the wrong key → accepted, badge "Key loaded".
2. Banner shows "Download recovery file" → she clicks it → a file with the wrong key is saved as agent-drive-<id>.key.json.
3. The console records the backup (method "file") and the banner changes to "Key backed up <date> (file)" (observed in code: no test of the key before recording).
4. Later she tries Download → "Unable to decrypt: the drive key is wrong, ...", and the red banner is gone, so the false assurance remains.

### Variations

- If the drive is empty, nothing can reveal the mistake at all.

### Edge Cases

- Loading from a recovery file avoids this (driveId is checked), but still does not verify the key bytes.
- (gap) No "verify key" step before marking a drive as backed up.

## STORY-032: Download from a restored or large file list

**Type**: long
**Topic**: download-decrypt
**Persona**: Tomás recovering after his agent's laptop died.
**Goal**: Pull back three files from a drive via the console.
**Preconditions**: Recovery file available; drive with 240 files.
**Ideal path**: 6 — load key, filter, download x3 (could be 5 with multi-select).
**Alternate paths**: new machine: `login` then `/connect` "Add to an existing drive instead", then `agent-drive sync`/`get`.

### Steps

1. Open Files, "Load drive key", choose the recovery file, "Load key" → "Key loaded".
2. Filter "ledger" → 2 of 100 loaded rows.
3. Click "Download" on the first → "File decrypted in your browser. Download started."
4. Click "Download" on the second → the previous notice is replaced (every action clears notices).
5. Third file is on page 2: clear filter, "Load more files", filter again, Download.
6. Browser asks whether to allow multiple downloads.

### Variations

- Chrome blocks the second automatic download until the user allows it.
- A large (hundreds of MB) file: the whole ciphertext is read into memory before decrypt; no progress bar, only disabled buttons while busy.

### Edge Cases

- No download-all or zip, no multi-select (gap).
- Network failure mid-download → "The encrypted file could not be downloaded." and the key stays loaded.
- Download URL that fails validation is rejected by `validateDownloadUrl`.

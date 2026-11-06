# C05 / A: Minimal (unlock on demand in the existing dialog, one key chip)

Pairs with C04/A (same toolbar and row `⋯` menu).

## Change
1. Remove `disabled={busy || !hasKey}` and the tooltip from Download. Click with no key stores the pending file (`pendingDownload` ref), opens the existing `unlock` Dialog.
2. Dialog restructured: title "Unlock research-bot". Body: one large file target "Choose your recovery file" (primary control, `input type=file` styled as a button, also accepts a dropped file). Below it a `<details>` "Paste a key instead" holding the existing password field. The dialog has no "Load key" button for the file path: choosing a valid file loads the key and closes the dialog, then runs `download(pendingDownload)`. The paste path keeps a "Unlock" button.
3. Errors: a reserved 20 px line under the target (`min-height`, `role=alert`, `aria-live`), so the form does not move. Copy: "That recovery file is not for this drive." (wrong drive), "That is not a recovery file." (bad JSON / size), "That key is not valid." (paste). Mapped from `loadKeyFile` errors; no "base64url" text.
4. The row shows "Downloading..." (label swap, `aria-busy`) while `download()` runs; on finish a toast "Saved 2026-11-01.jsonl" (reuses `notice-slot`, 6 s; same toast as C03).
5. One key chip replaces badge, Load/Forget button and the banner's second job. Chip is a button in the toolbar, next to the filter:
   - not loaded: red dot + "Key needed" (click opens the unlock dialog)
   - loaded: green dot + "Key loaded" (click opens a small menu: "Forget key", "Download recovery file" shown only when `key_backup_at` is null)
   - not backed up appends a red "Not backed up" state to the chip menu, not a second chip.
   The yellow/red "backup" banner is removed; backup state is in the chip menu and, when missing, a red dot on the chip. The once-explained text lives in the menu: "Recovery file saved Nov 6. Keep it somewhere safe."
6. "Remember on this device" checkbox in the unlock dialog (off by default). On: generate a non-extractable AES-GCM `CryptoKey` with `crypto.subtle`, store it with the AES-GCM ciphertext of the drive key in IndexedDB (`ad-keys`, keyed by drive id). On load, decrypt into `driveKeys`. "Forget key" deletes the record. Implementation: reuse WebCrypto style of `apps/web/src/device/seal.ts`; new file `apps/web/src/console/remembered-key.ts`.
7. Tokens: add `--ok: #1a7f4b` and `--danger: #b42318` (about 5.0:1 and 6.5:1 on white). Disabled controls: `color: var(--muted)` without opacity (about 5.4:1 text; border at 3:1). Filter field `disabled` follows the same rule.

## Before / after
```
BEFORE  [KEY REQUIRED FOR DOWNLOADS] [Load drive key]   29 x [Download] (disabled, 2.5:1)
        banner: Key backed up ... [Download recovery file]
AFTER   [ (red) Key needed ]   Download (normal)  ->  click
        +-- Unlock research-bot ----------------+
        | [  Choose your recovery file  ]       |
        | (reserved error line)                 |
        | > Paste a key instead                 |
        | [ ] Remember on this device           |
        +---------------------------------------+
```
At 390 the dialog is full width, file button 48 px, same flow; the chip sits in the one-row toolbar from C04/A.

## Files touched
`console.tsx` (`download`, `loadKeyFile`, unlock Dialog ~L1380, banner block ~L735-770, toolbar ~L789-830), `console.css` and `console-panels.css` (`.badge.positive`, `.keyline`, disabled rules), `globals.css` (`--ok`, `--danger`), new `remembered-key.ts`. Effort: M.

## Risks
- Remember on this device: protects against someone reading browser storage without the page, but any script running on the console origin can decrypt it (XSS). State this beside the checkbox: "Anyone who can use this browser profile can open this drive." Off by default. The key never reaches the server.
- Auto-run after load needs the pending download to survive the dialog (ref, cleared on close).
- Browsers may block a download that is not started by a user gesture; the file choice is a gesture, but verify in Safari.

## Acceptance criteria
1. No key-disabled Download; click opens one prompt, file chooser first: items 1-2.
2. File choice loads and starts download; paste behind a disclosure: item 2.
3. 0 px shift, plain error text: item 3.
4. Busy label and saved toast: item 4.
5. One chip, green (loaded) / red (needed, not backed up); recovery file hidden once backed up; banner removed: item 5.
6. Remember on this device: item 6.
7. Contrast >= 4.5:1 for enabled and >= 3:1 for disabled: item 7.

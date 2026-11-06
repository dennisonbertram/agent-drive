# C05 / C: Convention (password-manager and vault unlock)

Pairs with C04/C (breadcrumb header, "+ New", row hover actions).

## What best-in-class products do
- Cryptomator and Proton Drive keep the file list visible when a vault is locked and put a single "Unlock" action at the top; unlocking is one step with the secret and a clear lock state.
- 1Password and Bitwarden show a lock icon that is also the control: click to unlock, click again to lock. They offer "remember this device" and an idle auto-lock.
- Box and Dropbox show a password prompt only when you open a protected link, never as a disabled control.

## Change
1. One lock control in the page header, left of "+ New" (C04/C): a lock button with text. Locked: red "Locked" with a closed-lock icon. Unlocked: green "Unlocked" with an open-lock icon. Click toggles: locked opens the unlock dialog; unlocked locks immediately and toasts "Locked. Click Download to unlock." This is the only key signal: no banner, no badge, no Load/Forget button.
2. Backup state is folded into the lock button's tooltip and the Recent/Files empty copy only when needed: if not backed up, the lock button shows a small red dot and its menu (long-press or the chevron) contains "Download recovery file". When backed up, that item is absent and the menu says "Recovery file saved Nov 6".
3. Download is always an enabled button (visible on hover and always on touch). Locked click opens the unlock dialog (Cryptomator style): title "Unlock research-bot", one big "Choose recovery file" button, "Paste a key" disclosure, "Remember on this device" checkbox with the sentence "Anyone using this browser profile can open this drive."
4. A valid choice unlocks and starts the pending download without another click. Error line reserved, plain text.
5. Row busy label; toast "Saved <name>".
6. Remember on this device: same WebCrypto/IndexedDB mechanism as A (non-extractable AES-GCM key, `remembered-key.ts`). Idle auto-lock after 15 minutes if not remembered (1Password convention).
7. Tokens `--ok`, `--danger`; disabled text without opacity.

## Before / after (1440)
```
 research-bot v / inbox / x     [Filter]  [(lock) Locked]  [ + New v ]
 ...  2026-11-01.jsonl   Nov 6   577 B     [Download] ...      <- always active
```
At 390 the lock button is an icon with the label "Locked" kept visible (the word is required, not just color), placed in the single header row beside the breadcrumb; the dialog is full width.

## Files touched
`console.tsx` (download, loadKeyFile, header, remove banner and badge), `console.css`/`console-panels.css`, new `lock-button` (add to the design system), `remembered-key.ts`, `globals.css`. Effort: M.

## Risks
- A toggle that both shows state and acts can be misread; the label states the state ("Locked") and the toast confirms the action.
- Auto-lock can interrupt long browsing; remembered devices skip it.
- Same Remember storage trade-off as A (XSS or profile access exposes the key; the server never sees it).
- "Lock" language differs from the product's existing "key" language (C1). Use "Locked/Unlocked" in the chip and "recovery file" for the file; keep "key" only in the paste field.

## Acceptance criteria
1. No disabled Download; one prompt with file first: items 3.
2. File choice loads and downloads; paste in disclosure: items 3-4.
3. 0 px shift, plain error: item 4.
4. Busy and toast: item 5.
5. One signal, green/red, recovery download shown only when not backed up: items 1-2.
6. Remember on this device: item 6.
7. Contrast: item 7.

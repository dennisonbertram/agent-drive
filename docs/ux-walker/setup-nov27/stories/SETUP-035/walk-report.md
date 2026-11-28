# SETUP-035 walk report: Priya sets a passphrase and pins the fingerprint so her agent can seal the drive

User `e2e_owner_keys_5`. Setup differs from the story: the device-flow login for this walk was rate limited (`Agent Drive refused the login request: slow_down`, from the CLI, for more than 25 minutes), so I reused the agent from SETUP-034 (login done earlier, drive `second-drive`, key received by approval) which has the same state: agent holds the key, account has no account key. Steps 1 (agent login output) was seen in SETUP-034. NOT WALKABLE: Clerk reverification at step 6; the Add-a-passkey button's behaviour; final file decryption (step 12): the file list loaded, the key came from the account slot without a prompt, but the browser could not download the ciphertext because the signed storage URL points at `http://127.0.0.1:9811/...` on the Mac Studio, which my laptop browser cannot reach, so the dialog showed "The encrypted file could not be downloaded." (environment limit, not logged as a product defect).

## Steps

1. CLI login output (see SETUP-034): "Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then."
2. /console/settings (step-2.png, other user, same page): title "Activity & deletion"; card "Passphrase unlock / Not set up. / Manage in Files". There is no setup form and the page never says "Settings". Following the CLI sentence literally ends in a detour.
3. Files, banner "Set a passphrase and agents will add every drive's key to your account - then each one opens here automatically. Set up" (step-3.png). Click Set up.
   4-5. Dialog "Set up passphrase unlock" with generated code "0GFN SQ0Y 27V6 XCEB BE2S", Copy, "I saved it", disabled Create, "Use my own passphrase" (step-5.png). Drive picker shows "second-driv..." (truncated).
4. Create (step-6a.png, step-6b.png): no Clerk prompt appeared (test session), the dialog closed within about a second, banner "Passphrase set up. Your agent can now add its drives to your account. Add a passkey Dismiss". The "Creating... this takes a few seconds" text was too brief to capture.
5. Key chip menu (step-7.png): "Unlocked. Drives you added to your account open when you use them. Fingerprint 799c c0f8 98db 81e2", "Key backed up 11/27/2026 (file)" (from the earlier drive receipt), then seven stacked buttons: Load key, Download recovery file again, Lock, Lock this browser, Add a passkey, Change passphrase, Forgot or exposed passphrase?. The chip says Unlocked although no drive key is loaded.
6. After the agent uploaded /notes.md (`put notes.md /notes.md`; note `put notes.md notes.md` fails with "path must be a canonical absolute POSIX path."), clicking notes.md opened "Load the key for SECOND-DRIVE" (step-8.png): "Load this drive's recovery file to open it. We'll try to save its key for passphrase unlock." then the second paragraph, the drop zone, "Paste a key instead", and the long agent paragraph with the command, "(fingerprint) under Settings", a Copy button and "After it runs, close this dialog and try the file again." The console knows the fingerprint but neither shows it here nor includes it in the copied command.
7. `agent-drive account seal --drive <id>` printed `<id>: unverified` and, on stderr, "The account key has not been verified on this machine. Copy its fingerprint from the console (Settings) and run `agent-drive account seal --fingerprint "<the fingerprint>"`. Sealing stays off until then." Exit 1.
8. Settings text (step-13.png captured later): "Passphrase set up 11/27/2026, fingerprint 799c c0f8 98db 81e2, 1 drive added." No copy button.
9. Mistake case: running with the login "Verification code" (`--fingerprint '442c 93ea debb 6aa5'`) printed: "The supplied fingerprint (442c 93ea debb 6aa5) does not match the account key the service returned (799c c0f8 98db 81e2). Check the fingerprint in the console under Settings; if it is right, the API may be answering with a different account key." Then the right fingerprint gave `<id>: sealed`, exit 0.
10. Click notes.md again: no key dialog this time (the slot supplied the key); the viewer then failed to download ciphertext (environment, see top).
11. Settings now "1 drive added" (confirmed).
12. Not walked (recovery download after sealing).
    Mobile (mobile-check.png): file list fits; no overflow.

## Flow Log

- Ideal path 6; actual about 11 interactions across console and terminal including the Settings detour and a Load-key dialog that was not the shortest way (the dialog is the main place the user learns about `account seal`).
- Hesitations: "Settings" wording; chip says Unlocked before anything is unlocked; fingerprint must be re-read from the console; two 4-group codes of the same shape (verification code vs fingerprint).
- Re-entry: fingerprint is re-typed by hand into the terminal although the console has it.
- Duplicated info: fingerprint in key menu and Settings; passphrase instruction appears in the CLI warning, the banner and the dialog.

# SETUP-037 walk report: Tomas adds a passkey and unlocks on a second laptop

User `e2e_owner_keys_7` (passphrase set, drive `jo-notes`). NOT WALKABLE: the Clerk reverification prompt, the device passkey sheet / Touch ID (headless browser, no authenticator), the second laptop (steps 4-6: "Unlock with passkey" dialog, "Passkey added" notice). Only the dialog before the device prompt and the failure behaviour were walked.

## Steps

1. Unlocked key menu offers "Add a passkey" (step 1 of 042 shows the menu; here via the chip after unlocking with the passphrase). Click opens dialog "Add a passkey": "Confirm your account passphrase, then follow the device prompt. You can use the same passkey wherever your password manager syncs it." with one black password field and a disabled button also labelled "Add a passkey" (step-1.png). Heading and button have the same text.
2. Wrong passphrase: "That passphrase is not correct." (step-2a-wrong.png). Correct passphrase: button becomes "Adding passkey..." and the field disables (step-2b.png).
3. The state never changed in this headless browser: after 40+ seconds it still showed "Adding passkey..." (step-3-waiting.png). Esc and the "Close dialog" X do nothing while busy, so the user is trapped until they reload the page (I reloaded; chip returned to "Unlocked"). There is no message such as "Waiting for your device..." and no cancel. With a real browser a dismissed device sheet would probably end with "Passkey setup did not complete." (not observed).
   Mobile (mobile-check.png): dialog fits at 390px, the same stuck state.

## Flow Log

- Ideal 4 steps; could only verify the first 2. Not walkable: Touch ID sheet, second-laptop unlock.
- Hesitations: the user must re-type the passphrase even though the tab is unlocked (security reason, but not explained); dialog and button duplicate "Add a passkey".

# SETUP-042 walk report: Jo, shared Mac, leave nothing behind

User `e2e_owner_keys_7` (passphrase set up in the SETUP-041 walk, then drive `jo-notes` created in the console). Not walkable: Clerk sign-in/sign-out via UserButton, the 30-minute idle lock (waiting not feasible), a real shared Chrome profile.

## Steps
1. After passphrase setup and drive creation, a page reload shows chip "Unlocked" without asking for the passphrase (step-4b-after-reload-following-Lock.png). The setup form has no "Keep this browser unlocked" box and still stores the key (also confirmed in the SETUP-041 walk): a user who sets up on a shared Mac is never asked.
2. Key chip menu (step-1.png): "Unlocked. This drive's key is loaded in this tab." with small grey "Fingerprint 377c 2967 79bd 5e29", "Key backed up 11/27/2026 (file)", then six stacked buttons: Download recovery file again, Lock, Lock this browser, Add a passkey, Change passphrase, Forgot or exposed passphrase? `Lock` and `Lock this browser` sit adjacent with no description of the difference. No geometry hits other than sibling width variance of content-sized buttons (fine).
3. Click `Lock` (step-4a-locked.png): chip turns "Locked", no message. Reload: chip is "Unlocked" again with no passphrase prompt (confirmed as the story predicted). A user who believes `Lock` secures the machine is wrong.
4. `Lock this browser` (step-4c-lock-this-browser.png): chip "Locked"; after a reload it stays "Locked". Works, no confirmation message either.
5. Locked chip menu (step-1b-locked-menu.png): Unlock with passphrase, Load key, Download recovery file again, Forgot or exposed passphrase?. Unlock dialog (step-2.png): "Type your passphrase to open the drives you added to your account. The keys stay in this browser only." The passphrase field is a solid black box; "Keep this browser unlocked" is ticked by default and says nothing about leaving a key behind; "stay in this browser only" reads as reassurance. Wrong passphrase gives "That passphrase is not correct." (step-2b-wrong.png).
6. Unlock with the box unticked (step-3.png): dialog closes, chip "Unlocked". Reload: chip "Locked". Works as intended.
Mobile (mobile-check.png, 390x844): dialog fits, no horizontal overflow; wrapped-control hits are false positives (labels are on one line in the screenshot).

## Flow Log
- Ideal path 4 steps (untick, Unlock, use files, Lock this browser). Actual to reach a safe state: 4, but only if the user already knows to untick the default box and to choose the second Lock button; after the setup path the key is already stored (0 prompts).
- Hesitations: Lock vs Lock this browser; default-ticked box; no feedback after either lock.
- Duplicated info: fingerprint appears only here and in Settings.

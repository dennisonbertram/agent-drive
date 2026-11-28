# SETUP-036 walk report: Dev copies the fingerprint with a trailing comma

User `e2e_owner_keys_7` (passphrase set) for the web side; CLI run from the SETUP-034 agent home (user 5, no account key) because only argument validation was needed. Not walkable: dragging a text selection with the mouse (I read the text instead); a real sealed drive (the success line `<id>: sealed`; see SETUP-035 if login became available).

## Steps
1. /console/settings (step-1.png). The card reads "Passphrase set up 11/27/2026, fingerprint 377c 2967 79bd 5e29, 1 drive added." in small grey text; the fingerprint is plain text inside a sentence, followed by a comma. No copy button. The page is titled "Activity & deletion"; the word "Settings" appears nowhere on it, yet the CLI and dialogs say "under Settings". The Passphrase card sits below the Activity table. Mobile (mobile-check.png): the fingerprint wraps across two lines mid-value; the Activity table header cells spill 12-20px (geometry script: th "When" 20px, th "Who" 12px).
2. `agent-drive account seal --fingerprint "377c 2967 79bd 5e29,"` prints `--fingerprint must look like "a1b2 c3d4 e5f6 7890", exactly as the console shows it.` The error does not say the comma is the problem, and the console shows the value followed by that very comma.
3. Variants: hyphens `377c-2967-79bd-5e29` accepted (reached the server: "no account key" for user 5); upper case without the middle space accepted; `put x y --fingerprint ...` prints "--fingerprint is only supported by `account seal`."; `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT=zzz agent-drive account seal` prints `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT must look like "a1b2 c3d4 e5f6 7890".`; `account seal --repin` without a fingerprint prints a clear sentence naming the console (Settings) and `--fingerprint`.
Other: `agent-drive account` alone prints "Unknown command." and `account --help` prints the global help; the `account seal` help line says "Verify the console's account-key fingerprint before sealing or repinning" but not where to find it.

## Flow Log
- Ideal 2 steps (copy, run). Actual 2, plus one retry when punctuation is selected.
- Hesitations: where is "Settings"; no copy affordance; error does not name the offending character.
- Duplicated info: fingerprint in Settings and in the key menu; the same shape as the login "Verification code".

# SETUP-039 walk report: Ken lost his recovery file but the agent still has the key

Users: `e2e_owner_keys_8` (console side: drive `seed`, key lost after reload, no passphrase) and the SETUP-034 agent home (user 5) for the CLI `credentials export` / `check`. Because device-flow login was rate limited (`slow_down`) no agent holding the console drive's key existed, so the success path (choosing the exported file for the same drive, "Key loaded", Download recovery file, "Recovery file saved") is NOT WALKABLE; I exercised the dialog, the wrong-file errors, the wrong-drive bundle error and the CLI export.

## Steps

1. Locked-out state: chip "Key needed" (step-1a.png). Menu: Load key, Set up passphrase unlock. "Load key" opens "Load the key for SEED" (step-1.png): "Choose the recovery file for this drive. The key stays in this tab only. It is cleared when you reload, or after 30 minutes without use." plus drop zone and "Paste a key instead".
2. Lower help text reads "No recovery file? An agent that has this drive's key can add it to your account: run `agent-drive account seal --drive <id>` ... re-run it with --fingerprint set to the account-key fingerprint under Settings. [Copy] Set up a passphrase below first - sealing needs your account key. [Set up passphrase unlock] Or ask the agent to run `agent-drive credentials export`, then choose or paste what it gives you. [Copy]". The slower path (seal, needs passphrase, fingerprint pinning) is presented first and the fast path (export a file, choose it) last. The sentence "Set up a passphrase below first" is followed by the button but sits in the same paragraph as the seal instructions. No text says what happens if no copy of the key exists anywhere.
3. CLI: `agent-drive credentials export --to ~/uxw/owner-keys-034-1/export.adcred` printed "Backed up credentials for 1 drive(s) (file)." File mode `-rw-------` (600). `credentials status` then shows backedUp true method file, and `agent-drive check` printed `check ok drive=...`: an export to a file counts as the backup at once (unlike the console recovery file, see SETUP-034).
4. Wrong files in the dialog: a text file gives "That is not a recovery file. Choose the agent-drive-....key.json file you downloaded." (step-4a-wrong-file.png; the docs quote only "That is not a recovery file."); a real credentials bundle for another drive gives "That credentials bundle has no key for this drive." (step-4b-bundle-other-drive.png). Errors are red, inline, helpful. The label "Choose recovery file" is the same for a .key.json file and an exported bundle.
   5-6. Not walkable (see above).
   Mobile (mobile-check.png): dialog fits at 390px; the dense help paragraph wraps to about 10 lines; no overflow.

## Flow Log

- Ideal path 4 steps; actual to this point: click Key needed, Load key, read long dialog, ask agent to export, choose file (5+). The fast path is the last paragraph of the dialog.
- Hesitations: which of three routes to take; passphrase "below" setup button inside help text.
- Duplicated info: the account-seal paragraph repeats in every Load-key dialog regardless of whether a passphrase exists.

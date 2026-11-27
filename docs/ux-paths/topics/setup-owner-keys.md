# Setup topic: Owner keys in the console

> ID note: stories in this file now use catalog IDs SETUP-034 to SETUP-042 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-034, 02 = SETUP-035, 03 = SETUP-036, 04 = SETUP-037, 05 = SETUP-038, 06 = SETUP-039, 07 = SETUP-040, 08 = SETUP-041, 09 = SETUP-042.


Source: read from code in `/Users/dennison/develop/agent-drive-ux-setup` (branch `ux/setup-flow-review-nov27`). Nothing was run. All copy is quoted from source; file:line references are given for conflicts. Temporary IDs `STORY-OWNER-KEYS-NN` are renumbered later.

Paths used below (all under the worktree):
- `apps/web/app/(app)/console/console.tsx` (console)
- `.../key-chip.tsx`, `.../unlock-dialog.tsx`, `.../vault-forms.tsx`, `.../settings/settings-client.tsx`, `.../drive-menu.tsx`
- `apps/web/src/console/{vault,passkey,recovery-file,account-key}.ts`
- `packages/agent-drive/src/{cli,account-seal,verification,credentials}.ts`
- `docs/{console,keys-and-recovery,backup-and-recovery,connect-an-agent,cli}.md`, `apps/web/app/llms.txt/route.ts`, `skills/agent-drive/SKILL.md`

## Corrections to discovery-setup.md found while reading

1. The passphrase **setup** form has no "Keep this browser unlocked" checkbox (`vault-forms.tsx` `NewPassphraseForm`). The checkbox exists only on the passphrase unlock form (`vault-forms.tsx:75`) and the passkey unlock form (`unlock-dialog.tsx:312`). Setup still stores the key in the browser when the store is available (`vault.ts` `setup`, the `persisted?.write` call), so the user is never asked.
2. The account-key fingerprint is shown in **two** places in the console, not one: Settings (`settings-client.tsx`, inside a sentence) and the key chip menu (`key-chip.tsx:111`, `Fingerprint a1b2 c3d4 e5f6 7890`, shown only once a passphrase exists).
3. "Forgot or exposed passphrase?" exists only in the key chip menu (`key-chip.tsx:264`). The Unlock dialog's passphrase form has no reset link (`vault-forms.tsx:85` offers only `Use a recovery file instead`).
4. Agent-only drives have no badge in the drive menu (`drive-menu.tsx` has no agent-only text). The only visible signs are in the key chip menu and the unlock dialog.

---

## SETUP-034: Maya creates her own drive in the browser and saves the recovery file

**Type**: medium
**Topic**: Owner keys in the console: New drive and recovery file
**Persona**: Maya Okafor, freelance data analyst, signed up five minutes ago. She does not trust "an agent makes the key for me" and wants to hold the key before any agent exists.
**Goal**: Create a drive named "research-notes", save its recovery file, and later hand the drive to her agent.
**Preconditions**: Signed in, no drives, no agent. Chrome on a Mac. No passphrase set.
**Surface**: mixed (web, then CLI)
**Ideal path**: 4 — `New drive` (under "Prefer to set up a drive yourself?"), `Create drive`, `Download recovery file and continue`, `I saved it`.
**Alternate paths**: (a) agent-first: `agent-drive login` creates the drive and the CLI keeps the key (`BACKUP_HINT`, `credentials.ts:33`); (b) CLI `agent-drive drive create --name research-notes`; (c) after creation, the key chip menu offers `Download recovery file` / `Download recovery file again` at any time while the key is loaded in the tab; (d) the drive menu (top of Files) also has `New drive` (`drive-menu.tsx:139`) once a drive exists.

### Steps
1. Open `/console`. → Onboarding panel, eyebrow "CONNECT YOUR AGENT", h2 "Give your first agent a home." Above it in the heading area the banner reads "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." with a `Set up` button (`console.tsx:2770-2778`). Maya sees two calls to action and no explanation of how they relate.
2. She reads "Prefer to set up a drive yourself?" and clicks `New drive`. → Dialog "Create a drive": "We’ll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it."
3. Field `Drive name` is prefilled and selected with "my-drive" (first drive only). She types "research-notes". She leaves the checkbox "Agent-only — never add this drive to passphrase unlock" unticked, unsure what it means (she hesitates, then moves on). She clicks `Create drive`. → Dialog title becomes "Your drive. Your key.": "This key decrypts your drive. Without it nobody, including us, can open this drive. It is not sent to the service or saved in browser storage."
4. She opens `Show drive key` (a collapsed details), sees a 43-character string, closes it, and clicks `Copy drive key` by mistake before realising the file is the real backup. → The clipboard now holds a plaintext key. No clipboard warning is shown.
5. She reads "The recovery file contains a secret in plaintext. Store it in a password manager or another secure location." and clicks `Download recovery file and continue`. → Browser saves `agent-drive-<drive id>.key.json`. Dialog changes to a group "Did the recovery file save?" with `I saved it` and `Download again`.
6. She opens Downloads, drags the file into 1Password, then clicks `I saved it`. → Dialog closes, tab is Files, notice "Recovery file saved. Store it in a password manager."
7. She opens the key chip. → Chip reads "Key loaded" (no "· Not backed up"). Menu: "Key loaded in this tab." and "Key backed up <date> (file)". It also offers `Set up passphrase unlock` and `Forget key`.
8. Files shows the empty state "Ready for your first file." / "Connect an agent with the CLI or MCP to upload encrypted files."
9. In her terminal she asks her agent to run `agent-drive login --name "claude-code"`. The CLI prints `Open this link to approve: <origin>/connect?code=XXXX-XXXX`, `Check that the code matches: XXXX-XXXX`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...`.
10. On `/connect` she clicks `Details`, then "Use one of my drives instead (needs its recovery file)". → Form with `Drive`, `Drive key` ("Paste the drive key or an adcred1… bundle"), `Or choose a file`, `Read only`, `Only allow writes under (optional)`. She picks "research-notes", chooses the downloaded `agent-drive-<id>.key.json`, types the verification code into `Verification code`, clicks `Approve agent`. → "Access approved for claude-code".

### Variations
- She clicks the browser Back button or presses Esc while the receipt is open: the receipt dialog is not closable (`console.tsx:4187-4192` excludes `driveReceipt`), so Esc does nothing; there is no `Close` and no way to skip the download.
- She clicks `Download again`: a second identical file is saved (names collide as `(1)`).
- Name already used: error "A drive with this name already exists. Load its original drive key instead."
- `I saved it` records the backup after the dialog is already closed (`console.tsx:4266-4274`). If the record call fails, the notice says "The backup was not recorded. Use Download recovery file, then I saved it, to try again." and the chip stays "· Not backed up".
- She ticks "Agent-only" by accident: see SETUP-040.

### Edge Cases
- If she reloads the tab before step 5 the key exists nowhere (it is in tab memory only), and the drive is an empty, unrecoverable shell. The receipt text states this, but no copy warns about reloading.
- The `/connect` link label says "needs its recovery file" but the form also accepts a pasted key or `adcred1.` bundle (`connect.tsx:685`).
- Unverified (not traced in code): whether `agent-drive check` passes immediately after step 10 for a key the agent received through approval. The console already has a backup record, but the CLI keeps its own backup records.
- Same fact shown on several surfaces: "backed up" status appears in the key chip label, key chip menu text, and (for the CLI) `agent-drive check`; they are separate records (console `key_backup_at` vs the CLI's config) and can disagree.

---

## SETUP-035: Priya finishes agent setup, sets a passphrase, and enters the fingerprint so her agent can seal the drive

**Type**: long
**Topic**: Owner keys in the console: passphrase setup, Settings fingerprint, `account seal --fingerprint`
**Persona**: Priya Raman, ML engineer. Her Claude Code agent just ran `agent-drive login` and she approved it. She has never set a passphrase and wants to read her agent's files in the browser without handing a key around.
**Goal**: Open the agent's files in Files with a passphrase and no recovery file.
**Preconditions**: Account has one agent-created drive (`drv_7QK2`) and no account key. Local agent and CLI 0.5.1. Chrome. Password manager available.
**Surface**: mixed (CLI, web, CLI, web)
**Ideal path**: 6 — `Set up`, tick `I saved it`, `Create`, copy fingerprint from key menu, run `agent-drive account seal --fingerprint "<print>"`, click a file.
**Alternate paths**: (a) set the passphrase first, then run `agent-drive login` with `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT` in the environment so the automatic seal after login works; (b) skip the passphrase and have the agent run `agent-drive credentials export --to <path>`, then `Choose recovery file` (see SETUP-039); (c) key chip menu `Set up passphrase unlock` instead of the banner `Set up`; (d) read the fingerprint from the key menu instead of Settings.

### Steps
1. The agent's `login` finishes in the terminal. → Output includes `Logged in as agent claude-code.`, `New drive drv_7QK2 created; its key is saved in the config file.`, the backup hint, and a warning: "Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then." (`account-seal.ts:30-31`).
2. Priya follows the warning literally. She opens `/console/settings` (sidebar link `Activity & deletion`). → Card "Passphrase unlock" says "Not set up." with one button `Manage in Files`. She expected a setup form. She hesitates, then clicks `Manage in Files`. (Settings says "Status only. Setting up, unlocking, changing and resetting all happen in Files." only in a code comment, `settings-client.tsx:103`, not on screen.)
3. On Files the heading area shows the banner "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." She clicks `Set up`. → Dialog "Set up passphrase unlock".
4. The dialog says "Your passphrase: we generated it in your browser. Save it in your password manager. If you lose it you can reset it, but every drive must be added again." A 20-character code appears in groups of four, with `Copy passphrase`. She clicks `Copy passphrase` and saves it in 1Password.
5. `Create` is disabled until she ticks `I saved it`. She ticks it. She considers `Use my own passphrase` ("at least 14 characters", "Type it again"), decides the generated one is safer, and clicks `Create`.
6. The button shows "Creating… this takes a few seconds." and a line "Working… this takes a few seconds." A Clerk prompt appears asking her to confirm it is her (the account-key write uses strict reverification, `vault.ts` `setup`). She completes it. → Dialog closes, notice: "Passphrase set up. Your agent can now add its drives to your account." (no keys are loaded in this tab, so "0 drives" text is not used, `console.tsx:2476-2478`). If her browser supports passkeys, an `Add a passkey` button is shown next to the notice.
7. The key chip reads "Unlocked · Not backed up". She opens it. → "Unlocked. Drives you added to your account open when you use them. Fingerprint 9c1e 4b7a 02d8 f356". She notices the chip says Unlocked but no file has been decrypted yet.
8. She clicks a file `notes.md` anyway. → Dialog "Load the key for research" with "No recovery file? An agent that has this drive’s key can add it to your account: run `agent-drive account seal --drive drv_7QK2` on its machine ... If it reports `unverified`, re-run it with `--fingerprint` set to the account-key fingerprint under Settings." and `Copy account seal command`. Because the vault is unlocked: "After it runs, close this dialog and try the file again."
9. She clicks `Copy account seal command`, switches to the terminal, pastes it. → Output `drv_7QK2: unverified`; stderr: "The account key has not been verified on this machine. Copy its fingerprint from the console (Settings) and run `agent-drive account seal --fingerprint "<the fingerprint>"`. Sealing stays off until then." Exit code 1.
10. She goes back to the browser and opens `/console/settings`. → "Passphrase set up 11/27/2026, fingerprint 9c1e 4b7a 02d8 f356, 0 drives added." There is no copy button; she selects the four groups by hand. (The key menu already showed the same value in step 7.)
11. In the terminal: `agent-drive account seal --drive drv_7QK2 --fingerprint "9c1e 4b7a 02d8 f356"`. → `drv_7QK2: sealed`. Exit code 0.
12. Back in the dialog she closes it and clicks `notes.md` again. → File decrypts with no prompt (the account slot supplies the key). Key chip shows "Unlocked".
13. She refreshes Settings. → "…fingerprint 9c1e 4b7a 02d8 f356, 1 drive added."
14. The chip still says "· Not backed up". She opens the key menu and clicks `Download recovery file` (offered because a slot exists, `key-chip.tsx` `canReproduce`), saves the file, clicks `I saved it`. → Chip drops "· Not backed up". Meanwhile her agent also prints the backup hint; she tells it to run `agent-drive credentials export --to 1password`, which clears the CLI side.

### Variations
- At step 6 she cancels the Clerk prompt: see SETUP-041.
- At step 9 she runs the command without `--drive`; all held keys are sealed and one line is printed per drive.
- If she is on a machine with several agents, every machine needs its own `--fingerprint` run once; the pin is per machine and per API origin (`account-seal.ts`, state in `<config>.state/account-seal.json`).
- If she never runs step 11, a later automatic seal on the agent prints the same unverified warning at most once per 24 hours per drive (`SEAL_THROTTLE_MS`).

### Edge Cases
- Settings is named in three CLI strings (`account-seal.ts:31`, `:37-39`, `cli.ts:1153`) and in `unlock-dialog.tsx:242`, but passphrase setup is not in Settings. The step-1 warning sends the user to the wrong page for setup, then Settings sends her back to Files.
- The fingerprint has the same shape as the `Verification code: a1b2 c3d4 e5f6 7890` printed by `login` (`verification.ts`). The two values are different and used in different places. A user who keeps the login output open may type the verification code at step 11 and get: "The supplied fingerprint (…) does not match the account key the service returned (…). Check the fingerprint in the console under Settings; if it is right, the API may be answering with a different account key."
- `notes.md` opened before step 11 would, with the vault unlocked, show NOT_IN_ACCOUNT: "Load this drive’s recovery file to open it. We’ll try to save its key for passphrase unlock." (`console.tsx:495`).
- Same fact on several surfaces: account-key fingerprint (key menu, Settings, CLI error messages, `docs/console.md:103`, `docs/keys-and-recovery.md`); drive "sealed" state (CLI line `sealed`, Settings count "1 drive added", key menu text).
- Copy conflict: `docs/quickstart.md:35`, `home.ts:8`, `console.tsx:2858` and `:2874` tell the owner only to "match the code" / "click Approve", while `/connect` requires typing the verification code (`llms.txt/route.ts`, `docs/connect-an-agent.md:7`). This story starts after that step but the same owner meets it right before.

---

## SETUP-036: Dev copies the fingerprint with a trailing comma

**Type**: short
**Topic**: Owner keys in the console: Settings fingerprint and `account seal --fingerprint`
**Persona**: Dev Anand, backend engineer, double-clicks and drags quickly.
**Goal**: Pin his account key on his laptop with `--fingerprint`.
**Preconditions**: Passphrase set up. Agent machine has not been pinned. Settings is open.
**Surface**: mixed (web, CLI)
**Ideal path**: 2 — copy the four groups from Settings (or key menu), run `agent-drive account seal --fingerprint "<print>"`.
**Alternate paths**: `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT="9c1e 4b7a 02d8 f356" agent-drive account seal`; open the key chip menu and copy `Fingerprint …` from there.

### Steps
1. On `/console/settings` the card reads "Passphrase set up 11/27/2026, fingerprint 9c1e 4b7a 02d8 f356, 2 drives added." He drags from "9c1e" to the comma after "f356", so the selection ends with ",".
2. He runs `agent-drive account seal --fingerprint "9c1e 4b7a 02d8 f356,"`. → Error: `--fingerprint must look like "a1b2 c3d4 e5f6 7890", exactly as the console shows it.` (`cli.ts:1151-1153`; the pattern accepts spaces, dots and dashes but not commas, `verification.ts`).
3. He deletes the comma and re-runs. → One line per drive, `<id>: sealed`.

### Variations
- He pastes the 16 hex digits with no spaces, or in capitals: accepted (spaces optional, case-insensitive).
- He uses a hyphen-separated copy ("9c1e-4b7a-02d8-f356"): accepted.
- He sets the env var wrongly: `AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT must look like "a1b2 c3d4 e5f6 7890".`
- He adds `--fingerprint` to another command (`agent-drive put ...`): `--fingerprint is only supported by `account seal`.`

### Edge Cases
- The Settings value sits inside a prose sentence with a comma after it. The key menu line `Fingerprint 9c1e 4b7a 02d8 f356` has no trailing punctuation.
- Settings and the key menu show the date as `toLocaleDateString()`, so a non-US browser gives a different date format from the CLI.

---

## SETUP-037: Tomás adds a passkey and unlocks on a second laptop

**Type**: medium
**Topic**: Owner keys in the console: passkey and reverification
**Persona**: Tomás Herrera, designer with an iPhone and two Macs, passwords in iCloud Keychain. Tired of typing a 20-character passphrase.
**Goal**: Unlock his drives with Touch ID on the work laptop.
**Preconditions**: Passphrase set up and unlocked on laptop A. Drive sealed. Safari or Chrome with passkey support (WebAuthn PRF). No passkey yet.
**Surface**: web
**Ideal path**: 4 — key menu `Add a passkey`, type passphrase and `Add a passkey`, device prompt, then on laptop B `Unlock with passkey`.
**Alternate paths**: the `Add a passkey` button shown beside the "Passphrase set up." notice right after setup (`console.tsx:2747-2757`, `data-testid="passkey-offer"`); the passphrase stays available as a fallback at all times.

### Steps
1. On laptop A, Files, he opens the key chip. → Menu shows `Add a passkey` (only visible when unlocked, no passkey yet, and the browser may support one, `key-chip.tsx:238-249`). He clicks it.
2. Dialog "Add a passkey": "Confirm your account passphrase, then follow the device prompt. You can use the same passkey wherever your password manager syncs it." Field `Confirm with your passphrase`. He pastes the passphrase, clicks `Add a passkey` (shows "Adding passkey…").
3. A Clerk reverification prompt appears (the passkey write is strict, `vault.ts` `addPasskey`). He confirms. Then the browser passkey sheet appears and he approves with Touch ID.
4. Dialog closes, notice: "Passkey added. Use it to unlock this account on this device." The menu no longer shows `Add a passkey`.
5. Next day on laptop B (iCloud Keychain synced) he signs in to `/console`, opens a drive, clicks a file. → Dialog "Unlock with your passkey": "Use your fingerprint, face, security key or device PIN when your browser asks." Checkbox `Keep this browser unlocked` (ticked). Buttons `Unlock with passkey` and `Use your passphrase instead`.
6. He clicks `Unlock with passkey`. → Button shows "Waiting for your passkey…", Touch ID prompt, then the dialog closes and the file he clicked opens or downloads (pending action resumes).

### Variations
- Cancelled Clerk prompt: "Confirm it’s you to add the passkey."
- Wrong passphrase at step 2: "That passphrase is not correct."
- Browser has no WebAuthn: "This browser cannot use passkeys." Device lacks PRF: "This passkey cannot protect the account key." Other failure: "Passkey setup did not complete."
- Second enrollment attempt (another tab): "This account key already has a passkey." The console supports one passkey per account key (`docs/keys-and-recovery.md`).
- On a laptop without a synced passkey, `unlockEntry()` falls back to the passphrase dialog (`console.tsx:633`); if a passkey exists it also says "This account has a passkey too. Use the passkey instead" (`unlock-dialog.tsx:114`).
- Passkey fails at unlock: "This passkey could not unlock the account key."

### Edge Cases
- Wording drifts: chip button `Unlock with passkey` (`key-chip.tsx:137`), dialog title "Unlock with your passkey" (`console.tsx:4170`), link "Use the passkey instead" (`unlock-dialog.tsx:114`), link "Use your passphrase instead" (`unlock-dialog.tsx:328`), chip button `Unlock with passphrase`.
- The idle message says "Locked after 30 minutes without use. Enter your passphrase to continue." (`console.tsx:494`) even for a passkey user.
- A passkey is not a drive-key backup; agent-only drives still need a recovery file (`docs/keys-and-recovery.md`).

---

## SETUP-038: Dana forgets her passphrase, resets it, and re-pins her agent

**Type**: long
**Topic**: Owner keys in the console: reset, lost passphrase, `account seal --repin`
**Persona**: Dana Whitfield, startup founder. Set a passphrase six weeks ago, never saved the generated one, no passkey, never downloaded a recovery file. Her agent on a Mac mini still holds all drive keys.
**Goal**: Get the console working again and keep her files.
**Preconditions**: Account key exists; two drives (`drv_A1`, `drv_B2`) both sealed earlier; agent machine pinned to the old fingerprint `9c1e 4b7a 02d8 f356`. New laptop, browser has no stored key.
**Surface**: mixed (web, CLI)
**Ideal path**: 8 — chip menu, `Forgot or exposed passphrase?`, type RESET, `Reset and remove all drives`, tick `I saved it`, `Create`, read new fingerprint, `agent-drive account seal --repin --fingerprint "<print>"`.
**Alternate paths**: (a) load each recovery file instead of resetting (she has none); (b) ask the agent for `agent-drive credentials export --to <path>` and use `Choose recovery file` per drive (no reset needed to read files, but the passphrase stays lost); (c) if a key is loaded in the tab before reset, setup re-adds it automatically (`console.tsx:2464-2472`); (d) a passkey would have opened the drives without the passphrase (`docs/keys-and-recovery.md`).

### Steps
1. She opens `/console`, clicks a file. → Dialog "Unlock with your passphrase": "Type your passphrase to open the drives you added to your account. The keys stay in this browser only." Two buttons: `Unlock` and `Use a recovery file instead`.
2. She tries three guesses. → Each time: "That passphrase is not correct."
3. She looks for "forgot" and finds none in the dialog. She clicks `Use a recovery file instead`. → Dialog "Load the key for <drive>": `Choose recovery file`, "Paste a key instead", the line "No recovery file? An agent that has this drive’s key can add it to your account… Your passphrase then opens this drive — no file needed." (it still assumes the passphrase works), and `Use my passphrase instead`. She is in a loop.
4. She closes the dialog. The chip says "Locked". She opens it. → Menu text "Locked. Your passphrase opens the drives you added to your account." Buttons `Unlock with passphrase`, `Load key`, `Lock`? (no), and at the bottom `Forgot or exposed passphrase?`. She clicks it.
5. Dialog "Reset passphrase": "Resetting deletes your account key and removes every drive from it. Files are not deleted. You will add each drive again by loading its recovery file. Anyone who already opened a drive keeps its key." Field `Type RESET to continue`. The danger button `Reset and remove all drives` stays disabled until she types RESET exactly. She hesitates over "removes every drive" (it only means from the passphrase list) and "loading its recovery file" (she has none).
6. She types RESET and clicks `Reset and remove all drives` ("Resetting…"). A Clerk reverification prompt appears; she confirms. → The dialog changes to "Set up passphrase unlock" without any message about what happened.
7. She accepts the generated passphrase, copies it to 1Password, ticks `I saved it`, clicks `Create`. → "Passphrase set up. Your agent can now add its drives to your account." (0 keys in the tab.)
8. She opens the key menu: `Fingerprint 51ab 7e20 c9d3 1f08` (new). Settings shows "Passphrase set up 11/27/2026, fingerprint 51ab 7e20 c9d3 1f08, 0 drives added."
9. On the Mac mini the agent's next command tries its automatic seal. → A warning that the account key changed: "The account public key changed (pinned fingerprint 9c1e 4b7a 02d8 f356, server returned 51ab 7e20 c9d3 1f08). If the owner reset the passphrase in the console, verify its Settings fingerprint and run `agent-drive account seal --repin --fingerprint <fingerprint>` to pin the new key." (`account-seal.ts`, `AccountKeyPinMismatch`; I did not trace whether automatic runs print this text or a shorter one.)
10. She runs `agent-drive account seal --repin --fingerprint "51ab 7e20 c9d3 1f08"`. → `drv_A1: sealed`, `drv_B2: sealed`.
11. In Files she clicks a file. → It decrypts through the new account key. Settings later says "2 drives added."
12. She downloads a recovery file for each drive from the key menu and clicks `I saved it` each time.

### Variations
- Without `--fingerprint`: `--repin requires --fingerprint. Copy the account-key fingerprint shown in the console (Settings) and pass --fingerprint.`
- Other browser tabs still open on the old account key lock themselves: "Your passphrase was changed elsewhere. Enter it again to continue." (`console.tsx` lock reason `stale`) or "Your passphrase was changed elsewhere. Reload the page."
- If she tries to type `reset` in lower case, the button stays disabled with no message.
- If she had loaded a drive's recovery file in the tab before resetting, the new setup says "Passphrase set up. 1 drive added to your account." and that drive does not need step 10.
- Agent-only drives are never re-added; they still need a recovery file.

### Edge Cases
- The reset link is reachable only from the key menu; the Unlock dialog (the screen she is on when she is stuck) has no path to it (`vault-forms.tsx:85`, `key-chip.tsx:264`).
- "Remove every drive" and "Files are not deleted" appear together in one paragraph; "every drive must be added again" (generated-passphrase copy, `vault-forms.tsx:178`) means the same thing in other words.
- `docs/keys-and-recovery.md` says a passkey wrapper "goes with" the reset; the reset dialog does not mention passkeys.
- Same fact on several surfaces: the new fingerprint (key menu, Settings, CLI mismatch error).

---

## SETUP-039: Ken lost his recovery file but the agent still has the key

**Type**: short
**Topic**: Owner keys in the console: lost recovery file
**Persona**: Ken Ito, consultant. His Downloads folder was wiped in an OS reinstall. He has no passphrase and no 1Password copy. His agent's machine still has the drive key.
**Goal**: Open `invoices` in the console and get a new recovery file.
**Preconditions**: One drive `drv_K9`, key in the agent's config, no account key, key chip "Key needed · Not backed up" (console record absent).
**Surface**: mixed (web, CLI)
**Ideal path**: 4 — click file, agent runs `agent-drive credentials export --to <path>`, `Choose recovery file`, `Download recovery file` + `I saved it`.
**Alternate paths**: (a) set a passphrase and run `agent-drive account seal --fingerprint "<print>"` (SETUP-035); (b) `Paste a key instead` with the bundle (not advised: the bundle includes an API key); (c) `agent-drive credentials export --to 1password`.

### Steps
1. In Files he clicks a file. → Dialog "Load the key for invoices": "Choose the recovery file for this drive. The key stays in this tab only. It is cleared when you reload, or after 30 minutes without use." The key chip says "Key needed".
2. He reads the lower help text: "No recovery file? An agent that has this drive’s key can add it to your account: run `agent-drive account seal --drive drv_K9`…" and, because no passphrase exists, "Set up a passphrase below first — sealing needs your account key." and `Set up passphrase unlock`. He wants the fast path instead, and finds the second help line: "Or ask the agent to run `agent-drive credentials export`, then choose or paste what it gives you." with `Copy credentials export command`.
3. He copies the command and asks the agent to run it with a path: `agent-drive credentials export --to ~/Desktop/agent-drive-credentials.txt`. → A file with mode 600 is written and counts as the backup at once.
4. In the dialog he clicks `Choose recovery file` and selects that file. → Dialog closes, the file opens, chip "Key loaded".
5. He opens the chip menu and clicks `Download recovery file`, saves it into 1Password, clicks `I saved it`. → Notice "Recovery file saved. Store it in a password manager."

### Variations
- If the vault is unlocked when he loads the key, the console adds the drive to the account: "Added to your account. Next time your passphrase opens it." (`console.tsx:1832`).
- Wrong file: "That is not a recovery file. Choose the agent-drive-….key.json file you downloaded." Wrong drive: "That recovery file is not for this drive." Bundle without this drive: "That credentials bundle has no key for this drive." Unreadable bundle: "That credentials bundle could not be read." File over 16,384 characters is treated as not a recovery file.
- Pasted raw key that is not 43 characters: "That key is not valid. Paste the whole key or credentials bundle."
- If no copy of the key exists anywhere: `docs/keys-and-recovery.md` and `docs/backup-and-recovery.md` say the files can never be decrypted; the dialog does not say this.

### Edge Cases
- The dialog offers `account seal` first, which is the slower path when no passphrase exists, and `credentials export` last.
- `docs/backup-and-recovery.md` quotes the error as `That is not a recovery file.` The code string is longer (`recovery-file.ts:7-8`).
- The `Choose recovery file` label is the same for a `.key.json` file and an `adcred1.` bundle saved as text; nothing says the bundle works there except `docs/console.md:23`.

---

## SETUP-040: Lena keeps a client drive out of passphrase unlock

**Type**: medium
**Topic**: Owner keys in the console: agent-only drives
**Persona**: Lena Fischer, security consultant. Her agent may store raw client exports. She wants the browser never to hold that key through the account.
**Goal**: Create an agent-only drive, give it to an agent, and know how she will open it later.
**Preconditions**: Passphrase set up and unlocked. One normal drive already exists, so the drive menu is available.
**Surface**: mixed (web, CLI)
**Ideal path**: 9 — drive menu `New drive`, tick "Agent-only", `Create drive`, `Download recovery file and continue`, `I saved it`, then agent `login`, `Use one of my drives instead`, choose file, `Approve agent`.
**Alternate paths**: CLI `agent-drive drive create --name client-exports --agent-only` (the agent keeps the key; no recovery file exists until `credentials export`); the agent creates a normal drive and she does not tick the box (it will seal to her account).

### Steps
1. In Files she opens the drive menu and clicks `New drive` (`drive-menu.tsx:139`). → Dialog "Create a drive".
2. She types "client-exports", ticks "Agent-only — never add this drive to passphrase unlock", clicks `Create drive`. → Receipt "Your drive. Your key.", same as SETUP-034.
3. `Download recovery file and continue`, then `I saved it`. → Files, the new drive selected.
4. She opens the key chip. → "Unlocked" with menu line "Unlocked, but this drive’s key is loaded in this tab." (hasKey) or, after a reload, "Unlocked. This drive is agent-only — only its recovery file opens it." The `Download recovery file` button is missing after a reload because a fresh file needs the key loaded (`key-chip.tsx` `canReproduce`).
5. In the terminal the agent runs `agent-drive login --name "exports-bot"`. She opens `/connect?code=…`, clicks `Details`, "Use one of my drives instead (needs its recovery file)", picks "client-exports", chooses the file, types the verification code, `Approve agent`. → "Access approved for exports-bot".
6. The agent runs `agent-drive account seal`. → `<drive id>: agent-only`, no failure.
7. Later she reloads, clicks a file in "client-exports". → Dialog "Load the key for client-exports" with the note "Agent-only: open with a recovery file." and no `account seal` help. Instead: "No recovery file? Ask the agent that created this drive to run `agent-drive credentials export`, then choose or paste what it gives you."
8. She chooses the saved file. → Key loaded.

### Variations
- Passphrase setup after this drive exists never adds it (`console.tsx:2469-2471`).
- Keeping a recovery file is the only backup. If she loses it, only the agent's config or a bundle can recover the key (`docs/keys-and-recovery.md`).
- CLI-created agent-only drive: `agent-drive drive create --name N --agent-only` records the intent locally before the API call (`cli.ts:1369-1373`).
- If an agent runs `account seal --drive <agent-only id>` the result is `agent-only`; if the key lacks `read` scope and cannot list drives, the status can be `unknown type` with "unknown drive type: run 'agent-drive account seal --drive ID' with a key that can read drives" (`account-seal.ts:34-35`).

### Edge Cases
- The dialog line "Ask the agent that created this drive" (`unlock-dialog.tsx:263`) is wrong for Lena: she created the drive in the browser; no agent created it.
- The drive menu has no visible agent-only marker. A drive named like another normal drive is indistinguishable until the key chip or unlock dialog is opened.
- Tick-box wording ("never add this drive to passphrase unlock") uses product words the new owner has not met yet; `docs/console.md` spells out that the API refuses a slot.
- I found no UI or CLI path to change an existing drive from normal to agent-only or the reverse; not confirmed beyond the code read.

---

## SETUP-041: Passphrase setup interrupted by the Clerk confirmation prompt

**Type**: short
**Topic**: Owner keys in the console: reverification
**Persona**: Ali Hassan, product manager. Taps away from prompts. Chose his own passphrase.
**Goal**: Finish setting a passphrase after cancelling the "confirm it's you" step once.
**Preconditions**: Signed in a while ago (Clerk session older than the strict window), no account key.
**Surface**: web
**Ideal path**: 3 — `Set up`, type passphrase twice, `Create`.
**Alternate paths**: generated passphrase (adds `I saved it`, skips typing).

### Steps
1. He clicks `Set up`, then `Use my own passphrase`. Field label "Passphrase (at least 14 characters)", second field `Type it again`. He types "correct horse battery staple 2026" in both.
2. He clicks `Create`. → "Creating… this takes a few seconds." then a Clerk prompt. He closes it.
3. → The form shows: "Confirm it’s you to set up the passphrase." Both fields are now empty (typed values leave state before the slow work, `vault-forms.tsx` `submit`). He retypes both and clicks `Create` again, completes the prompt. → Notice "Passphrase set up. Your agent can now add its drives to your account." or "Passphrase set up. 1 drive added to your account."

### Variations
- Too short: "Use at least 14 characters." Obvious pattern: "That passphrase is too easy to guess: it contains a common word." (or "it uses too few different characters", "it repeats one character", "it contains an ascending or descending sequence", "it contains a keyboard row pattern", "it contains your email name"). Mismatch: "The passphrases don’t match."
- With a generated passphrase the code stays on screen after a cancel, so he can click `Create` again.
- Network failure: "Could not reach Agent Drive. Check your connection and try again." Expired session: "Your session expired. Sign in again."
- Dialog is not closable while the setup is busy.

### Edge Cases
- While the Clerk prompt is open the console dialog is hidden (`native-dialog-suspension.ts`) and comes back after.
- The "At least 14 characters" label and "Use at least 14 characters." error are the same fact twice; the generated passphrase is 20 characters and the copy never says why a longer one is better except the small print "The generated one can’t."

---

## SETUP-042: Jo uses a coworking Mac and wants nothing left behind

**Type**: medium
**Topic**: Owner keys in the console: passphrase unlock, "Keep this browser unlocked", lock
**Persona**: Jo Park, consultant, borrowing a shared iMac for an afternoon.
**Goal**: Read two files, then leave without the next person being able to open her drives.
**Preconditions**: Passphrase set up (no passkey). Shared Mac, Chrome profile used by others.
**Surface**: web
**Ideal path**: 4 — untick `Keep this browser unlocked`, `Unlock`, use files, key menu `Lock this browser`.
**Alternate paths**: sign out through `UserButton` ("Your account"), which also clears the stored key (`docs/console.md`); key menu `Lock` (clears the tab only).

### Steps
1. Jo signs in and clicks a file. → Dialog "Unlock with your passphrase": "Type your passphrase to open the drives you added to your account. The keys stay in this browser only." The checkbox `Keep this browser unlocked` is ticked by default.
2. She reads "stay in this browser only" and does not realise the box means the browser keeps a key after she leaves. She types her passphrase and clicks `Unlock`. (Hesitation: the box is easy to skip.)
3. File opens. After 40 minutes away: notice "Locked after 30 minutes without use. Enter your passphrase to continue."
4. She finishes. She opens the key chip: buttons `Lock`, `Lock this browser`, `Change passphrase`, `Forgot or exposed passphrase?`. She clicks `Lock` first, reloads, and from the code I read the key restores without a prompt because the stored browser key survives `Lock` (`vault.ts` `lock` does not clear it; `restorePersisted` runs on load). She then picks `Lock this browser`, reloads, and sees chip "Locked".

### Variations
- `Lock this browser` fails: "The stored key could not be removed; clear this browser’s site data to finish locking it."
- She changes her passphrase on another device: "Your passphrase was changed elsewhere. Enter it again to continue."
- Setup path: the setup form has no checkbox and still stores the key, so a user who sets up a passphrase on a shared machine is never asked.
- Passkey users see the same checkbox on the passkey form.

### Edge Cases
- `Lock` and `Lock this browser` sit next to each other; only the second deletes the stored key (`docs/console.md:26`).
- `docs/console.md:28` says the tab key clears "when you leave the Files page" while `docs/backup-and-recovery.md` says only "reload ... or after 30 minutes".
- Idle lock text promises to ask for a passphrase; whether a reload after an idle lock reopens silently with "Keep this browser unlocked" is from code reading, not observed. A walker should check this.

---

## Copy conflicts and repeated facts (summary)

| # | Conflict | Where |
|---|----------|-------|
| 1 | CLI says set the passphrase "under Settings"; Settings can only show status and link to Files. | `account-seal.ts:30-31`, `settings-client.tsx:103,141`, banner `console.tsx:2770` |
| 2 | Fingerprint and login "Verification code" have the same shape (`a1b2 c3d4 e5f6 7890`) but different purposes. | `verification.ts`, `cli.ts:1153`, `account-seal.ts:37-39` |
| 3 | Fingerprint is "under Settings" in every instruction, but also in the key menu and inside a sentence with a trailing comma. | `unlock-dialog.tsx:242`, `key-chip.tsx:111`, `settings-client.tsx` |
| 4 | Setup stores the key in the browser with no checkbox; docs say the checkbox is "used by setup". | `vault-forms.tsx` (no checkbox), `docs/keys-and-recovery.md` |
| 5 | Reset is hidden in the key menu; the stuck-user dialog never links to it. | `key-chip.tsx:264`, `vault-forms.tsx:85` |
| 6 | "Ask the agent that created this drive" is wrong for a drive created in the browser. | `unlock-dialog.tsx:263` |
| 7 | Passkey wording differs across chip, title and links. | `key-chip.tsx:137`, `console.tsx:4170`, `unlock-dialog.tsx:114,328` |
| 8 | Idle message mentions only the passphrase. | `console.tsx:494` |
| 9 | Quickstart, home and onboarding omit the verification code the approval page requires. | `docs/quickstart.md:35`, `home.ts:8`, `console.tsx:2858,2874` vs `connect.tsx`, `llms.txt/route.ts` |
| 10 | Error quoted in docs is shorter than the real string. | `docs/backup-and-recovery.md` vs `recovery-file.ts:7-8` |

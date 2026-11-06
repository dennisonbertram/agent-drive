# C06-C Convention: setup checklist plus backup like a password manager (Vercel / Linear / 1Password / Dropbox)

## What the category does
- **Vercel and Linear onboarding:** a short "Get started" checklist with numbered items, a progress count ("1 of 3"), one filled primary button on the current step, and completed steps struck through or marked with a check.
- **1Password / Bitwarden "Emergency Kit" and Proton recovery file:** during sign-up you get exactly one button, "Download Emergency Kit" (or "Download recovery file"), and the next step stays disabled until the file was downloaded. There is no "I saved it" checkbox; the download is the acknowledgment. Afterwards Settings shows "Recovery file: downloaded <date>".
- **Dropbox / Google Drive first run:** the empty state is one illustration-free centred card, a single filled button ("Upload" or "Create"), and a secondary "Get the desktop app" link. Apps are connected from a dedicated "Connect" action, not from the empty state itself.
- **Stripe / Vercel dashboards:** pre-filled names ("my-project") selected on focus so the first keystroke replaces them.

## Change (maps to the product)
1. Centred card, one headline: "Connect your first agent". Primary button: **Copy setup line** (`> Set up Agent Drive: {origin}/llms.txt`). Under it a text link, "Or create a drive yourself" (opens the existing New drive dialog), not a button. "+ New drive" in the toolbar stays secondary.
2. A progress line above the checklist: "Step 1 of 3" with the three numbered items (landing-page numerals): Connect an agent, Create a drive, Back up its key; items show check, current, or todo from data (`activeAgents.length`, `drives.length`, `drive.key_backup_at`).
3. New drive dialog: name prefilled "my-drive", text selected on focus, Enter submits; single field and one button.
4. Receipt = recovery kit: title "Save your recovery file", one sentence ("Without it nobody, including us, can open this drive."), then one primary **Download recovery file and continue**. It saves the JSON, records `key-backup`, refreshes, closes. Copy key and show key move behind "Use a password manager instead" (a `<details>`). The dialog stays non-closable until the click, as today.
5. After it, a green "Key backed up" chip (`--ok`) replaces the red banner; Settings/Files show the date. The "Download recovery file" button remains in the chip's menu only as "Download again".

## Files
`console.tsx` (receipt, onboarding, banner), `console-panels.css`, `globals.css` (`--ok`), shared download helper that POSTs `key-backup` (fixes the missing call in the receipt save, the cause of F19).

## Effort
M. Mostly copy and layout; one new `<details>` and a chip variant.

## Risks and encryption
- Same as A: the key never leaves the browser, the server only records `method: file`; "backed up" means the download started. Say "downloaded" in the chip tooltip.
- Hiding Copy key behind a disclosure adds a click for password-manager users; they are the minority of agent-first users.
- Putting Connect first assumes most first-time visitors come from the landing's agent line. The console cannot verify an agent connected until `/connect` approval, so step 1 may stay "current" for users who only want a drive; the text link covers them.

## Acceptance criteria
1. One orange primary (Copy setup line), "New drive" secondary, no "↗". Met.
2. Prefilled "my-drive", Enter submits. Met.
3. One "Download recovery file and continue". Met.
4. Green "Key backed up" chip straight after; never "hasn't been backed up". Met.
5. Centred card at about 40% of the viewport plus a progress line. Met.
6. Landing-style numerals with done/current/todo. Met.

# Walk report: SETUP-060 Click Add webhook on a locked drive, unlock, and resume

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: New user, create drive research-bots, add then revoke a webhook once (so the drive has a trace inbox), then click Set up, Use my own passphrase and create a passphrase

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-1.png`
- What the screenshot shows: 'SET UP PASSPHRASE UNLOCK' offers a generated passphrase with a Copy button, an 'I saved it' checkbox and a disabled Create; 'Use my own passphrase' swaps to two black fields. A made-up passphrase containing common words is refused with 'That passphrase is too easy to guess: it contains a common word.' Header then says 'Passphrase set up. 1 drive added to your account.' and the chip reads Unlocked.
- Geometry: ok

### Step 2: Reload the console and click Capture... then Add webhook

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-2.png`
- What the screenshot shows: The Capture dialog (shown) opens normally. After a reload the vault is still 'Unlocked' (the key persists), so Add webhook went straight to setup and showed a token (step-3.png). To get the locked state I opened the Unlocked chip, which offers 'Lock' and 'Lock this browser' (two similar items with no explanation), and chose Lock; the chip now reads Locked.
- Geometry: ok

### Step 3: Click Add webhook on the locked drive

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-4.png`
- What the screenshot shows: Capture dialog closes and 'UNLOCK WITH YOUR PASSPHRASE' opens with 'After you unlock, you can set up the OpenRouter webhook.', a passphrase field, 'Keep this browser unlocked' (checked), Unlock (disabled until typed) and 'Use a recovery file instead'. Matches the story.
- Geometry: geometry: dialog-actions buttons differ in width (primary vs secondary), intentional

### Step 4: Type a wrong passphrase and click Unlock

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-5.png`
- What the screenshot shows: Red text 'That passphrase is not correct.' The field is emptied and the dialog stays open. Clear.
- Geometry: ok

### Step 5: Type the right passphrase and click Unlock

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-6.png`
- What the screenshot shows: Capture dialog reopens by itself and setup runs without a second click on Add webhook; token, Webhook URL and Headers appear. Keyboard focus is on the first 'Copy' button (the npm install command), not on the token. No Clerk prompt (test session, not-walkable).
- Geometry: dialog internal scroll as in SETUP-059

### Step 6: Mobile 390x844 on the token view

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-060/screenshots/step-7.png`
- What the screenshot shows: Fits; the webhook URL breaks mid-word ('webhook / s/openrouter'). No horizontal overflow.
- Geometry: pageOverflowX 0

## Flow Log

Ideal path 5 (Capture..., Add webhook, passphrase + Unlock, Clerk confirm, copy URL). Needed: Capture..., Add webhook, type passphrase, Unlock = 4 clicks + typing, then copy buttons; same as ideal. Hesitations: the note 'After you unlock, you can set up the OpenRouter webhook.' reads as if another click is needed, but setup resumes automatically; after resume focus is on the install-command Copy button rather than the token. Re-entry: none; wrong passphrase keeps the dialog and the typed context. Duplicated info: none new. Not walkable: Clerk reverification; passkey variant (no passkey device); the 30-minute auto-lock message; closing the unlock dialog to check that nothing resumes (not exercised).

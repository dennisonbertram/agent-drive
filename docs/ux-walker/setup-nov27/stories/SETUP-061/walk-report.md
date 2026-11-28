# Walk report: SETUP-061 Agent-only drive: recovery file needed, mismatched file chosen

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Normal (not agent-only) drive priya-agents with no key loaded: Capture..., Add webhook
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-1.png`
- What the screenshot shows: Unlock dialog in recovery mode 'LOAD THE KEY FOR PRIYA-AGENTS' (title is upper-cased by style). Four routes in one dialog: Choose recovery file, 'Paste a key instead', an account seal command with a Copy button inside the sentence and a reference to a 'Settings' fingerprint, 'Set up passphrase unlock', then a credentials export command with a second Copy. Dense; the sentence 'If it reports unverified, re-run it with --fingerprint set to the account-key fingerprint under Settings.' points to a page the sidebar does not have (Files, Agents, API keys, Usage, Trash, Billing & limits, Activity & deletion).
- Geometry: no overflow

### Step 2: Choose a recovery file for the right drive id but the wrong key
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-2.png`
- What the screenshot shows: No error in the unlock dialog. It closed, the Capture dialog reopened, set up, and then showed in red 'This key does not open this drive's files. Retry'. The header chip still reads 'Key needed'. (The story expected the unlock dialog to reject it with different text.)
- Geometry: ok

### Step 3: Click Retry
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-3.png`
- What the screenshot shows: Retry reopens the unlock dialog (not a repeat of the same error), so recovery works, but the word 'Retry' does not say that a different file is needed.
- Geometry: ok

### Step 4: Choose a recovery file that names a different drive
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-4.png`
- What the screenshot shows: Unlock dialog stays open and says in red 'That recovery file is not for this drive.' Clear and immediate. A third wording for 'wrong key'.
- Geometry: ok

### Step 5: Create a real agent-only drive (ci-traces) in the web app, add and revoke a webhook, reload, Capture..., Add webhook
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-5.png`
- What the screenshot shows: Recovery dialog with the notice 'Agent-only: open with a recovery file.' It is shorter than the non-agent-only version: only recovery file, 'Paste a key instead', and 'Ask the agent that created this drive to run agent-drive credentials export, then choose or paste what it gives you.' with one Copy. Matches the story and is the clearer of the two dialogs.
- Geometry: no overflow

### Step 6: Mobile 390x844 on the agent-only dialog
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-6.png`
- What the screenshot shows: Fits, no horizontal scroll, drop zone and text readable.
- Geometry: pageOverflowX 0

### Step 7: Agent-only: choose a wrong-key file, then Retry, then the correct file
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-7.png and /Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-061/screenshots/step-8.png`
- What the screenshot shows: Wrong key (same drive id): again accepted, then 'This key does not open this drive's files. Retry' in the Capture dialog. Retry reopens the unlock dialog. The correct recovery file leads to the token view (Replace/Revoke, Webhook URL, Headers).
- Geometry: ok

## Flow Log

Ideal path 5 (Capture..., Add webhook, Choose recovery file, pick file, copy URL). Needed with the correct file: 3 clicks plus the file picker, as ideal. With a wrong file: 3 extra steps (error, Retry, choose again). Hesitations: the non-agent-only recovery dialog asks the user to weigh four routes; the instruction to find a fingerprint 'under Settings' dead-ends. Re-entry: after the mismatch error, Retry returns to the file chooser. Duplicated info: 'wrong key' has three wordings across 'That recovery file is not for this drive.', 'This key does not open this drive's files.' and (not reached) the console's 'account copy is invalid'. The story's CLI route `agent-drive credentials export` was not run: CLI login was rate-limited by the shared server (`slow_down`), so only the web side of this story was walked. Not walkable: Clerk reverification; a real recovery file saved from a CI-created drive.

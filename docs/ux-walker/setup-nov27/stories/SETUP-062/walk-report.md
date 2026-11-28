# Walk report: SETUP-062 Empty new drive with a pasted key

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Create a new drive side-project (no files, no inbox) in the web app, reload so the key is gone, Capture..., Add webhook, open 'Paste a key instead'
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-062/screenshots/step-1.png`
- What the screenshot shows: Recovery dialog 'LOAD THE KEY FOR SIDE-PROJECT' with the paste field open: label 'DRIVE KEY OR CREDENTIALS BUNDLE (ADCRED1...)' and a black masked input, orange Load key. Same dense layout as SETUP-061 step 1.
- Geometry: no overflow

### Step 2: Paste the drive's true plain key, click Load key
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-062/screenshots/step-2.png`
- What the screenshot shows: The unlock dialog accepts it silently, the Capture dialog reopens and shows in red 'This drive has no files yet. Load its recovery file or credentials bundle so the key can be matched to the drive. Retry'. The user pasted the correct key, but the text reads as if something was wrong with it. The unlock-side text from the story ('This drive has no file or trace inbox...') was never shown.
- Geometry: error text lines have uneven leading (27px vs 21px elsewhere)

### Step 3: Click Retry
- What the screenshot shows: Unlock dialog reopens (so Retry does recover here, unlike the story note that said it would repeat the error).
- Geometry: ok

### Step 4: Choose the recovery file for this drive
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-062/screenshots/step-3.png`
- What the screenshot shows: Setup completes immediately: token view with Webhook URL and Headers, chip 'Key loaded'.
- Geometry: internal scroll as in SETUP-059

## Flow Log

Ideal path 6 (Capture..., Add webhook, paste key, Load key, read error, switch to Choose recovery file). Needed: 7 actions (the extra one is Retry to get back to the chooser). Hesitation: the user pasted the right key and is told to 'load its recovery file or credentials bundle'; nothing says the pasted key is probably fine but cannot be checked on an empty drive. Re-entry: Retry works. Duplicated info: two wordings for the same fact exist in code; only one was visible. The CLI route (`agent-drive credentials export` for an adcred1 bundle) was not run (CLI login rate-limited by the shared server). Mobile check was not repeated for this dialog; the same dialog family was checked at 390px in SETUP-061 step 6 (agent-only variant).

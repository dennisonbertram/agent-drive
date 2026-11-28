# Walk report: SETUP-059 Add the first webhook on an unlocked drive with a loaded key

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: New user, test session, open Files, click New drive, name it priya-agents, Create drive, Download recovery file and continue, I saved it (setup for the story; story starts after the receipt)
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-1.png`
- What the screenshot shows: Files page with the drive priya-agents, banner 'Recovery file saved. Store it in a password manager.', toolbar Traces / Capture... / Key loaded. The receipt ends with 'Did the recovery file save?' and 'I saved it' as the story says. The drive-name switcher truncates to 'priya-agent...' although there is plenty of room.
- Geometry: clean apart from the truncated drive name

### Step 2: Click Capture... in the Files toolbar
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-2.png`
- What the screenshot shows: Dialog 'CAPTURE TRACES' with a LOCAL AGENTS section first (install command, capture command with two 'Copy' buttons) and an OPENROUTER WEBHOOK section with the orange Add webhook button and the TLS note. Fits the viewport. Text under Local agents ends 'Check terminal output: capture may be disabled, uploads may be queued, or calls may not be captured.' which does not say what to look for.
- Geometry: pass

### Step 3: Click Add webhook
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-3.png`
- What the screenshot shows: Test session has no Clerk, so there was no reverification prompt (not-walkable). Setup finished within about 3 seconds and showed 'Created today 18:04 Active Replace Revoke', then 'Copy these now. The token is shown once. In OpenRouter, add a Webhook destination.', Webhook URL, Headers (Bearer adw_...), the Privacy Mode note and the TLS note. The dialog is 807px tall in an 800px window so it scrolls inside itself; the one-time token is 330px below the top, under the Local agents block, and the prominent Replace button sits directly above it.
- Geometry: dialog scrollHeight 807 vs clientHeight 750 (internal scroll)

### Step 4: Click Copy webhook URL, then Copy headers JSON
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-4.png`
- What the screenshot shows: Both buttons change to 'Copied' and stay that way; the wider label makes the code boxes re-wrap (URL breaks at a different character). All four Copy buttons read only 'Copy' on screen (accessible names are specific).
- Geometry: no overflow

### Step 5: Scroll the dialog to the bottom
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-5.png`
- What the screenshot shows: After scrolling, the title bar and the close X scroll away (header is not sticky). Bottom shows the Privacy Mode note and TLS note. Copy buttons are back to 'Copy'.
- Geometry: ok

### Step 6: Close the dialog and open Agents
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-6.png`
- What the screenshot shows: Agents lists a new agent 'openrouter' with a '0' avatar and a 'NO API KEYS' badge. The Capture dialog never said this agent would be created, and 'No API keys' with no explanation can look like a defect.
- Geometry: geometry: Refresh/+ New agent pair only

### Step 7: Mobile 390x844: open Drive menu then Capture traces...
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-7.png (also step-7-mobile.png)`
- What the screenshot shows: On mobile the toolbar buttons Traces and Capture... are not shown; the only route is the drive-name dropdown, whose item is 'Capture traces...'. The dialog itself reflows cleanly, no horizontal overflow.
- Geometry: pageOverflowX 0

## Flow Log

Ideal path 4 (Capture..., Add webhook, Copy webhook URL, Copy headers JSON). Needed: 4 clicks, as ideal, plus scrolling inside the dialog for the Privacy Mode note on small windows. Steps specified 6, needed 6. Hesitations: (1) the label differs on every surface: toolbar 'Capture...', drive menu 'Capture traces...', dialog 'CAPTURE TRACES', and the neighbouring 'Traces' button does not open the dialog; (2) a user who wants only the webhook must read past a Local agents block first. Re-entry: none. Duplicated info: the TLS sentence appears once at the bottom (not duplicated under Local agents in this release, unlike the topic notes). Not walkable: Clerk reverification prompt (step 3), OpenRouter's own destination form (step 5).

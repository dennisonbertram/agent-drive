# Walk report: SETUP-066 Revoke a webhook, with confirm and cancel

Status: **pass**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Capture..., click Revoke

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-066/screenshots/step-1.png`
- What the screenshot shows: Inline confirm 'Stop this webhook?' with a red 'Revoke webhook' button (already focused, ring visible) and 'Cancel'. Replace stays active above it. Nothing says what stopping means.
- Geometry: ok

### Step 2: Click Cancel

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-066/screenshots/step-2.png`
- What the screenshot shows: Back to Active / Replace / Revoke; nothing lost.
- Geometry: ok

### Step 3: Click Revoke, then Revoke webhook

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-066/screenshots/step-3.png`
- What the screenshot shows: Row replaced by the orange 'Add webhook' button with focus on it, as the story says. No toast or text saying the webhook was revoked. I verified the token now returns 401.
- Geometry: ok

### Step 4: Add again, block the revoke request (offline stand-in), try Revoke webhook

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-066/screenshots/step-4.png`
- What the screenshot shows: Red-free text 'Could not reach Agent Drive. Check your connection and try again.' appears between Replace and the confirm buttons; confirm stays open with Cancel. Good message (not the 'link' wording the story feared).
- Geometry: ok

### Step 5: Mobile 390x844: open the Drive menu (Capture traces... entry)

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-066/screenshots/step-5.png`
- What the screenshot shows: On mobile the dialog is reached only via the drive-name dropdown: Traces, Capture traces..., drive row, Copy drive ID, New drive. Layout fine.
- Geometry: pageOverflowX 0

## Flow Log

Ideal path 3 (Capture..., Revoke, Revoke webhook). Needed: 3. Matches. Hesitations: the confirm gives no hint of consequences. Re-entry: Cancel is clean. Duplicated info: none. Existing traces under /traces/openrouter/ and the openrouter agent remain (not stated in the dialog; the agent was not re-checked after revoke).

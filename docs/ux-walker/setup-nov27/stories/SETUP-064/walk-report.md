# Walk report: SETUP-064 Save the token for later, lose it, then Replace

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: With a webhook already created and the dialog closed, click Capture...
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-064/screenshots/step-1.png`
- What the screenshot shows: Row 'Created today 18:04', 'Active', buttons Replace and Revoke. No URL, no header, no sentence saying the token cannot be shown again or that Replace creates a new one. Focus is on the first Copy button.
- Geometry: ok

### Step 2: Click Replace
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-064/screenshots/step-2.png`
- What the screenshot shows: No confirmation. A new token block appears at once ('Copy these now. The token is shown once...') with the same Webhook URL and a new header. Nothing says the previous token has stopped working or that the URL is unchanged. I checked: the old token returned 401 `The webhook token is not valid.` and the new one returned `{"ok":true}` with X-Test-Connection.
- Geometry: internal scroll as in SETUP-059

### Step 3: Reopen the dialog at 390x844 (via the Drive menu)
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-064/screenshots/step-3.png`
- What the screenshot shows: Closed-state row (Created, Active, Replace, Revoke) fits; Revoke is a 50x32 text link (small touch target). No horizontal overflow.
- Geometry: pageOverflowX 0

## Flow Log

Ideal path 3 (Capture..., Replace, copy headers). Needed: 3 actions. Matches the ideal. Hesitations: the user looks for a way to see the lost token, finds none and gets no hint that Replace is the answer; the URL is not shown for an existing token even though it is not secret. Re-entry: none. Duplicated info: none. Not walkable: Clerk reverification on Replace.

# Walk report: SETUP-068 Key from another tab wins (409 race) and traces folder empty state

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Two tabs on the same account and drive (demo-drive). Tab A (key loaded from creation) has the Capture dialog open showing Add webhook. In tab B (loaded the recovery file) click Capture..., Add webhook

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-1.png`
- What the screenshot shows: Tab B reaches the token view: Active, Webhook URL, Headers (token ending ...ec86 in the test). Inbox created by B.
- Geometry: internal scroll as in SETUP-059

### Step 2: Back in tab A (stale: still shows Add webhook), click Add webhook

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-2.png`
- What the screenshot shows: Tab A gets its own token with 'Created today 18:17'. No note that it replaced another token. I tested both with X-Test-Connection: tab A token `{"ok":true}` 200; tab B token 401 `The webhook token is not valid.`
- Geometry: same

### Step 3: Switch to tab B

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-3.png`
- What the screenshot shows: Tab B still shows its old Webhook URL, header, 'Active' and the same 'Created today 18:17' as tab A, so nothing says it is now dead and the two cannot be told apart. (Without 'Created' times that differ, the user cannot tell which header is current.)
- Geometry: same

### Step 4: In tab A, close the dialog and click Traces

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-4.png`
- What the screenshot shows: Empty state 'No traces yet.' with 'Run an agent through agent-drive capture, or add an OpenRouter webhook.' The link reopened the Capture dialog. It does not say OpenRouter traces will land in /traces/openrouter/<date>/.
- Geometry: pageOverflowX 0

### Step 5: Send a test OTLP request with tab A's token (curl, stand-in for OpenRouter), then Refresh Files

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-5.png`
- What the screenshot shows: Response `201 {"ok":true,"stored":1,"path":"/traces/openrouter/2026-11-27/...json"}`. The Recent list shows the file, 483 B, author 'openrouter', path /traces/openrouter/2026-11-27. The file name starts with the span time, and the path is only in the small grey line.
- Geometry: clean

### Step 6: Mobile 390x844 on the traces list

- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-068/screenshots/step-6.png`
- What the screenshot shows: List fits; the breadcrumb shows a back chevron and 'traces'; geometry script reports the crumbs nav spilling 7px (not visible in the screenshot).
- Geometry: nav.crumbs spill 7px

## Flow Log

Ideal path 6 (Capture..., Add webhook, copy URL, copy headers, paste into OpenRouter, click Traces). Needed with one tab: as ideal. With the stale second tab the user must notice by themselves that the first tab's token is dead. Hesitations: cannot tell which header is current; the empty state does not name where OpenRouter traces will appear. Re-entry: none. Duplicated info: two 'Created today 18:17' rows. The story said the second Add webhook runs the 409 re-read path; from outside it looked like a plain successful replace (no error shown). Not walkable: pasting into OpenRouter, a real OpenRouter delivery (I used curl with a hand-made OTLP body), Privacy Mode behaviour, Clerk reverification.

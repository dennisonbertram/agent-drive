# Walk report: SETUP-065 Stale token ('Needs replacement') after the inbox changed

Status: **not-walkable**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Try to reach the stale state
- What the screenshot shows: The state needs a changed inbox record from another API call plus Clerk reverification. A normal user cannot create it from the console or the CLI, and the test session has no Clerk. Not walked. The Replace path itself (key check then new token) was walked in SETUP-064.
- Geometry: n/a

## Flow Log

Not walkable: no way to change the inbox record from the web or CLI surface available here, and no Clerk. Steps specified 4, walked 0. Mobile check not done.

# SETUP-023 walk report: delegate checkbox for an orchestrator

User e2e_approve_connect_024. Request `ravi-lead`, code `KKWT-NDPM`.

## Steps

1. Opened the link: "Connect ravi-lead?" and "New encrypted drive · full access". No delegate option visible; it is inside collapsed Details (screenshots/step-1.png is not retained separately; the same card is in step-2.png).
2. Opened Details and ticked "Let this agent add other agents to its drives". The summary line changed to "New encrypted drive · full access · can add other agents" (screenshots/step-2.png; Details closed after a second click). Good live feedback, but only visible if Details is closed.
3. Mobile 390x844 (screenshots/step-3.png): the summary wraps to two lines ("can add other / agents"), no horizontal scroll (390). The Verification code input is 168 px wide (same finding as SETUP-017).
4. Typed the verification code and Approve: done card "You approved ravi-lead to read, write, delete and share its new drive." (screenshots/step-4.png). It does not mention that the agent can add other agents.
5. CLI: `Logged in as agent ravi-lead.`, `Scopes: read write delete share delegate`.
6. Worker: `agent-drive login --name worker-1` printed code `PDTG-DLFP`. `agent-drive grant PDTG-DLFP --verify "<code>"` from the ravi-lead home printed `Offered drive 9ea82157-... to worker-1 (read write; writes anywhere in the drive). The owner approves at http://localhost:3811/connect?code=PDTG-DLFP.`
7. Opened the worker link: summary "ravi-lead · can read and write · offered by ravi-lead" (screenshots/step-5.png) and, in Details, Offered by ravi-lead plus "ravi-lead sealed the drive key for this login; Agent Drive never sees it." (screenshots/step-6.png). The delegate checkbox is shown (unticked) on the worker's request. The summary uses `ravi-lead` three times (drive name = agent name).
8. Approved: "You approved worker-1 to read and write the drive ravi-lead." The worker's CLI printed `Scopes: read write`. The offer only passed `read write` even though ravi-lead holds delete and share; the page does say "Read, write" only.
   Geometry: no overflow, no uneven rows (Details false-positive).
   Not walked: the "forgot the checkbox" failure from `grant` (would need another rate-limited start) and the focus re-fetch banner.

## Flow Log

- Steps specified: 6. Steps needed: 6 (expand Details, tick, code, approve, grant, approve worker).
- Hesitations: delegate hidden behind Details; no explanation of what 'add other agents' means for risk beyond the grey text; the checkbox appears on the worker request too.
- Re-entry: user must relay the worker's verification code to the lead agent (documented).
- Duplicated info: drive name = agent name repeated.
- Verdict: PASS with low/medium findings.

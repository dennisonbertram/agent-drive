# STORY-062: Owner revokes a handed-off agent — walk report

Result: PASS on function (revocation worked end to end, agent-side `whoami` failed with an auth error), with feedback and navigation problems. Throwaway agent "walker-c-job" was created with `ad rb credentials issue --name walker-c-job` (so it shows "issued by research-bot", like the story's ci-job) and revoked from the console. No seeded agent or key was revoked.

## Steps

1. Console, Agents tab (step-1-agents.png): the list shows walker-c-job with id, "issued by research-bot", "1 ACTIVE KEY" and "Revoke access". The 12 "Revoke access" buttons have identical accessible names (snapshot shows only 'button "Revoke access"'), so a screen-reader user cannot tell which agent each one affects.
2. Clicked "Revoke access" on walker-c-job: native browser confirm "Revoke all API keys for walker-c-job? This stops this agent’s current access." (a window.confirm, so it cannot be styled and is skipped by some automation; I accepted it with `dialog accept`).
3. Result (step-3-revoked.png): the row now reads "0 ACTIVE KEYS" and the notice "All API keys for walker-c-job have been revoked." was set. But the notice is rendered in the page header, which had scrolled out of view: its top was at y = -461px, so nothing visible in the viewport confirmed the action except the changed badge. "Revoke access" stays enabled on the row (it has 0 keys now).
4. Agent side: using the issued credentials, `whoami` printed "The API key is invalid or revoked." Also printed "Warning: could not report the key backup for drive ... to Agent Drive." (the revoked key cannot report its backup; harmless but confusing wording).
5. API keys tab (step-5-apikeys.png): walker-c-job-key shows REVOKED with a disabled Revoke button, as the story says. The tab opened at the same scroll position as the Agents tab, mid-page, so the page header and list top were out of view. Revoked and active keys are interleaved in creation order. Each key row has an unlabelled third line ("research-bot", the drive?). Geometry audit: only intentional unevenness; `summary "Connect an agent"` flagged but renders on one line.
6. Mobile 390x844 (mobile-check.png, API keys tab): rows stack, Revoke buttons full-height, no overflow.

## Gap checks from the story

- No "rotate drive key" or "which drive keys does this agent hold" information anywhere in the console after revoking, so the leaked-drive-key variation has no UI path (gap confirmed).
- Revocation appears on Agents (badge), API keys (REVOKED) and the audit log (not opened here).
- Not walked: revoking an agent that issued other agents (cascade check).

## Flow log

- Story ideal path 3; actual 3 (Agents, Revoke, confirm) plus a scroll back up to see the notice. No hesitation finding the control. Hesitation: after confirming, whether it worked (the notice was off-screen).

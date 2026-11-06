# STORY-066: Revoke one leaked key versus revoking the whole agent — walk report

Result: PASS (the single-key revoke path works and the agent keeps its other key), with discoverability and copy findings. Throwaway agent "walker-c-ci" got key "ci runner" (read, via `ad rb credentials issue`) and a second key "hana laptop" (read, created through the console dialog). I cancelled the agent-level revoke, then revoked only "hana laptop".

## Steps

1. Agents tab (step-1-agent-row.png, step-1-agents.png): row walker-c-ci, id, "issued by research-bot", badge "2 ACTIVE KEYS", button "Revoke access". The button label does not say it revokes every key, and the badge is the only hint (hesitation confirmed).
2. Clicked "Revoke access": native confirm "Revoke all API keys for walker-c-ci? This stops this agent’s current access." This is the first place that says "all". It names neither the keys nor the count, and does not warn that it cannot be undone (the story says there is no undo). I cancelled; no keys changed. (I first clicked the wrong row because 14 rows have the identical name "Revoke access"; the confirm text naming the agent is what caught it.)
3. API keys tab (step-3-apikeys.png): rows "ci runner" (read, issued by research-bot) and "hana laptop" (read) each with Revoke. The list opened scrolled to the bottom (scroll position carried over from Agents). "hana laptop" has no "issued by" text while "ci runner" has it, so the two keys of one agent describe themselves differently. The list also holds 4 revoked rows from other agents between the top and these two.
4. Revoke "hana laptop": confirm "Revoke hana laptop? Commands using this key will stop working." Accepted. Notice "API key revoked. It can no longer authenticate." and the badge turned REVOKED (step-4-revoked.png). On desktop the notice was not visible in the viewport (it sits in the page header).
5. Agents tab (step-5-agents-after.png): badge now reads "1 ACTIVE KEY" (singular, correct).
6. Mobile 390x844 (mobile-check.png): agent rows stack with the badge and the button side by side; no overflow.

## Flow log

- Story ideal path 2 (Revoke on the one key, confirm). Actual 3 (API keys tab, Revoke, confirm), plus an optional detour through the agent-level button which the label invites. Hesitation: which of two "Revoke" controls to use; both tabs show the same agent and key count with different buttons (redundancy noted in the story).
- Two different confirm wordings ("Revoke all API keys for X?" vs "Revoke <label>?") and two different notices for the same underlying action type.

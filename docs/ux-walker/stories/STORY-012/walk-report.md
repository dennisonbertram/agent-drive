# STORY-012 walk report (ux-walker-a, user e2e_walkera7, CLI config scratchpad/walka/cfg4, code ZRCX-FTKX)

Result: PASS with findings.

1. /connect?code=ZRCX-FTKX for agent lead-bot (step-1-ticked.png shows it ticked). The checkbox "Let this agent add other agents to its drives" with help text sits between the "Add to an existing drive instead" link and Approve. Geometry audit clean. Measured: checkbox is 13x13px in the browser's default blue (rest of page is black/orange); help text starts at x=445 while the label text starts at x=468; help text bottom ~654px vs button top 656px (cramped, as in F-006-01). Nothing marks the checkbox as optional.
2. Ticked and clicked Approve agent -> "Approved". CLI printed "Logged in as agent lead-bot." and "Scopes: read write delete share delegate": delegate granted.
3. Variation (box not ticked): the first agent (cfg1, approved in STORY-006 without the box) ran `agent-drive grant BKQD-MWRT --write-path /inbox/helper` and got "The API key needs the delegate scope. Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope." It never says the human must tick "Let this agent add other agents" on the new approval, which llms.txt and the story say.
4. The "Add to an existing drive" checkbox variation and the "Offered by lead-bot" grant page were not walked (outside this lane's stories).
   Mobile (mobile-check.png, 390px): stacks cleanly; same cramped gap.

## Flow log

- Ideal 3 steps; actual 3 (open link, tick, Approve).
- Hesitation: the checkbox is not labelled optional; reads as possibly required.
- Data re-entry: none.

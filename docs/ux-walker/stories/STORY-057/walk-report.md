# STORY-057: Existing agent offers a drive with grant; owner only approves — walk report
Result: PASS (shortest path worked in 3 human-visible steps; all variations I tried behaved as the story says). Throwaway agent "walker-c-trace" (machine ux-wd) logged in with `ad wd login --name walker-c-trace`; research-bot (has delegate) ran `grant`. Not revoked afterwards.

## Steps
1. `login` printed link and code SWNX-PLVT.
2. Opened /connect?code=SWNX-PLVT BEFORE the grant (step-2b-before-grant.png, step-3a-stale-page.png): the normal new-drive form with "Add to an existing drive instead". It did not update when the grant arrived (DOM never showed "Offered by"); the owner must reload. This matches the story's variation, but the stale page lets the owner approve a different thing from what the agent offered.
3. `ad rb grant swnx-plvt --drive <id> --write-path /traces` (lower case accepted, uppercased). Output: "Request from walker-c-trace on ux-wd, made 2026-11-06T19:04:11.325Z." then "Offered drive <id> to walker-c-trace (read write; writes under /traces). The owner approves at http://localhost:3500/connect?code=SWNX-PLVT." The time is raw ISO UTC while the web page shows local time (2:04:11 PM).
4. Reloaded /connect (step-3-offered.png): no drive picker or key field; note "Offered by research-bot: drive research-bot, read, write, writes under /traces. That agent sealed the drive key for this login; Agent Drive never sees it." Geometry audit clean.
5. Variation: re-granted with `--read-only` while the page was open, clicked Approve: notice "The request changed; review it again." and the page text switched to "...read. That agent sealed..." (var-changed.png). Re-granted with /traces, reloaded, approved (step-4-approved.png: "Approved / Approved. Return to your agent; it will finish setup on its own.").
6. Agent finished: "Logged in as agent walker-c-trace. Scopes: read write. Writes limited to: /traces". `put /traces/t1.txt` succeeded; `put /reports/t1.txt` was refused with "The API key may only write under /traces."
7. Mobile 390x844 (mobile-check.png): fits, no overflow, Approve 48px tall, hint text 10px above it.

## Look pass
- The permission summary is one grey run-on sentence ("drive research-bot, read, write, writes under /traces"). The drive name repeats the agent name here (both research-bot), which reads like "drive research-bot". It carries the same visual weight as the pairing boilerplate.
- On "request changed" the change is silent: the notice has the same neutral grey box as the info note, the old text is replaced without highlighting what changed (here write was removed, which is a downgrade; an upgrade would look the same).
- Delegate checkbox is offered on a grant flow even though the human only intended to hand over /traces; it is unticked by default (good).

## Flow log
- Story ideal path 3; actual 3 human actions (open link, glance, Approve) plus one reload I needed because I had the page open earlier. No data re-entry. Hesitation: whether the reload was needed.
- Pairing code is shown twice conceptually (CLI and page), by design.

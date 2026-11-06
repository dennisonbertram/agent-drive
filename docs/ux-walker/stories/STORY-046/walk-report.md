# STORY-046: Human wants to share a file from the console — walk report

Result: FAIL (as the story predicts, this is a gap). A signed-in human cannot create, see or revoke a share link anywhere in the console. Signed in as e2e_uxreview, drive research-bot, drive key loaded from the recovery file via the Load drive key dialog (paste into the field).

## Steps

1. Files tab, key loaded (step-2-files-loaded.png): each row offers Download, Versions, Trash. No Share. Geometry audit on the Files page flagged the drive-tile strip, header buttons and footer; all are intentional (dashed "Your next agent" tile, differently sized buttons), not findings. Notice: the page shows both a banner "Key backed up 11/6/2026 (file)" and a chip "KEY LOADED"; two surfaces for key state.
2. Agents tab (step-3-agents.png) and API keys tab (step-4-apikeys.png): no sharing setting. The word "share" appears only as a key scope in rows such as "read, write, delete, share" and in "Connect without sharing your identity".
3. Activity & deletion (step-5-activity.png, opens /console/settings as a separate page with its own header and a "Back to files" button): audit log only; no shares section. The log is dominated by the console's own reads (console.audit.list, drives.list, console.usage.read, ... by "Console user"), so real activity is buried. Geometry audit: the two settings cards differ in height (446 vs 373) which is content-driven.
4. Public sources: /llms.txt documents `agent-drive share /notes/a.md --expires-in 24h` for agents; the landing page mentions it in a code sample. Nothing human-facing says "ask your agent".
5. Agent route works (see STORY-044 shares created with `ad rb share`).
6. Trash variation: clicked Trash on a throwaway file (/work/walkerc/b.txt) that had an active share. No confirmation dialog; notice "Moved /work/walkerc/b.txt to Trash. Restore it from the Trash tab." (step-6-trash-no-confirm.png). Opening the share afterwards shows "Shared file unavailable" (no warning to the owner that a live link just died).
7. Mobile 390x844 (mobile-check.png): rows stack with Download/Versions/Trash buttons; no overflow. The third drive tile is cut off at the edge but scrolls.

## Flow log

- Ideal path 3 (click Share, pick expiry, copy). Actual: no path in the console; shortest real route is asking an agent in chat (CLI/MCP), or downloading and emailing (loses expiry and revocation). I looked in 4 places (row actions, Agents, API keys, Activity) before concluding. Hesitation: whether "Activity & deletion" would list shares.
- Redundancy: key state shown twice on Files (banner and chip).

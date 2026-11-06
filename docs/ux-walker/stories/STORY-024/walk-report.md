# STORY-024 walk report (lane B)

Fresh user e2e_walkerb_new (no drives). Result: PASS with friction (the goal was reached: empty console -> drive -> key saved -> agent connected -> file visible), 7 screens/dialogs.

1. /console (screenshots/step-1-empty.png): "Give your first agent a home." with orange "Create your first drive ↗" and a 01/02/03 strip. The top-right "+ New drive" button does the same thing (two CTAs for one action). The 01/02/03 strip is plain text, not links. Geometry audit: only intentional unequal widths.
2. Create dialog (step-2-dialog.png): single "Drive name" field with placeholder "Research workspace". I entered "Research workspace".
3. Receipt "Your drive. Your key." (step-3-receipt.png): key in a dark box (one line of text in a ~75px box), Copy, "Save recovery key", warning, checkbox, disabled "Continue to drive". Escape does nothing (blocked, as catalog says) and there is no close button. Clicked "Save recovery key" with agent-browser download capture: file saved, 145 bytes, JSON {format: agent-drive-key-v1, driveId, key (43 chars)} at scratchpad/dl-b/step3-receipt.key.json. The dialog gives no sign that the save worked (step-3b-after-save.png is unchanged).
4. After "Continue to drive" (step-4-files-empty.png): red banner "This drive's key hasn't been backed up. If the agent's machine is lost, ... Ask the agent to run agent-dr…" (text clipped to one line, copy + "Download recovery file" buttons), "KEY LOADED" badge, "Ready for your first file." with "Connect an agent". The banner is still red even though the recovery file was just saved in step 3 (confirmed; same file must be saved again).
5. "Connect an agent" -> API keys tab (step-5-connect-agent.png): good: the top card gives a one-line instruction "Set up Agent Drive: http://localhost:3500/llms.txt" with Copy. Below, "Agent access": "Create an agent first." and "+ New API key" is disabled (grey).
6. "Create agent" button there opens the agent dialog directly (no need to detour via Agents tab; better than the catalog). Created "trace-bot". Result (step-6b-agent-created.png): notice "Agent created. Create an API key to connect it." But the "Connect an agent" card with the paste-in instruction is now collapsed to just its title (it is a <details> with no visible chevron), so the most useful content is hidden exactly when the user needs to hand it to the agent.
7. "+ New API key" (step-6d-new-key-dialog.png): label, agent, drive checkbox, scopes read/write/delete/share/manage. Created; receipt "Save your API key" (step-6e-key-receipt.png), checkbox then Done.
8. Agent side (CLI, isolated config): logged in with the key via --token-stdin, `put` /memory/handoff.md with the drive key from the recovery file: succeeded. In the console, clicking the sidebar "Files" tab showed the new row immediately (no manual Refresh needed) while the drive tile briefly said "0 B · 0 files" (after switching tabs it read "62 B · 1 file"). Screenshot step-7a-files-before-refresh.png.
9. Mobile 390x844 (mobile-check.png): clean, banner shows its full text on phone (it is clipped to one line on desktop), no overflow.

## Flow log

- Ideal 5 steps (create drive, save key, paste instruction, agent puts file, see it). Actual: 12 actions: create-first-drive, name+Create, Save recovery key, tick, Continue, Connect an agent, Create agent, name+Create, New API key, label+Create, tick+Done (+ agent side) , Files.
- Hesitations: (a) receipt dialog gives no feedback after Save recovery key; (b) after "Connect an agent" the user lands on "Create an agent first", a detour; (c) the collapsed instruction card.
- The drive created here is human-first, but the pasted instruction in the card says the agent "sets up its own encrypted drive", so the two paths are not obviously the same thing (the agent device flow makes a new drive rather than using this one).
- Re-entered data: none.

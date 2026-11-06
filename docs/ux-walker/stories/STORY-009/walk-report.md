# STORY-009 walk report (ux-walker-a, fresh user e2e_walkera6, CLI config isolated under scratchpad/walka/cfg2, backup file under scratchpad/walka/bk)
Result: PASS. Whole path completed; every CLI step behaved as the story says. The "agent" steps were run by me in a shell with `--api http://localhost:3500/api`, a prefix install under the scratchpad (no global install) and `skill install --target <scratch dir>`.
1. Landing hero Copy (step-1-copy.png): button text changes to "Copied" (status region reads "Copied"). The button grows from ~70px to ~82px and shifts left (small layout shift). Hero also has a second, differently styled "COPY" chip for the npm line (outlined small caps vs orange solid): two copy styles in one block.
2-3. /llms.txt reads clearly; steps 1-6 match the story. Note step 2 says "There is nothing else for the human to choose" while /connect shows the delegate checkbox and "Add to an existing drive instead".
4. `agent-drive login --name claude-code --no-browser`: printed link, matching code, "Waiting for approval...".
5-6. /connect (step-6-connect.png): same layout as STORY-006; delegate help text ~3px above Approve (cramped, same finding). Geometry audit clean; 390px view in mobile-check-connect.png fine.
7. Approve agent -> "Approved" (step-7-approved.png). CLI finished on its next poll: "Logged in as agent claude-code ... New drive 18988b7b-... created; its key is saved in the config file." plus the backup hint.
8. `agent-drive check` before backup: "drive key not backed up: <id>" with the same hint, as designed.
9. `credentials export --to <file>`: "Backed up credentials for 1 drive(s) (file)."
10. `skill install --target <dir>`: "wrote .../SKILL.md".
11. `agent-drive check`: "check ok drive=18988b7b-...". 

## Flow log
- Ideal 4 human steps; actual: Copy, (paste to agent), open link, Approve = 4. No extra detours; no data re-entry.
- Hesitation: the human has no on-page confirmation that setup finished; the Approved card says "Return to your agent" only. Two windows to watch (as the story notes).
- Duplicates: the pairing code is shown in the page, in the card, and in the terminal (intended cross-check).

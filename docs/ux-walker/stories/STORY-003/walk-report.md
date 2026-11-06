# STORY-003 walk report (ux-walker-a, fresh user e2e_walkera3)

Result: PASS with findings. Drive named "Research notes" created (synthetic, throwaway; recovery key not saved to disk).

1. /console empty account (step-1.png): "Opening your workspace..." then onboarding card "Give your first agent a home." with orange "Create your first drive", steps 01/02/03 as plain text (not links). Header also shows an outlined "+ New drive". Audit: clean (step row widths are text-length noise). The paste-one-line agent route from the landing page is not mentioned on the card (gap confirmed).
2. Click Create -> dialog "CREATE A DRIVE" (step-3-dialog.png): explanatory text, "Drive name" prefilled placeholder, full-width orange button. Clean.
3. Type "Research notes", Create -> key receipt "YOUR DRIVE. YOUR KEY." (step-4-receipt.png). Escape does not close it (as stated in the story). Large black block for a one-line 43-char key; small Copy button under it; full-width Save recovery key; warning; checkbox; disabled Continue. Behind the modal the drive strip and a red banner are already visible.
4. Ticked checkbox without pressing Save recovery key (allowed), clicked Continue -> Files tab (step-6-drive.png). Banner immediately says "This drive's key hasn't been backed up... Ask the agent to run agent-dr..." with the command truncated by ellipsis; a "KEY LOADED" chip. Empty state "Ready for your first file." with "Connect an agent" button. Audit clean (strip widths intentional).
5. Click "Connect an agent" -> API keys tab (step-7-apikeys.png). Unlike the story text, this tab DOES show the "Connect an agent" panel with the copyable line, then "Agent access: Create an agent first." with "Create agent". So the gap in the catalog is partially closed, but the same panel now appears on two tabs. Audit hit "summary Connect an agent" is a false positive (summary is a heading-like control).
6. Agents tab (step-8-agents.png): same panel plus "Agent identities: Who's doing the work?" and "Create your first agent". Three orange primary actions compete across the tab (+ New agent, Create your first agent; the copy line itself is secondary).
   Mobile (mobile-check.png, Agents tab): the llms.txt URL in the code block breaks mid-word as "llms.t / xt". Otherwise stacks cleanly, no overflow.

## Flow log

- Ideal 3 steps (create drive, save key, continue). Actual: 4 clicks plus typing (open dialog, create, tick, continue). Fine, the extra is the acknowledgment.
- Hesitation 1: the onboarding card offers only the browser-drive route; the line promised by the landing page is not there.
- Hesitation 2: after ticking "I saved my drive key securely", the very next screen says the key has not been backed up (different concept: backup recorded by the agent/CLI vs browser save), which reads as a contradiction.
- Duplicate: "Connect an agent" panel on Agents and API keys tabs; Files-empty "Connect an agent" button lands on the API keys tab, not the Agents tab.
- Concept duplication: browser-created drive (key in browser) vs agent-created drive (key on agent machine) not explained.

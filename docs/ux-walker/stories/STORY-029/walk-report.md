# STORY-029 walk report (lane B)

Result: PASS with findings. Banner explains the problem, but the human's quickest fix is hidden until the key is loaded, and the visible command belongs to the agent's machine.

Data: user e2e_walkerb_new. Drive "Research workspace" (human-created, one file, unbacked) and drive "agent-made" (created through the real device-flow login /connect by a CLI agent, unbacked). Agent steps used an isolated AGENT_DRIVE_CONFIG.

1. Files tab, unbacked drive, no key loaded (screenshots/step-1-banner.png, step-1b-agent-made-drive.png): red banner "This drive's key hasn't been backed up. If the agent's machine is lost, these files can't be opened. Ask the agent to run agent-drive credentials export" with a single "Copy" button (aria "Copy credentials export command"). Text fits at 1280px in this state. The reader has no action of their own here; the "Download recovery file" button is not shown until a key is loaded.
2. Clicked Copy: label turns "Copied" for a moment (step-2-copy-clicked.png). Clipboard cannot be read in the headless browser, so the copied text is not verified. The banner only says "agent-drive credentials export" (no --to/--stdout) so it does not even give the full command.
3. Agent side: `credentials export --stdout` then `credentials confirm` on the agent-made drive: CLI says "Recorded the credential backup for 1 drive(s) (stdout)". Console banner BEFORE Refresh is unchanged (step-3-before-refresh.png).
4. Clicked Refresh: banner becomes "Key backed up 11/6/2026 (stdout)" in a single neutral line (step-4-after-refresh.png). The LED beside it is still orange-red, the same colour as the warning state (catalog says dimmed).
5. Variation: loaded the key from the recovery file on the other drive (var-banner-with-download-btn.png). "Download recovery file" appears and now the banner text is clipped with an ellipsis after "Ask the agent to run agent-dr…" (scrollWidth 887 vs clientWidth 736); the key command is the cut part. Clicked it with download capture: file saved, 145 bytes (scratchpad/dl-b/files/recovery-var.json); notice "Recovery file saved. Store it in a password manager or another secure location."; banner became "Key backed up 11/6/2026 (file)" immediately (var-after-download.png).
6. Mobile 390x844 (mobile-check.png): banner wraps to full text, buttons below; fine. Geometry audit: only intentional unequal widths.

## Flow log

- Ideal 2 steps; the quickest path for a human who has the key is: Load drive key (3 actions) then Download recovery file = 4 actions, and nothing in the banner tells her that.
- Hesitation: "Ask the agent to run" is addressed to someone else; the Copy button invites pasting into her own terminal (wrong machine).
- Not verified: the copied clipboard text; banner dimming (LED colour is orange in both states).

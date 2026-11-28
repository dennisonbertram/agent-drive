# SETUP-040 walk report: Lena keeps a client drive out of passphrase unlock

User `e2e_owner_keys_7` (passphrase set after a reset in the SETUP-038 walk, unlocked with the generated passphrase). NOT WALKABLE: steps 5-6 (agent `login`, "Use one of my drives instead" with the agent-only drive, `account seal` printing `agent-only`) because device-flow login stayed rate limited (`Agent Drive refused the login request: slow_down`) for the whole run; the CLI route `drive create --name client-exports2 --agent-only` was refused for the available agent key ("The API key lacks the "manage" scope. Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope."). Step 8 (choose the saved file) not walkable (file picker).

## Steps
1. Drive menu (step-1.png): lists Traces, Capture traces..., the drives, Drive ID + Copy, and "New drive". "Traces" and "Capture traces..." appear as items inside the drive menu, above the drives.
2. Dialog "Create a drive" with name "client-exports" and the ticked checkbox "Agent-only - never add this drive to passphrase unlock" (step-2.png). No explanation of why or the consequence for opening the drive later.
3. Create drive, receipt, Download recovery file and continue, I saved it (step-3.png): notice "Recovery file saved. Store it in a password manager." Drive picker reads "client-export..." (truncated).
4. Key chip right after creation (step-4.png): "Unlocked. This drive's key is loaded in this tab." Fingerprint d845 ed60 45b1 0d10, "Key backed up 11/27/2026 (file)", Download recovery file again, Lock, Lock this browser, Add a passkey, Change passphrase, Forgot or exposed passphrase?. After a reload (step-4b-after-reload.png): "Unlocked. This drive is agent-only - only its recovery file opens it." The green "Unlocked" chip is shown for a drive that cannot be opened without the file, and "Download recovery file again" has disappeared while the line above still says "Key backed up ... (file)". The drive menu (step-4c-drive-menu.png) shows `client-exports` and `jo-notes` with identical row styling and no agent-only marker.
7. Chip menu > Load key (step-7.png): "Load the key for CLIENT-EXPORTS ... No recovery file? Ask the agent that created this drive to run `agent-drive credentials export`, then choose or paste what it gives you." Lena created the drive in the browser, so "the agent that created this drive" is wrong. The story's "Agent-only: open with a recovery file." note did not appear (it comes from clicking a file, which was not possible in an empty drive).
Mobile: not separately run (same dialogs as SETUP-039/042, which fit).

## Flow Log
- Ideal 9 steps; walked 1-4 and 7 of them.
- Hesitations: checkbox wording; chip says Unlocked for an agent-only drive; no marker in drive menu.
- Duplicated info: fingerprint again in the menu; "Key backed up (file)" plus missing re-download button.

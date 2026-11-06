# STORY-056: Owner adds a second agent to the existing drive in the browser — walk report

Result: PASS (goal achieved; every story step worked) with several polish findings. Agent "walker-c-bot" (machine ux-wc) was a throwaway created with `ad wc login --name walker-c-bot --no-browser` (isolated config cfg-wc.json); it was added to the research-bot drive in the browser. Not revoked afterwards (it is a test identity).

## Steps

1. CLI printed link /connect?code=JDDT-TPLR and "Waiting for approval...".
2. /connect (step-2-connect.png): pairing code first (large mono), instruction text, heading "Connect walker-c-bot?", table AGENT / MACHINE / ACCOUNT ("Local test session") / REQUESTED, a grey note "This agent gets its own encrypted drive...", link "Add to an existing drive instead", delegate checkbox with hint, orange "Approve agent", footer "You can revoke access any time in Console, Agents." Geometry audit clean. The Approve button fits in the 800px viewport here. Hint text above the button is 11px from it (other gaps are about 24px).
3. Clicked "Add to an existing drive instead" (step-3-existing.png, step-3b-existing-bottom.png): fields Drive (select, defaults to nightly-builds, the first drive alphabetically), "Drive key or credentials bundle (adcred1.…)", a native file input ("Choose File / No file chosen"), hint text, Read only, "Only allow writes under (optional)", link "Use a new drive instead", delegate checkbox, Approve. Banner text changes to "You are giving walker-c-bot on ux-wc the key to this drive...". The form is about 1.5 screens tall; Approve is below the fold at 1280x800 (needs a 600px scroll). Geometry audit clean.
4. Empty key (var-empty-key.png): "Paste the drive key or choose a recovery file." appears in an orange-edged box directly above Approve, 450px below the first field, and pushes the button down; focus stays on the button.
5. Wrong file (var-wrong-file.png): selected research-bot but supplied nightly-builds-recovery. Message: "The bundle does not contain a key for this drive." (The catalog quotes "This recovery file does not belong to the selected drive"; the copy has changed. The word "bundle" is jargon for someone who picked a "recovery file".)
6. Correct file for research-bot, Approve (step-5-approved.png): card "PAIRED / Approved / Approved. Return to your agent; it will finish setup on its own." The heading and the first words of the body say the same thing; there is no link back to the console.
7. CLI finished: "Logged in as agent walker-c-bot. Usable drives: 63e2243b-... Scopes: read write delete share" (id only, no drive name). `check` first said "drive key not backed up ... Until then `agent-drive check` will not pass."; after `credentials export --to FILE` it printed `check ok`. Matches the story.
8. Console, Agents (step-7-agents.png): walker-c-bot listed with "1 ACTIVE KEY". Geometry audit: only intentional unevenness (tile strip, header buttons); `summary "Connect an agent"` flagged as a wrapped control but it renders on one line. Rows with "issued by research-bot" are about 22px taller than rows without. "Revoke access" is enabled for old-laptop and trace-a, which already have 0 active keys.
9. Mobile 390x844 (Agents tab; mobile-check.png): rows stack, Revoke full width, no overflow. The connect page at 390 is covered in STORY-057.

## Flow log

- Story ideal path 4 (login, open link, pick drive + key file, approve). Actual: login, open link, click the small link, change select, choose file, Approve = 6 interactions plus scroll. Hesitations: (a) finding the "existing drive" link (it is a small underlined link under the grey note); (b) which of the two key inputs to use; (c) why the pasted-key path cannot be validated.
- Re-entry: the user must locate a recovery file even though the console in the same browser may already hold the key (it was loaded in the earlier story; the connect page did not use it).
- Redundancy: "Local test session" account and "Console, Agents" revocation hint repeated; the pairing code is shown above and the same agent name appears in the heading and the table.

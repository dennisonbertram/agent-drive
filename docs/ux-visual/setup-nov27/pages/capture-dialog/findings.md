# Capture traces dialog — visual findings

(Recorded from the inspector's returned text; its own write was blocked.)

Counts: P0 0, P1 2, P2 8, P3 7 (17 total). findings.md was NOT written: the Write tool refused it ("Subagents should return findings as text, not write report files"), so the full findings table is below and I did not work around the block. Shots (38 png) and audit.json / audit.ndjson (16 entries) are in /Users/dennison/develop/agent-drive-ux-setup/docs/ux-visual/setup-nov27/pages/capture-dialog/ (shots in shots/).

5 worst:
1. CD-01 P1 (measured+observed): token-shown state overflows at 375x812 (scrollH 964 vs 786) and 1280x800 (807 vs 750); the "leave Privacy Mode off... or traces will contain no prompts or replies" warning and the Headers value fall below the fold with no scroll cue (shots/375-token-vp.png, shots/1280-token-vp.png). L1/L2/C3.
2. CD-02 P1 (observed): the once-shown token is lost on a single Escape press with no confirm or "I copied it" step; reopening shows only "Created today 19:28 / Active / Replace / Revoke" (shots/1440-token-vp.png vs shots/1440-saved-vp.png). I3.
3. CD-03 P2 (measured+observed): `dialog{overflow:auto}` scrolls the whole dialog, so the heading and x button scroll away (heading position static, top -141 px) and touch users lose the visible Close (shots/375x480-saved-scrolled-vp.png). I7/A2.
4. CD-04 P2 (observed): locked-state "Add webhook"/"Replace" silently discards the Capture dialog for "Load the key for X"; the dialog shows no key status (identical locked vs unlocked) and Escape from unlock does not restore it (shots/1440-locked-vp.png, 1440-unlocked-vp.png, 375-replace-locked-vp.png). C3/I6.
5. CD-07 P2 (observed): four entry points ("Traces", "Capture..." in toolbar; "Traces", "Capture traces..." in drive menu) with drifting labels; at 375px the only path is a plain-text-looking row in the drive switcher (shots/1440-drive-menu-vp.png, shots/375-drive-menu-vp.png). C1/C2/H5/I1.

Remaining findings:
- CD-05 P2 (M): touch targets under 44px: Copy 49x28 at all viewports, Close 32x32, Replace 87x43, Revoke 50x32 at 768 (audit.json dialogMeasure.smallTargets). I4.
- CD-06 P2 (O): centred dialog changes height by state, so the title jumps at 1440x900: y=257 loading, 251 error, 222 saved, 75 token. L5.
- CD-08 P2 (O): the intro is one 51-word paragraph with vague caveats ("capture may be disabled, uploads may be queued, or calls may not be captured"). It gives no command for "load this drive's key on your agent's machine first", names Codex but offers only a `-- claude` command, and the commands are not numbered. C1/C4.
- CD-09 P2 (O): in token state the Active/Replace/Revoke row sits above the secrets, and the heavy Replace button outweighs the urgent Copy buttons; this pushes Headers off screen at 375. H1/H2.
- CD-10 P2 (S, source only, Replace not run unlocked): Replace has no confirm or consequence text and probably invalidates the live token. I3.
- CD-11 P3 (O): Revoke confirm puts focus on the destructive button, says nothing about consequence, and adds a row (dialog +18px).
- CD-12 P3 (O): "Retry" uses danger red (share-revoke class) for a harmless action, and the error gives no reason (shots/1440-load-error-vp.png).
- CD-13 P3 (O): "Active / Created" cannot show whether any trace was ever delivered.
- CD-14 P3 (O): section labels are 11-12px muted mono, the same as the title, so there is no heading step.
- CD-15 P3 (O): initial focus ring lands on "Copy install command".
- CD-16 P3 (O): unlock dialog says "you can set up the OpenRouter webhook" after the user clicked Replace.
- CD-17 P3 (M): dialog gutter is 19px at 375, off the 16/24 scale.

Verdict per viewport x state (locked / unlocked / token shown / saved row):
- 1440x900: pass / pass / pass with CD-02, CD-09 / pass.
- 1280x800: pass / pass / FAIL CD-01 (inner scroll, last paragraph clipped) / pass.
- 768x1024: pass / pass / pass / pass.
- 375x812: pass with CD-05, CD-17 / pass with CD-05 / FAIL CD-01, CD-03 / pass with CD-05.
No horizontal overflow at any viewport. layout-audit found 0 low-contrast items and 0 off-screen primary actions in all 16 shots. Page scroll was 0 everywhere, so full-page shots equal viewport shots in size. Extra shots: 1440-drive-menu, 375-drive-menu, 1440-revoke-confirm, 1440-loading, 1440-load-error, 375-replace-locked, 375x480-saved-scrolled, 1440-replace-hover.

Excellent as is (measured/observed):
- Locked, unlocked and saved states fit with no inner scroll at 1440, 1280 and 768; token state fits at 1440 and 768.
- Long drive command wraps inside its box with no overflow (no `code` overflow, pageScrollX 0).
- Contrast is clean in the audit.
- Tab order is logical with a 2px focus ring on every control.
- Escape closes, and focus returns to the "Capture..." button after a real click.
- Cancel on the revoke confirm returns focus to Revoke.
- Per-field Copy with a "Copied" state; loading and error-with-Retry states exist.
- Inline two-step Revoke with Cancel.
- One orange primary action per state.

Method caveats:
- The agent-browser tab was repeatedly navigated, resized or relaunched by other processes during the run (URL turned to 127.0.0.1, about:blank, viewport changes). Wrong-state shots were deleted and retaken; every kept state was verified in an uninterrupted script.
- Not exercised: failing "Add webhook" request, stale "Needs replacement" token, Replace while unlocked, and the unlock-then-resume path.
- Two early locked shots (1440, 375) showed "Copied" on the install button before any click; not reproduced, not counted.
- audit.json layout/geometry entries are parsed from the eval output; geometry "wrappedControls" hits (Browse/Recent/Shared, nav items) are page content behind the dialog, not the dialog.
- Test secret never printed. The throwaway local webhook token appears inside the *-token-* screenshots only.
- Created drives my-drive, capture-drive and cap-mwzo8nn2 (with one webhook token) on the throwaway account e2e_vis_capture_dialog_1; nothing deleted.
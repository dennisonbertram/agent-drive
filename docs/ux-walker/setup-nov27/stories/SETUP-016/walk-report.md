# SETUP-016 walk report: first approval, happy path
Target: http://localhost:3811 (release 0.5.1 copy), CLI on the Mac Studio, test session user e2e_approve_connect_016.
Note: the brief's `AGENT_DRIVE_API_URL=http://localhost:3811` makes the CLI fail with "Agent Drive refused the login request: 404"; the CLI needs `http://localhost:3811/api` (the docs say so). Used the `/api` form.

## Steps
1. CLI `agent-drive login --name priya-claude --no-browser` printed: `Open this link to approve: http://localhost:3811/connect?code=NPLS-GKVC`, `Check that the code matches: NPLS-GKVC`, `Verification code: cb0b 83f3 2958 c383`, `Waiting for approval...`. Opened the link in the signed-in browser. Screenshot screenshots/step-1.png: card "PAIRING REQUEST", h1 "Connect priya-claude?", "New encrypted drive · full access", collapsed Details, explanatory paragraph, "Does this code match your terminal?" with the large code, Verification code field, one dominant orange "Approve agent" button, "You can revoke access any time in Console, Agents." Geometry: no overflow, no uneven rows; the only wrapped-control hit is the `Details` summary (false positive, it is one line). Console and errors: clean. At the default 1280x577 first-load viewport the footer line is clipped; at 1280x800 everything fits.
   LOOK: clear single primary action. "Console, Agents" in the footer is plain text, not a link.
2. Typed `cb0b 83f3 2958 c383`, clicked Approve agent. screenshots/step-2.png: "APPROVAL SAVED", "Access approved for priya-claude", "You approved priya-claude to read, write, delete and share its new drive. Return to your agent to finish setup and confirm it is ready.", `Open console`. Geometry clean (hit on `Open console` is a false positive, single line). The status dot is the only "success" cue; no check mark or green.
3. CLI within about 6 s printed `Logged in as agent priya-claude.`, `Usable drives: ...`, `New drive <id> created; its key is saved in the config file.`, the backup hint and `Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then.`
4. Mobile 390x844 of the done card: screenshots/step-3.png. Heading wraps `priya-` / `claude` at the hyphen; no horizontal scroll (scrollWidth 390).
5. Clicked `Open console`: screenshots/step-4.png. Files view with drive `priya-claude`, chip "Key needed · Not backed up", header text "Set a passphrase and agents will add every drive's key to your account ... Set up". The nav has no item named "Settings", although the CLI says "Set a passphrase in the console under Settings".

## Flow Log
- Steps specified in story: 4 (read code, type, approve, return to terminal). Steps needed: 4 (plus one visit to the terminal to read the verification code). Matches the Ideal path.
- Hesitations: none on the page. After approval the page does not say the CLI polls every ~5 s or that the code lifetime is 10 minutes (observed: the CLI finished in ~6 s).
- Re-entry: the verification code must be typed by hand though the CLI opened this page itself (by design).
- Duplicated info: the pairing code appears in the CLI line 1 (URL), line 2, and the large code on the page (by design; the URL already carries it).
- Verdict: PASS with low findings.

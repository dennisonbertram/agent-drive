# SETUP-045 walk report (short): Revoke a leaked sandbox key

Used the account from SETUP-044 (agent ci-file stood in for ci-nightly because only the ci-file bundle was saved to a sandbox; ci-nightly was opened in the key dialog and cancelled). Status: PASS with findings.

## Steps
1. Console, Agents tab (step-1): rows with `1 ACTIVE KEY` and `Revoke access`. Clear, 1 click to the dialog.
2. Click `Revoke access for ci-file` (step-2): dialog title "REVOKE ACCESS FOR CI-FILE?" (rendered all caps, which changes the agent name's case), body "1 active API key stops working now. Commands and MCP sessions that use it fail at their next request. Files this agent wrote stay in your drives." Buttons Cancel (focused) and red `Revoke 1 key`. Geometry: no overflow.
3. Confirm (step-3): toast "Revoked access for ci-file." bottom-left, row badge becomes `ACCESS REVOKED`, button gone. Header badge still reads `3 AGENTS`. 3 actions, matches the Ideal path.
4. API keys tab (step-4, step-5): revoked key shows `REVOKED` and a disabled Revoke button. Alternate dialog title "REVOKE CI-NIGHTLY (ISSUED BY DENNISONS-MAC-STUDIO.LOCAL)?" body "Commands using this key stop working at their next request. This cannot be undone." Wording differs from the agent dialog (this one says "cannot be undone", the agent one does not).
5. Mobile 390x844 (step-6): dialog fits, buttons full width, no overflow.
6. What the revoked sandbox sees (CLI, bundle in env): every command prints `Warning: could not report the key backup for drive <id> to Agent Drive.` then `The API key is invalid or revoked.` The first line is about key backups, which misdirects; there is no instruction for the agent (e.g. ask the owner for a new bundle).
7. Laptop agent unaffected after the revoke: `whoami` still works.

Browser errors: none.

## Flow Log
- Ideal 3, needed 3. No hesitation on the web path.
- Gaps: dialog does not say the drive key inside the leaked bundle remains known to the holder (cannot be rotated here); revoked row cannot be removed and still counts in `3 AGENTS`.

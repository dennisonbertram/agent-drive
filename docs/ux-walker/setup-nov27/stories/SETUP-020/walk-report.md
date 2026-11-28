# SETUP-020 walk report: code does not match, no Deny button

User e2e_approve_connect_020, request `dev-box-3`, code `BTTC-WMTZ`.

## Steps

1. Opened the link. screenshots/step-1.png: "Connect dev-box-3?" and large code BTTC-WMTZ under "Does this code match your terminal?" with "If it does not, close this page; the request expires on its own." The interactive elements are: logo link, Details toggle, delegate checkbox (inside Details), Verification code, Approve agent. There is no Deny, Reject or Cancel control. (DOM check of buttons/links: "Agent Drive | checkbox | Approve agent".) Geometry clean.
2. Looked for another route to refuse: opened console > Agents (screenshots/step-2.png, step-3.png). With the request pending the Agents page lists "0 AGENTS" and "Create your first agent"; the pending request is not shown and cannot be denied there either.
3. Closed the page: the request stays pending in the CLI ("Waiting for approval...") until it expires. I later approved this request in SETUP-024 to confirm it was still live, so closing the tab does not cancel it. A user who suspects phishing has no way to tell the CLI owner it was refused.
4. Footer "You can revoke access any time in Console, Agents." is plain text, not a link.

## Flow Log

- Steps specified: 1 (close the page). Steps needed: 1; ideal path honored but is a dead end by design.
- Hesitations: the user must decide the code is wrong by comparing; the safe action (close tab) is described only in small grey text.
- Re-entry: none. Duplicated info: none.
- Verdict: PASS for the documented behavior; finding for the missing refuse control.

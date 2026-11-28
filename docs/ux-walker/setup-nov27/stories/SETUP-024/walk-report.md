# SETUP-024 walk report: code expired, already used, or rate limited

Walked with a real expiry (request created 19:04:23, approved at 19:14:40) and with an already-used code. Test-session users: e2e_approve_connect_020 (used code) and e2e_approve_connect_024 (expired code).

## Steps

1. Already used: approved request `dev-box-3` (`BTTC-WMTZ`) with a double-click on Approve. Only one approval posted (the CLI printed `Logged in` once). Reopened the same link: tag "NO PAIRING", "Connect an agent", code BTTC-WMTZ pre-filled, error "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." with `agent-drive login` styled as code (screenshots/step-1.png). A code with one letter changed (BTTC-WMTX) gives the same message.
2. Expired while the tab stayed open: request `hana-expire` was left open for 10 minutes; the CLI printed `The login code expired. Run `agent-drive login` again.` The page still showed the live approve form. Typed the correct verification code and clicked Approve: banner "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." (screenshots/step-2.png). Here the backticks are literal characters, unlike the entry card where the command is styled as code. The form stays enabled with the typed code kept, and "If it does not, close this page; the request expires on its own." is still shown after expiry. The banner sits between the paragraph and the code row and pushes the form down by about 75 px.
3. Reopened the expired link: entry card, tag NO PAIRING, same "wrong, expired, or already used" text. Mobile 390x844 (screenshots/step-3.png): no horizontal scroll, input and Continue full width.
4. Not walked: the on-page "Too many device code attempts" message (needs 30 calls in 10 minutes). A different rate limit was hit on the CLI side (see SETUP-021: `slow_down`).
5. Not walkable: session expiry while the page is open (Clerk 401 redirect).
   Geometry: no overflow or uneven rows. No browser console errors.

## Flow Log

- Steps specified: 4 (rerun login, open new link, type new code, approve). Steps needed: 4. Recovery is clear because both messages name the command.
- Hesitations: no countdown or expiry time on the page; the user learns of expiry only after typing the code and clicking Approve.
- Re-entry: a new verification code is needed each time (documented).
- Duplicated info: the same recovery sentence in two forms with different wording and styling.
- Verdict: PASS with low findings. Double-click protection works.

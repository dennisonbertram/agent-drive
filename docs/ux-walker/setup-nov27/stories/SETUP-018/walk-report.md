# SETUP-018 walk report: signed-out arrival from the CLI link

Real Clerk sign-up/sign-in forms are not available on this copy, so account creation itself is NOT WALKABLE. Walked: the signed-out redirect, the redirect parameter, the sign-in/sign-up switch, then resumed as a new test-session user.

## Steps

1. Cleared cookies, opened `/connect?code=NXXX-DVKZ`. Redirected to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DNXXX-DVKZ` (screenshots/step-1.png). The page shows a site header (Pricing, Docs, Sign in, Sign up free), a card "Sign in" with "Sign-in is not configured on this installation" and "New here? Sign up free". Nothing on the page says why the user is here or that an agent approval is waiting (with real Clerk this cannot be confirmed). Geometry: the nav items are reported as wrapped controls (hits on `Pricing`, `Docs`, `Sign in` with widths 44/33/43); the screenshot shows them on one line, so false positives.
2. The footer link "Sign up free" has href `/sign-up?redirect_url=%2Fconnect%3Fcode%3DNXXX-DVKZ` (and so does the header button). Followed it: URL kept the redirect (screenshots/step-2.png, "Create your account", "Already have an account? Sign in"). Redirect survives the sign-in/sign-up switch: PASS (hrefs and URL checked; Clerk's own handoff after sign-up not walkable).
3. Became a new user (test session 018) and opened the link again: "Connect tomas-codex2?" card (screenshots/step-3.png). Opened Details (screenshots/step-4.png): Machine `Dennisons-Mac-Studio.local`, Account `Local test session`, Drive, Access, Writes, Requested `11/27/2026, 6:04:28 PM` (no timezone), the delegate checkbox, then the paragraph, the code, the verification field. The Approve button falls below the 800 px fold once Details is open.
4. Typed `e80c 4a8d 1a7b 429d`, Approve: "Access approved for tomas-codex2" (screenshots/step-5.png). CLI finished with `Logged in as agent tomas-codex2.`
5. Public copy check: served `docs/quickstart.md` line 35 says "check that the code matches ... and click Approve" with no verification code; the console Agents panel says "open it and click Approve"; the home page says "Your agent shows a pairing code, and you approve it in your account." A new user who read only those has no warning about the second code. `llms.txt` and `connect-an-agent.md` do mention it.

## Flow Log

- Steps specified: 7. Steps needed on this copy: 4 reachable (open link, sign-up (not walkable), back to /connect, type verification code, approve).
- Hesitations: step 4 verification code field is the first place the user learns of a second code from the page; the user must go back to the terminal.
- Re-entry: none.
- Duplicated info: header "Sign in"/"Sign up free" duplicate the card's sign-up link on one screen.
- Verdict: PARTIAL (sign-up not walkable, redirect and approval pass).

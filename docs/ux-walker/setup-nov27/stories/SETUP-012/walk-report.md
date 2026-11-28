# SETUP-012 walk report: login code expires, user runs login again

Session uxw-install-login-solo, account e2e_install_login_12. CLI homes ~/uxw/install-login-012 (expired), 012b (second concurrent request, also left to expire), 012c (the re-run that was approved). Login starts were rate-limited for ~55 minutes before these started (F-011-1), so there was no way to re-run login at the time of the first attempts.

## Steps

1. Typed an invalid code in the manual entry form `/connect?code=ABCD-EFGH` (step-1.png): tag "No pairing", the field is pre-filled and the message "Enter the code in the form XXXX-XXXX." Codes use consonants only, so ABCD-EFGH is rejected for its letters, but the message does not say that.
2. Well-formed but unknown code `BCDF-GHJK` (step-2.png) and a previously approved code `MHZL-CQMP` (step-3.png): same card, message "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." (code-styled command). Clear and actionable; one message for three different causes.
3. Started `agent-drive login --name jonas-ios --no-browser` at 19:03:42; opened `/connect?code=KWQK-DVFV` at 19:05 (step-4.png). The card shows no expiry time or countdown anywhere; "the request expires on its own" is the only hint. Left the tab open.
4. At 19:13:42 the CLI stopped by itself and printed "The login code expired. Run `agent-drive login` again." (both processes 012 and 012b, 10 minutes after start). Clear and actionable. The process exits (no process left).
5. Back in the stale tab, typed the right verification code and clicked Approve (step-5.png): the card stayed as "Pairing request" with the Approve button still active and an inline message "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." The message shows literal backticks around the command (the other expiry card renders it as code). No state change of the card (still asks for the code; header still "Connect jonas-ios?").
6. Reloaded the old link (step-6.png): "No pairing" card with the "wrong, expired, or already used" message. Mobile 390x844 (mobile-check.png) shows the "Looking up..." state of the same page, no overflow.
7. Re-ran `agent-drive login --name jonas-ios --no-browser` (new code VCCZ-DKJJ and a new verification code), approved it in a new page (step-7.png "Access approved for jonas-ios"), and the CLI finished with "Logged in as agent jonas-ios." Old code did not carry over, as expected.

## Flow Log

- Ideal 3; actual 3 after the expiry (rerun login, open new link, type code/approve).
- Hesitation: no time limit is shown before it expires (terminal prints "Waiting for approval..." only); the stale card invites a failed click rather than disabling Approve.
- Re-entry: user must retype the new verification code each time (inherent).
- Not walkable: laptop-sleep fetch failures ("Lost contact ..."), 5 network failure abort, Clerk session expiry.

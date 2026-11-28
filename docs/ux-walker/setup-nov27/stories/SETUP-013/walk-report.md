# SETUP-013 walk report: wrong verification code; no Deny

Session uxw-install-login-solo, account e2e_install_login_13, pending request `nightly-sync` NTKN-JFWN from ~/uxw/install-login-013.

## Steps
1. `/connect?code=NTKN-JFWN` (step-1.png): "Pairing request / Connect nightly-sync? / New encrypted drive · full access", Details collapsed, "Does this code match your terminal?" with the 8-letter code, `VERIFICATION CODE` field, one dominant `Approve agent`, footnote "You can revoke access any time in Console, Agents." LOOK pass; no Deny/Cancel button anywhere (only text: "If it does not, close this page; the request expires on its own."). Interactive elements: Details, delegate checkbox (inside Details), input, Approve. Geometry: overflow 0.
2. Opened Details (step-2.png): Machine "Dennisons-Mac-Studio.local", Account "Local test session" (a real account would show an email here), Drive, Access, Writes, Requested, plus checkbox "Let this agent add other agents to its drives". With Details open at 1280x800 the Approve button falls below the fold (needs scrolling). The account row is hidden until Details is opened.
3. Typed a wrong code `2b1a 4c4b 82b6 953e` (step-3.png): red inline message "This code does not match the one your agent printed. Check the terminal again and type it exactly." Input keeps the text and gets a red border; focus stays in field. Clear.
4. Variations: 12 hex chars without spaces -> "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." (shape message while the user typed an incomplete code; wording suggests spaces are required but they are not); `hello` -> same message.
5. Correct code typed as `2B1A4C4B82B6953F` (upper case, no spaces) was accepted: "Access approved for nightly-sync" (step-4.png). CLI then printed "Logged in as agent nightly-sync." etc.
6. Mobile 390x844 (mobile-check.png): no overflow, error message wraps fine, but the verification input is ~170 px wide, so the 16-character code is cut off in the field (F-009-2).

## Flow Log
- Ideal 3 (read card, type code, approve); actual 4 (a typo costs one extra attempt).
- Hesitation: the page labels the 8-letter code as the thing to compare ("Does this code match your terminal?") while the real secret check is the 16-hex verification code; a wrong 16-hex code is rejected before approval (good). No way to refuse in the UI; the only instruction is to close the page.
- Not walkable: the API-level deny route (no UI), Clerk multi-account.

# STORY-010 walk report (ux-walker-a, new user e2e_walkera7, CLI config scratchpad/walka/cfg3, code XZHZ-CLJG)

Result: PASS with findings. Clerk is unset, so the real Clerk sign-up link and whether it keeps redirect_url could NOT be tested; I simulated "sign-up finished, Clerk dropped redirect_url" by creating a new test user and opening /console.

1. Signed out, opened the printed link -> /sign-in?redirect_url=%2Fconnect%3Fcode%3DXZHZ-CLJG; card is "Sign-in is not configured" with no sign-up link (env).
   2-3. Test sign-in as brand-new user, went to /console (step-4-console-no-hint.png): shows "Give your first agent a home." onboarding with no mention of a pending request (confirmed via snapshot: no "pending", "waiting" or code text). Geometry audit: clean (step labels noise). The user has an agent waiting for approval in a terminal and the console gives no sign of it.
2. Opened /connect with no code (step-nocode.png): "Connect an agent / Enter the code your agent printed after running agent-drive login." field + Continue. Audit clean.
3. Typed "aeiou-1234" (vowels) -> inline notice "Enter the code in the form XXXX-XXXX." (step-badcode.png). The notice sits ABOVE the field it refers to and does not say the code uses consonants only.
4. Typed lowercase without hyphen "xzhzcljg" -> accepted, showed "Connect codex?" (normalisation works as story says).
5. Approve agent -> "Approved"; CLI then printed "Logged in as agent codex", new drive created (the agent drive, no console step required).
   Mobile 390x844 (mobile-check.png): clean.

## Flow log

- Ideal 3 steps (sign up, auto-return, Approve). Actual with simulated dropped redirect: link, sign-in, console, re-open the link or type the code, Approve = 2 extra steps. With a surviving redirect_url it would be 3.
- Hesitation: new user landing on /console sees nothing about the pending code; /connect without a code is reachable only by knowing the URL (no nav link from the console; the Agents tab has no "I have a code" field).
- Duplicate/inconsistency: none.

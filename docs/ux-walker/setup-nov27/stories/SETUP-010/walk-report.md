# SETUP-010 walk report: new user follows the CLI link while signed out

Session uxw-install-login-solo, account e2e_install_login_10 (test session, entered only after the sign-in screens). CLI home ~/uxw/install-login-010, `login --name "tomas-laptop codex" --no-browser`.

## Steps

1. CLI printed link `http://localhost:3811/connect?code=KHSP-BDBQ`, "Check that the code matches", "Verification code: a5c3 2351 367f 992c", "Waiting for approval...". (Auto-open of a browser: not-walkable, not a TTY.)
2. Opened the link with no session. Redirected to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DKHSP-BDBQ` (step-1.png). Title "Sign in | Agent Drive". Here Clerk is replaced by "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access." so the real Clerk card, email entry and verification are NOT WALKABLE. What is visible: header has an orange `Sign up free` button (href carries redirect_url) and below the card "New here? Sign up free · Pricing · Docs". Nothing on the page says the user is here to approve an agent, and no mention of the pending code. Geometry: overflow 0; nav row flagged only by width variance of text links (intentional); wrappedControls hits are false positives.
3. Clicked `Sign up free`: `/sign-up?redirect_url=%2Fconnect%3Fcode%3DKHSP-BDBQ` (step-2.png): "Create your account" + (Clerk not configured note) + "Already have an account? Sign in · Pricing · Docs". The redirect_url survives the sign-in to sign-up hop (verified hrefs). Mobile 390x844 (mobile-check.png): menu + orange Sign up free, no overflow.
4. Simulated finishing sign-up with a test session, then opened `/connect` with no code (step-3.png): "Awaiting code / Connect an agent / Enter the code your agent printed after running `agent-drive login`." Field `XXXX-XXXX`, `Continue`. Clean, focused field.
5. Typed `khspbdbq` (lowercase, no hyphen) + Continue (step-4.png): accepted, shows "Connect tomas-laptop codex?" card. URL stays `/connect` (code not in the URL, so reload loses it).
6. Typed verification code, Approve (step-5.png): "Access approved for tomas-laptop codex" (title wraps to 2 lines at 1280, fine). CLI finished with "New drive ... created".
7. Signed-out `/console` goes to `/sign-in` with no redirect_url (as documented); signed-out `/connect?code=ZZZZ-ZZZZ` (unknown code) still bounces to sign-in before saying the code is wrong.

## Flow Log

- Ideal path 9 for a new user; actual (Clerk steps assumed): link -> sign-in (wrong form for a new user) -> click Sign up free -> Clerk sign-up -> email verify -> /connect -> type code -> Approve. Matches ideal but the first screen is a sign-in form.
- Hesitation: a brand-new user lands on "Sign in" with no explanation; only the header orange button and a small line below say how to register. `/connect` always chooses sign-in over sign-up.
- Re-entry: none if redirect_url survives (not verifiable without Clerk). Duplicated: two `Sign up free` links on one screen (header + under card), harmless.
- Not walkable: Clerk sign-in/sign-up forms, email verification, whether redirect_url survives verification, Chrome auto-open, 10-minute expiry after slow sign-up.

# Walk report PROD-04: Sign-up, sign-in and bare /connect (look only)

Story reference: SETUP-006 (signed-out part), SETUP-003 (look only). Target: https://agentdrive.xyz release 0.5.1, signed out, viewport 1280x800 plus one 390x844 check. Session uxw-prod-public.

Status: partial. All three render the Clerk form cleanly at both sizes; no forms were touched. Context gaps on /connect (F-PROD-01-9) and repeated links (F-PROD-01-11). The signed-in /connect and the post-sign-up return are not-walkable without an account.

## Steps

1. Action: Open /sign-up
   Screenshot: sign-up.png
   Shows: Create your account: GitHub, Google, email, password, Continue (primary). Clean, no errors.

2. Action: Open /sign-in (also reached by redirect)
   Screenshot: step-4 screenshot in PROD-02 (step-4-choose-dev-signedout.png)
   Shows: Sign in to Agent Drive with GitHub, Google, email. 'Welcome back!' copy.

3. Action: Open /connect with no code
   Screenshot: connect.png
   Shows: Signed-out: ordinary sign-in form; header links carry redirect_url=%2Fconnect; Clerk 'Sign up' link carries redirect_url. Nothing explains what /connect is.

4. Action: Mobile sign-up
   Screenshot: sign-up-mobile.png
   Shows: Form fits, no overflow (0).

## Findings

- F-PROD-01-8 (low): Signed-out 'Choose Developer' (from /pricing) goes to /console/billing then /sign-in?redirect_url=https://agentdrive.xyz/console/billing. The return path is kept (good), but the form says 'Welcome back! Please sign in to continue' with no mention of billing or plans, and a new visitor sees 'Welcome back'.
- F-PROD-01-9 (low): Bare /connect while signed out shows the ordinary sign-in form with no explanation that this is the agent approval page or that the agent's code is needed afterwards. The signed-in bare /connect (code entry) was not walked.
- F-PROD-01-11 (suggestion): Sign-up and sign-in repeat the alternative-route link three times: header 'Sign in', card footer 'Already have an account? Sign in', and the line below the card 'Already have an account? Sign in · Pricing · Docs'.

## Flow Log

Not walked: account creation, code entry, Approve (read-only pass). Redirect return path kept for sign-up and sign-in links.

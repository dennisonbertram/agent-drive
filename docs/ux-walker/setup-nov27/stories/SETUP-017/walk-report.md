# SETUP-017 walk report: code entered by hand on bare /connect

User e2e_approve_connect_017; CLI `login --name tomas-codex --no-browser` printed `Check that the code matches: JCFC-CNNZ`, `Verification code: 3481 14b5 bcbe 7065`.

## Steps

1. Opened http://localhost:3811/connect. screenshots/step-1.png: tag "AWAITING CODE", h1 "Connect an agent", "Enter the code your agent printed after running `agent-drive login`.", field "CODE FROM YOUR AGENT" (placeholder XXXX-XXXX, focused), orange Continue. Geometry clean. No link to /connect exists in the console nav or header (reaching it by hand needs the URL; the console Agents page shows only the llms.txt prompt).
2. Clicked Continue with an empty box. Error "Enter the code your agent printed." (screenshots/step-2.png read via text; same card as step 3). The tag changes to "NO PAIRING" even though nothing was looked up.
3. Typed `jcfaaeio` (vowels). Field auto-formatted to `JCFA-AEIO`; Continue gave "Enter the code in the form XXXX-XXXX." (screenshots/step-3.png). The form is right; the letters are not allowed; the page never says which letters are used.
4. Typed `jcfccnnk` (valid letters, wrong): "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." with `agent-drive login` rendered as code (screenshots/step-4.png). Message does not say which of the three.
5. Typed `jcfccnnz`, Continue: page moved to "Pairing request" / "Connect tomas-codex?" with the same card as SETUP-016. Typed `3481 14b5 bcbe 7065`, Approve: "Access approved for tomas-codex" (screenshots/step-7.png). CLI printed `Logged in as agent tomas-codex.` and `New drive ... created`.
6. Mobile 390x844 of the pairing card (screenshots/step-6.png, step-8.png, step-9.png): the Verification code label sits beside the input, leaving the input only 168 px wide (left 189). The placeholder `a1b2 c3d4 e5f6 7890` is cut to `a1b2 c3d4 e5f6`, and when `e80c 4a8d 1a7b 429d` is typed the first group scrolls out of view (field shows `4a8d 1a7b 429d`), so the user cannot see what they typed. No horizontal page scroll (390).

## Flow Log

- Steps specified: 5 (go to /connect, type code, Continue, type verification code, Approve). Steps needed: 5. Matches ideal.
- Hesitations: the vowel error wording; no way to reach /connect from the UI; the verification code field on mobile.
- Re-entry: user types the pairing code by hand, then a second code (by design for another machine).
- Duplicated info: none new.
- Verdict: PASS with findings (medium: mobile field, low: error copy).

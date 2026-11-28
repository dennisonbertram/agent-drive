# SETUP-025 walk report: approving while signed in to the wrong account
Real Clerk accounts and email addresses are not available here (test session shows "Local test session" for every user), so noticing the account by email is NOT WALKABLE. Walked what the page offers.

## Steps
1. As a new test user (025), opened `/connect?code=ZWJR-BXZD` (request `work-pi`). screenshots/step-1.png: header holds only the logo "Agent Drive"; no account name, avatar or sign-out control anywhere on the page. Card shows no account either.
2. Opened Details (screenshots/step-2.png): Account row reads "Local test session" for this user, the same text seen for every other test user, so the row can not tell two accounts apart here. With Clerk it would show the email (per the story; not verified). The row sits inside collapsed Details, 5 rows deep.
3. Mobile 390x844 with Details open (screenshots/step-3.png): no horizontal scroll; layout OK; verification field narrow (SETUP-017-01).
4. Typed the verification code and approved: done card "Access approved for work-pi" (screenshots/step-4.png). The drive was created in whichever account was signed in. Nothing before approval warned or asked "Approve as <account>?"; the done card also does not name the account.
5. A user who already has drives sees the link "Use one of my drives instead" (seen in SETUP-022), which names none of the account either.

## Flow Log
- Steps specified: 5. Steps needed to approve: 3 (open, code, Approve) with no point where the account is confirmed.
- Hesitations: none, which is the problem: the happy path hides the account.
- Re-entry: n/a. Duplicated info: none.
- Verdict: PARTIAL (account identity not walkable; absence of an account indicator on the page confirmed).

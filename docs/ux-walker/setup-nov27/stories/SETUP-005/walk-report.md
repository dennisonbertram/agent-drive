# SETUP-005 walk report (pass with 1 bug)

Blocked /api/console via network abort. Failure card (step-1-failure.png) with error line plus "Workspace unavailable". Try again (step-2a) while still failing keeps failure card; after unblock, Try again recovers (step-3-recovered.png). BUG: clicking "Dismiss" on the error line turns the card into "Opening your workspace..." forever (step-4-after-dismiss-stuck.png) until Refresh. Mobile: mobile-check.png. Expired session: /console -> /sign-in with no return path.
Flow Log: specified 2, needed 2 on the Try again path.

# SETUP-041 walk report: Passphrase setup interrupted by the Clerk confirmation prompt

User `e2e_owner_keys_7`. NOT WALKABLE: the Clerk "confirm it's you" reverification prompt (the local test session completed setup with no prompt), so the cancel-and-retry steps (2 and 3 of the story) could not be exercised; the "Confirm it's you to set up the passphrase." message and the cleared fields were not observed. The rest was walked.

## Steps

1. Console, click "Set up" (banner link beside the Files heading). step-1.png: dialog "Set up passphrase unlock" shows a generated code "QMBP 4WDV MNX1 094C MB19" with Copy, "I saved it" box, disabled Create, and "Use my own passphrase". The dialog never says what passphrase unlock is for, beyond "If you lose it you can reset it, but every drive must be added again." There is blank space between the checkbox and the buttons (reserved status row). Disabled Create is pale; "Use my own passphrase" looks like the stronger button.
2. "Use my own passphrase" (step-2.png): fields "Passphrase (at least 14 characters)" and "Type it again" are solid black boxes with no placeholder; small print "This check only catches obvious patterns. A passphrase you made up can still be guessed by someone who copies our database. The generated one can't." The "Create" button is disabled until both fields are filled. Short input "short" then Create shows "Use at least 14 characters." in red (step-2b-short.png). Different lengths ("...2026" vs "...2026x") show "The passphrases don't match." (checked before the strength check).
3. "correct horse battery staple 2026" typed twice and Create: accepted with no strength warning, dialog closes, banner reads "Passphrase set up. Your agent can now add its drives to your account. Add a passkey Dismiss" (step-3.png). The story expected common words to be rejected; this famous phrase passed.
   Geometry: no overflow; dialog-actions buttons differ in width (content sized), expected.

## Flow Log

- Ideal 3 steps (Set up, type twice, Create). Actual 4 clicks plus typing (extra click on "Use my own passphrase").
- Hesitations: why a generated passphrase is "safer" is explained only in small print after the user chooses to type their own.
- Re-entry: not observable (reverification not available).
- After success the notice replaces the setup banner; no fingerprint or next step is shown (the user is told to have the agent add drives, but nothing says how or that a fingerprint must be pinned later).

# STORY-044: Recipient finds a link expired or revoked — walk report
Result: PASS on copy and states; two small findings. Throwaway shares created through the CLI as research-bot on /work/walkerc/a.txt and b.txt (synthetic text files); one revoked, one made with the minimum 2 minute expiry and opened after it passed. The CLI refuses expiry under 2m (message "must be between 2m and 30d"), so the "seconds before expiry" variation could not be walked.

## Steps
1. Expired link (expired.png): heading "Share link expired", body "This link passed its expiry date. Ask the sender for a new link." Matches the story. Geometry audit clean (no overflow, no uneven rows, no wrapped controls).
2. Revoked link (revoked.png): heading "Share link revoked", body "The sender turned this link off. Ask them for a new link if you still need the file." Body wraps leaving the single word "file." on its own line (orphan, cosmetic).
3. Tampered id by one character (not-found.png): "Share link not found" with the story's text.
4. Key fragment removed on the revoked link (missing-key.png): shows "This link is missing a valid decryption key" with a paste field and a disabled "Use link" button. The page cannot show that this link is revoked until the key is supplied, which is expected.
5. Moved a file to Trash (see STORY-046): link shows "Shared file unavailable / This file cannot be opened right now. Ask the sender for a new link."
6. Mobile 390x844 (mobile-check.png, revoked state): fits, no overflow.

## Look pass
- All error cards keep the header "ENCRYPTED FILE TRANSFER" and the footer "Your browser decrypts this file and the key never leaves it" even though there is no file. The dot at top right turns from orange (ready) to black (error); there is no icon or colour that says "problem".
- None of the error cards name the file, the sender or, for expiry, the date it expired. A recipient with several links cannot tell which one failed, and has no contact route (recipient cannot request a new link; story confirms).
- The "revoked" and "expired" copy is the same advice, "Ask the sender", with no sender identity shown anywhere on the page.

## Flow log
- Story steps 3 for the recipient, no hesitation, no data re-entry. Dead end by design: the only exit is leaving the page (the Agent Drive logo links to the landing page).
- Not walked: expiry between card load and Download; network failure ("Share unavailable / Try again"); expiry under 2 minutes (CLI minimum).

# /connect findings
Session `ux-visual-connect`, signed in as e2e_uxreview (test auth, so ACCOUNT shows "Local test session"). Codes created with an isolated CLI config (`login --no-browser`) against http://localhost:3500/api; the offer was created with `ad rb grant CODE --drive research-bot --scope read --scope write --write-path /outputs`. Approving vis-agent-b through the add-to-existing form was a real approval (harmless test agents). Shots `shots/{viewport}-{state}.png` (states: entry, format-error, invalid-code, review-new, existing, existing-err-empty, existing-err-wrongkey, offer, approved); metrics `audit.json`.

## Verdicts
- Code entry (1440/768/390): compact card, mono tag + LED, large centered mono input, full-width orange Continue. Good focal point, but no autofocus and the card is top-anchored with 500px of empty page under it at 1440.
- Invalid code (`1440x900-invalid-code.png`, `-format-error.png`): clear text, but the unknown-code banner is neutral grey (reads as a note) while the format error gets an orange stripe; banner insertion moves the input down about 80px.
- Review new agent (`*-review-new.png`): the code is the loudest element, the decision ("Connect vis-agent-a?") second. Fits one screen at 1440x900 and 768x1024; at 390 scrollY is 9px. The delegate checkbox hint nearly touches the Approve button.
- Add to existing drive (`*-existing*.png`): card grows to about 1300px; at 1440x900 pageScrollY is 409 and Approve is below the fold (y about 1155); 390 scrolls 462px. Dense, hard to scan, three names for one secret.
- Offer from grant (`*-offer.png`): one banner sentence carries drive and permissions; otherwise like review-new, no existing-drive branch (correct).
- Approved (`*-approved.png`): small card, orange LED, repeated "Approved", no next step.
- Keyboard: Tab goes brand link, input, Continue; the 2px focus ring on the input is clearly visible. No horizontal overflow in any state or viewport.

## Findings
| id | level | element | problem | norm | evidence | sev | found by | verified |
|----|-------|---------|---------|------|----------|-----|----------|----------|
| CN-1 | page | existing-drive form | Approve button is below the fold at 1440x900 (pageScrollY 409, button y about 1155) and at 390 (scrollY 462); the code box and 4-row fact table consume the first 440px before any field | L2, L1 | audit.json `1440x900-existing`, existing-full.png | P1 | own | measured |
| CN-2 | component | code input | No autofocus: after load `document.activeElement` is BODY on a one-field page | I7, I5 | eval result | P2 | own | measured |
| CN-3 | group | entry error banner | Banner is inserted above the field, shifting input and button down about 80px (L5); wrong-code banner is grey "info" with no stripe, format error has an orange stripe, tag changes to "NO PAIRING" with a dim LED for a typo. Error color is the primary-action orange (H4) | L5, H4, I3, C3 | 1440x900-entry vs -invalid-code vs -format-error | P2 | own | observed |
| CN-4 | component | code input formatting | Accepts and shows lowercase ("abc"), no auto-uppercase or hyphen; normalization only happens on submit | I3, I8 | 1440x900-format-error.png | P3 | own | observed |
| CN-5 | page | entry layout | Card top-anchored, 500px empty below, no hint where the code appears beyond one sentence, no link to Console | D2, I6 | 1440x900-entry.png | P3 | own | observed |
| CN-6 | group | delegate option + Approve | Hint text bottom is about 3px above the Approve button; checkbox hint and primary action read as one block | D4, H1 | 1440x900-review-new.png | P2 | own | observed |
| CN-7 | component | checkboxes (delegate, read only) | Native 13x13 checkbox, sits lower than its label text, unstyled vs system; target below 24px | I4, H6, H5 | audit smallTargets input 13x13 | P2 | own | measured |
| CN-8 | group | delegate option on main path | Every agent approval shows a long 3-sentence permission ("hand another agent the key and permissions it holds itself, never more...") before the decision | I5, C1, C4 | review-new.png | P2 | own | observed |
| CN-9 | group | review header | Pairing code (34px mono) outranks the decision heading (20px); agent name appears in heading and Agent row; "Check that this matches" paragraph sits above the question | H1, H2, C2 | 1440x900-review-new.png | P2 | own | observed |
| CN-10 | component | "Add to an existing drive instead" | The only branch in the flow is a small underlined text link (16px tall) wedged between a banner and a checkbox; label gives no hint of when to use it | I1, P2, I5 | review-new.png; audit 178x16 | P2 | own | observed |
| CN-11 | group | existing form label spacing | Labels sit about 13px under the previous control and about 19px above their own (select bottom 655, label 668, input 687); proximity groups label with the wrong field | D4, D3 | existing-full.png | P2 | own | measured |
| CN-12 | group | key fields | One secret has three names (drive key, credentials bundle, recovery file), two inputs joined by "Or" inside a label, unstyled native file input ("Choose File / No file chosen" in mono), password field with no placeholder | C1, H5, I8 | existing-full.png | P2 | own | observed |
| CN-13 | group | form errors | Errors appear at the bottom above Approve, away from the offending field, without field highlight; empty-key error appears off-screen on short viewports. Messages mostly good ("The bundle does not contain a key for this drive."), but a file read failure showed the raw browser message "The requested file could not be read, typically due to permission problems..." (seen once with automated upload, cause may be the test harness) | I3, C1 | existing-err-wrongkey.png | P2 | own | observed |
| CN-14 | component | "Use a new drive instead" | Back path is below the optional writes field, 16px tall, far from where the branch began | I6, I4 | existing-full.png | P3 | own | observed |
| CN-15 | group | offer banner | Permissions given as a run-on sentence: "drive research-bot, read, write, writes under /outputs." (drive and offering agent share a name); the main security decision is not a structured list | C1, H2 | 1440x900-offer.png | P2 | own | observed |
| CN-16 | page | approved state | Dead end: no Console or drives link; "Approved" repeated in heading and sentence; does not say what was granted | C2, I6, C3 | 1440x900-approved.png | P2 | own | observed |
| CN-17 | page | spacing scale | Off-scale gaps 9, 10, 14, 18, 22 | D3 | audit.json spacing.offScale | P3 | own | measured |

## Excellent as is
Mono pairing code with tag and LED as a verification device; facts table (mono labels, hairline rows); single full-width primary; success and failure banners use role=status/alert; mismatched-bundle error message; consistent card at 440px; 390px layout keeps 16px gutters with no overflow in any state; visible focus ring.

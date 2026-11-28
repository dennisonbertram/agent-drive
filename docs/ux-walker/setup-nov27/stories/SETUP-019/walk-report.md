# SETUP-019 walk report: wrong and malformed verification codes

User e2e_approve_connect_019, request `jamal-pi`, code `PFCN-GLGC`, verification code `9fb7 99bc 8b49 1723`.

## Steps

1. Opened the link, clicked Approve with the field empty. screenshots/step-1.png: field gets a red border and focus, error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." The message wraps with the orphan word `7890.` on its own line. No request sent. Geometry clean.
2. Typed `9fbl 99bc 8b49 1723` (letter l, not a hex digit). Same message (screenshots/step-2.png). It does not say which character is invalid.
3. Pasted `Verification code: 9fb7 99bc 8b49 1723` (the whole CLI line): same "four groups" message. A user copying the terminal line gets rejected and is not told to drop the label.
4. Typed `9fb7 99bc 8b49 1724` (last digit wrong): after a short pause "This code does not match the one your agent printed. Check the terminal again and type it exactly." (screenshots/step-3.png). Clear and actionable. The red text sits 4 px below the focus ring and the input.
5. Typed `9fb7-99bc-8b49-1723`: accepted, "Access approved for jamal-pi" (screenshots/step-4.png). CLI printed `Logged in as agent jamal-pi.`
   Geometry audit: no overflow, no uneven rows; Details summary false-positive only.

## Flow Log

- Steps specified: 3 (type correctly, Approve; story lists 4 with errors). Steps needed: 4 including the three deliberate errors.
- Hesitations: step 2/3 messages do not name the bad character or the pasted label.
- Re-entry: retyping the whole code after each failure (field keeps its value, which helps).
- Duplicated info: none.
- Verdict: PASS (error recovery works), with low findings.

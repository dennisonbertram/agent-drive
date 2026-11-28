# /connect approval page: ux-visual findings (setup-nov27, release 0.5.1 local copy)

Shots: `pages/connect/shots/` (83 PNG, viewport + full page per state x viewport). Audits: `pages/connect/audit.json` (layout-audit + geometry-audit output per state x viewport, 36 records). Paths below are relative to `pages/connect/`.

Method notes
- Fresh users `e2e_vis_connect_1/2`. Real pending requests made with the CLI on the Studio (codes GMGL-ZKVZ, PNKM-FMPH, BXVN-RLPB). One long agent name tested (`vis-agent-with-a-very-long-name-for-wrapping-checks`).
- I opened with Read: all 1440 states, 375 for nocode/pending/pendinglongname/details/done/usedcode/signedout, 768 pending/details, 1280 pendinglongname/details, plus focus/error/typed shots. The remaining PNGs (mostly 1280/768 repeats of the same card) were not individually viewed; their layout is covered by the audit numbers (pageOverflowX 0 everywhere, no offscreenPrimary).
- Local copy has no Clerk configured, so the signed-out destination renders "Sign-in is not configured on this installation." That is an environment artefact; only the redirect itself is judged.
- Per-account lookup limit is 30 attempts / 10 min (`apps/web/src/api/device.ts:723`, every page load of `/connect?code=` counts). I hit it twice during review, which also blocked a re-measurement of the Details-open fold at 1280x800 (see F1: taken from the screenshot).
- Not covered (no data in a fresh user): drive picker, key import / recovery file fields, "expired while approving" error (connect.tsx:517), a genuinely time-expired request (the UI shows the same message as a used/unknown code).

## Verdict per viewport x state

| State | 1440x900 | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|---|
| signed-out redirect | OK (redirect to `/sign-in?redirect_url=%2Fconnect%3Fcode%3D...`, code preserved) | OK | OK | OK |
| no code | Good | Good | Good | Good |
| wrong code (invalid chars) | P2 (F7) | same | same | same |
| unknown / used / expired code | Good, one P3 (F9) | same | same | same; F5 for used |
| pending (closed) | Good with P2/P3 (F3, F8, F10) | same | same | P1 (F2) |
| pending, long name | Good (wraps to 2 lines) | Good | Good | P1 (F2), heading wraps to 3 lines cleanly |
| details open | Fits (button y794-842 of 900) | P1 (F1) | Fits (button y794-842 of 1024) | Scrolls, button reachable after scroll (full-page 375 shot, approve at y~890 of 812) |
| verification errors (empty, wrong) | Good | not re-shot | not re-shot | not re-shot |
| done card | P2 (F4) | same | same | same |

## Findings

| id | level | element | problem | norm | evidence | severity | measured/observed |
|---|---|---|---|---|---|---|---|
| F1 | P1 | Details open, primary button | With Details expanded at 1280x800 the Approve agent button starts at y~794 of an 800px viewport; only a few px show. Fits at 1440x900 (794-842) so the failure is exactly at the common laptop size. | L2, L1 | `shots/details-1280-vp.png` (button cut at bottom edge), `shots/details-1440-vp.png` (794-842) | P1 | observed (screenshot); re-measure blocked by rate limit |
| F2 | P1 | Verification code input at 375 | Input is 153px wide (151 client) and the 19-character code needs 218px, so 31% is scrolled out of view after typing or pasting. The user cannot read back the code they typed; the wrong-code error then asks them to "type it exactly". Label and input share one row, which causes the squeeze. | I3, C4, L6 | `shots/typed-375-vp.png` (shows "1f3 6a94 d4b5"), `shots/pending-375-vp.png` (placeholder clipped to "a1b2 c3d4 e51"). Stack the label above the input as the no-code state does. | P1 | measured (scrollWidth 218 / clientWidth 151) |
| F3 | P2 | Account and Machine rows | Which account is approving and which machine asked are only inside the collapsed Details. The human decision ("is this my agent, is this the right account?") needs them in view; the visible card shows only name, "full access" and the code. | I6, C1 | `shots/pending-1440-vp.png` vs `shots/details-1440-vp.png` | P2 | observed |
| F4 | P2 | Done card | Orange LED is the same colour family as the pending state, so success has no distinct signal. The agent name appears in the heading and again in the body; "approved" appears three times (tag, heading, body). The tag says "Approval saved" while the heading says "Access approved". | C3, C2, H4 | `shots/done-1440-vp.png`, `shots/done-375-vp.png`. Inner text: "APPROVAL SAVED / Access approved for X / You approved X to read, write, delete and share its new drive." | P2 | observed |
| F5 | P2 | Reload after approval | Reloading `/connect?code=` after a successful approval shows "This code is wrong, expired, or already used." A user who just approved sees an error and the unhelpful instruction to run login again. Likely deliberate to avoid revealing request state; the cost is real. | C3, I3 | `shots/usedcode-375-full.png` | P2 | observed (cause suspected) |
| F6 | P2 | Field labels | The only labels for the inputs ("CODE FROM YOUR AGENT", "VERIFICATION CODE") are 11px tracked mono caps in grey (5.49:1). Below the 12px floor for labels people must read to complete the task. | D1, H3, A1 | `shots/nocode-1440-vp.png`; layout-audit sizes include 11px; computed color rgb(107,105,99) | P2 | measured |
| F7 | P2 | Code format error | `?code=ABCD-EFGH` returns "Enter the code in the form XXXX-XXXX." although the text already has that form. The real rule is the 20-letter alphabet with no vowels (`BCDFGHJKLMNPQRSTVWXZ`, `apps/web/src/api/device.ts:24`). Message does not tell the user what is wrong (likely typo of an O/0, I/1 style). | C1, I3 | `shots/wrongcode-1440-vp.png` | P2 | observed |
| F8 | P3 | Focus on load (pending) | On a pending request nothing is focused; first Tab goes to the logo, second to Details, third to the code input. The no-code state does autofocus its input. | I7, I4 | `shots/focus-tab2-1440-vp.png`; tab order logged: A, SUMMARY, INPUT, BUTTON | P3 | observed |
| F9 | P3 | Vocabulary | One flow uses "pairing request", "No pairing", "Connect", "Approve", "login". "No pairing" as the status of a wrong code is the least plain. | C1 | `shots/unknowncode-1440-vp.png` ("NO PAIRING"), `shots/pending-1440-vp.png` ("PAIRING REQUEST") | P3 | observed |
| F10 | P3 | Placeholder | Placeholders render at opacity .6 of rgb(107,105,99), about 2.4:1 on white (computed estimate). The verification placeholder `a1b2 c3d4 e5f6 7890` looks like a filled value from a distance. | A1, C4 | `shots/pending-1440-vp.png`; `connect.css:247` | P3 | measured (style) / estimated ratio |
| F11 | P3 | Details summary row | When open, the "Details" label sits ~3px above the chevron (y225 vs y228) and a dark 1px rule closes the row. Focus outline hugs the text with no padding on the left edge. | H6, D3 | `shots/details-1440-vp.png`, `shots/focus-tab2-1440-vp.png` | P3 | observed |
| F12 | P3 | Inline error | Showing a field error pushes the Approve button down 18px (473 to 491). | L5 | `shots/pending-1440-vp.png` vs `shots/err-empty-1440-vp.png` | P3 | observed |
| F13 | P3 | Small targets | Brand link 114x20 and the delegate checkbox 20x20 are under 24px in height. The checkbox sits in a label, so the real click area is larger; the brand link is not. | I4 | layout-audit smallTargets (all pending/details audit records) | P3 | measured |
| F14 | P3 | Spacing scale | Off-scale values 10, 14, 18, 22px in use. 14 and 16 are near duplicates. | D3 | layout-audit `spacing.offScale` [10,14,18,22] (375: [10,14,18]) | P3 | measured |
| F15 | P3 | Vertical placement | The card is top-aligned and the lower ~60% of the 1440 page is empty, while the sign-in card is vertically centred. | H5, D2 | `shots/nocode-1440-vp.png` vs `shots/signedout-1440-vp.png` | P3 | observed |
| F16 | P3 | Layout shift on Details | Opening Details adds ~320px and moves the approve button and code match line. Expected for disclosure, but it is the cause of F1. | L5 | `shots/pending-1440-vp.png`, `shots/details-1440-vp.png` | P3 | observed |

Counts: P0 0, P1 2, P2 5, P3 9 (16 findings).

## Excellent as is
- Single high-emphasis action per state; Approve and Continue are the only primary buttons (H1). Focus ring is a 2px dark outline plus offset on button, input, summary and link (I7), visible in `shots/focus-tab4-1440-vp.png`.
- Errors for empty and wrong verification codes are inline, role alert, say what happened, keep the typed value, and return focus to the input. "This code does not match the one your agent printed. Check the terminal again and type it exactly." (`shots/err-wrongverif-1440-vp.png`).
- No horizontal overflow at any of the four viewports (geometry `pageOverflowX` 0, no overflowSpills) and the 4-viewport card width stays within gutters; long agent names wrap without clipping (`shots/pendinglongname-375-full.png`).
- Contrast of body text (11.4:1) and primary button text is well above 4.5:1; muted labels 5.49:1.
- Verification code never appears on the page and the page says so; match-the-terminal code is large mono and legible (`shots/pending-1440-vp.png`).
- Rate-limit state is specific: "Too many device code attempts. Wait 10 minutes and try again." and the input stays editable.
- Signed-out visitors are redirected with the code preserved in `redirect_url`.
- Hover changes are intentionally small (shadow 2px to 1px); cursor pointer; no hover-only UI.

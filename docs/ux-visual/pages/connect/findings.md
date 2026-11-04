# /connect findings (slug: connect)

Scope: `/connect` in code entry, bad format, not found, rate-limited error, waiting (new drive), reconnect, approve error, approved, denied, plus long-name and emoji-name variants, at 1440x900, 1920x1080, 768x1024, 375x812. Shots in `shots/`, metrics in `audit.json` (keys `<viewport>/<state>`. Second opinions: `second-opinion.json` (muse-wonder, gemini-4-argon). Helper scripts used: `tools/`.

Not captured as its own state: the transient "Looking up" state (the lookup returns in well under a second), and the non-404 lookup error (same code path and same banner as the rate-limited error, which is captured). Expired code looks identical to not found by design.

## Verdict per viewport x state

| State | 1440x900 | 1920x1080 | 768x1024 | 375x812 |
|---|---|---|---|---|
| Code entry | OK, card top-weighted, `entry` | same | same | OK, fits | 
| Bad format | OK (orange-bar error), `bad-format` | same | same | same |
| Not found / expired | OK but styled as neutral info, `not-found` | same | same | same |
| Rate-limited error | OK, but retry is futile and Continue stays live, `error-rate-limited` | same | same | same |
| Waiting, new drive | Good hierarchy; Deny/note crowded, `waiting-new-drive` | same | same | scrollY 7px, Approve in view (y 570-620) |
| Reconnect | Works; weakest copy, `reconnect` | same | same | same |
| Approve error | scrollY 23px at 1440x900 (card bottom + 64px padding); banner sits between trust copy and buttons | OK | OK | scrollY 87px, Approve still in view |
| Approved | Dead end, short card in empty field | same | same | same |
| Denied | Dead end | same | same | same |
| Long names (375) | Wraps cleanly, no overflow (`long-names`), scrollY 107 | n/a | n/a | OK |
| Emoji name (1440) | Renders, aligned (`emoji-name`) | n/a | n/a | n/a |

No horizontal overflow in any state (`geometry.pageOverflowX` = 0, `layout.viewport.pageScrollX` = 0). No small targets (min control 44px). Primary action in viewport everywhere.

## Findings

| id | level | element | problem | norm | evidence | sev | found by | verified |
|---|---|---|---|---|---|---|---|---|
| CONNECT-01 | page | No account shown on the approval screen | The human approves with their signed-in account but the page never says which. Someone with two accounts or browser profiles can pair an agent to the wrong account and the Approved card does not reveal it. | I3 error prevention; device-flow consent norm | `shots/1440x900-waiting-new-drive.png`: no account row anywhere. | P1 | muse (own agreed) | observed |
| CONNECT-02 | page | Dot-grid ground ends at content height | On short states the dot grid stops a little below the card (about y=325 on approved, 495 on entry at 1440x900) and the rest of the viewport is flat. `html` is 843px tall in a 900px viewport; the body background only paints to the root box. Affects every page whose content is shorter than the viewport. | H5 consistency with T1 reference; D2 intentional whitespace | `shots/1440x900-approved.png`, `shots/1920x1080-entry.png`; eval: html height 842.9 vs innerHeight 900. | P2 | argon, own | measured |
| CONNECT-03 | component | `.connect-note` and Deny are jammed together | "You can revoke access any time..." sits 0px under the action grid (computed margin-top 0), so about 11px of visual gap versus 14-16px elsewhere. Cause: `.connect-shell .panel > p { margin: 0 0 14px }` outranks `.connect-note { margin: 16px 0 0 }`. At 375 the note wraps to two lines, hugging the Deny border. | D4 proximity; H6 | `shots/375x812-waiting-new-drive.png`, eval `note.marginTop = 0px`. | P2 | own, argon | measured |
| CONNECT-04 | component | Info banner (`p.banner.info`) uses the wrong text style | Same specificity clash: the new-drive and reconnect banners get 14px muted grey from `.panel > p`, while the error banner is 13px ink. Two banner sizes in one card, and the information the user is deciding on is the faintest text on the card. | H5, H3 | eval `bannerFont 14px`, `bannerColor rgb(93,91,86)`; `shots/1440x900-waiting-new-drive.png`. | P2 | own | measured |
| CONNECT-05 | group | Reconnect disclosure is the thinnest copy on the page | New drive gets three explanatory lines; reconnecting an existing drive (more sensitive) gets one muted line "Reconnects to: reconnect-drive" under an unchanged title. It does not say that the agent regains access to that drive's contents or that the old key is replaced. | C1, I3 | `shots/1440x900-reconnect.png` | P2 | muse, argon | observed |
| CONNECT-06 | page | Approved and Denied are dead ends and repeat themselves | Title and body say the same word twice ("Approved" / "Approved. Return..."), neither names the agent or drive, and there is no next step such as Open Console. The status LED eyebrow also repeats the verdict a third time ("Paired"). | C2 no duplication; I3 recovery | `shots/1440x900-approved.png`, `1440x900-denied.png` | P2 | muse, argon, own | observed |
| CONNECT-07 | component | "Requested" shows a locale timestamp, no age or expiry | Codes live 10 minutes (`expires_in: 600`); the page prints `11/4/2026, 4:55:49 PM`. A user comparing against a terminal cannot tell how stale it is or how long they have. `expires_at` is already in the payload. | C3 status legibility | `shots/1440x900-waiting-new-drive.png`; `DeviceRequest.expires_at` in `connect.tsx`. | P2 | muse, own | observed |
| CONNECT-08 | component | Rate-limited state invites a pointless retry | After repeated lookups the server returns "Too many device code attempts. Wait 10 minutes and try again." Valid codes were rejected for over 10 minutes. The page keeps Continue live and the old code in the field, with no way to know when to retry. | I3 | `shots/*-error-rate-limited.png`, reproduced at all four viewports. | P3 | own | observed |
| CONNECT-09 | component | `agent-drive login` is set in proportional text and wraps as "agent-/drive login" | The exact string the user must match in their terminal is split across lines at the hyphen. Should be a mono `<code>` with `white-space: nowrap`. Same in the not-found message. | C1, I6 | `shots/1440x900-entry.png`, `1440x900-not-found.png` | P3 | muse, argon | observed |
| CONNECT-10 | component | Continue looks live with an empty field | Relies on `required`; a click shows a browser tooltip, not an inline message. | I3, I8 | `shots/1440x900-entry.png` | P3 | muse, argon | observed |
| CONNECT-11 | component | Not-found banner is styled neutral | Bad-format uses the orange-bar error style, not-found uses a plain grey info box, yet both leave the field in the same failed state and the eyebrow says "No pairing". Intentional (info kind) but reads weaker than the failure it is. | H4 colour with purpose; C3 | `shots/375x812-not-found.png` vs `375x812-bad-format.png` | P3 | argon | observed |
| CONNECT-12 | component | Deny label is 13px next to a 16px Approve | The secondary button inherits `.button` 13px while the connect primary is 16px. Reads fine but the pair is lopsided in height and size. | H3 | eval `deny.size 13px`, `appr.size 16px` | P3 | own | measured |
| CONNECT-13 | layout | Card pinned to the top of the viewport | At 1440x900 the 160px Approved/Denied card sits under the logo with 500px empty below (combined with CONNECT-02 it looks unfinished). Entry at 1920x1080 occupies the top third. | D2, L4 | `shots/1920x1080-entry.png`, `1440x900-denied.png` | P3 | muse, argon | observed |
| CONNECT-14 | layout | 64px bottom padding creates a scrollbar | Approve-error at 1440x900 scrolls by 23px; at 375 approve-error 87px and long-names 107px. The action and Approve remain in view, so only polish. | L1 (loosely, card page), D3 | `audit.json` `1440x900/approve-error.layout.viewport.pageScrollY = 23` | P3 | own | measured |
| CONNECT-15 | group | Type scale and spacing drift | 7 distinct font sizes on the request card (11, 13, 14, 16, 24, ~44 mono, plus heading) and off-scale spacings 10/14/18/22. | H3, D3 | `audit.json` `*/waiting-new-drive.layout.type.distinctFontSizes`, `spacing.offScale` | P3 | own | measured |

## Rejected or downgraded claims

- Known item "old a/ agent drive brand mark": rejected for /connect. It uses the new orange tile mark (observed in every shot).
- Known item "leftover lime/green": none on /connect (observed).
- Known item "double rule under pricing header": not applicable here.
- Audit `lowContrast` entries (ratio 1.65-2.11 on "Pairing code", the code, and the check line): false positives. They sit on the smoked dark gradient and the audit measured against the light card. Observed legible orange/grey on near-black.
- muse "account identity is P0": downgraded to P1; the request is already tied to the signed-in session.
- muse "Machine row duplicates Agent row / long names untested": long and emoji names were tested; they wrap cleanly, no truncation.
- muse "status eyebrow missing on the request screen": the card has a mono tag with LED inside the code display; treated as intentional.

## Excellent as is

- Smoked-glass code display: the code is the focal point, 44px mono in signal orange, large, spaced, high contrast (observed all four viewports).
- One primary action per state; Approve and Continue are the only orange buttons (H1).
- Entry form: one field, one button, auto-uppercases and inserts the hyphen via `normalizeCode`.
- Keyboard: tab order is logo, Approve, Deny; 2px ink focus ring visible; input focus ring is orange (measured).
- Fully responsive: no horizontal overflow at any size, text wraps in long agent and machine names, 44px+ targets.
- Brand mark, ground colour, fonts match the T1 reference; no stray green.
- Plain, honest copy for key custody: "Agent Drive never sees it."

## Fix locations

- CONNECT-01: `apps/web/app/(app)/connect/page.tsx` (read `consoleUserId`/Clerk user email, pass to `connect.tsx`) and a row above `.connect-actions`.
- CONNECT-02: `apps/web/app/globals.css` `body` / `html`: add `min-height: 100vh` (or `html { min-height: 100% }`). Global; verify other pages.
- CONNECT-03 and CONNECT-04: `apps/web/app/styles/connect.css`: change `.connect-shell .panel > p` to `.connect-shell .panel > p:not(.banner):not(.connect-note)` or raise `.connect-note` / `.connect-shell .banner` specificity.
- CONNECT-05, 06, 07, 08, 10: `apps/web/app/(app)/connect/connect.tsx` (copy, relative time from `expires_at`, post-approval link to `/console`, `disabled={loading || !valid}`).
- CONNECT-09: `connect.tsx` wrap in `<code>`, style in `connect.css`.
- CONNECT-11, 12, 14, 15: `connect.css` (`.connect-shell .button.secondary` font-size, `.connect-shell` padding-bottom, banner variants).

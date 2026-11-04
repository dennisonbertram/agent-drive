# console-secondary: Agents, API keys, Usage, Trash and dialogs

Server http://localhost:3230, account e2e_cs_1, synthetic data (1 drive with long emoji name, 1 agent with long Unicode name, 2 API keys, 3 files via CLI, 1 trashed file). Viewports 1440x900, 1920x1080, 768x1024, 375x812. Shots in `shots/<viewport>-<state>[-full].png`; metrics in `audit.json` (key `<viewport>/<state>`, `layout` + `geometry`). Helper scripts in `tools/`. Second opinions in `second-opinion.json` ([muse] = meta/muse-wonder, [argon] = google/gemini-4-argon); each external claim below was checked against a screenshot or the live page.

States captured (all four viewports unless noted): agents-empty (no drive), agents-empty-drive, agents-list, agents-list2 (agent with 2 keys), apikeys-empty (no drive), apikeys-empty-drive, apikeys-empty-agent, apikeys-list, apikeys-revoked, apikeys-list-keynotloaded (1440 only), usage-empty, usage-drive, usage-populated, trash-empty, trash-empty-drive, trash-item, dlg-newdrive, dlg-drivekey, dlg-newagent, dlg-newapikey, dlg-apikeyreveal, dlg-loadkey, dlg-versions.

## Verdict per state

| State | Verdict | Refs |
|---|---|---|
| Agents empty / list | Clean at 1440/768; the Connect card is the largest object, the identity list is small and sits mid-page. At 1920 bay strip and content do not share a left edge. 375 scrolls (332-441px). | 1440x900-agents-list.png, 1920x1080-agents-list2.png; CS-02, CS-08 |
| API keys (all states) | Worst page: scrolls at every viewport (285-418px at 1440, up to 1529px at 375); key rows carry no way to tell keys apart; revoked row keeps a dead Revoke button. | 1440x900-apikeys-revoked.png, 375x812-apikeys-list-full.png; CS-01, CS-10, CS-11 |
| Usage | Good at 1440/1920/768 (no scroll). At 375 the numeric columns of Usage by author are hidden in a scroller; third card is not a readout. | 375x812-usage-populated-full.png; CS-04, CS-14 |
| Trash | Fits one screen at desktop. Truncated cells, stale banner, and at 375 the Restore action is off-screen. | 1440x900-trash-item.png, 375x812-trash-item.png; CS-03, CS-05, CS-09 |
| Dialogs | Consistent smoked-header dialogs, all fit 375x812 without scrolling. No Copy for secrets, initial focus on Close, truncated agent select. | dlg-*.png; CS-12, CS-13, CS-25 |

## Findings

Levels: component, group, page, layout. "verified": measured (audit.json/DOM), observed (screenshot or live interaction), suspected.

| id | level | element | problem | norm | evidence | severity | found by | verified |
|---|---|---|---|---|---|---|---|---|
| CS-01 | page | API keys tab | Whole page scrolls at every viewport: pageScrollY 285 (empty, 1440), 359 (list), 418 (agent no keys), 105 to 238 at 1920, 1456 at 375. Cause: Connect card (about 320px) plus the terminal-recipe card stacked above/below a short list. | L1, L3, D2 | audit.json `1440x900/apikeys-list`.layout.viewport.pageScrollY | P1 | own, muse | measured |
| CS-02 | page | "Connect an agent" card on Agents and API keys | Identical 320px card on both tabs, cannot be collapsed or dismissed even when an agent and keys exist; pushes the actual work (identity list, key list) below it. | C2, D5, L7 | 1440x900-agents-list.png, 1440x900-apikeys-list.png | P1 | own, muse, argon | observed |
| CS-03 | component | Trash table at 375 | Table scroller is 728px in a 341px box; Restore/Versions buttons sit at x=619, off-screen, with no scroll cue. The one job of the tab is unreachable without discovering a sideways scroll. | I4, I1, L6 | 375x812-trash-item.png; DOM scrollWidth 728 vs clientWidth 341 | P1 | own, muse, argon | measured |
| CS-04 | component | Usage by author at 375 | Table 620px in 341px scroller; Storage/Versions/Operations hidden, only the agent name shows. Same pattern as CS-03. | L6, I1 | 375x812-usage-populated.png; table-scroll 620/341 | P1 | own | measured |
| CS-05 | component | Trash table columns at 1440 | "11/4/2026…" and "Versions preser…" truncated while file path column has >300px spare; no title on hover seen. | C4, D3 | 1440x900-trash-item.png | P2 | own, muse, argon | observed |
| CS-06 | layout | Mobile section nav (375) | Horizontal tab strip clips "Billing & limits" to a bare "$"; "Activity & deletion" not visible. No fade or overflow cue. Active tab also shows a doubled ring (focus ring plus active style) after click. | I6, L6, A2 | 375x812-trash-item.png, 375x812-usage-populated.png | P1 | own, argon, muse | observed |
| CS-07 | layout | Mobile header stack (375) | Brand bar, tab strip, breadcrumb (wraps to 2 lines on API keys), bay strip and page header consume about 320px before content; the tab name appears 3 times (tab, breadcrumb, h1). | L2, C2, D5 | 375x812-apikeys-list.png | P2 | own, argon | observed |
| CS-08 | layout | Bay strip / breadcrumb vs content at 1920 | Bay strip and breadcrumb start at x=250 while the 1400px-max content column starts at x=400; 150px misalignment between two stacked regions. | L4 | 1920x1080-agents-list2.png | P2 | own, argon | observed |
| CS-09 | group | Status banners | "Agent created. Create an API key to connect it." persists after switching to the Agents tab and shifts content down 57px (L5). On Trash after trashing: "Restore it from the Trash tab" shown on the Trash tab. No dismiss. | L5, C4, I2 | 1440x900-agents-list.png, 1440x900-trash-item.png | P2 | own, muse, argon | observed |
| CS-10 | component | Revoke / Revoke access | Same black-outline weight as Refresh; no hint of scope (does agent revoke kill its keys?). Revoked key keeps a disabled Revoke button beside the REVOKED badge. Code has window.confirm (console.tsx 953, 1026); I overrode confirm in the browser so I did not observe the native prompt. | H2, I3, C2 | 1440x900-apikeys-revoked.png, 1440x900-agents-list2.png | P2 | own, muse, argon | observed |
| CS-11 | component | API key rows | Rows show label, agent, scopes, drive; no key prefix, created date or last used, so two keys on one agent are distinguishable only by free-text label. | I6, C3 | 1440x900-apikeys-list.png | P2 | muse, argon | observed |
| CS-12 | component | Receipt dialogs (API key, drive key) | Secret shown in a resizable textarea (visible resize grabber) with no Copy button; user must hand-select a wrapping 64-char string. Drive key dialog has only "Save recovery key". | I2, I4, H5 (Copy exists elsewhere) | 1440x900-dlg-apikeyreveal.png, 375x812-dlg-drivekey.png; snapshot shows textbox, checkbox, Done only | P2 | own, muse, argon | observed |
| CS-13 | component | Dialog focus | On open, focus lands on "Close dialog" (activeElement measured), not on the first field. After Escape, focus falls to BODY, not the button that opened it. | I7 | live check on dlg-newdrive | P2 | own | measured |
| CS-14 | component | Usage "Egress & cost" card | Third hardware card has no readout, holds a Billing & limits button that duplicates the sidebar link; grid implies three comparable metrics. | H5, C2 | 1440x900-usage-populated.png | P2 | own, muse, argon | observed |
| CS-15 | component | Status LED in topbar | "CLIENT-SIDE ENCRYPTED" dot is #a2cb67 (lime), the leftover colour; every other LED is signal orange. Present on all tabs. | H4, H5 | apps/web/app/globals.css:213; every shot topbar | P2 | own | measured |
| CS-16 | component | Sidebar brand mark | Console sidebar still shows "a/ agent drive" (console.tsx 472-473); the T1 reference brand is a logo square plus "Agent Drive". | H5 | 1440x900-agents-empty.png; docs/design/t1-rack-reference.html:185 | P2 | own | observed |
| CS-17 | component | Bay strip add card | Dashed card to add a drive reads "+ YOUR NEXT AGENT" (aria-label "Add a drive"); agents and drives are different things. | C1 | 1440x900-agents-list.png | P2 | own, argon | observed |
| CS-18 | component | Dialog agent select | Agent select truncates the name ("Ünïcode agent 🤖 with a deliberately lo") at 375 and 1440, so the operator cannot confirm the identity before issuing a key. | C4, I3 | 375x812-dlg-newapikey.png | P3 | argon, muse | observed |
| CS-19 | component | Row and form targets | Trash row Restore/Versions 47x22 and 51x22, llms.txt link 305x21, dialog checkboxes 16x16 (audit smallTargets). | I4 | audit.json `1440x900/trash-item` | P2 | own | measured |
| CS-20 | layout | Type and spacing | 8 to 11 distinct font sizes per screen; spacing off-scale values 3, 5, 6, 7, 9, 10, 14, 15, 18, 22 present on every tab. | D3, H3 | audit.json layout.spacing.offScale, type.distinctFontSizes | P3 | own | measured |
| CS-21 | component | Connect card density | Intro copy is 16-17px inside a tool console (other copy 12-14px) and the command block stops at about 55% of the card width. | D1, H3, L4 | 1440x900-agents-list.png | P3 | own, argon | observed |
| CS-22 | component | Disabled primary in receipt dialogs | "Continue to drive" and "Done" are peach on peach with no stated reason (the checkbox is the reason). | I8, A1 | 1440x900-dlg-drivekey.png | P3 | own, muse | observed |
| CS-23 | component | Eyebrow "YOUR AGENTS' SHARED MEMORY" | Same eyebrow on Agents, API keys, Usage, Trash; says nothing about the section. | C2, C4 | every tab shot | P3 | own | observed |
| CS-24 | component | Storage by drive row at 375 | Value "5.1 KB · account limits apply" wraps into a 4-line narrow column beside the drive name. | D2, H6 | 375x812-usage-populated.png | P3 | own, argon | observed |
| CS-25 | component | Disabled "+ New API key" with no drive/agent | Button is peach-disabled with no reason beside it (the empty state below explains it). | I8 | 1440x900-apikeys-empty.png | P3 | own | observed |
| CS-26 | group | Trash page chrome | Raw drive UUID, KEY LOADED badge and Forget key sit on separate lines above the table; at 375 they take about 190px before any row. | C1, D2 | 375x812-trash-item.png | P3 | own, argon | observed |

Rejected or unverified:
- [muse] "localhost URL in the setup prompt is a dev artifact": rejected, it is the local server's own origin.
- Audit lowContrast entries for Copy buttons (1.18) and the dark-panel labels (2.8): not accepted, the audit does not resolve dark panel backgrounds and the text is legible in the shots. Usage card small labels on dark may still be dim: suspected P3.
- Pressing Escape inside a receipt dialog relaunched the headless browser both times I tried it (agent-browser reported "relaunched browser"; page became about:blank). The code (console.tsx Dialog onCancel, closable=false) says the dialog should stay open. Unverified whether this is the tool or the app; nothing was concluded about secret loss.
- Not exercised: native revoke confirm prompt, Restore from Trash, Clerk-backed flows.

## Excellent as is

- Dialog system: smoked header with orange LED, mono title, solid body, single primary; every dialog fits 375x812 without scrolling (dlg-*.png).
- Empty states are compact with one action each and say what to do first ("Create a drive first", "Who's doing the work?").
- Receipt dialogs: honest warning callout, a required "I saved it" gate, and the secret in the readout style.
- Usage hardware cards: orange mono readouts on smoked glass are on-brand and scan well at desktop widths.
- Visible 2px focus outline on every control tabbed (14 stops checked); no horizontal page overflow at any viewport (geometry.pageOverflowX 0 everywhere).
- Long and emoji names wrap or ellipsize without breaking layout in rows, dialogs and the bay strip.
- Usage, Trash and Agents fit one screen at 1440x900 and 1920x1080 (pageScrollY 0).

## Where to fix

- CS-01/02: `apps/web/app/(app)/console/console.tsx` (connect-agent section around line 126; show only when no agent/key, or collapse into a `<details>`); `apps/web/app/styles/console-panels.css`.
- CS-03/04/05: `.table-scroll` and table column widths in `console.tsx` lines 748, 1117 and `console-panels.css`; stack rows as cards under 760px.
- CS-06/07: mobile rules in `apps/web/app/styles/console.css` (`@media (max-width: 760px)`, `.sidebar nav`).
- CS-08: `.bay-strip` and `.console-topbar` vs `.console-content` max-width 1400px in `console.css` line 171.
- CS-09: `notice` state in `console.tsx` (clear on tab change; vary text).
- CS-10, CS-11: key/agent rows in `console.tsx` (~930-1040), button variants in `globals.css`.
- CS-12/13/22: `Dialog` component, `console.tsx` lines 200-240 (autoFocus first field, restore focus on close, Copy button, `resize: none`).
- CS-15: `apps/web/app/globals.css:213` (`.status-dot` background).
- CS-16: `console.tsx:472-473` and `.sidebar .brand-mark` in `console.css:27`.
- CS-17: bay strip add card in `console.tsx` near line 563.
- CS-14: usage cards in `console.tsx` ~1060-1080.

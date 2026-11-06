# ux-visual report (run 2): decisions only, implementation in /ux-auto-improve

Date: 2026-11-06. Scope: Phases 0 to 5. Phases 6 to 8 (implement, verify, before/after) were not run here. External MUSE Wonder and Gemini Argon judges and second opinions were skipped in this run; all findings rest on one inspector per page.

## Surfaces audited

/ (landing), /pricing, auth fallback card (/sign-in, /sign-up), /connect (all states), /s/<id> (8 states), /console Files, Trash, Agents, API keys, Usage, dialogs and first visit, /console/settings, /console/billing, /llms.txt. Viewports 1440, 768 and 390 (1920 and 375 only for connect, landing and pricing). 89 inspector findings.

## Findings by severity

- P0: none.
- P1 clusters (carried): C01, C02, C03, C04, C05, C06, C07, C08. P1 deferred: C11, C12, C14 (folded into C04), C15.
- P2 clusters (deferred): C09, C10, C13, C16, C17, C18.
  (Counts per cluster are in `problems.md`; the 89 findings are placed in 18 clusters except A-5 and A-6.)

## Clusters and decisions

See `decisions/README.md` for one line per cluster and the build order C02 -> C06 -> C05 -> C04 -> C03 -> C08 -> C07 -> C01. Full documents: `decisions/C01.md` to `decisions/C08.md`.

## Deferred

C09 operator language, C10 vocabulary and filler copy (C07 and C05 wording must match one term), C11 share page states, C12 billing and usage, C13 type, spacing and touch targets, C14 (covered by C04), C15 settings audit log, C16 marketing and docs polish, C17 agents and API keys as one table, C18 settings permanent actions. Also deferred: "Remember on this device" (C05), inline preview and folder tree (C04 phase 2), upload.

## Coverage gaps

Real Clerk forms and appearance (A-5); console loading states; download completion on console and share; many drives, folders and 1,000+ files; billing with checkout, settings error states; revoke and rotate after-action states; dark mode and print (not in inventory); keyboard and screen-reader pass limited to focus rings and tab order; no wide or 375 console shots; no second opinions. F19 needs a real-browser check.

## Verification status

Nothing implemented or verified in this run. No before/after screenshots exist.

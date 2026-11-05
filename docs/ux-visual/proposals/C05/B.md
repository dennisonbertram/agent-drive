# C05-B Restructure: bottom tab bar plus a single drive switcher

Mock: `mock-B.html`, `mock-B.png` (375x812, More sheet open). Content (eyebrow) starts at y=134.

## Change
Treat the phone as an app, not a shrunken sidebar.
- Fixed bottom bar, 64px, 6 equal slots: Files, Agents, API keys, Usage, Trash, More. "More" opens a bottom sheet with "Billing & limits" and "Activity & deletion" (48px rows). All 7 sections are labelled in plain text.
- The top header is the brand row plus ONE full-width drive switcher (selected drive, size and file count, "SWITCH") instead of the horizontal bay strip. Tapping opens a sheet listing all drives and "Add a drive (your next agent)".
- Breadcrumb/topbar removed on phone.
- Active tab: ink text plus 3px signal-orange top rule.

## Before / after
Before: ~320px of header, two scrolling strips. After: header 110px, one non-scrolling control, bottom bar always in thumb reach. Content at y=134.

## Files and selectors
- `console.css` 760px block: `.sidebar nav` becomes `position:fixed; bottom:0; display:grid; grid-template-columns:repeat(6,1fr)`; `.console-shell{padding-bottom:64px}`; hide `.bay-strip` and show a new `.drive-switch` button; new `.more-sheet`, `.scrim`.
- `console.tsx`: nav gets a "More" `<button aria-haspopup>` and sheet; new `DriveSwitch` using existing `drives`, `selected`, `open('drive')`; keep the desktop bay strip markup (hide by CSS) or render both.
- Billing and settings routes are separate pages with their own layout, so the bottom bar must be shared (extract a `ConsoleNav`) or those pages show no nav at all. That is a structural change across `console/billing` and `console/settings`.
- New components, new tokens for bar height and safe-area inset (`env(safe-area-inset-bottom)`).

## Effort and risk
Large (1 to 2 days). Risks: the fixed bar competes with page-level primary actions and with the on-screen keyboard; billing and settings need the shared nav; a second place to maintain drive logic; "More" hides two destinations one tap deeper (billing is a core paid-plan path); six slots at 375px leave 62px per label ("API keys" at 10.5px is tight); focus management for two sheets.

## Acceptance
- All 7 reachable and labelled: yes, all visible or one tap away, no scrolling.
- Selected drive fully visible: yes, always, full name.
- No clipped labels: yes.
- Content at or above y=260: yes (134), best of three.

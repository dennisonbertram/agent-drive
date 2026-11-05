# C / Convention: flat divided list rows with one primary action and an overflow menu

Mock: `mock-C.html`, screenshot `mock-C.png` (375x812 viewport, full page).

## What best-in-class does
- GitHub mobile (repo file list, issue and PR lists): one title line, one muted metadata line joined by dots, no column headers.
- Vercel mobile dashboard (deployments, usage): list rows with a title, a muted meta line and a right-aligned status; usage tables become label/value lists.
- Linear mobile (issue lists): dense divided rows, one status chip on the right, secondary actions behind a menu, 44px targets.
- Google Drive / Dropbox mobile: file rows with a single `⋯` overflow for secondary actions.
We take: flat rows in the existing panel (no nested cards), title plus dotted meta line, status chip right, and `⋯` for secondary actions.

## The change
Below 760px each row is a CSS grid of `title | action`, then a `meta` line. Files: path (wraps), then `size · author · modified`; right column holds a filled `Download` button and a 40px `⋯` button. The `⋯` is a native `<details class="more">` listing Versions and Move to Trash (no JS state, but closes only on re-tap; add `onToggle`/outside-click if required). Trash: `Restore` plus `⋯` (Versions). Usage: agent name, storage chip at right, `12 versions  48 ops` meta. Billing usage: same, with the egress text as a muted sentence. Audit: action code, outcome pill at right, `when · actor · HTTP status` meta.

## Before / after
Before: hidden columns and an unreachable Download. After (mock): one-line-high-ish rows, about 80px per file against about 150px for B; full page 1622px against 2701px; Download and Restore are always visible; Trash (destructive) is one tap deeper.

## Files / selectors
Same four CSS files as B plus a new `.row-list` pattern in `globals.css`. Markup is a larger change than B: each table needs a parallel list rendering (or CSS grid areas over the existing `td`s with `grid-template-areas`, which still needs `data-label`-less spans for the dotted meta line and cannot join `size · author` without extra elements). `console.tsx` Files/Trash row actions need a `<details>` menu, with Playwright tests for open/close. `settings-client.tsx` and `billing-client.tsx` need row templates.

## Effort and risk
Effort: L. Risks: hidden Trash and Versions actions add a tap to a destructive and a frequent action, and `Download` changes to a filled button (second accent on the Files tab; the console's `H1` says one high-emphasis button per region, and a column of 10 filled buttons breaks it); meta lines wrap with orphaned dots (seen at 375 in the mock); `<details>` menus clip against `overflow:hidden` panels and overlap the next row (seen in the mock); two render paths per table unless CSS grid is used.

## Acceptance criteria
- Primary action visible at 375: met for Download and Restore; Trash and Versions are not visible (the criterion names only Download and Restore).
- No scroller wider than 1.3x: met (none).
- No mid-word clipped text: met, but `Move to Trash` and the dotted meta line can wrap in two places.

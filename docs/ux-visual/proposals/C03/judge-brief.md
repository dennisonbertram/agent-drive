# Judge brief: C03 Wide tables unreachable on phones (Agent Drive, T1 "rack" design system)

Score each of A, B, C 1-5 on: criteria (x3), simplicity (x2), consistency (x2), usability (x2), visual quality (x2), effort/risk (x1, 5 = small and safe). Return JSON as instructed. Screenshots attached: mock-A.png, mock-B.png, mock-C.png (375px wide, full page). Each mock shows the same five tables: Files, Trash, Usage by author, Billing usage by agent, Settings audit log.

## Problem
Five tables keep a 620-1851px width inside a 293-341px horizontal scroller with no scroll cue at 375px. In the Files table only the path is visible; size, author and Download/Versions/Trash are about 1500px off-screen. Trash Restore is at x=619. Usage and audit columns are hidden. Cause: `min-width` rules plus `white-space:nowrap` cells, no reflow under 760px.

## Acceptance criteria
1. At 375 the primary action of each row (Download, Restore) is visible without sideways scroll.
2. No table scroller is wider than 1.3x its box unless a visible scroll cue (edge fade or shadow) is present.
3. No mid-word clipped action text.
Design system rules: stay inside the T1 tokens (Space Grotesk, IBM Plex Mono, ink #121211, signal orange only for LEDs/primary), one high-emphasis button per region, tools are dense (rows 28-36px at desktop). The T1 reference at 390px renders table rows as cards.

## Proposals

# C03 / A Minimal: keep the tables, hide low-value columns, add a scroll cue

Mock: `mock-A.html`, screenshot `mock-A.png` (375x812 viewport, full page).

## The change
Keep every `<table>` and `.table-scroll`. Add CSS only (no markup change):
1. `.table-scroll` gets a CSS scroll-shadow (four `background` gradients, two `local`, two `scroll`) so any remaining overflow shows an edge fade.
2. At `max-width: 760px` the Files/Trash table drops columns 2-4 (size/deleted, author/recovery, modified) with `display:none`, keeps `table-layout:fixed`, gives the actions column 96px and stacks the row buttons vertically. The path column truncates with an ellipsis.
3. Usage, billing usage and audit tables lose the 620-630px `min-width`, get 10px cell padding and `overflow-wrap:anywhere` so all four columns fit 341px.

## Before / after
Before: 1851px table in a 341px scroller, only the path visible, Download about 1500px to the right. After (mock): Download/Versions/Trash and Restore/Versions are on screen; size, author and modified are gone on phones; the other four tables fit but break words mid-word ("RETA/INED", "SUCCES/S", "file.ve/rsion.c/reate").

## Files / selectors
- `apps/web/app/globals.css` `.table-scroll` (scroll shadow; WP0 owns this file).
- `apps/web/app/styles/console.css` 760px block: replace `.file-panel table{table-layout:auto;min-width:720px}` with the column hiding and fixed layout above.
- `apps/web/app/styles/console-panels.css`: none beyond the Usage table padding.
- `apps/web/app/styles/account.css`: delete `.settings-audit{min-width:630px}` in the 700px block; add narrow padding and wrapping for `.billing-page td` and `.settings-audit`.

## Effort and risk
Effort: S (about 40 lines of CSS, 4 files, no markup, no TSX tests change). Risk: data loss on phones (size, author, modified are unreachable at 375, which fails the spirit of the T1 reference and the existing CF-19 note), mid-word breaks, header text wrapped to fragments, truncated file names (the name is the main identifier), and it still relies on a cue the user must notice for any future column.

## Acceptance criteria
- Primary action visible at 375 without sideways scroll: met (measured in mock: scrollWidth 341 = clientWidth 341 for all five).
- No scroller wider than 1.3x its box unless a cue exists: met (no overflow, shadow present as a backstop).
- No mid-word clipped action text: action text met; but body text and pill labels break mid-word in billing and audit ("SUCCES/S"), which is the same class of defect. Partial.

# C03 / B Restructure: stacked row-cards under 760px (the T1 pattern)

Mock: `mock-B.html`, screenshot `mock-B.png` (375x812 viewport, full page).

## The change
Below 760px every data table renders as a list of cards, exactly as `docs/design/t1-rack-reference.html` does at 390px (`table,thead,tbody,tr,td{display:block}`, `thead` hidden, each `tr` a white 10px-radius bordered card). One shared class, `.table-stack`, in `globals.css`, applied to each `.table-scroll` wrapper. Each `<td>` gets a `data-label` and the CSS prints it with `td:before{content:attr(data-label)}`. The first cell is the card title (`.primary`, wraps, no ellipsis). Label left, value right on mono 12.5px lines. Files/Trash cards end with an action row: first button filled (`Download`, `Restore`), the rest outlined, min height 40px. Read-only tables (usage, billing usage, audit) use the same card with no action row; the audit card title is the action code, and the result pill sits in a labelled line with HTTP status below.

## Before / after
Before: 1851px table, only the path visible. After (mock): 3 file cards, each with the full path wrapped, size, author, modified and three visible buttons; no horizontal scroll anywhere; full page height 2701px for five sections (cards cost vertical space: a file row is about 150px against 44px today at desktop).

## Files / selectors
- `globals.css` (WP0): add `.table-stack` block inside `@media (max-width:760px)` (tokens only).
- `console.css`: remove `.file-panel table{min-width:720px;table-layout:auto}` in the 760px block; `.file-panel td{white-space:normal}` at that width.
- `console-panels.css`: usage table uses the shared class; no new rules.
- `account.css`: remove `.settings-audit{min-width:630px}` (700px block) and the `.billing-page td max-width` for stacked mode; keep `.settings-outcome` as is.
- Markup: `console.tsx` (~748, ~1117: add `className="table-stack"` and `data-label` on every td, `className="primary"` on the first, `className="actions"` on the actions td), `billing-client.tsx` (~510), `settings-client.tsx` (~242). Keep `<thead>` in the DOM (display:none hides it visually only; use the sr-only pattern instead so screen readers keep column names).

## Effort and risk
Effort: M. About 35 lines of shared CSS and attribute additions in 3 TSX files. Risks: `display:block` on table parts drops table semantics in some screen readers, so add `role="table"/"row"/"cell"` or keep the sr-only thead; tall pages (about 2.5x vertical space per row); the Files test selectors that read `td` text still work. The settings audit region uses `tabIndex=0` for scrolling; remove it at <760 when no overflow.

## Acceptance criteria
- Primary action visible without sideways scroll: met, measured in mock (no `.table-scroll` remains; sw 375).
- No scroller wider than 1.3x: met trivially (no scroller under 760).
- No mid-word clipped text: met (titles wrap on slash/words with `overflow-wrap:anywhere` only as a last resort).

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

## Internal scoring (weighted, max 60)
| Option | Usability judge | Visual-craft judge | Engineering judge |
|---|---|---|---|
| A Minimal | 36 | 33 | 40 |
| B Restructure (stacked cards) | 52 | 50 | 52 |
| C Convention (list rows + overflow) | 42 | 44 | 37 |
Internal leaning: B, with possibly a grafted compaction from C for the read-only tables (usage, billing, audit). Challenge this if wrong.

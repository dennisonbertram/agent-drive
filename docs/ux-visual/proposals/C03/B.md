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

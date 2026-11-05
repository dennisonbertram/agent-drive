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

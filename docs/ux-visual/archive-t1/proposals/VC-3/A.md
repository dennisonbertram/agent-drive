# VC-3 / A Minimal: remove the inner scroll region

## Change

Delete the nested scroller so the page is the only scroll owner.

- `apps/web/app/(app)/console/settings/settings.css`: remove `max-height: 440px; overflow: auto;` from `.settings-page .table-scroll` (lines 18-21). Keep `overflow-x: auto` only (horizontal, for narrow screens). Note that `overflow-x: auto` also turns `overflow-y` into `auto` in CSS, so use `overflow-x: clip` or wrap only the table's own overflow; verify `overflow-y` computes to `visible`.
- `.settings-audit thead`: keep `position: sticky` but it now sticks to the viewport top (`top: 0`); if the page has a sticky header, set `top: var(--header-h)` (new token, value measured from the header).
- Initial audit page size 10 rows (the "Load older events" button already exists); if the page size is set server-side, the number needs checking in the settings page component (TBD).

## Before / after

Before: a 440px box scrolls inside a scrolling page; wheel over the box never reaches "Delete your data" (top at 1036px).
After: the table is as tall as its rows; the wheel always scrolls the page.

## Wireframe

```
Before                          After
+------ page scroll ------+     +------ page scroll ------+
| Audit log               |     | Audit log               |
| +--- inner scroll ----+ |     | When  Action  Actor  OK |
| | rows...             | |     | row x10                 |
| | rows...             | |     | [Load older events]     |
| +---------------------+ |     | Delete your data        |
| Delete your data (hidden)|    |  ...                    |
+-------------------------+     +-------------------------+
```

## Files / selectors touched

`settings.css`: `.settings-page .table-scroll`, `.settings-audit thead`. No tokens except optional `--header-h` in `globals.css`.

## Effort

S (3 lines plus one test).

## Risks

- Page height grows with each "Load older events" click; "Delete your data" is pushed further down (L3 accumulation). Mitigated only by the 10-row start and by users not clicking often.
- Sticky header behavior with page scroll must be checked.

## How it meets the criteria

1. Single scroll owner: no `overflow-y` container remains on the page; test: `getComputedStyle(.table-scroll).overflowY === 'visible'` and wheel over the table changes `scrollingElement.scrollTop`.
2. "Delete your data" reachable by wheel, keyboard and touch: yes, no trap exists.
3. Growth bounded: only partially. With 200 loaded events the page is about 200 rows long; accepted risk, so the bound is "10 rows initially, 25 per click" rather than a hard cap.
4. Playwright wheel test: included.

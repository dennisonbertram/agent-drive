# VC-3 / C Convention: summary list plus full log page, danger zone last

## Pattern

GitHub's repository settings put the "Danger zone" last and keep logs on their own page; GitHub org audit log, Vercel "Activity" and Stripe "Developers > Logs" all show a short recent list in settings and send the full history to a dedicated, filterable page. Settings pages themselves never contain a scrolling table.

## Change

- Settings shows the 5 most recent audit events as a static table (no inner scroll, no pagination) with a "View full audit log" link.
- New route `/console/settings/audit` (same console shell) holds the full log with "Load older events"; the page scrolls normally and the header row is sticky to the viewport.
- "Delete your data" becomes the last section, styled as a danger zone: 1px border in `--danger-border` (new token, e.g. `#d9b4ac`), heading in `--ink`, button `.secondary`.
- Table container class `.table-scroll` is only used for horizontal overflow (`overflow-x: auto; overflow-y: visible` via `overflow-y: clip`).

## Before / after

Before: one page with a 440px inner scroller and the delete section beneath it. After: settings is short (about 900px) with 5 rows then Delete; full history has its own page.

## Wireframe

```
Settings / Activity & deletion            [Refresh]
+------------------------------------------------+
| Recent activity               [View full log >] |
| When     Action       Actor    Result           |
| (5 rows)                                        |
+------------------------------------------------+
+--------------- Danger zone --------------------+
| Delete your data              [Review and delete]|
+------------------------------------------------+
```

## Files / selectors touched

`settings.css`: remove `.settings-page .table-scroll` scroller, add `.danger-zone`. New route file `apps/web/app/(app)/console/settings/audit/page.tsx` (path assumed from the existing layout; confirm), reuse the existing audit fetch and table component. `globals.css`: `--danger-border` token.

## Effort

M-L (new route, shared component, nav link, tests).

## Risks

- A new route adds a surface that must be kept in sync with Billing/Settings shells (VC-9).
- Users who liked scanning the log in place now click once more.
- Requires the audit fetch to accept a limit of 5 (TBD; otherwise slice client-side).

## How it meets the criteria

1. Single scroll owner on both pages: neither contains an inner scroller.
2. Delete section reachable: it follows a 5-row table, so it is within about 900px, no scroll trap possible.
3. Growth bounded: the settings page is fixed at 5 rows; the full-log page grows only by user action and has nothing below it that matters.
4. Test: wheel scroll over the 5-row table on Settings changes `scrollTop`; Delete heading is visible after one PageDown.

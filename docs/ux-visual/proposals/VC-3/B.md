# VC-3 / B Restructure: split the page into Audit log and Delete data sections with in-page navigation

## Change

Reorder and group the page so long, growing content never sits above the destructive section.

- Put "Delete your data" (rare, high stakes) in its own card directly under the page heading, collapsed to a one-line summary and a "Review and delete" button.
- The audit log follows, last on the page, so it can grow without pushing anything.
- Add a small in-page anchor row under the heading: `Audit log | Delete your data` (`<a href="#audit">`, `<a href="#delete">`, 44px targets on touch).
- The audit table has no inner scroll (as in A), and rows load 25 at a time with a "Load older events" button at the bottom.

## Before / after

Before: Audit log (440px inner scroll), then Delete your data. After: Delete card first, audit log last and unbounded in length; anchors jump to either.

## Wireframe

```
Activity & deletion                         [Refresh]
Review access and permanently remove data.
 [Audit log]  [Delete your data]      <- anchors
+------------------------------------------------+
| Delete your data                                |
| Permanently remove drives and files.  [Review]  |
+------------------------------------------------+
+------------------------------------------------+
| Audit log                          OWNER ONLY   |
| When      Action        Actor     Result        |
| row ... (25)                                    |
| [Load older events]                             |
+------------------------------------------------+
```

## Files / selectors touched

`settings.css`: remove `.settings-page .table-scroll` max-height/overflow; add `.settings-anchors`. Settings page component under `apps/web/app/(app)/console/settings/` to reorder two sections and add anchor links with `id="audit"` / `id="delete"`. Use existing `.secondary` for anchors, `--border` token.

## Effort

M (markup reorder, anchors, tests for order).

## Risks

- Moving the destructive section up makes it more prominent (H2: destructive should be distinct but not dominant); keep it collapsed and `.secondary`, not red-filled.
- Users who expect the audit log first (security reviewers) get it second. Anchors compensate.

## How it meets the criteria

1. Single scroll owner: no inner scroller; verified by computed `overflow-y`.
2. Delete section reachable without scrolling past events: it is above the log at 1131x959 and also reachable by anchor and keyboard.
3. Growth bounded: growth only happens below all other content, so it cannot push any other section (L3 satisfied by order, not by cap).
4. Wheel test: same Playwright check, plus an order assertion for the Delete heading above the Audit heading.

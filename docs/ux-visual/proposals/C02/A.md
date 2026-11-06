# C02-A Minimal: fix the three inline blocks in place

## Change
Keep the existing `.empty` markup. Add one tiny `StateBlock` function inside console.tsx (title, body, optional action, `tone`) used by the loading, error, empty and no-match cases so the five tabs stop hand-rolling them. Specific fixes:
- Error: title "Could not load files." (Trash: "Could not load deleted files."). Map `TypeError: Failed to fetch` to "The service did not respond. Check your connection and try again." (one `friendlyError()` helper wrapping the catch at console.tsx:324 and :332). Retry already exists. Add new token `--danger: #b3261e` in globals.css (the system has no error colour; `.led--warn` is the only semantic colour) and use it for a 3 px left rule on the block and the title. `role="alert"` stays. Suppress the "Ready for your first file" block when `fileFailure` is set (the condition is already there; the false empty seen in F05 comes from the *page* banner path, so also stop calling `setError` for list failures).
- Loading: render the block immediately (no delay), with a `useEffect` timer (10 s) that flips the text to "Still loading. This is taking longer than usual." and adds the Retry button.
- Reserved space: the error/loading/empty block lives inside `.file-panel` with `min-height: 220px`, so swapping loading to error to empty moves nothing. Remove the page-level `errorBanner` for list failures (the 56 px shift).
- Filter: zero matches shows "No files match “x”." plus a "Clear filter" button. Panel footer sticks to the bottom of the panel (`.file-panel` is a flex column, footer `margin-top:auto`), so one row leaves at most a small gap.
- Trash columns: the DELETED column gets `min-width: 11ch` and `white-space: nowrap`; the constant RECOVERY column ("Versions preserved" in every row) is deleted and its meaning moves to the page subtitle.
- Count: keep the sidebar badge and the panel footer ("5 loaded"); drop the drive-strip count on Files.

## Before / after
```
Before: [Failed to fetch]            (page banner, shifts content 56 px)
        Ready for your first file.   (false empty)
After:  +-- All files / drive -----------------+
        | | Could not load files.              |
        | | The service did not respond...     |
        | |  [Retry]                           |
        +--------------------------------------+
```

## Files
apps/web/app/(app)/console/console.tsx (lines ~263, 324, 332, 512, 814-968), apps/web/app/styles/console.css (.empty block ~666, .file-panel ~524), apps/web/app/globals.css (add --danger).

## Effort and risk
S. Risk: five tabs still differ because only Files/Trash use the block; Agents, API keys and Usage keep their own copy (they get the same helper where cheap). A new colour token is added to the system, so it needs a line in docs/design/spec-brief.md.

## Acceptance criteria
1. Plain message, Retry, `--danger` colour, role=alert, empty block hidden: yes (above).
2. Loading: block shows on first render (< 150 ms); 10 s timer adds "Still loading" and Retry: yes, for Files and Trash only.
3. No shift: panel min-height absorbs the swap; page banner removed for list errors: yes.
4. Filter copy, Clear filter, footer pinned to panel bottom so at most 24 px below the footer when one row matches: yes.
5. Trash: nowrap + min-width on DELETED, RECOVERY column removed: yes.
6. Count at most twice: sidebar badge plus footer: yes.

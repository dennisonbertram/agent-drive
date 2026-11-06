# C04 + C14 / A: Minimal (keep the table, add hierarchy)

Pairs with C05/A. Covers C14 (390px list) in the same change.

## Change
Keep the existing panel and table. Add what the Files list lacks, with existing components:
1. Folder rows derived on the client from `file.path` (the list API already returns full paths; no server change in phase 1). Current folder lives in the URL: `/console?drive=<id>&path=/inbox/x`. Folder rows sort first, show a folder icon, name and "N items".
2. Breadcrumb above the list: `research-bot / inbox / x`. Each segment is a link (`<a>`), so Back and reload work.
3. Sortable headers (`Name`, `Size`, `Modified`) as `<button>` inside `<th aria-sort>`. Default `modified desc`. Sort lives in the URL (`sort=modified:desc`).
4. A two-option segmented control "Browse | Recent". Recent calls `GET /drives/:id/recent`, keeps put/copy/move events, dedupes by path, shows 50 files.
5. File-type icon (inline SVG, 5 glyphs: folder, text/code, image, archive, generic) in front of the name. Name only; the folder prefix is gone.
6. Toolbar: one orange primary "Connect an agent" (opens the existing connect panel); "New drive" and "Refresh" become secondary.
7. Last-used drive: `localStorage['ad.lastDrive']` (a drive id, not secret), read in `refresh()` instead of `nextDrives[0]`.
8. Drive strip rendered only when `tab` is Files or Trash. Filler subtitles and footer copy removed; the page subtitle becomes the count line "29 files in research-bot".
9. File actions: row keeps one primary (Download, see C05/A) and a `⋯` menu (Versions, Share when C03 lands, Trash). Shared with C03.

## Before / after (1440)
```
BEFORE  /inbox/x/2026-11-01.jsonl  577 B  research-bot  Nov 6      [Download] Versions Trash   (x29, full paths)
AFTER
 research-bot / inbox / x                        [Browse|Recent]  [Filter]   [Connect an agent] [New drive]
 [ ] Name  v          Size    Modified v   Author           
 [d] logs              6 items  Nov 6        -
 [f] 2026-11-01.jsonl  577 B    Nov 6 11:55  research-bot       [Download] [...]
 [f] 2026-11-02.jsonl  577 B    ...
```
## At 390 (C14)
Table stack card (174 px) replaced by a two-line row, 60 px:
```
[icon] 2026-11-01.jsonl                [...]
       577 B · Nov 6 · research-bot
```
Row tap = Download (C05 prompt if locked). `⋯` is a 44x44 target. Panel toolbar becomes one row: breadcrumb (truncates the middle) + a filter icon that expands a field; sort moves into a "Sort: Modified" select. Drive ID and Copy go into the drive tile menu. Drive strip is a 44 px horizontal chip row. Estimated before the first row: breadcrumb 44 + sort/filter 44 = 88 px. Estimated first screen: about 10 rows (unmeasured).

## Files touched
`apps/web/app/(app)/console/console.tsx` (list block ~L789-1010, `refresh`, drive strip render, `page.tsx` to read `searchParams`), `apps/web/app/styles/console.css` (`.table-stack` mobile rules replaced by `.file-row`), new small `file-icon.tsx` and `file-tree.ts` (pure function: items + path -> folders/files, with a unit test). No new tokens.

Effort: M. Folder counts for drives with more than 100 files need server aggregation (see Risks).

## Risks
- Folder item counts come from loaded rows (limit 100). With `nextCursor` set, show "100+" and load more on scroll; exact counts need a `delimiter=/` option on `GET list` (backend, S/M, not required for phase 1).
- Modified sort is client-side across loaded rows only (API orders by path). Same limit; load all pages for drives under ~1,000 files.
- The `Files` sidebar badge (100 vs 114) is a separate bug; this change does not fix it.
- Encryption: none. Paths and sizes are already visible to the service (footer says so). No browser write capability added.

## Acceptance criteria
1. Folder rows, name-only files, breadcrumb, `path` in URL: yes (items 1-2, 5).
2. Sort with arrow, keyboard-operable: buttons in `th`, `aria-sort`, default Modified desc (item 3).
3. Recent view from the `recent` API: item 4.
4. Type icon, no mono full path title: item 5; mono is dropped for names.
5. One orange primary acting on files: "Connect an agent"; New drive secondary (item 6).
6. Last-used drive: item 7.
7. Drive strip hidden on Agents/API keys/Usage: item 8, frees 74 px (>= 70).
8. No page scroll at 1440x900: list stays inside `.file-panel`; one fewer 74 px block on account tabs; Files unchanged in height.
9. Filler removed: item 8.
C14: row 60 px (<= 64); about 10 rows visible (>= 8); toolbar about 88 px (<= 120); at 768 the table keeps Name, Size, Modified and drops Author, no subtitle to truncate, panel title is the breadcrumb (truncates, never wraps).

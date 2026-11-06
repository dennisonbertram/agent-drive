# C02-B Restructure: a shared `<ListState>` that owns the whole list lifecycle

## Change
Create one component in apps/web/app/(app)/console/list-state.tsx and a `useListLoad(path)` hook, used by Files, Trash, Agents, API keys and Usage. The hook returns `status: 'loading' | 'slow' | 'error' | 'ready'`, `items`, `retry()`. `<ListState>` renders exactly one of: skeleton rows (3 rows of the real column grid, grey bars, no spinner), slow notice ("Still loading." + Retry after 10 s), error ("Could not load X." + plain reason + Retry), empty (title, one sentence, one action), or the children. Because status is a single value, "error plus empty" cannot both render, which fixes the false empty state at its cause instead of by condition ordering.
- The skeleton uses the table's own column template so loading to ready shifts nothing (criterion 3). The error and empty cases render in the same min-height box as the 3 skeleton rows.
- Filter zero matches is a variant of empty: "No files match “x”." with Clear filter. Filter input and footer sit in the panel header/footer rows, so the panel height is content-driven but never shows a dead band: one-row results end 12 px under the footer.
- The three counts collapse to one: the footer ("5 files") is the only one; the sidebar badge stays as a nav hint (counts toward the limit of two).
- Trash gets its own column set: Path, Deleted (full date and relative time, `nowrap`), Size, with Restore as the only primary. "Versions preserved" is removed.
- Error colour: add `--danger` and a `.state-error` rule in a new section of console.css; documented in the design system.

## Before / after
```
loading:  | ▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ▒▒▒▒▒   ▒▒▒▒ |  x3 rows, same grid
error:    | Could not load files.  [Retry] |  same height
ready:    | rows |
```

## Files
New list-state.tsx (about 90 lines); edit apps/web/app/(app)/console/console.tsx (replace the inline blocks at 814-968 and the equivalent Agents/API keys/Usage branches), console.css (+.state-*, .skeleton), globals.css (--danger).

## Effort and risk
M. Risk: refactoring all five tabs touches a 1580-line file that other clusters (C04, C03) are also editing; merge conflicts are likely, so land it first. Skeletons need the column template extracted to a CSS variable.

## Acceptance criteria
1. Plain message, Retry, danger colour, role=alert, no empty block: yes, by single status value.
2. Skeleton at first paint, "Still loading" + Retry at 10 s on every list: yes, all five tabs.
3. Zero shift: same grid and min-height in all states: yes.
4. No-match copy, Clear filter, no more than 24 px below the footer: yes.
5. Trash full date, no constant column: yes.
6. Count at most twice: yes (footer plus sidebar badge).

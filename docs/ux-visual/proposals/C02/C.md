# C02-C Convention: what mature products do

## Reference patterns
- **Linear and GitHub**: lists show skeleton rows in the real grid, never a spinner; failures replace only the list body with "Couldn't load X" plus Retry, and the rest of the page stays put (GitHub's "Something went wrong" blank slate).
- **Google Drive**: a failed list shows a bottom-left snackbar "Couldn't load files. Retry" while the list region keeps its last content; empty states are only shown after a successful load.
- **Dropbox**: search with no results says "No results for 'x'" with a "Clear search" link; trash rows show a full "Deleted" date column.
- **Vercel**: error blocks are bordered boxes with a red icon, one sentence, and a single Retry button.

## Change
Adopt that pattern as three design-system components documented in docs/design/spec-brief.md: `.state-skeleton`, `.state-error` (red icon via `--danger`, one sentence, Retry), `.state-empty`. Content-level rules:
- Load failure: replaces the list body only. If a previous successful page exists, keep its rows visible, dim them, and show the error as a one-line inline bar pinned in the panel header (reserved 36 px strip, so nothing shifts).
- Empty is shown only after a successful response. Filter has its own text ("No files match “x”") and a "Clear filter" link, as in Dropbox search.
- Count: one count, in the panel header next to the title ("Files · 5"); the footer text and drive-strip count are removed (Drive and Dropbox show no footer count).
- Trash columns follow Dropbox: Name, Deleted (full date), Size; Restore is the only row action.
- The panel is a flex column; the footer line is removed so the one-row filter case has no band below it.
- Slow load: at 10 s the skeleton is kept and a line "Still loading." with Retry appears under the header (Linear shows the same "taking longer" hint).

## Files
apps/web/app/(app)/console/console.tsx, console.css (state-* classes, panel header strip), globals.css (--danger), docs/design/spec-brief.md (document the three components).

## Effort and risk
M. Risk: removing the footer drops the "File contents encrypted · Paths and metadata visible to the service" line, which is a product-honesty message; it must move (to the drive strip tooltip or the connect panel), and that needs product approval. Keeping last rows visible after a failed refresh means trusting stale data; label it "Showing earlier results".

## Acceptance criteria
1. Plain message, Retry, danger colour, role=alert, no empty block: yes.
2. Skeleton at first paint, 10 s "Still loading" with Retry: yes.
3. No shift: reserved 36 px strip and a panel min-height: yes.
4. No-match copy and Clear filter: yes; footer removed so nothing below the footer: yes.
5. Trash full date, no constant column: yes.
6. Count appears once (header): yes.

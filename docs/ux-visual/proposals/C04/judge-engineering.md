# C04 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option                | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
| --------------------- | -------- | ---------- | ----------- | --------- | ------ | ----------- | -------- |
| A Table + hierarchy   | 4        | 4          | 4           | 4         | 3      | 4           | 46       |
| B Tree + details pane | 3        | 2          | 3           | 4         | 4      | 1           | 36       |
| C Drive/Dropbox model | 4        | 3          | 3           | 4         | 5      | 3           | 45       |

- Folder derivation over paged lists, checked against `handler.ts` (list at ~1540): the API returns full paths ordered by `path`, 100 per page (`MAX_PAGE_SIZE`), cursor paging, and `prefix` is a recursive `LIKE`, not one level. So folder rows and counts can only be derived client-side from loaded rows. A states this ("100+", Modified sort over loaded rows only). It is honest but incomplete: sorting by Modified on a partly loaded drive silently gives a wrong order.
- Mitigation for any option: pure `file-tree.ts` (A and C both plan it, with a unit test), load pages up to a cap (say 1,000), pass `prefix` when inside a folder to narrow the fetch, and show "Showing first 1,000" when capped. Counts and Modified sort are labeled as over loaded items. Recent uses the `recent` event stream (seq cursor, includes put/copy/move) and must dedupe by path, as A says.
- B is the largest build: three new patterns, three scrollers (puts the no-page-scroll criterion at risk), tree with lazy prefix loads, and a console.tsx split mid-flight while C02/C03 are editing it. It also duplicates C03's Versions dialog. Reject.
- C has the best Dropbox feel (Recent in the rail, drive dropdown in the title, FAB on phones) but needs a split button, FAB and lock button as new patterns, and its "+ New" default of "Connect an agent" is a mismatched label. The 56 px mobile row and FAB are good ideas but not required.
- No encryption change in any option; paths and sizes are already visible to the service. Upload (C, optional) would run `encryptFile` in the browser with the drive key and send ciphertext only, which is consistent with the model, but it is out of phase 1 and should stay out.
- Conflicts: C02-B and C04 share the list-state component and column template; C04-A and C05-A both edit the toolbar (chip, filter, primary button); C03 owns the row menu.

**Pick: A.** Grafts from C: Recent reachable as its own view in the URL (`view=recent`), and the 56 px two-line mobile row. Optional if cheap: C's drive name as the first breadcrumb segment (drops the drive strip on Files too).

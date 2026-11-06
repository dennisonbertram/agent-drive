# C02 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Inline StateBlock | 4 | 4 | 3 | 4 | 3 | 5 | 45 |
| B ListState + useListLoad | 5 | 4 | 5 | 5 | 4 | 3 | 54 |
| C Convention | 3 | 3 | 3 | 3 | 4 | 3 | 38 |

- B fixes the false empty state at its cause: one `status` value cannot be both error and empty. A fixes it by condition ordering and stops calling `setError` for list failures, which is correct but leaves Agents, API keys and Usage hand-rolled (A "Effort and risk"). Owner goals reward consistent states across every list.
- B's risk is real: it edits all five tabs in a 1,580-line file that C03 and C04 also edit. B says land it first, and I agree. C04-B's list-state sharing means C02-B is the natural base; C04-A needs the same status values anyway.
- B's skeleton uses the table's column template. C04 changes the columns (icon, folder rows, Author hidden), so the template must be extracted as a CSS variable after C04's column decision, or the skeleton should be generic bars.
- C removes the panel footer. That footer carries "File contents encrypted / Paths and metadata visible to the service" (C "Effort and risk"). Dropping a privacy disclosure is a product decision, not a UX tweak. C also keeps stale rows on a failed refresh, which is more state to test.
- Test: unit test for `useListLoad` (loading, slow at 10 s with fake timers, error, ready, retry) and one layout assertion that swapping loading to error moves nothing by more than 2 px.

**Pick: B**, built first, scoped so Files and Trash adopt it in the first PR and the other three tabs follow. Grafts: A's `friendlyError()` mapping of `Failed to fetch` and A's reserved `min-height` on the panel. Keep the encryption/metadata footer line (reject C's removal).

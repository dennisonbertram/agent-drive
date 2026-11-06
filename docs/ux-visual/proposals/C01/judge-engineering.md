# C01 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Minimal | 5 | 5 | 4 | 4 | 4 | 5 | 54 |
| B Shell | 5 | 3 | 5 | 5 | 4 | 3 | 52 |
| C Hamburger sheet | 4 | 2 | 4 | 4 | 4 | 2 | 42 |

- A meets all six criteria with one server component, `<details>` and no JS. It deletes more CSS than it adds (A "Files and tokens").
- B is the better structure but moves `/`, `/pricing`, `/sign-in`, `/sign-up` into a route group. Every relative import and the Clerk catch-all routes are at risk (B "Risks"). The gain is mainly the auth-page frame, which A's one-line cross-link already covers.
- C adds a focus-trapping client sheet. By its own admission it is the most code and any bug there is an accessibility bug. Criterion 5 depends on a Clerk footer nobody has seen (problems.md gap 1), so it is unverified.
- Shared by A, B and C: `/pricing` becomes dynamic if the header reads the session (A "Risks"). Check the cost. If it matters, render the signed-out header statically and swap only the CTA on the client.
- Test: an e2e at 1440/768/390 asserting one "Sign up free", no "Console" link when signed out, and 44 px targets. Page-object selectors for the old nav need updating.

**Pick: A.** Grafts: B's secondary "Create a free account" button in the hero beside the first Copy panel (owner goal is sign-up, cost is one link). Keep A's `<details>` menu; B's two-row phone header is also fine if the menu feels hidden in review.

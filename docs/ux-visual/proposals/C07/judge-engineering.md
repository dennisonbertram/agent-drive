# C07 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Reorder + shrink | 5 | 4 | 4 | 4 | 4 | 5 | 52 |
| B Decision card, sticky bar | 4 | 3 | 3 | 5 | 4 | 2 | 44 |
| C OAuth consent layout | 4 | 4 | 4 | 4 | 4 | 4 | 48 |

- A is a reorder inside `connect.tsx` and `connect.css`, no new component, and meets all eleven criteria on paper. B adds radio cards, a sticky footer inside a scrolling card (keyboard-open risk on phones) and a Deny button. C is a middle path.
- Security detail: the pairing code check is the anti-phishing step. A's text moves the code under the heading, but its ASCII layout puts "Code ... matches your terminal?" below Approve and the existing-drive button. Approving before reading the code defeats the point. B (footer) and C (line directly above the buttons) place it correctly.
- Deny: the route exists (`console.device.deny`, handler.ts ~290 and ~1853), so B and C are not inventing an API. Still, a Deny button is new behavior beyond the acceptance criteria. Leave it out of this change unless the owner wants it.
- Offer polling (A, B, C): one request per 5 s while the card is open, capped at 10 minutes. Fine, but it needs a test with fake timers, and the existing 409 fallback must stay.
- Drive-key wording must change to the console's one word in the same PR as C10, or the two surfaces disagree.
- Test: Playwright at 1440x900, 768x1024, 390x844 asserting Approve inside the viewport (existing-drive form at 1440; within 300 px scroll at 390), heading font size greater than code font size, inline error next to its field.

**Pick: A.** Grafts: C's placement of the code line directly above Approve, and C's capability-phrased permission list. Skip Deny.

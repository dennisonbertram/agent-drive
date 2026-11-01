# UX improvement ledger

Baseline: `75fad601`. User requested five rounds. Evidence and alternatives: `../ux-flow/report.md`, `../ux-walker/findings.json`, `../ux-visual/problems.md`.

Adaptation: lead owns design/rendered implementation; local automated checks and replacement code review replace Claude-specific model/worktree orchestration. One cumulative PR, not five dependent unmerged PRs. No GitHub Actions or paid narration. Before screenshots are real baseline captures, not recreated mockups. No merge until authorized.

| Round | Area                                 | Status           | Verification                                                                                                                     |
| ----- | ------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Scope-bound file loading/error/retry | Verified locally | Regression failed on baseline, passed after; real-row Retry verified with simulated 503; desktop/mobile pixels reviewed          |
| 2     | Honest filtered-empty recovery       | Verified locally | Regression red→green; 100→101 real rows and clear/absent variants verified; desktop/mobile pixels reviewed                       |
| 3     | Local spending-control feedback      | Verified locally | Regression red→green including blank amount and valid save; lead submitted invalid mobile form and inspected error beside inputs |
| 4     | Dialog focus restoration             | Verified locally | Regression red→green for Escape and close button; lead checked visible restored focus ring after Escape                          |
| 5     | Discoverable mobile navigation       | Verified locally | Regression red→green; desktop selector includes drive-count badge; lead used menu at 375/320px and verified desktop nav          |

## Before/after evidence

Original baseline screenshots remain in the session artifacts; no secret-bearing screenshots are committed. `session-artifacts/` and `session-recordings/` references in baseline reports are artifact identifiers, not repository paths; the PR and Devin session carry the selected media. After artifacts are under `agent-drive-ux/visual/`:

- Round 1: `round1-after-inline-failure-{1440,375}.png`, `round1-after-retry-rows-{1440,375}.png` (before: baseline 26).
- Round 2: `round2-after-unloaded-no-match-{1440,375}.png`, `round2-after-target-loaded-{1440,375}.png`, `round2-after-absent-no-match-{1440,375}.png` (before: baseline 14/15).
- Round 3: `round3-error-{desktop,mobile}.png` (before: `billing-submit-before.png`, baseline 35–37).
- Round 4: `round4-focus-desktop.png` (before: walker W-005 and its focus evidence; focus is behavioral, not just a screenshot).
- Round 5: `round5-{closed,open}-mobile.png`, `round5-open-320.png`, `round5-desktop.png` (before: `mobile-nav-before.png`).

Final review also clears scope-bound failures on a subsequent successful tab reload; the regression checks switching Trash→Files after a failure as well as local Retry. Existing browser tests continue to cover actual encryption and storage; new UX tests mock API responses deliberately to isolate reproducible UI states.

## Final gate

All five rounds passed the final bounded browser regression against the original synthetic Harbor Research owner, with real local PostgreSQL/MinIO and simulated failure responses explicitly labeled. Billing settings were restored, all route interceptions removed, and no secrets were generated or shown. One annotated recording and the final screenshots accompany the PR/session; annotations replace unavailable narrated audio. No external model review or merge is claimed.

| Local check                                       | Result                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Focused UX browser regressions                    | 5/5 pass; all five failed at the intended baseline assertion before implementation     |
| Lint / formatting                                 | Pass, two existing non-fatal navigation warnings                                       |
| Typecheck                                         | Pass                                                                                   |
| Unit                                              | 67 pass                                                                                |
| Integration                                       | 49 pass                                                                                |
| MCP                                               | 1 pass                                                                                 |
| Full E2E against existing preview                 | 8/9 pass; sharing test required the managed server log, absent in the reuse adapter    |
| Sharing E2E under standard managed-server harness | 1/1 pass, including actual server-log secret-exclusion assertions; no fallback needed  |
| Build                                             | Pass with NODE_ENV=production                                                          |
| Replacement review / diff whitespace              | Pass                                                                                   |
| Final recorded browser pass                       | Five improvements plus tab-return recovery; desktop/mobile; original settings restored |

The ignored existing-preview config disables Playwright's server startup solely to reuse the canonical running preview. It does not replace test assertions. The sharing test was rerun with `pnpm test:e2e tests/e2e/sharing.spec.ts` and the unmodified standard config, not skipped. All nine E2E scenarios passed across those runs; not claimed as a single 9/9 run.

The final bounded retest does not convert the baseline's 17 partial and 8 untested stories into complete coverage. Provider and hosted limitations remain; no claim of production acceptance or exhaustive accessibility coverage. No GitHub Actions ran. This work is delivered on a separate branch for review, not merged.

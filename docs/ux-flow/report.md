# UX flow critique

Baseline: `75fad601`; synthetic local app at canonical localhost:3100.

## Method and boundaries

Live representative walkthrough, then lead inspection of actual desktop/mobile pixels. Evidence: `flow-baseline/actions.json` (114 action groups) and `flow-baseline/report.md` in the delivered audit artifacts. These groups include retries, grouped inputs, fixture setup and screenshot positioning; **114 is not a happy-path click count**. No invented aggregate friction ratio. Catalog ideals mix granular and grouped actions, so only equivalent segments are compared.

## Friction scorecard

| Journey                      | Observed actions / ideal                               | Verdict           | Evidence                                              |
| ---------------------------- | ------------------------------------------------------ | ----------------- | ----------------------------------------------------- |
| First drive (007)            | 6 / 6, matched granularity                             | Minimal           | Actions 5–10; keep backup acknowledgment              |
| Loaded-page filtering (010)  | Not comparable: starting drive already selected        | Needs improvement | 34–35, 109–111; blank table with no recovery guidance |
| Missing share fragment (021) | 3 / 3 navigation groups, excluding sender interaction  | Minimal locally   | 75–77; complete link downloads without login          |
| Spending controls (028)      | Not comparable: deliberately invalid inputs            | Needs improvement | 79–85; error requires scrolling to page top           |
| Abandon deletion (036)       | Not comparable: two negative confirmation probes added | Acceptable        | 94–99; leave safely before submit                     |

## Ranked proposals

1. Separate loading, failed, true-empty and filtered-empty file states. The simulated 503 ends the request but still shows “Loading files…” and onboarding guidance (screenshot 26). A retry belongs in the failed panel; no onboarding action during loading/failure. No API changes needed.
2. Explain loaded-only filtering when zero rows match and keep loading more discoverable. Screenshot 14 has an empty table but 100 loaded files; screenshot 15 finds the target on page 2. Do not promise global search or automatically fetch unlimited pages.
3. Put spending-control errors beside their fields/form with plain-language email guidance. Screenshot 37 exposes `alertEmail`/`alertThresholdCents`; action 81 is a detour to the top. Preserve server validation and the distinction between a write cap and invoice ceiling.
4. Evaluate mobile navigation and table actions in the visual audit. At 375px, destinations and row actions are horizontally hidden. This is an observed scroll requirement, not document overflow or proven keyboard failure.

## Already minimal / keep

Keep the first-drive recovery acknowledgment: losing the only key is irreversible. Keep destructive confirmations. Preserve expired-share anonymity and no-login recovery. Preserve “Key loaded” rather than “verified”: only successful decryption verifies a syntactically valid key. Disabled checkout truthfully explains missing provider configuration. Do not turn it into fake payment success.

## Next

Formal walker must classify all 42 catalog stories as tested, partial or untested, not extrapolate this representative pass. Visual inventory and five judged improvement rounds follow. No issues filed; no hosted/provider acceptance claimed.

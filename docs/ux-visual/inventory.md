# Visual inventory and judgment

Baseline `75fad601`. Reused walker screenshots/geometry without rerunning measurements; inspected contact sheets and critical full-size shots, then personally used the console, New drive/Escape, mobile Agents navigation and invalid billing form in the existing Chrome. Evidence lives in `agent-drive-ux/{flow-baseline,walker,visual}` attachments, outside git to exclude private fixtures.

| Surface          | Groups / components                                                                 | Observed states                                                    | Boundary                            |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Landing, pricing | Brand, primary/secondary CTAs, terminal, feature/plan cards, disclosures            | Public desktop/mobile                                              | No live signup                      |
| Sign-in/up       | Centered brand/card, configuration notice                                           | Configured-off                                                     | No Clerk screens                    |
| Console shell    | Sidebar, navigation, topbar, heading/actions, footer                                | Empty/populated, mobile/desktop                                    | Single-owner model; no team role UI |
| Files/Trash      | Drive selector, key badge, info banner, filter, table/actions, pagination           | Loading, simulated error, populated, filtered, empty, long content | Intentional table scrolling         |
| Dialogs          | Native dialog, heading/close, form, receipt, acknowledgment, versions               | Open, validation, keyboard dismiss, masked receipts                | Secrets excluded from artifacts     |
| Agents/API keys  | Empty state, entity rows, permissions, revoke actions, CLI guidance                 | Empty/populated, revocation                                        | No browser upload                   |
| Usage            | Metric cards, drive/author tables                                                   | Empty/populated, long names                                        | Not an invoice                      |
| Billing          | Header, metrics, plan cards, provider banner, controls, CSV table                   | Free/provider-off, error/recovery, invalid and saved form          | No live payment/hosted email        |
| Settings         | Header, audit table, warning disclosure, typed-confirmation forms, deletion records | Empty/populated, pagination error, Pending, accepted-refresh-error | No worker completion/purge proof    |
| Share            | Compact card, metadata, download, loading and error copy                            | Missing/wrong key, expired/revoked, decrypting, success            | Synthetic links only                |

## Design rules

Existing tokens and reusable `.button`, `.banner`, `.empty`, `.panel`, `.nav-item`, `.table-scroll` styles live in `app/globals.css`; billing/settings extend them. Keep the dark-green/lime identity, one strong primary task per group, secondary navigation, visible focus and truthful encryption boundaries. No wholesale redesign or new component dependency.

## Pixel judgment

Desktop hierarchy is coherent: primary actions have contrast, data panels align, destructive controls are separated and readable. Mobile plan/settings stacks are long but justified by distinct content; collapsing financial/deletion disclosures would hide important meaning. Tables intentionally scroll; do not call their minimum width document overflow.

The mobile console navigation is the strongest layout issue: late destinations are hidden beyond a horizontal strip. Its scroll thumb competes with the primary header and gives no clear indication which destinations are missing. A collapsed, explicitly labeled menu can expose all destinations on demand while preserving vertical room for files.

The failed-list panel is visually misleading: onboarding copy and a Connect action compete with an error above it. Filtered-empty results have no hierarchy at all. Billing validation is invisible at the submission scroll position. Modal dismissal needs restoration of visible keyboard focus.

## Coverage limits

Walker provides 114 geometry observations at four viewports, with intentional scrolling and false positives adjudicated. This is bounded state coverage, not every possible viewport/provider/assistive technology combination. Not every route was captured at every size. No dark theme exists. External MUSE/Gemini opinions and paid narrated audio were not run; lead evidence-based alternatives replace those Claude-specific stages. Unavailable states remain unverified rather than invented.

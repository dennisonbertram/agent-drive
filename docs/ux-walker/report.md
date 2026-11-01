# UX-walker baseline — 75fad601

Local synthetic browser execution; **not live authentication, payment, email or
production acceptance**. No product changes, issue filing or shell suites.
Playwright adapted the installed ux-walker and geometry reference. Services reused:
localhost3100, PostgreSQL5432, MinIO9000. Disposable walker owner is separate from
the preserved Harbor Research baseline owner.

## Reading the coverage

`tested` means the catalog's bounded local UI journey was exercised; it does not
mean flawless UX. `partial` is never counted as passed. `untested` means no relevant
story execution, including provider/CLI-only stories. Earlier sharing/billing/
deletion runs on other revisions are NOT credited here.

- **B**: `session-artifacts/flow-baseline/report.md`, actions.json and
  screenshots.json. Same revision; verified portions reused, not replayed.
- **W**: `session-artifacts/walker/`. `E###` indexes screenshots.json;
  actions.json is the numbered delta log, assertions.json records checks.
- The table below is mirrored structurally in run-history.json. Exact catalog
  titles remain in `docs/ux-paths/catalog.md`; IDs are authoritative.

All42 stories classified: **17 tested,17 partial,8 untested**. These are coverage
statuses, not17 aggregate UX passes. Five findings remain open.

| Story     | Status   | Exact verified portion                                                                                                                                                | Remaining portion                                                                                                                             | Evidence                                 |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| STORY-001 | tested   | Landing explanation, pricing navigation and local signup handoff                                                                                                      | None within bounded public story; no account enrollment asserted                                                                              | B; E099–E102                             |
| STORY-002 | tested   | Published Free/Developer/Team prices, allowances and disabled-checkout disclosures                                                                                    | No live checkout asserted by this public comparison story                                                                                     | B; E103–E106                             |
| STORY-003 | partial  | Synthetic authenticated console continuation; anonymous console redirects to disabled sign-in                                                                         | Real Clerk sign-in, existing-user session and sign-out                                                                                        | E003–E004                                |
| STORY-004 | partial  | Synthetic empty personal workspace and first-drive distinction                                                                                                        | Real signup/identity provisioning                                                                                                             | E001–E002; E005–E006; B                  |
| STORY-005 | tested   | Signup-disabled notice, brand recovery, Open console→sign-in-disabled notice                                                                                          | None within configured-off branch                                                                                                             | A001–A002; E001–E004                     |
| STORY-006 | tested   | Simulated initial pending/503, creation disabled, Refresh recovers same empty owner without drive duplication                                                         | Actual provider outage not asserted                                                                                                           | E019–E024; C006–C008                     |
| STORY-007 | tested   | One-time recovery backup/acknowledgment guard, private backup, duplicate-name modal error; keyboard open/Escape                                                       | Focus-return issue W-005; no claim of full assistive-technology compliance                                                                    | B; E015–E018; E025–E026                  |
| STORY-008 | partial  | Invalid recovery JSON, wrong key, Forget key, correct protected recovery file; real browser plaintext equality                                                        | Final correct-key Forget/reload/re-unlock repetition not replayed                                                                             | B                                        |
| STORY-009 | partial  | Public pricing, synthetic workspace/drive backup and rendered agent/key setup                                                                                         | Real signup, full pricing-to-CLI handoff; fixture CLI is setup, not UI pass                                                                   | B; E005–E006                             |
| STORY-010 | tested   | First-page filter, pagination to target; clear restores100 rows; switching drives resets filter                                                                       | Filter no-match friction W-002                                                                                                                | B; E027–E030; C043–C044                  |
| STORY-011 | tested   | Two known versions→restore exact V1→three retained entries; downloaded current bytes equal original                                                                   | None in local version-restore journey                                                                                                         | E031–E036; C009–C011                     |
| STORY-012 | tested   | Native cancel/confirm trash, retained history, UI restore; empty trash with/without drives                                                                            | None in local trash journey                                                                                                                   | B; E011–E012; E037–E038                  |
| STORY-013 | partial  | UI agent/key creation, read-only replacement, old-key revoke; baseline supporting denial probes                                                                       | Full narrated CLI credential replacement/identity workflow not a UI pass                                                                      | B; E077–E078                             |
| STORY-014 | partial  | Two-active-key collector; cancel preserves2, confirm shows0/revoked; unrelated auditor remains1                                                                       | Post-revocation identity requests using both tokens and unrelated token                                                                       | E075–E078; C021–C024                     |
| STORY-015 | tested   | Real retained versions, storage by drive/author, Human console attribution; Billing handoff                                                                           | No payment/observed-egress-provider acceptance asserted                                                                                       | E039–E050                                |
| STORY-016 | untested | None; MCP-host story                                                                                                                                                  | Stdio tools, binary handling and real host integration                                                                                        | Catalog CLI/MCP-only                     |
| STORY-017 | untested | None; CLI concurrency story                                                                                                                                           | Competing writes, conflict and deliberate CLI retry                                                                                           | Catalog CLI-only                         |
| STORY-018 | untested | Share SDK fixture creation is setup only                                                                                                                              | CLI invalid expiry correction and link issuance                                                                                               | Catalog CLI-only                         |
| STORY-019 | untested | None; MCP permission/key repair story                                                                                                                                 | Host setup, wrong-key recovery and least privilege through MCP                                                                                | Catalog CLI/MCP-only                     |
| STORY-020 | tested   | Anonymous metadata; keyboard Enter; held ciphertext shows disabled Decrypting; real download equals original; zero cookies                                            | Mobile layout inspected, not physical touch/device/browser matrix                                                                             | E061–E066; C017–C019                     |
| STORY-021 | tested   | Missing fragment error, sender instruction, corrected anonymous link and exact downloaded bytes                                                                       | None within local truncated-link recovery                                                                                                     | B                                        |
| STORY-022 | tested   | Wrong well-formed file key→decryption error/no download; correct hash clears error and byte-correct download                                                          | None within local wrong-key recovery                                                                                                          | E059–E062; C015–C018                     |
| STORY-023 | partial  | Actual scoped synthetic expired share displays expired heading and new-link instruction                                                                               | Sender replacement issuance/delivery and replacement download                                                                                 | E055–E056                                |
| STORY-024 | partial  | Real SDK-revoked synthetic link displays revoked heading                                                                                                              | CLI list/match/revoke/pagination and storage-URL lifetime; setup SDK not UI credit                                                            | E057–E058                                |
| STORY-025 | partial  | UI trash→public unavailable; UI restore→same link metadata available; simulated ciphertext503→Share unavailable                                                       | Successful normal download after restore not completed; live storage/TLS diagnosis excluded                                                   | E067–E070; C020                          |
| STORY-026 | partial  | Anonymous pinned-original bytes downloaded after source had later current/restored versions                                                                           | Full sender CLI two-link revision workflow, delivery, selective withdrawal and B-link proof                                                   | C018; E063–E066                          |
| STORY-027 | partial  | Usage, author table, billing handoff, current CSV8 columns; baseline controls save/revisit                                                                            | No prior-period statement fixture; historical export/reconciliation and actual email/log completeness                                         | E039–E050; C012                          |
| STORY-028 | tested   | Invalid fractional cents/required email, valid controls persistence, blank cap removal                                                                                | Form feedback friction W-003/W-004; no actual email delivery                                                                                  | B                                        |
| STORY-029 | tested   | Free remains usable; paid checkout disabled with honest provider/telemetry disclosures                                                                                | No live payment implied                                                                                                                       | B; E045–E048                             |
| STORY-030 | untested | None; checkout is disabled                                                                                                                                            | Real Stripe checkout, abandoned checkout reuse and accepted synchronization                                                                   | Provider unavailable                     |
| STORY-031 | untested | None; account remains Free                                                                                                                                            | Paid-tier financial confirmation, cancellation, proration and cap preservation                                                                | Provider unavailable                     |
| STORY-032 | untested | None; no customer portal fixture                                                                                                                                      | Existing-customer invoices/portal provider handoff                                                                                            | Provider unavailable                     |
| STORY-033 | partial  | Billing Free allowances and controls surface                                                                                                                          | CLI quota failure/Upgrade link, retained-data decision and real upgrade                                                                       | B; E045–E050                             |
| STORY-034 | partial  | Simulated billing503→Refresh restores controls; simulated401→disabled sign-in route                                                                                   | Real Clerk reauthentication and post-renewal return to billing; real loading/session outage                                                   | E051–E054; C013–C014                     |
| STORY-035 | tested   | Real audit25→50, failed older-page preserves25, retry succeeds; Refresh resets25/scroll0; initial503 recovery; older drive.put403 shows agent/key/outcome at125 rows  | Hidden-target API owner-isolation probes belong to041                                                                                         | B; E079–E086; E107–E110; C025–C031; C042 |
| STORY-036 | tested   | Wrong/exact confirmation guard, switching clears input, leaving creates no job in baseline                                                                            | None within cancel/reconsider story                                                                                                           | B; C032–C033                             |
| STORY-037 | tested   | Simulated DELETE503 preserves confirmation; actual local202; accepted-but-refresh-failed alert; cleared input; real Pending on Refresh; neighbor retained             | Purge completion is not part of the accepted-request proof                                                                                    | E087–E094; C034–C040                     |
| STORY-038 | partial  | Pending job, ID, timestamps/disclosure and Refresh visible                                                                                                            | Old-request pagination, blocked/retry/complete worker transitions                                                                             | E091–E094                                |
| STORY-039 | partial  | Separate disposable owner: lowercase disabled/exact enabled; actual202; account Pending, destructive inputs disabled; Files denied; settings history remains readable | Worker cleanup, stale identity denial and real identity/payment-provider closure not exercised                                                | E111–E118; C046–C051                     |
| STORY-040 | untested | None; no blocked account purge fixture                                                                                                                                | Provider failure, retry and continued access restriction                                                                                      | Operator/provider-dependent              |
| STORY-041 | partial  | Anonymous direct settings navigation redirects sign-in; two synthetic owners isolated by session                                                                      | Other-owner agent/hidden-target/same-origin API negative matrix; no broad security pass                                                       | C002; E003–E004                          |
| STORY-042 | partial  | Actual target drive request; target absent from active selector; neighboring drive and file browsable                                                                 | Post-request neighboring encrypted download, CLI/credential/shared-link denial matrix, cross-account preservation and physical scoped cleanup | C038–C040; E089–E098                     |

## Explicit findings and geometry adjudication

Sanitized `findings.json` contains W-001–W-005 with expected/actual/repro/evidence.
W-001–004 reuse observed baseline failures/friction, not invented new defects.
New W-005: Escape closes the native dialog but returns focus to BODY rather than
the New drive trigger. Tab's occasional BODY focus corresponds to browser-chrome
cycling: no underlying application control was reached; **not reported as an
application focus-trap escape**.

114 geometry observations across118 indexed screenshots. Four viewport sets:
1440×900,1920×1080,768×1024,375×812. Landing/pricing, long-content Files,
versions/create modal, Usage, billing overview, share ready/long filename,
settings audit/history/destructive forms have four-width captures. Error/loading
and billing controls/export captures use1440/375; not every state has all widths.
All measured document horizontal overflow deltas were0. No automatic overflowSpills
were flagged. All screenshots opened in contact-1…7; full-size targeted inspection
included 768px long Files,375px long share,375px settings error.

- Intentional table/console navigation horizontal scrolling at375 is not a
  document-overflow failure. Row actions can require horizontal navigation.
- Long filename wraps aggressively at768 and long share heading increases vertical
  height at375; content/actions remain reachable by normal scrolling. No overlap or
  clipped letters established. Long select value is natively truncated in control.
- Uneven-row flags group semantically different nav items/header CTAs/table content;
  screenshot inspection did not establish malformed sibling card geometry.
- `wrappedControls` on settings load error points to the entire focusable Audit
  events table region, not a wrapped short button. False positive.
- Next dev indicator is visible; it is not production UI.

## Component/state inventory for ux-visual

Observed: public header/hero/pricing cards; unconfigured sign-in/up cards; desktop
sidebar/mobile nav; empty/no-drive Files/Agents/Keys/Trash/Usage; real populated Files,
long path/name, filter/pagination, key-required/loaded, native confirmation,
create/recovery/credential receipts (baseline masks), duplicate/invalid modal errors,
version modal and restored history; active/revoked entity rows; real usage cards/
tables and CSV; Free billing controls/disabled upgrade, invalid/saved controls;
initial pending/error/recovery; public missing/wrong/expired/revoked/unavailable/
decrypting/ready share states; audit pagination/error/retry and scroll reset;
destructive confirmation/disabled/busy/error/accepted+refresh-error/Pending states;
account exact-phrase, requested-disabled, Pending access restriction and readable
owner history.

Not covered: real auth/customer/paid/portal/provider-return screens, prior-month
statement export, blocked/complete deletion on this revision, account purge,
old-job pagination, isolated no-key-with-existing-agent positive CTA screenshot,
screen-reader/contrast/touch targets/physical mobile/cross-browser/dark-theme audit.
No product fixes or visual-design prescriptions were made.

## Execution caveats, artifacts and runtime

Locator/notice assumptions caused harness timeouts and were corrected against
rendered DOM/source; they are not product failure evidence. An initial fixture key
was scoped only to the selected neighbor; corrected via UI scoped-key creation.
Expired-share setup first hit the expiry-after-created constraint; both timestamps
were then advanced into the past only for the exact disposable synthetic share.
C027/C028 were premature async reads: awaited retests C030/C031 passed; raw checks
retain explicit adjudication. C003 is the browser-chrome focus observation above.
C041 wrongly expected403 from the first older failure, which was actually410;
continued pagination located the real agent403 and C042 passed. Not a product bug.
E063–066 have an inaccurate legacy filename `27-share-long-filename`; their pixels
are the short handoff ready state. Actual long-content proof is E071–E074.

Primary safe recording:
`session-recordings/rec-d69faae4-b232-4a0c-bc2e-14cde9c38e8c/rec-d69faae4-b232-4a0c-bc2e-14cde9c38e8c-edited.mp4`
shows only scoped deletion failure/retry/accepted Pending, no key receipts.
Do not attach `private-*` or helper files. No secret-bearing receipt was captured
in this delta. Share screenshots exclude URL chrome/fragments.
Target drive job and the separate new owner's account job remain Pending; no time
acceleration, worker or physical purge invoked. The Harbor Research owner and
neighbor-preservation fixture were NOT submitted for account deletion.
All existing services remain running. Existing Chrome is restored to the nonsecret
Harbor Research console with100 loaded rows, key in memory and no visible receipt:
`session-artifacts/walker/51-existing-chrome-clean-native.png`
(native-sized1280×841; the1440px review capture is46-existing-chrome-review-ready-1440.png).

| Drive accepted; simulated refresh failure                                                                                                             | Separate account Pending,375px                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ![Drive accepted with refresh error](https://app.devin.ai/attachments/055d96b5-1bcd-4c15-a515-e90bbfbecf11/38-delete-accepted-refresh-error-1440.png) | ![Account Pending](https://app.devin.ai/attachments/8f7184b3-78d6-4ce0-9ea3-35dae05a4bd5/48-account-pending-375.png) |

No new dependency/service setup beyond existing blueprint. No SKILL suggestion.
No current PR supplied; suggested PR comment: none. User action needed: none.

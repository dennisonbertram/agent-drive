# UX Path Catalog: Agent Drive

Generated: 2026-11-01  
Repository: [dennisonbertram/agent-drive](https://github.com/dennisonbertram/agent-drive)  
Reviewed revision: [75fad60116971cb9ea4be17cd8de18d3ce9a706a](https://github.com/dennisonbertram/agent-drive/tree/75fad60116971cb9ea4be17cd8de18d3ce9a706a)  
**Total stories: 42**, consolidated from 45 supplied stories across the five approved topic areas.  
**Evidence: source review only. No story was executed.**

## Summary

Agent Drive provides client-side encrypted storage for developers and autonomous agents. The human console manages drives, memory-only decryption keys, files/versions/trash, agent credentials, usage, billing, audit and deletion. Upload and encrypted-share creation are CLI/MCP operations, not invented browser controls. The anonymous share viewer needs the complete secret-fragment link, not a human account.

| Type   | Count |
| ------ | ----: |
| Short  |    14 |
| Medium |    24 |
| Long   |     4 |
| Total  |    42 |

All routes and five console tabs in the supplied discovery are represented below. This is **story coverage, not test coverage**. No coverage percentage is asserted: the supplied discovery is not an exhaustive enumerated feature denominator, and adjacent package capabilities remain explicitly unexpanded.

### Evidence, scope and safe-use contract

- Read-only consolidation at the requested revision; no product edits, pushes, PRs/issues, deployment, Actions, paid resources, secret inspection, browser use, screenshots, test suites or application execution. Local text-processing artifacts are outside the repository; the complete deliverable is this Markdown field.
- Applied the ux-paths consolidation format to the five already-approved catalogs. No repeated discovery, new swarm, additional workflow or repository documentation write was needed.
- Every arrow/result below is a **code-derived expectation or explicitly stated future acceptance target**, never a passed assertion. Native semantics/CSS are not rendered accessibility/mobile evidence. Existing test definitions are not executed evidence.
- **PUBLIC-LOCAL-TESTABLE:** public routes can be evaluated without human authentication; conditional deployment branches still require suitable fixtures.
- **LOCAL-SYNTHETIC-TESTABLE:** a candidate can use development-only synthetic authentication and disposable seeded services/data. This does not assert that fixtures are present or anything was tested.
- **LIVE-PROVIDER-BLOCKED / UNVERIFIED:** real Clerk enrollment/sign-in/deletion, Stripe checkout/subscription/portal/closure, email, production storage/logs/CORS/TLS and hosted release acceptance need separately approved provider-backed execution. “Blocked” here is an evidence boundary, not an observed provider outage or inspected credential deficiency. Provider-controlled screen labels are not invented.
- **CLI/MCP-ONLY:** the stated segment uses the private built repository client/stdio tools rather than a browser. CLI can list/revoke shares; MCP exposes share creation, not equivalent share inventory/revocation. **OPERATOR CLI-ONLY** identifies deletion maintenance, not an owner-facing retry action.
- Mixed journeys carry multiple labels. UI-local feasibility does not make an entire provider or CLI workflow browser-testable. API-assisted negative cases are separately labeled, not fabricated UI flows.
- **Ideal path** values are integer design benchmarks, not measured clicks, timing or friction. Detailed safety/recovery checks can exceed the benchmark. Short/medium/long describe scenario size; long stories deliberately compose atomic stories without creating extra feature coverage.
- All named people, drives, addresses, files, amounts and fixture counts are synthetic examples. IDs/variables mean future fixture-returned identifiers. Never put drive keys, API tokens, complete share fragments or identity credentials in logs, screenshots, prompts, source control or this report.
- “Personal workspace” is an account context, not an organization/team wizard. Login does not recover encryption keys. Human auth, API authorization and client-side decryption are separate boundaries. Paths, sizes, tags and activity remain visible metadata.

### Deduplication and source corrections

| Supplied stories  | Canonical story | Consolidation decision                                                                                                                                      |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONB-002 + BILL-01 | STORY-002       | One public pricing → signup handoff; retain allowances, configured-rate warnings and paid navigation alternatives.                                          |
| ONB-008 + FK-02   | STORY-008       | One key recovery/error workflow; retain empty-drive rehearsal as a no-decryption variation and populated-drive cryptographic verification as the main path. |
| ONB-009 + FK-01   | STORY-009       | One full discovery → signup → recovery → agent/key → CLI upload/get → browser download journey, rather than two overlapping first-workspace long stories.   |

Atomic creation, usage interpretation and long lifecycle stories remain where they test materially distinct goals or boundaries. Redundancy does not justify removing irreversible-action safeguards. The supplied malformed-rate warning was corrected after reading pricing source: `rates !== null && checkoutConfigured()` prevents the second call when rate parsing is unavailable. No pricing outage is inferred. Source references below are namespaced by original topic (ONB, FK, SHARE, BILL, DA), so repeated S1/A1 identifiers are unambiguous; all linked sources pin the same revision.

## Feature-to-story coverage matrix

“Represented” means concrete steps or a named variation exist, not runtime acceptance. Remaining boundaries are listed explicitly rather than hidden in a coverage percentage.

| Feature / surface                                                                   | Stories                                                                                      | Boundary or gap                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/`: value, privacy model, Pricing / Sign in / Create your workspace / Open console | STORY-001, STORY-009                                                                         | Static terminal illustration; no upload control.                                             |
| `/pricing`: plans, limits, rates, Free signup and paid billing navigation           | STORY-002, STORY-029                                                                         | Proposal constants and configured availability, not live offers/payment proof.               |
| `/sign-in`, `/sign-up`, guarded console and personal account provisioning           | STORY-003–STORY-005, STORY-009                                                               | Real Clerk provider journey unverified; synthetic session is not signup.                     |
| `/console` loading, first-workspace empty/error and Refresh                         | STORY-004, STORY-006, STORY-009                                                              | Initial and subsequent refresh semantics differ.                                             |
| First drive, client-generated recovery JSON, secure-save acknowledgment             | STORY-007, STORY-009                                                                         | Backup completion is self-attestation; no server recovery.                                   |
| Load/Forget key, recovery-file validation, wrong-key decryption                     | STORY-008, STORY-009                                                                         | Loaded badge validates syntax, not cryptographic match.                                      |
| Files and Trash selection, loaded-only filter, pagination, empty state              | STORY-010                                                                                    | Global/server metadata search is an alternative, not a complete standalone story.            |
| Browser file download, locked metadata browsing                                     | STORY-008, STORY-009, STORY-042                                                              | Browser/OS memory, download and accessibility acceptance unexecuted.                         |
| Version history, restore prior version, retain history                              | STORY-011, STORY-017                                                                         | Browser has no old-version preview/download action; CLI/MCP get can inspect without restore. |
| Trash confirmation/cancel and restore                                               | STORY-012                                                                                    | Soft deletion retains storage; not permanent purge.                                          |
| Agents creation, scoped one-time API key, login / whoami                            | STORY-009                                                                                    | CLI management-only provisioning remains an alternate, not expanded full story.              |
| API-key replacement/revoke-one, read-only and foreign-drive denial                  | STORY-013                                                                                    | No in-place scope editor or drive-key rotation.                                              |
| Agents revoke-all, unrelated-agent preservation                                     | STORY-014                                                                                    | Disposable credential fixture; run after dependent use.                                      |
| Usage: retained encrypted storage, drive quota/counts, author activity              | STORY-015, STORY-027                                                                         | Figures require runtime fixtures, not inferred measurements.                                 |
| CLI encrypted put/get, create-only and conditional-write conflict                   | STORY-009, STORY-017                                                                         | CLI/MCP only writes; no browser editor/upload.                                               |
| MCP stdio setup, identity, paginated list, binary get/output, structured denial     | STORY-016, STORY-019                                                                         | Actual external host integration remains unverified.                                         |
| CLI share creation, expiry format/range, explicit version                           | STORY-018, STORY-023, STORY-026                                                              | Complete link secret appears at creation, not recovered from inventory.                      |
| MCP share creation and permission/local-key repair                                  | STORY-019                                                                                    | No MCP list/revoke equivalents found.                                                        |
| `/s/[id]`: anonymous metadata and browser decrypt/download                          | STORY-020, STORY-026                                                                         | No sign-in needed; deployed fragment privacy/storage not proven.                             |
| Missing/invalid fragment vs valid wrong file key                                    | STORY-021, STORY-022                                                                         | Distinct pre-fetch vs post-transfer failure boundaries.                                      |
| Share expiry, listing/pagination, revoke and stale authorization                    | STORY-023, STORY-024                                                                         | Replacement rather than extension; issued URLs/plaintext cannot be recalled.                 |
| Share not-found, trashed/unavailable, network/TLS/storage failures                  | STORY-025                                                                                    | Generic guidance/no Retry; production transport unverified.                                  |
| Version-pinned share lifecycle across overwrite and selective revocation            | STORY-026                                                                                    | Viewer omits version ID; sender IDs distinguish revisions.                                   |
| `/console/billing`: estimates, retained peak, observed/authorized transfers         | STORY-027, STORY-029, STORY-033                                                              | Not connected ≠ zero; logs/providers unverified.                                             |
| Current/prior CSV exports and agent attribution                                     | STORY-027                                                                                    | Not per-agent dollar allocation; no audit export.                                            |
| Write cap, threshold/email, validation, blank/zero and persistence                  | STORY-028, STORY-027                                                                         | Cap not an invoice ceiling; actual email delivery unverified.                                |
| Checkout disabled / begin-resume / paid-tier confirmation                           | STORY-029–STORY-031                                                                          | Live Stripe/payment/proration blocked; no invented provider screens.                         |
| Customer portal, invoices/payment handoff                                           | STORY-032                                                                                    | Provider-controlled details/cancellation not expanded or accepted.                           |
| Quota failure → human billing/cap/operator decision                                 | STORY-033                                                                                    | Agent does not self-pay or delete retained data as guessed remediation.                      |
| Billing 401/non-401 refresh and persisted-control recovery                          | STORY-034                                                                                    | Real reauthentication and synchronization unverified.                                        |
| `/console/settings`: audit actors/outcomes, older pages and Refresh                 | STORY-035                                                                                    | Metadata only; no audit filter/search/export.                                                |
| Exact drive confirmation, leave safely before deletion                              | STORY-036                                                                                    | No undo after acceptance.                                                                    |
| Deletion acceptance receipt, lost refresh, idempotent recovery                      | STORY-037                                                                                    | Acceptance ≠ physical erasure.                                                               |
| Deletion history pages, pending / Needs retry / complete                            | STORY-038                                                                                    | Refresh is not worker Retry; status can reopen.                                              |
| Exact account deletion and immediate access shutdown                                | STORY-039                                                                                    | Provider closure/identity/physical cleanup unverified.                                       |
| Operator billing/identity/storage retry, tombstones and retained receipts           | STORY-040                                                                                    | Operator CLI and provider adapters; final owner history is inaccessible.                     |
| Owner-only/session/origin/account isolation                                         | STORY-041, STORY-013                                                                         | Safe API-assisted negative cases require separate authorization/fixtures.                    |
| Backup → delete one drive → stale share/key denial → neighbor preservation          | STORY-042                                                                                    | CLI prerequisites and operator storage inspection; not provable by disappeared rows.         |
| Keyboard/mobile and semantic feedback                                               | Variations throughout; notably STORY-007–STORY-012, STORY-020–STORY-022, STORY-035–STORY-042 | All intended paths; no rendered/focus/screen-reader/OS acceptance.                           |
| Move/copy, upload-only sync/conflict manifests, recent/attribution search           | Alternatives or source index only                                                            | **No complete standalone stories supplied; explicitly uncovered.**                           |
| Hosted release, real signup/payment/email/storage lifecycle, large-file behavior    | Provider boundaries throughout                                                               | **No executed acceptance; not a coverage claim.**                                            |

## Dependencies and fixture isolation

These are logical prerequisites, not steps already run. A prepared fixture may replace upstream stories; do not repeat destructive setup merely to satisfy a graph. PUBLIC indicates no human session; AUTH means an authorized owner session (synthetic locally, real-provider only under separate approval).

```text
PUBLIC → STORY-001 → STORY-002
  ├─ configured provider → STORY-003 (returning) or STORY-004 (new) → AUTH
  └─ unconfigured provider → STORY-005 (explanation only; not an auth bypass)
AUTH + initial failure fixture → STORY-006 → ready empty console
AUTH + drive allowance → STORY-007 → backed-up drive
AUTH + backed-up drive + encrypted file → STORY-008
STORY-009 composes discovery/auth/drive recovery + agent/key + first put/get/download
  ├─ many-file fixture → STORY-010
  ├─ retained-version fixture → STORY-011
  ├─ live-file + restore headroom → STORY-012
  ├─ replacement/foreign-drive fixture → STORY-013
  ├─ host + read-scoped token → STORY-016
  ├─ second writer → STORY-017 → history usable by STORY-011
  └─ used versions/trash → STORY-015 → STORY-027 / STORY-028

drive + file + read/share token + local key → STORY-018 or STORY-019 → STORY-020
  ├─ independent invalid/wrong fragment fixtures → STORY-021 / STORY-022
  ├─ expired fixture → STORY-023
  ├─ active expendable share → STORY-024
  ├─ trash/network/storage fixture → STORY-025 (restore via STORY-012)
  └─ writer + two known revisions → STORY-026 (reuses STORY-017 guard semantics)

AUTH + billing fixtures → STORY-027 / STORY-028 / STORY-029 / STORY-034
approved live-provider environment → STORY-030 → STORY-031 / STORY-032
agent write denial → STORY-033 → appropriate human cap/plan/operator decision

AUTH + audit/deletion fixtures → STORY-035 / STORY-036
two isolated owners + agent bearer fixture → STORY-041 (isolation before destructive runs)
disposable drive → STORY-037 → STORY-038 (+ authorized maintenance operator)
backed-up disposable project + two preservation controls → STORY-042
separate disposable account → STORY-039 → STORY-040 (LAST for that account)
```

- **STORY-014 runs last for its compromised-agent fixture:** revoke-all otherwise invalidates keys needed by upload/read/share stories. STORY-013 verifies replacement access before revoking the original.
- **STORY-024 only revokes its expendable link.** STORY-026 keeps new-link and old-link IDs separate. Expired, wrong-fragment, trashed and provider-failure fixtures are independent, so one failure does not mask another.
- **STORY-039/040 must never share the active account used by other stories.** Acceptance immediately blocks normal console/billing operations; provider identity removal can precede complete storage cleanup.
- **STORY-038/040/042 require an authorized operator and disposable data.** Maintenance commands written in steps are future actions, not permission to execute now. Grace eligibility, bounded batches and provider dependencies prevent an inferred completion SLA.
- Synthetic names across stories are examples, not globally shared identities. When reusing STORY-009 for Harbor Research/Juniper/Atlas fixtures, deliberately map the returned IDs and appropriate independent recovery keys; do not reuse a key because names look related.
- Publication/move/version changes, quota tests and deletions can change later assumptions. Reset or isolate fixtures; assert starting state before any future authorized run.

## All Stories

Every story is unexecuted. Sources resolve through the namespaced reference index after the stories.

## STORY-001: Decide whether Agent Drive fits a developer's workflow

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Onboarding / landing discovery  
**Persona:** Maya Chen, an independent developer building a research assistant.  
**Goal:** Understand the product and find the appropriate next step without assuming the landing page is an interactive terminal.  
**Preconditions:** Signed out; public landing route available.  
**Testability:** PUBLIC-LOCAL-TESTABLE; no authentication or command execution in this story.  
**Ideal path:** **3** — understand the value, inspect the important privacy limitation, choose the next destination. Design benchmark only.  
**Alternate paths:** Landing **Create your workspace** goes directly to signup; **Sign in** serves an existing user; **Open console** goes to the guarded console; **Pricing** provides plan discovery.

### Steps

1. Open `/` and read **Your agents. Their own drive.** → the page describes persistent agent work encrypted before leaving the machine.
2. Review **You hold the keys.**, **Less setup. More doing.**, and **A clear view of the work.** → distinguish client-held keys, CLI/MCP usage, and human oversight.
3. Choose **Pricing** → `/pricing` presents plan discovery rather than running the illustrated `agent-drive put` command.

### Variations

- Keyboard: reach Pricing with Tab and activate the link; this is a future keyboard acceptance path, not a verified focus-order result.
- Mobile: follow the same content sequence; the source specifies a single-column feature grid at the narrow breakpoint (ONB.S16).
- Existing operator: choose **Open console** instead; an unauthenticated request redirects to signin.

### Edge Cases

- The terminal preview is static `code`, not an executable input or upload control.
- “You hold the keys” does not mean metadata is encrypted; pricing/quickstart explicitly disclose visible paths, sizes, tags, and activity.
- Do not infer team invitations, workspace switching, or organization setup from the word “workspace.”

**Sources:** ONB.S1:19–65; ONB.S2:133–149; ONB.S6; ONB.S15:3–4.

## STORY-002: Compare plans without mistaking published prices for live checkout

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Onboarding / pricing discovery  
**Persona:** Jules Rivera, a developer estimating room for a small automation project.  
**Goal:** Decide whether to begin with Free and understand the limits before signup.  
**Preconditions:** Public pricing route available; actual deployment billing configuration intentionally unspecified.  
**Testability:** PUBLIC-LOCAL-TESTABLE; signup continuation LIVE-PROVIDER-BLOCKED; no payment action.  
**Ideal path:** **4** — compare allowances, understand charge boundaries, see availability, choose the entry plan. Design benchmark only.  
**Alternate paths:** Direct `/pricing` or landing **Pricing**; landing **Create your workspace** also reaches signup but skips comparison. Both paid cards' **Manage your plan** links go to `/console/billing`, not directly to checkout.

### Steps

1. Select **Pricing** on the landing page → **A home for every agent.** appears on the pricing route.
2. Compare Free, Developer, and Team cards → source-backed monthly base prices are $0, $20, and $200, with 3, 25, and 250 included drives respectively. These are published constants, not measured billing results.
3. Read **How usage works** → allowances apply across the account; retained versions and trash count; free accounts stop at included allowances. Each encrypted upload is limited to 5 GiB, so original bytes must leave room for encryption overhead.
4. Review **Additional usage on paid plans** and the availability notice when present → configured rates are displayed, or the page explains missing rates/disabled checkout. Absence of a notice is not proof a payment would succeed.
5. Read **Private contents.** and **Leave on your terms.** → lost keys are unrecoverable; metadata remains visible; permanent deletion is a retryable purge rather than instant erasure.
6. Choose **Start with Free** → `/sign-up` renders the configured Clerk component or the explicit unconfigured signup notice.

### Variations

- Existing account: **Sign in** reaches `/sign-in`; unauthenticated **Manage your plan** continues through the billing route’s sign-in guard.
- Keyboard: activate **Start with Free** as a link without needing to interact with the decorative selected styling on Developer.
- Mobile: pricing details collapse to one column below 700px; visual/read-order acceptance remains untested.
- Documentation-first: **Quickstart** links to the GitHub quickstart on `main`; that external document is not revision-pinned by the UI.

### Edge Cases

- Malformed or absent published rates produce the unavailable-rates branch: `publishedRates()` catches invalid values, and `rates !== null && checkoutConfigured()` short-circuits before the second check. The supplied claim that invalid rates escape this pricing fallback is not supported at this revision. This does not establish malformed-configuration behavior on every other billing endpoint.
- A visually selected Developer card is not evidence that the visitor has subscribed.
- Paid **Manage your plan** remains a navigation link when paid checkout is unavailable.
- Free availability is explicitly conditional on configured signin and storage.
- Spending caps are described as blocking new writes, not guaranteeing final invoice/network-traffic ceilings.

**Sources:** ONB.S2:22–79,83–157; ONB.S3:3–48; ONB.S16; BILL.P1–BILL.P3; BILL.D1; BILL.D3.

## STORY-003: Return to an existing personal workspace

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Onboarding / sign-in  
**Persona:** Rafael Ortiz, an owner returning to an existing research drive.  
**Goal:** Authenticate and reach the correct account without treating account login as decryption-key recovery.  
**Preconditions:** Signed out; an existing human account; the installation's Clerk instance configured; no competing explicit redirect destination for the fallback case.  
**Testability:** LIVE-PROVIDER-BLOCKED end to end. Console-only continuation can be LOCAL-SYNTHETIC-TESTABLE with a separate prepared fixture.  
**Ideal path:** **3** — enter signin, satisfy provider authentication, arrive in the workspace. Provider-internal actions are not counted as a known source sequence.  
**Alternate paths:** Landing **Sign in**, pricing **Sign in**, direct `/sign-in`, or unauthenticated **Open console** → signin. Signup supplies Clerk's `signInUrl`, but provider-rendered switching labels are not defined here.

### Steps

1. Choose **Sign in** on `/` → `/sign-in` mounts Clerk's SignIn component if configured.
2. Complete the authentication requirements actually presented by that installation → provider-controlled success establishes a session; precise controls are outside this source's evidence.
3. Follow the default successful continuation → `/console` is the configured fallback; the console loads data for the authenticated user.
4. Review **Personal workspace** / **Drives & files** and the selected drive's key state → an existing drive can be listed while showing **Key required for downloads** in a fresh page instance.

### Variations

- Keyboard/mobile provider interaction must be verified against the actual Clerk UI, not assumed from these wrappers.
- A fresh account with no drives sees **Give your first agent a home.** instead of an existing drive.
- A synthetic console fixture displays **Local test session**, not evidence of live signin.

### Edge Cases

- Missing configuration renders the explicit notice instead of a custom local password form.
- A console API 401 redirects to `/sign-in`; the API helper creates the message **Your session expired. Sign in again.**
- Signing in does not recover a lost drive key; keys reside only in page memory or the user's own backup.
- Account A's data must not appear under account B; source account provisioning and drive selection are user/account scoped, but cross-account UI acceptance was not executed.

**Sources:** ONB.S4; ONB.S6–ONB.S9; ONB.S11:403–405,530–560.

## STORY-004: Create an account and recognize what “workspace” actually creates

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Onboarding / signup and first workspace  
**Persona:** Nia Patel, a first-time developer preparing storage for a notes agent.  
**Goal:** Reach the empty personal workspace without searching for a nonexistent organization wizard.  
**Preconditions:** Signed out; no existing account for the intended identity; configured Clerk installation and working console API/database; no competing explicit redirect destination.  
**Testability:** LIVE-PROVIDER-BLOCKED for account signup. The already-authenticated empty-workspace portion is LOCAL-SYNTHETIC-TESTABLE.  
**Ideal path:** **3** — choose signup, complete provider enrollment, land in the ready workspace. Benchmark only; provider substeps remain unknown.  
**Alternate paths:** Landing **Create your workspace**, pricing **Start with Free**, direct `/sign-up`; signin supplies Clerk's `signUpUrl`.

### Steps

1. Select **Create your workspace** → `/sign-up` mounts Clerk's SignUp component when configured.
2. Complete the enrollment and verification that the installation actually requests → provider authentication succeeds; no particular OAuth method or email flow is asserted.
3. Continue to the default `/console` destination → authenticated console API access provisions/reuses the user's **Personal workspace** and internal human-console identity.
4. Review **Give your first agent a home.** → the page presents **Create a drive**, **Save your key**, and **Connect an agent**, with **Create your first drive ↗** as the next action.

### Variations

- Pricing-first signup retains the same destination; the Free link does not itself establish live billing acceptance.
- Keyboard: after the provider returns, navigate to the first-drive button; focus placement after navigation remains unverified.
- Mobile: use the same empty-state call to action; the setup-step labels can wrap according to CSS.

### Edge Cases

- No workspace-name, organization-selection, invitation, or team-membership step is implemented in the reviewed onboarding components.
- Authentication success followed by API failure is not a completed workspace load; use STORY-006.
- Synthetic authentication intentionally suppresses the real Clerk path and is not signup acceptance.
- An existing account can lead to an already-populated console, so it is not a valid fixture for this new-account story.

**Sources:** ONB.S1:30–36; ONB.S5–ONB.S8; ONB.S11:474–507; ONB.S16.

## STORY-005: Recover orientation when human authentication is not configured

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Onboarding / deployment-configuration error  
**Persona:** Eli Morgan, evaluating a newly installed Agent Drive deployment.  
**Goal:** Understand why signup/signin cannot proceed and return safely to public information.  
**Preconditions:** No usable Clerk configuration; no authenticated console session. This is a deliberate fixture condition, not a claim about a hosted deployment.  
**Testability:** PUBLIC-LOCAL-TESTABLE configuration branch; live account access remains blocked.  
**Ideal path:** **2** — receive a clear explanation, take a useful exit. Benchmark only.  
**Alternate paths:** Direct `/sign-up` or landing signup CTA reaches the signup notice; direct `/sign-in`, public Sign in links, or guarded `/console` reaches the signin notice.

### Steps

1. Select **Create your workspace** from `/` → the signup page explains **Sign-up is not configured on this installation** and instructs configuration of the Agent Drive Clerk instance.
2. Activate the **agent drive** brand → return to `/`.
3. Select **Open console** while unauthenticated → the guard sends the visitor to `/sign-in`.
4. Read the corresponding **Sign-in is not configured on this installation** notice → understand that this is configuration failure, not rejected user credentials.

### Variations

- A keyboard-only visitor uses the brand link to escape; no custom retry or credential-entry form is defined in the unconfigured branch.
- A synthetic-auth development installation can deliberately show these public notices while prepared synthetic sessions access the console.
- Mobile: check notice readability and the brand escape path in a future rendered review.

### Edge Cases

- Do not present the synthetic test-session mechanism as a customer signup workaround.
- A notice instructing the operator to configure Clerk is not evidence of valid storage, billing, or production readiness.
- Only configuration restoration by the deployment operator can enable the real provider flow; this story does not authorize configuration changes.

**Sources:** ONB.S4:18–25; ONB.S5:18–25; ONB.S6; ONB.S7:19–27,71–81.

## STORY-006: Retry a first-workspace load failure without creating duplicate resources

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Onboarding / first-workspace error recovery  
**Persona:** Priya Shah, a signed-in developer whose first console visit encounters a temporary backend/network failure.  
**Goal:** Recover the workspace load and proceed only after drives and access settings are ready.  
**Preconditions:** Authenticated fresh account with no drives; initial console refresh fails for a non-401 reason; the underlying fault can later be removed in a future controlled fixture.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE with prepared failure/recovery fixtures; not executed.  
**Ideal path:** **3** — understand failure, retry once the condition is corrected, resume onboarding. Benchmark only.  
**Alternate paths:** The explicit **Refresh** button retries loading; browser reload remounts the console and runs initial refresh again, but clears any page-memory keys.

### Steps

1. Open `/console` → initial state is **Opening your workspace…** / **Loading your drives and access settings.**
2. Let the prepared non-401 initial request failure resolve → an alert appears and the initial panel becomes **Workspace unavailable** with connection/refresh guidance.
3. Review **+ New drive** before recovery → it remains disabled while initial readiness is false; do not treat this as a zero-drive account successfully loaded.
4. After the fault is corrected, choose **Refresh** → drives, agents, API keys, and usage are requested again.
5. After successful loading, review **Give your first agent a home.**, then choose **Create your first drive ↗** → **Create a drive** opens, ready for STORY-007.

### Variations

- Keyboard: reach Refresh and then the first-drive action; alerts use `role="alert"`, but announcement/focus behavior requires actual assistive-technology verification.
- Mobile: use the page-heading actions after their column reflow.
- Existing account: successful refresh restores its drive list rather than the first-drive empty state.

### Edge Cases

- A 401 follows the signin redirect path instead; it is not the recoverable non-authentication fixture above.
- Initial refresh uses a combined Promise.all; one failed resource request prevents the successful initial readiness state.
- **Refresh** inside the console is not browser reload: the former does not clear the in-memory key map.
- This story creates no drive until the user submits its separate form; repeated load retry is not an instruction to submit resource creation repeatedly.
- Do not apply initial-load error copy expectations to every later refresh failure: a previously ready console need not revert to the initial unavailable panel.

**Sources:** ONB.S9:71–85,193–215,240–270; ONB.S11:435–450,474–507.

## STORY-007: Create the first drive and protect the one-time recovery key

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Onboarding / first-drive recovery-key safety  
**Persona:** Nia Patel, creating a drive named **Field notes** for her notes agent.  
**Goal:** Create the namespace and retain a secure recovery copy before proceeding.  
**Preconditions:** Authenticated ready console; no drives; account allows a new drive; secure user-controlled backup destination available.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE; browser download/backup usability remains unexecuted.  
**Ideal path:** **6** — open creation, name, create, secure backup, acknowledge, continue. The safety acknowledgment is purposeful, not avoidable friction by default.  
**Alternate paths:** **Create your first drive ↗** and header **+ New drive** open the same dialog. CLI drive creation is separately documented but is not a browser receipt alternative and is outside this story.

### Steps

1. Choose **Create your first drive ↗** → **Create a drive** explains client-generated encryption and that the server cannot recover the key.
2. Enter **Field notes** in **Drive name** → the required name input is ready for submission.
3. Choose **Create drive** → the client generates a drive key, submits only the trimmed name, and on new-drive success opens **Your drive. Your key.**
4. Read the recovery warning and check **Continue to drive** → the button is disabled until acknowledgment; the receipt is not closable through the dialog's normal close/Escape path.
5. Choose **Save recovery key** → the client initiates a JSON download named for the drive ID containing format, driveId, and key.
6. Secure that recovery file in a password manager or another protected location → this is a human safety action; the app does not verify the file was actually saved or protected.
7. Select **I saved my drive key securely** → **Continue to drive** becomes available when no operation is busy.
8. Choose **Continue to drive** → Files shows the newly selected drive with **Key loaded**; after listing completes, an empty drive says **Ready for your first file.**

### Variations

- Keyboard: the Drive name field has autofocus; submit the form, then use keyboard activation for recovery download, acknowledgment, and continuation. Actual focus cycling remains unverified.
- Mobile: use the device's download/share storage affordances to protect the file; do not assume desktop download behavior.
- Change of mind: before submission, the ordinary create dialog can be closed with **Close dialog** or Escape when not busy.
- Duplicate-name recovery: if a same-named drive exists, creation raises **A drive with this name already exists. Load its original drive key instead.** Close the create dialog, select the existing drive, and follow STORY-008 rather than treating the newly generated candidate key as its key.

### Edge Cases

- The checkbox is an acknowledgment, not proof of backup; it can be selected without downloading.
- Closing/reloading the page while a receipt is present registers a beforeunload warning, but browser-specific presentation and prevention of data loss are not guaranteed.
- A blocked/canceled download requires retry or a securely retained manual copy before acknowledgment; no download-completion verification exists.
- A lost key cannot be recovered by recreating a drive of the same name.
- Required/maxLength=128 form constraints exist; trimmed server validation still matters for whitespace-only input.
- If drive creation succeeds but the subsequent refresh fails, the receipt state has already been set. Preserve the key and resolve loading errors; do not blindly recreate the drive.

**Sources:** ONB.S9:122–159,230–288; ONB.S11:485–554; ONB.S12:666–688; ONB.S13:960–1055; ONB.S15:8–12; ONB.S17.

## STORY-008: Recover a locked drive, reject bad backups, and verify the key by downloading

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Onboarding / files-keys / recovery and authenticated decryption  
**Persona:** Leon Park, reopening Harbor Research after a browser reload.  
**Goal:** Recover a securely backed-up drive key and distinguish format validation from actual decryption.  
**Preconditions:** Ready authenticated account owns Harbor Research and encrypted `/memory/handoff.md`; its correct recovery JSON is securely saved. Disposable invalid-JSON and valid-but-wrong-key fixtures exist. STORY-007 plus a CLI/MCP upload, or STORY-009, can supply the baseline. Never destroy the real backup.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE with ciphertext/storage fixtures; live authentication and hosted storage remain LIVE-PROVIDER-BLOCKED / UNVERIFIED. The no-file rehearsal variation does not establish decryption.  
**Ideal path:** **4** — select drive, supply recovery material, load it, download. Intentional invalid-input and wrong-key detours are outside this design benchmark.  
**Alternate paths:** Paste the raw key or use **Or choose a recovery file**; **Forget key** clears the selected key, and browser reload/unmount clears page-memory keys. CLI/MCP `get` decrypt locally but do not unlock the browser. Console **Refresh** does not forget keys.  
**Sources:** ONB.S9:161–178,255–265; ONB.S10:331–351; ONB.S11:530–560; ONB.S13:1057–1096; ONB.S14–ONB.S15; FK.C3–FK.C5; FK.C8; FK.X1; FK.L2–FK.L4; FK.M2.

### Steps

1. Reload `/console` only after securing the backup → page-memory keys reset, while the server drive and metadata remain.
2. Select Harbor Research in **Selected drive** → filenames remain visible with **Key required for downloads**; Download requires a key.
3. Choose **Load drive key** → the dialog names this drive and explains page-memory lifetime, with a password input and **Or choose a recovery file**.
4. Choose the invalid JSON fixture in a clean loader → **Choose a JSON recovery key file downloaded from this console.** appears; do not interpret it as missing remote data.
5. Cancel and reopen the loader to clear stale input; enter the disposable syntactically valid wrong key and choose **Load key** → loading succeeds syntactically, and the notice says a download will verify the match.
6. Choose **Download** for `/memory/handoff.md` → authenticated decryption is expected to fail without initiating a plaintext download.
7. Choose **Forget key** → **Drive key removed from this browser session.** appears; the drive and file remain.
8. Reopen **Load drive key** and select the correct protected recovery JSON → matching drive ID and key syntax populate the input; selection alone does not finish loading.
9. Choose **Load key** → the dialog closes and **Key loaded** appears; this badge still does not prove the key matches ciphertext.
10. Choose **Download** on the known file → correct fixture decryption is expected to start a local download with **File decrypted in your browser. Download started.**
11. Choose **Forget key** → only the selected page-memory key is removed; metadata remains available.
12. Reopen **Load drive key**, supply the secured matching key, and select **Load key** → the next task can use the key without recovering it from the server.
13. Reload the page once more → the key is absent again; the saved backup, not account login or API-key rotation, enables later recovery.

### Variations

- Happy path: skip deliberate invalid/wrong-key input and load the correct backup, then download.
- Empty-drive rehearsal: after STORY-007 with no uploaded ciphertext, perform reload, load, forget and reload-key actions only. Stop at format validation; no decryption/storage acceptance is established.
- Manual entry: use the raw 32-byte key’s canonical base64url form from a protected store, not an API token or the whole JSON; avoid clipboard-history disclosure.
- Keyboard: use labeled password/file controls and the native chooser. Escape may close this ordinary dialog, unlike the one-time recovery receipt; actual focus order/return is unverified.
- Mobile: use the device’s actual protected file-access/download affordances; there is no invented cloud recovery alternative.

### Edge Cases

- A recovery file larger than 16,384 bytes, invalid JSON, missing/non-string key, or wrong drive ID is rejected; wrong-drive copy says **This recovery file does not belong to the selected drive.**
- Malformed/noncanonical key text fails with **Invalid drive key. Expected a base64url-encoded 32-byte key.** A valid-but-wrong key fails only on decryption.
- JSON driveId agreement is not cryptographic proof; import does not validate the emitted format marker.
- An invalid later file selection does not explicitly clear a previously populated keyInput; use a clean loader for negative fixtures and separately assess stale-input clarity.
- Damaged/incomplete ciphertext can produce the same decryption failure; do not uniquely diagnose a forgotten key from that error.
- The original key cannot be reset by the service. A new API key restores authorization, not decryption.
- In-component Files/Agents/API keys/Usage/Trash switching preserves the parent key state; browser reload or leaving/unmounting the console does not. **Refresh** is not browser reload.

## STORY-009: From pricing and signup to a backed-up drive and first encrypted agent handoff

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** long  
**Topic:** Onboarding / files-keys / complete first workspace and agent connection  
**Persona:** Maya Chen, preparing Research journal for the synthetic Harbor Collector agent.  
**Goal:** Discover the product, enroll, secure a first drive, issue least-privilege credentials, and exchange the first encrypted handoff through CLI and browser.  
**Preconditions:** New human identity; configured Clerk/backend and account allowance for a drive; no drives/user agents/API keys/files initially; secure backup destination; no provider redirect override. For the integration segment, configured local API/database/storage, already-built private repository CLI via `pnpm agent-drive`, and harmless local `handoff.md` are required. No setup or signup has been executed here.  
**Testability:** LIVE-PROVIDER-BLOCKED end to end. The post-authentication console/CLI/storage segment is LOCAL-SYNTHETIC-TESTABLE only with prepared services. Steps 25–28 are CLI-ONLY; no browser upload is implied.  
**Ideal path:** **20** — four design-level discovery/enrollment stages plus the sixteen safety and integration actions in the supplied first-agent path. This is an integer design benchmark, not observed clicks, provider substeps, OS actions or elapsed time.  
**Alternate paths:** Landing **Create your workspace** skips pricing; pricing **Start with Free** reaches the same signup route. **+ New drive** and **Create your first drive ↗** open one form. Sidebar **API keys** and **Connect an agent** reach the same tab; its missing-prerequisite **Create drive**/**Create agent** controls open existing forms. **+ New agent** and **Create your first agent** share the agent form. Separately authorized CLI management-token `agent create`, `drive create`, `key create` provide provisioning with local-config key custody, not the browser receipt.  
**Sources:** ONB.S1–ONB.S6; ONB.S8; ONB.S11–ONB.S15; FK.C3–FK.C6; FK.C8–FK.C9; FK.L1; FK.L4; FK.D1–FK.D3; FK.A2–FK.A3.

### Steps

1. Open `/` → read **Your agents. Their own drive.**
2. Review **You hold the keys.** → understand that persistent storage still requires user-controlled encryption keys.
3. Choose **Pricing** → compare the published plan cards.
4. Read **How usage works** and deployment-availability messaging → distinguish supported plans from an enabled billing provider.
5. Read **Private contents.** → learn that metadata remains visible and lost keys cannot be recovered.
6. Choose **Start with Free** → enter `/sign-up`.
7. Complete the installation's actual Clerk enrollment requirements → establish a human session; detailed provider substeps remain unspecified.
8. Continue to the default `/console` and allow initial loading to finish → see **Personal workspace**, **Drives & files**, and **Give your first agent a home.**
9. Choose **Create your first drive ↗** → open **Create a drive**.
10. Enter **Research journal**, then choose **Create drive** → receive **Your drive. Your key.** after new-drive creation.
11. Review the warning before proceeding → understand the key is neither recoverable by the service nor saved in browser storage.
12. Choose **Save recovery key** → initiate the per-drive JSON download.
13. Move/store the file securely, then select **I saved my drive key securely** → acknowledge the backup; the app does not verify storage completion.
14. Choose **Continue to drive** → the selected drive shows **Key loaded** and eventually **Ready for your first file.**
15. Choose **Forget key** → remove only the selected key from page memory; the drive remains.
16. Choose **Load drive key**, select the correct recovery JSON, and choose **Load key** → restore the in-memory key with the explicit “download will verify” notice.
17. Choose **Connect an agent** in the empty-file panel → switch to **API keys**, not a file-picker or browser uploader.
18. Read **Connect without sharing your identity.** → distinguish the API token that authorizes operations from the separately backed-up drive key that decrypts; proceed to the actual agent/credential controls below, not a browser uploader.
19. Choose **Create agent** → **Create an agent** opens.
20. Enter **Harbor Collector**, then **Create agent** → API keys returns with “Agent created. Create an API key to connect it.”
21. Choose **+ New API key** → issuance form opens.
22. Enter label **Harbor laptop**; select Harbor Collector, only Research journal, and **read**/**write** → no delete/share/manage permission is deliberately granted.
23. Choose **Create API key** → **Save your API key** reveals the token once.
24. Save that token securely; check **I saved my API key securely**, then **Done** → list displays the label, agent, scopes, drive and Active state, not the secret.
25. In the terminal, supply the API URL and API token through protected environment input and use `pnpm agent-drive login --api "$AGENT_DRIVE_API_URL"` → the CLI validates identity and saves its private connection config.
26. Supply Research journal's raw drive-key value through protected environment input; record its returned ID in `DRIVE_ID` → CLI has the separate local encryption secret and target identifier. Do not paste the recovery JSON or a secret into a prompt.
27. Run `pnpm agent-drive put ./handoff.md /memory/handoff.md --drive "$DRIVE_ID"` → the client encrypts first, uploads ciphertext, and commits a version.
28. Run `pnpm agent-drive get /memory/handoff.md --drive "$DRIVE_ID" --output ./handoff.downloaded.md` → authenticated decryption precedes writing the local output.
29. Return to **Files** and choose **Refresh** → the uploaded path appears; this is an explicit refresh, not assumed live updating.
30. Choose **Download** for that row → browser decrypts and initiates a download named `handoff.md`.
31. Choose **Forget key** → browser session key is removed; metadata remains visible and Download is disabled.
32. Open **Agents** → Harbor Collector appears with its active-key count, linking the issued credential to the agent identity.

### Variations

- Keyboard: use native links/forms, Tab/Shift+Tab, Space on acknowledgments and Enter to submit. Receipt dialogs deliberately resist Escape before completion; focus order/return and provider interaction remain unverified.
- Mobile: follow the console sequence using actual protected backup/file access; inspect horizontal navigation/table scrolling in a future rendered check. Use a separate desktop terminal for CLI steps, not an invented mobile terminal.
- Documentation-first: pricing **Quickstart** describes prerequisites, but links to `main`, not this pinned revision. The CLI is a private workspace package, not an assumed global/npm release.
- Existing signed-in owner: deliberately begin at the authenticated empty console if isolating integration; do not report this variation as live signup.
- Management-token provisioning: the documented CLI route stores generated drive keys in private local config and does not silently add the new drive to an existing token’s content grants.

### Edge Cases

- Authentication configuration failure → STORY-005; initial console load failure → STORY-006; detailed recovery errors → STORY-008. Preserve the backup before any Forget key rehearsal.
- The early empty-drive recovery rehearsal validates only format. The later actual handoff downloads are the proposed cryptographic checks; neither has been executed.
- Existing drive name reports that the original key must be loaded; do not treat a new generated candidate as a replacement key.
- Recovery/API-token acknowledgments are self-attestation, not verified protected storage. One-time receipt unload warnings cannot guarantee safety after page close.
- Reserved agent name `__console__` is rejected. The internal human-console identity is hidden from the user-created agent list.
- Limit the new key to Research journal and read/write; do not grant delete/share/manage merely because the human console can perform those operations. Foreign-account agent/drive IDs must be rejected.
- Drive key and API key are different secrets. Feed raw drive-key material through protected environment/config, not the JSON recovery file as CLI `--key-file`, chat or a tool prompt.
- Maintain the documented consistent `http://localhost:3100` origin for future local mutations; recover network errors through **Refresh** only after inspecting potentially committed state.
- CLI output paths should be fresh disposable paths to avoid overwriting an existing local file. Browser download behavior is OS-dependent and unexecuted.
- Do not purge the account/drive as routine onboarding cleanup; destructive stories require isolated fixtures and explicit authorization.

## STORY-010: Find a report beyond the first loaded page

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** files-keys / Files and Trash pagination/filter  
**Persona:** Priya Shah, a reviewer locating `/reports/zoning-summary.md`.  
**Goal:** find a file beyond the initial list without assuming the filter searches the whole drive.  
**Preconditions:** Harbor Research has a synthetic fixture of **101 live paths**, with the target beyond the initial 100 in path ordering; authenticated console. No encryption key is needed to browse metadata.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE; fixture size is proposed, not observed.  
**Ideal path:** **3 actions** — choose the drive, filter, open the target; needing explicit extra-page loading is a friction candidate, not a measured defect.  
**Alternate paths:** CLI `ls --prefix` or `search --query`, and MCP `list`/`search`, offer server-side metadata queries with cursors. These are not equivalent to browser “Filter loaded files” and are not plaintext-content search.  
**Sources:** FK.C2, FK.C4–FK.C5, FK.L1, FK.M2–FK.M3, FK.R1.

### Steps

1. Select Harbor Research in **Files** → initial metadata page loads, with **Load more files** available.
2. Enter **zoning-summary** in **Filter loaded files** → only already-loaded rows are filtered; absence is not proof the remote path does not exist.
3. Choose **Load more files** → next page is appended and the same filter can now expose the target.
4. Clear the filter → all loaded rows return; the footer's loaded count is not a filtered-match count.
5. Select another drive → its initial list is requested and the text filter resets.

### Variations

- Repeat against **Trash** using >100 deleted-file fixtures; the same pagination/filter controls apply.
- Case-insensitive substring matching allows **ZONING** to match a lower-case path.
- Mobile: horizontally scroll the table to row actions; keyboard: use the labeled filter and native **Load more files** button.

### Edge Cases

- With zero matching rows but nonempty loaded data, source has no dedicated “no matches” message; empty-state rendering checks total loaded rows.
- A missing next cursor means **Load more files** disappears; do not expect infinite scrolling.
- A page-fetch failure should retain an error and allow retry; do not treat an empty filtered table as a network diagnosis.
- **Refresh** resets the loaded file page, rather than guaranteeing the previously accumulated pages remain.

## STORY-011: Restore an earlier handoff without erasing its history

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** files-keys / version history, restore and verification  
**Persona:** Maya, recovering from an incorrect agent-generated handoff.  
**Goal:** make a known earlier version current while retaining later history.  
**Preconditions:** `/memory/handoff.md` has at least two known versions; timestamps/IDs from the fixture identify the intended version; drive key available.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE.  
**Ideal path:** **4 actions** — find file, open history, choose prior version, retrieve restored contents.  
**Alternate paths:** **Versions** exists on live and trashed rows; CLI `versions`/`restore --version`, MCP `versions`/`restore`. CLI `get --version` or MCP `get(versionId)` retrieves old bytes without making them current—safer when inspection, rather than rollback, is the goal.  
**Sources:** FK.C3, FK.C5, FK.C9, FK.L1–FK.L2, FK.M2–FK.M3, FK.A5.

### Steps

1. Select Harbor Research in **Files** → current file row is visible.
2. Choose **Versions** for `/memory/handoff.md` → **Version history** lists dates, encrypted sizes, authors and IDs.
3. Identify the intended prior version using fixture evidence → avoid guessing its content from the date alone.
4. Choose **Restore this version** on that entry → new current version is created; notice says previous versions are preserved.
5. Reopen **Versions** → original historical entries and the new restore entry are expected to remain.
6. Close the dialog and load the drive key if absent → Download becomes available.
7. Download the current file → bytes should correspond to the chosen prior version, not the superseded version.

### Variations

- A locked browser can inspect history and restore server-side ciphertext; the key is needed only for decryption.
- Keyboard: use each version's **Restore this version** button and native dialog controls; actual focus return is not proven.
- On mobile, inspect full version IDs rather than relying only on truncated-looking labels; rendered wrapping is a future check.

### Edge Cases

- Restore is immediate from its button; there is no separate confirmation dialog in this implementation. It changes current state but preserves prior history.
- Restore requires **read + write** for agent API access. A read-only agent can list/get but cannot restore.
- Restore consumes retained-version storage and is subject to quota/account write-budget checks; trashing something does not necessarily create enough headroom.
- Missing source/version and concurrent state changes can produce errors; reread history before retrying.
- Browser history loads all pages through the shared helper; unlike the file list, it has no explicit **Load more versions** control.

## STORY-012: Cancel an accidental deletion, then recover a deliberate trash action

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** files-keys / Trash and destructive safety  
**Persona:** Priya, cleaning up a superseded `/reports/zoning-summary.md` but wanting reversible deletion.  
**Goal:** confirm the destructive boundary and restore the file with history intact.  
**Preconditions:** authenticated account, live file with retained history, sufficient storage/write budget for restore.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE.  
**Ideal path:** **5 actions** — trash with confirmation, switch to Trash, restore, return to Files. The cancellation rehearsal is outside the ideal.  
**Alternate paths:** CLI `rm` or MCP `delete` soft-deletes; CLI/MCP `restore` restores; **Versions → Restore this version** in Trash restores a chosen historical version rather than the default current one. CLI/MCP do not supply the console's browser confirmation prompt.  
**Sources:** FK.C3–FK.C5, FK.C9, FK.L2, FK.M3, FK.A5.

### Steps

1. In Files, choose **Trash** on `/reports/zoning-summary.md` → native confirmation asks “Move /reports/zoning-summary.md to trash?”
2. Cancel → file remains live; no delete request should be sent.
3. Choose **Trash** again and confirm → file leaves the live listing after refresh.
4. Open the **Trash** tab for Harbor Research → deleted row shows deletion time and **Versions preserved**.
5. Choose **Versions** → retained history is still accessible.
6. Close history and choose **Restore** on the row → server creates a new current version and displays the preservation notice.
7. Return to **Files** → recovered path appears again.
8. Load the key if needed and choose **Download** → recoverable contents can be decrypted locally.

### Variations

- Perform steps 1–7 while locked: deletion/restoration are server operations, not evidence of decryption access.
- Keyboard variant explicitly exercises cancel versus confirm in the native browser prompt.
- Mobile variant scrolls workspace navigation to **Trash** and the file table to row actions.

### Edge Cases

- Trash is **not permanent purge** and does not reclaim retained storage. Permanent deletion belongs to **Activity & deletion**, outside this story.
- Restore can fail at quota even though the original object is already retained.
- No encryption-key requirement guards the trash button; account authorization is the boundary.
- An expired console session redirects to sign-in. Once authenticated again, inspect current Files/Trash state before repeating a mutation whose response was lost.

## STORY-013: Replace an agent key with read-only access, then revoke the old key

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** files-keys / scoped credentials, least privilege, rotation  
**Persona:** Leon, converting Harbor Collector from a writer into a read-only reviewer.  
**Goal:** change access deliberately without confusing API-key rotation with drive-key rotation.  
**Preconditions:** existing agent, Harbor Research and a separate **Private Archive** drive, existing **Harbor laptop** read/write token, protected local client configuration.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE with CLI permission checks; token use is CLI-ONLY. Hosted variant LIVE-PROVIDER-BLOCKED.  
**Ideal path:** **6 actions** — specify replacement permissions, issue/save, update client, validate, revoke, verify revocation.  
**Alternate paths:** console **+ New API key** or **Create API key** empty-state control; CLI management-token `key create` and `key revoke`. There is no source-verified in-place key-scope editor or token regeneration control.  
**Sources:** FK.C6, FK.C9, FK.L1, FK.A2–FK.A3, FK.D2–FK.D3.

### Steps

1. Open **API keys** and choose **+ New API key** → create form opens.
2. Enter **Harbor reviewer**, select Harbor Collector, allow only Harbor Research, keep **read**, and clear default **write** → Private Archive/delete/share/manage remain unselected.
3. Choose **Create API key** → one-time token receipt appears.
4. Save it securely; acknowledge and choose **Done** → replacement row is Active with only intended scopes/drive.
5. Update the local API credential through protected environment/config input → leave the original drive key unchanged.
6. Run `pnpm agent-drive whoami` → returned agent/scopes/drive IDs identify the replacement credential.
7. Run a list/get on Harbor Research → allowed read access should continue.
8. Attempt a harmless create-only upload with this replacement and a metadata read on Private Archive → write and cross-drive authorization must be denied, not silently broadened.
9. Back in **API keys**, choose **Revoke** on Harbor laptop → confirmation warns that commands using it stop working.
10. Confirm → old key becomes **Revoked**; its Revoke control is disabled.
11. In a controlled client still using the old token, call `whoami` → invalid/revoked authentication is expected; the replacement should still authenticate.

### Variations

- Cancel revocation in step 9 → old token remains valid; ensure this is intentional during rotation.
- An existing MCP process must be restarted after saved credentials change; updating a file alone does not update the already-created client.
- Keyboard users can inspect **Allowed drives** and **Permissions** as fieldsets and toggle individual native checkboxes.

### Edge Cases

- Default scopes are **read + write**; read-only is an explicit removal, not a default.
- **manage — account-wide administration; use sparingly** is materially broader than the chosen content drives; do not use it as a workaround for an expected read-only failure.
- New drives are not automatically added to existing keys.
- No scopes is rejected. An empty allowed-drive array is accepted by the API and appears as **No drive access**; do not assume a client-side required-drive guard.
- Losing the one-time token requires issuing a new token; neither the list nor a drive recovery file reveals it.
- This revokes server authentication, not bytes already downloaded or the separate drive encryption key.

## STORY-014: Stop every credential belonging to a compromised agent

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** files-keys / Agents revoke-all  
**Persona:** Maya, responding to a lost laptop used by the synthetic agent **Harbor Collector**.  
**Goal:** stop all its current API credentials without deleting the agent's historical attribution.  
**Preconditions:** disposable Harbor Collector identity with two active keys; separate **Harbor Auditor** identity with another active key; no active work that must be preserved.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE; destructive credential action, run last for this agent.  
**Ideal path:** **3 actions** — locate agent, revoke, confirm.  
**Alternate paths:** revoke each individual credential in **API keys** or through CLI `key revoke`; those paths reach the same final state only if all relevant keys are enumerated.  
**Sources:** FK.C6, FK.A2, FK.A4, FK.L1.

### Steps

1. Open **Agents** → Harbor Collector shows its fixture's two active keys.
2. Choose **Revoke access** for Harbor Collector → prompt explicitly asks to revoke all API keys for that agent.
3. Confirm → refreshed row shows zero active keys and a notice confirms revocation.
4. Open **API keys** → its two keys are Revoked; Harbor Auditor's key remains Active.
5. Use the two old tokens in controlled CLI identity requests → both should fail authentication; unrelated agent access should remain available.

### Variations

- Cancel the prompt → no key should be revoked.
- Revoke-one instead when only one machine is being retired.
- Mobile entity rows wrap; keyboard navigation should reach **Revoke access** without confusing adjacent agents, but target/focus usability is not established.

### Edge Cases

- This is **current-key revocation**, not an irreversible ban: the source does not delete or disable the agent identity; an operator can later issue another key.
- Version authorship/history is not removed.
- Revocation cannot claw back downloaded plaintext or encryption keys already held by the agent.
- Do not claim encrypted share-link revocation from this action; its handler updates API-key records, not shares.

## STORY-015: Understand why trash and versions still occupy storage

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** files-keys / Usage and billing handoff  
**Persona:** Priya, investigating storage after deleting an old report.  
**Goal:** distinguish live-file counts from retained encrypted versions and find the separate cost surface.  
**Preconditions:** account with one drive, multiple retained versions, a trashed file, and known synthetic author attribution; no exact runtime totals assumed.  
**Testability:** LOCAL-SYNTHETIC-TESTABLE for usage display; LIVE-PROVIDER-BLOCKED for live billing/payment/observed-transfer acceptance.  
**Ideal path:** **3 actions** — open Usage, compare retention/author detail, open the dedicated billing surface if needed.  
**Alternate paths:** **Billing & limits** exists in workspace navigation and under **EGRESS & COST**. **Files/Trash/Versions** expose the underlying entities but are not substitute cost calculations.  
**Sources:** FK.C5–FK.C7, FK.A4, FK.D1, FK.R1.

### Steps

1. Open **Usage** and choose **Refresh** → current API-backed usage is requested.
2. Read **ENCRYPTED STORAGE** and its “All committed versions, including trash” caption → understand why soft deletion need not reduce storage.
3. Inspect **Storage by drive** → compare live-file and stored-version counts, with quota display or **account limits apply** as appropriate.
4. Inspect **Usage by author** → versions/storage/operations remain attributed to their authors; the internal console identity is displayed as **Human console** here.
5. Choose **Billing & limits** under **EGRESS & COST** → navigate to `/console/billing`; this story ends at that handoff and does not assert payment-provider readiness.

### Variations

- Empty account: expect **No storage used yet.**
- Mobile: stat cards become one column and author table can scroll horizontally.
- Navigate directly through sidebar **Billing & limits** when cost, rather than file attribution, is the primary question.

### Edge Cases

- **API OPERATIONS** is captioned successful operations this calendar month; it is not a file count, all-time activity total, or byte-transfer measure.
- Plaintext file size and encrypted/version storage are different quantities.
- The unlimited-style drive quota sentinel renders **account limits apply** instead of a per-drive progress bar; it is not a promise of unlimited account storage.
- Do not infer dollar amounts, production egress accuracy, or retention reduction from UI source alone.

## STORY-016: Connect an MCP host and retrieve a file without leaking keys into prompts

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** files-keys / encrypted MCP connection, paginated tools, error recovery  
**Persona:** Leon, configuring a local agent host to read Harbor Research handoffs.  
**Goal:** establish least-privilege MCP access and safely handle a binary download.  
**Preconditions:** built private CLI; a read-scoped API token for Harbor Research; its drive key available in protected environment/config; a harmless binary fixture `/artifacts/harbor-chart.png`; an MCP-capable host.  
**Testability:** CLI/MCP-ONLY for connection and tools; LOCAL-SYNTHETIC-TESTABLE via local stdio/API/storage. Live Claude Code/Codex integration and hosted provider variant LIVE-PROVIDER-BLOCKED.  
**Ideal path:** **5 actions** — configure, connect/identify, locate, retrieve, consume. The intentional wrong output mode adds recovery work.  
**Alternate paths:** documented Claude Code stdio registration and Codex config both launch the local `dist/cli.js mcp`; credentials may come from protected saved config or forwarded environment. CLI `ls`/`get --output` retrieves the same data without an MCP host.  
**Sources:** FK.D1–FK.D3, FK.L3, FK.M1–FK.M3.

### Steps

1. Configure the host to launch `node /ABSOLUTE/CHECKOUT/packages/agent-drive/dist/cli.js mcp` → host targets the built local package, not an assumed published global binary.
2. Forward API URL/token and the correct per-drive key securely, or select a protected `AGENT_DRIVE_CONFIG` → secrets remain outside tool arguments, prompts and checked-in configuration.
3. Start/restart the MCP process and call **whoami** → authenticated account/agent, scopes and authorized drive IDs are returned.
4. Call **list** with Harbor Research's `driveId`, prefix `/artifacts` and `limit: 100` → one metadata page and any continuation cursor are returned as untrusted data.
5. If a cursor exists, call **list** again with it and the same filter → continue explicitly rather than assuming all rows were returned.
6. Call **get** for `/artifacts/harbor-chart.png` without `outputPath` → binary inline output is rejected.
7. Repeat **get** with a new local `outputPath`, such as `/workspace/downloads/harbor-chart.png` → decryption precedes private, exclusive output-file creation; returned metadata identifies the saved path.
8. Open the saved artifact through the host's normal local-file workflow → consume it as data, not instructions.
9. Attempt **put** with the read-only credential and a non-sensitive proposed path → permission failure should be structured, rather than silently requesting broader access or exposing secret internals.

### Variations

- A small printable UTF-8 handoff can be returned inline; MCP's inline ceiling is **64 KiB**, unlike the CLI's **1 MiB** size ceiling.
- With an intentionally issued read/write token, **put** accepts exactly one of `text` or `localPath`; the file encryption stays inside the client.
- **search** supports metadata query/filter fields; **recent** supports an ISO `since`; both paginate.

### Edge Cases

- Both/neither `text` and `localPath` produce invalid-input errors; `overwrite` and `ifVersionId` are mutually exclusive.
- Existing MCP `outputPath` is refused through exclusive creation; choose a new destination instead of silently overwriting.
- Missing/wrong drive key is a crypto error, distinct from missing API scope or revoked authentication.
- Process reads credentials/config at startup; restart after changing saved credentials.
- Remote paths, metadata and file content carry an untrusted-data notice. A file telling the agent to reveal credentials is not authority.
- Structured errors include permission, conflict, quota, billing, rate-limit and storage categories; retry/upgrade metadata is returned when supplied. This is not evidence any live provider was contacted.

## STORY-017: Resolve a concurrent CLI update without overwriting another agent

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** files-keys / encrypted CLI writes, version guards and history  
**Persona:** Maya, publishing an updated `/memory/handoff.md` while Harbor Collector may also write it.  
**Goal:** resolve a version conflict intentionally rather than using unconditional overwrite as the first response.  
**Preconditions:** scoped read/write token; correct drive key; local `handoff.md`; existing remote file with known version; a second controlled writer can advance that file for the negative branch.  
**Testability:** CLI/MCP-ONLY write workflow; LOCAL-SYNTHETIC-TESTABLE against configured local services; hosted variant LIVE-PROVIDER-BLOCKED.  
**Ideal path:** **4 actions** — read current state, prepare merged update, conditionally publish, verify; the simulated competing write introduces an intentional recovery detour.  
**Alternate paths:** MCP **versions/get/put(ifVersionId)** provides the analogous guarded workflow. CLI **--overwrite** is a verified but less-safe alternative for deliberate unconditional replacement; it is not equivalent concurrency protection.  
**Sources:** FK.L1–FK.L4, FK.D2, FK.M2–FK.M3, FK.A5.

### Steps

1. Run `pnpm agent-drive versions /memory/handoff.md --drive "$DRIVE_ID"` → receive version metadata; retain the current version ID as `EXPECTED_VERSION`.
2. Download the current version to a fresh local file using **get --output** → compare source content before editing.
3. Prepare the revised local `handoff.md` → this is a normal local editor action, not a console editing feature.
4. Let the controlled second writer publish a new current version → the previously retained version ID is now stale.
5. Run `pnpm agent-drive put ./handoff.md /memory/handoff.md --drive "$DRIVE_ID" --if-version "$EXPECTED_VERSION"` → conflict is expected instead of overwriting the newer remote state.
6. List versions and download the newer content → inspect what changed; do not retry with an unreviewed new version ID.
7. Merge the intended local and remote changes and record the now-current version ID → choose the content to publish deliberately.
8. Repeat **put --if-version** with that current ID → a new encrypted version should commit if no further writer intervenes.
9. Use **get --output** to a fresh destination and inspect content → confirm the merged result.
10. Reopen **Versions** in the console, or run CLI **versions** → both earlier contributions remain in retained history.

### Variations

- New-file upload omits overwrite/version flags: create-only is the default, so an existing path should conflict.
- Deliberate unconditional replacement uses **--overwrite**, not **--overwrite --if-version** together.
- A read-only token cannot solve the conflict by trying a different write flag; an operator must issue intended write authorization.
- A keyboard-only local editor/terminal workflow does not require browser pointer access.

### Edge Cases

- A second race after rereading can conflict again; repeat the inspect/merge cycle instead of defeating the guard.
- Stale environment keys override saved values: check per-drive environment, then global environment, then CLI raw key file, then saved drive key.
- **Important format mismatch:** CLI **--key-file** reads a trimmed raw key string; it does **not** parse the console's recovery JSON. Use its raw key value securely, not the whole JSON document.
- CLI **get --output** can overwrite an existing local file; unlike MCP's exclusive output behavior, choosing a fresh filename is the story's safety precaution.
- Each committed replacement retains history and contributes storage; quota/account budget failures are not concurrency conflicts.
- Never put real credentials or drive keys in shell arguments, prompts, task notes or source control.

## STORY-018: Correct an expiry mistake and issue a CLI link

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium — 6 actions  
**Topic:** Encrypted share creation in CLI  
**Persona:** Maya Chen, developer sending a Juniper report to Ravi.  
**Goal:** Create a time-limited link without exposing the drive key.  
**Preconditions:** Built repository CLI; configured local API and correct drive key; authorized API key with `read` and `share` for DRIVE_ID; existing non-trashed `/reports/juniper-summary.csv`.  
**Testability:** **CLI/MCP-ONLY** creation; **LOCAL-SYNTHETIC-TESTABLE**; hosted acceptance **LIVE-PROVIDER-BLOCKED / UNVERIFIED**.  
**Ideal path:** **2** — choose file/lifetime and deliver the resulting complete link; error correction is not part of the ideal benchmark.  
**Alternate paths:** MCP `share` with ISO `expiresAt` reaches the same client creation method; omitting expiry requests the server's seven-day default. No browser creation control is assumed.  
**Sources:** SHARE.S1–SHARE.S4, SHARE.S9.

### Steps

1. Run `pnpm agent-drive share /reports/juniper-summary.csv --drive DRIVE_ID --expires-in 1m` → CLI rejects the duration with its 2m–30d guidance; no share creation request is made.
2. Read `pnpm agent-drive help` → `share PATH`, `share list`, and `share revoke` forms are available.
3. Repeat creation with `--expires-in 24h` → local unwrap precedes POST; JSON returns `id`, `path`, `versionId`, `expiresAt`, and `url`.
4. Check returned path, pinned version, and expiry → Maya can confirm which artifact and lifetime she is about to disclose.
5. Copy the entire returned URL, including everything after `#` → the recipient receives the file-specific decryption capability, not the drive key. Delivery itself is outside Agent Drive.
6. Run `pnpm agent-drive share list --drive DRIVE_ID` → a paginated metadata entry identifies the share and its status; it does not re-display the secret fragment.

### Variations

- Use `30m`, `24h`, or `7d`; CLI supports integer minutes/hours/days between 2m and 30d.
- Add `--version VERSION_ID` to select an existing version instead of the current one.

### Edge Cases

- `5s`, fractional durations, and values outside the range are rejected.
- The API accepts 60 seconds–30 days and defaults to seven days; the CLI minimum is intentionally two minutes for transit allowance.
- A missing local drive key or failed unwrap prevents creation; API credentials alone do not decrypt.
- A transport failure after server creation can leave uncertainty about whether a link was created. No idempotency or full-secret recovery from `share list` is exposed here; inspect metadata and revoke an unwanted entry before deliberately replacing it.

## STORY-019: Recover an MCP agent's permission and key setup

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium — 7 actions  
**Topic:** MCP creation and least-privilege recovery  
**Persona:** Atlas research agent, supervised by Maya.  
**Goal:** Share a single report without granting management access or revealing a drive key in conversation.  
**Preconditions:** Configured MCP host; seeded file; initial key has `read` but not `share` for the intended drive, and the drive key is correctly configured. An authorized operator can supply a replacement scoped credential and protected key configuration.  
**Testability:** **CLI/MCP-ONLY**; **LOCAL-SYNTHETIC-TESTABLE**; live account provisioning **LIVE-PROVIDER-BLOCKED / UNVERIFIED**.  
**Ideal path:** **2** — request the share with complete parameters, then hand off its result; permission repair is setup friction.  
**Alternate paths:** CLI creation invokes the same `createShare` implementation. CLI/SDK can list or revoke; equivalent MCP list/revoke tools were not found.  
**Sources:** SHARE.S2–SHARE.S4, SHARE.S8–SHARE.S9, SHARE.S11–SHARE.S12.

### Steps

1. Invoke MCP `share` with `driveId: DRIVE_ID` and `path: "/reports/juniper-summary.csv"` → the preflight can read, but creation returns a structured `permission_denied` error because `share` is absent.
2. Ask the operator for an existing or newly authorized key limited to this drive with `read` and `share` → remediation changes authorization, not encryption or public access.
3. Reconfigure/reconnect the MCP host with that credential through its protected configuration → subsequent calls use the authorized client.
4. In the missing-drive-key variant, invoke `share` before supplying the local drive key → `missing_drive_key` is returned and no share POST occurs.
5. Have the operator restore the correct per-drive key through protected configuration and reconnect → the client can locally unwrap this file's key; no key is pasted into the agent conversation.
6. Invoke `share` again with an optional valid future ISO `expiresAt` and, if needed, `versionId` → the tool returns the created share metadata and full URL.
7. Deliver only the intended complete link to Ravi → it grants anonymous access to the pinned file version, not general drive access.

### Variations

- With correct scopes and key from the start, actions 1–5 collapse into setup.
- Omit `expiresAt` for the seven-day default; MCP accepts an ISO datetime, not CLI strings such as `24h`.

### Edge Cases

- `share` without `read` fails during metadata preflight.
- A key scoped to another drive or account is denied even if its scope names include `share`.
- A malformed drive key yields `invalid_drive_key`; a syntactically valid but wrong key yields decryption failure.
- Reconnect behavior belongs to the MCP host, not an invented Agent Drive UI. The server constructs its client from configured credentials at startup.

## STORY-020: Download anonymously, including keyboard or mobile use

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short — 3 actions  
**Topic:** Anonymous encrypted share viewer  
**Persona:** Ravi Shah, outside recipient with no Agent Drive account.  
**Goal:** Save the report without signing up.  
**Preconditions:** Active COMPLETE_LINK; existing stored ciphertext; sender account can authorize access; browser supports required Web Crypto/download functionality.  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** anonymous browser candidate; browser execution was **NOT PERFORMED**; deployed storage acceptance is **LIVE-PROVIDER-BLOCKED / UNVERIFIED** in this review.  
**Ideal path:** **2** — open link and choose Download.  
**Alternate paths:** Pointer, touch, or native keyboard activation of the same button. No alternative account-required share-viewer path was found.  
**Sources:** SHARE.S5–SHARE.S7, SHARE.S9–SHARE.S10.

### Steps

1. Open COMPLETE_LINK → the page checks metadata and shows the filename, “TRANSFER SIZE,” “LINK EXPIRES,” “Download,” and “Your browser decrypts this file. No sign-in required.”
2. Activate “Download” → a fresh public authorization request precedes ciphertext fetching; the button is disabled and reads “Decrypting…” while the operation is busy.
3. Accept/open the browser-managed download as appropriate → the implementation creates a decrypted Blob and suggests the shared file's basename as the filename.

### Variations

- Keyboard-only: navigate to the native Download button and activate it with Enter or Space; this is an intended accessibility journey, not a verified focus-order claim.
- Mobile: use the same URL and tap Download. CSS declares a full-width button with minimum height 48px and layout adjustments below 480px; actual layout and OS download behavior remain unverified.
- The “agent drive” home link has accessible name “Agent Drive home”; it navigates to `/`, not to a required login step.

### Edge Cases

- Displayed size is **encrypted bytes**, not a promised plaintext size.
- Link opening fetches metadata; Download rechecks status. A link can expire or be revoked between those actions.
- Opening metadata reserves an operation; the metadata view is not evidence of zero usage cost.
- No inline file preview, save-location picker, percentage progress, or explicit success banner is implemented in this viewer.

## STORY-021: Recover a truncated link without signing in

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short — 4 actions  
**Topic:** Missing or malformed fragment recovery  
**Persona:** Ravi, who received a URL shortened by a messaging system.  
**Goal:** Recover the complete share capability safely.  
**Preconditions:** Existing active share, but received URL lacks `#k=…` or has a malformed key; sender still has the complete link.  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE**; no live identity provider needed; hosted delivery behavior unverified.  
**Ideal path:** **3** — identify incomplete link, obtain the original, open/download it.  
**Alternate paths:** Open the corrected complete URL afresh, or update its fragment in place; the viewer subscribes to `hashchange`.  
**Sources:** SHARE.S6–SHARE.S7, SHARE.S9.

### Steps

1. Open `/s/SHARE_ID` without a fragment → heading says “This link is missing a valid decryption key”; no share metadata fetch begins while the parsed key is absent.
2. Read “Ask the sender for the complete link, including everything after the # symbol.” → recovery does not ask for an account, password, or drive key.
3. Obtain and open the original COMPLETE_LINK → a valid fragment triggers metadata loading for the same share.
4. Activate Download → the normal anonymous download path is available if the share remains active.

### Variations

- Empty `k`, wrong length, invalid characters, or noncanonical base64url encoding follow the missing-valid-key branch.
- Keyboard users can correct the address-bar URL; mobile recipients can reopen the sender's original complete link. Neither requires an in-page key-entry control.

### Edge Cases

- With no valid fragment, even a nonexistent or revoked ID initially yields the missing-key message because the server is not queried.
- A well-formed but incorrect key is different: it may show metadata and fails only when decrypting (STORY-022).
- Treat the complete link as a bearer secret. Do not ask recipients to paste it into public support logs.

## STORY-022: Correct a well-formed but wrong file key

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium — 5 actions  
**Topic:** Decryption failure and recovery  
**Persona:** Ravi, receiving a mistakenly assembled link for Juniper review.  
**Goal:** Download the intended file without receiving corrupted output.  
**Preconditions:** Active share for `juniper-review.csv`; its URL has accidentally been paired with a different file's syntactically valid key; sender can resend the original URL.  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** with two disposable encrypted fixtures; hosted acceptance unverified.  
**Ideal path:** **3** — recognize mismatch, replace link, download successfully.  
**Alternate paths:** Open the corrected complete URL or replace the fragment on the same page; both trigger the implemented key-dependent metadata effect.  
**Sources:** SHARE.S2, SHARE.S6–SHARE.S7, SHARE.S12.

### Steps

1. Open the incorrectly paired URL → valid fragment syntax allows metadata loading; seeing the filename does not prove the key can decrypt it.
2. Activate Download → authenticated decryption fails and the heading becomes “This link's key can't decrypt this file”; no decrypted Blob/download is created by this failure path.
3. Read the instruction to ask for the complete link including everything after `#` → do not substitute a drive key or guess fragments.
4. Open the sender's intact original URL → successful metadata loading clears the previous error state.
5. Activate Download again → the correct file key allows the normal browser-decryption/download path.

### Variations

- Recovery may be done using keyboard address-bar editing or mobile reopening of the original message.
- Damaged/incomplete ciphertext can also fail authenticated decryption; the heading does not uniquely diagnose a sender copying error.

### Edge Cases

- A valid fragment is a syntax check, not cryptographic verification.
- The error branch replaces the download controls; there is no dedicated Retry button.
- Repeatedly downloading with the same wrong key is not a useful recovery and can still consume authorization/transfer usage.
- Never infer that one file's share key grants access to another file or the whole drive.

## STORY-023: Replace an expired link

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short — 4 actions  
**Topic:** Expiry and renewal-by-replacement  
**Persona:** Ravi returning after a report-review deadline.  
**Goal:** Obtain access only if the sender still approves it.  
**Preconditions:** Expired share with a complete valid fragment; sender retains authorized access and the source file.  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** with a pre-seeded expired fixture; replacement creation is **CLI/MCP-ONLY**; hosted acceptance unverified.  
**Ideal path:** **3** — recognize expiry, request replacement, open/download replacement.  
**Alternate paths:** Replacement can be created by CLI or MCP. No in-place expiry extension or recipient “request access” control was found.  
**Sources:** SHARE.S1–SHARE.S6, SHARE.S9.

### Steps

1. Open the old complete link → heading says “Share link expired.”
2. Read “Ask the sender for a new share link. Your files have not been changed.” → the page does not offer self-renewal.
3. Ask Maya to create a new authorized link, for example with `--expires-in 24h` → a distinct share ID and expiry are returned; the old share is not extended.
4. Open the replacement and choose Download → access follows the new share's status and lifetime.

### Variations

- Open while active, then press Download after expiry → fresh authorization returns the expiry error.
- A share under one second from expiry may no longer receive a download URL even before its displayed deadline fully elapses.

### Edge Cases

- Server/database time governs validity; browser-local expiry formatting does not grant extra time.
- A share both revoked and expired is reported as revoked because that check comes first.
- If the file is trashed or the drive/account is being deleted, replacement requires resolving availability first.

## STORY-024: Revoke the right link without deleting the report

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium — 6 actions  
**Topic:** Revocation, inventory, and destructive safety  
**Persona:** Maya, withdrawing a mistakenly sent report link.  
**Goal:** Stop future authorizations for one share while keeping the source file and other intended links.  
**Preconditions:** Active share; authorized drive-scoped `share` permission; a recipient may already have the page open.  
**Testability:** **CLI/MCP-ONLY** management via CLI/SDK, not MCP list/revoke; **LOCAL-SYNTHETIC-TESTABLE**; hosted acceptance unverified.  
**Ideal path:** **2** — identify the link and revoke it, with target confirmation integrated into selection.  
**Alternate paths:** SDK `revokeShare` and authenticated API DELETE reach the same backend action. No anonymous self-revoke control or MCP revoke tool was found.  
**Sources:** SHARE.S1–SHARE.S2, SHARE.S4–SHARE.S6, SHARE.S8–SHARE.S9.

### Steps

1. Run `pnpm agent-drive share list --drive DRIVE_ID` → entries show ID, path, pinned version, expiry, revocation timestamp and status.
2. Match the intended SHARE_ID against path/version; follow `--cursor` if needed → avoid revoking an unrelated report share.
3. Run `pnpm agent-drive share revoke SHARE_ID --drive DRIVE_ID` → JSON returns the ID and `revokedAt`; there is no interactive confirmation prompt.
4. List shares again → this entry is `revoked`; this command did not delete the source file.
5. Ask the recipient to reload, or activate Download on the already-open page → a new server request yields “Share link revoked.”
6. Explain the safety boundary to stakeholders → previously saved plaintext cannot be recalled, and a previously issued storage URL can remain usable for at most 60 seconds.

### Variations

- Repeating revoke preserves the first revocation timestamp through `COALESCE`; it does not un-revoke.
- If a new approved transfer is needed, create a new share via CLI/MCP rather than trying to reactivate the revoked one.

### Edge Cases

- An ID from another account/drive cannot be revoked through this drive.
- A missing/invalid target does not revoke the whole drive.
- A tab showing old metadata is not proof that revocation failed; Download reauthorizes.
- Immediate universal erasure is not the feature's guarantee. Avoid wording that implies revocation deletes already-downloaded files.

## STORY-025: Distinguish unavailable content from a transient download failure

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium — 5 actions  
**Topic:** Anonymous error journeys and escalation  
**Persona:** Ravi, unable to retrieve an otherwise legitimate report.  
**Goal:** Find the correct recovery without changing files or requesting unnecessary credentials.  
**Preconditions:** Active full link whose backing file is now trashed; sender can investigate. Network/storage-failure variations use independent synthetic fixtures.  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE**; backing-file recovery overlaps Files/Trash topic; live storage/TLS/billing diagnosis **LIVE-PROVIDER-BLOCKED / UNVERIFIED**.  
**Ideal path:** **3** — identify failure, get sender remediation, reopen/download.  
**Alternate paths:** No alternate retrieval control on the error page. Reload/reopen performs a new attempt; the home link only navigates away.  
**Sources:** SHARE.S5–SHARE.S7, SHARE.S10–SHARE.S11.

### Steps

1. Open the complete link to the trashed file → the public handler returns `share_unavailable`; heading says “Shared file unavailable.”
2. Read the sender-contact instruction → the viewer offers neither Restore nor an authentication workaround.
3. Contact Maya with the report identity and error, without publishing the secret fragment → remediation moves to the authorized sender.
4. After Maya restores availability through the existing file-management workflow, reopen the original complete link → if still active and not revoked, the public handler can return metadata again.
5. Activate Download → normal authorization and browser decryption proceed if storage and account allowances permit them.

### Variations

- Unknown/malformed share ID **with a valid fragment** → “Share link not found.”
- Metadata network failure, failed storage fetch, missing authorized URL, quota/payment-related API code, or insecure download URL → generic “Share unavailable” heading, with the generic request-for-new-link guidance.
- For a transient failure resolved externally, reload the same complete link; there is no dedicated in-page Retry control.
- A production HTTP request can be stopped before this page with “HTTPS is required for share links.” Exact loopback HTTP is a development exception.

### Edge Cases

- The UI stores detailed exception text internally but renders mapped headings and generic guidance; “ask for a new link” does not prove replacement is the right fix for network or billing failures.
- Drive/account deletion excludes records from the public query and can appear as not-found rather than the trashed-file message.
- Revoked or expired status takes precedence over file-unavailable status.
- No claim is made about CORS, storage reachability, mobile download behavior, or provider health from this source review.

## STORY-026: Publish a revision, keep the original review reproducible, then withdraw it

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** long — 16 actions  
**Topic:** End-to-end version-pinned sharing lifecycle  
**Persona:** Maya and Ravi completing a two-round review of Juniper results.  
**Goal:** Keep the original review link tied to its original contents, send an approved revision separately, and retire only the old link.  
**Preconditions:** Synthetic drive and local draft/revised CSV files; built CLI; protected correct drive key; API key with `read`, `write`, and `share`; anonymous recipient browser. Onboarding/signup is excluded.  
**Testability:** Sender upload/create/list/revoke steps are **CLI/MCP-ONLY**; mixed workflow **LOCAL-SYNTHETIC-TESTABLE**; hosted full-stack acceptance **LIVE-PROVIDER-BLOCKED / UNVERIFIED**.  
**Ideal path:** **10** — first upload/create/open/download (4), revised upload/create/open/download (4), and select/revoke old share (2); explicit safety and reproducibility checks extend the realistic story below.  
**Alternate paths:** MCP can create either share using `versionId`; CLI `--version` selects an older version explicitly. Listing/revocation remain CLI/SDK/API rather than an invented Shares tab.  
**Sources:** SHARE.S1–SHARE.S6, SHARE.S9, SHARE.S11.

### Steps

1. Upload the initial local CSV with `pnpm agent-drive put ./juniper-draft.csv /reports/juniper-summary.csv --drive DRIVE_ID` → encrypted version metadata is returned; default upload is create-only.
2. Record the returned version ID as V1 → Maya has a nonsecret identifier for the review baseline.
3. Create a 24-hour share with `--version V1` → output identifies V1 and returns complete link A.
4. Send complete link A to Ravi through an appropriate private channel → delivery does not disclose the drive key.
5. Ravi opens A → filename, encrypted size and expiry are shown without sign-in.
6. Ravi chooses Download → the browser is expected to decrypt and download V1.
7. Maya uploads `./juniper-revised.csv` to the same remote path with `--if-version V1` → replacement succeeds only if V1 is still current and returns V2.
8. Run `pnpm agent-drive versions /reports/juniper-summary.csv --drive DRIVE_ID` → version metadata lets Maya distinguish the original and revised records.
9. Ravi reopens A → the share still targets V1, not automatically V2.
10. Ravi downloads A again for comparison → the expected content is the original review baseline.
11. Maya creates a second 24-hour share with `--version V2` → complete link B is returned for the revision.
12. Ravi opens B → the same basename may appear, since the viewer does not display the pinned version ID.
13. Ravi downloads B → the revised file is expected; browser handling of duplicate filenames is external to the app.
14. Maya lists shares and matches A's ID/V1 rather than relying only on the common path → metadata distinguishes the two links before withdrawal.
15. Maya revokes A → A receives a revocation timestamp; B is a separate share and is not the command's target.
16. Ravi reloads A and B → A is expected to show “Share link revoked,” while B remains available if otherwise active; previously downloaded V1 is not erased.

### Variations

- Omit `--version` during creation to pin the version selected by the client's metadata preflight. A later overwrite is not intended to change that share.
- Use MCP `share` for steps 3 and 11 with explicit `versionId` and ISO `expiresAt`.
- Use keyboard-only or mobile viewer actions from STORY-020; sender CLI actions remain terminal workflows.

### Edge Cases

- Conditional-upload conflict: inspect current version before deciding how to proceed; do not silently replace `--if-version` with unconditional `--overwrite`.
- A version from a different file does not qualify for the requested path.
- A concurrent update between preflight and creation does not silently change the selected version: POST receives the preflight's selected ID.
- Identical displayed filenames can obscure different versions; use sender-side IDs and recipient communication rather than claiming a viewer version badge.
- Full link A cannot be reconstructed from the list response alone. Retain it securely if it will be revisited; do not log fragments for convenience.

## STORY-027: Complete a monthly usage review and prepare finance exports

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** long  
**Topic:** Usage, attribution, statements, spending review  
**Persona:** Jordan Ellis, a developer responsible for a small automation budget  
**Goal:** Reconcile retained data and agent activity, export two periods, and set controls  
**Preconditions:** Synthetic account with drive **research-notes**, agent **Research runner**, current usage and at least one earlier persisted statement; synthetic alert address finance@example.test  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** with prepared usage/history; real log completeness and email delivery are **LIVE-PROVIDER-BLOCKED**  
**Ideal path:** **8** — reach usage, inspect drivers, reach billing, inspect charges, choose/export prior period, export current period, enter controls, save; the detailed review deliberately checks multiple meanings  
**Alternate paths:** Sidebar **Billing & limits** bypasses Usage; direct /console/billing also works. **Usage** → **EGRESS & COST** → **Billing & limits** is the contextual route.  
**Sources:** BILL.U1, BILL.B1–BILL.B5, BILL.A1, BILL.L2, BILL.P2, BILL.D1

### Steps

1. Open /console → workspace navigation is available for the current account.
2. Select **Usage** → see **ENCRYPTED STORAGE**, **API OPERATIONS**, and **EGRESS & COST**.
3. Review **ENCRYPTED STORAGE** and its caption → retained committed versions, including trash, explain the figure.
4. Review **Storage by drive** for **research-notes** → see stored bytes, live-file/version counts, and either a finite quota or **account limits apply**.
5. Review **Usage by author** → identify storage/version/activity attribution for **Research runner**.
6. Activate **Billing & limits** in **EGRESS & COST** → reach billing.
7. Review the month's **ESTIMATE** → separate metered overage from the listed-base estimate; note tax exclusion and invoice proration.
8. Review **RETAINED STORAGE** → compare current retained bytes with included allowance and monthly peak.
9. Review **OBSERVED DOWNLOADS** and authorized bytes → distinguish transfers from authorizations; **Not connected** is not zero transfers.
10. Review **Configured overage rates**, if present → rates describe paid overages and monthly peak allocation, not time-weighted storage.
11. Review **Usage by agent** → see current-month rows and the author/requester/public-activity attribution caveat.
12. Set **Export period** to the earlier statement → select an earlier CSV source; the visible table remains current-month data.
13. Activate **Download CSV** → the client prepares the selected statement's usage CSV, named for that period.
14. Return **Export period** to **Current month** and activate **Download CSV** → prepare the current export for comparison.
15. Enter 60.00 in **Monthly write cap (USD)**, 40.00 in **Email me at (USD)**, and finance@example.test in **Alert email** → stage account controls, not a guaranteed maximum invoice.
16. Activate **Save spending controls** → successful save/reload displays **Spending controls saved.**

### Variations

- No prior statement: only **Current month** is available; omit historical comparison instead of fabricating history.
- First-use account: **No storage used yet.** and **Agent usage will appear after your first operation.** are expected empty states.
- Keyboard: native select/buttons support a keyboard acceptance variant; downloaded-file handling depends on the browser.
- Mobile: review stacked billing cards and table container; overflow, readability, and focus need rendered verification.

### Edge Cases

- CSV is an attribution breakdown, **not** a per-agent allocation of charges or a Stripe invoice.
- Public activity without an agent appears only in account totals; do not require summed agent rows to equal every total.
- CSV uses raw byte/operation values and an egress-source caveat; UI sizes are formatted.
- The console actor is **Human console** in workspace Usage, **Console** in billing, and raw **console** in CSV.
- Formula-like agent names are prefixed/escaped by the CSV helper.
- Statement-loading failure can coexist with a loaded summary and error banner; **Refresh** retries both.
- Historical export selection does not change the visible table to historical data; this is a clarity concern, not an implemented filter.

## STORY-028: Recover invalid spending controls and safely remove a cap

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Spending cap, alert validation, error recovery  
**Persona:** Priya Shah, maintaining a prototype with an unpredictable workload  
**Goal:** Save a $50 write cap and $35 alert without mistaking the cap for an invoice guarantee  
**Preconditions:** Signed-in synthetic account; billing loaded; no external financial action  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** for validation/persistence; email delivery **LIVE-PROVIDER-BLOCKED**  
**Ideal path:** **4** — open controls, enter cap, enter alert/email, save  
**Alternate paths:** Sidebar, Usage-card link, or direct billing URL. No second cap-setting UI found.  
**Sources:** BILL.B1, BILL.B2, BILL.B4, BILL.A1, BILL.L1–BILL.L2

### Steps

1. Open **Billing & limits** and review spending-control text → understand writes stop at estimated spend while reads retain separate allowances.
2. Enter 50.005 in **Monthly write cap (USD)**, 35.00 in **Email me at (USD)**, and leave **Alert email** blank → stage invalid input.
3. Activate **Save spending controls** → client validation reports **Enter a dollar amount with at most two decimal places.**
4. Correct the cap to 50.00 and save again → server rejects an alert threshold without email.
5. Enter priya@example.test in **Alert email** → supply the required synthetic destination.
6. Activate **Save spending controls** → successful save/reload displays **Spending controls saved.**
7. Revisit billing → stored cap, threshold, and address repopulate the form.
8. In an intentional cap-removal variant, clear the cap and save → blank becomes no cap; threshold/email can remain configured.

### Variations

- Enter 0 only in a disposable fixture → UI warns zero blocks new writes immediately.
- Disable alerts by blanking **Email me at (USD)**; also blank **Alert email** if the address should no longer be stored.
- Keyboard/mobile: labeled inputs use decimal input mode; email has native email semantics. Actual validation/focus behavior is untested.
- If email delivery is unconfigured, a threshold can be saved and UI says alerts remain queued.

### Edge Cases

- Negative, comma-formatted, exponent, and over-two-decimal amounts fail the custom dollar parser; maximum is $10,000,000.
- No rule requires an alert threshold below the cap; do not invent one.
- Estimate includes listed base fees; a paid account can already exceed a low cap without overages.
- Lowering/clearing/zeroing a cap has no extra confirmation. Clearing increases spending exposure; zeroing interrupts writes but is not deletion.
- **Refresh** reloads persisted controls and can replace unsaved edits.
- PATCH success followed by reload failure can show an error despite persistence; review current values before assuming rollback.
- Save success does not prove email delivery; queueing/delivery are asynchronous.

## STORY-029: Understand disabled checkout without losing Free access

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Provider-unconfigured behavior  
**Persona:** Leo Martin, trying a self-hosted deployment before enabling payments  
**Goal:** Distinguish unavailable checkout from a broken Free workspace  
**Preconditions:** Synthetic Free account; incomplete billing-provider configuration; billing API otherwise usable  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE**; deliberately no live checkout  
**Ideal path:** **3** — inspect availability, inspect billing controls, return to workspace  
**Alternate paths:** Public paid **Manage your plan** or workspace **Billing & limits** reaches billing.  
**Sources:** BILL.P1–BILL.P2, BILL.B2–BILL.B4, BILL.S1, BILL.D1

### Steps

1. Open /pricing → read the paid-checkout-unavailable notice while plan descriptions remain visible.
2. Activate **Manage your plan** using the existing synthetic session → billing displays **Paid checkout is not enabled** and the Free continuation message.
3. Review plan buttons → paid choices are disabled; **Current plan** is disabled on Free; those buttons cannot initiate Stripe checkout.
4. Activate **Back to workspace** → return to /console without buying a plan.

### Variations

- Paid-account fixture: warning instead says **Contact your workspace operator to restore payment setup.**
- Missing log source: **OBSERVED DOWNLOADS** displays **Not connected**.
- Missing email: spending controls remain saveable with a queued-alert warning.
- Keyboard: disabled native buttons are not actionable links; mobile stacks cards by CSS.

### Edge Cases

- Public **Manage your plan** stays navigable when checkout is disabled; billing is the explanatory destination.
- Configuration presence is not provider health or validated live prices.
- Portal button depends on an existing customer, not the checkout-configured flag; it may appear and later fail.
- This does not prove Free file storage works: authentication/database/object storage are separate prerequisites.

## STORY-030: Start or resume Developer checkout without duplicating subscriptions

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Checkout and abandoned-checkout recovery  
**Persona:** Maya Chen, ready to exceed Free allowances  
**Goal:** Begin Developer and recover safely if interrupted  
**Preconditions:** Signed-in Free account; full valid billing configuration; approved provider test environment for future execution  
**Testability:** **LIVE-PROVIDER-BLOCKED** end to end; fixtures cannot establish real payment success  
**Ideal path:** **3** — select paid plan, complete provider flow, review returned state  
**Alternate paths:** Pricing **Manage your plan**, sidebar, Usage-card link, or direct billing URL. Existing recoverable checkout is reused server-side, not a separate purchase route.  
**Sources:** BILL.B1–BILL.B3, BILL.A1, BILL.S1–BILL.S3

### Steps

1. Open **Billing & limits** → verify free is current and **Choose developer** is enabled.
2. Review Developer allowances, rates, and existing cap → understand the intended financial change.
3. Activate **Choose developer** → app requests checkout and only accepts HTTPS URLs on allowed Stripe checkout/billing hosts.
4. If interrupted before payment, return to billing and activate **Choose developer** again → a recoverable open same-plan checkout is reused.
5. Continue through provider flow → external acceptance prerequisite; no Stripe screen/button labels are invented from application source.
6. Return to /console/billing?checkout=success and review account state → expect accepted subscription synchronization, not the query parameter alone, to determine the displayed plan.

### Variations

- Provider cancellation returns to /console/billing?checkout=cancelled; no custom success/cancel query-message handling was found in BillingClient.
- A different plan can replace a known open checkout by expiring it first.
- Delinquent/incomplete subscriptions can route to the portal rather than create another checkout.
- Keyboard/mobile coverage stops at the external boundary unless separately authorized.

### Edge Cases

- Completed checkout awaiting subscription update produces a conflict; repeated clicks are not a synchronization strategy.
- Unknown-session recovery after 23 hours explicitly requires manual Stripe reconciliation.
- Different-plan request while a prior reservation lacks a session ID requires resuming the previous plan.
- Unexpected/missing provider URLs become errors rather than navigation targets.
- No invoice, payment, or webhook success was observed.

## STORY-031: Change paid tier with explicit financial confirmation

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Paid plan changes and payment recovery  
**Persona:** Jordan Ellis, growing from Developer to Team  
**Goal:** Increase allowance while retaining the existing spending cap  
**Preconditions:** Active/trialing Developer subscription, customer, valid configuration; provider changes require approved test environment  
**Testability:** **LIVE-PROVIDER-BLOCKED** for subscription/proration behavior  
**Ideal path:** **3** — select target, confirm financial implications, verify changed plan  
**Alternate paths:** All billing entries reach the same plan controls. Portal is documented for invoices/payment details/cancellation, not the in-app paid-tier workflow.  
**Sources:** BILL.B2–BILL.B4, BILL.S1–BILL.S2, BILL.D1

### Steps

1. Open billing → developer is current and **Change to team** is available.
2. Review cap and Team base/allowances → do not assume upgrading raises the cap.
3. Activate **Change to team** → native confirmation explains next-invoice proration and cap preservation.
4. Cancel confirmation → no plan-change request is sent.
5. Activate **Change to team** again and confirm → submit the paid-tier update.
6. On success, read **Plan updated. Stripe will apply prorations on your next invoice.** → refreshed state should mark Team current.
7. Review spending controls → existing cap remains, even if now below the higher base estimate.

### Variations

- Team → Developer uses the same controls; reduced allowances can affect subsequent operations.
- Payment failure instructs the user to update details in the portal and retry.
- No-longer-active provider subscription can redirect to the portal.
- Keyboard: native confirmation includes cancel; mobile confirmation appearance is browser-dependent and unverified.

### Edge Cases

- **Included by default** on Free is disabled; there is no in-app **Change to free** button.
- Failed provider payment must not be narrated as an upgrade.
- A retained cap below the new base can stop later writes; upgrade is not a cap override.
- Per-drive caps remain separate and are not raised by account upgrade.
- No proration amount preview is implemented in the confirmation.

## STORY-032: Open invoices/payment details without inventing portal controls

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** Billing portal and cancellation boundary  
**Persona:** Alex Rivera, reviewing payment records  
**Goal:** Reach the existing customer's provider billing area  
**Preconditions:** Signed-in account with hasCustomer=true; functioning provider portal configuration for external acceptance  
**Testability:** **LIVE-PROVIDER-BLOCKED** beyond app handoff  
**Ideal path:** **2** — open billing, activate portal entry  
**Alternate paths:** Delinquent/incomplete subscriptions can reach portal through checkout handling. Explicit portal button is the direct invoice-access route.  
**Sources:** BILL.B2, BILL.S1–BILL.S3, BILL.D1

### Steps

1. Open **Billing & limits** → **Invoices & payment details** appears for an account with a customer.
2. Activate **Invoices & payment details** → request a customer-specific portal session.
3. Follow returned allowed Stripe URL → external provider UI is the destination; exact screens are outside repository evidence.
4. Use provider return path, if available → configured return URL is /console/billing.

### Variations

- No customer: button is absent, not a disabled invoice viewer.
- Provider error: app displays an error with **Refresh**, which reloads billing rather than replays portal creation.
- Keyboard/mobile: verify app button separately from Stripe interface.

### Edge Cases

- README describes cancellation as portal capability, but exact cancellation controls, confirmation text, and effective dates are not derivable here.
- Cancellation and account deletion are different; do not delete data to cancel.
- Customer record alone does not establish portal availability.
- CSV breakdowns supplement invoices, not replace payment records.

## STORY-033: Hand quota failure to a human without deleting retained data

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Quotas, upgrade links, upload boundary, destructive safety  
**Persona:** Research runner, an agent, and Priya, its human operator  
**Goal:** Diagnose rejected upload and choose a non-destructive response  
**Preconditions:** Synthetic agent credential authorized for synthetic drive; drive key already client-side; account near a chosen allowance; innocuous quarterly-notes.md; no secrets in story  
**Testability:** **CLI-ONLY UPLOAD / CROSS-SURFACE**. Local quota failures are synthetic-testable with prepared fixtures; real upgrade is **LIVE-PROVIDER-BLOCKED**.  
**Ideal path:** **4** — attempt operation, explain failure/link, inspect responsible limit, choose authorized remedy  
**Alternate paths:** Browser drive creation and file-state changes such as restore can encounter account enforcement. Uploads themselves are CLI/MCP, not console controls.  
**Sources:** BILL.C1, BILL.L1, BILL.Q1, BILL.P3, BILL.U1, BILL.B3–BILL.B4, BILL.D1

### Steps

1. Invoke CLI put with local quarterly-notes.md, remote reports/quarterly-notes.md, and --drive set to the synthetic drive ID → upload exceeding account allowance is rejected.
2. Read CLI error → account allowance failure carries an **Upgrade:** link to /console/billing.
3. Give message/link to Priya rather than retry continuously → human has account-level decision context.
4. Priya opens billing → inspect plan, retained storage, estimate, allowances, and cap.
5. Use **Back to workspace**, then **Usage** → review retained versions and whether the drive has a finite quota.
6. Return to **Billing & limits** → distinguish upgrade, cap adjustment, payment repair, or operator intervention; choose only a remedy matching the actual rejection.
7. If no authorized remedy exists, leave job paused → do not trash/permanently delete data as a guessed fix. Retry only after an independently verified remedy.

### Variations

- Explicit drive limit: quota_exceeded with **The drive quota would be exceeded.** is different from account payment_required.
- Write cap: reads are not blocked by that cap itself; increase/remove only with intentional approval.
- Download quota: new authorization can fail with **Your monthly download allowance has been reached.**
- Operation quota: reads as well as writes can fail; billing recovery/account controls remain available.
- Keyboard/mobile applies to the human console segment, not CLI interaction.

### Edge Cases

- Trash and overwritten versions count; trashing is not reliable storage relief.
- Upgrade does not raise an explicit/legacy per-drive cap.
- Pending upload intents reserve capacity; committed bytes alone may not explain rejection.
- Download authorizations differ from observed transfer charges. Reusable links and delayed logs prevent exact network-ceiling interpretations.
- 5 GiB encrypted-upload maximum includes overhead; nominal 5 GiB plaintext is not a workaround.
- Agent self-payment via a machine-payment protocol is explicitly later scope in BILL.D3.

## STORY-034: Recover billing after a session or loading failure

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** Error recovery, human permissions, account boundaries  
**Persona:** Maya Chen, returning to an old billing tab  
**Goal:** Recover without assuming unsaved controls or another account's billing carried over  
**Preconditions:** Existing billing tab; expired session or controlled loading failure; synthetic sign-in infrastructure available for local acceptance  
**Testability:** **LOCAL-SYNTHETIC-TESTABLE** for local auth/error boundaries; real Clerk reauthentication **LIVE-PROVIDER-BLOCKED**  
**Ideal path:** **3** — identify failure, restore session/retry, verify current state  
**Alternate paths:** Initial unauthenticated page load redirects server-side; later billing API 401 redirects client-side. Non-401 load errors expose **Refresh**.  
**Sources:** BILL.B1–BILL.B2, BILL.A1–BILL.A2, BILL.D2

### Steps

1. Reopen expired billing tab and attempt a billing request → 401 initiates navigation to /sign-in.
2. Reestablish intended human session through approved authentication → do not substitute an agent API key.
3. Navigate explicitly back to /console/billing → load authenticated account summary/settings/statements.
4. Review saved cap and alert values before editing → prior unsaved text is not promised to survive navigation.
5. For non-401 transient loading error, activate **Refresh** → retry summary/history; persistent failure remains an alert.

### Variations

- Direct unauthenticated billing access redirects before client render.
- Two synthetic users with different fixtures should receive their own summaries/statements; this is a future isolation check, not an observed result.
- Keyboard: error uses role=alert, status uses role=status, Refresh is a native button; actual announcement/focus requires testing.
- Mobile: verify error banner's narrow column layout.

### Edge Cases

- Mutations require same-origin requests; cross-origin save/checkout/portal are denied.
- Billing is a human-console route; agent bearer credentials do not replace a console session.
- Account being deleted receives **The account is being deleted.** for billing rather than normal recovery.
- No in-page account selector or separate finance-role interface was found; do not invent admin/member role journeys.
- No dedicated offline state or automatic retry/backoff UI was found in BillingClient.

## STORY-035: Trace an older agent request in the audit log

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** deletion-audit / audit pagination  
**Persona:** Maya, owner of a workspace used by the `release-helper` agent.  
**Goal:** Find an older failed operation and understand its actor and result without exposing file contents or credentials.  
**Preconditions:** Signed-in owner; more than 25 account audit entries, including a known older failure and a key labeled `nightly-build`; no deletion in progress. Fixture metadata is synthetic.  
**Ideal path:** **3** — open activity, reveal older entries, inspect the relevant result. This is a design benchmark, not a measured interaction count.  
**Alternate paths:** Open `/console/settings` directly instead of the console’s **Activity & deletion** navigation link. No audit search, export, or filter control was found.  
**Testability:** Local-synthetic-testable; no CLI/MCP-only steps.  
**Sources:** DA.S1, DA.S3, DA.S7, DA.S14, DA.S18.

### Steps

1. Select **Activity & deletion** from `/console` → **Audit log** appears with **When**, **Action**, **Actor**, and **Result**, most recent first.
2. Read a recent row → a console actor is **Console user**; otherwise an agent name or **Public / unauthenticated** is shown, with a key label when available.
3. Select **Load older events** → the next page appends below existing entries; the button is disabled during loading and disappears when there is no next cursor.
4. Inspect the known older failure → its fixed action label, **failure**, HTTP status and optional error code are visible; a pending event instead reads **In progress** without the final HTTP detail.
5. Select **Refresh** → the first audit page replaces the accumulated rows and the audit container scrolls to its top; this is not an append operation.

### Variations

- **Keyboard:** Tab to the **Audit events** region, scroll it, and activate the native older-events button. The region has `tabIndex=0`; actual focus visibility and screen-reader output remain untested.
- **Mobile:** At the narrow breakpoint the audit table has a minimum width of 630px inside an overflow container; use horizontal scrolling to inspect Result. Do not infer that all columns fit the viewport.
- **Empty:** With no returned rows, **No audit events loaded.** appears; this is not proof that the request succeeded if an error banner is also visible.

### Edge Cases

- Older-page failure shows a top-level alert and retains existing rows/cursor; retry **Load older events** after recovery.
- Cursor ordering uses full timestamp text and ID; same-looking local timestamps must not be treated as duplicate events. The existing microsecond-pagination test definition is source evidence, not a passed test.
- Audit “success” means a request result, not successful background erasure. New events may arrive between pages; **Refresh** is needed to see the new head.

## STORY-036: Reconsider a drive deletion without losing anything

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** short  
**Topic:** deletion-audit / destructive confirmation  
**Persona:** Noah, cleaning an obsolete project but unsure whether he selected the correct drive.  
**Goal:** Discover the exact-confirmation safeguard and safely leave before requesting deletion.  
**Preconditions:** Signed-in owner; active drives `Atlas Sandbox` and `Atlas Archive`; no account deletion; settings fully loaded.  
**Ideal path:** **4** — inspect warning, choose target, verify confirmation boundary, leave without submitting.  
**Alternate paths:** Direct settings URL or **Activity & deletion**; **Back to files** and the header brand both return to `/console`. No undo/cancel-deletion control was found.  
**Testability:** Local-synthetic-testable; no CLI/MCP-only steps.  
**Sources:** DA.S3, DA.S4, DA.S8.

### Steps

1. Open **When is data actually removed?** → read that deletion is irreversible, new access is disabled at acceptance, and physical cleanup is delayed; already-issued links may last until expiry.
2. Choose `Atlas Sandbox` under **Drive** and enter `atlas sandbox` → **Permanently delete drive** remains disabled because the confirmation differs.
3. Replace the input with `Atlas Sandbox` → the button becomes eligible when no other busy/account-deletion condition applies; do not activate it.
4. Change the selected drive to `Atlas Archive` → the confirmation and drive-specific error clear, requiring a fresh confirmation for the new target.
5. Choose **Back to files** → leave without any deletion request, preserving both drives.

### Variations

- **Keyboard:** Use the native select and labeled confirmation input; activate **Back to files** with the keyboard. There is no custom shortcut to bypass confirmation.
- **Mobile:** The deletion forms stack in one column; verify the selected name and button refer to the same drive before typing.

### Edge Cases

- Extra spaces or different case do not match; server string validation does not trim confirmation text (`apps/web/src/api/validation.ts:59–73`).
- With no active drives, the select shows **No active drives** and drive controls are disabled.
- A disabled client button is not the security boundary: the server compares the initial request’s confirmation against the owned drive name. After acceptance, cancellation is not supported.

## STORY-037: Request deletion and recover from a failed status refresh

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** deletion-audit / request receipt and error recovery  
**Persona:** Maya, retiring the disposable `Cedar Demo` drive on an unreliable connection.  
**Goal:** Submit once, distinguish acceptance from completion, and recover status without accidentally targeting another drive.  
**Preconditions:** Signed-in owner; disposable backed-up drive; no account deletion. A future local failure fixture allows the DELETE response to succeed but the following reload to fail.  
**Ideal path:** **5** — open settings, identify target, confirm, submit, recover/check the receipt.  
**Alternate paths:** Settings navigation or direct URL. Reopening settings fetches status again; it does not undo deletion.  
**Testability:** Local-synthetic-testable with response-failure control. Actual physical cleanup additionally requires the operator worker; not a browser action.  
**Sources:** DA.S1, DA.S2, DA.S4, DA.S5, DA.S8, DA.S18.

### Steps

1. Open settings and read **Delete your data** → understand that retained versions, trash, shares and upload metadata are included, not only visible files.
2. Select `Cedar Demo` → verify the intended target before entering any confirmation.
3. Type `Cedar Demo` exactly → **Permanently delete drive** becomes enabled when idle.
4. Activate **Permanently delete drive** → the button reads **Requesting deletion…** and busy-sensitive controls disable.
5. Read the successful response receipt → **Drive deletion accepted. Access is disabled.** and a request ID appear; confirmations clear and the returned job is inserted into local history.
6. Read the induced reload-failure alert → **Deletion was accepted, but status could not be refreshed. The background job continues independently.** Do not interpret it as a rejected DELETE or submit against a newly selected drive.
7. After connectivity recovers, choose **Refresh** → status reloads and the request can be correlated by ID; the accepted drive is no longer an active deletion choice. A pending job is not a proof of erasure.

### Variations

- **Initial DELETE failure instead:** A drive-specific alert appears and confirmation remains available. Refresh/check history before retrying if the response was ambiguous.
- **Keyboard/mobile:** Receipt has `role=status` and is scrolled into view; errors have `role=alert`. The implementation does not explicitly focus the receipt, so assistive-technology announcement must be checked separately.

### Edge Cases

- A mutation can commit before a subsequent audit failure returns 500. Error recovery must inspect status rather than assume nothing changed.
- Owner-scoped duplicate requests return the existing job. For drive retries the existing-job check precedes re-comparison with the original drive name; this is idempotent receipt retrieval, not a new deletion permission.
- If reload partially succeeds and then fails, lists may represent a partial refresh. An alert must remain part of the interpretation.

## STORY-038: Follow old requests through pending, retry and complete

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** deletion-audit / deletion history and background progress  
**Persona:** Lin, checking a backlog of retired build drives.  
**Goal:** Find an older request, understand delayed cleanup, and see eventual drive completion without mistaking Refresh for Retry.  
**Preconditions:** Active owner account with more than 25 deletion jobs; an older disposable drive job is pending and later encounters a controlled storage failure. A trusted local operator/fixture is available to resolve the failure and perform due maintenance.  
**Ideal path:** **5** — open history, reveal older requests, identify the job, interpret the blocker, refresh after external recovery.  
**Alternate paths:** Direct settings URL or normal navigation; no dedicated request detail page, manual Retry, cancel, or history search was found.  
**Testability:** Local-synthetic-testable with worker/failure fixtures. **Operator CLI-only segment:** maintenance, not owner UI. Production erasure is live-provider-blocked.  
**Sources:** DA.S1, DA.S5, DA.S7, DA.S10, DA.S12, DA.S16.

### Steps

1. Open **Activity & deletion** and move to **Deletion requests** → newest requests show kind, status, request ID and target ID.
2. Activate **Load older requests** → older jobs append in timestamp/ID order; continue only if the desired request is older still.
3. Find the saved request ID → a pending job displays **Purge not before** rather than **Completed**; this is an earliest eligible time, not a deadline.
4. After the controlled worker failure, select **Refresh**, then reload older pages as needed → the same job reads **Needs retry** with **Deletion cleanup is retryable.** and operator-help guidance.
5. Give the saved request ID to the operator; after the storage issue is resolved and a due maintenance pass runs, refresh and locate it again → the drive job can now show **complete** and a completed timestamp.
6. Revisit history later → the request remains a control record; do not infer that all external backups/logs or every possible late upload have permanently vanished.

### Variations

- **Pagination error:** Already-loaded requests remain available; an alert appears; retry **Load older requests** after recovery.
- **Keyboard/mobile:** Read IDs with native text selection; no copy-ID control is present. Long IDs are styled to wrap, but actual viewport layout is unverified.
- **No jobs:** **No deletion requests loaded.** is the empty label; distinguish it from failed loading.

### Edge Cases

- Refresh resets both history lists to their first pages. Finding an older ID can require pagination again.
- `blocked` is the API state; **Needs retry** is its UI label. A retained last error can persist through subsequent non-completing work, so the label does not promise the worker is permanently stalled.
- Cleanup is bounded and may need multiple passes. Refresh does not run a pass.
- Completed jobs are swept again. Late objects, incomplete cleanup, or safety-check failures can reopen a previously completed job; the status is not strictly monotonic.
- Apply this visible-completion path to drive jobs in an active account. Completed account deletion removes the owner’s ability to fetch its history; see STORY-040.

## STORY-039: Close a workspace with exact account confirmation

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** deletion-audit / account deletion safety  
**Persona:** Amara, ending a disposable agent workspace after saving required files.  
**Goal:** Intentionally end the whole workspace, understand retention boundaries, and retain a request reference.  
**Preconditions:** Owner session; disposable account; required downloads already saved; no existing account deletion; fixture has agents and API keys. This is not a plan-change exercise.  
**Ideal path:** **5** — open controls, review scope, enter exact confirmation, submit, save receipt.  
**Alternate paths:** Settings navigation/direct URL. Billing downgrade and file Trash are not equivalent alternatives.  
**Testability:** Local-synthetic-testable initiation and access guards. **Live-provider-blocked:** real Stripe closure, Clerk identity deletion and production cleanup. No agent CLI/MCP account-delete control was found.  
**Sources:** DA.S2, DA.S4, DA.S5, DA.S8, DA.S9, DA.S11, DA.S16.

### Steps

1. Open settings → **Delete your account** says it removes every drive and agent, revokes all API keys, and is **not a plan downgrade**.
2. Expand **When is data actually removed?** → review billing settlement, identity removal, retained aggregate receipts/minimal IDs/hashed tombstone, and independent provider retention.
3. Enter `delete my account` → **Permanently delete account** stays disabled.
4. Replace it with `DELETE MY ACCOUNT` → the button becomes eligible when idle.
5. Activate **Permanently delete account** → an accepted receipt supplies the account deletion request ID; it does not state that erasure has completed.
6. Save the displayed request ID and inspect **Deletion requests** → see pending status and earliest purge time; the account control changes to **Account deletion requested**, and deletion inputs are disabled.
7. While the account is still pending, select **Back to files** → new file/workspace API operations are rejected with **The account is being deleted.** Return to settings for audit/history while the session remains usable.

### Variations

- **Keyboard:** Use the labeled confirmation input and native submit button; no additional confirmation modal is implemented.
- **Mobile:** Read the entire account section rather than treating the nearby single-drive form as equivalent.
- **Synthetic identity:** The cleanup worker skips the real identity-provider deletion for matching `e2e_…` identities in development/test; that is not evidence of Clerk deletion success.

### Edge Cases

- No account-deletion undo exists. Download first; a recovery key cannot restore server ciphertext after purge.
- Failed submission shows an account-specific alert; accepted-but-status-refresh-failed follows the recovery pattern in STORY-037.
- During pending account deletion only audit/history reads and repeat account DELETE remain allowed among these console routes; the normal billing recovery UI is not available through the blanket deleting-account guard.
- The owner is not guaranteed a final **complete** screen: identity removal or the final tombstone can invalidate the session first.

## STORY-040: Recover a blocked account purge without resurrecting access

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** deletion-audit / provider blockers, retention and stale sessions  
**Persona:** Priya, the trusted operator handling Amara’s saved deletion request ID.  
**Goal:** Resolve a genuine cleanup blocker without deleting evidence, restoring account access, or claiming provider-wide erasure.  
**Preconditions:** Account deletion accepted; a controlled local fixture has ambiguous billing or pending meter delivery and an eventual provider/storage failure. Approved operator access exists in the future test environment. Another synthetic account `Harbor Research` provides a preservation control.  
**Ideal path:** **6** — correlate request, diagnose blocker, resolve dependency, run due worker, verify access remains closed, verify cleanup/preservation. These are operator-level actions, not six browser clicks.  
**Alternate paths:** The documented scheduled worker or an operator invocation of the same maintenance command processes jobs. There is no owner Retry button and no MCP purge tool found.  
**Testability:** Local-synthetic-testable with controlled billing/identity/storage adapters and operator inspection. **Operator CLI-only segments:** maintenance. **Live-provider-blocked:** real settlement, provider identity/subscription removal and external retention.  
**Sources:** DA.S5, DA.S9, DA.S11, DA.S12, DA.S16, DA.S17.

### Steps

1. Correlate the owner’s saved ID with the blocked request → the owner-facing history says **Needs retry**, not “deleted”; the exposed failure is generic rather than a raw provider error.
2. Inspect the approved operator-side billing state → distinguish ambiguous checkout reconciliation, undelivered metering, billing closure failure, identity failure or storage failure. The console does not expose a provider-specific diagnosis.
3. Resolve the actual dependency through the approved operator process → keep the deletion job and billing rows intact; do not manually erase them to produce a false success indicator. No particular provider-console UI is specified by this repository.
4. After eligibility, run `pnpm --filter @agent-drive/web deletion:maintenance` in the disposable environment → worker ordering requires settlement/delivery and billing closure before identity deletion and final data removal; incomplete/error conditions remain retryable.
5. Try a new operation using the account’s previously valid API key → it remains rejected; recovery of cleanup must not recover access.
6. After final removal, attempt the old console session’s history request → authentication is rejected by the hashed tombstone rather than provisioning a new empty workspace. Missing provider authentication may instead send navigation to sign-in.
7. Perform scoped operator acceptance inspection → the target’s object/staging prefixes and personal metadata are removed while allowed aggregate receipts, minimal job IDs and hashed identity tombstone remain; unrelated `Harbor Research` data remains. This inspection is not available from the deleted owner’s console.

### Variations

- **Identity deleted before storage failure:** The worker records identity removal and may then fail storage cleanup. The owner can already be unable to sign in while erasure is still incomplete; continue through the operator path.
- **No real provider in local fixture:** Injected adapters can exercise ordering and retry behavior, but must not be reported as live-provider acceptance.

### Edge Cases

- Direct DA.S3 links/in-flight requests cannot be recalled instantly; prefix sweeps and lifecycle controls address late bytes.
- External invoices, logs and backups follow separate retention policies; the job’s `complete` is not a claim about all third-party records.
- A worker is required: web deployment alone is not scheduled cleanup. Do not invent a completion SLA from the ten-minute minimum grace period.
- Final account history is intentionally inaccessible to the deleted identity; absence of an owner-visible completion receipt is a UX handoff gap, not proof the worker failed.

## STORY-041: Keep owner-only activity and deletion isolated

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** medium  
**Topic:** deletion-audit / permission and account boundaries  
**Persona:** Jules, validating isolation between disposable `Cedar Studio` and `Harbor Research` accounts before trusting the console.  
**Goal:** Ensure an owner sees and deletes only their own data; an agent credential cannot stand in for owner confirmation.  
**Preconditions:** Two separate synthetic owner sessions, each with distinguishable audit/jobs/drives. A disposable agent key exists without exposing its value. API-assisted negative cases are explicitly separate from ordinary UI actions.  
**Ideal path:** **6** — verify unauthenticated gate, inspect owner A, inspect owner B, check foreign target denial, check agent denial, return to an authorized path.  
**Alternate paths:** Owner pages via settings link or direct URL. API-assisted negative requests exercise the same guards, not an alternative product workflow.  
**Testability:** Local-synthetic-testable. API harness required for hidden-target and same-origin negative cases; no browser exploit or fabricated UI is assumed. Live Clerk login is outside this story.  
**Sources:** DA.S7, DA.S8, DA.S9, DA.S13, DA.S17.

### Steps

1. Visit `/console/settings` without an authenticated console session → the page redirects to `/sign-in`.
2. Open settings in the `Cedar Studio` owner session and paginate audit/jobs → only that account’s records and selectable drives are returned.
3. Open settings in the separate `Harbor Research` owner session → its own records appear; Cedar’s records are not exposed by pagination.
4. In an authorized local negative-test harness, submit Cedar’s drive ID from Harbor’s session with the correct synthetic name → ownership-scoped lookup rejects it as **Drive not found.**; knowing a name/ID does not grant authority.
5. Attempt the console deletion endpoint with only the disposable agent bearer key, without a console session → reject the request rather than accepting the key as owner authentication. The agent API surface does not provide this console deletion operation.
6. Return to Cedar’s valid same-origin owner session and refresh settings → Cedar’s drive is still available because neither negative request accepted deletion.

### Variations

- **Cross-origin mutation:** A console mutation with an Origin different from the request URL is rejected with **A same-origin request is required.** Use the documented consistent `localhost` origin for a future local test.
- **Keyboard/mobile:** The **OWNER ONLY** pill conveys scope but is not the enforcement mechanism; the server account filter/session guards are.

### Edge Cases

- A normal owner is not a global administrator; do not invent workspace-switcher, team-member or organization-admin roles here.
- Audit and deletion cursors do not confer authority: account predicates are applied on every page.
- After account deletion starts, valid session presence is not sufficient for normal operations; after final deletion, the tombstone prevents stale-session recreation.

## STORY-042: Retire one project while preserving neighboring data

**Evidence:** SOURCE-DERIVED; NOT EXECUTED.

**Type:** long  
**Topic:** deletion-audit / end-to-end retirement and preservation  
**Persona:** Maya, retiring `Atlas Sandbox` while retaining active `Atlas Production` and leaving another owner’s `Harbor Research` account untouched.  
**Goal:** Save needed plaintext locally, delete exactly one drive, verify stale access closes, and check neighboring data before and after cleanup.  
**Preconditions:** Disposable fixtures only. `Atlas Sandbox` contains `/handoff/release-notes.md`, retained older versions, trash, an uncommitted upload and an existing share. `Atlas Production` contains `/operations/checklist.md`; Harbor contains a separate known file. Saved synthetic recovery material is available but never printed in this catalog. An agent credential is scoped to both Atlas drives. Authorized operator maintenance and scoped storage/database inspection are available.  
**Ideal path:** **12** — a compact retirement flow still needs backup, explicit selection/confirmation, receipt, stale-access checks, and independent neighbor/cleanup checks. The longer concrete scenario is deliberate safety work, not an observed friction count.  
**Alternate paths:** **Load drive key** accepts typed key material or **Or choose a recovery file**; settings opens by navigation/direct URL; returning uses **Back to files** or the brand. File Trash is not an alternative to permanent drive deletion.  
**Testability:** Local-synthetic-testable as a combined scenario. **CLI/MCP-only prerequisites:** file uploads, overwrite versions and share creation are pre-provisioned outside this settings journey. **Operator CLI-only segment:** physical cleanup. Hosted/provider/storage-lifecycle acceptance remains live-provider-blocked.  
**Sources:** DA.S2, DA.S4, DA.S5, DA.S8–DA.S12, DA.S14–DA.S17.

### Steps

1. In `/console`, open **Files** and select `Atlas Sandbox` with **Selected drive** → the drive name and ID identify the target.
2. Select **Load drive key** → the dialog describes page-memory-only key handling for this drive.
3. Enter the saved synthetic drive key and select **Load key** → the key is held in page memory; successful loading alone does not yet prove it decrypts this drive.
4. Select **Download** for `/handoff/release-notes.md` → with correct fixture key/ciphertext, browser decryption starts a local download; retain the required backup before destructive action.
5. Switch to `Atlas Production` → its independent file listing remains available.
6. Load its own recovery key through **Load drive key**, then download `/operations/checklist.md` → establish a meaningful preservation baseline, not merely that a drive name exists.
7. Open **Activity & deletion** → settings appears; leaving Files does not preserve its page-memory keys for later use.
8. Expand **When is data actually removed?** → review the grace period, worker dependency, possible residual signed-link validity and retained control records.
9. Under **Delete one drive**, select `Atlas Sandbox` → verify that Production is not selected.
10. Type `Atlas Sandbox` exactly → **Permanently delete drive** becomes eligible.
11. Activate **Permanently delete drive** → receive accepted/pending semantics and a request ID; save that ID.
12. In the future API/CLI harness, attempt a fresh list/read of Sandbox using the existing two-drive agent credential → its removed drive scope prevents access; separately request the existing public share anew → no fresh share download is authorized.
13. Select **Back to files** → Sandbox is absent from the active choices while `Atlas Production` remains selectable.
14. Select Production, load its recovery material again and download the checklist → neighboring encrypted content remains usable after deletion acceptance, not just visible in metadata.
15. In Harbor’s separate owner session, read/download its known fixture using Harbor’s own recovery material → cross-account data remains available; do not share sessions or keys across fixtures.
16. After the scheduled grace eligibility and sufficient authorized local maintenance passes, return to Maya’s settings and **Refresh** → locate the saved drive request, paginating if necessary; expect **complete** only when cleanup has finished. A blocker follows STORY-038, not a fabricated retry button.
17. Have the operator inspect the exact Sandbox object/staging prefixes and associated metadata, then repeat the Production/Harbor preservation checks → expected acceptance includes removal of old versions, delete markers, trash/upload metadata for the target, while same-account and other-account neighbors survive. Browser disappearance alone is insufficient evidence of physical cleanup.

### Variations

- **Recovery-file path:** Substitute the real **Or choose a recovery file** control for typing synthetic key material; the same correct-drive decryption check is still needed.
- **Mobile/keyboard:** Use native labeled selects/forms and explicit target review. Large audit tables may require horizontal scrolling; no mobile-only deletion action is assumed.
- **Keep the data instead:** Before submission, leave via **Back to files**. After acceptance there is no restore-drive action.

### Edge Cases

- An already-issued object URL may work until its own expiry; inability to mint a new application download is a distinct requirement from instant revocation of every old URL.
- Drive deletion removes its ID from key scopes, not the entire multi-drive key; a neighboring authorized drive should remain usable.
- The UI does not enumerate every retained version/object being purged. Verify storage versions/delete markers and metadata with operator acceptance, not screenshots or row counts inferred from code.
- Late uploads after an apparent completion are handled by later sweeps; a newly reopened cleanup job should not permit new application access.
- Wrong target ownership or a live/recreated target fails worker safety checks rather than broadening the purge prefix. Existing test definitions exercise this; they were not run here.

---

## Redundancy candidates

These are **source-supported review candidates**, not measured friction or recommendations to delete controls. Keep safety-critical repetition and differences in permission, custody, destructive scope, and recovery. Shared backend functions do not make two user goals identical.

### Duplicate paths and entry points

| Candidate                                                                                                                | Stories / evidence                                               | Consolidation or critique boundary                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Signup: landing **Create your workspace**, pricing **Start with Free**, direct signup, Clerk signin→signup configuration | STORY-001–STORY-005, STORY-009; ONB.S1–ONB.S6                    | One canonical enrollment flow plus entry-context alternatives. Provider UI itself is unobserved.                                |
| Signin: landing/pricing links, **Open console** guard, direct signin, signup configuration                               | STORY-001, STORY-003–STORY-005                                   | Navigation convergence is not an additional authentication capability.                                                          |
| Create drive: header, first-drive empty state, API-key prerequisites, management CLI                                     | STORY-007, STORY-009; FK.C3, FK.C9, FK.L1                        | Browser entries share a form; CLI local-config custody differs from browser recovery receipt.                                   |
| Agent/key creation: tab headers, empty states and prerequisite prompts                                                   | STORY-009, STORY-013; FK.C6, FK.C9                               | Keep missing-prerequisite guidance; do not invent a multistep setup wizard.                                                     |
| **Connect an agent** versus **API keys** tab                                                                             | STORY-009; FK.C4, FK.C9                                          | Same tab destination; assess expectation created by the “connect” language.                                                     |
| Billing sidebar, Usage **EGRESS & COST**, public **Manage your plan**, direct route                                      | STORY-002, STORY-015, STORY-027, STORY-029                       | Same destination with different context; a navigation assertion can be reused.                                                  |
| Settings **Activity & deletion** versus direct URL; brand versus **Back to files**                                       | STORY-035–STORY-042; DA.S1–DA.S3                                 | Same destination does not establish unnecessary visual duplication without rendered review.                                     |
| Invalid-fragment, wrong-key, expiry, revoke and unavailable errors share sender-recontact guidance                       | STORY-021–STORY-025; SHARE.S6–SHARE.S9                           | Deduplicate generic navigation, not failure timing or reversibility. A new link does not repair every network/provider failure. |
| Atomic versus composed journeys                                                                                          | STORY-009, STORY-017, STORY-026, STORY-027, STORY-040, STORY-042 | Long journeys exercise continuity and safety boundaries. Count them once as stories, not as extra independent feature coverage. |

### Duplicate or related information

| Information                                               | Surfaces / stories                                                                                                    | Preserve or clarify                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Encryption, visible metadata and unrecoverable keys       | Landing, pricing, console sidebar/topbar, create/receipt/unlock dialogs, file footer, quickstart; STORY-001–STORY-009 | Safety-critical repetition; audit consistency rather than remove it.                                                                        |
| Account/workspace language                                | Public “workspace” CTA and automatic Personal workspace; STORY-004, STORY-009                                         | Clarify account creation versus team/org setup; no team invitation feature is implied.                                                      |
| Drive names and IDs                                       | Selector, recovery JSON, allowed-drive grants, token list, CLI/MCP; STORY-007–STORY-016                               | IDs support identity checks; names alone cannot select a key or scope safely.                                                               |
| Agent/actor names and activity                            | Agents, API keys, Files, versions, Usage, billing, CSV and audit                                                      | Human console / Console / `__console__` naming merits consistency review; user-created agent identities remain distinct.                    |
| Encrypted sizes and retention                             | Current file rows, version history, Usage, billing; STORY-011–STORY-015, STORY-027                                    | Current-file bytes, all retained bytes and period high-water quantities are different measures, not duplicate totals.                       |
| Prices and allowances                                     | Public pricing and account billing; STORY-002, STORY-027–STORY-031                                                    | Public recommended highlighting is static; account Current plan is stateful. Neither proves provider readiness.                             |
| Usage and budget controls                                 | Monthly-review journey and focused settings validation; STORY-027, STORY-028                                          | Keep workflow composition and focused blank/zero/error handling; reuse unchanged input assertions.                                          |
| Export period next to current usage                       | STORY-027; BILL.B2–BILL.B4                                                                                            | Selection affects CSV only, not the current-month on-screen table; clarify scope before assuming historical views.                          |
| Deletion acceptance notice, request row and audit success | STORY-035, STORY-037, STORY-038, STORY-042                                                                            | Acceptance, request status and physical cleanup are separate facts. Repeated ID context aids correlation; never merge success into erasure. |
| Settings Refresh versus independently paginated histories | STORY-035, STORY-038                                                                                                  | One Refresh resets both histories. Assess lost-scroll/history context in rendered review; no measured burden exists yet.                    |

### Overlapping tools with meaningful differences

- **Browser / CLI / MCP get:** all aim to decrypt locally, but browser download, CLI output overwrite/inline rules and MCP exclusive-create/output-size rules differ (STORY-008, STORY-009, STORY-016). A shared crypto implementation does not prove every delivery surface.
- **Manual key / recovery JSON / CLI raw key file:** one recovery goal, distinct validation and formats. JSON binds a selected drive ID; raw text validates syntax. Console JSON is not the raw CLI `--key-file` format (STORY-008, STORY-009).
- **Loaded-row browser filter / CLI-MCP server-side metadata search:** filter reach differs; no plaintext-content search is implied (STORY-010). Prefix/attribution search merits its own future scenario.
- **Versions / Trash Restore / CLI-MCP restore / version-specific get:** restore changes current state and may consume storage; get inspects without promoting a version (STORY-011, STORY-012, STORY-017).
- **Individual-key revoke / agent-wide revoke-all:** similar API authorization goal with different blast radius. Replacement-first safety is not interchangeable with incident-wide shutdown (STORY-013, STORY-014).
- **API-token rotation / drive-key Forget/Load:** authorization versus decryption; token replacement cannot recover lost ciphertext keys (STORY-008, STORY-013).
- **CLI share / MCP share / SDK createShare:** one creation backend, different expiry syntax/input schema and error wrapping. CLI listing/revocation has no reviewed MCP parity; no browser share manager exists (STORY-018, STORY-019, STORY-023, STORY-024).
- **Expiry / revocation / source trash / permanent deletion:** all can deny a recipient, but expiration requires replacement, revocation stops new authorizations, trash can be restored, and permanent deletion starts asynchronous cleanup (STORY-023–STORY-026, STORY-037, STORY-042).
- **In-app plan changes / provider portal:** related subscription work, but the portal handles provider-owned billing details/cancellation rather than duplicating all in-app plan logic (STORY-030–STORY-032).
- **Trash / permanent drive deletion / account deletion:** retention, reversibility and provider scope differ. Never recommend permanent deletion as automatic billing/quota remediation (STORY-012, STORY-033, STORY-037–STORY-042).
- **Individual put / upload-only sync:** adjacent write tools, not equivalent workflows or a bidirectional mirror. The latter's conflict manifest is an uncovered journey, not silently counted under STORY-017.

## Gaps and recommendations

Priority here reflects risk and missing evidence, not a measured incident count. No item is a rendered or runtime defect established by this task.

### 1. Acceptance evidence still missing

- **Real Clerk flows:** enabled login methods, verification, MFA, duplicate-account handling, password reset, session expiry/logout menus and identity deletion. Provider component configuration does not prove any of these work. Requirements mentioning GitHub/email are not evidence those methods are enabled. Synthetic auth is not real-human isolation acceptance (STORY-003–STORY-005, STORY-034, STORY-039–STORY-041; ONB.S4–ONB.S8, ONB.S17, DA.S5–DA.S9).
- **Payments and invoices:** actual checkout, resume, paid-tier proration/settlement, webhook timing, provider portal details, cancellation timing and deletion-related provider closure. Source plan constants and flags do not establish live offers or connectivity (STORY-029–STORY-032, STORY-040; BILL.P1–BILL.P3, BILL.A1–BILL.A2, BILL.S1–BILL.S3).
- **Storage, egress and alerts:** production object transfer/CORS/TLS, log completeness/lag, duplicate/reconciled accounting, scheduled processing and actual email delivery remain unverified. Authorized bytes are not observed billed bytes, missing monitoring is not zero usage, and queued mail is not delivered mail (STORY-020, STORY-025, STORY-027–STORY-028, STORY-033, STORY-038–STORY-040).
- **Hosted share privacy and release:** fragment-key/anonymous/no-store/no-referrer/noindex/redirect-rejection source is encouraging, but no deployed request capture, script audit, browser download or release acceptance occurred. No logged-out user success, secret-fragment secrecy or production leak claim follows from source alone (STORY-020–STORY-022; SHARE.S6–SHARE.S11).
- **Accessibility/mobile:** future rendered checks need focus trapping/return, tab order, screen-reader announcements, visibility, touch targets, 390px layouts, horizontal-scroll discoverability, native chooser and download behavior. Semantics/CSS are not a pass. Account and secret one-time receipts require especially careful secure capture (variations throughout).

**Recommendation:** later run separately approved public/local synthetic stories first with deterministic disposable fixtures, then provider-backed stories in authorized test environments. Record actual observed results separately from this catalog; do not relabel an existing test definition as executed evidence.

### 2. Safety and recovery limitations to explain or evaluate

- **One-time recovery/token receipts:** acknowledgments and unload guards cannot prove safe storage; the server cannot recover a drive key. Empty-drive key rehearsal validates format only, and “Key loaded” can precede cryptographic failure. Preserve the download-verification notice (STORY-007–STORY-009, STORY-013; ONB.S11–ONB.S15, FK.C3, FK.C8–FK.C9).
- **Recovery input state/interoperability:** recovery JSON's format marker is not enforced; rejected file input does not explicitly clear prior text. Console JSON and raw CLI key-file formats differ. Assess clear guidance instead of assuming a reset/import compatibility guarantee (STORY-008, STORY-009; FK.C8, FK.L4, ONB.S13).
- **First value continuity:** “Create your workspace” provisions an account/Personal workspace; “Connect an agent” changes a tab. No explicit workspace naming or full setup wizard exists. Keep the concrete credential + CLI handoff visible; do not make an absent browser upload/share control the acceptance target (STORY-004, STORY-009).
- **Console navigation/filter scope:** tabs live in component state, not dedicated `/console/files` or other tab URLs. Loaded-file filtering can miss later-page matches and filtered-zero feedback lacks a specific no-match message. Browser Back/deep links and plaintext search are not promised (STORY-010; FK.C1–FK.C4).
- **Old-version inspection:** browser history offers restore, not preview/download of old bytes; version-specific CLI/MCP get is the nonmutating alternative. Restore adds a retained version and may hit quota/cap; trash does not reclaim bytes (STORY-011–STORY-012, STORY-015, STORY-033).
- **Share operation recovery:** no browser share manager, viewer Retry/Request access/Renew controls, inline preview or pinned-version identifier. Two same-basename revisions can look identical before download. CLI revoke lacks interactive confirmation; validate ID/path/version first (STORY-018–STORY-026; SHARE.S1–SHARE.S9).
- **Share transfer UX:** “Decrypting…” spans authorization, transfer and local decryption; no percentage/cancel/explicit completed state was found. ArrayBuffer/Blob buffering may constrain large files, but no practical limit was measured. Revocation cannot recall saved plaintext or instantly invalidate an already issued storage URL (STORY-020, STORY-022, STORY-024).
- **Billing semantics and persistence:** blank versus zero cap removal is consequential, not an invoice ceiling; no extra confirmation is implemented. Per-agent CSV is usage attribution, not allocated dollar charges. Historical export selection does not change the current table. Checkout-return query parameters have no dedicated success/cancel banner; provider sync timing is untested (STORY-027–STORY-034).
- **Malformed billing configuration:** the supplied pricing escape warning is not supported: parsing failures set published rates to null and short-circuit checkout availability evaluation. Other malformed-config combinations still deserve controlled future checks; do not present them as established outages (STORY-002, STORY-029; BILL.P1–BILL.P3).

### 3. Deletion-specific operational and privacy boundaries

- **No final owner receipt after account teardown:** identity can be removed before storage work is complete, and tombstoning prevents later owner history access. No post-deletion owner-status endpoint or completion notification was found. Preserve request IDs before acceptance and use an operator handoff; do not promise a final signed-in success screen (STORY-039–STORY-040; DA.S3–DA.S9).
- **Pending deletion cannot be fixed through ordinary owner billing:** the server denies normal console routes, including billing, once account deletion is accepted. Provider/reconciliation problems need operator assistance, not invented owner Retry/Pay controls (STORY-039–STORY-040).
- **Page-derived accountDeleting edge:** the client infers deleting state from loaded jobs, initially the newest 25. If the account job is outside that slice, it may try loading drives first; server guards still reject unsafe access. Exercise this controlled scenario before calling it a user-visible defect (STORY-038–STORY-039; DA.S3, DA.S5–DA.S6).
- **No time guarantee:** `notBefore` is at least ten minutes and may extend to unfinished upload expiry; scheduling, bounded batches, providers and retries determine actual completion. Previously completed work can reopen on new cleanup evidence. No production erasure SLA is derived (STORY-038–STORY-040; DA.S7–DA.S9).
- **Retention scope:** purging application metadata/object prefixes does not prove erasure of every invoice, provider record, backup or access log. Aggregate billing receipts, opaque control IDs and hashed tombstones intentionally remain; they are not a restored account (STORY-040).
- **Audit is metadata, not a complete narrative:** no plaintext contents, file paths or credentials are supplied as an audit narrative; anonymous failed requests may not be attributable to an account. Action rows/HTTP 202 are not per-object erasure proof. No audit export/filter/search, owner retry/cancel/undo, request-detail route or support-contact button was found (STORY-035–STORY-042).
- **Permission negatives need API assistance:** wrong origins, malformed cursors, foreign IDs, absent sessions and bearer-only owner actions are not ordinary UI controls. Keep fixtures isolated and authorized, and preserve neighbor accounts/drives. Existing integration definitions are not outcomes (STORY-041–STORY-042; DA.S5–DA.S6, DA.S15–DA.S18).

### 4. Intentionally unexpanded or unavailable functionality

- Adjacent implemented package journeys without complete standalone stories here: move/copy, upload-only sync/conflict manifests, recent-activity/metadata attribution search, management-only CLI provisioning and exhaustive API/SDK variants. They remain explicit gaps, not additional inferred coverage (FK.L1–FK.L4, FK.M3, FK.D2).
- Provider-owned screens and non-enabled configuration permutations require future provider-specific catalogs after evidence exists. No team invitations, organization switching, finance role, Enterprise purchase UI, drive quota editor, pending-reservation browser inspector, reconciliation console, per-agent dollar allocation or proration preview was found in the reviewed surfaces.
- Folder sharing with another agent identity is “Later,” not an alternate supported share path. No browser editor/upload/drag-and-drop/share creation, content search, recovery reset or machine self-payment is invented.
- Public quickstart links target GitHub `main`, whereas this catalog pins a revision. Current quickstart requires the private workspace package to be built; older requirements' npm/npx-style wording is not an installed public-release guarantee (ONB.S2, ONB.S16–ONB.S17, FK.D1–FK.D3).

**Completion boundary:** all five supplied catalogs have been consolidated into the 42 full stories above, with three deduplicated pairs and retained concrete variations/edge cases. This is a planning artifact for later authorized UX walking and critique, not a test report, deployment approval or proof of hosted readiness.

## Source reference index

All code references refer to the exact reviewed revision. Namespaced references preserve the supplied evidence without collisions. Documentation and existing test definitions describe intent/contracts, not completed execution.

### ONB — Onboarding, recovery and first agent

All links below pin the exact requested revision. Story citations use these identifiers plus narrower line ranges where useful.

| ID      | File and lines                                                                                                                                                                                                                                                                                                                                                              | Relevant evidence                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ONB.S1  | [apps/web/app/(app)/page.tsx:5–70](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/page.tsx#L5-L70)                                                                                                                                                                                                     | Landing copy; Pricing, Sign in, Create your workspace, Open console; CLI illustration.                                                         |
| ONB.S2  | [apps/web/app/(app)/pricing/page.tsx:14–164](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/pricing/page.tsx#L14-L164)                                                                                                                                                                                 | Configuration warnings, plan cards, signup/billing links, Quickstart, privacy/retention explanations.                                          |
| ONB.S3  | [apps/web/src/billing/policy.ts:3–48](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/policy.ts#L3-L48)                                                                                                                                                                                                   | Shared plan constants and configuration-dependent overage rates.                                                                               |
| ONB.S4  | [apps/web/app/(app)/sign-in/[[...sign-in]]/page.tsx:5–26](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/sign-in/%5B%5B...sign-in%5D%5D/page.tsx#L5-L26)                                                                                                                                               | Clerk SignIn wrapper, signup URL, console fallback, unconfigured notice.                                                                       |
| ONB.S5  | [apps/web/app/(app)/sign-up/[[...sign-up]]/page.tsx:5–26](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/sign-up/%5B%5B...sign-up%5D%5D/page.tsx#L5-L26)                                                                                                                                               | Clerk SignUp wrapper, signin URL, console fallback, unconfigured notice.                                                                       |
| ONB.S6  | [apps/web/app/(app)/layout.tsx:5–16](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/layout.tsx#L5-L16), [apps/web/app/(app)/console/page.tsx:7–10](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/page.tsx#L7-L10)        | Authentication provider setup, fallback destinations, unauthenticated console redirect, user-keyed console component.                          |
| ONB.S7  | [apps/web/src/console/auth.ts:6–81](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/console/auth.ts#L6-L81)                                                                                                                                                                                                       | Development-only synthetic authentication, expiry, fail-closed behavior, real Clerk session lookup.                                            |
| ONB.S8  | [apps/web/src/api/handler.ts:119–181](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L119-L181), [same file:1744–1759](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1744-L1759)                                      | Session-required API; account keyed by external user; Personal workspace and internal console identity provisioning; account-scoped drive IDs. |
| ONB.S9  | [apps/web/app/(app)/console/console.tsx:71–288](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L71-L288)                                                                                                                                                                           | API/session errors, native dialog, initial state, refresh, unload warning, drive creation and duplicate-name recovery.                         |
| ONB.S10 | [apps/web/app/(app)/console/console.tsx:290–357](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L290-L357)                                                                                                                                                                         | Browser download/decryption; recovery file size, JSON and drive-ID checks; alert role.                                                         |
| ONB.S11 | [apps/web/app/(app)/console/console.tsx:359–560](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L359-L560)                                                                                                                                                                         | Personal workspace, tabs, Refresh, first-drive prompt, loading/error states, selected drive, key state and Forget key.                         |
| ONB.S12 | [apps/web/app/(app)/console/console.tsx:666–716](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L666-L716), [same file:850–867](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L850-L867) | Ready for your first file; Connect an agent switches to API keys; CLI/MCP guidance; API key/drive key distinction.                             |
| ONB.S13 | [apps/web/app/(app)/console/console.tsx:960–1096](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L960-L1096)                                                                                                                                                                       | Create drive form; nondismissable key receipt; JSON recovery download; secure-save acknowledgment; manual/file-based key loading.              |
| ONB.S14 | [packages/agent-drive/src/crypto.ts:29–62](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/crypto.ts#L29-L62)                                                                                                                                                                                         | Drive-key format validation, client generation, wrong-key/decryption error.                                                                    |
| ONB.S15 | [docs/quickstart.md:3–67](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/quickstart.md#L3-L67)                                                                                                                                                                                                                           | Secure backup, scoped credentials, unpublished CLI, MCP setup, in-memory keys, local origin and hosted acceptance limitations.                 |
| ONB.S16 | [apps/web/app/globals.css:1029–1159](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/globals.css#L1029-L1159), [pricing/pricing.css:47–56](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/pricing/pricing.css#L47-L56)                       | Narrow-screen console/navigation/landing changes; pricing detail and header reflow.                                                            |
| ONB.S17 | [docs/user-stories.md:39–54,67–99](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/user-stories.md#L39-L99), [README.md:32–67](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L32-L67)                                                                            | Intended setup/key safety; documented CLI drive creation; requirements are not runtime evidence.                                               |

### FK — Files, keys, agents and integrations

All links are pinned to the reviewed revision. References such as **FK.C4** below resolve to exact file/line spans.

| Ref   | Source and relevant behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FK.C1 | [apps/web/app/(app)/console/console.tsx:59–99](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L59-L99): tab/scope names, API errors, 401 redirect, automatic collection pagination.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FK.C2 | [console.tsx:122–238](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L122-L238): native dialog, Escape handling, page-memory keys, account refresh, 100-item file pages, one-time-receipt unload warning.                                                                                                                                                                                                                                                                                                                                                                                                                |
| FK.C3 | [console.tsx:240–351](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L240-L351): error/busy handling, drive creation, decrypted download, version listing/restore, recovery JSON checks.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FK.C4 | [console.tsx:370–559](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L370-L559): navigation, Refresh, creation entry points, onboarding, selected drive, load/forget key.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FK.C5 | [console.tsx:562–717](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L562-L717): loaded-file filter, Download/Trash/Restore/Versions, confirmation, empty states, Load more files, metadata disclosure.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FK.C6 | [console.tsx:727–868](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L727-L868): agent identities/revoke-all, key lists/revoke-one, prerequisite prompts, connection guide, rotation guidance.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FK.C7 | [console.tsx:871–950](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L871-L950): encrypted storage, operations, drive usage, author usage, billing link.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FK.C8 | [console.tsx:960–1097](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L960-L1097): drive/recovery/unlock forms, receipt acknowledgement, plaintext-secret warning, key validation deferred to download.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FK.C9 | [console.tsx:1098–1251](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L1098-L1251): agent creation, reserved name, scoped-key form, one-time token receipt, version restore.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FK.L1 | [packages/agent-drive/src/cli.ts:109–211](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L109-L211): login/whoami, agent/drive/key creation, revocation, list/versions/recent/search.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FK.L2 | [cli.ts:233–301](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L233-L301): put/get, version guards, output files, move/copy/delete/restore.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FK.L3 | [packages/agent-drive/src/config.ts:123–149](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/config.ts#L123-L149): per-drive environment names, connection resolution, key precedence, raw-text key-file loading.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FK.L4 | [packages/agent-drive/src/client.ts:411–452](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/client.ts#L411-L452): encrypt-before-upload, create-only/conditional writes, download and authenticated decryption.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FK.M1 | [packages/agent-drive/src/mcp.ts:9–121](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L9-L121): untrusted-data wrapper, structured errors, output limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FK.M2 | [mcp.ts:124–233](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L124-L233): whoami, encrypted put/get, exclusive output-file creation, paginated list/filter schemas.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FK.M3 | [mcp.ts:265–372](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L265-L372): delete, versions, restore, search, recent, share, stdio startup and captured credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FK.A1 | [apps/web/src/console/auth.ts:6–81](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/console/auth.ts#L6-L81) and [console/page.tsx:7–10](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/page.tsx#L7-L10): development-only synthetic sessions, Clerk branch, sign-in redirect, console keyed by user.                                                                                                                                                                                                                                                                       |
| FK.A2 | [apps/web/src/api/handler.ts:100–194](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L100-L194): revoked-token rejection, per-human account, console permissions, separate scope/drive checks.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| FK.A3 | [handler.ts:513–567](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L513-L567): account-owned key issuance, nonempty scopes, one-time token and revoke-one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| FK.A4 | [handler.ts:830–940](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L830-L940): usage aggregation and account-scoped agent-wide key revocation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| FK.A5 | [handler.ts:942–974](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L942-L974), [1434–1454](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1434-L1454), [1552–1565](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1552-L1565), [1590–1641](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1590-L1641): trash/history reads, delete scope, restore read+write scopes, retained-version storage budget. |
| FK.X1 | [packages/agent-drive/src/crypto.ts:29–62](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/crypto.ts#L29-L62): key syntax, generation, wrong-key/damaged-file error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FK.R1 | [apps/web/app/globals.css:658–661](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/globals.css#L658-L661) and [1029–1124](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/globals.css#L1029-L1124): horizontally scrolling tables, mobile horizontal navigation, 620px table minimum, wrapping entity rows.                                                                                                                                                                                                                                                                                   |
| FK.D1 | [docs/quickstart.md:3–67](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/quickstart.md#FK.L3-L67): privacy, private workspace CLI, secure inputs, MCP configuration, local-origin convention, provider boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FK.D2 | [docs/cli.md:3–38](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/cli.md#FK.L3-L38): protected config, precedence, overwrite semantics, idempotent drive creation, upload-only sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FK.D3 | [README.md:55–107](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L55-L107), [198–225](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L198-L225): host configuration/restart, local-test evidence boundaries, one-time recovery security.                                                                                                                                                                                                                                                                                                                                                         |

### SHARE — Encrypted sharing

All links below are pinned to the exact requested revision.

| Ref       | Source and relevant lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What it establishes                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SHARE.S1  | [CLI: expiry parsing, lines 89–106](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L89-L106); [share commands, 213–231](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L213-L231); [help/errors, 330–364](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L330-L364) | Exact commands, durations, JSON output/error behavior.                                                                          |
| SHARE.S2  | [Client sharing, 364–408](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/client.ts#L364-L408)                                                                                                                                                                                                                                                                                                                                          | Metadata preflight; local key unwrap before creation; version pinning; fragment URL construction; list/revoke methods.          |
| SHARE.S3  | [MCP share, 335–355](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L335-L355); [errors, 40–68](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L40-L68); [key resolution, 359–372](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/mcp.ts#L359-L372)                        | Tool name/schema, structured errors, configured per-drive/global/saved keys.                                                    |
| SHARE.S4  | [API create/list/revoke, 981–1126](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L981-L1126)                                                                                                                                                                                                                                                                                                                                       | Required scopes, default/range of expiry, existing-file/version constraints, list status and pagination, idempotent revocation. |
| SHARE.S5  | [Public share handler, 1838–1904](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1838-L1904)                                                                                                                                                                                                                                                                                                                                       | Error precedence, basename/size/expiry metadata, fresh download authorization, operation reservation, presigned URL lifetime.   |
| SHARE.S6  | [Share viewer, 19–127](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/s/%5Bid%5D/share-client.tsx#L19-L127); [rendered labels/controls, 129–189](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/s/%5Bid%5D/share-client.tsx#L129-L189)                                                                                                                                                  | Error copy, fragment updates, anonymous fetch, local decrypt/download, disabled busy button, live region, home link.            |
| SHARE.S7  | [Fragment parser, 1–13](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/share/fragment.ts#L1-L13); [download URL validation, 1–13](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/share/url.ts#L1-L13)                                                                                                                                                                                   | Canonical 43-character base64url key validation; secure URL checks.                                                             |
| SHARE.S8  | [Permissions, 185–190](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L185-L190); [account/drive guard, 350–364](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L350-L364); [read preflight, 1385–1405](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1385-L1405)             | Scopes, explicit drive grants, account isolation, read authorization.                                                           |
| SHARE.S9  | [README sharing, 227–253](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L227-L253); [quickstart, 8–43](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/quickstart.md#L8-L43)                                                                                                                                                                                                                       | Setup boundary, unpublished CLI package, bearer-secret warning, revocation limits, production TLS.                              |
| SHARE.S10 | [Share CSS, 12–79](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/globals.css#L12-L79); [proxy, 18–35](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/proxy.ts#L18-L35); [headers, 5–19](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/next.config.ts#L5-L19)                                                                       | Mobile CSS intent, anonymous route bypass, TLS gate, no-referrer/no-store/noindex headers.                                      |
| SHARE.S11 | [CLI upload/download, 233–271](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L233-L271); [delete/restore, 290–301](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L290-L301); [CLI docs, 9–26](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/cli.md#L9-L26)                                  | Conditional replacement and file-operation seams; key precedence.                                                               |
| SHARE.S12 | [Crypto errors, 29–62](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/crypto.ts#L29-L62); [sharing requirements, 147–156](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/user-stories.md#L147-L156); [existing sharing test source, 100–151](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/tests/e2e/sharing.spec.ts#L100-L151)      | Missing/invalid/wrong key distinctions; folder sharing explicitly later; existing scenario scaffolding, not run evidence.       |

### BILL — Billing and limits

All relative paths and line numbers refer to the [exact revision](https://github.com/dennisonbertram/agent-drive/tree/75fad60116971cb9ea4be17cd8de18d3ce9a706a). References in each story identify the supporting source, not executed evidence.

| Ref     | Source                                                                                                                                                                                                                                                                                                                                                                                                                                  | Relevant behavior                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| BILL.P1 | [apps/web/app/(app)/page.tsx:10–16](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/page.tsx#L10); [apps/web/app/(app)/pricing/page.tsx:22–81](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/pricing/page.tsx#L22)                                                                            | Home **Pricing** link; public plan cards; **Start with Free**, **Manage your plan**, **Sign in**; availability warning                 |
| BILL.P2 | [apps/web/app/(app)/pricing/page.tsx:83–130](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/pricing/page.tsx#L83)                                                                                                                                                                                                                                                  | Account-wide limits, retained versions/trash, maximum encrypted file size, high-water overages, configured rates, download/cap caveats |
| BILL.P3 | [apps/web/src/billing/policy.ts:3–26,36–79,103–107](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/policy.ts#L3)                                                                                                                                                                                                                                                     | Plan constants, configurable rates, quotation, UTC months, payment_required with upgrade URL                                           |
| BILL.B1 | [apps/web/app/(app)/console/billing/page.tsx:9–20](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/page.tsx#L9); [apps/web/app/(app)/console/billing/billing-client.tsx:94–109,154–200](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing-client.tsx#L94) | Sign-in gate, loading billing/history, authenticated requests, settings save                                                           |
| BILL.B2 | [apps/web/app/(app)/console/billing/billing-client.tsx:202–291](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing-client.tsx#L202)                                                                                                                                                                                                            | Paid-tier confirmation, trusted Stripe URL handoff, errors and **Refresh**, **Back to workspace**, **Invoices & payment details**      |
| BILL.B3 | [apps/web/app/(app)/console/billing/billing-client.tsx:292–406](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing-client.tsx#L292)                                                                                                                                                                                                            | Status/loading text, estimate/storage/download cards, plan status/buttons, configuration warning and rate card                         |
| BILL.B4 | [apps/web/app/(app)/console/billing/billing-client.tsx:76–83,408–466](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing-client.tsx#L76)                                                                                                                                                                                                       | Amount validation, spending-control labels, queued-email warning                                                                       |
| BILL.B5 | [apps/web/app/(app)/console/billing/billing-client.tsx:112–151,244–245,468–535](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing-client.tsx#L112)                                                                                                                                                                                            | CSV creation/sanitization, export period, current usage table, attribution caveats                                                     |
| BILL.U1 | [apps/web/app/(app)/console/console.tsx:372–392,871–949](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L372)                                                                                                                                                                                                                                  | Usage tab; sidebar and Usage-card billing links; storage by drive; usage by author                                                     |
| BILL.A1 | [apps/web/src/api/handler.ts:746–822](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L746)                                                                                                                                                                                                                                                                    | Account-scoped billing/settings, amount/email validation, checkout/portal, persisted statements                                        |
| BILL.A2 | [apps/web/src/api/handler.ts:1698–1741,1753–1792](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1698)                                                                                                                                                                                                                                                       | Console route/session requirement, same-origin mutations, account-deletion conflict                                                    |
| BILL.L1 | [apps/web/src/billing/ledger.ts:198–252,263–297](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/ledger.ts#L198)                                                                                                                                                                                                                                                      | Account allowances, pending upload capacity, subscription write gate, spending cap, download and operation quotas                      |
| BILL.L2 | [apps/web/src/billing/ledger.ts:387–466](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/ledger.ts#L387)                                                                                                                                                                                                                                                              | Alert queueing, account-scoped per-agent summary, statement persistence                                                                |
| BILL.Q1 | [apps/web/src/api/handler.ts:1154–1173,1293–1298,1632–1637](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1154)                                                                                                                                                                                                                                             | Explicit per-drive quota checks, including upload/restore paths                                                                        |
| BILL.S1 | [apps/web/src/billing/providers.ts:14–45,139–193,198–258](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/providers.ts#L14)                                                                                                                                                                                                                                           | Configuration flags, provider-price validation, checkout reservation/recovery, subscription-state branching                            |
| BILL.S2 | [apps/web/src/billing/providers.ts:278–365,367–452](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/providers.ts#L278)                                                                                                                                                                                                                                                | Paid-tier update/proration, payment error, checkout reuse/recovery, success/cancel return URLs                                         |
| BILL.S3 | [apps/web/src/billing/providers.ts:454–465,512–680](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/billing/providers.ts#L454)                                                                                                                                                                                                                                                | Customer-backed portal and return URL; verified webhook/subscription update logic                                                      |
| BILL.C1 | [packages/agent-drive/src/cli.ts:317–363](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/packages/agent-drive/src/cli.ts#L317)                                                                                                                                                                                                                                                            | Actual CLI commands and error output including **Upgrade:** URL                                                                        |
| BILL.R1 | [apps/web/app/(app)/console/billing/billing.css:221–270](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/billing/billing.css#L221); [apps/web/app/(app)/pricing/pricing.css:47–56](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/pricing/pricing.css#L47)                             | Responsive rules; not rendered evidence                                                                                                |
| BILL.D1 | [README.md:255–309](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L255)                                                                                                                                                                                                                                                                                                        | CLI/MCP uploads, quotas, retained versions, metering caveats, portal role, proposal-price caveat                                       |
| BILL.D2 | [README.md:311–316](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/README.md#L311); [apps/web/src/console/auth.ts:19–27,71–81](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/console/auth.ts#L19)                                                                                                                             | Development-only synthetic authentication; no proof of live Clerk signup                                                               |
| BILL.D3 | [docs/user-stories.md:176–202](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/user-stories.md#L176); [docs/quickstart.md:54–55](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/quickstart.md#L54)                                                                                                                                 | Billing requirements/proposal pricing and console/public pricing scope                                                                 |

### Source-defined plan defaults, not verified live offers

| Plan      | Monthly base | Drives | Retained ciphertext | Monthly download allowance | Monthly API operations |
| --------- | -----------: | -----: | ------------------: | -------------------------: | ---------------------: |
| free      |           $0 |      3 |               5 GiB |                      5 GiB |              1,000,000 |
| developer |          $20 |     25 |             100 GiB |                    100 GiB |             10,000,000 |
| team      |         $200 |    250 |           1,024 GiB |                  1,024 GiB |            100,000,000 |

These are constants rendered by the app (BILL.P3), not observed subscriptions or invoices. README calls the paid amounts proposal defaults (BILL.D1). Older proposal prose uses GB/TB; executable policy uses GiB. No Enterprise checkout option was found; billing says to contact the workspace operator.

### DA — Activity and deletion

All links below are pinned to the reviewed revision. References such as **[DA.S1]** in stories refer to these file:line ranges.

| Ref    | Source and relevance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DA.S1  | [settings-client.tsx:30–159](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings-client.tsx#L30-L159): API errors, loading, all-drive pagination, first 25 jobs/events, manual refresh, append pagination.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DA.S2  | [settings-client.tsx:161–200](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings-client.tsx#L161-L200): deletion request, immediate receipt, confirmation reset, accepted-but-refresh-failed handling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DA.S3  | [settings-client.tsx:202–298](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings-client.tsx#L202-L298): navigation, Refresh, Audit log, OWNER ONLY, actor/result labels, accessible scroll region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DA.S4  | [settings-client.tsx:299–408](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings-client.tsx#L299-L408): deletion warnings, timing/retention explainer, exact confirmations and disabled controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DA.S5  | [settings-client.tsx:411–451](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings-client.tsx#L411-L451): Deletion requests, Needs retry, timestamps, IDs, older requests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DA.S6  | [settings.css:18–50](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings.css#L18-L50), [120–186](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/settings.css#L120-L186): scroll container, minimum input height, wrapping IDs, one-column mobile deletion forms and horizontally wide audit table. These are CSS intentions, not rendered verification.                                                                                                                                                                                                                                        |
| DA.S7  | [handler.ts:568–651](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L568-L651): account-scoped audit/job queries, timestamp-plus-ID cursors, status derivation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| DA.S8  | [handler.ts:653–744](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L653-L744): exact confirmations, request idempotency, access revocation, grace scheduling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DA.S9  | [handler.ts:100–181](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L100-L181), [350–364](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L350-L364), [1737–1792](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1737-L1792): bearer/session guards, tombstones, account boundaries, drive access and same-origin mutation requirement.                                                                                                                                                                                                          |
| DA.S10 | [deletion.ts:20–115](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.ts#L20-L115): version/delete-marker cleanup, bounded batches, ownership guards, drive-prefix isolation and metadata removal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DA.S11 | [deletion.ts:118–277](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.ts#L118-L277): billing reconciliation, provider closure, synthetic identity exception, account prefix removal, retained receipts and hashed tombstone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DA.S12 | [deletion.ts:280–392](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.ts#L280-L392): pending/completed processing, retry scheduling, leases, completed-job sweeps and reopening cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| DA.S13 | [settings/page.tsx:1–12](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/settings/page.tsx#L1-L12), [console/auth.ts:6–81](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/console/auth.ts#L6-L81): sign-in redirect and development-only synthetic console authentication.                                                                                                                                                                                                                                                                                                                                                              |
| DA.S14 | [console.tsx:390–395](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L390-L395), [510–560](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L510-L560), [615–650](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L615-L650), [1057–1096](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/app/%28app%29/console/console.tsx#L1057-L1096): settings entry, selected drive, Load drive key, Download, Trash/Restore and recovery-file alternative. |
| DA.S15 | [handler.ts:1850–1888](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L1850-L1888): public-share requests exclude deleting accounts/drives and cannot issue a fresh download URL for them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DA.S16 | [deployment.md:56–82](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/deployment.md#L56-L82), [quickstart.md:48–67](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/quickstart.md#L48-L67): required external worker, non-instant link revocation, retention boundaries, local-origin and synthetic/live distinctions.                                                                                                                                                                                                                                                                                                                                                     |
| DA.S17 | [deletion.integration.test.ts:207–348](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.integration.test.ts#L207-L348), [350–501](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.integration.test.ts#L350-L501), [584–796](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/deletion.integration.test.ts#L584-L796): existing definitions for neighbor preservation, stale keys/shares, sweep retries, microsecond pagination, account/provider blockers and stale identity rejection. Read only; not executed.                                                     |
| DA.S18 | [api.md:47–49](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/docs/api.md#L47-L49), [handler.ts:312–338](https://github.com/dennisonbertram/agent-drive/blob/75fad60116971cb9ea4be17cd8de18d3ce9a706a/apps/web/src/api/handler.ts#L312-L338): audit metadata, pending/success/failure and mutation-committed-but-audit-failed ambiguity.                                                                                                                                                                                                                                                                                                                                                                                         |

## Provenance and canonical IDs

All 45 supplied stories map below; three pairs were merged, and no distinct supplied workflow was silently dropped.

| Supplied ID | Final ID  |
| ----------- | --------- |
| ONB-001     | STORY-001 |
| ONB-002     | STORY-002 |
| ONB-003     | STORY-003 |
| ONB-004     | STORY-004 |
| ONB-005     | STORY-005 |
| ONB-006     | STORY-006 |
| ONB-007     | STORY-007 |
| ONB-008     | STORY-008 |
| ONB-009     | STORY-009 |
| FK-01       | STORY-009 |
| FK-02       | STORY-008 |
| FK-03       | STORY-010 |
| FK-04       | STORY-011 |
| FK-05       | STORY-012 |
| FK-06       | STORY-013 |
| FK-07       | STORY-014 |
| FK-08       | STORY-015 |
| FK-09       | STORY-016 |
| FK-10       | STORY-017 |
| SHARE-01    | STORY-018 |
| SHARE-02    | STORY-019 |
| SHARE-03    | STORY-020 |
| SHARE-04    | STORY-021 |
| SHARE-05    | STORY-022 |
| SHARE-06    | STORY-023 |
| SHARE-07    | STORY-024 |
| SHARE-08    | STORY-025 |
| SHARE-09    | STORY-026 |
| BILL-01     | STORY-002 |
| BILL-02     | STORY-027 |
| BILL-03     | STORY-028 |
| BILL-04     | STORY-029 |
| BILL-05     | STORY-030 |
| BILL-06     | STORY-031 |
| BILL-07     | STORY-032 |
| BILL-08     | STORY-033 |
| BILL-09     | STORY-034 |
| DA-01       | STORY-035 |
| DA-02       | STORY-036 |
| DA-03       | STORY-037 |
| DA-04       | STORY-038 |
| DA-05       | STORY-039 |
| DA-06       | STORY-040 |
| DA-07       | STORY-041 |
| DA-08       | STORY-042 |

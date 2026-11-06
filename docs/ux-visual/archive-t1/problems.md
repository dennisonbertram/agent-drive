# ux-visual problem register (Phase 3), T1 Rack, 2026-11-04

Inputs: the six findings.md files (marketing 19, console-files 21, console-secondary 26, account 19, connect 15, share 16 = 116 findings), their audit.json where cited, `inventory.md`, `docs/design/t1-rollout.md`. Severity is the highest rating any reviewer gave, after the page inspector's own downgrades. Rank = severity x reach x centrality / effort, P0 first.

Duplicates merged: CF-09 = CS-15 (lime dot); CF-10 = CS-16 = MARKETING-01 = ACCOUNT-01 (old brand mark; ACCOUNT-16 and SHARE-14 are related); CF-03 = CS-03 = CS-04 = ACCOUNT-06 = ACCOUNT-07 (table unreachable at 375); CF-11 = CS-06 = CS-07 (mobile nav and bay strip); MARKETING-03 = ACCOUNT-02 (double rule); MARKETING-04 = ACCOUNT-03 (disabled paid plan buttons); CF-15 = CS-08 (1920 left edges); CF-04 = CS-05 (truncation); CF-12 = CS-19 = ACCOUNT-17 (small targets). Rejected false positives (contrast audits on dark panels, "localhost in copy") are not carried.

## Top 12 clusters (carried forward)

### C01 Files table path column collapses (P0, ranked 1)

- Root cause: `.file-panel table` uses fixed widths for size/author/date/actions (110+160+168+210 = 648) and the path column gets what is left; between 761 and ~1030px that is 0-138px. Truncation keeps the directory and cuts the file name; the cell has no `title`; rows have no hover state.
- Findings: CF-01, CF-04, CF-13, CF-12 (weight/target part), CS-05, CS-19 (row actions). Surfaces: `/console` Files, Trash table (same pattern). Evidence: lead screenshot plus `768x1024-populated-nokey.png`, th width 0 at 768 / 14 at 900 / 138 at 1024.
- Severity P0. Reach: every file list at tablet widths, plus truncation at all widths.
- Acceptance: at 768, 900, 1024 the path column is at least 240px and its file name is visible in every row; no header overlaps; truncated paths keep the file name (truncate the directory side) and have `title` equal to the full path; row hover and focus-within change background; row action targets at least 24px tall; Download remains the strongest action.
- decision: obvious. Give the path column `width:auto; min-width:240px` and let the fixed columns shrink or drop Author under 1030px; split directory and name so the middle truncates; add `title`; add `tr:hover` and `:focus-within`; raise `.row-actions` link min-height to 28px.
- files: `apps/web/app/styles/console.css` (~436-520 `.file-panel table`, th widths, `.file-path`, `.row-actions`, media queries 618-729); `apps/web/app/(app)/console/console.tsx` (~765-840 file cell; Trash table ~748).

### C02 Old identity left over: brand mark and lime dot (P1, rank 2)

- Root cause: the T1 brand tile and the signal-orange palette exist only in landing/share/connect. Console sidebar, billing, settings, sign-in/up, pricing still render the old "a/ agent drive" `.brand-mark`; `.status-dot` in `globals.css:213` is still #a2cb67 lime.
- Findings: CF-09, CS-15, CF-10, CS-16, MARKETING-01, ACCOUNT-01, ACCOUNT-16 (brand part), SHARE-14 (logo lacks inset highlight). Surfaces: all of /console, /console/billing, /console/settings, /pricing, /sign-in, /sign-up. Evidence: computed `rgb(162,203,103)`; grep `brand-mark` in console.tsx:472, billing-client.tsx:253, settings-client.tsx:206, pricing/page.tsx, sign-in/up page.tsx.
- Severity P1. Reach: every signed-in and pricing page.
- Acceptance: grep finds no `a/` brand-mark markup; every header shows the logo tile with LED plus "Agent Drive" (identical computed size/colour to landing); `.status-dot` computed colour equals `--sig` (or neutral), no #a2cb67 anywhere in CSS; one shared component used by console, billing, settings, pricing, auth pages.
- decision: obvious (match `docs/design/t1-rack-reference.html:185` and the landing brand). Create a shared `BrandMark` component and `.brand-logo` rules in globals.css (move from `landing.css` `.landing-logo`, including `share.css` inset highlight); recolour `.status-dot`.
- files: `apps/web/app/globals.css` (`.brand`, `.brand-mark` ~150-160, `.status-dot` ~213; new `.brand-logo`); new `apps/web/app/brand-mark.tsx`; adoption edits in `console.tsx:472-473`, `billing-client.tsx:253`, `settings-client.tsx:206`, `pricing/page.tsx`, `sign-in/[[...sign-in]]/page.tsx`, `sign-up/[[...sign-up]]/page.tsx`; delete `.sidebar .brand-mark` (console.css:22-30) and `.billing-page/.auth-page .brand-mark` (account.css:20-31).

### C03 Wide tables unreachable on phones (P1, rank 3)

- Root cause: tables keep a 620-1851px intrinsic width inside a 293-341px `.table-scroll` with no cue, so size, author, Download, Restore, usage columns, audit columns are off-screen.
- Findings: CF-03, CS-03, CS-04, CS-24, ACCOUNT-06, ACCOUNT-07. Surfaces: Files, Trash, Usage by author, billing Usage by agent, settings Audit log, at 375 (and 768 for audit). Evidence: tsSW 1851/341, 728/341, 620/341, 620/293, 630/293.
- Severity P1. Reach: 5 tables, core job (Download, Restore) at 375.
- Acceptance: at 375 the primary action of each row (Download, Restore) is visible without sideways scroll; no table scroller is wider than 1.3x its box unless a visible scroll cue (edge fade or shadow) is present; no mid-word clipped action text.
- decision: design. Open question: stacked row-cards under 760px (reorganises every table) versus keeping tables with an edge fade plus sticky first column. Both stay inside the design system.
- files: `console.css` (`.table-scroll`, 760px query), `console-panels.css` (usage/trash tables), `account.css` (`.billing-page table`, `.settings-audit`, max-width 700 block), `console.tsx` (~748, 1117 table markup), `billing-client.tsx`, `settings-client.tsx` (table markup if cards).

### C04 Console is not one screen; 1920 left edges differ (P1, rank 4)

- Root cause: `.console-shell/.console-main/.table-scroll` have no height or overflow contract, so the document scrolls (1097 at 1440x900) and footers fall below the fold; the bay strip and topbar are full-bleed while `.console-content` is capped at 1400 and centred.
- Findings: CF-02, CF-15, CS-08, CS-01 (scroll part; cause also in C09). Surfaces: all console tabs. Evidence: scrollHeight 1097/1145; bay-strip x=224 vs heading x=400 at 1920.
- Severity P1. Reach: all console tabs.
- Acceptance: at 1440x900 and 1920x1080, populated Files, API keys, Agents, Trash have `document.scrollingElement.scrollHeight <= innerHeight`; only the table body scrolls (sticky thead); at 1920 bay strip, breadcrumb and content share one left edge (+-1px).
- decision: obvious (norm L1 for app surfaces; the T1 shell). `.console-shell{height:100dvh}`, flex column, `min-height:0`, `.table-scroll{overflow:auto}`, sticky `thead`; apply the same max-width container to strip and topbar.
- files: `console.css` (`.console-shell`, `.console-main`, `.console-content` ~171, `.bay-strip` ~183, `.topbar`), `console-panels.css` (`.file-panel`).

### C05 Mobile section nav and bay strip clip (P1, rank 5)

- Root cause: overflowing horizontal strips with no overflow cue, snap, or scroll-into-view; nav label "Billing & limits" collapses to "$"; five stacked header regions use about 320px at 375.
- Findings: CF-11, CS-06, CS-07, MARKETING-09 (landing nav drops links, 21px links, same cause: no small-screen nav). Surfaces: console at 375/768, landing nav. Evidence: bay-strip scrollWidth 662 vs 375, nav 576 vs 343.
- Severity P1. Reach: all console tabs on phone and tablet.
- Acceptance: at 375 selected drive chip fully visible on load (scrollIntoView); both strips show an edge fade when overflowing; every nav destination is reachable and labelled (no bare "$"); content starts at or above y=260 at 375.
- decision: design. Open question: how mobile section navigation presents (scrolling tabs with fade, bottom tab bar, or a menu button) and whether breadcrumb/h1/tab triplication collapses.
- files: `console.css` (`.bay-strip`, `.sidebar nav`, max-width 760 block 618-729), `console.tsx` (~532 scroll selected chip, nav labels); `landing.css` (`.landing-links` hide rules) only if landing nav is included (deferred).

### C06 Billing and pricing states give wrong or no feedback (P1, rank 6)

- Root cause: the unavailable-checkout state is drawn with ad hoc opacity on live-looking primary/outline buttons; errors render at page top; form labels are ambiguous.
- Findings: MARKETING-04, ACCOUNT-03, ACCOUNT-10, ACCOUNT-05, ACCOUNT-13, CS-22, CS-25. Surfaces: `/pricing`, `/console/billing`, `/console/settings`, receipt dialogs. Evidence: devbtn opacity 0.48 orange; banner at y=-519 after Save with bad input.
- Severity P1. Reach: billing page (one task page) and every disabled button.
- Acceptance: one disabled style (no orange fill, no opacity-faded primary) across billing, pricing, settings, dialogs; each disabled button has adjacent text stating why; a failed Save puts the error within 80px of the Save button and in the viewport; "EMAIL ME AT (USD)" label renamed so it does not read as an email field; Free/Developer cards do not both show emphasis.
- decision: obvious for the shared disabled style, inline error placement and label wording (`globals.css` `.button:disabled`, `.billing-form` error slot). Pricing "SELECTED" badge removal and the `paidAvailable` disabling are marked below.
- product-change: needs user decision: making Choose Developer/Team non-links when `!paidAvailable` (today they route to /console/billing then /sign-in).
- files: `globals.css` (`.button:disabled`; owned by WP0), `account.css` (`.billing-plan.selected`, `.billing-plan > .button`, `.settings-delete-grid` buttons), `pricing/page.tsx`, `billing-client.tsx` (error slot, labels), `settings-client.tsx` (disabled reason line).

### C07 Share error states look like normal states (P1, rank 7)

- Root cause: `ShareClient` renders every failure in the same card as success: grey LED, white filename label holding the heading, an inert 8px bar where Download sits, one reused paragraph, and duplicate encryption captions.
- Findings: SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-08, SHARE-09, SHARE-10, SHARE-11, SHARE-13, SHARE-14, SHARE-12 (vertical centring). Surfaces: `/s/[id]` all 9 states. Evidence: shots expired/revoked/not-found identical; readout 48,254 vs 48,213 on disk.
- Severity P1. Reach: every share recipient who hits an error (and ready-state wording).
- Acceptance: error LED uses an alarm colour distinct from ready/loading; label text no longer styled as a filename; no `.share-pull` bar in non-ready states; separate body text for not-found / expired / revoked / wrong-key, none says "Your files have not been changed"; size shown human-readable (KB/MB, not encrypted bytes); expiry shows a date with timezone or relative time; one encryption caption, readout labels at least 12px; card min-height equal across states (+-8px); footer has no one-word widow.
- decision: obvious (copy and styling of existing data per `t1-rack-reference.html`). Excluded: SHARE-01 paste-link/key field, SHARE-07 retry button (product-change: needs user decision), SHARE-15 sender/type context (needs API; needs user decision).
- files: `apps/web/app/s/[id]/share-client.tsx` (`errorHeadings`, body branch, readout formatting, remove `.share-note` or `.share-footer`); `apps/web/app/styles/share.css` (`.share-card[data-state='error'] .share-led`, `.share-pull`, `.share-details span`, `.share-note`, `.share-footer`, `.share-card` min-height, `.share-shell` centring, `.share-logo`).

### C08 Files view loading, empty and count states misstate the drive (P1, rank 8)

- Root cause: panel branches in `console.tsx` do not distinguish loading from empty; banners render regardless of file count; footer count ignores the filter.
- Findings: CF-07, CF-06, CF-14. Surfaces: `/console` Files at all viewports. Evidence: loading shot shows "Connect an agent" empty copy and badge 0; empty drive shows key-loss warning; footer "10 loaded" with 2 rows.
- Severity P1 (CF-07). Reach: first load of every drive, every empty drive.
- Acceptance: during load no empty-state copy or "0" badge is shown (skeleton or neutral "Loading files..." only, same panel height as loaded +-10%); a drive with 0 files shows no backup-loss banner and no key-browse banner; footer reads "2 of 10" when filtered; filter disabled on an empty drive; no-match message uses empty-state style.
- decision: obvious (conditional rendering of existing state; no new behaviour).
- files: `console.tsx` (~910 loading vs empty, ~680-760 banners and panel footer), `console-panels.css` (`.empty`, skeleton height).

### C09 Chrome stacked above the work (P1, rank 9)

- Root cause: informational blocks (drive id/key badge row, backup banner, key-info banner, key-loaded notice, persisting status notice, the 320px Connect an agent card) all render above the table or list and repeat key state three times.
- Findings: CF-05, CF-08, CF-17, CF-18, CF-20, CS-01, CS-02, CS-09, CS-17, CS-21, CS-23, CS-26. Surfaces: Files, Agents, API keys, Trash. Evidence: table starts y=417/465 of 900, file list below fold at 375; notice shifts content 57px; API keys scrolls up to 1529px at 375.
- Severity P1. Reach: all console tabs.
- Acceptance: key state stated once; first table row or key row starts above y=380 at 1440x900 (above y=520 at 375); loading a key does not shift the table; notice clears on tab change; Connect an agent card is collapsed or hidden once an agent/key exists; one primary "New drive" button in onboarding; one name for Files across topbar/nav/h1.
- decision: design. Open question: whether state moves into a single compact status line on the toolbar vs a collapsible "Setup" strip, and whether Connect an agent collapses to `<details>` or leaves the tab. Use the T1 backup status line ("LED plus one line") as the base.
- product-change: needs user decision: renaming nav/h1 copy for CF-20 and the "YOUR NEXT AGENT" chip (CS-17).
- files: `console.tsx` (~126 connect-agent section, ~605-760 toolbar/banners/notice, ~563 add chip, tab-change notice clear), `console-panels.css`, `console.css`.

### C10 Pricing/billing/settings do not share the landing page template (P1, rank 10)

- Root cause: `.billing-header` / `.billing-heading` are a separate template from `.landing-nav`: double rule (84 and 124), different nav links, narrower container, different footer, no link between Billing and Settings, no pricing "current" state.
- Findings: MARKETING-02, MARKETING-03, ACCOUNT-02, MARKETING-11 (footer), MARKETING-15 (button heights), MARKETING-17 (titles), ACCOUNT-11, ACCOUNT-09 (grid alignment). Surfaces: `/pricing`, `/console/billing`, `/console/settings`. Evidence: borders at y=83 and 124/128.
- Severity P1/P2. Reach: 3 pages.
- Acceptance: exactly one horizontal rule between header and page title; pricing header links match landing (Pricing current, Sign in, Open console); container left edge equals landing (116 at 1440); billing and settings link to each other and use one back label; delete columns tops equal (+-2px); pricing `<title>` differs from landing; footers identical.
- decision: obvious for rule removal, header link set, footer, title, delete-column `align-items:start`. design only for ACCOUNT-12 (billing/settings inside console shell), deferred.
- files: `account.css` (`.billing-header`, `.billing-heading`, `.settings-delete-grid`, container), `pricing/page.tsx`, `billing-client.tsx`, `settings-client.tsx`; metadata title in `pricing/page.tsx` (not layout.tsx).

### C11 Dialogs, secrets and copy affordances (P2, rank 11)

- Root cause: `Dialog` has no focus management and secret receipts are bare textareas; `CopyButton` failure goes only to an sr-only region.
- Findings: CS-12, CS-13, CS-18, CS-22, MARKETING-10, CF-18, CS-25. Surfaces: New drive, Load key, New agent, New API key, API key reveal, drive key reveal, Versions; every CopyButton. Evidence: activeElement = Close; textarea resize grabber; "Copy failed" never visible.
- Severity P2. Reach: 7 dialogs, secrets (security-adjacent).
- Acceptance: on open, focus lands on first field (or primary for receipts); on close, focus returns to the opener; secret receipts have a Copy button and `resize:none`; drive id has a Copy button; failed copy shows visible label "Copy failed" that resets after 2s; agent select shows the full name (wraps or title).
- decision: obvious (missing copy buttons, focus order).
- files: `console.tsx` (~200-240 Dialog, receipt dialogs, drive id), `console-panels.css` (dialog textarea, select), `apps/web/app/(app)/copy-button.tsx`.

### C12 Connect card specificity bugs and dot-grid ground (P2, rank 12)

- Root cause: `.connect-shell .panel > p` (0,2,1) beats `.connect-note` and `.banner`, giving margin 0 and wrong font size; `html`/`body` do not fill the viewport so the dot grid stops at content height on every short page; Deny is 13px beside a 16px Approve.
- Findings: CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-09, CONNECT-11, CONNECT-12, CONNECT-14, CONNECT-13 (card position). Surfaces: `/connect` all states; dot-grid on /s, approved, sign-in, any short page. Evidence: html 842.9 vs 900; note margin-top 0; banner 14px grey.
- Severity P2. Reach: connect plus every short page.
- Acceptance: `html` height >= `innerHeight` on all short pages (dot grid fills viewport); `.connect-note` margin-top 16px; info banner computed font equals error banner (13px ink); `agent-drive login` rendered in nowrap mono `<code>`; Deny and Approve same font size; no page scroll in approve-error at 1440x900.
- decision: obvious (specificity fix `p:not(.banner):not(.connect-note)`, `min-height:100%`).
- files: `globals.css` (`html,body` min-height; WP0), `connect.css` (`.connect-shell .panel > p`, `.connect-note`, `.banner`, `.button.secondary`, padding-bottom), `connect.tsx` (wrap login command in `<code>`).

## Deferred (reasons)

| id  | title                                | findings                                                                                                                                                                         | severity | decision | reason                                                                                                                                                                                   |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C13 | Landing/marketing polish             | MARKETING-05..09 (rack 7.5px labels, 768 left edge, 375 setup row, CTA hierarchy, nav), 12-14, 16, 18, 19                                                                        | P2       | obvious  | Marketing page already strong; lower centrality. Cheap follow-up in `landing.css`/`page.tsx`.                                                                                            |
| C14 | Connect content and trust            | CONNECT-01, 05, 06, 07, 08, 10                                                                                                                                                   | P1/P2    | design   | CONNECT-01 (show signed-in account) is product-change: needs user decision; the rest are copy/new actions (Open console link, rate-limit countdown, relative expiry) needing a decision. |
| C15 | Share recovery                       | SHARE-01, 07, 15, 16                                                                                                                                                             | P1       | design   | product-change: needs user decision (paste link/key field, retry button, sender/type, timeout).                                                                                          |
| C16 | Console data/product changes         | CS-10 (revoke scope text, dead Revoke), CS-11 (key prefix/created), CS-14 (Egress card), CF-16 (upgrade link in plan-limit dialog), ACCOUNT-08 (audit log filtering), ACCOUNT-12 | P2       | design   | product-change: needs user decision (removes or adds behaviour or data).                                                                                                                 |
| C17 | Billing layout/order                 | ACCOUNT-04, 14, 15, 19, MARKETING-16                                                                                                                                             | P2/P3    | design   | Section reorder and metric meters change layout structure; revisit after C06.                                                                                                            |
| C18 | Type/spacing scale and touch targets | CF-21, CS-20, ACCOUNT-17/18, CONNECT-15, MARKETING-06/10 sizes                                                                                                                   | P3       | obvious  | Broad token pass, low severity each; touch targets under 24px in console are covered by C01. Do after the top 12.                                                                        |
| C19 | Onboarding at 375                    | CF-19                                                                                                                                                                            | P3       | obvious  | Single-surface, minor.                                                                                                                                                                   |
| C20 | Pricing fine print                   | MARKETING-16                                                                                                                                                                     | P3       | obvious  | Presentation only, low severity.                                                                                                                                                         |

## Coverage check against inventory.md

Audited: landing (default, reduced motion), pricing (checkout disabled), console Files (onboarding, empty, populated, key not loaded/loaded, backup shown/hidden, loading, filter, 3 drives), Agents, API keys (empty/list/revoked), Usage, Trash, dialogs (New drive, Load key, New agent, New API key, API key reveal, drive key reveal, Versions), billing, settings (zero drives), Clerk fallback panel, connect (all listed states), share (all 7 listed states plus loading). Four viewports each. Note: `pages/console`, `pages/landing`, `pages/pricing` findings files also exist; they were not part of this pass (marketing covers landing and pricing).

Not audited or unverified:

- Real Clerk `<SignIn>`/`<SignUp>` widgets, OAuth buttons, Clerk error states, `t1Appearance` styling, and the signed-in account identity in headers (Clerk not configured locally).
- Paid checkout, Stripe portal, a paid plan, statement history, deletion with a populated drive list, non-empty deletion requests (settings seen only with zero drives).
- 4+ drives in the bay strip (free plan cap is 3); overflow is predicted, not observed.
- Native `window.confirm` for Revoke (console.tsx 953, 1026) and Restore from Trash.
- Escape in receipt dialogs relaunched the headless browser twice: unverified whether tool or app (possible secret-loss path; test in a real browser).
- Connect "Looking up" transient state and non-404 lookup error; share on a real slow network (loading was forced).
- Live motion (LED blink, rack animation) beyond the reduced-motion check.

## Implementation plan (5 work packages, disjoint files)

Product-change items marked above are excluded from all packages.

- WP0 Foundation (runs first): `apps/web/app/globals.css`, new `apps/web/app/brand-mark.tsx`, `apps/web/app/(app)/copy-button.tsx`. Does: C02 shared mark and lime fix, C06 shared `.button:disabled` style, C12 ground min-height, C11 copy-button visible failure, plus any shared scroll-cue class C03 needs. Exports `BrandMark` and `.brand-logo`.
- WP1 Console (waits for WP0): `console.tsx`, `console.css`, `console-panels.css`. Does C01, C04, C05, C08, C09, C11 (dialogs), console part of C02 and C03. Largest package; run its clusters in the order C01, C04, C08, C11, then C05/C09 after their design decisions. Do not split console.tsx between agents.
- WP2 Account and pricing (waits for WP0): `pricing/page.tsx`, `billing/billing-client.tsx`, `settings/settings-client.tsx`, `sign-in/.../page.tsx`, `sign-up/.../page.tsx`, `account.css`. Does C10, C06 page-level parts, account part of C02 and C03.
- WP3 Connect (independent): `connect/connect.tsx`, `connect.css`. Does C12 non-global parts. (`connect/page.tsx` stays untouched; connect already uses the new mark.)
- WP4 Share (independent): `app/s/[id]/share-client.tsx`, `share.css`. Does C07.

No package is assigned `landing.css` or `(app)/page.tsx`; landing polish (C13) is deferred. WP1 and WP2 depend on WP0 only for `BrandMark`, `.button:disabled` and `.brand-logo`; WP3 and WP4 can start immediately.

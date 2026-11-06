# Problem register (ux-visual run 2, 2026-11-06)

Inputs: `pages/{console,landing,pricing,auth,connect,llms,share,settings,billing}/findings.md` and `audit.json`, `pages/inventory-notes.md`, `docs/ux-flow/report.md`, `docs/ux-walker/latest-report.md`. Inventory: `inventory.md`. Earlier run: `archive-t1/`.

Finding ids are the inspectors' own: F = console, L = landing, PR = pricing, A = auth, CN = connect, SH = share page, ST = settings, BL = billing, LL = llms.txt. Evidence paths are relative to `docs/ux-visual/pages/<page>/shots/`. All findings were observed by one inspector per page (no second opinions), so "found by" agreement is weak; agreement with ux-flow or ux-walker is noted where it exists.

## Method

Deduplication: the same fault seen at several viewports counts once. The 89 inspector findings (console 20, landing 11, pricing 7, auth 6, connect 17, share 9, settings 10, billing 8, llms 1) were grouped by root cause into 18 clusters (87 findings placed; A-5 and A-6 are not, see the end). One cluster is one design decision, fixed at the shared component, token or layout.

Ranking score = severity weight x reach x centrality x owner multiplier / effort.
- Severity weight: P0 8, P1 4, P2 2, P3 1.
- Reach (1 to 5): number of surfaces, states and journeys touched. 5 means most of the app or six or more journeys.
- Centrality: 3 for the two owner goals (console as a clear cloud drive; sign-up and setup), 2 for other core use, 1 for rare pages.
- Owner multiplier: 1.5 when the cluster sits on an owner goal.
- Effort: S 1, S to M 1.5, M 2, L 4. Where a cluster is large I score its phase-1 scope (stated in the cluster).
No cluster is P0 (no blocked journey, no data loss other than the missing Undo on Trash, which is recoverable from the Trash tab).

Already-decided simplifications from `ux-flow/report.md` (proposals 1 to 11) and `ux-walker/latest-report.md` (High findings F-001-02, F-019-01, F-022-01, F-024-01, F-STORY-046-01, F-STORY-065-01) are folded into clusters and are not contradicted. Each cluster names the proposal it implements.

## Ranked cluster list

| Rank | Id | Title | Severity | Reach | Score | Status |
|---|---|---|---|---|---|---|
| 1 | C01 | Sign-up front door and mobile marketing header | P1 | 4 | 72 | Carried |
| 2 | C02 | Console error, loading and empty states | P1 | 3 | 54 | Carried |
| 3 | C03 | File-row actions and feedback where the action happens | P1 | 4 | 48 | Carried |
| 4 | C04 | Console as a cloud-drive file browser | P1 | 5 | 45 | Carried |
| 5 | C05 | Unlock on demand: Download always works, one key-state signal | P1 | 5 | 45 | Carried |
| 6 | C06 | First-run console and key backup | P1 | 3 | 36 | Carried |
| 7 | C07 | /connect: approval card, existing-drive form, approved next step | P1 | 3 | 27 | Carried |
| 8 | C08 | Share from the console: Share action and Shared links list | P1 | 3 | 27 | Carried |
| 9 | C09 | Operator and unconfigured-deployment language shown to visitors | P2 | 3 | 27 | Deferred |
| 10 | C10 | One concept, one name; filler copy | P2 | 5 | 20 | Deferred |
| 11 | C11 | Share page (recipient) states and next steps | P1 | 2 | 16 | Deferred |
| 12 | C12 | Billing and usage: units, plan, "Not connected" | P1 | 3 | 16 | Deferred |
| 13 | C13 | Type scale, spacing scale and touch targets | P2 | 5 | 10 | Deferred |
| 14 | C14 | Console list on phones and tablets | P1 | 2 | 8 | Deferred (see C04) |
| 15 | C15 | Settings: audit log language and page order | P1 | 2 | 5 | Deferred |
| 16 | C16 | Marketing and docs content polish | P2 | 3 | 3 | Deferred |
| 17 | C17 | Agents and API keys as one table | P2 | 3 | 3 | Deferred |
| 18 | C18 | Settings: permanent-actions section | P2 | 1 | 2 | Deferred |

Tie-break notes. C04 and C05 tie at 45 and C07, C08 and C09 at 27. I ranked P1 clusters on an owner goal above a P2 cluster with the same score, which is why C09 (conditional on a deployment that has no Clerk or Stripe) is deferred even though it is cheap. C04 is scored at phase 1 (breadcrumb with folder rows, sort, file icons, Recent, one primary action); inline preview and a full folder tree are later phases. C14 is deferred because C04's list redesign should include the 390px card layout; if C04's designers keep the table, C14 must move up.

---

## Carried forward

### C01. Sign-up front door and mobile marketing header
- Root cause: the marketing header is built twice (landing and pricing differ) and has no "Sign up" action; on phones the nav is not rendered at all. The only path to a free account is "Start with Free" on /pricing.
- Findings: L-1, L-2, L-4, PR-2, A-1 (auth card has no way to the other auth page). Also covers L-3 (Docs and llms.txt are the same link) as the nav item to remove. Matches ux-flow proposal 2 and walker F-001-02.
- Surfaces: `/`, `/pricing`, `/sign-in`, `/sign-up` at 1440, 768, 390; shared header component.
- Evidence: `landing/shots/390x844-home.png`, `landing/shots/1440x900-home.png`, `pricing/shots/1440x900-main.png`, `auth/shots/1440x900-signin.png`. Measured: at 390 the DOM lists only footer nav (about 7,800 px down); `a[href="/llms.txt"]` appears twice in nav.
- Severity: P1. Reach 4. Effort S.
- Acceptance criteria:
  1. One shared header component renders on / and /pricing with identical items, height and rule width at 1440, 768 and 390.
  2. Signed-out header shows exactly one orange "Sign up free" and a text "Sign in"; no "Console" link while signed out; Docs and llms.txt appear once.
  3. At 390x844 the header exposes Sign up, Sign in and the other nav items without scrolling (menu button or inline), each target at least 44 px tall.
  4. A signed-out visitor reaches the sign-up page in one click from the first viewport at every width.
  5. /sign-in links to /sign-up and /sign-up links to /sign-in; both link to Pricing or Docs.
  6. The final CTA on / offers "Create a free account" next to the agent Copy button.

### C02. Console error, loading and empty states
- Root cause: the console has no shared state components. Each tab renders a raw string for errors and its own empty copy, and nothing keys the empty state to a failed load.
- Findings: F05 (raw "Failed to fetch", no retry, false empty state beneath it, 56 px shift), F10 (filtered panel keeps dead space, footer jammed under one row), part of F18 (count in 3 places), F08 (Trash columns truncated or constant), plus the unverified loading state (flashes; ux-flow saw Trash stuck on "Loading files" without a timeout message).
- Surfaces: Files, Trash, Agents, API keys, Usage at 1440 and 390.
- Evidence: `console/shots/1440-list-error.png`, `1440-files-filtered.png`, `1440-trash.png`, `1440-loading.png`. Computed: error banner shifts content 56 px.
- Severity: P1. Reach 3. Effort S.
- Acceptance criteria:
  1. A failed list request shows a plain-language message ("Could not load files"), a Retry button, uses the system error colour with role=alert, and hides the "Ready for your first file" empty state.
  2. A loading state exists for every list, shows a skeleton or text within 150 ms of the request, and after 10 s shows "Still loading" with Retry.
  3. Showing or hiding the error or the filter result moves no other element more than 2 px (reserved space or overlay).
  4. A filter with zero matches says "No files match 'x'" with a Clear filter button; with one match the panel has no more than 24 px below the footer.
  5. Trash columns show the full deleted date with no truncation at 1440 and 768, and no column holds the same value in every row.
  6. File count appears at most twice on the Files screen.

### C03. File-row actions and feedback where the action happens
- Root cause: row actions are three equal-weight text links with no confirmation or undo, and results are reported in the page header far from the row. There is no toast component.
- Findings: F04 (Trash is a 46x28 link beside Versions; I trashed two files by mis-click), F15 (Versions dialog shows UUIDs and seconds, no way to view an old version, lone "Current" row unexplained), F17 (receipt dialog hierarchy: Copy orphaned, recommended action outline, primary disabled). Folds ux-flow proposal 8 (toasts near action naming the file with Undo or "Show file"; named in-app confirm instead of native `confirm()`; Trash notice that share links stop working).
- Surfaces: Files rows, Trash rows, Versions dialog, receipt dialog, Agents revoke.
- Evidence: `console/shots/1440-trash.png`, `1440-versions-dialog.png`, `1440-versions-multi.png`, `1440-receipt.png`.
- Severity: P1. Reach 4. Effort S to M.
- Acceptance criteria:
  1. Trashing a file shows a toast within 100 ms, adjacent to the list (bottom-left, within the viewport at 1440 and 390), that names the file, has an Undo that restores it, and stays at least 6 s.
  2. Row actions are one primary (Download or Open), and Versions, Share and Trash live in a row menu or overflow; no destructive action sits within 8 px of another action; hit area at least 32 px high (44 on touch).
  3. Restore from Trash and Versions show a toast naming the file and a "Show file" action; nothing is reported only in the page header.
  4. Revoking an agent uses an in-app confirm naming the agent and the number of active keys, and afterwards the row changes state in place (no "Revoke access" at 0 keys).
  5. The Versions dialog lists version number or relative date, size and author, no UUID in the default view, and says "This is the current version" for a single-version file.
  6. In the receipt dialog the recommended action ("Save recovery key") is the single orange primary, Copy sits beside the key, and Continue is a secondary until the box is ticked.

### C04. Console as a cloud-drive file browser
- Root cause: the Files tab is a flat log table of full paths, built for agents writing files. The list model has no hierarchy, sort, selection, file types or Recent view, and the page's only primary button creates a drive.
- Findings: F01, F02, F18, F20 (filler subtitle and footer copy consume space), F12 (drive strip repeated on account-level tabs, pushes content down 74 px). Folds ux-flow proposal 4, walker F-019-01 (no folder browsing) and F-022-01 (no Recent, no sort), and the opening-drive rule (open on the last-used drive).
- Surfaces: Files and Trash at all viewports; sidebar; drive strip.
- Evidence: `console/shots/1440-files-researchbot.png`, `1440-files-nightly.png`, `1440-agents.png`, `1440-usage.png`. Measured: path prefix `/inbox/x/` repeated five times, `/logs/` six times; no sort, folder or upload handlers in `console.tsx`.
- Severity: P1. Reach 5. Effort L (phase 1 scored M: breadcrumb and folder rows, sort, file-type icon, Recent view, one primary action, remembered drive).
- Acceptance criteria:
  1. Files shows folders as rows (folder icon, name, item count) and files inside the current folder with their name only (no repeated path prefix); a breadcrumb above the list navigates up; the selected folder is in the URL so reload and back work.
  2. Name, Modified and Size headers sort, default Modified newest first; the sort state is visible (arrow) and keyboard-operable.
  3. A Recent view lists the most recently modified files across the drive, using the existing `recent` API.
  4. Each file row has a type icon; no mono full path is the row title.
  5. The Files screen has exactly one orange primary that acts on files (for example "Connect an agent" while agents write all files, or Upload if added), and "New drive" is secondary.
  6. Opening /console selects the last-used drive, not the alphabetical first.
  7. Account-level tabs (Agents, API keys, Usage) do not show the drive strip, so their first content row starts at least 70 px higher than today.
  8. At 1440x900 the page has no page-level scroll (pageScrollY 0) with the list scrolling inside its panel, as today.
  9. Filler subtitles ("A home for the work. A starting point for what's next.", "Built for the work between sessions.") are removed or replaced with functional text.
- Open dependency: inline preview for text files (ux-flow 4) is phase 2.

### C05. Unlock on demand: Download always works, one key-state signal
- Root cause: the drive key is a precondition shown as disabled controls instead of a step reached on demand; key state is displayed three ways with one colour used for good and bad.
- Findings: F03, F07, F14, and the download-completion gap (key lost on reload). Folds ux-flow proposals 1 and 6 and the sharing prerequisite (share needs the same prompt).
- Surfaces: Files rows, toolbar, banner, key-load dialog, Versions.
- Evidence: `console/shots/1440-files-researchbot.png` (29 disabled Downloads), `1440-files-keyloaded.png` (29 outlined Downloads), `1440-keyload-dialog.png`, `1440-keyload-error.png`. Measured: disabled style #6b6963 at 0.6 opacity (about 2.5:1 on white); the error line moves the form 33 px.
- Severity: P1. Reach 5. Effort M.
- Acceptance criteria:
  1. No Download button is disabled because of the key; clicking Download with no key opens one prompt with the recovery file chooser first.
  2. Choosing the recovery file loads the key and starts the download without a further click; the file field is the primary control and a pasted-key field is behind a disclosure.
  3. The prompt does not shift on error (error reserved or overlaid, 0 px shift) and the error text is plain ("That recovery file is not for this drive"), not "base64url-encoded 32-byte key".
  4. A clicked row shows a busy label while downloading and a toast when the file is saved.
  5. Key state appears in one place (a chip) with colour meaning: green for loaded or backed up, red for required or not backed up; "Download recovery file" is hidden or explained once the key is backed up; the banner, badge and Load/Forget button are no longer three separate signals.
  6. Optional "Remember on this device" keeps the key across reload.
  7. Contrast of every enabled and disabled control on Files is at least 4.5:1 (disabled text at least 3:1).

### C06. First-run console and key backup
- Root cause: the first visit offers competing "create a drive" paths and the backup banner does not reflect that a recovery file was saved.
- Findings: F16 (two controls for one action, a "↗" on an in-page action, inert step labels, panel 11% filled), F19 (banner still says "hasn't been backed up" after Save recovery key), and the drive-name field with no default. Folds ux-flow proposal 3 and walker F-024-01 (saving the recovery file does not clear the banner). F19 was "suspected" in the headless browser; the walker record makes it High, so it is treated as real but needs a real-browser check.
- Surfaces: `/console` with no drives, New drive dialog, receipt, post-create banner.
- Evidence: `console/shots/1440-onboarding.png` (audit.json 1440/onboarding fillPct 11), `1440-newdrive-onboarding.png`, `1440-receipt.png`, `1440-empty-drive-keyloaded.png`.
- Severity: P1. Reach 3. Effort S to M.
- Acceptance criteria:
  1. First visit has exactly one orange primary; the "Connect your agent" panel with the llms.txt line and Copy is the lead, and "New drive" is secondary; no "↗" on in-page actions.
  2. The New drive name field has a default value ("my-drive"), submittable with Enter.
  3. The receipt has one confirmation ("Download recovery file and continue") that saves the file and closes the dialog.
  4. Immediately after that action, the banner reads "Key backed up" (green), never "hasn't been backed up".
  5. The first-run panel fills at least 35% of the 1440x900 viewport or is vertically balanced (no 89% blank).
  6. The step list uses numerals the same as the landing page and reflects state (done, current).

### C07. /connect: approval card, existing-drive form, approved next step
- Root cause: the review card is built as a stack of equal blocks, so the code outranks the decision, the delegate option precedes Approve, the existing-drive branch is a hidden link that expands the card to 1,300 px, and the final state has no onward link.
- Findings: CN-1, CN-6, CN-7, CN-8, CN-9, CN-10, CN-11, CN-12, CN-13, CN-14, CN-15, CN-16, CN-2, CN-3, CN-4, CN-5, CN-17, A-4 (brand placement differs from auth pages). Folds ux-flow proposal 7 (Approved page links to the console and says it will update; delegate checkbox behind a disclosure) and the "three names for one secret" copy item.
- Surfaces: `/connect` entry, review-new, existing, offer, approved, errors at 1440, 768, 390 (and 375, 1920).
- Evidence: `connect/shots/1440x900-existing.png` (pageScrollY 409; Approve at y about 1155), `1440x900-review-new.png`, `1440x900-offer.png`, `1440x900-approved.png`, `1440x900-invalid-code.png`, `1440x900-existing-err-wrongkey.png`, `390x844-existing.png`. Measured: native checkbox 13x13; branch link 178x16; label spacing 13 px above versus 19 px below.
- Severity: P1 (CN-1), others P2. Reach 3. Effort M.
- Acceptance criteria:
  1. In review-new and offer at 1440x900, 768x1024 and 390x844 the Approve button is fully inside the first viewport (scrollY at most 0 to reach it).
  2. In the existing-drive form at 1440x900 Approve is inside the viewport (card height at most 850 px); at 390x844 the Approve button is reachable within one scroll of at most 300 px.
  3. The decision heading ("Connect vis-agent-a?") is the largest text on the card; the pairing code is smaller than the heading.
  4. The delegate option is in a collapsed disclosure; the "Add to an existing drive" branch is a visible secondary button, at least 40 px tall.
  5. Offer permissions are a structured list (drive, access, write paths), not a run-on sentence.
  6. Checkboxes use the design system's styled control and have a 24 px or larger hit area; hint text sits at least 16 px from the Approve button.
  7. The drive key has one name across the form (the same word as the console); the file input is styled like the other controls; labels are 4 to 8 px above their own field and at least 16 px below the previous one.
  8. A form error appears next to its field, highlights it, and never lies off-screen at 1440x900 or 390x844 (scrolls into view); raw browser messages are replaced.
  9. The approved state names what was granted, links to the console, and says the console will update; "Approved" is not repeated in heading and body.
  10. The code field is focused on load, uppercases input and inserts the hyphen; the unknown-code banner uses the error treatment (not neutral grey) and its insertion shifts the field by 0 px.
  11. The brand mark is placed the same on /connect and /sign-in (same left alignment and top offset).

### C08. Share from the console: Share action and Shared links list
- Root cause: sharing exists in the CLI and API but the console has no Share action or list, so the human sender cannot do the job (0 of 3 steps possible). The visual run did not screenshot a missing screen; this cluster comes from ux-flow and walker evidence and from the code (no share handler in `console.tsx`).
- Findings: no inspector finding (absence). ux-flow proposal 5 and walker F-STORY-046-01 (High). Row actions overlap C03 and the unlock prompt overlaps C05.
- Surfaces: Files row menu, a Shared links list (new), Trash notice ("share links stop working").
- Evidence: `docs/ux-flow/report.md` section 5; `docs/ux-walker/latest-report.md` F-STORY-046-01; `console/shots/1440-files-researchbot.png` shows row actions Download, Versions, Trash only.
- Severity: P1. Reach 3. Effort M.
- Acceptance criteria:
  1. A Share action on every file row opens a dialog with expiry (default 7 days) and a Copy link button; the full URL including the `#k=` fragment is copied; the toast says "Link copied".
  2. A Shared links list shows file, created, expires, status and Revoke; revoke asks for confirmation naming the file and updates in place.
  3. Sharing a file with no key loaded uses the same unlock prompt as Download (C05).
  4. Trashing a file with active links says so in its confirm or toast.
  5. From a populated drive, creating a link takes at most 3 clicks from the Files list.

---

## Deferred

### C09. Operator and unconfigured-deployment language shown to visitors
- Root cause: configuration status (Clerk, Stripe, email) is rendered as user-facing copy instead of being hidden or replaced when a deployment is not configured.
- Findings: PR-1, A-2, BL3 (email alert offered although "Email delivery is not configured"), PR-7 ("Coming soon" buttons with no reason), BL2 (all plan CTAs disabled with the reason in a banner). Severity is P2 in production if Stripe and Clerk are configured: PR-1 was marked "may be environment-conditional" by its inspector and the real Clerk forms were not seen.
- Surfaces: `/pricing`, `/sign-in`, `/sign-up`, `/console/billing`.
- Evidence: `pricing/shots/1440x900-main.png`, `auth/shots/1440x900-signup.png`, `billing/shots/1440x900-default.png`.
- Severity: P2 (conditional). Reach 3. Effort S.
- Acceptance criteria: no page shows the words "configure" or "deployment" to a signed-out visitor; a disabled control states its reason on the control; an unavailable alert channel is hidden or marked "Email alerts: coming soon" beside the field; the checkout banner appears only to an owner signed in.

### C10. One concept, one name; filler copy
- Root cause: vocabulary was chosen per screen. Folds ux-flow proposal 11.
- Findings: A-3 ("workspace"), L-3, F20, CN-12 (three names for one secret), L-9 and PR-6 ($0 versus $0.00), and the unit mismatch 9.5 KB versus 9.4 KiB, "author" versus "agent".
- Surfaces: all pages. Evidence: `auth/shots/1440x900-signup.png`, `landing/shots/1440x900-home-full.png`, `pricing/shots/1440x900-main.png`.
- Severity: P2. Reach 5. Effort S.
- Acceptance criteria: a copy glossary exists with one term each for drive, agent, key, storage unit and price format; a grep for "workspace", "credentials bundle" and "recovery file" naming the same secret differently returns one term; prices render identically on / and /pricing; storage uses one unit system.

### C11. Share page (recipient) states and next steps
- Root cause: the share card was designed as a hardware transfer panel and handles only the happy path; error and progress states reuse text. ux-flow lists the recipient page as "already minimal" for the happy path, so this cluster changes error and progress states and file identity, not the two-step flow.
- Findings: SH1, SH2, SH3, SH4, SH5, SH6, SH7, SH8, SH9.
- Surfaces: `/s/<id>` all states, 3 viewports.
- Evidence: `share/shots/1440x900-ready.png`, `1440x900-wrong-key.png`, `1440x900-revoked.png`, `1440x900-decrypting.png`, `390x844-missing-key.png`, `1440x900-loading.png`.
- Severity: P1 (SH2, SH4), others P2 to P3. Reach 2. Effort S.
- Acceptance criteria: ready shows file name, a file-type icon and real plaintext size (not "439 B encrypted") when known; wrong key says "This link's key does not match" with a paste-link form and is reported without needing the Download click where possible; error cards link to Agent Drive; downloading shows a progress indicator and a "Saved" confirmation; the paste input has a placeholder and equal height to its button; loading shows one line and does not change card height by more than 2 px; the encryption footer is removed from error cards.

### C12. Billing and usage: units, plan, "Not connected"
- Root cause: billing rows show an integration status as data and the allowance is on a different screen from usage. Folds ux-flow proposal 9.
- Findings: BL1, BL4, BL5, BL6, BL7, F09 (usage table rules inconsistent).
- Surfaces: `/console/billing`, console Usage tab.
- Evidence: `billing/shots/1440x900-default-full.png`, `billing/shots/390x844-default.png`, `console/shots/1440-usage.png`.
- Severity: P1 (BL1), others P2. Reach 3. Effort S to M.
- Acceptance criteria: no "Not connected" string in table rows or tile values for a Free user; Usage shows "x of y" against the plan with a link to Billing; numeric columns are right-aligned; zero-use rows can be hidden; summary tiles at 768 are equal height and width; at 390 the first plan appears within the first screen; usage table has one consistent rule style.

### C13. Type scale, spacing scale and touch targets
- Root cause: no enforced token set; sizes and gaps are hand-picked per component.
- Findings: L-7, L-8, PR-5, CN-7, CN-17, SH9, ST10, BL8, F04 (target size), F09. Measured: 16 distinct font sizes on the landing page; off-scale gaps 3, 6, 7, 9, 10, 13, 14, 18, 22, 26; targets under 24 px on every audited page.
- Evidence: `landing/audit.json`, `connect/audit.json` (`spacing.offScale`, `smallTargets`), `settings/audit.json`, `billing/audit.json`.
- Severity: P2. Reach 5. Effort M.
- Acceptance criteria: at most 8 font sizes per page; every padding, margin and gap is a token step; smallTargets in the audit is 0 at 390 and 768 (at least 24 px, 44 px for primary touch actions).

### C14. Console list on phones and tablets
- Root cause: the table collapses to 174 px stacked cards at 390 with a 330 px toolbar; at 768 it drops columns and wraps.
- Findings: F06, F11, plus ST5 and BL4 pattern for table rows on phones. Resolve together with C04.
- Evidence: `console/shots/390-files.png`, `768-files.png`. Measured: pageScrollY 4,784 at 390; rows 174 px (390) and 83 px (768).
- Severity: P1. Reach 2. Effort M.
- Acceptance criteria: at 390 a file row is at most 64 px; at least 8 files are visible on the first screen; the toolbar before the first file is at most 120 px; at 768 no truncated subtitle and no wrapping panel title or footer.

### C15. Settings: audit log language and page order
- Root cause: the audit log renders raw event names and the user's own page views, and sits first on a page whose second job is deletion.
- Findings: ST1, ST2, ST3, ST5, ST6, ST9. Folds ux-flow overlap "Activity & deletion mixing an audit log with account deletion (split)".
- Evidence: `settings/shots/1440x900-default-full.png`, `390x844-default-full.png`. Measured: pageScrollY 2,528 at 1440, 4,683 at 390; 25 rows of 74 px.
- Severity: P1. Reach 2. Effort S to M.
- Acceptance criteria: event names are written in plain words ("Listed files", "Revoked an agent") and read-only page views are hidden by default; rows are at most 40 px at 1440; the page has two anchors or tabs (Activity, Delete) with deletion reachable in one click; at 390 a log row is at most 72 px; the empty deletion list says "No deletion requests".

### C16. Marketing and docs content polish
- Root cause: section-level layout choices on / and /pricing without a shared grid; /llms.txt has long lines.
- Findings: L-5 (fake approval card differs from the real one), L-6, L-10, L-11, PR-3, PR-4, LL-1 (llms.txt: lines up to 251 chars, duplicate step 3).
- Evidence: `landing/shots/1440x900-scroll3500.png` versus `connect/shots/1440x900-review-new.png`, `1440x900-scroll1500.png`, `pricing/shots/1440x900-main-full.png`.
- Severity: P2. Reach 3. Effort M.
- Acceptance criteria: the landing mock approval card matches the real /connect card; the three feature columns differ by at most 2 lines; plan features are set in the body font, one per line; llms.txt lines are at most 100 characters and step numbers are unique; the "How usage works" columns align.

### C17. Agents and API keys as one table
- Root cause: two tabs for overlapping access objects; neither shows drive, write path or last use. Folds ux-flow proposal 10 (effort L).
- Findings: F13 (15 full-weight "Revoke access" buttons, UUIDs, zero-key agents still revocable), walker F-STORY-065-01 (no Rotate key action).
- Evidence: `console/shots/1440-agents.png`, `1440-apikeys.png`.
- Severity: P2. Reach 3. Effort L.
- Acceptance criteria: one agent table with drives, permissions and last used; "Replace key" in at most 3 steps; revoke is a row-menu action; no UUIDs in the default view.

### C18. Settings: permanent-actions section
- Root cause: the two delete forms have different structures, so inputs and buttons do not align.
- Findings: ST4, ST7, ST8.
- Evidence: `settings/shots/1440x900-default-full.png` (audit geometry unevenRows on settings-delete-grid).
- Severity: P2. Reach 1. Effort S.
- Acceptance criteria: both delete panels have the same structure so their inputs and buttons share a y position at 1440; the drive select starts empty ("Choose a drive"); the permanent-action label is at least 12 px; the details toggle looks like a link, not a disabled field.

---

## Findings not placed

- F07 is in C05, F18 is split between C02 and C04. Every inspector finding (F01 to F20, L-1 to L-11, PR-1 to PR-7, A-1 to A-6, CN-1 to CN-17, SH1 to SH9, ST1 to ST10, BL1 to BL8, LL-1) appears in at least one cluster except A-5 and A-6.
- A-5 (Clerk appearance theme, code-read only, unverified) and A-6 (auth card uses 11% of the 390x844 viewport) are unplaced. A-5 needs a Clerk-configured run before it can be judged; A-6 is a P3 and is covered if C01 adds the cross-links that fill the auth card.
- Environment-only notes (Copy fails in headless Chrome clipboard) are not defects.

## Coverage check against inventory.md

Audited with screenshots at three viewports: /, /pricing, auth fallback card, /connect (all states), /s/<id> (8 states), /console Files, Trash, Agents, API keys, Usage, dialogs, first visit, /console/settings, /console/billing.

Not audited or only partly audited (gaps):
1. Real Clerk sign-in and sign-up forms, Clerk error states and the Clerk appearance theme (A-5). Blocks acceptance checks for C01 items 5 and 6 and C09 until Clerk is configured.
2. Console loading states (too fast to capture) and Trash stuck on "Loading files" (seen only in the ux-flow run).
3. Download completion and file-save in the console and on the share page; the share page expired and "Try again" states; large-file progress.
4. Console states with many drives (more than 2), folders, and 1,000+ files (the fix for C04 has no stress evidence).
5. Billing with checkout enabled, spending-control validation errors, export result and empty usage; settings with an empty or failed audit log, a submitted deletion, and the expanded "When is data actually removed?".
6. Agents revoke and key rotate flows after the action (native `confirm()` dialogs cannot be screenshotted).
7. Dark mode and print are not in the inventory (no evidence that either exists).
8. Keyboard and screen-reader pass was done only for focus rings and tab order on /, /pricing and /connect; the console dialogs were checked for Escape and focus rings only.
9. The 1920x1080 and 375x812 viewports exist only for connect, landing and pricing; console and share have no wide or 375 shots.
10. Second opinions were skipped for all pages in this run, so every finding rests on one inspector.

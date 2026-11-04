# Agent Drive visual audit: consolidated problems

Sources: `pages/{landing,pricing,share,console}/findings.md` (+ `audit.json`, `second-opinion.json`). Finding ids: L = landing, R = pricing, S = share, C = console. Reviewers: own = lead audit, muse = Meta MUSE Wonder, argon = Gemini 4 Argon. Pricing had no argon result.

Excluded (already fixed on `fix/ux-walker-findings` or filed as issues #21-#31): empty filter row, trash notice, Current version, Console author label, CLI host placeholder, Files badge, plurals, TiB units, Choose Developer/Team labels, prefetch, landing metadata sentence (L15/R12 partly), Clerk redirect, share logo.

## Coverage note

- Public pages (landing, pricing, share) were measured at 375, 768, 1440 and 1920 wide. Share was seen without a key fragment only.
- Signed-in pages (Files, API keys, Usage, Billing, Settings) were measured only at 1131x959. No tablet or phone measurement exists for the console, and the Chrome window could not be resized. Console fixes need a 375/768 pass before they are called done.
- Pricing had one external opinion (muse); argon failed. Contrast numbers in this file are computed from the hex values in `globals.css` against the surface they sit on.
- Hover states were not verified (landing L-interaction note). Focus ring contrast (L14) is estimated.

## Ranking method

Score = severity (P1=3, P2=2, P3=1) x reach (pages affected: 1-4) x centrality (1-3, how much of the core flow it touches) / effort (S=1, M=2, L=4). Top 5 are carried forward to proposals; the rest are deferred.

| Rank | Id    | Title                                                            | Severity | Reach            | Effort | Status          |
| ---- | ----- | ---------------------------------------------------------------- | -------- | ---------------- | ------ | --------------- |
| 1    | VC-1  | Muted text and UI colors fail contrast                           | P1       | 4 pages          | S      | carried forward |
| 2    | VC-2  | No type scale: 25 sizes, many under 12px                         | P1       | 4 pages          | M      | carried forward |
| 3    | VC-3  | Settings page has two nested scroll regions (scroll trap)        | P1       | 1 page           | S      | carried forward |
| 4    | VC-4  | Landing CLI snippet is clipped on phones and is weak proof       | P1       | landing          | S      | carried forward |
| 5    | VC-5  | Pricing emphasis and allowance wording contradict each other     | P1       | pricing          | S-M    | carried forward |
| 6    | VC-6  | Share link error page is a dead end                              | P1       | share            | M      | deferred        |
| 7    | VC-7  | Landing hero leaves half the screen empty; no docs/trust links   | P1/P2    | landing, pricing | M      | deferred        |
| 8    | VC-8  | Interactive targets under 24px (44px touch)                      | P2       | 3 pages          | S      | deferred        |
| 9    | VC-9  | Page frames differ between pages (width, h1, back link, nav)     | P2       | 4 pages          | M      | deferred        |
| 10   | VC-10 | Display type details (letter-spacing, widows, heading alignment) | P2       | 3 pages          | S      | deferred        |
| 11   | VC-11 | Spacing scale, list styling, card rhythm                         | P3       | all              | M      | deferred        |

Note on rank 5 vs 6: share S1 was rated P0 by two external reviewers. It is ranked below pricing because the real fix is partly outside the page (the sender resends the link) and the page is reached rarely. Revisit if share links become a main flow.

---

## VC-1 Muted text and UI colors fail contrast (carried forward)

- **Root cause:** Muted colors are hard-coded hex values per selector (about 20 greys/greens) instead of a small set of tokens. `--muted` is `#707a71` (4.18:1 on the `#f7f8f4` page background), and many selectors use lighter values (`#c4cbbf`, `#99a08f`, `#8c9583`, `#808973`, `#8f9c80`, `#acb4a8`).
- **Findings covered:** C-02, L6, R8, S5, L14 (focus ring), plus the footer 2.91:1 noted in L6/R8.
- **Found by:** C-02 own; L6 own/muse/argon; R8 own/muse; S5 own/muse; L14 own.
- **Surfaces:** every page. Console `.breadcrumb` (1.56), `.cell-subtext` (2.70), `.file-icon` (2.76), `.encrypted-label` (2.98), `th` (3.05), drive-id `code` (3.04), `.badge` (3.24), `.eyebrow` (4.02), `.banner.info` (4.27); landing/pricing/share body 4.18-4.46, footer 2.91.
- **Evidence:** `pages/console/findings.md` Measurements; `pages/landing/audit.json`, `pages/pricing/audit.json`, `pages/share/audit.json` (lowContrast lists); `pages/landing/shots/1440x900-default-2.png`; `pages/console/shots/02-console-files.jpg`.
- **Severity:** P1. **Reach:** all 4 surfaces. **Effort:** S (token swap plus about 20 selector edits).
- **Acceptance criteria:**
  1. Every text node has contrast >= 4.5:1 against its actual background, except disabled controls. Measured with the layout audit lowContrast list: 0 entries on landing, pricing, share, Files, Billing, Settings.
  2. Non-text UI (focus ring, input borders that carry meaning, icons) >= 3:1.
  3. No hex color literal for text remains in `globals.css`, `pricing.css`, `billing.css`, `settings.css` outside the `:root` token block.
  4. Breadcrumb separators, if kept as text, are >= 3:1 (decorative) or become CSS borders.

## VC-2 No type scale (carried forward)

- **Root cause:** `font-size` is set per selector in rem values with no tokens. About 25 distinct values exist (0.48rem-6rem); 11 render on the Files screen and 26 text nodes are 10px or smaller.
- **Findings covered:** C-01, L10, R7 (type part).
- **Found by:** C-01 own; L10 own; R7 own.
- **Surfaces:** console (worst), landing (9 sizes), pricing (12 sizes), share.
- **Evidence:** `pages/console/findings.md` (th 0.54rem, `.cell-subtext` 0.6rem, `.badge` 0.6rem, `.encrypted-label` 0.55rem); `pages/pricing/audit.json` type.sizes; `pages/landing/audit.json`; `pages/console/shots/1131x959-files.jpg`.
- **Severity:** P1. **Reach:** all. **Effort:** M (every `font-size` declaration is touched, about 80 edits in globals.css plus 3 page files).
- **Acceptance criteria:**
  1. No rendered text below 12px on console surfaces (measured by computed style across Files, API keys, Usage, Billing, Settings).
  2. No rendered text below 11px on landing, pricing and share, except none (target 12px as well).
  3. At most 6 distinct computed font sizes on any single screen at 1131x959 and at 1440x900.
  4. Every `font-size` in the four CSS files is `var(--fs-*)` or `clamp()` built from tokens; token count <= 8.
  5. Table rows stay <= 56px tall on Files at 1131 wide (no density regression beyond one row of height per 8 rows).

## VC-3 Settings page has nested scroll regions (carried forward)

- **Root cause:** `.settings-page .table-scroll` sets `max-height: 440px; overflow: auto` inside a page that also scrolls. The audit table fills the window under the wheel, so the page cannot be scrolled with the cursor over it, and the "Delete your data" section sits below it (top at 1036px).
- **Findings covered:** C-04.
- **Found by:** own (observed with 15 wheel ticks).
- **Surfaces:** `/console/settings` (Activity & deletion).
- **Evidence:** `pages/console/shots/1131x959-settings-scroll-trap.jpg`, `pages/console/shots/10-settings-audit.jpg`; `apps/web/app/(app)/console/settings/settings.css` lines 18-21.
- **Severity:** P1 (L3, I7: a destructive/key section is hard to reach). **Reach:** 1 page. **Effort:** S.
- **Acceptance criteria:**
  1. The Settings page has a single scroll owner: wheel over any element, including the audit table, scrolls the same container, or the table does not scroll internally.
  2. "Delete your data" is reachable by wheel, keyboard (Tab/PageDown) and touch with the pointer over the audit log.
  3. With 10 events and with 200 loaded events, page height growth is bounded by a documented cap (page size 25 rows, then "Load older events").
  4. Test: Playwright wheel-scroll over the table changes `document.scrollingElement.scrollTop`.

## VC-4 Landing CLI snippet clipped on phones (carried forward)

- **Root cause:** `.terminal-preview code` is `white-space: nowrap` inside a `overflow-x: auto` box with no scroll hint, not focusable, and no copy button. The single command is the page's only product evidence and has no output.
- **Findings covered:** L2, L8, and the mobile CTA width part of L12.
- **Found by:** L2 own/muse/argon; L8 own/muse/argon; L12 own/muse/argon.
- **Surfaces:** landing at 375 (scrollWidth 407 vs 327), also visible at 768.
- **Evidence:** `pages/landing/shots/375x812-default-1.png`, `pages/landing/shots/1440x900-default-1.png`; `apps/web/app/globals.css` `.terminal-preview` (line 243) and `@media` rule at line 1157.
- **Severity:** P1. **Reach:** landing. **Effort:** S.
- **Acceptance criteria:**
  1. At 375px the full CLI command is visible with no horizontal scroll inside the snippet and no horizontal page scroll.
  2. The snippet shows the command and an output line (what the agent gets back).
  3. A copy control (>= 44px target on touch) copies the exact command; it has an accessible name and a visible "Copied" state.
  4. Primary and secondary hero CTAs are equal width and >= 44px tall at 375.

## VC-5 Pricing emphasis and allowance wording (carried forward)

- **Root cause:** Highlight (green border and tint) is on Developer, but the only filled button is on Free; the highlight has no label. The cards promise "monthly downloads included" while the overage table says "Not charged", so the allowance reads as a cap and a perk at once. Fine print that limits usage sits below the fold.
- **Findings covered:** R1, R2, R3 (repeated bullet), R6, R10.
- **Found by:** R1 own/muse; R2 muse/own; R3 muse/own; R6 own/muse; R10 muse/own.
- **Surfaces:** `/pricing`.
- **Evidence:** `pages/pricing/shots/1440x900-default-1.png`, `-2.png`, `375x812-default-3.png`; `apps/web/app/(app)/pricing/pricing.css`.
- **Severity:** P1. **Reach:** pricing. **Effort:** S-M.
- **Acceptance criteria:**
  1. Exactly one filled primary button per viewport row of plan cards, and it is on the highlighted plan; the highlighted plan carries a text label ("Most teams start here" or similar, text not color alone).
  2. The download allowance is described once, with the word "cap" or "free" resolved: card bullet and overage row use the same term and the same number.
  3. The bullet that is identical in all three cards is removed from the cards and stated once.
  4. Storage limits (versions and trash count, 5 GiB upload cap) are visible without scrolling past the plan cards at 1440x900 as a one-line note, or are inside the card.
  5. Prices show no trailing ".00" for whole-dollar amounts.

---

## Deferred clusters

### VC-6 Share link error page is a dead end

Root cause: the error card has no action and the copy uses jargon. Findings: S1, S2, S3, S4, S6, S7, S8 (found by own/muse/argon). Surface: `/s/{id}` without key. Evidence: `pages/share/shots/1440x900-default-1.png`, `375x812-default-1.png`. P1, effort M. Criteria: a recipient can paste a full link; copy names what is missing in plain words; headline has no single-word widow; error icon is not a success-style padlock.

### VC-7 Landing hero composition and missing trust links

Root cause: one-column hero with no companion visual, no Docs/GitHub/Security links, redundant account CTAs, nav styled as buttons. Findings: L1, L3, L4, L7, L9, L13 (own/muse/argon). Evidence: `pages/landing/shots/1440x900-default-1.png`, `1920x1080-default-1.png`, `-2.png`. P1/P2, effort M. Criteria: hero fill >= 70% at 1440; docs and source links present in header or footer; one primary account CTA.

### VC-8 Interactive targets under 24px

Findings: C-03 (row actions 20px tall), L12 (40px buttons), R13 (footer link 69x12px). Evidence: console audit smallTargets, `pages/pricing/audit.json`. P2, effort S. Criteria: all targets >= 24px on desktop and >= 44px on touch viewports.

### VC-9 Page frames differ

Findings: C-05 (Billing/Settings separate shell, 48px h1 vs 32px), R5 (1128 vs 1084 container, logo shifts 22px), R4 (Quickstart link in a personal repo, no current-page state), R9 (heading baselines). Evidence: `pages/console/shots/07-billing-top.jpg` vs `02-console-files.jpg`. P2, effort M. Criteria: one container width on public pages; Billing and Settings render inside the console shell with one h1 size.

### VC-10 Display type details

Findings: L5 (letter-spacing -0.065em), S2 (widow), L11 (pillar headings misalign at 768), S6. Evidence: `pages/landing/shots/1440x900-default-1.png`. P2, effort S. Criteria: h1 tracking >= -0.03em; headings use `text-wrap: balance`.

### VC-11 Spacing scale, list styling, card rhythm

Findings: C-06 (15 off-scale values), R7 (spacing part), R14 (bullets), R11 (tablet card wrap), L12. P3, effort M. Criteria: spacing values come from a 4px-based token set.

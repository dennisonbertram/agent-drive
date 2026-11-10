# K2 proposal C: Follow established mobile conventions

Status: proposal, not implemented. Cluster K2 in `docs/ux-visual/problems-home-te.md` (findings H-02, H-07, H-08, H-09, H-10, H-15, H-16, H-19).

## Summary

Apply patterns that well-known product sites already use on phones: show parallel examples one at a time behind a segmented control, keep code on one line with horizontal scroll, present records as label and value pairs, let the reader pick one plan to view, present navigation lists as full-width rows, and collapse the footer link groups. Every message stays on the page. Content that sits behind a tab is still in the HTML, and desktop shows everything as it does today. **The page measures about 6,600 px at 390 (7.9 screens), the shortest of the three proposals.**

## The conventions and where they come from

These examples are from my knowledge of these sites. I did not re-check the live sites in this session, so confirm them before citing them to anyone else.

| Convention                                                                                | Examples                                                                                             | Applied here to                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Tabs or a segmented control for parallel examples of the same idea, one visible at a time | Stripe and Vercel/Next.js documentation switch code samples by language or package manager with tabs | Problem scenarios, relay steps, game and protein use cases |
| Code stays on one line and scrolls sideways; it never wraps inside a path or flag         | Stripe docs, GitHub, Vercel docs                                                                     | Relay and features commands                                |
| Records shown as a label and value list, in a monospace spec-sheet style                  | Teenage Engineering product "tech specs" pages                                                       | Drive activity log                                         |
| Pick the item to view instead of stacking every option                                    | Apple's "compare models" page uses pickers to choose which models to show on a phone                 | Pricing (Free, Developer, Team)                            |
| Footer link groups collapse into disclosure rows on phones                                | Apple.com footer                                                                                     | Site footer on the homepage                                |
| Navigation lists as full-width rows with a trailing arrow                                 | iOS settings lists, which many mobile web pages copy                                                 | Compare links                                              |

## Changes

| #   | Section           | Before (390)                                                                                                      | After (390)                                                                                                                                                                                                                              | Files and selectors                                                                                                                                                                                                                            |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All               | 84 px section padding, h2 34 px, 184 px band before the footer                                                    | 48 px padding, h2 32 px, final padding 64 px, footer margin 0                                                                                                                                                                            | `landing.css` 760 block                                                                                                                                                                                                                        |
| 2   | Problem           | Three scenarios, each three stacked boxes (1,275 px)                                                              | A three-part segmented control ("Sandbox ends", "Machine changes", "Platform switches", 44 px tall) above one horizontal three-box strip (445 px). The separate scenario heading is dropped because the selected segment names it        | `page.tsx` `#problem`: a small client `Tabs` component (`role="tablist"`, arrow-key support); `landing.css`: `.seg`, `.panes`; the strip uses the compact horizontal cells from proposal A. At 761 px and wider all three strips show as today |
| 3   | Relay             | Three bullets (two restate the next sections); three stacked steps with wrapping commands (1,916 px with the log) | Only the "Research" bullet; a segmented control "1 / Sales agent", "2 / Coding agent", "3 / Review agent" above one dark code panel per step (one line per command, horizontal scroll); step 3 shows the agent's message instead of code | `page.tsx` `#relay` (`ul.l-also`, same `Tabs` component); `landing.css` `.relayseg`, `code.cp`                                                                                                                                                 |
| 4   | Activity log      | Four unlabelled lines per entry                                                                                   | Each entry is a `<dl>` with FILE, BY, FROM and WHEN labels in 11 px mono on the left                                                                                                                                                     | `page.tsx` `Log` (replace `role="img"` with real `<dl>` markup on phones, or for all widths); `landing.css` `.le`                                                                                                                              |
| 5   | Pills             | Four outline pills that look like buttons                                                                         | Removed. The two facts not stated elsewhere ("Many agents, one drive." "No silent overwrites.") join the log caption. The other two are already in the caption and the FAQ                                                               | `page.tsx` `ul.l-solve` deleted, `caption` prop extended                                                                                                                                                                                       |
| 6   | Games and protein | Two full sections (1,318 px)                                                                                      | A two-part segmented control ("Game development", "Research data") shows one section with its figure at full width (686 px). Desktop shows both sections as today                                                                        | `page.tsx`: wrap both sections in one `Tabs`; `landing.css`: `.ucseg` (`@media (min-width: 761px) { .ucseg .seg { display: none } .pane { display: block } }`)                                                                                 |
| 7   | Console           | Full phone image (780 px); at 768 the desktop image shows 7 px text                                               | Phone image cropped to its top 610 px on phones; phone image at up to 520 px wide between 761 and 1000 px                                                                                                                                | Same as proposal B: `page.tsx` `<source media="(max-width: 1000px)">`; `.l-shot img` crop; `.l-shot { max-width: 520px }`                                                                                                                      |
| 8   | Features          | Heading "Encrypted. Sharable. Works anywhere." above tags with the same three words                               | Tag "Features"; three stacked items headed "Encrypted.", "Sharable.", "Works anywhere."; commands on one scrolling line (697 px)                                                                                                         | `page.tsx` `#features`; `landing.css` `.fc .fh`, `code.cp`                                                                                                                                                                                     |
| 9   | Compare           | Three stacked columns; two link styles                                                                            | Four full-width rows with arrows (each row is one link); "All comparisons" is the last row (500 px)                                                                                                                                      | `page.tsx` `#compare`; `landing.css` `.cmp`, `.cmp-row`                                                                                                                                                                                        |
| 10  | Pricing           | Three tall blocks (1,313 px)                                                                                      | A segmented control "Free $0 / Developer $20 / Team $200" shows one plan's price, four limits and its action (617 px). Free is selected first. Full numbers are kept, for example "1,000,000 API operations a month"                     | `page.tsx` `#pricing` (same `Tabs`); `landing.css` `.planseg`                                                                                                                                                                                  |
| 11  | Footer            | Tagline, third "Create a free account", three link columns stacked (1,168 px)                                     | Brand and GitHub icon in one row; "Product" and "Resources" as collapsible rows 52 px tall (each link 44 px when open); Compare group, tagline and CTA dropped on the homepage (252 px)                                                  | `site-footer.tsx`: `compact` prop and `<details>` groups below 641 px; `site-footer.css`: `.sf-acc`                                                                                                                                            |

## Estimated height at 390x844

Measured the same way as proposals A and B: static mocks with the real CSS files, real copy and real console images, placeholders of the same size for the figures, and Chromium at 390x844 through Playwright. The unchanged baseline mock measures 11,560 px against the live page's 11,555 px. Tabbed sections are measured with the first tab selected.

| Section         | Now (measured, live)      | C (mock)                |
| --------------- | ------------------------- | ----------------------- |
| Header          | 61                        | 61                      |
| Hero            | 909                       | 909                     |
| Problem         | 1,275                     | 445                     |
| Relay           | 1,916                     | 980                     |
| Games + protein | 1,318                     | 686                     |
| Console         | 780                       | 553                     |
| Features        | 862                       | 697                     |
| Compare         | 779                       | 500                     |
| FAQ             | 565                       | 527                     |
| Pricing         | 1,313                     | 617                     |
| Final CTA       | 545                       | 400                     |
| Footer          | 1,168                     | 252                     |
| **Total**       | **11,555 (13.7 screens)** | **6,626 (7.9 screens)** |

## Mocks (390x844)

Scratchpad folder: `<scratchpad>/uxv-home/mocks/`

- Problem segmented control: `.../mocks/K2-C-problem.png` (before: `.../shots/390x844-problem.png`)
- Relay tabs, code panel and labelled log: `.../mocks/K2-C-relay.png`, `.../mocks/K2-C-relay-2.png` (before: `.../shots/390x844-relay.png`, `.../shots/390x844-log.png`)
- Use-case tabs: `.../mocks/K2-C-usecases.png` (before: `.../shots/390x844-games.png`)
- Features: `.../mocks/K2-C-features.png` (before: `.../shots/390x844-features.png`)
- Compare rows: `.../mocks/K2-C-compare.png` (before: `.../shots/390x844-compare.png`)
- Pricing plan picker: `.../mocks/K2-C-pricing.png` (before: `.../shots/390x844-pricing.png`)
- Final CTA and collapsed footer: `.../mocks/K2-C-final-footer.png` (before: `.../shots/390x844-final.png`, `.../shots/390x844-footer.png`)
- The 768 relay and console fixes are the same as in A: `.../mocks/K2-A-768-relay.png`, `.../mocks/K2-A-768-console.png`
- Full-page mock: `.../mocks/K2-C-full.html`. The mocks use CSS radio buttons to switch tabs. Production should use a real tabs component (see Risks).

## Effort

About two and a half to three days. One small client `Tabs` component (tablist semantics, arrow keys, 44 px segments) used four times, a `compact` footer with disclosure groups, the markup changes listed above, about 170 lines of CSS, page tests for the tabs (keyboard, default tab, all panels present in the HTML), and a browser check at all four widths.

## Risks

- **Content behind tabs gets fewer views.** Readers see the first problem scenario, the first relay step, the game use case and the Free plan unless they tap. The protein section, with the owner's Fable 6.2 message, moves behind the "Research data" tab. If that message must be seen without a tap, make "Research data" the default tab or keep the two use cases stacked. Keeping them stacked adds about 650 px, giving about 7,280 px, which still meets the target.
- Four tab sets on one page are a new interaction pattern for this site. They need careful accessibility work: `role="tablist"`, `aria-selected`, arrow-key navigation and visible focus. The CSS radio approach in the mocks is only a stand-in.
- Hidden tab panels must stay in the HTML (`hidden` attribute, not removed), so search engines and the Markdown twin (`homeMarkdown`) still carry the copy. `homeMarkdown` does not read the page markup, so it is not affected.
- Collapsed footer groups make the links one tap further away. That is the usual trade-off, and the links are still present on every other page's full footer. `<details>` closed by default would also hide the links on desktop, so desktop needs either a different markup branch or the `::details-content` style, which needs a browser support check.
- The console crop drops the image's footer line about encryption and visible metadata, as in B.
- The relay code panel turns dark (like the hero prompt panel) to read as one object with tabs. That adds a third dark panel to the page (H-24 notes mixed panel styles). It can stay grey.

## Acceptance criteria (K2)

| Criterion                                    | Met?                            | How                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page ≤ 9 screens at 390 (≤ 7,600 px)         | Yes                             | 6,626 px (7.9 screens) in the mock; about 7,280 px if the use cases stay stacked                                                                                                                                                                                                                                                         |
| Activity log rows labelled on phones         | Yes                             | FILE / BY / FROM / WHEN on every entry (change 4)                                                                                                                                                                                                                                                                                        |
| Relay stacks below 1000 px                   | Yes                             | One column at 1000 px and below; tabs only at 760 px and below                                                                                                                                                                                                                                                                           |
| Console image readable (≥ 11 px text) at 768 | Yes                             | Phone image at 520 px, text about 17 px (`K2-A-768-console.png`)                                                                                                                                                                                                                                                                         |
| Each fact stated once                        | Yes, except one item outside K2 | Removed: two relay bullets, the pills (the two unique facts move into the caption), the features heading duplicated by tags, the footer tagline, CTA and Compare group. Left for K3: "Free to start." / "Start free." / Free plan naming (H-05). The final CTA repeats the hero's agent prompt on purpose, as the owner asked to keep it |

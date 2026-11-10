# K2 proposal B: Restructure the phone patterns

Status: proposal, not implemented. Cluster K2 in `docs/ux-visual/problems-home-te.md` (findings H-02, H-07, H-08, H-09, H-10, H-15, H-16, H-19).

## Summary

Keep every section and message, but give each multi-column section a layout designed for a phone instead of stacking the desktop columns. Parallel items become horizontal swipe rows (problem, use cases, features). Lists of facts become tables (activity log, pricing). Content that repeats nearby content is removed. Desktop and tablet keep their current layouts, except that the relay stacks and the console uses the phone image below 1000 px. **The page measures about 7,000 px at 390 (8.3 screens), which meets the 7,600 px target.**

## How the heights were measured

Same method as proposal A. I built static mocks with the real CSS files, real copy and real console images, used placeholders of the same size for the three figures, and measured them in Chromium at 390x844 with Playwright. The unchanged baseline mock measures 11,560 px against the live page's 11,555 px, so the numbers are close estimates.

## Changes

| #   | Section           | Before (390)                                                                                                        | After (390)                                                                                                                                                                                                                        | Files and selectors                                                                                                                                                                                                                                                     |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All               | 84 px section padding, h2 34 px, 184 px band before the footer                                                      | 48 px padding, h2 32 px, final padding 64 px, footer margin 0                                                                                                                                                                      | `landing.css` 760 block: `.landing section`, `.landing h2`, `.landing .l-final`, `.landing .site-footer`                                                                                                                                                                |
| 2   | Problem           | Three scenarios, each three stacked boxes (1,275 px)                                                                | A swipe row of three cards, 84 percent wide, so the next card shows at the edge, with a "1 of 3 · swipe" note. Each card keeps its vertical three-box strip (582 px)                                                               | `page.tsx`: `.l-three` becomes a `.snap` wrapper of `.snap-card`s (`tabindex="0"`, `aria-label`); `landing.css`: `.snap`, `.snap-card`, `.snap-hint` (`scroll-snap-type: x mandatory`). At 761 px and wider the wrapper keeps the current `.l-three` grid               |
| 3   | Relay bullets     | Three bullets; two restate the next two sections ("See how")                                                        | Only "Research: build on the previous round's data sets each round."                                                                                                                                                               | `page.tsx` `ul.l-also`                                                                                                                                                                                                                                                  |
| 4   | Relay steps       | Three stacked columns with wrapping commands                                                                        | A numbered vertical rail (dot per step), one line per command with horizontal scroll                                                                                                                                               | `page.tsx`: `div.l-line3.relay` becomes `ol.rail`; `landing.css`: `.rail`, `.rail li::before`, `code.cp` (`white-space: pre; overflow-x: auto`)                                                                                                                         |
| 5   | Activity log      | Four unlabelled lines per entry; `role="img"`                                                                       | A real `<table>`: one header row "Saved by / From / When", then for each entry the path on its own row (`<th scope="row" colspan="3">`) and the three values aligned under the headers                                             | `page.tsx` `Log` (table at all widths; at 761 px and wider it can stay four columns); `landing.css`: `.lt`; also `.landing .lt, .landing .pt { min-width: 0 }` and `th { white-space: normal }` to cancel the global `table { min-width: 620px }` rule in `globals.css` |
| 6   | Pills             | Four rounded outlines that look like buttons; two repeat the caption and the FAQ                                    | Two cells in a hairline 2-column grid: "Many agents, one drive", "No silent overwrites" (the only two not stated elsewhere)                                                                                                        | `page.tsx` `ul.l-solve`; `landing.css` `.l-solve.grid4`                                                                                                                                                                                                                 |
| 7   | Games and protein | Two full sections (1,318 px)                                                                                        | One swipe row of two 88 percent cards with a "2 use cases · swipe →" note above (657 px). Desktop is unchanged                                                                                                                     | `page.tsx`: wrap `#games` and `#protein` in `div.l-uc > div.uc-row`; `landing.css`: `.uc-row` (flex, `scroll-snap`), `.uc-row > section { flex: 0 0 88% }`                                                                                                              |
| 8   | Console           | Full phone image (780 px). Desktop image at 768 shows 7 px text                                                     | Phone image cropped to its top 610 of 994 px (header, toolbar, four rows) on phones; phone image up to 1000 px wide, capped at 520 px between 761 and 1000                                                                         | `page.tsx` `<source media="(max-width: 1000px)">`; `landing.css` `.l-shot img { aspect-ratio: 716/610; object-fit: cover; object-position: top }` (760 block) and `.l-shot { max-width: 520px }` (761 to 1000)                                                          |
| 9   | Features          | Heading "Encrypted. Sharable. Works anywhere." above three tags with the same words; three stacked columns (862 px) | The section tag "Features" stays; the three words become the card headings ("Encrypted.", "Sharable.", "Works anywhere."); the cards form a swipe row (303 px)                                                                     | `page.tsx` `#features` (drop the h2 and the per-item `.l-tag`, add `h3.fh`); `landing.css` `.fb`                                                                                                                                                                        |
| 10  | Compare           | Three stacked columns; link text in a different style from "All comparisons"                                        | Four full-width rows with an arrow, each row one link (tag, summary). "All comparisons" is the last row                                                                                                                            | `page.tsx` `#compare`; `landing.css` `.cmp`, `.cmp-row`                                                                                                                                                                                                                 |
| 11  | Pricing           | Three tall blocks (1,313 px); only action is a small outline button                                                 | A comparison table: plans as columns (Free, Developer, Team; "Coming soon" under the paid names), rows for price, drives, stored, downloads per month, API operations per month; one full-width "Start free" button below (681 px) | `page.tsx` `#pricing` (table built from `PLANS` and `allowance()`; API operations shown as 1M / 10M / 100M via `Intl.NumberFormat` compact notation); `landing.css` `.pt`, `.pt-go`                                                                                     |
| 12  | Footer            | Tagline repeating the hero, third "Create a free account", three link columns in one column (1,168 px)              | Brand and GitHub icon in one row; Product and Resources side by side; Privacy and Terms move into the bottom bar; the Compare column and the tagline are removed on the homepage (539 px)                                          | `site-footer.tsx`: a `compact` prop (homepage only) that drops the tagline, CTA and Compare column and moves the legal links; `site-footer.css`: `.sf-brand.row`, `.sf-bottom .legal`, link rows 44 px tall                                                             |

## Estimated height at 390x844

| Section         | Now (measured, live)      | B (mock)                |
| --------------- | ------------------------- | ----------------------- |
| Header          | 61                        | 61                      |
| Hero            | 909                       | 909                     |
| Problem         | 1,275                     | 582                     |
| Relay           | 1,916                     | 1,274                   |
| Games + protein | 1,318                     | 657                     |
| Console         | 780                       | 553                     |
| Features        | 862                       | 303                     |
| Compare         | 779                       | 500                     |
| FAQ             | 565                       | 527                     |
| Pricing         | 1,313                     | 681                     |
| Final CTA       | 545                       | 400                     |
| Footer          | 1,168                     | 539                     |
| **Total**       | **11,555 (13.7 screens)** | **6,986 (8.3 screens)** |

## Mocks (390x844)

Scratchpad folder: `<scratchpad>/uxv-home/mocks/`

- Problem swipe row: `.../mocks/K2-B-problem.png` (before: `.../shots/390x844-problem.png`)
- Relay rail, then log table and the two remaining facts: `.../mocks/K2-B-relay.png`, `.../mocks/K2-B-relay-2.png` (before: `.../shots/390x844-relay.png`, `.../shots/390x844-log.png`)
- Use-case swipe row: `.../mocks/K2-B-usecases.png` (before: `.../shots/390x844-games.png`, `.../shots/390x844-protein.png`)
- Features cards and compare rows: `.../mocks/K2-B-features-compare.png` (before: `.../shots/390x844-features.png`, `.../shots/390x844-compare.png`)
- Pricing table: `.../mocks/K2-B-pricing.png` (before: `.../shots/390x844-pricing.png`)
- Final CTA and footer: `.../mocks/K2-B-final-footer.png` (before: `.../shots/390x844-final.png`, `.../shots/390x844-footer.png`)
- The 768 relay and console fixes are the same as in A: `.../mocks/K2-A-768-relay.png`, `.../mocks/K2-A-768-console.png`
- Full-page mock: `.../mocks/K2-B-full.html`

## Effort

About two days. Markup changes in `page.tsx` (problem, relay, log, use-case wrapper, features, compare, pricing), a `compact` prop on `SiteFooter`, about 150 lines of CSS, updated page tests that query the log, pricing or footer, and a browser check at all four widths, including swiping with touch emulation.

## Risks

- **Swipe rows hide content.** Only one problem scenario, one use case and one feature card is fully visible at a time. The peeking next card and the "swipe" note are the only cues. Readers who do not swipe will miss the protein section, which carries the owner's Fable 6.2 message. This is the main cost of B.
- **Figures in narrower cards.** In the use-case row each figure is about 330 px wide at 390, and about 300 px at 360. H-14 found that the protein and hero figures already crowd at 320 px. K1 must fix that before B ships, or the use-case cards must be full width.
- Two animated figures sit side by side in one scroll row. Check that the off-screen card's figure pauses, as the figures already do when off-screen vertically.
- The features h2 is removed, but its three words stay as the card headings, so no copy is lost. The owner should confirm this.
- Pricing shows API operations as "1M / 10M / 100M". The full numbers stay on `/pricing`. When paid checkout is enabled (`paid` is true), the "Coming soon" notes must become "Choose plan" links, and the table needs that state designed.
- The global `table { min-width: 620px }` and `th { white-space: nowrap }` rules in `globals.css` break both new tables unless they are overridden under `.landing`.
- The console crop drops the image's footer line ("File contents encrypted · Paths and metadata visible to the service"). The lede already says files are "decrypted only in your browser", but the metadata half of that line is lost on phones.
- The `compact` footer prop changes a shared component. Other pages must keep the full footer.

## Acceptance criteria (K2)

| Criterion                                    | Met?                            | How                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page ≤ 9 screens at 390 (≤ 7,600 px)         | Yes                             | 6,986 px (8.3 screens) in the mock                                                                                                                                                                                                                                                   |
| Activity log rows labelled on phones         | Yes                             | Column headers "Saved by / From / When" stay visible above aligned values (change 5); it is a real table for screen readers                                                                                                                                                          |
| Relay stacks below 1000 px                   | Yes                             | `.l-line3.relay` is one column at 1000 px and below (same output as `K2-A-768-relay.png`)                                                                                                                                                                                            |
| Console image readable (≥ 11 px text) at 768 | Yes                             | Phone image at 520 px, text about 17 px (`K2-A-768-console.png`)                                                                                                                                                                                                                     |
| Each fact stated once                        | Yes, except one item outside K2 | Removed: two relay bullets, two pills, features heading duplicated by tags, footer tagline, CTA and Compare column. Left for K3: "Free to start." / "Start free." / Free plan naming (H-05). The final CTA repeats the hero's agent prompt on purpose, as the owner asked to keep it |

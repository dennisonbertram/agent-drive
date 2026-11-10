# K2 proposal A: Minimal (CSS and breakpoints only)

Status: proposal, not implemented. Cluster K2 in `docs/ux-visual/problems-home-te.md` (findings H-02, H-07, H-08, H-09, H-10, H-15, H-16, H-19).

## Summary

Keep every element and its markup. Change only `landing.css` and one breakpoint attribute in `page.tsx`, so that phone layouts are compact versions of the desktop ones. This fixes the relay at 768, the console image at 768, the unlabelled log rows, the pill affordance and the dead band before the footer. **The page still measures about 8,700 px at 390 (10.3 screens), so A misses the K2 height target of 7,600 px.** CSS alone cannot shorten the two use-case sections, the console image or the features without changing structure.

## How the heights were measured

I rebuilt the homepage as static HTML using the real `globals.css`, `landing.css` and `site-footer.css`, the real copy and the real console images. The three animated figures are placeholders of the same size (520:420 aspect ratio, full column width). I measured each page in Chromium at a 390x844 viewport with Playwright. (The headless Chrome command line clamps the window to 500 px wide, so it could not produce a true 390 px layout.)

The unchanged baseline mock measures **11,560 px**. The audit measured the live page at **11,555 px**, and the section heights match within 5 px (problem 1,275, relay 1,916, pricing 1,313). The mock numbers below are therefore close estimates of the real page.

## Changes

| #   | Change                                                  | Before                                                                                                           | After                                                                                                                                                      | Selector (file)                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shorter section rhythm on phones                        | 84 px top padding, h2 34 px, final h2 42 px                                                                      | 56 px padding, h2 32 px, final h2 32 px                                                                                                                    | `.landing section`, `.landing h2`, `.landing .l-final h2` in the `max-width: 760px` block (`landing.css`)                                                                                                                           |
| 2   | Problem strips stay horizontal on phones                | Each scenario is three stacked boxes with vertical arrows (1,275 px)                                             | Three small boxes in one row with short horizontal arrows (685 px)                                                                                         | `.l-strip`, `.l-cell`, `.l-cell small`, `.l-arr`, `.l-arr::after` (remove the column rules in the 760 block)                                                                                                                        |
| 3   | Relay stacks below 1000 px                              | Three 207 px columns at 768; commands break inside paths                                                         | One column at 768 and below, hairline between steps                                                                                                        | new `@media (max-width: 1000px) { .l-line3.relay ... }`                                                                                                                                                                             |
| 4   | Commands scroll instead of wrapping                     | Commands wrap every 20 characters                                                                                | One line per command, horizontal scroll inside the grey block                                                                                              | `.l-line3 code { white-space: pre; overflow-x: auto; overflow-wrap: normal }` (760 block)                                                                                                                                           |
| 5   | Labelled log rows on phones                             | Four unlabelled lines per entry                                                                                  | Line 1 is the path; line 2 reads "by sales-agent from cloud-worker at Mon 09:12"                                                                           | `.lr` becomes `flex-wrap`; `.lr span:nth-child(2..4)::before { content: 'by ' / 'from ' / 'at ' }`                                                                                                                                  |
| 6   | Pills become a plain list; duplicates hidden            | Four rounded outlines that look like buttons                                                                     | Two square-bullet items with no border: "Many agents, one drive", "No silent overwrites"                                                                   | `.l-solve`, `.l-solve li`, `.l-solve li:nth-child(2), :nth-child(3) { display: none }`                                                                                                                                              |
| 7   | Remove relay bullets that restate the next two sections | "Game development: ... See how." and "Protein research: ... See how." sit directly above those sections          | Only "Research: ..." remains                                                                                                                               | `.l-also li:nth-child(n + 2) { display: none }` (all widths)                                                                                                                                                                        |
| 8   | Console image readable at 768                           | Desktop image at 704 px wide, table text about 7 px                                                              | Phone image up to 1000 px, capped at 520 px wide (text about 17 px)                                                                                        | `page.tsx`: `<source media="(max-width: 1000px)">`; `landing.css`: `@media (min-width: 761px) and (max-width: 1000px) { .l-shot { max-width: 520px } }`                                                                             |
| 9   | Pricing as compact rows                                 | Three 440 px blocks (1,313 px)                                                                                   | Each plan is one row: name, price and action on the left; four limits on the right (771 px)                                                                | `.l-plan`, `.l-plan + .l-plan` as a two-column grid; `.l-plan .pr`, `.l-plan ul`, `.l-plan .l-btn`, `.l-plan .soon`                                                                                                                 |
| 10  | No dead band before the footer                          | 120 px final padding plus a 64 px footer margin (184 px)                                                         | 64 px final padding, 0 margin                                                                                                                              | `.landing .l-final { padding-bottom: 64px }`, `.landing .site-footer { margin-top: 0 }`                                                                                                                                             |
| 11  | Footer on the homepage                                  | Tagline repeating the hero, a third "Create a free account", three link columns stacked in one column (1,168 px) | Brand and GitHub icon in one row; Product and Resources in two columns; Compare column hidden because the compare section links to the same pages (519 px) | Scoped in `landing.css` only (it loads only on `/`): `.landing .sf-tagline`, `.landing .sf-cta`, `.landing .sf-cols nav[aria-label=Compare]`, `.landing .sf-brand`, `.landing .sf-cols`, `.landing .sf-cols a { min-height: 44px }` |

The footer links get 44 px rows so this proposal does not undo K4. That adds height, and it is included in the estimate.

## Estimated height at 390x844

| Section   | Now (measured, live)      | A (mock)                 |
| --------- | ------------------------- | ------------------------ |
| Header    | 61                        | 61                       |
| Hero      | 909                       | 909                      |
| Problem   | 1,275                     | 685                      |
| Relay     | 1,916                     | 1,396                    |
| Games     | 634                       | 602                      |
| Protein   | 684                       | 652                      |
| Console   | 780                       | 747                      |
| Features  | 862                       | 735                      |
| Compare   | 779                       | 685                      |
| FAQ       | 565                       | 535                      |
| Pricing   | 1,313                     | 771                      |
| Final CTA | 545                       | 408                      |
| Footer    | 1,168                     | 519                      |
| **Total** | **11,555 (13.7 screens)** | **8,705 (10.3 screens)** |

## Mocks (390x844 unless noted)

Scratchpad folder: `<scratchpad>/uxv-home/mocks/`

- Problem: `.../mocks/K2-A-problem.png` (before: `.../shots/390x844-problem.png`)
- Relay, first and second screen: `.../mocks/K2-A-relay.png`, `.../mocks/K2-A-relay-2.png` (before: `.../shots/390x844-relay.png`, `.../shots/390x844-log.png`)
- Pricing: `.../mocks/K2-A-pricing.png` (before: `.../shots/390x844-pricing.png`)
- Final CTA and footer: `.../mocks/K2-A-final-footer.png` (before: `.../shots/390x844-final.png`, `.../shots/390x844-footer.png`)
- 768x1024 relay: `.../mocks/K2-A-768-relay.png` (before: `.../shots/768x1024-relay.png`)
- 768x1024 console: `.../mocks/K2-A-768-console.png` (before: `.../shots/768x1024-console.png`)
- Full-page mock used for measuring: `.../mocks/K2-A-full.html`. Generator: `.../mocks/K2-gen.py`, renderer: `.../mocks/K2-render.cjs`.

## Effort

About half a day: roughly 80 lines of CSS in `landing.css`, one attribute in `page.tsx`, and a browser check at the four widths. No component, content or test changes, except any snapshot that asserts the `<source media>` value.

## Risks

- **The height target is missed** (8,705 against 7,600). Reaching it needs the structural changes in B or C.
- Hiding list items with `:nth-child` ties CSS to content order. If someone reorders `l-solve` or `l-also`, the wrong items disappear. Deleting them in `page.tsx` would be safer, but that is a markup change.
- The problem boxes are 106 px wide, so paths such as `/memory/project-notes.md` break inside a word ("proje / ct-notes.md"). They are readable but not clean.
- The CSS labels "by / from / at" are generated content. They help sighted readers. The log container keeps `role="img"` and its full `aria-label`, so screen reader output does not change and is still one long label rather than a table (H-07's accessibility part stays open).
- Hiding the footer Compare column on the homepage only works because `landing.css` loads only on `/`. If the stylesheet is ever shared, the rule would affect other pages.
- Horizontally scrolling code blocks hide the end of each command until the reader swipes. There is no visible scroll hint.

## Acceptance criteria (K2)

| Criterion                                    | Met?   | How                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page ≤ 9 screens at 390 (≤ 7,600 px)         | **No** | 8,705 px (10.3 screens) in the mock                                                                                                                                                                                                                                                               |
| Activity log rows labelled on phones         | Yes    | "by / from / at" prefixes on each row (change 5)                                                                                                                                                                                                                                                  |
| Relay stacks below 1000 px                   | Yes    | Change 3; see `K2-A-768-relay.png`                                                                                                                                                                                                                                                                |
| Console image readable (≥ 11 px text) at 768 | Yes    | Phone image at 520 px wide, text about 17 px (change 8)                                                                                                                                                                                                                                           |
| Each fact stated once                        | Partly | Removed: footer tagline and CTA, footer Compare column, two relay bullets, two pills. Still repeated: the features heading "Encrypted. Sharable. Works anywhere." above tags with the same words (CSS cannot fix this without losing the labels), and "Free" in three places (owned by K3 / H-05) |

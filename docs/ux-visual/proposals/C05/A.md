# C05-A Minimal: scrolling tabs with edge fade and scroll-snap

Mock: `mock-A.html`, `mock-A.png` (375x812). Content (eyebrow) starts at y=191.

## Change

Keep the current two strips (section tabs, drive bays). Make both honest about overflowing:

- Both strips get a CSS `mask-image` edge fade (14px left, 40px right), `scroll-snap-type: x proximity`, `scrollbar-width: none`.
- On load and on tab or drive change, `scrollIntoView({inline:'center', block:'nearest'})` the active tab and the selected bay.
- Drop the bare `$` glyph: the Billing link keeps its full label "Billing & limits" (the `$` span has `display:none` below 760px today only for `.nav-icon`; this one is a bare span, so it renders as text and gets clipped first).
- Hide `.topbar` (breadcrumb duplicates tab and h1) below 760px. The "CLIENT-SIDE ENCRYPTED" label moves into the brand row as a small LED + text if space allows, otherwise is dropped on phone.
- Tab touch height 44px.

## Before / after

Before: brand 56 + tabs 56 + breadcrumb 44 + strip 64 = header ~320px; "$ B..." clipped, selected drive "R..." clipped off right (nav scrollWidth 576 vs 343, bay-strip 662 vs 375).
After: header ~175px, eyebrow at y=191. Active tab and selected drive centered, a faded edge shows more content exists. All 7 labels complete once scrolled; "Activity & deletion" is partially visible at rest.

## Files and selectors

- `apps/web/app/styles/console.css`: `.sidebar nav` (in max-width 760 block, ~664), `.bay-strip` (~183 and ~683), `.nav-item`, `.topbar` (hide at 760).
- `apps/web/app/(app)/console/console.tsx`: `useEffect` on `[tab, selected, drives.length]` calling `scrollIntoView` on `nav [aria-current]` and `.bay[aria-pressed="true"]`; wrap the `$` in the Billing link in `.nav-icon`-style hidden span.
- No new tokens.

## Effort and risk

Small (about 1 hour). Risks: `mask-image` fades the strip even at scroll ends (always faded right edge even when scrolled fully, can hide the last pixels of "Activity & deletion"); fade needs scroll-state to be perfect (JS class or scroll-driven animation); seven tabs in one row still needs scrolling, so reaching Billing/Activity takes a swipe the user may not know to make. Hiding topbar loses the encrypted label on phones.

## Acceptance

- All 7 reachable and labelled: yes by swiping; no bare `$`. Weakest of the three on discoverability.
- Selected drive fully visible: yes after scrollIntoView (centered; name still ellipsised at 120px unless `.bay` min-width is raised to 176).
- No clipped labels: partly. Fade intentionally cuts labels at edges while scrolled; at rest "Activity" is cut mid-word.
- Content at or above y=260: yes (191).

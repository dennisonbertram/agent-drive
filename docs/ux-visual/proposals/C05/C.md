# C05-C Convention: section menu in the top bar (Vercel / GitHub mobile web) plus a faded drive strip

Mock: `mock-C.html`, `mock-C.png` (375x812, menu open). Content closed starts at y=159.

## Conventions followed
- Vercel dashboard mobile and GitHub mobile web both collapse the section navigation behind one labelled control in the top bar that opens a full-width list with the current page marked. Linear mobile makes the current view's name the header control. We take that: the header button shows the CURRENT section name and a caret.
- Drive switching stays a horizontal chip row like segmented/pill scrollers in Vercel's project picker and GitHub's repo tabs, with a fade and snap.

## Change
- Phone sidebar becomes a one-row bar: brand mark, `Usage ▾` menu button (44px, `aria-expanded`, `aria-haspopup`), avatar.
- The menu is an anchored panel (disclosure; closes on select, Escape, outside tap) listing all 7 sections at 44px with the existing icons, file count on Files, current row inverted (existing `.nav-item.active`), and a divider before Billing & limits and Activity & deletion (they are links, the first five are in-page tabs).
- Breadcrumb/topbar hidden on phone; the menu button replaces tab+breadcrumb (h1 stays).
- Bay strip stays: edge-fade mask, `scroll-snap`, `scrollIntoView` of the selected bay on load and change (from A).

## Before / after
Before: ~320px header. After: closed header 52px + strip 64px, eyebrow at y=159. Seven labelled destinations in one vertical list, no horizontal scrolling for navigation.

## Files and selectors
- `console.css` 760px block: `.sidebar nav` becomes `display:none` unless `.sidebar[data-open]`, positioned absolute under the bar (`top:60px; left:8px; right:8px; flex-direction:column`), `.nav-item` min-height 44px, restore `.nav-icon` and `.nav-count`; new `.nav-toggle`; `.bay-strip` mask and snap.
- `console.tsx`: add `const [navOpen,setNavOpen]=useState(false)`, a `.nav-toggle` button (label `{tab}`), close on item click, Escape and outside click; the same `scrollIntoView` effect for the bay. The nav markup is unchanged; the same `<nav>` serves desktop and phone, so no duplicate list.
- Billing and settings pages keep their own header; apply the same toggle later through a shared component (deferred, same as in A).

## Effort and risk
Medium (about 3 to 4 hours). Risks: a hamburger-style menu costs one tap to switch sections (vs zero in A/B); requires open/close state, focus return and Escape handling; the drive strip still scrolls (but its first item is the selected one and the fade shows more).

## Acceptance
- All 7 reachable and labelled: yes, one tap, full labels, no `$`.
- Selected drive fully visible: yes via scrollIntoView and snap; name ellipsised only above 120px, raise `.bay` width to 176.
- No clipped labels: yes in the menu; bay name ellipsis is the only truncation.
- Content at or above y=260: yes (159).

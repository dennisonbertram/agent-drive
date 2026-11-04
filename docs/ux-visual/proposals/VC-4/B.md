# VC-4 / B Restructure: a two-step "put then read back" session card

## Change

Replace the one-line terminal with a short two-step transcript that proves the main promise (persistence across sessions), laid out as a vertical stack that works at any width and also fills the empty right half of the desktop hero (VC-7).

```
Session 1
$ agent-drive put ./handoff.md /memory/handoff.md
stored /memory/handoff.md (encrypted)

Session 2 (new machine)
$ agent-drive get /memory/handoff.md
# Handoff: ...
```

- Markup: `<figure class="session-card">` with two `<pre>` blocks, each with a `<figcaption>` label (12px, `--on-dark-2`). Each block has its own copy button (44px).
- Layout: `.hero` becomes a 2-column grid at >= 1024px (`grid-template-columns: minmax(0, 1fr) minmax(0, 480px)`); below 1024px the card goes under the copy, full width.
- Long lines wrap (`white-space: pre-wrap; overflow-wrap: anywhere`).
- Replace the static caption "A fresh session. The same context." with the "Session 2" label (it is now shown, not told).

## Before / after

Before: single command, no output, empty right half on desktop. After: a 6-line transcript showing write then read, on the right at desktop and stacked on phones.

## Wireframe

```
Desktop 1440                          Phone 375
+-----------------+ +------------+    +--------------+
| h1              | | Session 1  |    | h1 / copy    |
| copy            | | $ put ...  |    | [CTA]        |
| [CTA] [Console] | | stored ... |    | [Console]    |
|                 | | Session 2  |    | +----------+ |
|                 | | $ get ...  |    | | Session 1| |
+-----------------+ +------------+    | | Session 2| |
                                      +----------+ |
```

## Files / selectors touched

`apps/web/app/(app)/page.tsx` (hero markup), `globals.css`: `.hero` (grid), `.terminal-preview` (rename or extend to `.session-card`), `.terminal-label`, new `.session-block`, `@media (max-width: 1023px)`, `@media (max-width: 480px)`; new `copy-button.tsx`; tokens `--tap`, `--on-dark-2`.

## Effort

M.

## Risks

- The `get` output must reflect real CLI behavior; the content must be verified against the CLI (TBD).
- Two-column hero changes hero height and the pillar peek at 1440x900 (improves L1/L13; verify no layout shift on load).
- More content on a small screen: card is about 260px tall at 375.

## How it meets the criteria

1. No horizontal scroll at 375: wrapped `pre`; assertion as in A.
2. Command and output: both steps show both.
3. Copy control: two 44px buttons, each named ("Copy put command").
4. CTA equal width >= 44px: same `.actions` rules as A.

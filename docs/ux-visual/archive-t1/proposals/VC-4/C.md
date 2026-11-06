# VC-4 / C Convention: copyable install block with tabs, as in developer-tool landing pages

## Pattern

Stripe, Vercel and Supabase docs/landing pages show a code block with a copy icon at the top right, a short tab or label row ("CLI", "MCP"), horizontal scroll avoided by wrapping or a faded edge, and the output shown below a divider. Vercel and Supabase also repeat the command in a pill ("npm i ...") with a copy button right next to the main CTA. Pattern only; no brand assets.

## Change

- Make the hero command an install-style pill under the CTAs: `$ npm i -g agent-drive` (command name TBD, use the real install command) with a 44px copy button inside the pill. On a phone the pill is full width and wraps.
- Keep the terminal card below, now a tabbed block with two tabs `CLI` and `MCP` (role="tablist", keyboard arrows). CLI tab: the put command plus output; MCP tab: the equivalent tool call (content TBD). Block is `white-space: pre-wrap`.
- A faded right edge is not used; wrapping replaces scrolling.
- Tab buttons are 44px tall on touch.

## Before / after

Before: one clipped command and no tabs. After: install pill, then tabbed example with output and copy.

## Wireframe

```
[ Create your workspace ->]  [ Open console ]
[ $ npm i -g agent-drive          [copy] ]
+------------------------------------------+
| [CLI] [MCP]                       [copy] |
| $ agent-drive put ./handoff.md           |
|   /memory/handoff.md                     |
| stored /memory/handoff.md (v1)           |
+------------------------------------------+
```

## Files / selectors touched

`apps/web/app/(app)/page.tsx`; new `copy-button.tsx` and `example-tabs.tsx` (client); `globals.css`: `.terminal-preview`, new `.install-pill`, `.example-tabs`, `.actions .button`, `@media (max-width: 480px)`; tokens `--tap`, `--on-dark-2`.

## Effort

M (two client components, tab keyboard handling, content for MCP tab).

## Risks

- Adds a second command on the page and a second "start here" element next to the primary CTA, which can dilute H1 (one primary action).
- MCP tab content must be real; otherwise drop the tabs and ship only the pill.
- Tab component is new code to test for keyboard behavior (I7).

## How it meets the criteria

1. No horizontal scroll at 375: wrap rules; assertion `scrollWidth <= clientWidth` on pill and block.
2. Output shown: CLI tab includes it.
3. Copy control: pill and block each have a 44px named button with "Copied" state.
4. CTA equal width, 44px: same `.actions` rules; pill is also 44px tall.

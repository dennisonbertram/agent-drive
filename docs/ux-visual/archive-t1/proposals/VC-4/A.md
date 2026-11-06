# VC-4 / A Minimal: let the command wrap, add output, add a copy button

## Change

Current markup (`apps/web/app/(app)/page.tsx` lines 38-46): `.terminal-preview > code` holds `$ agent-drive put ./handoff.md /memory/handoff.md`, then a caption. CSS sets `white-space: nowrap` on `code` and `overflow-x: auto` on the box.

1. `globals.css` `.terminal-preview code`: replace `white-space: nowrap` with `white-space: pre-wrap; overflow-wrap: anywhere; display: block;`. Remove `overflow-x: auto` from `.terminal-preview`. The command now wraps to two lines at 327px (about 45 characters per line).
2. Add one output line under the command inside the same `<code>` block, in `--on-dark-2`: `stored  /memory/handoff.md  (encrypted, v1)`. Content is TBD until it matches the real CLI output.
3. Add a `CopyButton` client component (new file `apps/web/app/(app)/copy-button.tsx`, no clipboard code exists today) using `navigator.clipboard.writeText`, 44x44 target, `aria-label="Copy command"`, label changes to "Copied" for 2s.
4. `.actions .button { min-height: 44px; }` and under the 480px media query `.actions { flex-direction: column; } .actions .button { width: 100%; }`.
   New tokens: `--tap: 44px` in `:root`.

## Before / after

Before: command clipped after `/memory/`, scroll box with no hint. After: command fully visible, wrapped, with output and a copy button; stacked CTAs equal width.

## Wireframe (375px)

```
+--------------------------------+
| FROM A SESSION...      [Copy]  |
| $ agent-drive put ./handoff.md |
|   /memory/handoff.md           |
| stored /memory/handoff.md      |
|   (encrypted, v1)              |
| A fresh session. The same      |
| context.                       |
+--------------------------------+
[ Create your workspace   ->  ]
[ Open console                ]
```

## Files / selectors touched

`globals.css`: `.terminal-preview`, `.terminal-preview code`, `.terminal-preview p`, `.actions .button`, `@media (max-width: 480px)` block near line 1157, `:root` (`--tap`). `apps/web/app/(app)/page.tsx`. New `copy-button.tsx`.

## Effort

S.

## Risks

- A wrapped command can be copied wrongly by selection; the copy button avoids that.
- A hard wrap in the middle of a path is slightly less readable than one line; accepted.
- Output line may drift from the real CLI; needs product confirmation.
- Clipboard API needs HTTPS and a user gesture; fallback shows "Press Ctrl/Cmd+C" is out of scope (TBD).

## How it meets the criteria

1. Full command at 375 with no horizontal scroll: `pre-wrap` removes the need; assert `code.scrollWidth <= clientWidth` and `documentElement.scrollWidth <= innerWidth`.
2. Command and output line: step 2.
3. Copy control >= 44px with accessible name and "Copied" state: step 3.
4. CTAs equal width, >= 44px: step 4.

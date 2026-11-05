# C09-C Convention: toasts for transient success, inline for persistent state

Mock: `mock-C.html`. Shots: `mock-C-1440-files.png`, `mock-C-1440-agents.png`, `mock-C-375-files.png`, `mock-C-375-agents.png`.

## Convention referenced
- Vercel and Linear: transient confirmations ("Deployment redeployed", "Issue created") are a toast in the bottom corner, auto-dismiss, pause on hover; persistent problems (domain misconfigured, failed build) stay as an inline banner or row badge.
- GitHub: persistent account/repo alerts are one thin inline banner that remains until fixed; the "Quick setup" card shows only for an empty repository, afterwards the same actions live behind a menu.
No brand assets are copied; only the pattern.

## Change
- `notice` renders as a toast (fixed, bottom-right, `role="status"`, `aria-live="polite"`), 8s auto-dismiss (WCAG 2.2.1: pausable on hover and focus, dismiss button, 8s minimum), one at a time (newest replaces). Takes no page space, so no shift. Cleared on tab change.
- Persistent state stays inline but as one line each: the backup warning is a single 34px row under the heading (LED + sentence + Copy + Download recovery file), shown only on Files. Key state moves into the file panel toolbar as the existing badge plus Forget key / Load drive key (no separate row, no info banner, no notice).
- Drive UUID leaves the toolbar (CF-18 belongs to C11; here it goes into the panel toolbar `title`/overflow).
- Connect an agent: full card only when there are no agents and no keys (GitHub "Quick setup"). Afterwards a "Connect another agent" popover button in the identities header opens the same content.

## Before / after
Files row 1: y=465 -> 301. Agents row 1: y=700 -> 227. Shift on notice: 57px -> 0 (overlay).

## Files and selectors
- `console.tsx`: `notice` block (~624) -> `<Toast>` portal with a timer effect; `drive-toolbar` removed, badge and Forget key into `.panel-toolbar` (~737); backup banner compacted; `ConnectAgentPanel` conditional at 919/972 plus popover in the identities panel header.
- `console.css`: `.toast` (position fixed, z-index below dialogs), `.banner.keyline` compact.
- `console-panels.css`: `.agent-panel` inside popover.

## Effort and risks
Effort: M (1.5-2 days; new Toast primitive plus popover). Risks: toasts are missable and screen-reader timing matters (must be live-region and long enough); the plan-limit and error paths must stay inline; toasts overlap the last table rows and mobile bottom area (the file panel has a 375 safe-area gap); adds two new primitives (Toast, Popover) to the design system.

## Criteria
- Real list above fold: yes (301 / 227).
- Shift: 0px.
- Nothing hidden: persistent items stay inline; the transient notice disappears after 8s by design. Connect remains reachable through the visible "Connect another agent" button.

# C09-B Restructure: one status tray under the bay strip

Mock: `mock-B.html`. Shots: `mock-B-1440-files.png`, `mock-B-1440-agents.png`, `mock-B-375-files.png`, `mock-B-375-agents.png`.

## Change
- One always-rendered 38px tray (`.status-tray`, `role="status"`) directly under the page heading on every console tab. It holds all notices:
  - left, persistent: LED + "Key loaded" / "Key required" + short id + Forget key / Load drive key;
  - middle, persistent: backup LED + one line + Download recovery file;
  - right, transient: the current `notice` as a pill with dismiss; "All clear" LED when nothing to say.
- Because the tray is always there, notices never push content (zero shift). Priority: error banner (existing `errorBanner`) > notice > backup. At 375 the tray collapses to the top item plus a "3" chip that expands a list in place (disclosure, not a new page).
- Drive id, info banner and key-loaded notice leave the content area; the tray states key once.
- `ConnectAgentPanel` content moves into the existing `Dialog` opened by a secondary "Connect an agent" header button on Agents and API keys; when there are no agents and no keys the card stays inline (empty state).
- Notice clears on tab change.

## Before / after
Before: row 1 y=465, 320px Connect card, 57px shift. After: Files row 1 y=305, Agents row 1 y=275, 0px shift; Connect card height 0 once an agent/key exists.

## Files and selectors
- `console.tsx`: new `StatusTray` component fed by `hasKey`, `drive.key_backup_at`, `notice`; replaces `drive-toolbar` identity row, `keyline` banner, info banner, `notice` block (~624-735); header `actions` (~605-660) gets the Connect button; reuse `Dialog` for Connect (the `open('connect')` modal key); call sites 919, 972.
- `console.css`: `.status-tray` (+ `.slot`, `.more`), reserve height; remove `.banner.keyline` use.
- `console-panels.css`: `.agent-panel` reused inside the dialog.

## Effort and risks
Effort: M-L (2-3 days; new component, modal, mobile expansion, tests for priority order). Risks: a tray that is always present can become wallpaper ("All clear" row is chrome when nothing is wrong, 38px permanent cost); priority rules hide lower items behind "3 more" (backup warning could be missed); Connect moves one click away for users who still need it (mitigated by inline empty state); more code to test (new modal path, focus return).

## Criteria
- Real list above fold: yes (305 / 275).
- Shift: 0px (tray height fixed).
- Nothing hidden: backup warning is visible in the persistent middle zone at 1440; at 375 only the highest item shows and the rest need a tap. Partly fails "nothing important hidden" on phones unless the backup LED stays visible in the collapsed form (mock keeps LEDs).

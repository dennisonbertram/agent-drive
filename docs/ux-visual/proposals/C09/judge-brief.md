# Judge brief: C09 Chrome stacked above the work (Agent Drive console)

Product: Agent Drive, an encrypted file drive for AI agents; the operator console shows drives, files, agents, API keys. T1 "rack" design: warm grey ground, black ink, signal-orange LEDs and primary buttons, mono labels.

## Problem
Informational blocks stack above the real table or list: key badge row, backup banner, key-info banner, key-loaded notice, a 57px-shifting success banner, and a 320px "Connect an agent" card on Agents and API keys that cannot be collapsed. Files table first row is at y=417-465 of 900; API keys scrolls up to 1529px at 375; key state is stated three times.

## Acceptance criteria
1. First real row/list item starts above y=380 at 1440x900 and above y=520 at 375x812.
2. No layout shift above 8px when a banner/notice appears or clears.
3. Nothing important hidden (backup warning, key state, how to connect an agent stay discoverable).
4. Key state stated once; presentation only, no new features or content; uses existing T1 tokens.

## Proposals (each mock in the images; Files tab with key loaded + backup warning + success notice, Agents tab, 1440 and 375)
A Minimal: two 34px status rows (key; backup LED + one line), notice shown on the heading's subtitle line (zero added height, dismiss, clears on tab change), Connect card becomes a closed `<details>` once an agent/key exists. Measured: Files row 1 y=345, Agents y=277, shift 0, 375 y=310. Effort S-M.
B Restructure: one fixed-height 38px status tray holding key state, backup state and the transient notice; Connect moves into a dialog behind a header button except in the empty state; collapses to "3" chip at 375. Measured: 305 / 275, shift 0, 375 y=272. Effort M-L; always-on chrome even when "All clear".
C Convention (Vercel/Linear toasts, GitHub inline alert and quick-setup-then-menu): notices as bottom-right 8s toasts, one-line inline backup row, key badge inside the file panel toolbar, Connect card only in the empty state then a popover. Measured: 301 / 227, shift 0, 375 y=268. Effort M; two new primitives (Toast, Popover).

## Task
Score each of A, B, C from 1 to 5 on: meets acceptance criteria, simplicity, consistency with the rest of the app, usability, visual quality, effort/risk (5 = small and safe). Return the winner, an optional graft from a runner-up, and a short defense. Judge from the screenshots; note you cannot interact.

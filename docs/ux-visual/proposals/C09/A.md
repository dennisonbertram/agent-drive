# C09-A Minimal: compact status rows, Connect card as a disclosure

Mock: `mock-A.html` (`#agents` for the Agents tab). Shots: `mock-A-1440-files.png`, `mock-A-1440-agents.png`, `mock-A-375-files.png`, `mock-A-375-agents.png`.

## Change
- Drive id + key state become ONE 34px row: LED, "Key loaded", short id, "Forget key". The separate "Key loaded into page memory..." notice and the "You can browse file names without a key" info banner are folded into this row's text (one statement of key state). Without a key the row reads "Key required for downloads" + "Load drive key".
- The backup banner becomes one 34px line: LED, one sentence, Copy, Download recovery file (text ellipsizes; full text in `title`). Same T1 "LED plus one line" shape.
- Transient success notices (`notice`) stop being a block. They take the subtitle slot beside the H1 (same line, no added height) with a dismiss button; `setNotice('')` on tab change, drive change and 8s timeout.
- Heading: subtitle moves inline next to the H1; the eyebrow is dropped on console tabs (CS-23).
- `ConnectAgentPanel` renders as `<details className="panel agent-panel">`, closed when `agents.length || keys.length`, open when none. Summary row is 38px "Connect an agent".

## Before / after (1440x900, Files, key loaded, key not backed up)
Before: table row 1 at y=465; four boxes above the table; notice shifts content 57px. After: row 1 at y=345 (measured on the mock); notice shifts 0px. Agents: Connect card 320px -> 38px; first identity row at y=277 (before about 700).

## Files and selectors
- `console.tsx`: `drive-toolbar` (~644-690) merged with the `keyline` banner and info banner (~694-735); `notice` block (~624) moved into the page heading; `ConnectAgentPanel` (~107-140) `<section>` -> `<details>`; open attribute from agents/keys count at the two call sites (919, 972); clear notice in the tab change handler (~331).
- `console.css`: `.console-main .banner*` (~310-345) gain a `.status-row` variant (height 34px, nowrap, ellipsis); `.page-heading` sub inline.
- `console-panels.css`: `.agent-panel` (247-285) get summary row styles; reuse existing `details`/`summary` rules.

## Effort and risks
Effort: S-M (about 1 day, all in three files, no new component). Risks: ellipsized backup text can hide the "why it matters" clause on narrow widths (mitigate: `title`, and the full sentence wraps at max-width 760); notice in the subtitle slot is easy to miss; dropping the "Key loaded into page memory" notice relies on the row text; a collapsed Connect card is less discoverable (summary carries a hint).

## Criteria
- First real row above fold at 1440x900: yes (345 Files, 277 Agents; target <380).
- No shift above 8px when a banner appears: yes for notices (same line); the backup row is permanent so it never appears.
- Nothing important hidden: key-loaded wording, backup instruction and Connect card are all still one click or visible; Connect is closed only once an agent/key exists.
- 375: Files row 1 at y=310 (<520). Needs the C05 mobile header fix to improve further.

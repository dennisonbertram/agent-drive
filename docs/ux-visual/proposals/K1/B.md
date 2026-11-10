# K1-B Restructure: a phone composition for each figure

## Change

Below 600 px, each figure draws a separate phone layout in a 320-unit-wide viewBox, so one unit is at least one CSS pixel and every label is 12 units (12 px at 360, 13.1 px at 390). Same style: cream panel, registration crosses, 1 px ink rules, one orange accent, JetBrains Mono labels, black dot-matrix display. Each phone layout is a vertical stack with fewer elements: title, display, objects, list.

- **Hero (320x452).** Title "MANY AGENTS · ONE DRIVE", then the dot-matrix display at the top ("CLAUDE > HANDOFF"), then a row of five agent keys (glyph above name; OPEN / CODE in two lines; "ANY" for any shell or MCP agent), then a bus with a single wire into **one** drive. The drive is a 2x2 grid of folders (/memory, /outputs, /work, /handoff). Each folder heading carries a labelled count ("5 FILES") and a 3x2 tile grid; /handoff shows the orange next.md tile with "FOR CODEX" under it. Legend at the bottom.
- **Games (320x436).** Pixel screen (168 px) on the left, and the four asset types as a list beside it with full words (SPRITE, TEXTURE, SOUND, LEVEL) and a status square (saved = ink, drawing = orange, pending = outline). Below: "LIBRARY · LATEST 8" and "14 IN DRIVE", then a 4x2 library of larger tiles (66x54) instead of 4x4. Display at the bottom.
- **Protein (320x416).** Backbone screen (140 px) on the left; on the right the total, read first: "IN AGENT DRIVE / 7.20 GB / 3 FILES / 0 BYTES IN GIT". Below, a full-width file list: name and size on one line, a full-width log bar under it, and the GitHub 100 MB tick labelled once in the list header ("GITHUB LIMIT 100 MB", in `#c2370f`). Display at the bottom.

All three drop panel codes, timecodes and session codes. The display's right side is used only for a labelled value or left empty.

Implementation shape: each figure file exports a second pure function, `frameSm(t, env)`, that returns the same group keys as `frame` (so the DOM-diff loop in `TeFigure` is unchanged) plus its own viewBox. `TeFigure` takes `small?: { frame, viewBox, still }` and server-renders **both** SVGs; CSS shows one per breakpoint (`.te-fig .sm` below 600 px, `.lg` above). On mount the effect animates only the visible SVG (`getComputedStyle(svg).display !== 'none'`) and re-checks on resize. Timing (`T`, drop schedule, messages) is shared, so the story is the same lap on both.

## Before / after

Before (current): `<scratchpad>/uxv-home/shots/360x780-figA-hero.png`, `360x780-figA-protein.png`, `390x844-figA-games.png`.

After (static mocks):

| figure  | 390x844                                       | 360x780                                       |
| ------- | --------------------------------------------- | --------------------------------------------- |
| hero    | `.../uxv-home/mocks/K1-B-hero-390x844.png`    | `.../uxv-home/mocks/K1-B-hero-360x780.png`    |
| games   | `.../uxv-home/mocks/K1-B-games-390x844.png`   | `.../uxv-home/mocks/K1-B-games-360x780.png`   |
| protein | `.../uxv-home/mocks/K1-B-protein-390x844.png` | `.../uxv-home/mocks/K1-B-protein-360x780.png` |

`...` is `<scratchpad>`. Mock source: `.../uxv-home/mocks/K1-B-figures.html?f=hero|games|protein&w=390`.

```
Hero, after (phone)
MANY AGENTS · ONE DRIVE                    •
[ CLAUDE > HANDOFF  (dot-matrix)          ]
[●CLAUDE][■CODEX][▲PI][◎OPEN/CODE][+ANY]
  └──────┴──────┴──┬──┴──────┘
┌─────────────────┴──────────────────────┐
│/memory   5 FILES │/outputs  4 FILES    │
│ ▢▢▢ ■■□          │ ▢▢■ ■□□             │
│/work     5 FILES │/handoff  1 FILE     │
│ ▢▢▢ ■■□          │ ▣ next.md └ FOR CODEX│
└────────────────────────────────────────┘
▢ EARLIER  ■ THIS SESSION  ▣ HANDOFF
```

## Files and functions touched

- `apps/web/app/(app)/te-figure.tsx`: `TeFigure` (optional `small` prop, two SVGs, pick the visible one, re-pick on resize), `chrome()` gains a width parameter or a `chromeSm()` sibling; `C.ot` added. `envFor` is unchanged for desktop.
- `apps/web/app/(app)/hero-figure.tsx`: new `frameSm` (keys row, single bus, 2x2 drive, folder counts); shares `T`, `DROPS`, `MSG` (phone messages shortened to 17 characters for the 2.6-pitch display).
- `apps/web/app/(app)/games-figure.tsx`: new `frameSm` (type list, 4x2 library); shares art, `G`, timings.
- `apps/web/app/(app)/protein-figure.tsx`: new `frameSm` (readout block, full-width file list); shares the point cloud `P`, `FILE`, timings; `proteinScreen` at N=26.
- `apps/web/app/styles/te-figures.css`: `.te-fig .sm/.lg` visibility per breakpoint.

## Effort

M-L: about two to three days. Three new frame functions, each about 120-150 lines, plus the `TeFigure` change and a check at 360, 390 and 600 px (the switch point).

## Risks

- Two drawings per figure to maintain. A change to the desktop story has to be made twice. Shared timing and data limit the drift but do not remove it.
- Server markup grows (two SVG stills per figure). The protein still is the largest, around 1k dots; two copies roughly double that group.
- The phone figures are taller (452, 436, 416 units; about 490, 475, 450 px at 390). K2 is trying to shorten the page; this adds about 100-140 px per figure compared with today's 340 px panels.
- The games library shows only the latest 8 tiles on phones; "14 IN DRIVE" carries the total. The flip-through of all 16 in session two has to become an 8-tile flip on phones.
- The protein screen is smaller (140 px), so the backbone reads less clearly than on desktop.

## Acceptance criteria

| criterion                                | how B meets it                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No text overlaps or touches at 360 / 390 | Each layout is drawn for 320 units with labels at 12 units on fixed rows; longest rows measured by character count (e.g. "/outputs" + "4 FILES" = 108 of 120 units). Checked by eye in the mocks; **not yet measured** with the geometry script. |
| Labels ≥ 12 px and ≥ 4.5:1               | 320-unit viewBox means 12 units = 12.0 px at 360 and 13.1 px at 390. Text colours: ink, `#6f6d68` (4.74:1), `#c2370f` (5.01:1), display orange on ink (5.62:1).                                                                                  |
| No decorative codes                      | No AD-0x, S0x or timecode; counts are labelled ("5 FILES", "14 IN DRIVE"); asset types spelled out; no agent numbers or angle readout.                                                                                                           |
| Reduced-motion frames look active        | Phone stills are mid-session frames: a pressed key and a packet on the bus (hero), a sound being drawn with two assets saved (games), a finished upload with the total (protein).                                                                |
| First paint uses the mobile size         | Both SVGs are server-rendered and CSS picks one, so the first paint is already the phone composition.                                                                                                                                            |

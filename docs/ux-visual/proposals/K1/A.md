# K1-A Minimal: same panels, phone-sized labels, no codes

## Change

Keep each figure's 520x420 panel and its desktop layout. Change only what the acceptance criteria require:

1. **Label size.** Raise the label floor from 11 px to 12 px effective. In `envFor`, `fs = Math.max(10, 12 / f)`. At a 320 px figure (360 viewport) that is 19.5 viewBox units; at 350 px (390 viewport) it is 17.8.
2. **Contrast.** No text uses `C.g2` (#a8a69f, 2.23:1 on #f6f5f2) any more. Secondary text uses `C.g3` (#6f6d68, 4.74:1 on #f6f5f2, 5.17:1 on white). Add `C.ot = '#c2370f'` for orange text on cream (5.01:1); `#ff4a1c` stays for marks, bars and the dot-matrix strip (orange on #111 is 5.62:1). `C.g2` stays for non-text marks (earlier-session tiles, registration crosses).
3. **Codes removed.** `chrome()` drops the panel code (AD-01/02/03) and the running timecode; it keeps the title and the orange dot. The strip's right side shows a labelled value ("21 FILES", "7.20 GB") or nothing, never "S01". Hero agent numbers 01-05 and the unlabelled folder counters go. Games "16×16 PX · GEN 00/04" becomes "DRAWING 3 OF 4". Protein "7XKA BACKBONE · Cα 055°" becomes "PROTEIN BACKBONE"; the angle readout and the helix/strand/loop legend are dropped on phones.
4. **Phone label variants (the existing `env.narrow` branch), so nothing overlaps at 19.5 units:**
   - Hero: keys widen from 79 to 86 units (gap 10.5) so "CLAUDE" fits with 8 units clear; names are left-aligned and set in one or two lines (OPEN / CODE, ANY / AGENT); glyph stays top right. The handoff note reads "next.md" / "TO CODEX". Legend: EARLIER, THIS SESSION, HANDOFF. "ENCRYPTED AT REST" is dropped on phones.
   - Games: pills grow to 30 units tall; meta row moves to y=347.
   - Protein: the log axis keeps its ticks but only one label, "GIT LIMIT", centred on the 100 MB tick. File rows move to a 62-unit pitch and the size sits on its own line under the bar (fixes "0.00 / 2.6 GB" over "0 IN GIT").
5. **Reduced motion.** Hero `still` moves from 10.5 (sandbox ended, keys ghosted) to about 6.6 (handoff just saved, Claude key pressed, packet on the bus). With the timecode gone there is no frozen clock.
6. **First paint.** `ENV0` becomes the phone env (`envFor(320)`), and `te-figures.css` sets `--fs` per breakpoint (`19.5px` below 600 px, `10px` above) so the server markup already has phone-sized labels. Desktop repaints once after `measure()`; its first frame is the phone label variant at desktop size, which is sparser but valid.

## Before / after

Before (current, 360x780): `<scratchpad>/uxv-home/shots/360x780-figA-hero.png`, `360x780-figA-protein.png`, `390x844-figA-games.png` in the same folder.

After (static mocks):

| figure  | 390x844                                       | 360x780                                       |
| ------- | --------------------------------------------- | --------------------------------------------- |
| hero    | `.../uxv-home/mocks/K1-A-hero-390x844.png`    | `.../uxv-home/mocks/K1-A-hero-360x780.png`    |
| games   | `.../uxv-home/mocks/K1-A-games-390x844.png`   | `.../uxv-home/mocks/K1-A-games-360x780.png`   |
| protein | `.../uxv-home/mocks/K1-A-protein-390x844.png` | `.../uxv-home/mocks/K1-A-protein-360x780.png` |

`...` is `<scratchpad>`. Mock source: `.../uxv-home/mocks/K1-A-figures.html?f=hero|games|protein&w=390`.

```
Before (360)                               After (360)
AD-01 MANY AGENTS · ONE DRIVE  •00:03.3    MANY AGENTS · ONE DRIVE            •
[01 CLAUDE CODE●][02 CODEX■]...           [CLAUDE   ●][CODEX   ■]...[ANY AGENT +]
 05     05     05     01  (grey 2.2:1)     (counters removed)
>AGENT > /WORK           S03              >SAVE NEXT.MD          21 FILES
```

## Files and functions touched

- `apps/web/app/(app)/te-figure.tsx`: `C` (add `ot`), `envFor` (12 px floor), `ENV0` (phone default), `chrome()` (drop code and timecode, title in `C.g3`).
- `apps/web/app/(app)/hero-figure.tsx`: `kx`/`kc` and key label loop in `frame` (narrow widths, no numbers), `body` legend and "ENCRYPTED AT REST", the `cn` counters, handoff note text, strip right value, `still`.
- `apps/web/app/(app)/games-figure.tsx`: pill size and `meta` text in `frame`, strip right value.
- `apps/web/app/(app)/protein-figure.tsx`: `labels` (axis), `RY` pitch and size placement, `meta` and legend in `frame`, strip right value.
- `apps/web/app/styles/te-figures.css`: `--fs` default per breakpoint.

## Effort

S: about half a day to a day, plus the existing overlap check (`ov-360-*.json`) rerun at 360 and 390.

## Risks

- The panel is still a desktop drawing at 0.62 scale. Labels meet 12 px, but the agent keys, tiles and pills are small touch-free graphics (8-10 px glyphs) and the whole thing reads dense. This fixes the defects, not the composition.
- Pill text "SPR" in a 48-unit pill has about 4 px clearance at 360. It passes "does not touch" but is tight.
- SPR/TEX/SFX/LVL stay as abbreviations. A game developer reads them; a general reader may not. The criterion on "codes without meaning" is arguable here.
- Desktop first paint uses the phone label variant for one frame (no overlap, but labels shift on hydration).
- `C.g2` tiles on white are about 2.45:1. WCAG non-text contrast asks for 3:1 when the graphic is needed to understand the content. The legend names the colour, so this is a residual risk, not a criterion failure.

## Acceptance criteria

| criterion                                | how A meets it                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No text overlaps or touches at 360 / 390 | Phone variants above remove the measured overlaps (protein size vs "0 IN GIT", hero tile number vs name, scale labels). Checked by eye in the mocks; **not yet measured** with the geometry script. |
| Labels ≥ 12 px and ≥ 4.5:1               | `envFor` floor 12 px. Text colours limited to ink (17.3:1), `C.g3` (4.74:1), `C.ot` (5.01:1), strip orange on ink (5.62:1).                                                                         |
| No decorative codes                      | AD-0x, S0x, timecodes, 01-05, folder counters, angle readout and "GEN 00/04" removed or replaced with labelled values. SPR/TEX/SFX/LVL remain (see risks).                                          |
| Reduced-motion frames look active        | Hero still moved to a mid-session frame; no frozen timecode anywhere.                                                                                                                               |
| First paint uses the mobile size         | `ENV0` = phone env plus `--fs` set in CSS per breakpoint.                                                                                                                                           |

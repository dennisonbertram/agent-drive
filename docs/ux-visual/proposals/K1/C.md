# K1-C Convention: full-bleed artwork, words in HTML

## What strong product pages do on phones

I captured four product pages on 2026-11-09 with Playwright's iPhone 13 emulation (390 px, DPR 3):

- **Linear** (linear.app): each feature section shows a cropped fragment of the product UI that runs to the screen edges (the "Planning" timeline is cut off on both sides). The heading and the explanation sit below it as normal HTML text. The fragment is not meant to be read label by label. Evidence: `.../uxv-home/ref/linear_app-p0.png` (full page `linear_app-m.png`).
- **Teenage Engineering** (OP-1 field page): screen captures and product photos run the full width; what they show is explained in a small uppercase HTML caption directly under each image, not inside it. Evidence: `.../uxv-home/ref/teenage_engineering_products_op-1-p1.png`.
- **Stripe and Vercel** were also captured, but their animated sections lazy-load and did not render in the full-page capture, so I make no claim about how they behave on phones.

`...` is `/private/tmp/claude-501/-Users-dennison-develop-agent-drive/72e5153f-f1c9-4e4b-819b-255bec507e75/scratchpad`.

The shared pattern: on a phone, the picture gets the full width and is cropped to the part that moves; the words that explain it are HTML, at body-text size, under the picture.

## Change

Applied to the three figures, keeping the Swiss grid + dot-matrix style:

1. **Full bleed.** Below 600 px the figure spans the viewport (`margin-inline: -20px`), square corners, 1 px ink rules top and bottom, cream fill. Scale goes from 0.62 to 0.69 at 360 and from 0.67 to 0.75 at 390.
2. **Crop to the moving parts.** The phone viewBox drops the header row (code, title, timecode) and the meta/legend row: hero `0 46 520 326`, games `0 48 520 338`, protein `0 48 520 302`. The panel title moves into the section eyebrow ("MANY AGENTS · ONE DRIVE"), which already exists as HTML.
3. **Only labels attached to an object stay in the SVG**, at 12 px effective (17.3 units at 360): folder names, the next.md tile name, pill names, file names and sizes, the "GIT LIMIT" tick label, and the dot-matrix display. Agent keys show glyphs only (scaled 1.8x) because "OPENCODE" does not fit a key at 12 px.
4. **Everything explanatory moves to HTML under the figure**, in 13 px JetBrains Mono, ink on white:
   - Hero: a glyph key (● Claude Code, ■ Codex, ▲ pi, ◎ opencode, + any agent with a shell or MCP) and the tile legend (earlier session, this session, handoff note Codex opens next).
   - Games: SPR sprite, TEX texture, SFX sound, LVL level; "Library 14 assets" as a stat line. The duplicate column labels under the library become four short bars that line up with the pills (orange for the active type).
   - Protein: "In Agent Drive 7.20 GB", "In Git 0 files", and the helix / strand / loop key.
5. **Codes removed** as in A: no AD-0x, S0x, timecode, agent numbers, unlabelled counters or angle readout.

Implementation shape: `TeFigure` gets `phone?: { viewBox: string; caption: ReactNode }`. It server-renders the same frame groups once, with two `<svg>` wrappers that differ only in `viewBox` (desktop `0 0 520 420`, phone crop) — or, more simply, one SVG whose `viewBox` the effect sets from `matchMedia('(max-width: 599px)')`, with the phone crop as the server default. The caption is a sibling `<div class="te-key">` that CSS hides at 600 px and above. The frame functions branch on a new `env.bleed` flag to skip header, meta and legend groups and to draw glyph-only keys.

## Before / after

Before (current): `.../uxv-home/shots/360x780-figA-hero.png`, `360x780-figA-protein.png`, `390x844-figA-games.png`.

After (static mocks):

| figure  | 390x844                                       | 360x780                                       |
| ------- | --------------------------------------------- | --------------------------------------------- |
| hero    | `.../uxv-home/mocks/K1-C-hero-390x844.png`    | `.../uxv-home/mocks/K1-C-hero-360x780.png`    |
| games   | `.../uxv-home/mocks/K1-C-games-390x844.png`   | `.../uxv-home/mocks/K1-C-games-360x780.png`   |
| protein | `.../uxv-home/mocks/K1-C-protein-390x844.png` | `.../uxv-home/mocks/K1-C-protein-360x780.png` |

Mock source: `.../uxv-home/mocks/K1-C-figures.html?f=hero|games|protein&w=390`.

```
Before (360, inset 320 px card)           After (360, full bleed 360 px)
  ┌──────────────────────────┐          ───────────────────────────────────
  │AD-01 MANY AGENTS… 00:03.3│          [●][■][▲][◎][+]      glyph keys
  │[01 CLAUDE CODE]…         │           └──┴──┴──┴──┴─ bus
  │drive, counters, legend   │          /memory /outputs /work /handoff
  │>AGENT > /WORK       S03  │          >SAVE NEXT.MD          21 FILES
  └──────────────────────────┘          ───────────────────────────────────
                                        ● Claude Code    ■ Codex     (HTML)
                                        ▲ pi             ◎ opencode
                                        + Any agent with a shell or MCP
```

## Files and functions touched

- `apps/web/app/(app)/te-figure.tsx`: `TeFigure` (phone viewBox, caption slot), `Env` (`bleed` flag), `envFor` (12 px floor), `chrome()` (skipped when `bleed`), `C.ot`.
- `apps/web/app/(app)/hero-figure.tsx`: key drawing in `frame` (glyph-only when `bleed`), `body` (legend skipped), counters removed, strip right value; caption JSX in `HeroFigure`.
- `apps/web/app/(app)/games-figure.tsx`: library column labels become bars, `meta` skipped; caption JSX.
- `apps/web/app/(app)/protein-figure.tsx`: axis labels, row pitch, `meta` and legend skipped; caption JSX with the live total (static value is fine; the total is the end state of the loop).
- `apps/web/app/styles/te-figures.css`: full-bleed rule below 600 px, `.te-key` grid styles (reuse landing mono tokens).

## Effort

M: about one and a half to two days. One flag through three frame functions, three short captions, and the `TeFigure` viewBox switch.

## Risks

- Reading the hero needs a glance from the glyph to the key below the figure. Teenage Engineering hardware works this way, but it is one more step than reading a name on the key.
- The HTML caption is static while the figure animates, so the caption cannot point at the active agent or file. The dot-matrix display still says what is happening.
- Full bleed breaks the 20 px gutter that every other section keeps. It is the convention on Linear and Teenage Engineering, but it should be checked against K5 (footer and gutter alignment).
- Adding a caption adds about 120-180 px per figure, so the figure plus caption is roughly as tall as today's card (hero: 247 px figure + 150 px caption at 360). It does not help K2's page length.
- If the viewBox is switched by the effect rather than server-rendered twice, a desktop visitor's first paint is the phone crop until hydration.

## Acceptance criteria

| criterion                                | how C meets it                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No text overlaps or touches at 360 / 390 | Fewer labels remain in the SVG, at a larger scale (0.69 / 0.75), on the layouts from A that already clear at 0.62. Checked by eye in the mocks; **not yet measured** with the geometry script.               |
| Labels ≥ 12 px and ≥ 4.5:1               | In-SVG labels at 12 px effective; caption text is 13 px HTML in ink (17.3:1 on white). Remaining SVG text colours: ink, `#c2370f` (5.01:1), display orange on ink (5.62:1).                                  |
| No decorative codes                      | Header row cropped away (AD-0x, timecode); S0x, agent numbers, counters and angle readout removed. SPR/TEX/SFX/LVL stay on the pills but are spelled out in the caption.                                     |
| Reduced-motion frames look active        | Stills are mid-session (Claude key pressed, packet on the bus; sound being drawn; finished upload). No timecode exists to freeze.                                                                            |
| First paint uses the mobile size         | The phone crop and caption are the server default; CSS hides the caption and the effect restores the desktop viewBox at 600 px and above (or render two SVGs as in B to make desktop first paint exact too). |

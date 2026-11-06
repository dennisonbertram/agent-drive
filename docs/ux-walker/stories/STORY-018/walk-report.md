# STORY-018 walk report (lane B)

Seeded user e2e_uxreview. Result: PASS (story behaves as written; gaps confirmed).

1. Selected research-bot, loaded its key (via recovery bundle file, see STORY-026), typed "jsonl" in the filter (screenshots/step-0-filter-typed.png).
2. Clicked the "nightly-builds" tile: aria-pressed moved to it, LED lit, filter cleared, table reloaded (3 rows), badge "KEY REQUIRED FOR DOWNLOADS" + "Load drive key" (step-2-switched.png). Geometry audit: only intentional unequal widths. Clean. One click, matches ideal path.
3. Clicked back to research-bot: "Forget key" present (key retained in memory), filter empty (step-4-back-research.png).
4. Variation "+ YOUR NEXT AGENT" tile opens "Create a drive" dialog (variation-next-agent-tile.png): label and action do not match. Confirmed.
5. Variation reload: key forgotten ("Load drive key" again). Selection returns to first tile (nightly-builds, alphabetical), URL stays /console, so the drive/tab are not in the URL (variation-reload.png).
6. Mobile 390x844 (mobile-check.png): drive strip scrolls horizontally, third tile clipped at the edge (expected, scrollable); cards stack; no page overflow.

## Flow log

- Steps: 1 click to switch (ideal 1). No hesitation.
- The "Key backed up ... (file)" banner never names which drive it refers to; after a switch it looks identical.
- Drive meta, drive id, and key state each appear in the strip, card header and banner.

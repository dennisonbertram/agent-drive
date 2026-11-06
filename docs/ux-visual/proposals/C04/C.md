# C04 + C14 / C: Convention (Google Drive and Dropbox list model)

Pairs with C05/C. Covers C14 in the same change.

## What best-in-class products do
- Google Drive: left rail "My Drive / Recent", a "+ New" button at the top of the rail, breadcrumb as the page title with a dropdown on the last crumb, list view with Name / Owner / Last modified / Size, row hover actions plus a `⋯` menu, Drive mobile app shows name plus one meta line and `⋯`.
- Dropbox: "All files" breadcrumb, Name column sortable with one arrow, hover actions Share / `⋯`, one blue primary "Upload or drop" at the top right, and a Recents page.
- iCloud Drive and Box agree on: folder rows first, modified date as the default sort, and no full paths in rows.

## Change
1. Rail entries become views of the current drive: **Files**, **Recent**, **Trash** (Recent is a rail item, not a toggle). Selected drive is a dropdown in the page title: `research-bot v / inbox / x`, replacing the drive strip on all tabs.
2. Header action: one orange split button **"+ New"** (Drive's pattern): "Connect an agent" (default action), "New drive", and later "Upload". Because agents write all files today, "Connect an agent" is the default.
3. List: Name (icon + name), Modified, Size, Author (hidden below 1024). Hover reveals Download and `⋯`; on touch both are always visible. Folder rows first. Header sorts with one arrow; default Modified desc; URL carries `path`, `sort`, `view`.
4. Selection: checkbox on hover/focus, toolbar replaces the header ("2 selected: Download, Trash, Clear").
5. Last-used drive remembered. Filler copy removed.
6. Optional Upload (not in phase 1). If added, it uses `encryptFile(plaintext, driveKey)` from `packages/agent-drive/src/crypto.ts` in the browser, needs the drive key, so it goes through the C05 unlock prompt first; the server receives ciphertext only. The console would need a signed upload URL path that agents already use.

## Before / after (1440)
```
 Files | Recent | Trash                (rail)
 research-bot v / inbox / x         [Filter]            [ + New v ]
 Name v                 Modified       Size
 [d] logs               Nov 6          6 items
 [f] 2026-11-01.jsonl   Nov 6 11:55    577 B   (hover: Download  ...)
```
## At 390 (C14)
Drive mobile pattern: 56 px row with icon, name, one meta line "Nov 6 · 577 B", `⋯` 44 px. The "+ New" button becomes a 48 px floating action button at bottom right (inside the viewport, L2). The page header is one line: drive dropdown plus breadcrumb. Filter is a search icon in the top bar. Estimated toolbar before the first row: 44 px (breadcrumb only); about 12 rows on the first screen (unmeasured).
At 768: Name, Modified, Size; Author dropped; breadcrumb truncates in the middle.

## Files touched
`console.tsx` (rail items, header, list), `console.css` (`.file-row`, FAB at <= 640px), new `split-button` (menu button; add to design system), `file-icon.tsx`, `file-tree.ts`. Effort: M (L with Upload).

## Risks
- Split button and FAB are new patterns; must be added to the design system first.
- "Recent" as a rail item changes sidebar order (Files, Recent, Trash, Agents...). Trash already is a rail item today, so it becomes drive-scoped; confirm that account-level items (Agents, API keys, Usage, Billing) read as separate group with a divider.
- Hover-only actions fail on touch and keyboard unless focus-within also shows them (I7).
- Same client-side limits as A for counts and for Modified sort.
- Encryption: none for browse; Upload (optional) is covered above.

## Acceptance criteria
1. Folder rows with icon/name/count, name-only files, breadcrumb, URL path: yes.
2. Sort with arrow, keyboard: yes.
3. Recent: rail item using `recent`.
4. Icons, no mono path: yes.
5. One orange primary: "+ New"; "New drive" inside its menu, so it is not a second orange button.
6. Last-used drive: yes (title dropdown).
7. Account tabs have no drive dropdown or strip: frees 74 px.
8. No page scroll at 1440x900: single list scroller as today.
9. Filler removed.
C14: 56 px row (<= 64); about 12 rows (>= 8); about 44 px toolbar (<= 120); 768 has no truncated subtitle and no wrapping title.

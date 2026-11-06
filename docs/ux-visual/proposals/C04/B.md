# C04 + C14 / B: Restructure (drive switcher + folder tree + details pane)

Pairs with C05/B. Covers C14 in the same change.

## Change
Rethink the Files screen as the three-region layout used by file managers.
- Left rail (existing sidebar) gets a drive switcher at the top (replaces the 74 px drive strip everywhere; one tile with drive name, size and key chip, opens a menu of drives plus "New drive"). Account tabs never show it.
- Second column (240 px, collapsible): folder tree for the current drive, plus "Recent" and "Trash" entries at its top. Tree is built on the client from loaded paths; expanding a folder loads its prefix (`GET list?prefix=/inbox/x/`).
- Center: breadcrumb, sortable list (name, modified, size), folder rows and file rows with type icons. Checkbox column for selection; selecting shows a bar "2 selected: Download, Trash".
- Right pane (320 px, opens on row click): file details with name, size, author, modified, Versions list inline (replaces the Versions dialog), Download primary, Share (C03), Trash. Escape closes.
- Primary: "Connect an agent" (orange) in the page header; "New drive" lives in the switcher menu.

## Before / after (1440)
```
+--------+-------------------+------------------------------------+----------------+
|[drive v]| Recent            | research-bot / inbox / x  [Filter] | 2026-11-01.jsonl|
| Files   | Trash             | [ ] Name v    Size  Modified v     | 577 B  Nov 6   |
| Agents  | v inbox           | [ ] logs      6     Nov 6          | research-bot   |
| ...     |   > x             | [ ] 2026-11..  577B  Nov 6         | [Download]     |
|         | > logs            |                                    | Versions (3)   |
+--------+-------------------+------------------------------------+----------------+
```
Before: one flat table of 29 full paths with three buttons per row.

## At 390 (C14)
Three columns collapse. The tree becomes the breadcrumb plus a "Folders" sheet button; the details pane becomes a bottom sheet on row tap (Download, Versions, Trash as 48 px rows). The list row is the same 60 px two-line row as A:
```
[ ] [icon] 2026-11-01.jsonl           >
           577 B · Nov 6
```
Selection checkboxes appear only after a long-press. Estimated before the first row: breadcrumb 44 + filter/sort 44 = 88 px; drive switcher is 48 px in the top bar next to the nav menu, not above the list. About 10 rows on the first screen (unmeasured).

## Files touched
`console.tsx` split into `files-screen.tsx`, `folder-tree.tsx`, `details-pane.tsx` (console.tsx is already 1,580 lines); `apps/web/app/styles/console.css` (grid `console-shell` gets a third column), `console-panels.css`; new `Sheet` pattern (bottom sheet, reused by C05/B unlock sheet and C03 share). New design-system entries: Tree, Details pane, Sheet. Effort: L.

## Risks
- Biggest build; adds three new patterns to the system. Phase 2 per problems.md for inline preview fits the details pane well.
- Tree depth needs the same client derivation as A; accurate counts and lazy loading want `delimiter=/` on `list`. Without it, large drives load more pages than needed.
- Two extra columns shrink the list at 1280px (list about 560 px). Pane and tree default closed below 1366 px.
- Encryption: none. Details pane preview (phase 2) would decrypt in the browser with the loaded key; trigger it through the C05 unlock prompt.

## Acceptance criteria
1. Folder rows with icon, name and count; breadcrumb; folder in URL (`path`): yes.
2. Sort headers with arrow, keyboard operable: yes (same as A).
3. Recent entry in the tree uses the `recent` API.
4. Type icons, name-only rows: yes.
5. One orange primary "Connect an agent"; New drive moves to the switcher menu (secondary by placement).
6. Last-used drive: persisted selection (`localStorage['ad.lastDrive']`), switcher shows it.
7. Account tabs have no drive switcher in the content area; content starts at least 74 px higher.
8. 1440x900 no page scroll: three panes each scroll inside themselves (must be verified, since three scrollers raise the risk).
9. Filler copy removed; header subtitle is the count.
C14: row 60 px; about 10 rows; toolbar about 88 px; at 768 the tree and details pane are closed, so no truncation or wrapping.

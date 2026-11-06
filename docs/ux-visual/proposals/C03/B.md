# C03-B Restructure: row selection with a contextual action bar, undo toast, and confirm only for irreversible actions

## Change

Make rows selectable and move actions out of each row into one place (this is the C04 file-browser model, and should be built together with it, or use the single-row case as the first step).

- Each row has a checkbox and a click-to-select target. Selecting one or more rows replaces the panel header with an action bar: "2 selected · Download · Versions · Trash · ×". A row still has one inline primary (Download) so the common path stays one click.
- **Trash is reversible, so no confirm; it gets an undo toast** (bottom-left snackbar queue, max 3 stacked, newest on top, each at least 6 s; hovering pauses; the stack docks in a fixed container so it does not push layout, per L3). Text names the file, or "3 files" with an expandable list.
- **Revoke is not reversible, so it gets a confirm** with a typed or count-based summary: "Revoke research-bot? 2 active keys stop working now. This cannot be undone." and a danger button. After confirming, the agent row switches to a "Revoked" status chip in place and the keys list updates; a toast "Revoked research-bot" with no Undo.
- Restore (Trash, Versions) toasts "Restored x. [Show file]".
- Versions becomes a right-side panel (drawer) instead of a modal: a timeline of "v3 current · 2 h ago · 4.2 KB · research-bot", "v2 ...", each with Restore and, when the key is loaded, Download this version. A single-version file shows "This is the current version" with an empty timeline. UUID is hidden behind "Copy version id" in a row menu.
- Receipt dialog: key shown in a read-only field with the Copy icon button on its right edge; primary orange "Save recovery key"; "Continue" is a secondary until the checkbox is ticked, then becomes the dark primary-neutral (not orange) so there is still only one orange per view.

## Before / after

```
[ ] /work/a.txt   [Download]
[x] /work/b.txt   [Download]
[x] /work/c.txt   [Download]
 ---------------------------------------------
 2 selected   Download  Versions  [Trash]   ×
                       toast: 2 files moved to Trash   Undo
```

## Files

apps/web/app/(app)/console/console.tsx (selection state, ActionBar, Toast stack, ConfirmDialog, VersionsDrawer), console.css (.action-bar, .toast-stack, .drawer), globals.css (--danger).

## Effort and risk

L. Risks: depends on C04 selection; bulk trash makes Undo a batch restore (N API calls, partial failure handling); a drawer is a new pattern that must be added to the design system, and on 390 px it becomes a bottom sheet; decrypting an old version for download in the browser uses the existing per-file decrypt helper in apps/web/src, with the same in-memory key requirement.

## Acceptance criteria

1. Toast with Undo, bottom-left, under 100 ms, over 6 s: yes.
2. One primary per row; others in the action bar; Trash 40 px+ from other actions; 32/44 px targets: yes.
3. Restore toasts with Show file: yes.
4. Named confirm with key count; in-place row state: yes.
5. Versions timeline with number/date, size, author, current-version message, no UUID: yes.
6. Receipt hierarchy: yes.

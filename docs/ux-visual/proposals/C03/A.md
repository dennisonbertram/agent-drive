# C03-A Minimal: toast, overflow menu, named confirm dialog using existing pieces

## Change
- **Toast**: add one `Toast` element in console.tsx rendered bottom-left, `position: fixed; left: 24px; bottom: 24px; max-width: min(420px, calc(100vw - 32px))` (inside the viewport at 1440 and 390). State is `toast: {text, action?:{label,run}} | null` replacing the `notice` string for file and agent results. `role="status"`, auto-dismiss at 8 s (min 6 s), paused on hover/focus. Appears synchronously in the same click handler (under 100 ms; no await before `setToast`; trash is optimistic: remove the row, call the API, on failure restore the row and show a danger toast).
  - Trash: "Moved check.txt to Trash.  [Undo]". Undo calls the existing `restore(path)`.
  - Restore (Trash tab and Versions dialog): "Restored check.txt.  [Show file]". Show file switches to Files, sets the filter to the path.
  - Page-header `notice-slot` stays only for non-file messages; file results are never header-only.
  - Note: share links stop working on Trash. Add to the toast body only when the file has a share (skip if the list payload has no share field; TBD, ask whether FileEntry exposes it).
- **Row actions**: the row shows one primary (`Download`, Restore in Trash) and a `⋯` button (32 px high, 44 px on `pointer: coarse`) with a native `popover` menu: Versions, Share, Trash. Trash is last, separated by a divider, 40 px from the primary. Keep `.row-actions` classes, add `.row-menu`.
- **In-app confirm**: a `ConfirmDialog` that reuses the existing `Dialog` (console.tsx:203): title "Revoke access for research-bot?", body "This agent has 2 active keys. All will stop working immediately.", buttons Cancel (secondary) and Revoke (danger). Replaces both `window.confirm` calls (lines ~1067, ~1141). After revoke the agent row shows "Revoked" and no button when active keys = 0.
- **Versions dialog**: show "Version 3 · 2 hours ago", size, author; remove `<code>{version.id}</code>` (move to a title attribute); single-version file shows "This is the current version." and no list heading about restore.
- **Receipt dialog**: swap classes: "Save recovery key" `button primary` (the one orange), Copy moves beside the key field, "Continue to drive" `button secondary` while the box is unticked, primary after.

## Before / after
```
Before: /work/b.txt     [Download] Versions  Trash        notice in page header, far away
After:  /work/b.txt     [Download]  [⋯]                    toast bottom-left:
                                    | Versions |          | Moved b.txt to Trash.  Undo |
                                    | Share    |
                                    |----------|
                                    | Trash    |
```

## Files
apps/web/app/(app)/console/console.tsx (rows 876-945, 1060-1155, Versions 1543-1575, receipt 1325-1370, new Toast, ConfirmDialog), console.css (.toast, .row-menu, .dialog danger button), globals.css (--danger shared with C02).

## Effort and risk
M. Risks: the native popover needs keyboard handling for arrow keys (Escape and Tab work natively); optimistic trash must roll back; Undo after a drive switch must still target the original drive id (capture it in the closure).

## Acceptance criteria
1. Toast naming the file with Undo, bottom-left, under 100 ms, at least 6 s (8 s): yes.
2. One primary plus overflow; Trash far from the primary; 32/44 px hit area: yes.
3. Restore toasts with Show file; header not the only report: yes.
4. Named in-app confirm with the active key count; row updates in place: yes.
5. Versions: number/relative date, size, author, no UUID, single-version message: yes.
6. Receipt: single orange primary, Copy beside key, Continue secondary until ticked: yes.

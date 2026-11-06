# C03-C Convention: what Drive, Dropbox, Gmail and GitHub do

## Reference patterns
- **Google Drive**: hover row shows icon actions and a `⋮` menu; Remove moves to Trash and shows a bottom-left snackbar "1 item moved to trash · Undo"; Restore shows "Restored 'name' · Show file location" (the exact criterion 3 wording).
- **Gmail**: "Conversation moved to the Trash. Undo" bottom-left, 8 s, no confirm for reversible actions.
- **Dropbox**: row `⋯` menu holds Version history; version history is a side panel listing "Version date · size · who edited" with a "Restore" per row and a plain "Current version" label.
- **GitHub and Vercel**: destructive, irreversible actions (delete repo, revoke token) use a modal that names the object, states the consequence, and requires an explicit danger button; the token list updates the row to "Revoked" in place.
- **Linear**: toasts bottom-left, stacked, with an Undo link, auto-dismiss at about 5 s.

## Change
Apply those conventions directly, no new structure beyond them:
- Each row shows an inline action pair, always visible: Download as a text button, `⋮` as a 32 px (44 on touch) icon button opening a menu: Open versions, Share, Move to Trash (danger text, below a divider). Trash is not a visible row button.
- Snackbar component `.toast` (bottom-left, 8 s, Undo or Show file location link) added to the design system; replaces `notice` for file results.
- Revoke agent / revoke key: modal "Revoke research-bot?" with "2 active keys will stop working immediately." Cancel / Revoke (danger fill). Row becomes a "Revoked" chip; the row action disappears.
- Trash toast mentions the share consequence like Drive's "shared files stop being visible": "Moved b.txt to Trash. Its share links stop working. Undo." (only when the file has shares; TBD whether the list payload carries that).
- Versions as a modal list (kept as a dialog, matching Dropbox's panel content): "Current version · today 14:02 · 4.2 KB · research-bot" then "Version 2 · yesterday ...". UUID removed. Single-version file: "This is the current version. Older versions appear here after the file changes."
- Receipt: follows GitHub's "Download recovery codes" pattern: key in a code box with an adjacent Copy button, one orange "Save recovery key", checkbox, and a disabled-looking secondary "Continue" that becomes enabled after ticking.

## Files
apps/web/app/(app)/console/console.tsx, console.css (.toast, .row-menu, hover reveal with `@media (hover:none)` always visible), globals.css (--danger).

## Effort and risk
M. Risk: hover-only icons hurt discoverability and keyboard use, so both Download and the `⋮` button stay visible at all times (no hover-only reveal). Gmail-style no-confirm trash relies on Undo working: capture drive id and path, and handle the 8 s window across tab switches.

## Acceptance criteria
1. Snackbar naming the file with Undo, bottom-left, under 100 ms, 8 s: yes.
2. One primary plus `⋮` menu, Trash behind it, 32/44 px: yes.
3. "Restored x · Show file location": yes.
4. Named revoke modal with key count; in-place "Revoked": yes.
5. Versions list with date, size, author, no UUID, current-version message: yes.
6. Receipt: orange Save, Copy beside key, secondary Continue until ticked: yes.

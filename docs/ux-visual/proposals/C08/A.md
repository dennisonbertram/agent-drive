# C08-A Minimal: Share row action, one dialog, one list dialog

Effort: M. Files: `apps/web/app/(app)/console/console.tsx` (new `share` and `shares` modal values, `createShare`, `loadShares`, `revokeShare`), `apps/web/app/styles/console.css` (row-actions already styles buttons), `console-panels.css` (reuse `.form-stack`, `.version-row`, `.banner`). No new API.

## Feasibility (checked in code)
The CLI does it in `packages/agent-drive/src/client.ts` `createShare`: GET `drives/:id/get?path=..&metadataOnly=1` returns `{id, wrappedKey}`; `unwrapFileKey(wrappedKey, driveKey)` (in `packages/agent-drive/src/crypto.ts`) yields the 43-char file key; POST `drives/:id/shares` with `{path, versionId, expiresAt}`; the URL is `<origin>/s/<shareId>#k=<fileKey>`. The console already imports `decryptFile` from that file and holds `driveKeys[selected]`, and its `api()` reaches the same handler, so the browser can do exactly this. The console session has the `share` scope (`scopeNames` in `handler.ts`). Expiry limit by the server: 60 s to 30 days, default 7 days.
Encryption implication: the file key goes only into the URL fragment, which browsers do not send to the server; the server stores no key. The key exists in page memory while the dialog is open. `GET shares` returns no URL, so the list cannot re-copy old links: only a link created in this session can be copied.

## Change
1. Row actions become Download, Share, Versions, Trash. Share is a normal row button (not disabled without a key; see 4).
2. Share dialog (`Dialog title="Share <file name>"`):
```
 Share inbox/2026-11-01.jsonl
 Link expires   [ 7 days v ]   (1 hour, 24 hours, 7 days, 30 days)
 Anyone with the link can read this version, until it expires or you revoke it.
 [ Copy link ]                       <- primary: creates, then copies
```
After success: the URL shows in a read-only field with "Copied. Expires Nov 13" and the button reads "Copy again"; the toast (existing `notice` slot) says "Link copied". If clipboard write fails (Safari after an await), the field is selected and the button becomes "Copy link" again for a second click.
3. Shared links: a secondary button "Shared links (n)" in the file panel header beside Filter opens a dialog listing rows: File, Created, Expires, Status (Active, Expired, Revoked, File in Trash), Revoke. Revoke opens the existing confirm pattern: "Revoke the link to inbox/x? People with it will no longer be able to open it." On confirm the row status changes to Revoked in place.
4. No key: Share calls `open('unlock')` with a stored `pendingAction='share:<path>'`; after Load key the share dialog opens (same unlock prompt as Download, C05).
5. Trash: before `delete`, count active shares for the path from the loaded list; the toast becomes "Moved x to Trash. 2 share links stop working; restoring the file turns them back on." (shares become `unavailable`, not revoked, per `handler.ts` status CASE.)

## Clicks from a populated drive
Share (1), Copy link (2). Two clicks. 

## Acceptance
1. Dialog, default 7 days, full URL with `#k=` copied, toast "Link copied". Met. 2. List with the five columns, confirm naming the file, in-place update. Met. 3. Met by item 4. 4. Met by item 5. 5. 2 clicks. Met.

## Risks
Shares list is paginated (100) and has no per-path filter, so the trash count needs a fetch of all pages; do it lazily when the Trash button is clicked. The row would have four buttons at 390 px; the mobile card layout already wraps actions. Clipboard-after-await needs the ClipboardItem promise form.

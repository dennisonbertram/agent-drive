# C08-C Convention: Share dialog like Drive and Dropbox, plus a Shared page

Effort: L. Files: `console.tsx` (a sixth nav item or a section of Files), `console.css`, `console-panels.css`.

## What others do

- Google Drive: Share button opens a dialog titled "Share <file>"; "General access" row with a dropdown; "Copy link" at the bottom-left; expiry is on the people row.
- Dropbox: "Share" opens "Create link"; settings (who can view, expiry date) sit under a gear; "Shared" in the left nav lists links with "Delete link".
- Box: a "Shared link" toggle in the file's Share dialog, with link settings.
- iCloud Drive: Share, then "Manage Shared File" with "Stop sharing".
- GitHub and Vercel: revoke names the thing being revoked and asks once.

## Change

1. Row action: Share (icon plus label at wide widths, label only on mobile).
2. Dialog follows Google's layout: title, one setting row "Link expires [ 7 days v ]", the sentence "Anyone with the link can read this version", and the bottom bar `Copy link` (primary, left) and `Done` (right). Copy creates and copies (same crypto path as the CLI: metadata GET, `unwrapFileKey`, POST shares, URL with `#k=`).
3. Left nav gets `Shared` between Files and Agents (count badge), as in Dropbox. The page is a table: File, Created, Expires, Status, Revoke. Because the server stores no URL, rows say "Link copied at creation only" in the empty/help line; to re-share, use Share on the file.
4. Revoke: confirm dialog "Revoke the link to inbox/x? Anyone using it loses access."
5. Unlock prompt reused when no key. Trash toast names live links.

## Acceptance

1. Met (copy full URL, "Link copied"). 2. Met (Shared page, named confirm, in place). 3. Met. 4. Trash toast "2 share links stop working while this is in Trash." Met. 5. Share (1), Copy link (2). Met.

## Risks

Largest build: a new nav item and page, conflicts with the ux-flow decision to reduce tabs (Agents and API keys merging). The nav item might be better as a section of the Files page (that is B). Encryption notes as in A: the key stays in the fragment; the page cannot reproduce old URLs.

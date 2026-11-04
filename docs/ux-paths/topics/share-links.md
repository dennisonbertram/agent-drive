# Topic 7: Share links end to end

Source: `packages/agent-drive/src/cli.ts` (`share`, `share list`, `share revoke`, `parseShareExpiry`), `client.ts` (`createShare`, `listShares`, `revokeShare`), `mcp.ts` (`share` tool), `apps/web/src/api/handler.ts` (`shareEndpoint`, `revokeShare`, `handlePublicShareRequest`), `apps/web/app/s/[id]/share-client.tsx`. Facts that shape every story: there is NO share UI in the console (no button, no list, no revoke); the link is `https://agent-drive.vercel.app/s/<22-char id>#k=<file key>`; the file key is in the fragment and is never stored server-side, so `share list` cannot reproduce a URL; a share pins one version; default expiry 7 days (60 s to 30 d at the API, `--expires-in` 2m to 30d at the CLI); creating needs API-key scopes `share` and `read`, plus the drive key locally; MCP lacks list/revoke.

## STORY-001: Agent shares a report with a client using the CLI

**Type**: short
**Topic**: Share links
**Persona**: Leila Haddad, a consultant whose agent produced `/reports/result.csv` that she must send to a client with no Agent Drive account.
**Goal**: Get a link the client can open.
**Preconditions**: CLI logged in with a key holding `read` and `share`; `AGENT_DRIVE_KEY` set; file exists.
**Ideal path**: 1 — one command returns a ready link.
**Alternate paths**: MCP `share` tool (agent asks Claude to share it, `expiresAt` ISO); REST `POST /api/v1/drives/:id/shares` (then she must assemble `#k=` herself, not practical); console cannot create shares; sending the file via `get --output` and email defeats the encryption model.

### Steps

1. Run `agent-drive share /reports/result.csv --drive DRIVE_ID --expires-in 24h` → JSON output with `id`, `path`, `versionId`, `expiresAt`, and `url` of the form `https://agent-drive.vercel.app/s/<id>#k=<43 chars>`.
2. Copy the `url` value, including everything after `#` → Link ready to paste.
3. Paste into an email to the client → Client can open it.

### Variations

- Omit `--expires-in` → 7-day default expiry (server side), not announced in the CLI output except through `expiresAt`.
- `--version VERSION_ID` pins an older version.

### Edge Cases

- Output is raw JSON, not a bare URL; she must pick the `url` field out (hesitation: copying the whole JSON line breaks the link).
- The URL carries a secret; shell history and terminal scrollback keep it.
- The file key and the drive key are different; the share exposes only this file's key.

## STORY-002: Choosing an expiry that the CLI rejects

**Type**: short
**Topic**: Share links
**Persona**: Ravi Subramanian, wants a link that dies in 1 minute for a quick pairing handoff.
**Goal**: Create a very short-lived link.
**Preconditions**: As STORY-001.
**Ideal path**: 1 — accept `1m` directly.
**Alternate paths**: MCP `share` accepts `expiresAt` as an ISO timestamp as little as 60 seconds out, so MCP allows what the CLI forbids; REST same.

### Steps

1. Run `agent-drive share /work/t-9/key-notes.md --drive DRIVE_ID --expires-in 1m` → Error: "--expires-in must be between 2m and 30d to allow for API request transit (API minimum: 60 seconds)."
2. Retry with `--expires-in 2m` → Link created with `expiresAt` ~2 minutes ahead.
3. Retry mistakenly with `--expires-in 2 hours` → Error: "--expires-in must use a duration such as 30m, 24h, or 7d."
4. Retry `--expires-in 2h` → Success.

### Variations

- `--expires-in 45d` → same range error (max 30d).
- `--expires-in 1w` → format error (only m, h, d).

### Edge Cases

- A 2m link can already be unusable to the recipient by the time they open it; downloads are refused when under 1 second remains ("This share link is too close to expiry to download." at API level).
- Inconsistent limits between CLI (2m) and API/MCP (60 s) are documented only in the error text.

## STORY-003: Share fails for a key lacking the right scope

**Type**: short
**Topic**: Share links
**Persona**: Mateo Silva, a junior dev using a key a teammate created with default scopes.
**Goal**: Share `/outputs/demo.mp4`.
**Preconditions**: API key scopes are `read, write` (the key-create default); drive key loaded.
**Ideal path**: 2 — discover the missing scope and ask for a new key.
**Alternate paths**: Human creates a new key in console API keys tab ("+ New API key", tick "share" under Permissions) or `agent-drive key create --scope share`.

### Steps

1. Run `agent-drive share /outputs/demo.mp4 --drive DRIVE_ID` → stderr permission error naming the missing `share` scope (forbidden from the `need(auth, 'share', ...)` check).
2. Ask the owner to create a replacement key; the owner opens Console, API keys tab, "+ New API key", ticks `read` and `share` → Key receipt "This secret is shown only once".
3. Mateo runs `agent-drive login` with the new key, then repeats the share → Link returned.

### Variations

- Key has `share` but not `read`: creation also requires `read` (`need(auth, 'read', ...)`), so error again.

### Edge Cases

- Scopes cannot be edited on an existing key; only revoke + recreate (rotation flow in the connection guide).
- Wrong drive key: `createShare` unwraps the file key locally and fails with "Unable to decrypt: the drive key is wrong..." before any share row is created.

## STORY-004: Recipient opens the link and downloads the file

**Type**: medium
**Topic**: Share links
**Persona**: Grace Whitfield, a non-technical client at a law firm, receives the link by email on her work laptop, no Agent Drive account.
**Goal**: Save `result.csv` to her computer.
**Preconditions**: Valid active share link, complete with `#k=`.
**Ideal path**: 2 — open link, click Download.
**Alternate paths**: none for the recipient (no preview, no account route); sender could instead hand over the file via `get --output`.

### Steps

1. Click the link `https://agent-drive.vercel.app/s/<id>#k=...` → Page titled "Encrypted share · Agent Drive": eyebrow "ENCRYPTED FILE TRANSFER", heading "Opening secure link" with "Checking this share link…".
2. Metadata loads → Heading becomes the file name `result.csv`; details "TRANSFER SIZE" (e.g. "5,160 encrypted bytes", not human units) and "LINK EXPIRES" (local date/time).
3. Read "Your browser decrypts this file. No sign-in required." → Reassurance; footer "Client-side encryption. The key stays in your browser."
4. Hesitate: "encrypted bytes" size reads oddly vs the real file size (ciphertext size shown) → Proceeds anyway.
5. Click "Download" → Button shows "Decrypting…" while disabled.
6. Browser saves `result.csv` → No success message on the page; the only feedback is the browser's own download bar.

### Variations

- Mobile Safari: blob download via `link.click()` may open instead of save (rendering differences).
- Grace clicks Download twice after a slow response: button disabled while busy prevents a double start.

### Edge Cases

- The page issues one metadata request on load and a second request on Download that fetches the presigned URL (valid <= 60 s), so a long idle page still works while the link is valid.
- Each access counts as an operation against the owner's allowance and is audited (`share.access`).
- The saved name is the last path segment; the folder path is not shown to her.
- Content type is `application/octet-stream`; the browser will not open it inline.

## STORY-005: Link broken by a chat app or email client (missing key)

**Type**: medium
**Topic**: Share links
**Persona**: Owen Fitzgerald, who pasted the link into a ticketing tool that trimmed everything after `#`.
**Goal**: Understand why the recipient cannot open the file and fix it.
**Preconditions**: Share created; recipient got `https://agent-drive.vercel.app/s/<id>` with no fragment (or with a corrupted fragment).
**Ideal path**: 3 — message the sender, resend full link, open.
**Alternate paths**: Re-run `agent-drive share` for a new link (old one remains valid with the same id but is useless without its key; old link cannot be re-obtained from `share list`).

### Steps

1. Recipient opens `/s/<id>` without `#k=` → Heading "This link is missing a valid decryption key"; body "Ask the sender for the complete link, including everything after the # symbol."
2. Recipient replies to Owen → Out-of-band step.
3. Owen runs `agent-drive share list --drive DRIVE_ID` hoping to copy the URL → JSON items with `id`, `path`, `versionId`, `expiresAt`, `revokedAt`, `createdAt`, `status`; there is NO `url` field (key is not stored).
4. Owen realises he must re-create it: `agent-drive share /reports/result.csv --drive DRIVE_ID --expires-in 24h` → New link with fresh id and key.
5. Owen revokes the broken one: `agent-drive share revoke OLD_SHARE_ID --drive DRIVE_ID` → JSON with `id` and `revokedAt`.
6. Sends the new link in a code block or as an attachment text → Recipient opens successfully.

### Variations

- A wrong-but-well-formed key (one character changed) → the metadata loads and shows the file name, then on Download the heading becomes "This link's key can't decrypt this file" with "Ask the sender for the complete link, including everything after the # symbol."
- Malformed id (not 22 chars) → "Share link not found".

### Edge Cases

- With a missing key the page never calls the server; it cannot tell the visitor whether the link is also expired or revoked.
- A trailing `.` or `)` pasted from chat can make the key non-canonical, producing the same missing-key heading.
- The same message ("missing key") has two spellings: heading without a period, and the fallback text "This link is missing a valid decryption key." internally.

## STORY-006: Expired and revoked links from the recipient's side

**Type**: medium
**Topic**: Share links
**Persona**: Beatrice Lang, a recipient who opens the same bookmarked link three days apart, once after the sender revoked it.
**Goal**: Know whether the link will ever work again.
**Preconditions**: Share A has a 24h expiry; share B was revoked by the sender; share C's file was later trashed.
**Ideal path**: 1 — see an unambiguous state heading.
**Alternate paths**: none for recipient; sender runs `share list` to see the `status` (`active`, `expired`, `revoked`, `unavailable`).

### Steps

1. Open link A after 24h → Heading "Share link expired"; body "Ask the sender for a new share link. Your files have not been changed."
2. Open link B → Heading "Share link revoked"; same body.
3. Open link C (file moved to Trash by the owner) → Heading "Shared file unavailable"; same body.
4. Open a link with a typo in the id → Heading "Share link not found".
5. Beatrice emails the sender → Out-of-band.
6. Sender runs `agent-drive share list --drive DRIVE_ID` → Row for C shows `"status": "unavailable"`.
7. Sender restores the file (console Trash tab "Restore", or `agent-drive restore /reports/result.csv --drive DRIVE_ID`) → The file is live again.
8. Beatrice reloads link C → Works again (the share pointed at a still-existing file row and pinned version).

### Variations

- Download was started right at the expiry edge → page shows the "Share link expired" heading after the click, replacing the file name view.

### Edge Cases

- All four terminal states share the identical body text, even though only "not found/expired/revoked" really need a new link; "unavailable" may recover without one.
- Expired shares are never auto-removed from `share list`; they stay with `status: expired`.
- Link-on-wrong-protocol: `http://agent-drive.vercel.app/s/<id>` in production returns plain text "HTTPS is required for share links." (403) with no styling.
- A deleted drive or account makes the link return "Share link not found" (shares revoked/joined away).

## STORY-007: Sender audits and revokes shares after a mistaken send

**Type**: medium
**Topic**: Share links
**Persona**: Nikhil Desai, who just realised he emailed a link to `/finance/payroll.xlsx` to the wrong "Sam".
**Goal**: Kill the link immediately and verify.
**Preconditions**: CLI logged in with `share` scope; several shares exist, only some belong to payroll.
**Ideal path**: 2 — revoke by id; but he needs the id first, which he can read from the URL path.
**Alternate paths**: The id is the 22-character segment after `/s/` in the link itself, so he can revoke without listing; `share list` is the only way to find ids if he lost the URL; console Audit log (/console/settings "Audit log") shows `share.create` / `share.revoke` actions but no paths.

### Steps

1. Run `agent-drive share list --drive DRIVE_ID` → JSON page of shares with `path` and `status`; he scans for `/finance/payroll.xlsx`.
2. Hesitate: several rows, one for an older payroll file → Compares `createdAt` and `expiresAt`.
3. Run `agent-drive share revoke SHARE_ID --drive DRIVE_ID` → `{ "id": "...", "revokedAt": "..." }`.
4. Run `agent-drive share list --drive DRIVE_ID` again → That row now `"status": "revoked"`.
5. Open the link in a private window → Heading "Share link revoked".
6. Check the Audit log at /console/settings → Rows for `share.access` events exist if the wrong recipient already opened it, with Actor and Result but no IP/file detail (metadata only).

### Variations

- List is long: use `--limit` and `--cursor` for pages.
- MCP-only agent: cannot list or revoke (no tools); must use CLI or REST.

### Edge Cases

- Revoking an already revoked id succeeds idempotently (`COALESCE`), while an unknown id returns "Share not found."
- If the recipient already downloaded, revocation cannot undo it; the product does not say so.
- Revoke needs the `share` scope only; the human console has no equivalent button, so a human owner without a CLI cannot revoke from the web UI.

## STORY-008: Share through an MCP agent and a pinned older version

**Type**: medium
**Topic**: Share links
**Persona**: Yuki Tanaka, using Claude Code with the agent-drive MCP server, asking the agent to share the last good draft.
**Goal**: Produce a link to version 2 of `/outputs/draft.md`, not the current (bad) version.
**Preconditions**: MCP configured and restarted; key has `read`+`share`; drive key in env; file has 3 versions.
**Ideal path**: 3 — versions, share with versionId, send.
**Alternate paths**: CLI `agent-drive versions /outputs/draft.md --drive ID` then `agent-drive share /outputs/draft.md --drive ID --version VERSION_ID`; or restore the good version first and share the current one.

### Steps

1. In Claude Code, ask: "List versions of /outputs/draft.md" → MCP `versions` returns ids, dates, authors.
2. Choose the second id → Noted.
3. Ask: "Share that version for 3 days" → Agent calls MCP `share` with `driveId`, `path`, `versionId`, `expiresAt` (agent computes the ISO timestamp, no relative duration parameter).
4. Result contains `url` → Agent prints the link.
5. Yuki opens the link in a browser → Name `draft.md`; Download gives the version-2 content, even though the current version is newer.
6. Later the agent overwrites the file again → Link still serves version 2 (pinned).

### Variations

- Omitting versionId pins the version current at creation, not "latest".
- MCP session started before key scope change: restart needed.

### Edge Cases

- MCP `expiresAt` must be an ISO datetime; relative forms like "3d" are CLI-only, so the model must do date math.
- No MCP tool to revoke: Yuki must leave the assistant for the CLI.
- The pinned old version continues to count toward storage and cannot be deleted individually.

## STORY-009: Weekly report distribution: create, send, monitor, expire, and clean up

**Type**: long
**Topic**: Share links
**Persona**: Amara Nwosu, chief of staff. Each Friday an agent writes `/reports/2026-W45/summary.pdf`; Amara shares it with three external partners, checks who it was sent to, handles one broken link, revokes one, and confirms the rest expire on schedule.
**Goal**: Distribute securely and leave no lingering access.
**Preconditions**: CLI on Amara's laptop with `read`+`share` key and drive key env; console access for oversight; three partners (Ben, Chidi, Dee) with no accounts.
**Ideal path**: 8 — share (1), send (3), check status (1), revoke/verify (3).
**Alternate paths**: One shared link to all three (loses per-recipient revocation); `get --output` and email attachment (plaintext leaves the encrypted model); MCP `share` for creation only.

### Steps

1. In the console Files tab confirm `/reports/2026-W45/summary.pdf` exists (name, size, author "Research assistant") → Visible without a key.
2. Run `agent-drive share /reports/2026-W45/summary.pdf --drive DRIVE_ID --expires-in 72h` for Ben → Link 1.
3. Run again for Chidi → Link 2 (new id, same key content for the same file key).
4. Run again for Dee → Link 3.
5. Send each link by email, one per person → Three messages.
6. Chidi replies "page says missing a valid decryption key" → His mail client dropped the fragment.
7. Amara asks him to copy the link from the plain-text view; he retries → Page shows `summary.pdf`, TRANSFER SIZE, LINK EXPIRES.
8. Chidi clicks "Download" → "Decrypting…", file saves.
9. Dee replies the next day that her link "expired" → The 72h window passed on Monday; heading "Share link expired" (she waited over the weekend).
10. Amara runs `agent-drive share list --drive DRIVE_ID --limit 10` → Three rows plus older ones; statuses `active`, `active`, `expired`.
11. She matches ids to partners by creation order (no label/recipient field exists) → Ambiguity: she must remember which id is whose.
12. Ben says he has finished; Amara runs `agent-drive share revoke BEN_SHARE_ID --drive DRIVE_ID` → `revokedAt` printed.
13. Re-run `share list` → Ben `revoked`, Chidi `active`, Dee `expired`.
14. Create a fresh 24h link for Dee → Link 4 sent.
15. Open Settings: /console/settings → "Audit log" shows `share.create` x4, `share.access` entries, `share.revoke` x1, Actor labelled by key/agent.
16. Next Friday the file is overwritten with `put --overwrite`; Amara notes existing links still show last week's version (pinned) → Needs new links each week.
17. Trash the old report in the console (Files, "Trash") for tidiness → Notice absent; row disappears. Links to it now show "Shared file unavailable".
18. Restore it later via the Trash tab "Restore" → Links resume if not expired/revoked.

### Variations

- 25 partners: no bulk create or revoke; loop in shell.
- Using `--expires-in 30d` to avoid weekly work lengthens exposure.

### Edge Cases

- No label or recipient on a share: `share list` shows only path/status, so mapping ids to people is manual.
- Three links to the same file share the same file key in the fragment; revoking one id does not change the key, so anyone who also has the key and another valid id still works.
- Audit log is owner-only and metadata-only; it does not show which partner opened which link.
- Step 17: trashing silently breaks every outstanding link, and the console confirm dialog ("Move /reports/... to trash?") does not mention active shares.

## STORY-010: Rate-limit, quota and upgrade problems during a share-heavy day

**Type**: medium
**Topic**: Share links
**Persona**: Pablo Ortega, a Free-plan owner whose partners all download a 4 GiB file on the same day.
**Goal**: Understand why a recipient sees "Share unavailable" and fix the plan.
**Preconditions**: Free plan: 5 GiB downloads/month; share of a 4 GiB file opened by three people; egress metering for R2 shows "Not charged".
**Ideal path**: 3 — see the clear error, upgrade, retry.
**Alternate paths**: Billing & limits (/console/billing) "Choose developer"; Usage tab EGRESS & COST shows downloads; CLI shows `Upgrade: <url>` lines for the sender but the recipient sees none.

### Steps

1. Partner 3 opens the link and clicks "Download" → Server refuses authorization (quota or payment-required from `authorizeDownload`); page shows heading "Share unavailable" (fallback) with the API's message.
2. Partner texts Pablo → Out-of-band.
3. Pablo opens Console Usage tab → Sees EGRESS & COST consumption vs the plan.
4. Pablo goes to "Billing & limits" and reviews plans; paid checkout may show "Paid checkout is not enabled" in test mode → Cannot upgrade immediately.
5. He tells partner to retry next month or send a smaller file → Workaround.

### Variations

- Operation allowance exhausted instead of bandwidth: even the metadata load fails with an error message.

### Edge Cases

- The recipient is told "Ask the sender for a new share link. Your files have not been changed." which is the wrong remedy for a quota problem; no Retry-After or upgrade hint is shown to anonymous visitors.
- The page heading "Share unavailable" lacks the specific reason except in internal state; the displayed body is the generic fallback.
- Sender-side `Upgrade:` URL appears only for authenticated API calls, never on the public page.

# Topic: Sharing

Sources read: `cli.ts` (share, share list, share revoke, parseShareExpiry), `client.ts` (createShare, listShares, revokeShare, publicOutput), `mcp.ts` (share tool), `handler.ts` (shares POST/GET, revokeShare, public share fetch), `app/s/[id]/share-client.tsx`, `llms.txt/route.ts`.

Facts the stories rely on:
- Create: `agent-drive share PATH [--drive ID] [--version ID] [--expires-in 30m|24h|7d]`. CLI accepts 2 minutes to 30 days; the server accepts 60 seconds to 30 days. If no expiry is given, the server uses 7 days. The command needs the drive key on the machine (it unwraps the file key) and the `read` scope; revoking needs the `share` scope.
- Output is JSON: `id`, `path`, `versionId`, `expiresAt`, `url` where `url` is `<origin>/s/<id>#k=<file key>`. The key sits in the fragment, so the server never sees it.
- `share list` shows id, path, versionId, expiresAt, revokedAt, createdAt, `status` (active, expired, revoked, unavailable). It does not show the link or the key, so a lost link cannot be recovered; the agent must create a new share.
- `share revoke SHARE_ID` sets `revokedAt` and returns `{ id, revokedAt }`. Revoking twice is harmless. Unknown id returns "Share not found."
- MCP has only `share` (create; `expiresAt` as an ISO timestamp). List and revoke are CLI-only.
- Recipient page `/s/<id>#k=...`: heading is the file name, "TRANSFER SIZE ... encrypted", "LINK EXPIRES ...", button "Download" ("Decrypting…" while busy), footer "Your browser decrypts this file and the key never leaves it. No sign-in required."
- Console: no way to create, list or revoke shares (gap). Share events appear in the audit log only as `share.create` / `share.revoke` rows.
- Deleting a drive or the account revokes its shares. Moving a file to trash makes its shares "unavailable" for recipients.

---

## STORY-041: Agent creates a 24-hour link for a report
**Type**: short
**Topic**: Sharing
**Persona**: "report-bot" for Dana Ruiz, who needs to send a client `/reports/q3-summary.pdf` by email.
**Goal**: Produce a link that works for a day and then dies.
**Preconditions**: File exists; agent key has `read`; drive key on this machine; single default drive.
**Ideal path**: 1 — one command returns the link.
**Alternate paths**: MCP `share` tool with `path` and `expiresAt`.
### Steps
1. Run `agent-drive share /reports/q3-summary.pdf --expires-in 24h` → JSON with `id: "kP3x...22 chars"`, `expiresAt` one day ahead, `url: "https://agentdrive.example/s/kP3x...#k=..."`.
2. Agent gives Dana the whole `url` string, including everything after `#`.
### Variations
- Omits `--expires-in` → link lasts 7 days (server default); llms.txt example uses 24h so many agents set it.
- `--expires-in 1h30m` → "--expires-in must use a duration such as 30m, 24h, or 7d."
- `--expires-in 45d` → error that it must be between 2m and 30d.
- `--expires-in 1m` → CLI refuses (2m minimum), although the API itself would allow 60 seconds.
- Through MCP, the agent has to compute an ISO timestamp itself.
### Edge Cases
- Path that does not exist or is in the trash → "File not found."
- Wrong path case (`/Reports/...`) → not found.
- File holds a secret: llms.txt rule says never share files that contain secrets; nothing in the tool checks this.
- `--version` of an older version shares that version, not the latest.

## STORY-042: Recipient opens a valid link
**Type**: short
**Topic**: Sharing
**Persona**: Tomas Berg, a client with no account, opens Dana's email on his phone.
**Goal**: Download the PDF.
**Preconditions**: Active link with complete fragment.
**Ideal path**: 2 — open link, tap Download.
**Alternate paths**: none found (no preview, no "open in browser").
### Steps
1. Taps the link `.../s/kP3x...#k=...` → page shows "Checking this share link…" then card "ENCRYPTED FILE TRANSFER" with the file name `q3-summary.pdf`, "TRANSFER SIZE 2.4 MB encrypted", "LINK EXPIRES Nov 7, 2026, 4:15 PM PST".
2. Taps "Download" → button reads "Decrypting…", then the browser saves `q3-summary.pdf`.
### Variations
- Tomas hesitates: the size says "encrypted", and he wonders whether the file will open; nothing explains this beyond the footer.
- He taps Download twice; the button is disabled while busy.
- Large file (about 1 GB): the whole ciphertext is loaded into memory before decrypting; the phone may stall (the page shows no progress bar).
### Edge Cases
- Name shown is the last path segment only; the folder is not revealed.
- Expiry shown in the viewer's local time zone.
- Page is `noindex`.
- Download is metered as egress against Dana's plan.

## STORY-043: Recipient has a link with the key cut off
**Type**: medium
**Topic**: Sharing
**Persona**: Tomas copies the link out of a chat app that dropped everything after `#`.
**Goal**: Get the file anyway.
**Preconditions**: Share active; Tomas has `https://.../s/kP3x...` only.
**Ideal path**: 3 — see the error, paste the full link, download.
**Alternate paths**: Ask Dana for the link again.
### Steps
1. Opens the shortened link → heading "This link is missing a valid decryption key"; body "Ask the sender for the complete link, including everything after the # symbol." and a field "Paste the full share link" with button "Use link" (disabled until text is typed).
2. Messages Dana; she resends the full link in an email.
3. Pastes it into the field and clicks "Use link" → page updates the fragment in place, loads the file card.
4. Clicks "Download" → file saves.
### Variations
- Pastes a link for a different share → "That link is for a different share. Paste the link for this file."
- Pastes plain text → "That is not a full link. Paste the whole address, starting with https://."
- Pastes the right path without a key → "That link does not include a valid key after the # symbol."
- Pastes a link with a wrong but well-formed key → the card loads, then Download shows "This link's key can't decrypt this file" with the same paste form.
### Edge Cases
- While the page hydrates it shows loading, not the missing-key error.
- No request is sent to the server before a key is present (page fetches metadata only when the fragment is valid).
- Problem text is announced to screen readers (role alert).

## STORY-044: Recipient finds a link expired or revoked
**Type**: medium
**Topic**: Sharing
**Persona**: Aisha Karim opens a link Dana sent two days ago (24h expiry). Another recipient opens a link Dana revoked this morning.
**Goal**: Understand why it fails and what to do.
**Preconditions**: One share past `expiresAt`; one revoked.
**Ideal path**: 2 — open link, read the error, contact sender.
**Alternate paths**: none found (recipient cannot request a new link from the page).
### Steps
1. Aisha opens the expired link → heading "Share link expired"; body "This link passed its expiry date. Ask the sender for a new link."
2. She emails Dana; Dana asks the agent to create a new link.
3. The second recipient opens the revoked link → heading "Share link revoked"; body "The sender turned this link off. Ask them for a new link if you still need the file."
### Variations
- Link opened a few seconds before expiry: the card loads, but Download shows "Share link expired" because less than one second remains.
- Expiry or revocation happens between loading the card and pressing Download → error replaces the card.
- Recipient edits the id by one character → "Share link not found" with "This link does not match any shared file. Check the address, or ask the sender for a new link."
### Edge Cases
- File moved to trash after sharing → "Shared file unavailable".
- Sender's drive or account deleted → shares are revoked.
- Network failure → "Share unavailable" with "Try again".
- Both expired and revoked: revoked wins.
- Error pages for these cases have no key-paste form (only the two key-related errors do).

## STORY-045: Agent lists shares and revokes one
**Type**: medium
**Topic**: Sharing
**Persona**: "report-bot" after Dana says "I sent the wrong file to the client, turn it off".
**Goal**: Find the share for `/reports/q3-draft.pdf` and revoke it.
**Preconditions**: Four shares exist, two on the draft; key has `share` scope.
**Ideal path**: 2 — list, revoke.
**Alternate paths**: none for humans in the console (gap).
### Steps
1. Run `agent-drive share list` → `items` with id, path, expiresAt, revokedAt, status for each share, in creation order (oldest first).
2. Agent picks the two items with path `/reports/q3-draft.pdf` and status `active`.
3. Run `agent-drive share revoke kP3xAb...` for each → `{ id, revokedAt }`.
4. Run `agent-drive share list` again → both show status `revoked`.
### Variations
- Agent first tries `agent-drive share revoke /reports/q3-draft.pdf` with a path → "Share not found."; revoke takes the id.
- Agent has `read`/`write` only → scope-denied error on revoke.
- Agent cannot see which link was sent to whom; the list holds no recipient or note.
- Agent forgets `--drive` with two drives → asked for `--drive`.
### Edge Cases
- Revoking twice keeps the first revoke time.
- More than 50 shares: follow `nextCursor`; old expired shares stay in the list, newest are last (gap: no filter by status or path).
- `share list` does not return links, so to replace a link the agent must run `share` again.

## STORY-046: Human wants to share a file from the console
**Type**: medium
**Topic**: Sharing
**Persona**: Maya Okafor wants to send a contract PDF from her drive to her lawyer, and expects a "Share" button as in Google Drive.
**Goal**: Create a link for the lawyer.
**Preconditions**: Signed in, Files tab, drive key loaded; file `/contracts/lease-2026.pdf` visible.
**Ideal path**: 3 — click Share on the row, pick expiry, copy link.
**Alternate paths**: Ask her agent: "Share /contracts/lease-2026.pdf for 3 days" (works through MCP `share` or the CLI); or download the file in the console and send it by email.
### Steps
1. Looks at the row actions → Download, Versions, Trash; no Share (gap).
2. Opens Agents tab and API keys tab looking for "sharing" settings → none.
3. Opens "Activity & deletion" → only audit rows; no shares section (gap).
4. Searches the landing and llms.txt text and finds `agent-drive share` documented only for agents.
5. Asks the agent in chat; agent runs `agent-drive share /contracts/lease-2026.pdf --expires-in 72h` → pastes the `url`.
### Variations
- Maya downloads the file (console decrypts in the browser) and attaches it to email; works but loses expiry and revocation.
- Maya pastes a drive key or recovery file to the lawyer; this exposes the whole drive and is the wrong way to share.
- Maya hits Trash on the file by mistake while looking for options; no confirmation, notice "Moved /contracts/lease-2026.pdf to Trash. Restore it from the Trash tab."
### Edge Cases
- She cannot see or revoke existing links from the console; to stop a link she must ask the agent.
- Agent whose key lacks `read` scope or the drive key cannot create a link.
- Trashing a file makes its links dead, with no warning in the console.

## STORY-047: Agent shares from an MCP session, then checks the audit trail
**Type**: long
**Topic**: Sharing
**Persona**: Claude Code with the Agent Drive MCP server, working for Sam Whitfield, who then asks "who has been downloading that file?".
**Goal**: Create a link through MCP, and let the owner verify share activity.
**Preconditions**: MCP server running; drive key available through config; Sam signed in to the console.
**Ideal path**: 3 — create, send, check.
**Alternate paths**: `agent-drive share list` shows status, not downloads.
### Steps
1. Agent calls MCP `share` with `{ driveId, path: "/exports/users-2026-11.csv", expiresAt: "2026-11-08T12:00:00Z" }` → result with `id`, `expiresAt`, `url` containing `#k=`.
2. Agent shows Sam the full url and warns the file will be public to anyone with the link.
3. Sam later asks about downloads; agent calls MCP tools but there is no share list or download count in MCP (gap), so it falls back to the shell: `agent-drive share list`.
4. Output has `status: "active"` and no download counts.
5. Sam opens Activity & deletion → looks for `share.create` row for the agent, finds it with Result success / HTTP 201; public downloads show as "Public / unauthenticated" rows, with no way to tell which share.
### Variations
- The agent's `expiresAt` is in the past → "expiresAt must be between 60 seconds and 30 days from now."
- Timestamp without a time zone (`2026-11-08T12:00:00`) → "expiresAt must be an ISO timestamp."
- Sam asks to revoke; MCP has no revoke tool, so the agent uses the CLI.
### Edge Cases
- Chat transcript stores the full url (including the key); revoking the share is the only way to cut access.
- `expiresAt` over 30 days → validation error.
- Link works for non-signed-in users, so anyone who sees the transcript can download until expiry.

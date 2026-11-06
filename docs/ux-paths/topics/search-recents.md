# Topic: Search, recents and activity

Sources read: `packages/agent-drive/src/cli.ts` (ls, search, recent), `client.ts` (list, search, recent, waitForRecent), `mcp.ts` (search, recent tools), `apps/web/src/api/handler.ts` (list, search, recent, audit, appendFileFilters), `console.tsx` (filter box, Load more files), `settings-client.tsx` (Audit log).

Facts the stories rely on:
- `search --query` is a case-insensitive substring match on the file path only. It does not search descriptions, tags or file contents. `search` with no options lists every current file (same result shape as `ls`, but each item is a full version record).
- `ls` has `--prefix` plus `--tag/--agent/--machine/--user`; it has no `--query`. Only the first `--tag` is used by `ls` and `search` (the CLI reads `args.values.tag[0]`).
- Default page size is 50. Results are JSON on stdout; the `nextCursor` value is passed back with `--cursor`.
- `recent` returns events (put, copy, restore, move, delete) ordered oldest first by sequence number. Without `--since` or `--cursor` it starts at the beginning of the drive's history. `latestCursor` is what to pass next time. `--since` is ignored when `--cursor` is present.
- `recent --wait N` (CLI: 1-300 seconds; MCP `waitSeconds`: 1-30) polls every 2 seconds and returns as soon as one event exists. Each poll is one metered `drive.recent` operation. On timeout it returns an empty `items` list and echoes the cursor you sent.
- The console has no search, no recents and no activity feed for files. Its only filter is "Filter loaded files…", a substring match over the rows already loaded (100 per page, "Load more files").
- The console audit log (`/console/settings`, "Audit log", badge "OWNER ONLY") shows When, Action, Actor, Result. It lists API calls for the account, not file changes: actions are codes like `drive.recent` and `share.create`.

---

## STORY-033: Agent finds last week's trace files with a text search
**Type**: short
**Topic**: Search, recents and activity
**Persona**: A coding agent ("planner-bot") working for Maya Okafor, who asked it to "reopen the notes about the billing migration".
**Goal**: Locate files whose path mentions "billing" without listing the whole drive.
**Preconditions**: Drive has about 300 files, including `/notes/billing-migration.md` and `/inbox/trace-bot/2026-11-05.jsonl`. Key has `read` scope. Single default drive.
**Ideal path**: 1 — one search command returns matching paths.
**Alternate paths**: `agent-drive ls --prefix /notes` (narrower, needs the folder guess); MCP `search` tool with `q`; console "Filter loaded files…" (human only, loaded rows only).
### Steps
1. Run `agent-drive search --query billing` → JSON page with `items` (path, versionId, tags, description, agent and machine ids) and `nextCursor: null`.
2. Agent reads the path from the first item and runs `agent-drive get /notes/billing-migration.md --output ./billing.md` → file saved.
### Variations
- Agent first tries `agent-drive search "billing"` with a positional word; the query is ignored (only `--query` is read), so it gets all 300 files, page of 50 with a `nextCursor`. Easy to miss.
- Agent searches for text it remembers from the inside of the file, e.g. `--query "Stripe webhook"`; zero results, because only paths are matched (gap: no content or description search, and content is encrypted).
- Agent searches `--query BILLING`; still matches (case-insensitive).
### Edge Cases
- Query longer than 128 characters is rejected by the server as a validation error.
- `%` or `_` in the query is escaped, so `--query 100%` matches a literal percent sign.
- A file moved to trash no longer appears (search covers current, non-deleted files).

## STORY-034: Agent narrows by tag, author and machine
**Type**: medium
**Topic**: Search, recents and activity
**Persona**: "audit-bot", an agent asked by Luis Ferreira to find everything that "trace-bot" wrote from the laptop named `luis-mbp` and tagged `daily`.
**Goal**: Combine attribution filters to get a short list.
**Preconditions**: Two agents have written to the drive. Agent ids are UUIDs. Tags were set with `put --tag daily`.
**Ideal path**: 3 — find the agent id, run one filtered command, read the result.
**Alternate paths**: `ls --agent ... --machine ... --tag daily` (same filters, without `--query`); MCP `search` with `agentId`, `machine`, `tag`.
### Steps
1. Run `agent-drive search --agent trace-bot --machine luis-mbp --tag daily` → validation error: `agentId` must be a UUID. The filter takes the id, not the display name.
2. Agent needs trace-bot's id. `agent-drive whoami` gives only its own id, so it runs `agent-drive recent` and reads `agentId` next to `agentName: "trace-bot"` in an event → has the UUID.
3. Re-runs `agent-drive search --agent 7f3c... --machine luis-mbp --tag daily` → page of matching versions.
4. Agent summarizes the paths for Luis.
### Variations
- Agent passes `--tag daily --tag weekly` expecting either; only `daily` is used and no warning appears.
- Agent passes `--user luis@example.com` for files written on behalf of a person; matches only versions put with `--user` set.
- Same filters through `ls` return the same files in path order, with a smaller record.
### Edge Cases
- Machine name must match exactly as recorded at login (for example `luis-mbp`, not `Luis MBP`); wrong case returns an empty page, not an error.
- Scope: an agent without `read` gets a scope-denied error.
- Same information (agent name) is shown by `recent` and the console "AUTHOR" column, but `ls` and `search` show only `agentId`.

## STORY-035: Agent pages through a large result
**Type**: short
**Topic**: Search, recents and activity
**Persona**: "indexer-bot" cataloguing a 2,400-file drive for Priya Nair.
**Goal**: Read every file entry.
**Preconditions**: 2,400 files. Default limit 50.
**Ideal path**: 1 — one call would be ideal; practically one call per page (48 pages at 50, 24 at the 100 maximum).
**Alternate paths**: MCP `list` with `limit` and `cursor`; `sync` is for local directories, not for listing.
### Steps
1. Run `agent-drive ls` → first 50 entries and `nextCursor: "eyJ2..."`.
2. Run `agent-drive ls --cursor eyJ2...` → next 50.
3. Agent notices the slow pace and runs `agent-drive ls --limit 100` → the largest allowed page, so 24 calls instead of 48, until `nextCursor` is `null`.
### Variations
- Agent asks for `--limit 5000` → validation error "limit must be between 1 and 100."
- Agent changes `--prefix` between pages while reusing a cursor; cursor is path-based, so results may skip or repeat.
### Edge Cases
- Cursor longer than 2048 characters is rejected.
- Files added mid-listing that sort before the cursor path are not seen until a fresh listing.

## STORY-036: Agent waits for a teammate agent's file to appear
**Type**: medium
**Topic**: Search, recents and activity
**Persona**: "reviewer-bot" (Codex on Sam Whitfield's desktop) must start only after "writer-bot" on another machine uploads `/handoff/spec-v3.md`.
**Goal**: Block until another agent changes the drive, then read the new file.
**Preconditions**: Both agents share the drive. writer-bot is about 90 seconds from uploading. reviewer-bot has `read` scope.
**Ideal path**: 2 — one blocking wait, one read.
**Alternate paths**: MCP `recent` with `waitSeconds` (max 30, so loop); a shell loop around `recent`.
### Steps
1. reviewer-bot runs `agent-drive recent` once with no options → returns the drive's whole history from the start (first 50 events oldest first) and `latestCursor`. Sam sees a long, unrelated list.
2. It saves `latestCursor`, then runs `agent-drive recent --cursor <latestCursor> --wait 120` → command blocks, polling every 2 seconds.
3. After about 90 seconds writer-bot's `put` lands → command returns `items: [{ operation: "put", path: "/handoff/spec-v3.md", agentName: "writer-bot", ... }]` and a new `latestCursor`.
4. reviewer-bot runs `agent-drive get /handoff/spec-v3.md --output ./spec.md`.
### Variations
- Agent skips step 1 and runs `recent --wait 120` with no cursor; it returns immediately with old history, not a wait (gap: a "start from now" mode does not exist; the agent must read a cursor first).
- Timeout: `--wait 30` and nothing arrives → `items: []`, same cursor echoed; agent loops.
- `--wait 400` → "--wait must be a whole number of seconds from 1 to 300."
- `--wait 0` or `--wait 2.5` → same error.
- Via MCP, `waitSeconds: 120` is rejected (max 30), so the agent must loop four times.
### Edge Cases
- Each poll counts as an API operation; a 300-second wait is about 150 operations against the plan's monthly allowance (1M on Free).
- Moves show `previousPath`, so a rename is visible as one event, not delete plus put.
- The agent's own writes also appear; it must compare `agentId` to ignore them.

## STORY-037: Agent resumes from the last cursor after a restart
**Type**: medium
**Topic**: Search, recents and activity
**Persona**: "sync-bot" running overnight for Dana Ruiz, restarted by its supervisor at 03:10.
**Goal**: Process every event once, without replaying or missing any.
**Preconditions**: sync-bot stored `latestCursor` from its last successful batch in its own state file.
**Ideal path**: 1 — one command with the saved cursor.
**Alternate paths**: `recent --since 2026-11-06T03:00:00Z` (approximate, by transaction start time; may duplicate or skip near the boundary).
### Steps
1. Reads saved cursor from its state file → `eyJ2Ij...`.
2. Runs `agent-drive recent --cursor eyJ2Ij... --limit 100` → events strictly newer than the cursor, plus `nextCursor` if more than 100.
3. Processes the batch, saves `latestCursor`, repeats while `nextCursor` is set.
### Variations
- State file was lost: agent falls back to `--since` with the last known time; duplicates possible.
- Agent passes both `--cursor` and `--since`; `--since` is ignored without a warning.
- `--since yesterday` → "since must be an ISO timestamp."
### Edge Cases
- A corrupt cursor returns a validation error; the agent must discard it and restart with `--since`.
- Empty page returns the same `latestCursor` as given, so the loop can store it unchanged.

## STORY-038: Human tries to find a file in the console
**Type**: medium
**Topic**: Search, recents and activity
**Persona**: Maya Okafor (non-technical owner) wants `/inbox/trace-bot/2026-11-05.jsonl`, which her agent said it saved yesterday. The drive has 1,800 files.
**Goal**: Find and open a specific file by name, and see what changed recently.
**Preconditions**: Signed in at `/console`, Files tab, drive selected. 100 rows loaded.
**Ideal path**: 3 — type part of the name in a search box that covers the whole drive, click the result, download.
**Alternate paths**: Ask the agent to run `agent-drive search --query 2026-11-05`; the Trash tab if the file may have been deleted.
### Steps
1. Types `2026-11-05` in "Filter loaded files…" → "No loaded files match “2026-11-05”." (the first 100 rows are older paths). Footer would read "0 of 100" while a filter is active.
2. Maya wonders whether the file exists, clicks "Load more files" → next 100 loaded; filter still applied; still no match.
3. Clicks "Load more files" repeatedly (up to 17 more times) until the row appears → row shows the full path, size, AUTHOR "trace-bot", MODIFIED time.
4. Clicks the download action → disabled with tooltip "Load your drive key first"; clicks "Load drive key" and pastes the key, then downloads.
### Variations
- Looks for a "Recent" or "Activity" list in the sidebar (Files, Agents, API keys, Usage, Trash) and finds none (gap: no recents view in the console).
- Sorts by clicking the MODIFIED header; headers are not clickable (gap: no sort).
- Opens "Activity & deletion" hoping it shows file activity; it shows API calls like `drive.put` as codes, not file names (gap).
- Messages the agent instead: "Run agent-drive search --query 2026-11-05 and tell me the path."
### Edge Cases
- Filter disabled while the drive has no files.
- Switching drive in the strip resets the loaded rows; the filter text stays but now applies to the new drive.
- Filter matches only the path string, not author, tag or date.
- The same file list is the only place paths appear; the Usage tab shows "Usage by author" counts but not files.

## STORY-039: Owner checks the audit log after a suspicious spike
**Type**: long
**Topic**: Search, recents and activity
**Persona**: Luis Ferreira got an email alert that API operations hit 80% of the month's allowance on the 6th. He wants to know which agent caused it.
**Goal**: Identify which agent and key made the calls.
**Preconditions**: Free plan; `trace-bot` has been calling `recent --wait 300` in a tight loop. Luis is signed in.
**Ideal path**: 4 — open settings, find the actor, open Agents, revoke.
**Alternate paths**: Usage tab "Usage by author" table (operations per agent, no timeline); `/console/billing` "usage by agent" with a statement period selector.
### Steps
1. Opens `/console/settings` through the sidebar link "Activity & deletion" → "Audit log" card, "Most recent first. Metadata only—never file contents or credentials."
2. Scans the table (When, Action, Actor, Result): a long run of `drive.recent` rows by actor "trace-bot" with key label "trace-bot ci" and Result `success` / "HTTP 200".
3. Clicks "Load older events" a few times (25 per page) to see when the pattern began → rows continue back to 02:00.
4. Goes to the Usage tab → "Usage by author" shows trace-bot with the largest operations count; this repeats what the audit log suggested (same information on two surfaces).
5. Goes to Agents → "Revoke access" for trace-bot, confirms → all its keys revoked.
6. Returns to Activity & deletion, clicks "Refresh" → newest rows show `console...` actions by Console user.
### Variations
- Luis tries to filter the audit log by actor or action; no filter exists (gap), only "Load older events".
- Rows with failures show Result `failure` with "HTTP 403 · scope_denied"-style detail; he cannot tell which file was involved because paths are not logged.
- A row still in progress shows "In progress" with no status.
### Edge Cases
- Empty log: "No audit events loaded." (or "Loading activity…" while loading).
- Events are for the whole account, all drives mixed; the audit log has no drive column.
- Public share downloads appear with actor "Public / unauthenticated".
- Audit table scrolls in its own region (keyboard focusable); on small screens rows stack with labels.

## STORY-040: Agent compares search, ls and recent to choose the right tool
**Type**: long
**Topic**: Search, recents and activity
**Persona**: A new agent, "notes-bot", set up by Priya Nair using the llms.txt instructions. The instruction file lists only `backup`, `put`, `get`, `ls --prefix` and `share`.
**Goal**: Learn that search and recents exist, and use them for "what changed since I was last here?".
**Preconditions**: Skill installed (`agent-drive skill install`); MCP server configured in Claude Code.
**Ideal path**: 2 — one `recent --cursor` call replaces the list-and-compare.
**Alternate paths**: MCP `recent` tool; `ls` and diff against a local copy of the listing.
### Steps
1. Reads `/llms.txt` Commands section → sees only `ls --prefix /notes`; no mention of `search` or `recent` (gap: discoverability lives in `agent-drive --help` and the MCP tool list).
2. Runs `agent-drive ls --prefix /notes` → 120 entries; keeps the list.
3. Next session, runs `ls` again and diffs by `versionId` → works but costs two full listings.
4. Runs `agent-drive --help` → sees `recent --drive ID [--since ...] [--cursor C] [--wait SECONDS]` and `search ...`.
5. Switches to `agent-drive recent --since 2026-11-05T00:00:00Z` → only events after that time, with agent names.
### Variations
- Via MCP, the agent calls `recent` with `since` and `limit`; same data, `waitSeconds` capped at 30.
- With several drives and no default, `search` fails with the `--drive` error until the id is given.
### Edge Cases
- `--drive` is optional only when exactly one default drive resolves.
- Read-only agents can use all three commands; only `share` creation needs more than read (see sharing topic).

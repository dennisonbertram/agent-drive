# Topic 5: Weekly trace-archive journey

Policy caveat (note, not a blocker): docs/user-stories.md says agent transcripts and training traces are
not part of the product, and skills/agent-drive/SKILL.md says "Do not save ... chat transcripts or
disposable scratch files". The product owner wants this use case anyway. Stories below therefore
assume: logs are redacted of secrets first, and paths, tags and descriptions are plaintext to the
service (only file contents are encrypted).

Conventions used in every story: `D` = drive ID, `$WEEK` = e.g. `2026-W45`, remote folder
`/traces/$WEEK/`. Every CLI error is written to stderr with exit code 1; the CLI prints only the
message (not the error code), plus `Upgrade: <url>` and/or `Retry after: <n> seconds` lines when the
server supplied them. The CLI never retries.

Missing capabilities (stated here once, repeated where relevant): no verify-then-delete command, no
`--delete-after`, no checksum/compare command, no `sync` download, no folder download, no CLI listing
of Trash, no MCP `sync`, `sync` never deletes locally, no retention/lifecycle on the drive.

## STORY-001: Provision an archive-only credential (no delete scope) for the unattended job

**Type**: medium
**Topic**: Weekly trace archive
**Persona**: Maya, a human account owner setting up a weekly archiving skill for her agent
**Goal**: Give the archive job an API key that can write and read traces but can never delete remote files
**Preconditions**: Maya has a management key in `AGENT_DRIVE_API_KEY`, `AGENT_DRIVE_API_URL` set, and the agent-drive CLI installed. No drive exists yet.
**Ideal path**: 5 — create agent, drive, key (read+write only), save key to the job's environment, whoami check
**Alternate paths**: Create the agent, key and drive in the web console (onboarding chain) and copy the one-time secret into the job's secret store.

### Steps

1. `agent-drive agent create --name trace-archiver` → JSON `{"id":"<AGENT_ID>","name":"trace-archiver","created_at":"..."}`.
2. `agent-drive drive create --name agent-traces` → JSON of the drive plus `"driveKey":"<KEY>"` and `"warning":"Back up this drive key; it cannot be recovered."`. The key is also saved in `~/.config/agent-drive/config.json` (or `AGENT_DRIVE_CONFIG`). Maya stores the key in her password manager now.
3. `agent-drive key create --agent <AGENT_ID> --drive <D> --label trace-weekly --scope read --scope write` → JSON with `scopes:["read","write"]` and a one-time `token`. Omitting `--scope` defaults to read+write, still no delete. Never pass `--scope delete`, `--scope manage` or `--scope share`.
4. On the job host set `AGENT_DRIVE_API_URL`, `AGENT_DRIVE_API_KEY=<token>` and `AGENT_DRIVE_KEY_<D_UPPERCASED_NON_ALNUM_AS_UNDERSCORE>=<KEY>` in the scheduler's secret environment (per docs/cli.md precedence: per-drive env, then `AGENT_DRIVE_KEY`, then `--key-file`, then saved key).
5. `agent-drive whoami` (with those env vars) → `{"accountId":"...","agentId":"<AGENT_ID>","keyId":"...","scopes":["read","write"],"driveIds":["<D>"]}`.

### Variations

- Persist the token instead of using env: `printf %s "$TOKEN" | agent-drive login --api https://... --token-stdin` writes it to config.json (mode 0600) after a `whoami` check and prints the whoami JSON. If `AGENT_DRIVE_API_KEY` is set, `login` uses it and ignores stdin.
- `--key-file ./drive.key` works for the drive key but only if neither env var is set.

### Edge Cases

- `agent-drive ls --drive <D> --prefix /traces` with no API config → `API configuration is missing. Run \`agent-drive login\` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY.`
- Missing drive key when putting → the client cannot encrypt; the job fails before any upload (no partial remote state). Verify with a smoke `put` in STORY-002.
- Proving the guard: `agent-drive rm /traces/x --drive <D>` with this key → stderr `The API key lacks this scope.`, exit 1. The MCP `delete` tool returns an error object with code `permission_denied` ("The API key does not have permission for this operation.").
- Drive-key loss is unrecoverable ("it cannot be recovered"); archives become unreadable. Back it up outside the job host.
- Gap: the CLI has no `key list` or scope-edit command; changing scopes means `key create` + `key revoke <KEY_ID>`.

## STORY-002: Weekly happy path, per-file put, hash verification, then local delete

**Type**: long
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent running its weekly skill (Sunday 02:00, unattended)
**Goal**: Upload every trace file to `/traces/2026-W45/`, prove each remote copy decrypts to identical bytes, and only then delete the local file
**Preconditions**: Env vars from STORY-001. Local traces are in `~/agent/traces/` (redacted, closed files). Shell has `shasum -a 256` (or `sha256sum`) and `mktemp`. Key has read+write only.
**Ideal path**: 5 per file (put, get to temp, compare hashes, delete local, cleanup temp) after one preflight
**Alternate paths**: `sync` (STORY-003) is faster to type but does not verify remotely; MCP calls (STORY-007).

### Steps

1. `agent-drive whoami` → JSON with `"scopes":["read","write"]`. Abort the job if this fails (auth/network) before touching any file.
2. Per file `F` with name `N`: `agent-drive put "$F" "/traces/2026-W45/$N" --drive <D> --tag trace --tag 2026-W45 --description "weekly trace archive"` → prints the committed version JSON, e.g. `{"id":"<VERSION_ID>","path":"/traces/2026-W45/N","ciphertextSize":<bytes>,"agentId":"...","tags":["trace","2026-W45"],...}`. Exit code 0 means upload and commit both completed. Record `id` and `ciphertextSize`.
3. `TMP=$(mktemp)`; `agent-drive get "/traces/2026-W45/$N" --drive <D> --output "$TMP"` → writes plaintext to `$TMP` (mode 0600) only after authenticated decryption succeeds, prints the version JSON. A wrong key, truncated or tampered ciphertext fails here and nothing is written. Add `--version <VERSION_ID>` to pin the exact version just written.
4. Compare: `[ "$(shasum -a 256 < "$F")" = "$(shasum -a 256 < "$TMP")" ]` → equal. The agent-drive CLI has no hash or compare command; this is a shell step. Re-hash `$F` at this point, not before step 2, so a file that grew mid-upload is caught.
5. Only if step 4 passed: `rm -- "$F"` (local) and `rm -f -- "$TMP"`. If it failed, keep `$F`, delete `$TMP`, log the path, continue with the next file, and exit non-zero at the end.
6. Final audit: `agent-drive ls --drive <D> --prefix /traces/2026-W45` → `{"items":[{"fileId":...,"versionId":...,"path":"/traces/2026-W45/N","ciphertextSize":...,"tags":["trace","2026-W45"],...}],"nextCursor":null}`. Count of items must equal the count of files uploaded; follow `--cursor <nextCursor>` while `nextCursor` is non-null (page size defaults server-side, max 100).

### Variations

- Use `--tag` for weekly retrieval: `agent-drive search --drive <D> --tag 2026-W45` (only the first `--tag` is applied by `ls`/`search`).
- `get` without `--output` prints the file only if it is small, valid UTF-8 with no control bytes; otherwise `Binary or large output requires --output.` Do not use stdout capture for verification.

### Edge Cases

- Existing `$TMP`: CLI `get --output` silently overwrites the target; always use a fresh `mktemp`. (MCP `get` with `outputPath` uses create-exclusive and fails if the file exists.)
- Missing capability: there is no `put --verify`, `--delete-after`, or checksum command, so the order in steps 2-5 is the only safeguard. If the script is changed to delete before step 4, nothing in the product stops it.
- `ciphertextSize` from `put`/`ls` is larger than the plaintext (chunked AEAD, 1 MiB chunks plus overhead); it is a cross-check that the same version exists, not a plaintext size comparison.
- Weekly job downloads every byte it just uploaded; egress counts toward the plan (see pricing "Not charged" egress wording) and each upload counts toward quota for every retained version.
- Never write the temp file to a shared directory; the plaintext is a copy of the trace.

## STORY-003: Upload the whole week's folder with sync, then verify before deleting

**Type**: medium
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent (folder-oriented variant)
**Goal**: Upload a staging folder in one command and still verify before local deletion
**Preconditions**: Closed trace files copied or moved into the stable staging directory `~/agent/traces-staging/`. Same env as STORY-001.
**Ideal path**: 4 — sync, read manifest or re-get per file, compare, delete
**Alternate paths**: `put` per file (STORY-002) gives per-file exit codes and uses `get` verification with no extra tooling.

### Steps

1. `agent-drive sync ~/agent/traces-staging --drive <D> --prefix /traces/2026-W45` → `{"uploaded":N,"skipped":0,"conflicts":0,"accountId":"...","manifestPath":"<config>.state/<sha256>.json"}`. Files are uploaded create-only, recursively; symlinks are skipped; the config file and the `.state` directory are excluded.
2. Read `manifestPath`: `{"files":{"<relative/path>":{"hash":"<sha256 of the exact uploaded bytes>","versionId":"<uuid>"}}}`. Each entry is written after its upload succeeds. This is the only place the CLI exposes a SHA-256.
3. For each manifest entry, `agent-drive get "/traces/2026-W45/<relative/path>" --drive <D> --version <versionId> --output "$TMP"` then compare `shasum -a 256 "$TMP"` with the manifest `hash` (and with the local file's current hash, so a file that changed after upload is caught). The manifest hash proves what was sent; the `get` proves what is stored and decryptable. Skipping `get` and trusting the manifest alone is weaker: sync success is not a decrypt test.
4. Delete local files whose three hashes (manifest, remote, local-now) match. `sync` itself never deletes anything locally and never deletes remote files.

### Variations

- Re-run the identical command: unchanged files are skipped (`"skipped":N`) when the manifest hash and remote version both match; useful for resume (STORY-005).
- Use a different local directory path next week and the manifest key changes (identity = API origin, account, drive, prefix and local root path), so first-time uploads are not blocked by old history.

### Edge Cases

- Unknown remote file at the same path with no local history → aborts with `Remote file <relative> has no local sync history; use --overwrite-existing to replace it.` Do not add `--overwrite-existing` in an unattended job; it replaces remote content.
- Prior manifest entry but the remote version changed or is gone (for example trashed) → `Remote conflict for <relative>; refusing to overwrite.` The command stops at the first conflict and prints no stats; files after it are not attempted.
- A file is modified or replaced during the run → `Sync file <path> changed after enumeration; refusing to read it.` Sync reads each file fully into memory once and aborts the whole run on that error.
- Malformed manifest → `The private sync manifest is malformed; refusing to discard conflict history.` The weekly job must stop, not delete the state directory, which would also lose conflict protection.
- `sync` has no flags for tags or descriptions, so synced traces are not tagged; use per-file `put` (STORY-002) if weekly `--tag` search matters.
- Unsafe state directory permissions → `Sync state directory <path> must be a real directory accessible only to the current user.`
- Gap: no `sync --verify` or `--delete-local` option exists.

## STORY-004: Re-run after a crash hits create-only conflicts; decide between skip, --overwrite and --if-version

**Type**: medium
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent re-running the weekly skill after the host rebooted halfway through
**Goal**: Re-run without duplicating, clobbering or losing files, and without deleting anything that was never confirmed
**Preconditions**: First run uploaded `a.jsonl` and `b.jsonl` to `/traces/2026-W45/`, then crashed before verification and deletion. `c.jsonl` was never uploaded. All three still exist locally.
**Ideal path**: 3 — put (conflict), get+compare to confirm identical, treat as done
**Alternate paths**: Use `--if-version` if the remote copy differs and an intentional replacement is wanted.

### Steps

1. `agent-drive put a.jsonl /traces/2026-W45/a.jsonl --drive <D>` → stderr `The file already exists.`, exit 1 (default is create-only; the check happens on the server at commit time, so the ciphertext was uploaded and then discarded).
2. Treat the conflict as "maybe done", not as success and not as failure: `agent-drive get /traces/2026-W45/a.jsonl --drive <D> --output "$TMP"` and compare SHA-256 with local `a.jsonl`. Identical → the earlier upload is good, proceed to local deletion. Different → go to step 3.
3. If the remote differs (earlier run uploaded a partial or older file), find the current version: `agent-drive versions /traces/2026-W45/a.jsonl --drive <D>` → page of versions, newest first with `id`. Then replace it deliberately: `agent-drive put a.jsonl /traces/2026-W45/a.jsonl --drive <D> --if-version <CURRENT_VERSION_ID>` → new version JSON. If someone changed it meanwhile → stderr `The file changed since the conditional write was prepared.` Re-read `versions` and decide again.
4. `agent-drive put c.jsonl /traces/2026-W45/c.jsonl --drive <D>` → committed version JSON (never uploaded, so no conflict).
5. Continue the verify-then-delete steps from STORY-002 for all three files.

### Variations

- `--overwrite` replaces unconditionally and always adds a new version (older version stays and counts toward quota). `--overwrite` and `--if-version` together → `--overwrite and --if-version are mutually exclusive.` (MCP: `overwrite and ifVersionId are mutually exclusive.`)
- Pre-check instead of catching the conflict: `agent-drive ls --drive <D> --prefix /traces/2026-W45` and skip names that exist, then still verify by `get` before deleting local files.
- Use a unique dated folder per run attempt (`/traces/2026-W45/run-2/`) to avoid conflicts entirely, at the cost of duplicated storage.

### Edge Cases

- A non-zero exit from `put` is ambiguous: the commit may have succeeded server-side and the response was lost. This is why a conflict on re-run must go through get-and-compare, never be read as "failed".
- Do not use `--overwrite` as the default in the weekly job: a rerun with a half-written local file would replace a good remote copy (the old version stays in `versions`, but `ls` and `get` now return the bad one; recover with `restore <path> --version <ID>`).
- Gap: no atomic "put if absent, else compare" command; the compare is hand-written.

## STORY-005: Partial failure mid-batch (network, rate limit, quota) and safe resume

**Type**: long
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent plus the on-call human who reads its report
**Goal**: When a batch breaks half way, delete only files whose remote copy was verified, leave the rest untouched, and resume next run
**Preconditions**: 40 trace files, script from STORY-002 with per-file status tracking (a plain list of "verified" names). Free-plan account close to its quota.
**Ideal path**: 6 — fail, classify from stderr, stop or retry, keep unverified files, report, resume
**Alternate paths**: `sync` resume (re-run skips files already in the manifest); wait out `Retry after` and re-run.

### Steps

1. Files 1-17 pass: put OK, get OK, hashes equal, local deleted (STORY-002).
2. File 18, network drop during upload: stderr `fetch failed` (or `Storage request failed with HTTP <status>.` if the object store rejects/times out), exit 1. Local file 18 is untouched. The upload had no commit, so there is no remote file. Do not delete anything for 18.
3. Rate limit on file 19: stderr `The API key has exceeded its request rate limit.`-style message from the server plus `Retry after: <n> seconds`, exit 1. Job policy: sleep `n` seconds then retry the same file up to a small cap; the CLI itself never retries. (Server code `rate_limited`, HTTP 429.)
4. Quota on file 20: stderr `The drive quota would be exceeded.` (code `quota_exceeded`) or a payment-required message (code `payment_required`) followed by `Upgrade: https://...`, exit 1. Retrying will not help. Stop the batch, do NOT delete anything not verified, and report to the human. The CLI prints only the message, so the job must match on the message text or the `Upgrade:` line to tell quota/payment apart from transient errors.
5. Report written for the human: files verified+deleted (1-17), failed (18-20 with reason), untouched (21-40), and the Upgrade URL. Local files 18-40 remain, so no data is lost.
6. After the human upgrades the plan or frees space, next run: for each remaining file `put` (create-only) -> if `The file already exists.` use get-and-compare from STORY-004 -> verify -> delete. Files 1-17 are no longer local, so nothing is re-uploaded.

### Variations

- Same flow with `sync`: it throws at the first failure, so earlier files are already uploaded with manifest entries saved; re-running the same command skips them (`"skipped":N`) and uploads the rest. The job still must verify with `get` before deleting (STORY-003).
- Free vs paid: Free plan allowance is 5 GiB total including all retained versions; an `--overwrite` heavy workflow consumes quota faster.

### Edge Cases

- Stop vs continue: on quota/payment, continuing the loop makes every later file fail the same way, but it is harmless provided deletion is gated on the hash check. Stopping saves rate limit budget.
- Transient failure on the verification `get` (after a good `put`): do not delete; retry the `get`. A hash mismatch or decrypt failure should raise an alert, because the stored copy is unreliable. Do not re-`put` over it without `--if-version`.
- If the host runs out of local disk for `$TMP` while verifying, `get --output` fails; no deletion happens.
- Gap: no resumable/multipart upload and no built-in retry or backoff; a 5 GiB file that fails at 99% restarts from zero.

## STORY-006: Large trace files

**Type**: short
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent with a 2 GiB profiling trace and many small logs
**Goal**: Know the limits before the job meets a big file
**Preconditions**: As STORY-002; one file is very large.
**Ideal path**: 3 — gzip first, put, get-and-compare
**Alternate paths**: Split the file into parts below the cap before upload.

### Steps

1. Compress locally first (`gzip -k big.trace`) so less is uploaded and counted against quota. The agent-drive CLI does not compress.
2. `agent-drive put big.trace.gz /traces/2026-W45/big.trace.gz --drive <D>` → the whole file is read into memory (`readFile`), encrypted in memory, uploaded as one PUT, then committed. Server upload cap is 5 GiB (`MAX_UPLOAD_BYTES`); expect roughly the file size or more in resident memory during encryption.
3. `agent-drive get /traces/2026-W45/big.trace.gz --drive <D> --output "$TMP"` → whole object is downloaded and decrypted in memory before the file is written; compare SHA-256 as in STORY-002.

### Variations

- Without `--output`, a file over 1 MiB gives `Binary or large output requires --output.` (MCP: files over 64 KiB give `Large or binary files require outputPath.`)

### Edge Cases

- Memory exhaustion on small hosts kills the process: the job sees a crash (not a clean CLI error). The local file is untouched and no commit happened. Treat as "not uploaded".
- Files above 5 GiB are rejected by the server; the job must split them first. The exact error message is not shown in the CLI code path I read; the API returns an error whose message is printed on stderr.
- A file still being written is hashed at different times; archive only closed files (rotate logs first). `sync` fails with `Sync file ... changed after enumeration; refusing to read it.` if it detects a change.

## STORY-007: The same weekly job through MCP tools

**Type**: medium
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent whose skill drives Agent Drive through the `agent-drive mcp` stdio server instead of a shell
**Goal**: Do upload and verify with MCP tools and see which steps are missing
**Preconditions**: MCP server started with `agent-drive mcp` and the env vars from STORY-001. The agent can run its own hashing (for example a local script) and delete local files.
**Ideal path**: 3 per file — `put`, `get` to a new temp path, compare hash then delete local
**Alternate paths**: CLI route (STORY-002).

### Steps

1. Tool `put` with `{"driveId":"<D>","path":"/traces/2026-W45/a.jsonl","localPath":"/home/agent/traces/a.jsonl","tags":["trace","2026-W45"]}` → JSON (marked `untrusted`) with the committed version, minus `wrappedKey`. Exactly one of `text` or `localPath` is required, otherwise `invalid_input`: `Provide exactly one of text or localPath.`
2. Tool `get` with `{"driveId":"<D>","path":"/traces/2026-W45/a.jsonl","outputPath":"/tmp/verify-a.jsonl"}` → `{"version":{...},"outputPath":"/tmp/verify-a.jsonl"}`. The output is opened create-exclusive (mode 0600); if the file exists the call fails with `operation_failed`. On a decrypt failure the error code comes from the crypto layer.
3. The agent hashes both files with its own code, then deletes the local trace. The MCP server has no hash tool.
4. Weekly listing: tool `list` with `{"driveId":"<D>","prefix":"/traces/2026-W45","limit":100}` → page of entries and `nextCursor`.

### Variations

- Error shape: `{"error":{"code":"quota_exceeded","message":"The drive quota would be exceeded."}}` with `isError`. Rate limit yields `code:"rate_limited"` with `retryAfter` seconds. Payment required includes `upgradeUrl`. Unlike the CLI, MCP errors carry the machine-readable `code`, so classification is simpler.
- MCP `put` flags: `overwrite` (boolean) or `ifVersionId`; the conflict code is `conflict` ("The operation conflicts with the current remote state.").

### Edge Cases

- Gap: MCP has no `sync`, so the folder variant must loop `put` calls. There is no MCP tool that lists Trash.
- MCP `delete` exists; a key without the delete scope gets `permission_denied`.
- A `put` with `text` is not suitable for large traces (the whole text is passed through the model context).

## STORY-008: A human finds and downloads last week's traces in the console

**Type**: medium
**Topic**: Weekly trace archive
**Persona**: Dev, an engineer investigating an agent incident from the week of 2026-W45
**Goal**: Find the trace files in the web console and download the readable text
**Preconditions**: Dev is signed in to the account and has the recovery/drive key JSON file from STORY-001. Traces are under `/traces/2026-W45/`.
**Ideal path**: 5 — open console, select drive, load drive key, find file, Download
**Alternate paths**: Dev asks the agent (or runs the CLI as in STORY-009); share link with `agent-drive share` (needs the `share` scope, which the archive key lacks).

### Steps

1. Open `/console` and sign in → console loads the workspace (Files tab is the default; other tabs are Agents, API keys, Usage, Trash).
2. Select the drive "agent-traces" → file table with columns for path, ENCRYPTED SIZE and AUTHOR (agent name). Paths show `/traces/2026-W45/...`. Names and sizes are visible without the key.
3. Click "Load drive key" and choose the JSON key file → key accepted. Wrong or invalid file shows "This is not a valid drive key file" / "Choose a JSON recovery key file..." messages. Before this, the row `Download` button is disabled with the tooltip "Load your drive key first".
4. Find the file: the table lists up to 100 rows per page (use the pagination control for later pages). The console file list is path-ordered, so `/traces/2026-W45/` files cluster together.
5. Click `Download` on the row → the file is fetched and decrypted in the browser, notice "File decrypted in your browser. Download started." and the browser saves the plaintext. A wrong drive key leads to a decrypt failure.

### Variations

- `Versions` button shows prior versions if a file was overwritten; each version can be restored.
- The `Usage` tab shows consumption by author, so Dev can see that the trace-archiver is the source of the storage growth.

### Edge Cases

- There is no "download folder" or "download all" action in the console; each file is downloaded one by one.
- A trace uploaded with a different drive key (e.g. after rotating or creating a new drive) cannot be decrypted with the loaded key.
- Metadata is visible without the key, including descriptions and tags; sensitive text in those fields is exposed to the service (see policy caveat).

## STORY-009: Retrieve a past week with the CLI, and recover accidentally trashed traces

**Type**: long
**Topic**: Weekly trace archive
**Persona**: The same agent (or a human with a read+write key) three months later; plus a human who emptied the wrong folder in the console
**Goal**: Pull back every file for `2026-W45`, and restore anything moved to Trash
**Preconditions**: Same drive and drive key. A read+write key is enough for download and restore (restore uses read+write). Delete requires a key with the `delete` scope, which the archive job does not have.
**Ideal path**: 4 — list prefix, get each file, verify against any retained hash, restore from Trash if needed
**Alternate paths**: `search --tag 2026-W45`; console download one at a time (STORY-008).

### Steps

1. `agent-drive ls --drive <D> --prefix /traces/2026-W45 --limit 100` → `{"items":[...],"nextCursor":"<c>"|null}`. If `nextCursor` is set, repeat with `--cursor <c>` until null.
2. For each `items[].path`: `agent-drive get "<path>" --drive <D> --output ./restored/<name>` → writes the plaintext (mode 0600) and prints the version JSON. There is no recursive download command; this loop is mandatory. Parent directory must exist (`mkdir -p` first).
3. Entries are not found by `ls` after someone trashes them (the human chose the Trash button in the console, or a delete-scoped key ran `rm`). In the console, Trash tab lists "Deleted files" with `DELETED` date and "Versions preserved"; click `Restore`. From the CLI: `agent-drive restore /traces/2026-W45/a.jsonl --drive <D>` → `{"version":{...}}` (requires the exact path; there is no CLI command to list Trash, so read the paths from the console, from `recent`, or from the archive job's own log).
4. Find who removed what: `agent-drive recent --drive <D> --since 2026-11-01T00:00:00Z` → events with `operation:"delete"`, path, agentId, machineId, createdAt.

### Variations

- Fetch an older version after an overwrite: `agent-drive versions /traces/2026-W45/a.jsonl --drive <D>` then `agent-drive get /traces/2026-W45/a.jsonl --drive <D> --version <ID> --output ...`; `agent-drive restore <path> --version <ID>` makes that version current.
- Narrow by attribution: `agent-drive ls --drive <D> --prefix /traces --agent <AGENT_ID> --machine ci-box-3`.

### Edge Cases

- `recent` is a time feed, not a catalog; prefer `ls --prefix` for planning retrieval.
- Restoring a path whose name has since been reused by a different file: the server answers `conflict` ("The destination exists." style message; the CLI prints the server message).
- Soft-delete: trashed files still use quota until the account's deletion jobs purge them, and the product states no TTL for traces. Gap: no lifecycle or retention policy exists to expire old weeks automatically.
- A past week retrieved with the wrong drive key fails at decryption; nothing is written.

## STORY-010: Verification failure keeps local files (decrypt or hash mismatch)

**Type**: short
**Topic**: Weekly trace archive
**Persona**: The trace-archiver agent
**Goal**: Show that a failed verification leaves everything local and raises an alert
**Preconditions**: As STORY-002; the drive key in the environment was rotated to the wrong value, or the local file was appended to between upload and verification.
**Ideal path**: 3 — put OK, get or compare fails, nothing deleted
**Alternate paths**: none found

### Steps

1. `agent-drive put app.log /traces/2026-W45/app.log --drive <D>` → committed version JSON (exit 0). Upload success alone is not permission to delete.
2. `agent-drive get /traces/2026-W45/app.log --drive <D> --output "$TMP"` → exit 1 with a decrypt error message and no output file written (the CLI writes only after authenticated decryption succeeds); or exit 0 but `shasum -a 256` differs from the local file.
3. The job keeps `app.log`, removes `$TMP`, logs `verify failed: /traces/2026-W45/app.log`, and exits non-zero so the scheduler alerts a human.

### Variations

- Mismatch because the file grew: re-run next week with log rotation so that closed files are uploaded; the old remote file stays as the first version (use `--if-version` to replace deliberately).

### Edge Cases

- Do not retry with `--overwrite` blindly: the wrong key will upload another undecryptable version.
- The wrong or missing drive key must be fixed in the job's environment, not by re-creating the drive (`drive create` against an existing drive without the backup refuses: `Drive <id> already exists; load its backup through AGENT_DRIVE_KEY_<ID>.`).

## Recommended safest weekly sequence (summary)

1. `agent-drive whoami`
2. per file: `agent-drive put "$F" "/traces/$WEEK/$N" --drive $D --tag trace --tag $WEEK` (create-only)
3. `agent-drive get "/traces/$WEEK/$N" --drive $D --output "$TMP"` (add `--version <id from put>`)
4. compare `shasum -a 256` of `$F` and `$TMP`; delete `$F` only on equality
5. `agent-drive ls --drive $D --prefix /traces/$WEEK` and compare the count with the uploaded count

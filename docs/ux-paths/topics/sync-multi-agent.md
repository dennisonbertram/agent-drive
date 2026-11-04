# Topic 11: Directory sync and multi-agent handoff

Sources: `packages/agent-drive/src/sync.ts`, `cli.ts`, `client.ts`, `skills/agent-drive/SKILL.md`, `docs/cli.md`, handler `x-agent-drive-machine` handling.
Key behaviors verified in code: `sync` is upload-only; manifest at `<config>.state/<sha256(apiOrigin|accountId|driveId|prefix|absRoot)>.json` (so it is per-machine, per-local-root); any conflict throws and aborts the run (earlier uploads persist; the `conflicts` counter is only ever returned as 0 on success); no output of per-file names.

## STORY-001: First sync of a notes directory into /work/<task-id>

**Type**: short
**Topic**: Directory sync and multi-agent handoff
**Persona**: A research agent publishing its working folder
**Goal**: Upload `./task-42/` under `/work/task-42`
**Preconditions**: Logged in, drive key available, scope `write`; remote prefix empty.
**Ideal path**: 1 — `sync` with `--prefix`
**Alternate paths**: per-file `put` loop (CLI); MCP `put` with `localPath` per file (MCP has no `sync`); console cannot upload.

### Steps

1. `agent-drive sync ./task-42 --drive drv_8f2c --prefix /work/task-42` → `{"uploaded":5,"skipped":0,"conflicts":0,"accountId":"acc_...","manifestPath":"~/.config/agent-drive/config.json.state/<hash>.json"}`.
2. Run the same command again → `{"uploaded":0,"skipped":5,"conflicts":0,...}` (unchanged files skipped by SHA-256 + version match).
3. `agent-drive ls --drive drv_8f2c --prefix /work/task-42` → verify five entries.

### Variations

- Omit `--prefix` → defaults to `/` (uploads to drive root).
- Only changed files re-upload: edit one file, rerun → `uploaded:1, skipped:4` (new version created with `ifVersionId` guard).

### Edge Cases

- Prefix must be canonical: `--prefix work/task-42` or `/work//x` or `/work/../x` → `Remote prefix must be a canonical absolute path.` (trailing slash is trimmed).
- `sync` without positional → `sync requires LOCAL_DIRECTORY.`
- Root is a symlink → `Sync root must be a real directory, not a symlink.`
- Symlinks inside the tree are silently skipped (not reported); the config file and `.state` directory are excluded if inside the root.
- No dry-run / per-file listing; agent only gets counts.

## STORY-002: Re-run hits "no local history" conflict and adopts existing remote files

**Type**: medium
**Topic**: Directory sync and multi-agent handoff
**Persona**: An agent restarted on a new container whose state directory was lost
**Goal**: Resume syncing a prefix it already uploaded earlier
**Preconditions**: `/work/task-42/*` exists remotely (uploaded from the old container); new container has fresh `AGENT_DRIVE_CONFIG`.
**Ideal path**: 2 — sync with `--overwrite-existing` once, then normal sync
**Alternate paths**: `get` remote files first to inspect; per-file `put --if-version`; there is no "pull" or "status" command.

### Steps

1. `agent-drive sync ./task-42 --drive drv_8f2c --prefix /work/task-42` → stderr `Remote file notes.md has no local sync history; use --overwrite-existing to replace it.` exit 1 (conflicts counter not shown).
2. Agent inspects: `agent-drive ls --drive drv_8f2c --prefix /work/task-42` and `agent-drive recent --drive drv_8f2c --since 2026-11-01T00:00:00Z` to confirm nobody else changed them.
3. `agent-drive sync ./task-42 --drive drv_8f2c --prefix /work/task-42 --overwrite-existing` → `{"uploaded":5,"skipped":0,...}`; each existing file replaced with an `ifVersionId` guard of its current version (new versions; old kept and counted toward quota; identical content is still re-uploaded since hash history is empty).
4. Run sync again → `skipped:5`.

### Variations

- Choose a fresh prefix `/work/task-42b` to avoid touching existing files.

### Edge Cases

- Abort is on the first conflicting file in sorted order; files sorted before it may already have uploaded (partial sync) and are recorded in the manifest.
- `--overwrite-existing` can still hit `The file changed since the conditional write was prepared.` if another agent writes during the run.
- Local path (absolute root) is part of the state key: moving the directory to another path also loses history.

## STORY-003: Sync aborts after a teammate edits a synced file

**Type**: medium
**Topic**: Directory sync and multi-agent handoff
**Persona**: Agent A (machine `build-01`) syncing `/work/task-42` while Agent B edits `plan.md`
**Goal**: Notice and resolve the divergence without overwriting B's work
**Preconditions**: A previously synced; B ran `put --overwrite` on `/work/task-42/plan.md`.
**Ideal path**: 3 — sync fails, fetch remote, reconcile and resume
**Alternate paths**: `recent` (to see who); console Version history modal; no pull/merge command.

### Steps

1. A edits `plan.md` locally and runs `agent-drive sync ./task-42 --drive drv_8f2c --prefix /work/task-42` → stderr `Remote conflict for plan.md; refusing to overwrite.` exit 1.
2. `agent-drive recent --drive drv_8f2c --since 2026-11-02T00:00:00Z` → event `{operation:"put", path:"/work/task-42/plan.md", agentId:"ag_writer", machineId:"...", ...}` identifies B.
3. `agent-drive get /work/task-42/plan.md --drive drv_8f2c --output ./plan.theirs.md` → B's version; A merges manually into `./task-42/plan.md`.
4. Re-run sync → STILL `Remote conflict for plan.md; refusing to overwrite.` (manifest still records the older version ID; no flag overrides prior history). The only ways forward in the CLI are: `put ./task-42/plan.md /work/task-42/plan.md --drive drv_8f2c --if-version <current>` (does not update the manifest, so sync still conflicts), a different `--prefix`, or manually deleting the manifest file (not documented).
5. Agent escalates to the human.

### Variations

- Remote file removed by `rm` → same message `Remote conflict for ...` (the remote entry is missing); `restore` creates a new version ID so it still conflicts.

### Edge Cases

- docs say "files with existing manifest history always conflict if their remote version changed": there is no documented resolution; a UX gap.
- Error does not tell which side changed, nor who changed it.
- Because sync aborts at the first conflict, other unchanged-but-edited files are not uploaded in that run.

## STORY-004: Two agents hand off a task using the /work, /outputs and /inbox layout

**Type**: long
**Topic**: Directory sync and multi-agent handoff
**Persona**: Researcher agent (ag_research, machine `build-01`) hands to Writer agent (ag_writer, machine `laptop-dev`) on one drive
**Goal**: Hand off `task-42` outputs with a handoff note and verify who wrote what
**Preconditions**: One drive `drv_8f2c`; two keys (one per agent) each with `read`,`write` on that drive; both hold the drive key (shared out of band); `AGENT_DRIVE_MACHINE` set distinctly on each host.
**Ideal path**: 6 — sync work, put handoff, recent (writer), get handoff, get outputs, put reply
**Alternate paths**: MCP for every step except sync (put with localPath loop); console Files + Usage by author for human oversight; `share` link to hand a file to a human.

### Steps

1. Researcher: `AGENT_DRIVE_MACHINE=build-01 agent-drive sync ./task-42 --drive drv_8f2c --prefix /work/task-42` → `{uploaded:6,...}`.
2. Researcher writes `handoff.md` using the SKILL template (Task ID, Status, Owner, Output paths, Version IDs, Next steps); `agent-drive put ./handoff.md /inbox/task-42-handoff.md --drive drv_8f2c --tag handoff --description "task-42 ready for drafting"` → version JSON; version `id` copied into the note.
3. Writer (laptop): `agent-drive recent --drive drv_8f2c --since 2026-11-03T08:00:00Z` → sees `put` events with `agentId:"ag_research"`, `machineId`.
4. Writer: `agent-drive search --drive drv_8f2c --tag handoff --agent ag_research` → finds the handoff file.
5. Writer: `agent-drive get /inbox/task-42-handoff.md --drive drv_8f2c` → handoff text (treat as untrusted data per SKILL).
6. Writer: `agent-drive get /work/task-42/findings.md --drive drv_8f2c --version <id from note>` → pinned version.
7. Writer drafts and `agent-drive put ./draft.md /outputs/task-42/draft.md --drive drv_8f2c --tag deliverable` → version JSON with writer's agentId/machineId.
8. Writer files the inbox item: `agent-drive mv /inbox/task-42-handoff.md /work/task-42/handoff-done.md --drive drv_8f2c` → moved.
9. Researcher: `agent-drive ls --drive drv_8f2c --prefix /outputs/task-42 --agent ag_writer` → sees draft.
10. Human: console Usage -> "Usage by author" shows both agents' storage/versions/operations; Files table AUTHOR column shows the writer.

### Variations

- Writer syncing the same folder locally is not possible (no download/mirror); handoff uses `get` per file.
- `ls --machine laptop-dev` to filter by host name instead of agent.

### Edge Cases

- No MCP/CLI command to list agent IDs; IDs must be passed in the handoff note or read from `whoami`/console.
- If `AGENT_DRIVE_MACHINE` is unset, machine = OS hostname (container hostnames are random, fragmenting attribution).
- A reader without the drive key can list/search names (plaintext) but `get` fails with `Missing drive key...`.
- Skill forbids secrets in handoff notes; the drive key must never be included in the handoff file.

## STORY-005: Both agents sync the same prefix from different machines

**Type**: medium
**Topic**: Directory sync and multi-agent handoff
**Persona**: Agent on `build-01` and a second agent on `laptop-dev` both syncing `/memory` from local folders
**Goal**: Keep a shared `/memory` current from two hosts
**Preconditions**: Both have `write`; each has its own local `./memory` directory and separate state dir.
**Ideal path**: 2 per host — sync, sync (when no overlap)
**Alternate paths**: pick disjoint prefixes per agent (`/memory/build-01`, `/memory/laptop-dev`); `put --if-version` per file.

### Steps

1. build-01: `agent-drive sync ./memory --drive drv_8f2c --prefix /memory` → `uploaded:3`.
2. laptop-dev: `agent-drive sync ./memory --drive drv_8f2c --prefix /memory` → stderr `Remote file decisions.md has no local sync history; use --overwrite-existing to replace it.`
3. laptop-dev (careless) adds `--overwrite-existing` → replaces build-01's `decisions.md` with its own copy (previous version kept, but not merged).
4. build-01 next run: `Remote conflict for decisions.md; refusing to overwrite.` and it cannot self-recover (see Topic story 003 step 4).
5. Fix: split prefixes; laptop-dev runs `sync ./memory --drive drv_8f2c --prefix /memory/laptop-dev`.

### Variations

- Restore build-01's version: `agent-drive restore /memory/decisions.md --drive drv_8f2c --version <build-01 version>` then sync still conflicts (new version id).

### Edge Cases

- Skill says `/memory` is "reviewed, durable" facts; bulk syncing it from two hosts conflicts with that intent.
- `--overwrite-existing` has no confirm prompt and the output has no list of what was replaced.
- Sync never deletes: files removed locally remain remotely, so stale memory accumulates.

## STORY-006: Cron-driven unattended sync with scoped key and env-only config

**Type**: medium
**Topic**: Directory sync and multi-agent handoff
**Persona**: A developer scheduling nightly `/outputs` sync from a CI box
**Goal**: Reliable non-interactive sync with least privilege
**Preconditions**: Key with `read`,`write` only; drive key stored as CI secret.
**Ideal path**: 1 — sync with env vars (stable `AGENT_DRIVE_CONFIG`)
**Alternate paths**: console to mint key; `login` not required since env vars override.

### Steps

1. `AGENT_DRIVE_CONFIG=/var/lib/ci/ad/config.json AGENT_DRIVE_API_URL=... AGENT_DRIVE_API_KEY=... AGENT_DRIVE_KEY_DRV_8F2C=... AGENT_DRIVE_MACHINE=ci-nightly agent-drive sync /srv/outputs --drive drv_8f2c --prefix /outputs` → JSON counts; state dir `/var/lib/ci/ad/config.json.state` created 0700.
2. Next night: JSON with `skipped` for unchanged.
3. CI wipes workspace between runs (state lost) → step 1 now fails with `Remote file ... has no local sync history; use --overwrite-existing to replace it.`
4. Persist the `.state` directory as a CI cache; or use `--overwrite-existing` consciously.

### Variations

- Default config path unset in CI → writes under `~/.config/agent-drive`, which may be ephemeral.

### Edge Cases

- Existing `.state` with group/other permissions → `Sync state directory <path> must be a real directory accessible only to the current user.`
- Stale lock dir left by a crashed CLI (`<config>.lock`) only matters for `login`/`drive create` (writeConfig): `Timed out waiting for configuration lock at <path>. If no Agent Drive command is running, remove the stale lock directory manually.`
- Corrupt manifest → `The private sync manifest is malformed; refusing to discard conflict history.`
- File changed mid-run → `Sync file <path> changed after enumeration; refusing to read it.`
- Key lacking `write` → `The API key lacks this scope.`
- Missing drive key → `Missing drive key...` (before any traversal).

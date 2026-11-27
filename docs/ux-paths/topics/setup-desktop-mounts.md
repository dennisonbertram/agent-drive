# Setup stories: Desktop mounts

> ID note: stories in this file now use catalog IDs SETUP-051 to SETUP-058 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-051, 02 = SETUP-052, 03 = SETUP-053, 04 = SETUP-054, 05 = SETUP-055, 06 = SETUP-056, 07 = SETUP-057, 08 = SETUP-058.


Topic: Desktop mounts (Finder app download and enable, Linux FUSE, `connect ... --persist`, `mounts wake`, sandbox asleep, Instabox missing, Windows and unsupported platforms).

Source: worktree `/Users/dennison/develop/agent-drive-ux-setup`. Read from code and docs only; nothing was run. IDs are temporary.

## Facts the stories rely on (verified in code)

- Finder app is a separate download, `Agent-Drive-Finder-0.3.1.zip` from GitHub release `finder-v0.3.1`; it is not installed by the CLI (`docs/cli.md:20`, `:240`; `native/macos/README.md:9`). The CLI launches `/Applications/Agent Drive.app/Contents/MacOS/AgentDriveFinder` (`packages/agent-drive/src/mount-mac.ts:8`), override `AGENT_DRIVE_FINDER_HELPER` (must be absolute, `mount-mac.ts:408-410`).
- No website page, console screen, or `/llms.txt` mentions Finder, `connect`, or Instabox (discovery-setup.md section 4).
- `connect` usage line: `connect NAME MOUNTPOINT --sandbox ID --root /WORKSPACE/PATH [--read-only] [--wake-on-access | --no-wake-on-access] [--persist]` (`cli.ts:848`, help text `cli.ts:1730`).
- Sandbox ID must be an exact `m_...` ID: "Invalid Instabox sandbox ID; use its exact m_... ID, not a name or alias." (`mount-registry.ts:199`). Docs only say `SANDBOX_ID`.
- On macOS, `connect` rejects an existing mountpoint ("Finder mountpoint already exists: <path>", `mount-registry.ts:162`) and a missing parent ("Finder mountpoint parent does not exist: <path>", `:149`). Docs say `mkdir -p "$HOME/AgentWorkspaces"` (the parent), which is the correct step, but never say the mountpoint itself must not exist. Linux FUSE says the opposite for drives: existing mountpoint must be an empty directory (`docs/cli.md:221`).
- Missing Instabox: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." (`workspace-service.ts:159`). It is only raised when the service or wake path resolves the executable (for example `--persist`, `mounts wake` when the policy changes). No doc says what Instabox is or where to get it.
- Wake errors (`workspace-wake.ts:240,257,261,272`): "Instabox machine is <state>; wake-on-access is disabled.", "Instabox machine is in unsupported state: <state>.", "Instabox workspace wake timed out.", "Instabox machine did not reach the running state."
- Windows: no doc says native mount is unsupported. The only signal is `mount.ts:1231`: "No packaged Agent Drive mount helper is available for this platform." (and `...for <arch>.` at `:1235`). `credentials export --to clipboard` does support Windows (`docs/cli.md:628`), so Windows is half-supported for the CLI.
- Live mounts: create new files and read existing files only; overwriting an existing file fails with a read-only error (`docs/cli.md:186-189`).

## SETUP-051: Mount a drive in Finder for the first time
**Type**: long
**Topic**: Desktop mounts
**Persona**: Priya Nair, a freelance data analyst on a MacBook (macOS 15.7), already finished `agent-drive login` yesterday with Claude Code. She wants to drag report PDFs into the drive from Finder.
**Goal**: See her drive as a folder in Finder and drop a file into it.
**Preconditions**: CLI installed and logged in, one drive key saved, backup confirmed. Finder app not downloaded.
**Surface**: mixed (CLI, Finder, web docs)
**Ideal path**: 5 — download zip, drag to /Applications, run one mount command, open Finder row, drop file.
**Alternate paths**: Ask the agent to run it (the skill `skills/agent-drive/SKILL.md:157` tells it to download and mount); `agent-drive mounts add NAME MOUNTPOINT --drive ID` then `agent-drive mount --name NAME`; install the app from source via `native/macos/build-app.sh` (developers only).
### Steps
1. Priya opens agentdrive.xyz and looks for "Finder" or "mount" in the header (`Pricing`, `Docs`, `Sign in`, `Sign up free`) → finds nothing on the landing page. She types "mount" in her search engine and ends on the Docs page `cli` (`docs/cli.md`). The only place the app link lives is the long paragraph at `docs/cli.md:20` and the section "macOS requirements and unmounting".
2. She clicks the link "Agent Drive Finder 0.3.1" → GitHub release `finder-v0.3.1` downloads `Agent-Drive-Finder-0.3.1.zip`.
3. She double-clicks the zip, then drags `Agent Drive.app` to `/Applications` → no feedback; the app has no installer.
4. She double-clicks `Agent Drive.app` "to see if it works" (the README says "open it once", `packages/agent-drive/README.md:38`) → nothing visible happens. `docs/cli.md:20` says "Opening the app from Finder does not open a window", so she may still wonder whether it failed. Hesitation point.
5. In Terminal she runs `agent-drive mount "$HOME/AgentDrive"` → the command stays in the foreground (no prompt returns). No success line is documented.
6. She opens Finder → under Locations a row `Agent Drive` appears. She drags `Q3-report.pdf` in → file appears; it encrypts on her machine.
7. She presses Ctrl+C once in Terminal → the CLI disconnects the Finder domain and returns; the Finder row goes away.
### Variations
- With two drives saved the CLI exits asking for `--drive ID`; the Finder row then reads `Agent Drive` plus the first 8 characters of the drive ID (`docs/cli.md:258-260`).
- `--read-only` for browse-only.
- Mountpoint path differs from what Finder chooses: the CLI creates a symlink at the requested path if it is free and removes it on exit (`docs/cli.md:264-266`).
### Edge Cases
- She closes Terminal to tidy up: the mount disappears (foreground process). Nothing explains this on first read; `--persist` exists only for `connect`, and the drive mount needs `mounts service install NAME`, which needs a prior `mounts add`.
- App placed in `~/Downloads` instead of `/Applications`: the helper path is not found. The documented fix is `AGENT_DRIVE_FINDER_HELPER` with an absolute path (`docs/cli.md:248`); the exact user-facing error text for a missing helper was not confirmed.
- Same fact on several surfaces: app download link appears in `docs/cli.md:20,240`, `native/macos/README.md:9`, `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157`. None on the web app or `/llms.txt`.
- Contradiction: "open it once" (`packages/agent-drive/README.md:38`, `SKILL.md:157`) versus "Opening the app from Finder does not open a window; the Finder location appears when the CLI starts a mount" (`docs/cli.md:20`, `native/macos/README.md:9`).

## SETUP-052: Finder shows "Agent Drive is not enabled"
**Type**: medium
**Topic**: Desktop mounts
**Persona**: Marcus Webb, indie developer, new MacBook Air. He just dragged the app into `/Applications` and runs the mount.
**Goal**: Get the Finder extension enabled and the mount working.
**Preconditions**: App in `/Applications`, CLI logged in, extension not yet enabled in System Settings.
**Surface**: mixed (CLI, Finder, System Settings)
**Ideal path**: 4 — run mount, click `Enable` in the Finder banner, rerun mount, open row.
**Alternate paths**: Enable the extension in System Settings (the CLI error says so); run `/usr/bin/pluginkit -a "$APP_PATH/Contents/PlugIns/AgentDriveFileProvider.appex"` when macOS never discovers it (`docs/cli.md:250-256`).
### Steps
1. Marcus runs `agent-drive mount "$HOME/AgentDrive"` → the CLI fails with one of the safe diagnostics, for example "The Agent Drive File Provider extension is disabled. Enable it in System Settings, then retry." (`mount-mac.ts:32`).
2. He opens Finder; the sidebar has an `Agent Drive` row with the banner "Agent Drive is not enabled. To access Agent Drive click Enable." (docs `docs/cli.md:260-261`). He is unsure whether to follow the terminal text (System Settings) or the Finder banner (`Enable`). Hesitation point: two different instructions for one problem.
3. He clicks `Enable` in the banner → the extension is turned on.
4. He reruns `agent-drive mount "$HOME/AgentDrive"` → the mount holds; the `Agent Drive` row opens a folder.
### Variations
- Other CLI diagnostics point elsewhere: "macOS could not register the Agent Drive File Provider. Open Agent Drive.app from /Applications and retry." (`mount-mac.ts:36`), "macOS has not authenticated the Agent Drive File Provider. Open Agent Drive.app and retry." (`:48`), "The macOS File Provider service is unavailable. Check the Agent Drive extension in System Settings and retry." (`:44`). Three different places to go (System Settings, the app, the Finder banner).
- "Agent Drive Finder cannot access its shared container. Reinstall Agent Drive.app from the official download, then retry." (`mount-mac.ts:28`) if he used an unsigned local build.
### Edge Cases
- The banner never appears because Finder was closed: he has to find the row himself.
- The extension is toggled in System Settings, but the Settings location is not named (no path like "General > Login Items & Extensions" in any copy).
- If macOS never discovers the extension, the only fix is a `pluginkit` command that only appears in `docs/cli.md`, not in any error message.
- Copy mismatch: the Finder banner fix (`Enable`) is in docs, while three CLI messages point to System Settings or Agent Drive.app instead.

## SETUP-053: Mount a drive on a Linux server with FUSE
**Type**: medium
**Topic**: Desktop mounts
**Persona**: Tomasz Kowalski, DevOps engineer on Ubuntu 24.04 x64 laptop, Node 24, logged in as `tomasz`.
**Goal**: Browse his drive as a directory under `~/AgentDrive`.
**Preconditions**: CLI installed globally from npm, logged in, drive key saved. FUSE userspace tools may be missing.
**Surface**: CLI
**Ideal path**: 2 — `mkdir`-free `agent-drive mount "$HOME/AgentDrive"`, then browse (the CLI creates the directory if its parent exists).
**Alternate paths**: `agent-drive mounts add NAME ...` plus `mounts service install NAME` for login startup; `AGENT_DRIVE_MOUNT_HELPER` for a custom helper.
### Steps
1. Tomasz runs `agent-drive mount "$HOME/AgentDrive"` → on a machine without `fusermount3` the command fails. The docs say "The CLI does not install system FUSE support" (`docs/cli.md:20`) and list the needs: working FUSE, `/dev/fuse`, `fusermount3` or `fusermount` (`docs/cli.md:217-219`). The exact error text for missing `fusermount` was not confirmed.
2. He installs the distribution's fuse package himself, reruns → the command stays in the foreground.
3. In a second terminal he runs `ls "$HOME/AgentDrive"` → his files list.
4. He tries `echo hi > "$HOME/AgentDrive/notes.txt"` → succeeds only if the key has `write` scope; `--read-only` or a read-only key blocks it. Deleting or replacing needs `delete` too (`packages/agent-drive/README.md` and `SKILL.md:150-153` area).
5. He presses Ctrl+C once in the mount terminal and waits → unmounts after flushing staged writes.
### Variations
- Mountpoint is an existing non-empty directory: refused ("empty directory owned by the current user and must not be a symlink", `docs/cli.md:221`).
- He has an arm64 box; the package ships helpers for x64 and arm64 only.
- A second Ctrl+C forces exit and can interrupt writes; a stale mount is cleared with `fusermount3 -u "$HOME/AgentDrive"` (or `fusermount -u`).
### Edge Cases
- Running in a Docker container without `/dev/fuse`: fails; the docs name the requirement but no container hint.
- Alpine or musl hosts are not mentioned; only "x64 and arm64".
- Trap: on macOS the docs say the mountpoint is used by Finder and a free path gets a symlink; on Linux an existing directory must be empty. Same command, opposite mountpoint expectations.

## SETUP-054: Windows user tries to mount
**Type**: short
**Topic**: Desktop mounts
**Persona**: Aisha Rahman, product manager on Windows 11 (PowerShell), whose engineer set up Agent Drive for her team. She wants a drive letter or folder.
**Goal**: Mount the drive on Windows.
**Preconditions**: Node 24 installed, CLI installed with `npm install -g @dennisonbertram/agent-drive`, logged in.
**Surface**: CLI
**Ideal path**: 1 — none; the supported route is the console in the browser or `get`/`put`. Mount is not available on Windows.
**Alternate paths**: Use the web console Files tab (`/console`); use `agent-drive get REMOTE --output FILE`; use WSL (Linux FUSE) if it works, unverified.
### Steps
1. Aisha runs `agent-drive mount "$HOME\AgentDrive"` → "No packaged Agent Drive mount helper is available for this platform." (`mount.ts:1231`). She cannot tell if she did something wrong or if Windows is unsupported.
2. She searches the docs; `docs/cli.md` describes only Linux x64/arm64 and macOS 13+. No document says "Windows is not supported" (discovery-setup.md section 4).
3. She falls back to the console Files tab at `/console`.
### Variations
- She tries `agent-drive connect coordinator C:\Work --sandbox m_abc --root /workspace` → the mountpoint is validated as an absolute path and the mount fails similarly on a non-darwin non-Linux platform (not confirmed).
- Windows-specific hint that exists elsewhere: `credentials export --to clipboard` explicitly supports "macOS and Windows" (`docs/cli.md:628`), which suggests Windows is a supported CLI platform, making the mount error more surprising.
### Edge Cases
- WSL: the clipboard doc treats WSL as Linux (`docs/cli.md:628`); whether FUSE works there is undocumented.
- An 8-character-wide Windows path such as `C:\` fails mountpoint validation ("Invalid mountpoint; use an absolute path." depends on POSIX `isAbsolute`; unverified on Windows).

## SETUP-055: Connect a live Instabox workspace and keep it across logins
**Type**: long
**Topic**: Desktop mounts
**Persona**: Dana Okafor, engineer coordinating three coding agents in Instabox sandboxes from her Mac. She wants each agent's `/workspace/project` folder visible in Finder, and the mount to survive reboots.
**Goal**: Mount sandbox `m_7f3a...` folder `/workspace/project` at `~/AgentWorkspaces/coordinator` and start it automatically at login.
**Preconditions**: macOS, Finder app installed and enabled, CLI installed (no Agent Drive login needed), `instabox` CLI installed in `/opt/homebrew/bin`.
**Surface**: mixed (CLI, Finder)
**Ideal path**: 3 — `mkdir -p`, `connect ... --persist`, open Finder.
**Alternate paths**: `connect ...` without `--persist`, then `mounts service install coordinator`; `mounts add NAME MOUNTPOINT --sandbox ID`; ask the agent (skill `skills/agent-drive/SKILL.md:171` has the exact commands).
### Steps
1. Dana reads `docs/cli.md` "Live workspace mounts" and runs `mkdir -p "$HOME/AgentWorkspaces"` → ok. She does not know the doc's `SANDBOX_ID` placeholder must be an `m_...` machine ID.
2. She runs `agent-drive connect coordinator "$HOME/AgentWorkspaces/coordinator" --sandbox "my-sandbox" --root /workspace/project --persist` → "Invalid Instabox sandbox ID; use its exact m_... ID, not a name or alias." (`mount-registry.ts:199`). Error recovery is clear but the docs never say where to find the ID.
3. She finds the ID with the Instabox tool and reruns with `--sandbox m_7f3a... --root /workspace/project --persist` → the CLI prints the saved entry as JSON, then the service runtime status (`cli.ts:870-872`), then returns (no foreground process).
4. She opens Finder → a location row for `coordinator` (the Finder row name for live mounts was not confirmed) shows the sandbox files including hidden `.env`.
5. She drops a new file in it → creates fine. She edits an existing file and saves → fails with a read-only error (`docs/cli.md:186-189`).
6. She copies her local env: `cp -n "$LOCAL_ENV_FILE" "$HOME/AgentWorkspaces/coordinator/.env"` → copies only if none exists.
7. She reboots → the login service restores the mount; `agent-drive mounts status coordinator` reports the local mountpoint state.
### Variations
- `--read-only` saves a read-only definition.
- `mounts list` reads the registry only and never wakes the sandbox.
- Registering a second name for the same sandbox folder is rejected: "This workspace is already registered as 'coordinator' at <path>. Use that Finder mount instead of adding an alias." (`mount-registry.ts:412`).
### Edge Cases
- She runs `mkdir -p "$HOME/AgentWorkspaces/coordinator"` too: "Finder mountpoint already exists: <path>" (`mount-registry.ts:162`). The docs only mkdir the parent but a natural habit is to mkdir the whole path. Hesitation and error point.
- Parent missing: "Finder mountpoint parent does not exist: <path>".
- Name violates the pattern: "Invalid mount name; use 1-64 letters, digits, "-" or "_", starting with a letter or digit."
- Typo in `--root` (not absolute or not normalized): "Invalid workspace root; use a normalized absolute sandbox path." (`mount-registry.ts:217`).
- Service does not start: "Workspace service 'coordinator' did not become active." (`cli.ts:424`).
- Naming mismatch: the feature is called a "sandbox" here but `docs/sandboxes.md` uses "sandbox" for a disposable machine running the agent; a reader landing on `/docs/sandboxes` finds nothing about `connect`.

## SETUP-056: Instabox CLI is missing
**Type**: short
**Topic**: Desktop mounts
**Persona**: Leo Martin, designer on a fresh Mac who was told by a teammate to "just connect the workspace". He has never heard of Instabox.
**Goal**: Mount a teammate's sandbox folder.
**Preconditions**: Agent Drive CLI installed, Finder app installed, no `instabox` binary.
**Surface**: CLI
**Ideal path**: 3 — install Instabox, rerun `connect`, open Finder.
**Alternate paths**: none found (Instabox install is not documented anywhere in this repo).
### Steps
1. Leo runs `agent-drive connect design "$HOME/AgentWorkspaces/design" --sandbox m_91c2 --root /workspace/site --persist` → the CLI cannot start the service: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." (`workspace-service.ts:159`; the code also searches `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, so the message under-lists the search paths).
2. He searches the docs for "Instabox" → `docs/cli.md` and `packages/agent-drive/README.md:49` ("Mount an existing Instabox workspace") use the word with no install link or account hint. Dead end for a newcomer.
3. He asks his teammate, installs Instabox, reruns `connect` → works.
### Variations
- Without `--persist` the foreground mount path wakes the sandbox through the same CLI on first access and fails the first read instead.
### Edge Cases
- The first failed `connect` may already have saved a registration. Rerunning with the same name could hit "A mount named 'design' is already registered." (`mount-registry.ts:410`). `cli.ts:878` unregisters on a foreground failure only when unchanged; whether the `--persist` path rolls back was not confirmed.
- Instabox installed to a custom path outside the searched directories is not found even though it is on `PATH` for the user's shell if launchd's PATH differs (service environment not confirmed).

## SETUP-057: Sandbox is asleep and wake is off
**Type**: medium
**Topic**: Desktop mounts
**Persona**: Grace Liu, platform engineer who pays per running sandbox. She wants her mount to leave a sleeping sandbox alone until she decides.
**Goal**: Turn wake-on-access off for `coordinator`, then turn it on when she needs the files.
**Preconditions**: `coordinator` registered with `--persist` (service active); the sandbox is stopped.
**Surface**: CLI and Finder
**Ideal path**: 3 — `mounts wake coordinator off`, check, `mounts wake coordinator on`.
**Alternate paths**: reconnect with `--no-wake-on-access` at creation; `mounts service remove coordinator` to stop it entirely.
### Steps
1. Grace runs `agent-drive mounts wake coordinator off` → the saved entry prints with `wakeOnAccess: false`; the managed service is restarted after a graceful stop (`docs/cli.md:179-181`, `cli.ts:1009-1056`).
2. She opens `~/AgentWorkspaces/coordinator` in Finder → the folder fails to read. The CLI side error is "Instabox machine is stopped; wake-on-access is disabled." (`workspace-wake.ts:240`), but it appears in the service log, not in Finder. What Finder shows to the user was not confirmed.
3. She runs `agent-drive mounts wake coordinator on` → the policy flips back and the service restarts again.
4. She opens the folder → the first file access starts the sandbox; this can take a while.
5. If the sandbox is stuck: "Instabox workspace wake timed out." or "Instabox machine did not reach the running state." (`workspace-wake.ts:261,272`).
### Variations
- A foreground mount uses the wake setting loaded at startup; she must stop it cleanly and rerun `agent-drive mount --name coordinator` (`docs/cli.md:181-182`).
- `mounts wake` with an unmanaged conflicting service: "Cannot change wake policy because the managed service 'coordinator' is not the exact owned definition." (`cli.ts:1033`).
- Unknown state such as `error`: "Instabox machine is in unsupported state: error."
- Wrong usage: `agent-drive mounts wake coordinator maybe` → "Usage: mounts wake NAME on|off".
### Edge Cases
- Contradictory copy: `docs/cli.md:176-178` says wake runs on first file I/O and "does not call Instabox" when changing the setting, yet changing the setting resolves the Instabox executable (`cli.ts:1019-1026`), so a missing Instabox fails `mounts wake`.
- Finder or Spotlight indexing can wake the sandbox unintentionally (`docs/cli.md:209-211` warns "Finder or another file browser can therefore wake the sandbox"). This warning sits far from the `--no-wake-on-access` flag description.

## SETUP-058: Forget and clean up a mount
**Type**: short
**Topic**: Desktop mounts
**Persona**: Ben Hart, tidying up after a project ends. He no longer wants the `coordinator` login service or mount.
**Goal**: Remove the service and forget the mount without touching sandbox files.
**Preconditions**: `coordinator` registered with `--persist`.
**Surface**: CLI
**Ideal path**: 2 — `mounts service remove coordinator`, `mounts forget coordinator`.
**Alternate paths**: none found.
### Steps
1. Ben runs `agent-drive mounts forget coordinator` first → refused: "Cannot forget 'coordinator' while its login service is <state>. Remove or repair it with `agent-drive mounts service remove coordinator` first." (discovery section 4).
2. He runs `agent-drive mounts service remove coordinator` → the owned startup definition is removed; registration and sandbox files remain.
3. He runs `agent-drive mounts forget coordinator` → if the Finder mountpoint is still present: "Cannot forget 'coordinator' while its Finder mountpoint is present. Stop the mount and try again."; otherwise prints `{"forgotten":"coordinator"}`.
### Variations
- After Ctrl+C on a foreground mount, `mounts forget` succeeds directly.
### Edge Cases
- Unknown name: "No mount registered as 'coordinator'." (`mount-registry.ts:330`).
- Missing name: "Usage: mounts forget NAME" (`cli.ts:972`).
- No command is named "disconnect" or "unmount" for live workspaces; the verb split (`mounts forget` versus Ctrl+C versus `mounts service remove`) is not summarized in `agent-drive --help` (`cli.ts:1722-1745` lists `mounts forget NAME` as "Forget an offline live workspace registration").

## Cross-story notes

- Fact shown on several surfaces: Finder app download (`docs/cli.md:20,240`, `native/macos/README.md:9`, `packages/agent-drive/README.md:38`, `skills/agent-drive/SKILL.md:157`); "Agent Drive is not enabled" banner and `Enable` fix (`docs/cli.md:260`, `README.md:38`, `SKILL.md:157`); wake policy (`docs/cli.md:162,176,209`, `cli.ts:1730,1733`).
- Not shown on the website, console, or `/llms.txt`: Finder app, `connect`, `mounts`, Instabox.
- Copy contradictions: "open it once" vs "does not open a window" (see story 01); CLI errors point to System Settings or Agent Drive.app while docs point to the Finder `Enable` banner (story 02); "does not call Instabox" for `mounts wake` vs `resolveInstaboxExecutable()` call (story 07); `SANDBOX_ID` in docs vs required `m_...` (story 05); `mkdir -p` of parent only vs "mountpoint already exists" (story 05); Windows unsupported but never stated (story 04).

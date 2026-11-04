# STORY-024: Console to terminal hand-off (login and first put)

Verdict: **convoluted**. Steps: about 9 actual (counted from the guide and screens), 4 ideal (catalog).

Sources: catalog STORY-024; screens `04-console-api-keys.jpg`, `02-console-files.jpg`, `12-dialog-load-drive-key.jpg`; `packages/agent-drive/src/cli.ts`, `config.ts`; `docs/cli.md`; lead-measured live facts. "Measured" means the lead ran it live; "read" means I read it in code or a screenshot; "suspected" means not verified.

## 1. Friction Scorecard

| #   | Actual step                                                                               | Ideal?                | Evidence                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the API keys tab and find the "From your terminal" block (below the key list)        | yes                   | screen 04 (read)                                                                                                                                                                                                       |
| 2   | Run `read -rs ... AGENT_DRIVE_API_KEY; export ...` and paste the key                      | yes                   | screen 04                                                                                                                                                                                                              |
| 3   | Edit `https://your-agent-drive-host` to the real host, run `login`                        | no, host is known     | screen 04 shows a placeholder; the live site is agent-drive.vercel.app (measured)                                                                                                                                      |
| 4   | Go back to Files, find the drive id (small grey monospace text beside the selector)       | no, drive id is known | screen 02 (read)                                                                                                                                                                                                       |
| 5   | Get the drive key: open "Load drive key" dialog and copy, or open the saved recovery file | partly                | screen 12: the dialog has an empty input and a file picker, nothing to copy from. Lead measured that the key could only be copied from the "Your drive. Your key." dialog textarea or the "Save recovery key" download |
| 6   | Run `read -rs ... AGENT_DRIVE_KEY` and paste the drive key                                | yes                   | screen 04                                                                                                                                                                                                              |
| 7   | Edit `./handoff.md`, `/memory/handoff.md` and `<drive-id>`, run `put`                     | yes                   | screen 04                                                                                                                                                                                                              |
| 8   | Read the put output (version JSON including `wrappedKey`)                                 | yes, but noisy        | measured                                                                                                                                                                                                               |
| 9   | Verify in the console (Files, Refresh, Load drive key, Download)                          | optional              | catalog steps 7-8                                                                                                                                                                                                      |

Counts:

- Terminal inputs the user must type or edit: 2 pastes, 3 placeholder edits (host, drive id, file names), 3 commands.
- Decisions: use `login` or env vars; saved key or env drive key; which key file field to use. None is explained by the guide.
- Re-entry of known data: host and drive id (both known to the console, entered by hand); the API key and drive key were shown once and must be re-pasted (unavoidable once, see changes).
- Dead ends: running `put` before step 6 fails with a missing-drive-key error (catalog step 4; `connect()` in `cli.ts` passes no key, and `resolveDriveKey` returns undefined). The guide lists the drive key step third, so this is a gentle order trap, not a dead end.
- Hesitations: (a) "Run the CLI from the repository after building it" with no package; a user who has not built the CLI hits `command not found` (suspected, not run). (b) The guide's own text says to set the key "through `agent-drive login`", but login is run after the key was pasted into an env var; both exist, and `login` writes the API key to `~/.config/agent-drive/config.json` (read: `writeConfig({ apiUrl, apiKey })`), so the first `read` is redundant after login. (c) The drive key is never saved by login, so a new shell loses it (read: `login` writes only apiUrl and apiKey; only `drive create` saves drive keys).
- Confirmations: none.

## 2. Take-away Pass

Screen 04, "From your terminal" block:

- Heading "Connect without sharing your identity." Unclear and not needed. Remove or replace with "Use this key in a terminal".
- Intro paragraph (CLI from the repository after building it; "Set your API URL and API key through `agent-drive login`"): the build note is the only useful sentence and it should be a link or an install line. The login sentence repeats the code block.
- Code block: line 1 (read API key) and line 2 (login) duplicate each other, since `login` takes the key from the env var and saves it. Line 5 (`agent-drive mcp`) is a different job (start an MCP server) and sits in the same block with no label. Keep: login, drive key, put. Collapse or label: mcp.
- Footer "To rotate access, create a replacement API key..." is a different task (rotation). Remove from this block or move to the key list.
- "Decryption keys and API keys are different: neither replaces the other." Useful, but it should be where the drive key prompt is, not after the block.

Screen 02, drive selector row:

- The drive id is shown in 9pt grey monospace with no copy button. It is the one value the terminal needs, and it is the quietest text on the screen.
- "Key required for downloads" tag: fine.

Screen 12, Load drive key dialog:

- Needed for browser decryption, not for the CLI. It gives the user a place to type a key but nothing to copy one from. For the hand-off it is the wrong dialog.

CLI output:

- `put` prints the full version JSON including `wrappedKey` (measured). The user needs "uploaded /memory/handoff.md, version id, size". `wrappedKey` is not useful to read and is wasteful in logs.
- `login` prints whoami JSON (catalog step 3). Acceptable as proof, but a one-line "Logged in as <agent> (read, write) on <host>" would be quicker to read.

## 3. The Simpler Version

Ideal as the catalog gives it is 4 steps. The real flow has about 9 because the console shows placeholders instead of values it holds. Proposed flow, 4 steps:

1. In the console, on the drive's page, click "Connect a terminal". It shows one copy-paste block with the real host and the real drive id already filled in.
2. Paste the block in a terminal. It asks for the API key (hidden), then the drive key (hidden), and runs `agent-drive connect`.
3. Run `agent-drive put ./handoff.md /memory/handoff.md` (drive defaults to the connected one).
4. Look at the one-line result.

Concrete changes, in priority order:

1. Prefill the real host and the drive id in the block. The console already knows both (screen 02 shows the id; the page is served from the host). This removes two edits and one trip to the Files screen. Evidence: screen 04 shows placeholders.
2. Add `agent-drive connect --api HOST --drive ID` that prompts for the API key and drive key (hidden) and saves both in the config (mode 0600). It replaces `read`, `export`, `login`, and the second `read`. Today `login` saves only the API key (`cli.ts` login branch), and the drive key must be exported every shell. The two `read -rs` lines exist only to keep the secret out of shell history; a hidden prompt in the CLI does the same.
3. Let `--drive` be optional when exactly one drive key is saved. Today `requiredDrive` throws "A --drive ID is required." (read, `cli.ts`).
4. Put a copy button on the drive id (screen 02) and on the "Your drive. Your key." recovery moment. Lead measured that the drive key could only be copied there; a user who dismissed the dialog has to find the recovery file.
5. Fix the `--key-file` gap: the recovery file is JSON, but `resolveDriveKey` reads it as raw key text (catalog alternate path; read in `config.ts`: `readFile(...).trim()`). Accept the JSON `key` field so the downloaded recovery file works directly: `agent-drive connect --key-file recovery.json`. Not run; based on reading the code.
6. Publish the CLI (or put a single `pnpm`/`npx` line in the block). The "build it first" line is an unstated step 0. Evidence: screen 04 text, catalog preconditions.
7. Shrink `put`'s output to a short line by default, keep JSON with `--json`.
8. Move `agent-drive mcp` to a separate "Use from an MCP client" block.

Already minimal: the `put LOCAL REMOTE` command itself, and the hidden-prompt idea.

## 4. Clarity Issues

- The two secrets have no labels that say where they came from. "API key" is on this screen, "Drive key" is on a different screen and a different dialog. Add "Drive key (from your recovery file)" in the prompt text.
- Placeholders look like text the user might keep: `https://your-agent-drive-host` and `<drive-id>`. A real user who runs the block unedited gets a connection failure (suspected; the host will not resolve) or "A --drive ID is required"-style errors.
- The terminology differs: "API keys" tab, "key" in the block, "drive key" in the dialog, "recovery key"/"recovery file" in downloads, "decryption keys" in the footer. Three names for the drive key (measured on the live site: "Your drive. Your key.", "Save recovery key", "Load drive key").
- Errors do not point to the fix: a missing drive key in `put` should say which env var or command sets it. The config error text does this for the API key ("Run `agent-drive login`") but the drive key message was only seen in the catalog; check it names `AGENT_DRIVE_KEY_<ID>` (suspected).
- `login --api` accepts both the bare origin and `/api` (measured) but the docs do not say which is right.

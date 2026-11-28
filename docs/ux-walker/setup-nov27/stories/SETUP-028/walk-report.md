# SETUP-028 1Password is not signed in, fall back to a file - walk report

Status: PARTIAL. Walked: `op` not installed (the story's precondition), the error text, the file fallback, `check`. Not walkable: installing `op`, desktop integration / signed-out states, vault locked, pasting into the 1Password app (no GUI, no clipboard on the Studio). No browser screen in this story, so no screenshots.

Account: SETUP-026 agent home copied to backup-first-file-028. That home already had a stdout backup recorded, so the "no backup yet" precondition was not exactly met; the failed export left the old record unchanged (verified with `credentials status`), which is the behaviour the error promises.

1. `agent-drive credentials export --to 1password` -> exit 1: `The 1Password CLI (\`op\`) is not installed. Nothing was exported. Install the 1Password CLI (https://developer.1password.com/docs/cli/get-started/), turn on its desktop-app integration or run \`eval $(op signin)\`, check that \`op whoami\` succeeds, then run this again.` Accurate and says nothing was exported, but it only tells the user to install more software. It does not mention the clipboard or file alternatives, which is exactly the hesitation in the story. Same message for `--vault Personal` and for `--to op`.
2. Clipboard alternative: `--to clipboard` -> `Could not copy to the clipboard with pbcopy. Nothing was exported. ...` (Studio has no pasteboard; not walkable). Priya would have to know the paste-and-confirm route; the 1Password error does not point at it.
3. File fallback: `credentials export --to ./cred.txt` -> `Backed up credentials for 1 drive(s) (file).` exit 0; file is mode 600 (`-rw-------`). The message does not print the path written, does not warn that a path in a repo or a cloud-synced folder is unsafe, and the story says the help only says "outside the repo". `--to ./1password` writes a file literally named `1password` (works, but the doc's `./clipboard` hint is the only guidance).
4. Re-run to the same path: `./cred.txt already exists; pass --force to overwrite it.` exit 1 (clear).
5. `credentials status` -> backedUp true, method `file`; `check` -> `check ok drive=<id>`.

## Flow Log
- Ideal path 3 (try 1Password, read error, export file): reached in 3 commands.
- Hesitations: the 1Password failure steers toward an install, not a fallback; no path is echoed on success.
- Re-entry: none. Duplicated info: the three-target backup text appears in the login hint, `check` failure and help.

# Changelog

## 0.6.0 (2026-11-28)

- `credentials export --drive ID --recovery-file PATH` writes one drive's key as a console recovery file. `credentials import` now accepts that file as well as a credentials bundle.
- `credentials status` shows `keyFrom` for a drive key that came from a recovery file, a bundle, an approval or the environment.
- A login that changes the API key keeps backup records for drive keys that did not change. The CLI prints a one-line note that the saved bundle has the old API key.
- `check` fails only for drive keys made on this machine with no backup. For keys that came from elsewhere it prints a note that the other copy is the backup.
- `get REMOTE LOCAL` writes to LOCAL and refuses an existing file. `get REMOTE --output FILE` still replaces it.
- `skill install` replaces an existing SKILL.md, reports it as `replaced`, and has its own `--help`.
- `login` gives clearer errors for rate limits, a wrong API URL, a denied request and an unknown pairing code. `--token-stdin` is no longer overridden by `AGENT_DRIVE_API_KEY`.
- `AGENT_DRIVE_KEY` and `AGENT_DRIVE_KEY_<DRIVE_ID>` are listed in the help.
- Setup error messages now say what to do next.

### Upgrading from 0.5.1

- `credentials status` can return `{"backedUp":true,"keyFrom":"..."}` with no `at` or `method`. Check those fields separately.
- `skill install` with no `--target` now exits 1 and writes to stderr when neither `~/.claude` nor `~/.codex` exists. Use `--target claude|codex|DIR` for unattended installs. On a reinstall it prints `replaced` instead of `wrote`.
- `put` and `get` reject relative remote paths. Remote paths must start with `/`.
- `credentials export --drive` requires `--recovery-file`. To back up all credentials, run the command without `--drive`.

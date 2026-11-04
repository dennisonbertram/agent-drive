# Agent Drive CLI

The CLI keeps the API token and drive keys in
`~/.config/agent-drive/config.json` (or `AGENT_DRIVE_CONFIG`). The directory is mode `0700` and
the file is mode `0600`; updates are atomic. `AGENT_DRIVE_API_URL` and `AGENT_DRIVE_API_KEY`
override saved values. Run `agent-drive login` with those environment variables, or pipe a token
to `agent-drive login --api URL --token-stdin`; tokens are never required in command arguments.

Drive-key precedence is the per-drive `AGENT_DRIVE_KEY_<DRIVE_ID>` variable (uppercase, with
non-alphanumeric characters replaced by `_`), then `AGENT_DRIVE_KEY`, then `--key-file`, then the
locally saved key. Drive keys are client secrets and are never sent to the API or S3.

Commands include `login`, `whoami`, `agent create`, `drive create`, `key create`, `key revoke`,
`put`, `get`, `ls`, `mv`, `cp`, `rm`, `versions`, `restore`, `search`, `recent`, and `sync`.
`put LOCAL REMOTE --drive ID` is create-only by default and encrypts before requesting an upload URL.
Use `--overwrite` for an unconditional replacement, or `--if-version ID` for an optimistic
conditional replacement; these flags are mutually exclusive. `get REMOTE --drive ID
--output FILE` writes only after authenticated decryption succeeds; without `--output`, only
small valid UTF-8 files are printed.
Inline text output rejects binary control bytes while allowing tabs and line breaks. `ls` and
`search` accept `--agent`, `--machine`, `--user`, and `--tag`; `recent` accepts `--since`.

Drive creation is idempotent. A newly created drive generates and prints a key once with a backup
warning. Re-running against an existing drive uses the retained local key and refuses to invent a
replacement when the backup is missing. Creating a scoped API key remains an explicit `key create`
step; a management key is not silently granted drive access.

`sync LOCAL_DIRECTORY --drive ID --prefix /folder` is upload-only. It skips symlinks, never
deletes remote files, stores private SHA-256/version manifests outside the uploaded directory,
skips unchanged files, and refuses unknown remote files unless `--overwrite-existing` is supplied
for deliberate initial adoption. That flag still uses a current-version guard; files with existing
manifest history always conflict if their remote version changed. It reads each local file once and
hashes the exact bytes uploaded. Corrupt or unreadable manifests fail rather than resetting conflict
history. Sync state is stored in a private sibling directory named `<config-path>.state`; an
existing state directory with unsafe permissions is rejected without changing its mode. Config
updates use an exclusive `<config-path>.lock` directory. A crashed CLI may leave that lock; remove
it manually only after confirming no Agent Drive CLI process is active. It is not a download or
destructive mirror.

## Install, device login, and backup

Install from the site: `npm install -g https://agent-drive.vercel.app/cli/agent-drive.tgz`, or run
without installing: `npx -y https://agent-drive.vercel.app/cli/agent-drive.tgz <command>`. The
Vercel build packs `packages/agent-drive` into `apps/web/public/cli/agent-drive.tgz`. The default
API URL is `https://agent-drive.vercel.app/api` (override with `--api` or `AGENT_DRIVE_API_URL`).

`agent-drive login [--name AGENT] [--no-browser]` runs the OAuth device flow when no
`AGENT_DRIVE_API_KEY` or `--token-stdin` is given. It prints a link and a code, opens a browser only
when stdout is a TTY, `CI` is unset, and `--no-browser` is absent, then polls until the human
approves. It saves the API key and unsealed drive keys to the private config and never prints
them. A drive key that fails to unseal is reported and skipped. See `docs/agent-login.md`.

`agent-drive backup LOCAL_DIRECTORY [--drive ID] [--prefix PATH] [--dry-run]` uploads every regular
file to `PATH/<relative path>` (default `/backups/<machine>`) with overwrite, so history is kept.
The drive defaults to the only drive key in config. A private manifest in `<config-path>.state`,
keyed by server, drive, prefix, and relative path, lets later runs skip unchanged files by SHA-256.
Symlinks are skipped, and one failing file does not stop the rest. It prints
`backup uploaded=N unchanged=N failed=N` and exits 1 if any file failed.

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
`put LOCAL REMOTE --drive ID` encrypts before requesting an upload URL. `get REMOTE --drive ID
--output FILE` writes only after authenticated decryption succeeds; without `--output`, only
small valid UTF-8 files are printed.

Drive creation is idempotent. A newly created drive generates and prints a key once with a backup
warning. Re-running against an existing drive uses the retained local key and refuses to invent a
replacement when the backup is missing. Creating a scoped API key remains an explicit `key create`
step; a management key is not silently granted drive access.

`sync LOCAL_DIRECTORY --drive ID --prefix /folder` is upload-only. It skips symlinks, never
deletes remote files, stores private SHA-256/version manifests outside the uploaded directory,
skips unchanged files, and refuses to overwrite a remote version changed since the manifest.
It is not a download or destructive mirror.

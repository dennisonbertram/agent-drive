# Back up and recover your drive key

This page shows how to back up an agent's credentials, check that the backup is recorded, and open your files again on a new machine or in the console. Do the backup right after the first login. A lost drive key cannot be recovered by Agent Drive, and without it nobody can decrypt the files in that drive.

For what each key is and what losing it means, see [Keys and recovery](keys-and-recovery.md).

## What you are backing up

The CLI saves the drive key in `~/.config/agent-drive/config.json` or the path in `AGENT_DRIVE_CONFIG`. If the agent seals it to your account, you can also open the drive in the dashboard. Back up the credentials before retiring the machine.

`agent-drive credentials export` writes a credentials bundle: the text `adcred1.` followed by base64url of JSON. The bundle holds the API key and every drive key saved on this machine. Treat it as a secret. It is the only secret the CLI ever prints.

## Back up

Run one of these commands. Offer the targets to the person in this order: 1Password, clipboard, file.

### 1Password

```sh
agent-drive credentials export --to 1password
```

Use `--vault NAME` to choose a vault. `--to op` is an alias.

The CLI runs `op whoami`, then creates an item titled `Agent Drive – <drive ids>` with the bundle in a concealed field labelled `credentials`. The bundle goes to `op` on standard input. It is never in the command arguments and never written to disk.

On success the backup is recorded and `agent-drive check` can pass. Failure behavior:

- If the 1Password CLI (`op`) is not installed, the command exits non-zero and says so. Nothing is exported or recorded.
- If `op` is installed but not signed in, the command exits non-zero and tells you to sign in and check that `op whoami` succeeds. Nothing is recorded.
- If `op item create` fails, the command exits non-zero and records nothing.

### Clipboard

```sh
agent-drive credentials export --to clipboard
```

Paste the bundle into Apple Passwords or another password manager. Then record the backup:

```sh
agent-drive credentials confirm
```

The export alone records nothing. The CLI waits 60 seconds, then clears the clipboard only if it still holds the bundle. Add `--keep-clipboard` to skip the clear. If the clear fails, the CLI prints `Could not clear the clipboard; clear it yourself.`

The clipboard target works on macOS and Windows only. On Linux and WSL the command exits non-zero and suggests `--to 1password` or a file.

### File

```sh
agent-drive credentials export --to /path/outside/the/sandbox/agent-drive-credentials.txt
```

Choose a path that survives the machine or sandbox. The CLI writes the file with mode `0600` and records the backup at once. If the path already exists, the command fails with `<path> already exists; pass --force to overwrite it.` Add `--force` to replace it. A symlink destination is refused.

A file named `1password`, `op` or `clipboard` is read as a target name, not a path. Use `./clipboard` for such a file.

### Standard output

```sh
set -o pipefail
agent-drive credentials export --stdout | <your secret store command> && agent-drive credentials confirm
```

`--stdout` prints only when standard output is not a terminal. If it is a terminal, the command refuses and tells you to pipe it. A `--stdout` export records nothing, so run `credentials confirm` after the secret store has saved the bundle. `set -o pipefail` makes a failed store stop `confirm`.

### Other failures

- `There is no API key to back up. Run agent-drive login first.` Log in, then export again.
- `There are no drive keys on this machine to back up.` This machine has no drive key to save.

After a file, 1Password or `confirm` backup, the CLI also tells the service that a backup happened, with the method (`file` or `stdout`) and never the key. If that report fails, the CLI prints a warning and the local record still counts. The console then shows the drive as backed up.

## Check backup status

```sh
agent-drive credentials status
```

The output is JSON. Each drive key on this machine is listed with `backedUp`. There are two shapes when `backedUp` is true:

```json
{ "drives": { "<drive id>": { "backedUp": true, "at": "<ISO time>", "method": "file" } } }
{ "drives": { "<drive id>": { "backedUp": true, "keyFrom": "a recovery file" } } }
```

The first shape means this machine recorded a backup, so `at` and `method` are present. The second shape means the key came from somewhere else (a recovery file, a credentials bundle, an approval, or an environment variable or `--key-file`), so a copy already exists off this machine. It has `keyFrom` and no `at` or `method`. A record with `at` and `method` can also carry `keyFrom`. `backedUp: false` has none of these fields. Consumers should check `at` and `method` separately and not assume they exist when `backedUp` is true.

The method is `file` for a file export or a `--from` import, `stdout` for 1Password, `credentials confirm` and imports from standard input, and `env` for a key that came from `AGENT_DRIVE_CREDENTIALS`.

`agent-drive whoami` also prints `keyBackup`, a map from drive ID to the same record, or `null` for a drive with no backup.

`agent-drive check` refuses to pass until every usable drive key is backed up. It fails with `drive key not backed up: <drive ids>` and the backup commands above. A key supplied through `AGENT_DRIVE_KEY_<DRIVE_ID>`, `AGENT_DRIVE_KEY` or `--key-file` is already outside the config file, so it is exempt.

## Restore on a new machine

1. Install the CLI. It needs Node 24 or newer.

```sh
npm install -g @dennisonbertram/agent-drive
```

To run without installing, prefix every command with `npx -y @dennisonbertram/agent-drive@latest`.

2. Import the bundle. From a file:

```sh
agent-drive credentials import --from /path/to/agent-drive-credentials.txt
```

Or from standard input, for example after copying the bundle out of a password manager (macOS):

```sh
pbpaste | agent-drive credentials import
```

The command merges the API URL, API key and drive keys into the config and marks those drives as backed up. It prints `imported <N> drive key(s) into <config path>`. It also accepts the console recovery file `agent-drive-<drive id>.key.json`, which holds only the drive key — no API credentials — so it is followed by `agent-drive login`; the approval page then says the agent already has the key for that drive and connects it, without creating a new drive. The key is bound to the API the CLI would use at that moment (`--api`, `AGENT_DRIVE_API_URL`, the saved API URL, or the default). If this machine already has a different key for that drive, the import stops with `This machine already has a different key for drive <id>. Nothing was changed.`; importing the same key again changes nothing. Text in neither format fails with `Not a recovery file (agent-drive-….key.json) or credentials bundle (adcred1.…).`

3. Check that the drive key opens the files.

```sh
agent-drive check
```

`check` must print `check ok`. If the key cannot decrypt existing files, it fails with `This drive key cannot decrypt existing files.`

For a sandbox that is deleted and recreated, you can skip the import. Set `AGENT_DRIVE_CREDENTIALS` as a secret on the platform, holding the bundle. The CLI merges it in memory at startup, never writes it to disk, and counts its drives as backed up. The saved config and explicit `AGENT_DRIVE_API_URL`, `AGENT_DRIVE_API_KEY` and `AGENT_DRIVE_KEY_<DRIVE_ID>` variables win over the bundle. See [Using Agent Drive in sandboxes](sandboxes.md).

### If the bundle holds a replaced API key

A bundle holds the API key that was current when you exported it. If a later `agent-drive login` replaced that key, the old key is revoked. The drive key in the old bundle still decrypts the files, but the API key does not work.

To give a new agent access to the old drive, run `agent-drive login` on it. On the approval page, open Details and choose "Use one of my drives instead", then load the recovery file or the bundle. The browser seals the drive key to the new agent. See [Connect an agent](connect-an-agent.md).

## Open files in the console

The console shows file names and metadata without any key. To decrypt and download a file in the browser, it needs the drive key. Load it in one of these ways:

- **Passphrase.** If you set up passphrase unlock, drives an agent sealed to your account open with it — nothing is pasted. Agents seal held keys on their own; `agent-drive account seal --drive <drive id>` seals one on demand. A passphrase slot is not a backup of the drive key. See [Keys and recovery](keys-and-recovery.md).
- **Recovery file.** Choose "Load key" in the key menu, then "Choose recovery file" (or drop the file on the box). The recovery file is JSON named `agent-drive-<drive id>.key.json` with the fields `format` (`agent-drive-key-v1`), `driveId` and `key`. It must be under 16,384 bytes and its `driveId` must match the drive. Otherwise the console says `That recovery file is not for this drive.` or `That is not a recovery file.` The chooser also accepts an `adcred1.` bundle saved as a file; it takes the key for this drive.
- **Pasted key or bundle.** Open "Paste a key instead" and paste the drive key or an `adcred1.` bundle. From a bundle the console takes the key for the selected drive only.

The key stays in that browser tab. It is cleared when you reload the page or after 30 minutes without use. It is not sent to the service and not saved in browser storage.

If you have no recovery file, prefer the path that pastes no secret: set up passphrase unlock in the console, then ask the agent that holds the drive to run `agent-drive account seal --drive <drive id>` and unlock with your passphrase. If you skip the passphrase, ask the agent to run `agent-drive credentials export --to <a file on your machine>` and choose that file — an `adcred1.` bundle works in the file chooser too. Do not let the agent paste the bundle into a chat. An agent-only drive is never sealed, so it always needs a recovery file or bundle.

### Write a recovery file from the CLI

To give a person the key for one drive without handing over the whole bundle, run:

```sh
agent-drive credentials export --drive <drive id> --recovery-file <path>
```

The file holds only that drive's key, in the same format as the console download, with mode `0600`. The command refuses an existing path (add `--force` to replace it), needs the parent folder to exist, and never prints the key. The person chooses the file in the console's Load key dialog. This is a copy for someone else, so it is not recorded as an account backup; use `credentials export --to …` for that.

### Download a recovery file

In Files, open the drive’s key menu and choose **Download recovery file**. An enrolled passkey or passphrase unlocks the account’s copy if the tab needs it. The download contains the same key that opens your existing files. Save it privately and choose **I saved it** to record the backup.

## Back up folders (not keys)

Key backup is separate from file backup. To upload a working directory to the drive before a sandbox ends, use `agent-drive backup`. See [Files, versions and sync](files-and-sync.md).

`backup` scans the folder first and prints what it found, then uploads. `--gitignore` skips paths the folder's `.gitignore` excludes — and `.git` control metadata, since git never traverses it (a `.git` directory or a linked worktree's `.git` file). `--exclude GLOB` skips more paths. Neither is on by default, so ignored files such as `.env` and the `.git` folder are backed up. More than 5000 files or 1 GiB is refused unless `--yes` is passed — preview first with `--dry-run`. Only one backup runs per prefix at a time; progress goes to stderr every 10 seconds. `agent-drive --version` prints the CLI version.

## A login that replaces the API key

When `agent-drive login` saves a different API key, the CLI keeps the backup record of each drive key that did not change and drops only the records of drive keys that changed. A saved bundle still holds the old API key, so the CLI prints this one-line note:

```text
Your saved credentials backup has the old API key; run `agent-drive credentials export` again when convenient.
```

`agent-drive check` still passes for drive keys that did not change. It fails with `drive key not backed up` only for a drive key that changed, until you export again. The backup date that the console shows is stored by the service. Login does not clear it, so the console keeps showing the last reported backup until you export again.

## If the key is lost

- **Cannot be done:** Agent Drive cannot recover, reset or regenerate a drive key. The service never has it. The files stay encrypted and nothing in the service can open them.
- **Still possible:** if any one of these exists, you can restore access: a credentials bundle, a recovery file, the config file on any machine, a key in `AGENT_DRIVE_KEY*`, or a browser tab that has the key loaded. In the console, a loaded tab can download the recovery file.
- **Passphrase unlock:** if you set up a passphrase, the console can open drives that you added to your account. Resetting the passphrase removes every drive from the account and asks for each recovery file again. Files are not deleted.
- **No backup at all:** the file contents cannot be read. Paths, sizes, tags and version history remain visible in the console. Support cannot read the files either, because the service never holds the drive key.

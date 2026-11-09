# Back up and recover your drive key

This page shows how to back up an agent's credentials, check that the backup is recorded, and open your files again on a new machine or in the console. Do the backup right after the first login. A lost drive key cannot be recovered by Agent Drive, and without it nobody can decrypt the files in that drive.

For what each key is and what losing it means, see [Keys and recovery](keys-and-recovery.md).

## What you are backing up

The drive key exists only in the CLI config file (`~/.config/agent-drive/config.json`, or the path in `AGENT_DRIVE_CONFIG`). Agent Drive never receives it. If that file is lost, the files in the drive cannot be opened, and Agent Drive cannot restore the key for you.

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

The output is JSON. Each drive key on this machine is listed with `backedUp`, and when backed up, `at` and `method`:

```json
{ "drives": { "<drive id>": { "backedUp": true, "at": "<ISO time>", "method": "file" } } }
```

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

   The command merges the API URL, API key and drive keys into the config and marks those drives as backed up. It prints `imported <N> drive key(s) into <config path>`. A text that is not a valid bundle fails with `Not a valid Agent Drive credentials bundle.`

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

The console shows file names and metadata without any key. To decrypt and download a file in the browser, it needs the drive key. You have two ways to give it one:

- **Recovery file.** Choose "Load key" in the key menu, then "Choose recovery file" (or drop the file on the box). The recovery file is JSON named `agent-drive-<drive id>.key.json` with the fields `format` (`agent-drive-key-v1`), `driveId` and `key`. It must be under 16,384 bytes and its `driveId` must match the drive. Otherwise the console says `That recovery file is not for this drive.` or `That is not a recovery file.`
- **Pasted key or bundle.** Open "Paste a key instead" and paste the drive key or an `adcred1.` bundle. From a bundle the console takes the key for the selected drive only.

The key stays in that browser tab. It is cleared when you reload the page or after 30 minutes without use. It is not sent to the service and not saved in browser storage.

If you have no recovery file, ask the agent that created the drive to run `agent-drive credentials export`, then choose or paste what it gives you.

If you set up a passphrase in the console, you can unlock your drives with it instead. A passphrase slot is not a backup of the drive key. See [Keys and recovery](keys-and-recovery.md).

### Download a recovery file

When a drive key is loaded in the tab, choose "Download recovery file" in the key menu. The console also offers the file when it creates a drive. The file holds the key in plaintext, so store it in a password manager or another secure place. After the file saves, choose "I saved it". The console then records the backup with method `file`. The key is not sent.

## Back up folders (not keys)

Key backup is separate from file backup. To upload a working directory to the drive before a sandbox ends, use `agent-drive backup`. See [Files, versions and sync](files-and-sync.md).

## A login that replaces the API key

When `agent-drive login` saves a different API key, the CLI clears all local backup records. The old bundle holds the revoked key, so it no longer counts as a backup. The CLI prints:

```text
The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.
```

`agent-drive check` then fails with `drive key not backed up` until you export again. The backup date that the console shows is stored by the service. Login does not clear it, so the console keeps showing the last reported backup until you export again.

## If the key is lost

- **Cannot be done:** Agent Drive cannot recover, reset or regenerate a drive key. The service never has it. The files stay encrypted and nothing in the service can open them.
- **Still possible:** if any one of these exists, you can restore access: a credentials bundle, a recovery file, the config file on any machine, a key in `AGENT_DRIVE_KEY*`, or a browser tab that has the key loaded. In the console, a loaded tab can download the recovery file.
- **Passphrase unlock:** if you set up a passphrase, the console can open drives that you added to your account. Resetting the passphrase removes every drive from the account and asks for each recovery file again. Files are not deleted.
- **No backup at all:** the file contents cannot be read. Paths, sizes, tags and version history remain visible in the console. Whether Agent Drive support can do anything else in this case: TBD, no support process is documented in the repository.

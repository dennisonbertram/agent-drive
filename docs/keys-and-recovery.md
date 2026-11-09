# Keys and recovery

This page lists every key and secret in Agent Drive, says where each one is kept and what it unlocks, and says what happens if you lose it. Read it before you decide where to keep backups. The steps to back up and restore are in [Back up and recover your drive key](backup-and-recovery.md). The byte formats are in [Encryption format](crypto.md).

A lost drive key cannot be recovered by Agent Drive. The service never has it.

## Key inventory

| Name                             | Who holds it                                                   | Where it is stored                                                                     | What it unlocks                                                                                                     | What the service stores                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key                          | An agent                                                       | The CLI config file, or `AGENT_DRIVE_API_KEY`                                          | Calls to the HTTP API within the key's scopes, drives and write paths. It does not decrypt anything.                | A hash of the key, its label, scopes, drive IDs and write paths. The key is shown once when it is issued.                                                  |
| Drive key                        | The agent, and any browser tab or person you give it to        | The CLI config file, `AGENT_DRIVE_KEY_<DRIVE_ID>`, `AGENT_DRIVE_KEY` or a `--key-file` | Decrypting every file in one drive, and unwrapping that drive's trace inbox key                                     | Nothing. It is never sent to the API or to object storage.                                                                                                 |
| Account key (passphrase)         | The person, in the console                                     | The passphrase is in your head or password manager. The browser derives a key from it. | Opening, in the console, the drives that you added to your account                                                  | The account public key, the private key wrapped by the passphrase, and one sealed copy of each added drive key (a slot). It never receives the passphrase. |
| Recovery file                    | The person                                                     | A file you saved, named `agent-drive-<drive id>.key.json`                              | Loading one drive's key into a console tab                                                                          | Nothing                                                                                                                                                    |
| Credentials bundle (`adcred1.…`) | The person or a secret store                                   | A password manager, a file, or `AGENT_DRIVE_CREDENTIALS`                               | The API key and all drive keys on one machine. It can be loaded into the CLI or, for one drive, into a console tab. | Nothing                                                                                                                                                    |
| Share link key                   | Whoever has the link                                           | In the URL fragment after `#k=`                                                        | One file version, until the link expires or is revoked                                                              | Share metadata (the version, expiry, whether revoked). Not the key.                                                                                        |
| Trace inbox key                  | The service (public half), the drive key holder (private half) | The private half is wrapped under the drive key, in the service                        | Sealing webhook traces to a drive, and opening them                                                                 | The public key and the wrapped private key                                                                                                                 |
| Webhook token (`adw_…`)          | OpenRouter                                                     | OpenRouter's webhook settings                                                          | Sending traces to one drive's webhook URL. It cannot read anything.                                                 | A SHA-256 of the token. The token is shown once.                                                                                                           |

## The drive key

A drive key is 32 random bytes, written as 43 characters of base64url. The client that creates the drive generates it. It is never sent to the API or to S3.

Every file version gets its own random file key. The drive key wraps (encrypts) each file key, and the service stores the wrapped keys. Anyone with the drive key can open every file in that drive. Anyone without it can open none.

The CLI looks for the drive key in this order and uses the first one it finds:

1. `AGENT_DRIVE_KEY_<DRIVE_ID>`: the drive ID in uppercase, with each character that is not a letter or digit replaced by `_`.
2. `AGENT_DRIVE_KEY`
3. The file named by `--key-file`
4. The key saved in the config file, `~/.config/agent-drive/config.json` (or the path in `AGENT_DRIVE_CONFIG`)

The config directory has mode `0700` and the file has mode `0600`. The config records which API origin each saved key belongs to. A key saved for another origin, or one that does not decode to 32 bytes, is not used.

A key from an environment variable or `--key-file` is outside the config file. For that reason, `agent-drive check` does not require a backup for it.

Never store a drive key in the drive it unlocks.

## Recovery file and passphrase unlock in the console

The console works on metadata without any key. To decrypt a file in the browser, it needs the drive key in that tab. There are two ways to load it:

- **Recovery file.** A JSON file with `format`, `driveId` and `key`. You download it from the console when you create a drive, or later from the key menu when a key is loaded. You choose it again whenever a tab needs the key. The key stays in that tab. It is cleared when you reload or after 30 minutes without use.
- **Passphrase unlock.** You can set up a passphrase in the console. The browser makes an account key pair and wraps its private key with a key derived from the passphrase (PBKDF2-SHA-256, 600,000 iterations by default). When you add a drive, the browser seals that drive's key to the account public key and stores the result as a slot. Typing the passphrase then opens every drive you added. The console can generate a 20-character passphrase for you, which has 100 bits of randomness. A passphrase you choose yourself must be at least 14 characters.

Slots are not backups. A slot is added only after you load a drive's key from a recovery file or bundle, and adding one does not change the drive's backup status. A slot works only while you are signed in and the passphrase works. Keep a recovery file or a bundle as your backup.

Changing the passphrase re-wraps the same account key. It does not lock out someone who already knows the old passphrase. If the passphrase may be known, reset it instead. A reset deletes the account key and removes every drive from it. Files are not deleted. You add each drive again with its recovery file. Anyone who already opened a drive keeps its key.

## What losing each key means

| If you lose                                                          | What happens                                                                                         | How to recover                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The drive key, with no backup anywhere                               | The files in that drive can never be decrypted. Paths, sizes, tags and version history stay visible. | Not possible. Agent Drive cannot recover or reset a drive key.                                                                                                         |
| The drive key on one machine, but you have a bundle or recovery file | Nothing is lost.                                                                                     | Import the bundle with `agent-drive credentials import`, or load the recovery file in the console. See [Back up and recover your drive key](backup-and-recovery.md).   |
| An API key (the config file or the secret is gone)                   | The agent cannot call the API. Files are not affected.                                               | Revoke the key if it may have leaked, then run `agent-drive login` again. Reconnecting an old drive to a new agent needs the drive key from a recovery file or bundle. |
| The passphrase                                                       | The console cannot open your drives with it.                                                         | Reset it, then load each drive's recovery file. Files are not deleted.                                                                                                 |
| A recovery file                                                      | Nothing is lost if another copy of the drive key exists.                                             | Download a new one from the console with a key loaded, or export a new bundle with the CLI.                                                                            |
| A credentials bundle                                                 | Nothing is lost if the CLI config still exists. The bundle held an API key that may now be exposed.  | Run `agent-drive credentials export` again. Revoke the old API key if the bundle may have leaked.                                                                      |
| A share link                                                         | The file is not affected. Whoever has the link can still read that version until it expires.         | Run `agent-drive share list`, then `agent-drive share revoke SHARE_ID`, and make a new link.                                                                           |
| A webhook token                                                      | OpenRouter can no longer send traces.                                                                | In the console, replace the token and update OpenRouter.                                                                                                               |

## Rotation and revocation

Revoke an API key when an agent or a machine is no longer trusted:

```sh
agent-drive key revoke <key id>
```

You can also revoke an agent or a key in the console. A key that an agent issued with `agent-drive credentials issue` can be revoked alone, from the console under Agents. Revoking the key of the agent that issued it does not revoke the keys it issued.

Revoke a share link with `agent-drive share revoke SHARE_ID`. Replace or revoke a webhook token in the console. The service checks API keys and webhook tokens for revocation on every request.

What revoking does not do:

- It does not change the drive key. A person or machine that already has the drive key can still decrypt any ciphertext it has, and any ciphertext it can still obtain by other means.
- It does not re-encrypt past data.
- Revoking an API key does not remove a copy of the key from a backup bundle. The bundle's API key stops working, but the drive key in it stays valid.

Agent Drive has no command or console action that rotates a drive key. [Encryption format](crypto.md) says a future rotation format has to be versioned. To move to a new drive key today, create a new drive, download each file from the old drive with `agent-drive get --output` and upload it to the new drive with `agent-drive put`, then delete the old drive. Deleting is queued, not immediate. See [Threat model](threat-model.md).

# Using Agent Drive in sandboxes

This page helps you keep an agent connected to its drive when it runs in disposable sandboxes, containers or CI jobs. You store the agent's credentials bundle once in a secret store, then give it to every new sandbox as `AGENT_DRIVE_CREDENTIALS`.

## The problem

The drive key exists only on the machine where the agent logged in, in `~/.config/agent-drive/config.json`. If the sandbox is deleted, the key is gone and the files in the drive can never be opened again. A new sandbox also has no API key, so it would need a human to approve a new login.

The fix is a credentials bundle: one line of text (starting with `adcred1.`) that holds the agent's API key and drive key. Keep it in a secret store and set it as `AGENT_DRIVE_CREDENTIALS` in each sandbox.

## Set up once

Run this on the machine where the agent already logged in (see [Quickstart](quickstart.md)). Replace `<secret store command>` with a command that reads the bundle from stdin and saves it, for example a 1Password or cloud secret manager CLI.

```sh
set -o pipefail
agent-drive credentials export --stdout | <secret store command> && agent-drive credentials confirm
```

`--stdout` prints the bundle only when stdout is not a terminal, so you must pipe it. `set -o pipefail` makes the pipeline fail if the secret store command fails, so `confirm` runs only after the bundle was stored. `credentials confirm` records the backup. Without it, `agent-drive check` fails with "drive key not backed up".

Then, in your sandbox or CI platform, create a secret named `AGENT_DRIVE_CREDENTIALS` whose value is the bundle from the secret store.

Do not use a CI secret as the backup itself. Keep the bundle in a password manager or secret store you can read back, and copy it into CI from there. Other backup targets (`--to 1password`, `--to clipboard`, `--to PATH`) are in [Back up and recover your drive key](backup-and-recovery.md).

Never print the bundle in a chat, a log, or a file inside a drive.

## What each new sandbox does

When `AGENT_DRIVE_CREDENTIALS` is set, the CLI and the MCP server read it at startup:

- The bundle is merged in memory. It is never written to disk.
- Saved values win over the bundle. The explicit variables `AGENT_DRIVE_API_URL`, `AGENT_DRIVE_API_KEY` and `AGENT_DRIVE_KEY_<DRIVE_ID>` also win over it. If the sandbox has no config file and none of those variables, the bundle supplies everything.
- The bundle's drives count as backed up (method `env`), so `agent-drive check` can pass. This applies only when the effective API key is the bundle's key and the API origin matches the origin the bundle recorded for the drive key. The CLI reports the backup to the service once per process; a failure to report is only a warning.

Check the result:

```sh
agent-drive whoami
agent-drive check
```

`check` must print `check ok`. If your agent is read-only, see [Common failures](#common-failures).

## One bundle per agent

Each agent that runs in a sandbox should have its own API key. Do not copy your own bundle into another agent's environment.

If your key has the `delegate` scope (check with `agent-drive whoami`), issue a separate bundle for the new agent. Replace the placeholders.

```sh
set -o pipefail
agent-drive credentials issue --name "<new agent name>" --write-path /work/<new agent name> --stdout | <secret store command>
```

The command creates a new agent with its own API key and prints one `AGENT_DRIVE_CREDENTIALS=adcred1.…` line. The line holds only that key and the chosen drive's key. Your own API key and config are not included and not changed. Options:

| Option                | Meaning                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `--name NAME`         | Required. The new agent's name. A name that already exists returns 409; pick another.              |
| `--drive ID`          | The drive to share. Defaults to the only drive key saved for the current API.                      |
| `--scope S`           | Repeat for each scope. Defaults to `read` and `write`. Must be within your own scopes.             |
| `--write-path P`      | Repeat to limit writes to folders.                                                                 |
| `--label L`           | Label for the new API key.                                                                         |
| `--to PATH [--force]` | Write the line to a mode 600 file instead of `--stdout`. Pass exactly one of `--to` or `--stdout`. |

Tell the human to set the stored value as `AGENT_DRIVE_CREDENTIALS` in the new sandbox. The line printed by `issue` starts with `AGENT_DRIVE_CREDENTIALS=`; the value is the part after `=`.

If your key lacks `delegate`, ask the human to approve you again with "Let this agent add other agents" ticked on the approval page.

To remove one issued agent, revoke its API key in the [console](console.md) under Agents. Revoking it does not affect you or other agents.

## No global installs

If the sandbox does not allow global installs, prefix every command with `npx -y @dennisonbertram/agent-drive@latest`:

```sh
npx -y @dennisonbertram/agent-drive@latest whoami
npx -y @dennisonbertram/agent-drive@latest check
```

To install the agent skill in a sandbox, CI job or shared machine, give it a directory instead of using your home folder:

```sh
agent-drive skill install --target ./skills/agent-drive
```

See [Agent skills](skills.md).

## Environment variables

| Variable                     | Purpose                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_DRIVE_CREDENTIALS`    | The credentials bundle (`adcred1.…`). Merged in memory, never written to disk.                                                                                                                    |
| `AGENT_DRIVE_CONFIG`         | Path of the config file. Default `~/.config/agent-drive/config.json`.                                                                                                                             |
| `AGENT_DRIVE_API_URL`        | API URL. Default `https://agentdrive.xyz/api`. Overrides the saved and bundle values.                                                                                                             |
| `AGENT_DRIVE_API_KEY`        | API key. Overrides the saved and bundle values.                                                                                                                                                   |
| `AGENT_DRIVE_MACHINE`        | Machine name recorded with uploads. Default is the host name. Set a stable value in sandboxes.                                                                                                    |
| `AGENT_DRIVE_KEY_<DRIVE_ID>` | The drive key for one drive. Take the drive ID, make it uppercase, and replace each character that is not a letter or digit with `_`. Example: drive `3f2a-91` becomes `AGENT_DRIVE_KEY_3F2A_91`. |
| `AGENT_DRIVE_KEY`            | A drive key used for any drive that has no `AGENT_DRIVE_KEY_<DRIVE_ID>`.                                                                                                                          |

Drive-key precedence is `AGENT_DRIVE_KEY_<DRIVE_ID>`, then `AGENT_DRIVE_KEY`, then `--key-file` (CLI only), then the saved or bundle key. A key supplied through `AGENT_DRIVE_KEY*` or `--key-file` is outside the config and does not need a backup record for `check`.

## Common failures

- The sandbox cannot reach `https://agentdrive.xyz` (network blocked). Stop and tell the human. Do not try to work around it.
- `no usable drive key`: run `agent-drive whoami` and read `localDriveKeys`. A drive key counts only for the API origin it was saved for, so check that `AGENT_DRIVE_API_URL` matches the bundle's origin. If it still fails, run `agent-drive login` again.
- `AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.`: the value was truncated or has extra characters. Copy the bundle again. Do not paste the `AGENT_DRIVE_CREDENTIALS=` prefix into the value.
- `drive key not backed up`: run `agent-drive credentials confirm` after the bundle is stored, or set `AGENT_DRIVE_CREDENTIALS` so the bundle counts as the backup.
- `check ok ... (read-only)` or `check not verified`: a read-only key cannot write the check file, so `check` decrypts an existing file instead. On an empty drive it prints `check not verified` and exits 1. Run it again after another agent writes a file. Do not report setup as complete until it prints `check ok`.
- MCP tools fail with "MCP tool call requires approval, but approval policy is never" under `codex exec`: see [Codex approval](mcp-tools.md#codex-approval) in the MCP page.

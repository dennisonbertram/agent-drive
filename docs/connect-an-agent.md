# Connect an agent

This page helps you log in an agent, approve it in the browser, add more agents to the same drive, and limit what each agent can do. It also lists the common login errors and their fixes.

## How login works

`agent-drive login` uses a device flow. The CLI prints a link and a code. A person opens the link while signed in to Agent Drive, checks that the code matches the one in the terminal, and clicks Approve. The CLI finishes by itself. Nobody copies an API key.

The request expires after 10 minutes. If it expires, run `agent-drive login` again.

Default on Approve:

- Scopes `read`, `write`, `delete` and `share`. Never `manage`.
- A new drive named after the agent. The agent creates the drive key on its own machine. Agent Drive never sees it.

The approval page shows these defaults in a summary line. Click Details to see them as a list. Details also has a checkbox, "Let this agent add other agents to its drives", which adds the `delegate` scope. Tick it only for an agent that must hand its drive to other agents.

Login never prints an API key or a drive key. It prints the agent name, the usable drives, the scopes and the config file path.

## Log in

```sh
agent-drive login --name "<your agent name>"
```

Without `--name`, the agent is named `<machine name> agent`.

The CLI opens the link in a browser when stdout is a terminal and `CI` is not set. To print the link only:

```sh
agent-drive login --name "<your agent name>" --no-browser
```

For a self-hosted installation, add the API URL:

```sh
agent-drive login --name "<your agent name>" --api https://<your-origin>/api
```

To save an API key you already have, without the browser flow, pipe it in:

```sh
printf '%s' "<api key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin
```

This saves the API key only. It does not give the machine any drive key.

Environment variables:

- `AGENT_DRIVE_API_URL` sets the API URL.
- `AGENT_DRIVE_API_KEY` supplies an API key. If it is set, `login` saves that key instead of starting the browser flow.
- `AGENT_DRIVE_CONFIG` sets the config file path.

The CLI keeps its settings in `~/.config/agent-drive/config.json` (mode 600) unless `AGENT_DRIVE_CONFIG` says otherwise. The default API URL is `https://agentdrive.xyz/api`.

## Reconnect

Run `agent-drive login` again on the same machine, with the same `--name` and API origin. The CLI sends its saved API key as proof. If that key is still valid, the approval reconnects the agent to the drives it used before, and keeps its previous permissions. The drive keys already on the machine stay in place.

Login issues a new API key, so credential backups made earlier are out of date. The CLI says so and clears the backup records. Run `agent-drive credentials export` again (see [Back up and recover your drive key](backup-and-recovery.md)).

## Add another agent

Choose the handoff that fits.

| Situation                                                                                                     | Use                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| The new agent has a shell, a person is present, and an existing agent holds the `delegate` scope              | `grant`                            |
| The new agent has a shell, a person is present, and they have the drive's recovery file or credentials bundle | Recovery file on the approval page |
| The new agent is in a sandbox with no browser, and an existing agent holds `delegate`                         | `credentials issue`                |

### Grant from an agent that holds the drive

1. On the new agent's machine, run `agent-drive login --name "<new agent name>"`. It prints a code.
2. On the agent that holds the drive, run:

```sh
agent-drive grant <code> --write-path <folder>
```

Add `--read-only` for read only. Add `--drive <drive id>` if the machine holds more than one drive key. `--scope` (repeatable) sets the scopes explicitly.

The command seals the drive key to the new login and prints the approval URL. A person still clicks Approve on that page, which shows "Offered by" with the agent name, the drive and the permissions. Nothing secret is printed or sent in the clear.

The granting key needs the `delegate` scope. An agent cannot grant more than it holds, and cannot pass on `delegate`. If the granting key is limited to write paths, the new agent's write paths must be inside them.

### Use a recovery file on the approval page

1. On the new agent's machine, run `agent-drive login --name "<new agent name>"`.
2. Open the link, click Details, and choose "Use one of my drives instead (needs its recovery file)".
3. Pick the drive. Choose the recovery file, or paste the drive key or an `adcred1.` credentials bundle. Your browser seals the key to the new agent. Agent Drive never sees it.
4. Optional: tick Read only, or enter a folder to allow writes under.
5. Click Approve agent.

This option appears only on a new request, when your account already has a drive. A recovery file or credentials bundle is checked against the drive. A pasted key cannot be checked in the browser.

### Issue credentials for a sandbox

From an agent whose key has `delegate`:

```sh
agent-drive credentials issue --name "<new agent name>" --write-path <folder> --stdout
```

Send the output into the platform's secret store, then tell the person to set it as `AGENT_DRIVE_CREDENTIALS` there. Do not copy your own credentials into another agent's environment. To write to a file instead of stdout, use `--to <path>`.

If your key lacks `delegate`, ask the person to approve you again with "Let this agent add other agents to its drives" ticked. See [Using Agent Drive in sandboxes](sandboxes.md).

## Limit an agent

- Read only: use `--read-only` with `grant`, or tick Read only on the approval page.
- Scopes: `--scope read --scope write` with `grant`, `credentials issue` or `key create`. A key with `delegate` (used by `grant` and `credentials issue`) can hand out only `read`, `write`, `delete` and `share`, and only the ones it holds. It never grants `manage` or `delegate`. A key with `manage` (used by `key create`) can create keys with any scope.
- Write paths: `--write-path <folder>` limits writes to a folder. Repeat it for up to 16 folders. A folder starts with `/` and does not end with `/`, for example `/inbox/agent`.
- Revoke: in the console, open Agents and choose Revoke access, or open API keys and revoke one key. A revoked key stops working at its next request.

To create a scoped key by hand, you need a key with the `manage` scope:

```sh
agent-drive key create --agent <agent id> --drive <drive id> --label "<label>" --scope read --scope write --write-path /inbox
agent-drive key revoke <key id>
```

Without `--scope`, `key create` grants `read` and `write`. The API key is shown once; the service keeps only a hash.

## Check and troubleshoot

```sh
agent-drive whoami
agent-drive check
```

`whoami` prints the agent, its drives and scopes, and which drives have a key on this machine. `check` must print `check ok`.

| Message                                       | Fix                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| no usable drive key                           | Run `agent-drive login` again. The approval creates a drive for this agent.      |
| The API key lacks a scope                     | Run `agent-drive login` again. Do not run `agent-drive drive create`.            |
| The API key may only write under some folders | Not a login problem. Write under those folders.                                  |
| The approval link asks you to sign in         | Sign in first, then click Approve.                                               |
| The login code expired                        | Run `agent-drive login` again.                                                   |
| drive key not backed up                       | Run one of the `credentials export` commands in the [Quickstart](quickstart.md). |

Chat assistants that run in a vendor's cloud and have no shell on your machine are not supported. Encryption happens on the agent's own machine.

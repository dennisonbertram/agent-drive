# Agent Drive quickstart

Agent Drive stores encrypted file contents for agents. The service sees paths, sizes, tags, and
activity metadata, but not plaintext file contents or drive keys. Lost drive keys cannot be recovered.

## Connect an agent

1. Create a human account at `/sign-up`.
2. Give your agent this one line, with your own origin: `Set up Agent Drive: https://agentdrive.xyz/llms.txt`.
   The agent follows the setup guide at that URL. Or do the same steps yourself, below.
3. Install the CLI (Node 24 or newer) from npm:

```sh
npm install -g @dennisonbertram/agent-drive
# No global installs allowed? Prefix every command with:
#   npx -y @dennisonbertram/agent-drive@latest
```

4. Log in. The CLI prints a link and a code.

```sh
agent-drive login --name "my agent"
# On a self-hosted installation, install from its origin and pass its API URL:
#   agent-drive login --name "my agent" --api https://YOUR-ORIGIN/api
```

5. Approve it. Open the link while signed in, check that the code matches the one the CLI printed,
   and click Approve. The command finishes by itself. You do not copy an API key.
6. Back up the credentials. The drive key exists only on this machine, so if the machine or sandbox
   is deleted the files can never be opened again.

Offer these choices in this order and let the person pick:

```sh
agent-drive credentials export --to 1password     # 1Password (needs the `op` CLI, signed in)
agent-drive credentials export --to clipboard     # macOS and Windows: copy, paste into Apple Passwords or another manager, then:
agent-drive credentials confirm                   # records the clipboard backup
agent-drive credentials export --to /a/path/outside/the/sandbox/that/survives   # a file, mode 600
```

`--to clipboard` clears the clipboard after 60 seconds if it still holds the credentials (add
`--keep-clipboard` to skip that). 1Password and the file record the backup at once; the clipboard
records it when you run `confirm`. Then `agent-drive check` passes.

7. Check that it worked. Setup is complete only when this prints `check ok`.

```sh
agent-drive check
```

8. Store and fetch a file, then share it.

```sh
printf 'hello from an agent\n' > sample.txt
agent-drive put ./sample.txt /sample.txt
agent-drive get /sample.txt --output ./downloaded.txt
cmp ./sample.txt ./downloaded.txt
agent-drive share /sample.txt --expires-in 24h
```

The complete share URL is a bearer secret: its fragment contains the file decryption key. Add
`--drive ID` to a command if you have more than one drive. See the [CLI reference](cli.md).

To add the Agent Drive skill through skills.sh, run `npx skills add dennisonbertram/agent-drive`.

## Use MCP

Claude Code:

```sh
claude mcp add agent-drive -- agent-drive mcp
```

Other MCP clients launch the command `agent-drive` with the argument `mcp`. Codex needs per-tool
approval for tools that change data; see the [CLI reference](cli.md). Restart the MCP client after
changing saved credentials.

## Sandboxes and more agents

- In a sandbox that is deleted or recreated, set `AGENT_DRIVE_CREDENTIALS` as a secret on the
  platform, holding the credentials bundle (`agent-drive credentials export --stdout`, then `agent-drive credentials confirm`). Every new sandbox is then
  already connected.
- To add another agent, run `agent-drive login` on its machine and approve it in the browser. You can
  make it read-only or limit its writes to one folder.

## Operate the workspace

- The console browses metadata while locked. Load a recovery key to decrypt downloads in browser
  memory. Refreshing or leaving the files page loses that in-memory key.
- Overwrites and restores of an older version create new versions. Restoring a file's current version
  from the trash only brings it back, with no new version. Trash does not reclaim retained storage.
- Revoke an agent or API key in the console when its access is no longer required.
- `/console/billing` shows plan allowances, usage, spending controls, and statements. See
  `/pricing` for plans.
- `/console/settings` shows the account-scoped audit log and permanent deletion controls.
  Deletion requires an exact confirmation, disables new access, and queues a background purge.
  Wait for completion; accepting the request does not prove all bytes have already been erased.

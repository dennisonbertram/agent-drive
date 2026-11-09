# Quickstart

This page walks you through connecting an agent to Agent Drive, backing up its credentials, and storing and sharing a first file. Run the steps in order as a checklist.

Alternative start: give your agent this line, and it follows the same steps from the setup guide.

```text
Set up Agent Drive: https://agentdrive.xyz/llms.txt
```

## 1. Sign up

Create your account at [/sign-up](https://agentdrive.xyz/sign-up).

## 2. Install the CLI

Agent Drive needs Node 24 or newer.

```sh
npm install -g @dennisonbertram/agent-drive
```

If global installs are not allowed, put this prefix in front of every command below instead of `agent-drive`:

```sh
npx -y @dennisonbertram/agent-drive@latest
```

## 3. Log in and approve

```sh
agent-drive login --name "<your agent name>"
```

The CLI prints a link and a code. Open the link while signed in, check that the code matches the one in the terminal, and click Approve. The command finishes by itself. You do not copy an API key.

For a self-hosted installation, pass its API URL:

```sh
agent-drive login --name "<your agent name>" --api https://<your-origin>/api
```

## 4. Back up the credentials

The drive key exists only on this machine. If the machine or sandbox is deleted, the files can never be opened again. Back up the credentials now. Offer these choices in this order and let the person pick one.

1Password (needs the `op` CLI, signed in). This counts as the backup at once:

```sh
agent-drive credentials export --to 1password
```

Clipboard (macOS and Windows). Paste the credentials into Apple Passwords or another password manager, then confirm:

```sh
agent-drive credentials export --to clipboard
agent-drive credentials confirm
```

The clipboard is cleared after 60 seconds if it still holds the credentials. Add `--keep-clipboard` to skip that.

A file on a path that survives the sandbox. The file has mode 600 and counts as the backup at once:

```sh
agent-drive credentials export --to <path outside the sandbox>
```

## 5. Check

```sh
agent-drive check
```

Setup is complete only when this prints `check ok`. It refuses to pass until step 4 is done. A read-only agent prints `check ok ... (read-only)` once the drive holds a file. On an empty drive it prints `check not verified`, so run it again after another agent writes a file.

## 6. Store, fetch and share a file

```sh
printf 'hello from an agent\n' > sample.txt
agent-drive put ./sample.txt /sample.txt
agent-drive get /sample.txt --output ./downloaded.txt
cmp ./sample.txt ./downloaded.txt
agent-drive share /sample.txt --expires-in 24h
```

`cmp` prints nothing when the files match. If you have more than one drive, add `--drive <drive id>` to each command.

The full share URL is a secret. Its fragment (the part after `#`) holds the file decryption key. Do not log it or post it anywhere you do not trust. See [Share links](sharing.md).

## 7. Optional: skill and MCP

Install the skill so the agent saves and recalls files without being asked:

```sh
agent-drive skill install
```

This writes into `~/.claude/skills` or `~/.codex/skills`, whichever of `~/.claude` and `~/.codex` exists. In a sandbox, CI or on a shared machine, use `agent-drive skill install --target <dir>`.

Add the MCP server to Claude Code:

```sh
claude mcp add agent-drive -- agent-drive mcp
```

Other MCP clients run the command `agent-drive` with the argument `mcp`. See [MCP server and tools](mcp-tools.md) and [Agent skills](skills.md).

## Next steps

- [Connect an agent](connect-an-agent.md): add more agents and limit what they can do.
- [Files, versions and sync](files-and-sync.md): work with files, versions and folders.
- [Using Agent Drive in sandboxes](sandboxes.md): keep a drive across sandboxes that are deleted.
- [The console](console.md): browse, restore and share files in the browser, and manage billing and your account.

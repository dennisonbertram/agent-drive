# Agent Drive quickstart

Agent Drive stores encrypted file contents for agents. The API sees paths, sizes, tags, and
activity metadata, but not plaintext file contents or drive keys. Lost drive keys cannot be recovered.

## Connect an agent to a configured installation

1. Open the installation's `/sign-up` page and create a human account through its Clerk instance.
2. In `/console`, create a drive and save its one-time recovery JSON somewhere secure. That JSON
   contains a plaintext secret; do not commit it, email it, or paste it into an agent conversation.
3. Create an agent and a drive-scoped API key. Grant `read` and `write`, adding `share` or `delete`
   only when needed. API keys authorize operations; drive keys separately decrypt contents.
4. Clone this repository, install Node 24 and the pinned pnpm version, and build the private CLI.
   The package is not yet published to npm; do not assume a global binary exists.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm --filter ./packages/agent-drive build

export AGENT_DRIVE_API_URL=https://YOUR-AGENT-DRIVE-ORIGIN
read -rs -p 'Scoped API key: ' AGENT_DRIVE_API_KEY; printf '\n'
export AGENT_DRIVE_API_KEY
read -rs -p 'Drive key: ' AGENT_DRIVE_KEY; printf '\n'
export AGENT_DRIVE_KEY
export DRIVE_ID=YOUR_DRIVE_UUID

printf 'hello from an agent\n' > sample.txt
pnpm agent-drive put ./sample.txt /sample.txt --drive "$DRIVE_ID"
pnpm agent-drive get /sample.txt --drive "$DRIVE_ID" --output ./downloaded.txt
cmp ./sample.txt ./downloaded.txt
pnpm agent-drive share /sample.txt --drive "$DRIVE_ID" --expires-in 24h
```

These examples use Bash's hidden prompt. Use your shell's secure input equivalent or a secret
manager on other platforms. Prefer per-drive key variables or an explicitly protected config
file for multiple drives; see [CLI documentation](cli.md). Do not put secret values in arguments.
The complete share URL is a bearer secret: its fragment contains the file decryption key.

## Use MCP

Configure your MCP host to launch `node /ABSOLUTE/CHECKOUT/packages/agent-drive/dist/cli.js mcp`.
Forward the API URL, scoped API key, and drive key through protected environment variables, or
use `AGENT_DRIVE_CONFIG` pointing to the CLI's private config file. See the [README](../README.md#mcp-server)
for Claude Code and Codex examples and the included [skill](../skills/agent-drive/SKILL.md).
Restart the MCP process after changing saved credentials.

## Operate the workspace

- The console browses metadata while locked. Load a recovery key to decrypt downloads in browser
  memory. Refreshing or leaving the files page loses that in-memory key.
- Overwrites and restores create new versions. Trash does not reclaim retained storage.
- Revoke an agent or API key in the console when its access is no longer required.
- `/console/billing` shows plan allowances, usage, spending controls, and statements. Paid
  checkout is disabled until the deployment has complete billing configuration. `/pricing`
  displays the shared plan definitions and configured rates, not proof of live payment setup.
- `/console/settings` shows the account-scoped audit log and permanent deletion controls.
  Deletion requires an exact confirmation, disables new access, and queues a background purge.
  Wait for completion; accepting the request does not prove all bytes have already been erased.

For local development, follow the [service and database setup](../README.md#local-development-environment).
Use `http://localhost:3100` consistently for browser testing; mixing it with `127.0.0.1` can cause
same-origin mutations to be rejected. Next.js needs app-local environment configuration; the
root Docker `.env` is not automatically loaded by the web application.

For a hosted installation, follow the [deployment and release runbook](deployment.md). The local
test-auth adapter is never a substitute for live Clerk acceptance.

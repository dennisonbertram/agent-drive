# SETUP-048 walk report (medium): Codex agent cannot write because MCP approval is "never"

Account 44 console plus docs pages served by the app, and the real `agent-drive mcp` server over stdio on the Studio. Codex itself and `codex exec` approval behavior are NOT walkable here (no Codex run); that part is marked not-walkable.
Status: PARTIAL (copy and docs checked; the Codex failure and its fix not exercised).

## Steps

1. Console, Agents tab, Connect an agent -> `MCP setup: Codex (~/.codex/config.toml)` (step-1). Snippet is exactly three lines: `[mcp_servers.agent-drive]`, `command = "agent-drive"`, `args = ["mcp"]`, with a Copy button. No approval blocks and no note that non-read-only tools fail under `codex exec`. A user who copies this will hit the refusal the story describes. The three MCP setups are collapsed by default, and the panel does not say the CLI must be logged in first.
2. /docs/mcp-tools "Codex approval" section (step-2): states the refused tools (put, download, move, copy, delete, restore, share), the read-only ones (whoami, get, list, versions, search, recent), a sample block approving only `put` and `download`, and the warning about `default_tools_approval_mode = "approve"`. Clear and complete, but the sample covers only 2 of the 7 refused tools; the user must write the other five blocks by hand. Same text exists in /llms.txt under "MCP setup (optional)", also with put and download blocks.
3. Real MCP server (`agent-drive mcp`, tools/list): 13 tools; readOnlyHint true for whoami, get, list, versions, search, recent (6) and false for put, download, move, copy, delete, restore, share (7). This matches the docs ("exposes 13 tools"; 7 refused; 6 read-only), so the counts agree across docs and server. The server also printed `Your account has no account key yet, so the console cannot open this drive. Set a passphrase in the console under Settings; agents will add the drive then.` to the stream when starting, an unrelated notice inside an MCP launch.
4. Mobile 390x844 on the docs page (step-3): code block and inline code fit; no horizontal overflow. Geometry hits are on the docs nav/footer and sticky header and are false positives.
5. Not walkable: `codex exec` run showing `MCP tool call requires approval, but approval policy is never`; editing ~/.codex/config.toml and restarting Codex; rerun success.

Browser errors: none.

## Flow Log

- Ideal 4 (copy snippet with approval blocks, restart, run). The console snippet gives a path that ends in a failure the console never mentions; the user must leave the console for docs/llms.txt to learn the fix, so the real path is 6+ steps including a failed run.
- Hesitation: the failure message mentions "approval policy is never" with no pointer to docs.
- Duplicated info: Codex approval explained in docs/mcp-tools and llms.txt, absent from the console.

# SETUP-030 Read-only agent runs `check` on an empty drive - walk report

Status: NOT-WALKABLE in this run. Making a read-only reviewer needs either `agent-drive grant` or `credentials issue`/`key create`, all of which need an agent key with the `delegate` scope, which in turn needs a new device login with the "Let this agent add other agents" box ticked. The server rate-limits device login starts (docs/api-device-login.md: 20 starts per IP per hour, shared by all walkers here), and for the whole session `agent-drive login` returned `Agent Drive refused the login request: slow_down`. The existing test agent (SETUP-026) lacks delegate:

`agent-drive key create --agent <id> --drive <id> --label ro --scope read` -> `The API key needs the delegate scope.\nRun \`agent-drive login\` again; on the approval page, tick "Let this agent add other agents to its drives" (under "Optional") before approving.`
`agent-drive credentials issue --name ro-reviewer --scope read --stdout` -> same message. This error is clear and gives the exact recovery.

What was checked statically: docs/sandboxes.md "Common failures" explains the result: "`check ok ... (read-only)` or `check not verified`: a read-only key cannot write the check file, so `check` decrypts an existing file instead. On an empty drive it prints `check not verified` and exits 1. Run it again after another agent writes a file. Do not report setup as complete until it prints `check ok`." The step text in the story (`check not verified drive=<id>: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.` on stderr, exit 1) could not be observed. The story's concern (wording "not verified" and exit 1 read like a failed key) stays unconfirmed.

## Flow Log
- Steps specified 4; walked 0. Blocker: login rate limit (see finding), not a product defect in the check command.

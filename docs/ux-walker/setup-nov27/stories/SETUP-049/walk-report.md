# SETUP-049 walk report (short): Sandbox with a read-only credentials bundle and an empty drive

Status: PARTIAL. The read-only bundle path was walked against a drive that already holds a file. The story's empty-drive case (`check not verified ... nothing to decrypt yet`) was NOT walkable: the only way to get a fresh empty drive is a new `login`, and the local server rate-limited device logins (`slow_down`) for over 20 minutes, and `drive create` needs the `manage` scope which login does not grant (`The API key lacks the "manage" scope.`).

## Steps
1. From the laptop agent with delegate (account 44): `agent-drive credentials issue --name auditor --scope read --to ./auditor.env` -> `Created agent "auditor" with key <id>: scopes read.` and `Store this line as a secret in the sandbox. Revoke it from the console under Agents.`
2. Sandbox (fresh HOME, AGENT_DRIVE_CREDENTIALS = value after `=`): `whoami` shows scopes `["read"]`, driveIds, localDriveKeys true, keyBackup method env. Clear.
3. `agent-drive check` on a drive that has files -> `check ok drive=<id> (read-only)`, exit 0. The "(read-only)" suffix is a good signal.
4. `agent-drive put a.md /x/a.md --drive <id>` with the read-only bundle -> `The API key lacks the "write" scope.` then `Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope.` For a bundle-only sandbox `login` is the wrong advice (it needs a browser and a human; the right fix is a new bundle from an agent with delegate or from the owner).
5. Not walkable: empty-drive `check` message and exit code 1; wait-and-recheck after another agent writes. `agent-drive --help` describes `check` as: Write, read back, compare a test file (read-only keys: decrypt an existing file); needs backed-up keys; prints "check ok". It does not mention the empty-drive "not verified" outcome. /docs/sandboxes says only: check must print check ok; if your agent is read-only, see Common failures.

## Flow Log
- Ideal 3; the walkable part took 3 commands with clear output. The empty-drive wording could not be judged; the story's concern (exit 1 reads as broken) remains unverified.

# SETUP-050 walk report (medium): Agent loses delegate and the owner re-approves

Status: PARTIAL. Step 1 (error without delegate) walked with an API-key agent that lacks delegate (account 47, invoice-bot). Steps 2-6 (reconnect via `login` with the same name, delegate checkbox on /connect for a reconnect, the `API key changed` message, re-export, reissue) were NOT walkable: every new `login --no-browser` against the local server returned `Agent Drive refused the login request: slow_down` for over 20 minutes across six fresh attempts (different homes and names), after about ten logins earlier in this walk. Reason: rate limit on device logins in this environment.

## Steps

1. `agent-drive credentials issue --name sandbox-1 --drive <id> --stdout` with a key lacking delegate -> `The API key needs the delegate scope.` then `Run `agent-drive login` again; on the approval page, tick "Let this agent add other agents to its drives" (under "Optional") before approving.` exit 1. Clearer than the story expected, since it names the fix. Problems: (a) it says the box is under "Optional", but the /connect page (SETUP-044 step-2) hides it inside a collapsed row labelled "Details", and no "Optional" heading exists; (b) it does not say to reuse the same agent name so the login reconnects the existing agent; (c) docs/sandboxes and llms.txt call the box "Let this agent add other agents", the page says "Let this agent add other agents to its drives": two wordings of the label.
2. `grant` with a key lacking delegate was not reached (it first needs a drive key on the machine: `There is no drive key for <id> on this machine.`).
3. Device-login rate limit: `Agent Drive refused the login request: slow_down` (no wait time, raw OAuth error name). A first-time user who retries a failed setup a few times meets this wall with no explanation.
4. Not walkable: reconnect /connect summary, delegate checkbox on reconnect, message about the changed API key, re-export, second issue attempt, whether old bundles keep working.

## Flow Log

- Ideal 5; only step 1 walked. The error message already carries the fix, but the "Optional" mismatch and the missing "same name" instruction would make a first-timer hesitate on the approval page.

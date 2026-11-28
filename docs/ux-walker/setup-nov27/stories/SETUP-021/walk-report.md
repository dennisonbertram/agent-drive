# SETUP-021 walk report: reconnect an agent approved before
Account: test user e2e_approve_connect_024 (agent `luis-claude` with one drive). Two scenarios walked, because the story's premise (a reinstalled laptop with the same agent name reconnects to the old drive) does not match the app.

## A. Lost config, same agent name (the story's persona)
1. `agent-drive login --name luis-claude --no-browser` in a fresh home (no saved key). Page "Connect luis-claude?" says "New encrypted drive · full access" and "This agent gets its own encrypted drive" (screenshots/step-1.png). Nothing warns that an agent called luis-claude already exists in the account.
2. Approved. Result: the account's Agents page shows one agent `luis-claude` with "2 ACTIVE KEYS" (screenshots/step-2.png) and a second drive also named `luis-claude`. So the same name merges into the old identity, creates a new empty drive, and does NOT reconnect to the old drive. The key for the old drive stays unusable on the new machine. The page copy "It reconnects to the drive it used before" never appears here.

## B. Same machine, config still present (real reconnect)
3. `login --name luis-claude` in the home that still holds the key. First attempt failed: `Agent Drive refused the login request: slow_down` (see below). After the rate window reopened the page showed "luis-claude · full access", Details closed, paragraph "It reconnects to the drive it used before and keeps its previous permissions." (screenshots/step-3.png). The word "reconnect" is not a title or label; the card still says "Connect luis-claude?" The drive name equals the agent name so the summary reads "luis-claude · full access" and does not name the drive.
4. Details (screenshots/step-4.png): Drive `luis-claude`, Access "Read, write, delete, share", Writes "Anywhere in the drive", delegate checkbox unticked (the earlier approval had no delegate). The account also has a second drive with the same name, so "Drive luis-claude" is ambiguous. The Approve button is below the fold once Details opens.
5. Typed the verification code, Approve. Done card (screenshots/step-5.png): "You approved luis-claude to read, write, delete and share luis-claude." The repeated name reads like a typo.
6. CLI: `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.`, `Logged in as agent luis-claude.`, `Usable drives: bd26ee32-...`, `Scopes: read write delete share`. The drive key was still on disk so the agent kept working. Good, clear message.

## Rate limit (blocks repeated attempts)
After about 20 login starts from this machine the CLI printed only `Agent Drive refused the login request: slow_down`. The docs (api-device-login.md) say the limit is 20 starts per IP per hour; the CLI message does not say that, how long to wait, or what to do. `slow_down` is also the word the docs use for polling too fast. The block lasted about one hour here.

## Flow Log
- Steps specified: 3. Needed: 3 in scenario B; scenario A needs the user to realise a new drive was created.
- Hesitations: whether this is a reconnect; which drive; duplicate drive names.
- Re-entry: none. Duplicated info: agent and drive names are identical, repeated three times on the summary line and the done card.
- Verdict: PARTIAL pass. Scenario B works. Scenario A (the story as written) silently creates a second drive; the old drive's key is not recovered.

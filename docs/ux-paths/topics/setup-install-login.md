# Setup stories: Agent-first install and login

> ID note: stories in this file now use catalog IDs SETUP-009 to SETUP-015 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-009, 02 = SETUP-010, 03 = SETUP-011, 04 = SETUP-012, 05 = SETUP-013, 06 = SETUP-014, 07 = SETUP-015.

Topic: /llms.txt, npm or npx install, `agent-drive login` output and flags, polling, expired code, sign-in vs sign-up bounce for a new user.
Verified in code (not run): `apps/web/app/llms.txt/route.ts`, `packages/agent-drive/src/device.ts`, `cli.ts:657-678` and help at `cli.ts:1718`, `config.ts:29`, `apps/web/app/(app)/connect/{page,connect}.tsx`, `apps/web/app/site-header.tsx` (`AuthLinks`), sign-in/sign-up pages, `docs/quickstart.md`, `docs/agent-login.md`.

Facts used across stories (checked in code):

- CLI prints, in order: `Open this link to approve: <origin>/connect?code=XXXX-XXXX`, `Check that the code matches: XXXX-XXXX`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...` (`device.ts` log calls). Poll every 5 s, +5 s on `slow_down`; gives up when elapsed would pass `expires_in` (10 minutes); 5 consecutive network failures abort.
- Browser opens only if stdout is a TTY, `CI` is unset and `--no-browser` is absent (`shouldOpenBrowser`).
- Default agent name is `"<hostname> agent"` (`defaultAgentName`); `--api` > `AGENT_DRIVE_API_URL` > saved config > default (`resolveLoginApiUrl`).
- `/connect` signed out redirects to `/sign-in?redirect_url=%2Fconnect%3Fcode%3D...` (`connect/page.tsx`). The sign-in page shows Clerk plus a line "Already have an account?" is NOT shown there; it shows `AuthLinks to="sign-up"`: "New here? Sign up free · Pricing · Docs" with `redirect_url` carried.

---

## SETUP-009: Pasting the llms.txt line into a local agent, happy path for an existing account

**Type**: long
**Topic**: Agent-first install and login
**Persona**: Priya Raman, a backend developer on macOS, already has an Agent Drive account (signed in to agentdrive.xyz in Chrome yesterday). She runs Claude Code in `~/work/billing-api`.
**Goal**: Her agent is connected to a drive and `check ok` prints.
**Preconditions**: Node 24 installed, npm global installs allowed, signed in to the web app, no `~/.config/agent-drive/config.json`.
**Surface**: mixed
**Ideal path**: 6 — paste line (1), approve in browser (3 actions: read code, type verification code, click) and the agent does install, login, backup, skill, check on its own; the human touches 4 times.
**Alternate paths**: Human types `npm install -g @dennisonbertram/agent-drive` then `agent-drive login` herself (hero "or in a terminal:" on `/`); `docs/quickstart.md` step list (sign up, install, login); console `/console` onboarding panel "Give your first agent a home." with `Copy`; console Agents tab "Connect an agent" panel.

### Steps

1. On `/` in the hero panel "Give this to your agent", click `Copy prompt` → clipboard holds `Set up Agent Drive: https://agentdrive.xyz/llms.txt`; hint line "Free to start. Your agent shows a pairing code, and you approve it in your account."
2. Paste the line into Claude Code and press Enter → agent fetches `/llms.txt` (served by `apps/web/app/llms.txt/route.ts`), which starts with the index ("# Agent Drive", Docs/Pages lists) then "## Set up (local agent with a shell)".
3. Agent runs `npm install -g @dennisonbertram/agent-drive` (step 1 of llms.txt) → installs; `agent-drive` is on PATH.
4. Agent runs `agent-drive login --name "billing-api agent"` → prints `Open this link to approve: https://agentdrive.xyz/connect?code=KBDF-MWNP`, `Check that the code matches: KBDF-MWNP`, `Verification code: 3f9a 07c2 b8e1 5d44`, `Waiting for approval...`. Chrome opens (stdout is a TTY inside her terminal only if the agent runs it in a TTY; many agent shells are not TTYs, so no browser opens, see Variations).
5. Agent tells Priya, per llms.txt: "Open this link (you must be signed in to Agent Drive), check that the code matches the one I printed, type the verification code into the page — it never shows it — and click Approve." Priya clicks the link.
6. `/connect?code=KBDF-MWNP` loads (already signed in) → tag "Pairing request", h1 "Connect billing-api agent?", summary like "New encrypted drive · full access".
7. Priya compares "Does this code match your terminal?" code with the terminal → matches.
8. She types `3f9a 07c2 b8e1 5d44` into `Verification code` (placeholder `a1b2 c3d4 e5f6 7890`, hint "Type the code from your agent’s terminal. This page never shows it.") and clicks `Approve agent` → button shows `Working…`, then tag "Approval saved", h1 "Access approved for billing-api agent", "Return to your agent to finish setup and confirm it is ready."; button `Open console`.
9. Terminal, within 5 s, prints `Logged in as agent billing-api agent.`, `Usable drives: <id>`, `Scopes: read, write...`, `Config: /Users/priya/.config/agent-drive/config.json`, `New drive <id> created; its key is saved in the config file.` and the BACKUP_HINT paragraph.
10. Agent offers backup choices (1Password, clipboard, file). Priya picks 1Password; agent runs `agent-drive credentials export --to 1password` → stderr "Saved the credentials for 1 drive(s) to 1Password."
11. Agent runs `agent-drive skill install` → `wrote /Users/priya/.claude/skills/agent-drive/SKILL.md`.
12. Agent runs `agent-drive check` → `check ok`. Agent reports setup done.

### Variations

- Agent runs `login` in a non-TTY shell: browser does not open; the agent must relay the link. If the agent forgets to tell her about the "Verification code:" line, she reaches `/connect` and sees a required field with no source (the page itself never shows it).
- Priya's console is open in another tab; `/console` shows the passphrase banner "Set a passphrase and agents will add every drive’s key to your account — then each one opens here automatically." with `Set up` after the first login (not part of this story's goal).

### Edge Cases

- Same fact on several surfaces: the pairing step is described as "a pairing code" and "click Approve" on `/` (`home.ts:8`) and in `console.tsx:316` ("It installs the CLI and gives you a link; open it and click Approve."), but `/llms.txt` and `docs/connect-an-agent.md:7` add the verification code. Priya reading only the website hears about one code, then meets two (the 8-letter code and the 16-hex verification code).
- Name the terminal prints for the code: "Check that the code matches" (CLI) vs "Does this code match your terminal?" (page): same fact, different wording, both fine.
- Priya presses `Approve agent` with an empty field: error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890."

---

## SETUP-010: Brand-new user follows the CLI link while signed out and lands on the sign-in form

**Type**: long
**Topic**: Agent-first install and login (sign-in vs sign-up bounce)
**Persona**: Tomás Herrera, a freelance ML engineer on Ubuntu 24.04, has never visited agentdrive.xyz. A colleague gave him the line `Set up Agent Drive: https://agentdrive.xyz/llms.txt`. He runs Codex in a terminal.
**Goal**: Create an account and approve his agent without losing the pairing request.
**Preconditions**: No Agent Drive account, no Clerk session, Node 24, config absent.
**Surface**: mixed
**Ideal path**: 9 — agent steps then link, Clerk sign-up (email, verify), return to `/connect`, type code, Approve.
**Alternate paths**: Sign up first at `/sign-up` via header `Sign up free` or hero, then run the line (quickstart step 1 "Create your account at /sign-up"); on the sign-in page use "New here? Sign up free"; the console route `/console` does not carry a return path (`redirect('/sign-in')`), so signing up from the console loses nothing but also is not the CLI path.

### Steps

1. Tomás pastes the line into Codex → agent reads `/llms.txt`, installs with `npm install -g @dennisonbertram/agent-drive`, runs `agent-drive login --name "tomas-laptop codex"` → four lines printed; `xdg-open` opens the link because stdout is a TTY.
2. Browser opens `https://agentdrive.xyz/connect?code=LTRH-QZVK` → server sees no user and redirects to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DLTRH-QZVK`. Page title "Sign in | Agent Drive", header links `Pricing`, `Docs`, and a Clerk Sign in card.
3. Tomás has no account. He hesitates: the card is a sign-in form (email, Continue). He looks for a way to register → below the card: "New here? Sign up free · Pricing · Docs".
4. He clicks `Sign up free` → `/sign-up?redirect_url=%2Fconnect%3Fcode%3DLTRH-QZVK` (via `authHref`, `site-header.tsx`), Clerk sign-up card.
5. He enters his email, completes Clerk's verification step → Clerk follows `redirect_url` (pages set `fallbackRedirectUrl="/console"`, so `/console` only if redirect is lost).
6. Lands on `/connect?code=LTRH-QZVK` → "Connect tomas-laptop codex?" with "New encrypted drive · full access" (first-time account: `accounts` row created on first authenticated load).
7. He reads `Details` is collapsed; the `Account` row is inside it. He checks the code, types `Verification code`, clicks `Approve agent` → "Access approved for tomas-laptop codex".
8. Terminal prints `Logged in as agent tomas-laptop codex.` ... `New drive <id> created; its key is saved in the config file.`

### Variations

- Tomás types his email on the sign-in card first and Clerk reports no such account (exact Clerk wording not verified): he then finds the sign-up link.
- He signs in with a social provider if Clerk offers it (not verified which providers are enabled).
- He opens the printed link on his phone because the agent runs on a remote server: sign-up works the same; the code is typed from another device, which the page allows (it never shows the code).

### Edge Cases

- Clarity risk: `/connect` always redirects to `/sign-in`, never `/sign-up` (`connect/page.tsx`), so the first thing a new user sees is a login form, and the only route to registration is a small line under the card.
- Ten-minute clock: sign-up plus email verification eats into the code lifetime (`expires_in` 600 s). If Tomás takes 11 minutes, `/connect` shows "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." and the terminal shows `The login code expired. Run `agent-drive login` again.` (see SETUP-012).
- `docs/quickstart.md` step 1 is "Sign up" before install, but `/llms.txt` has no sign-up step (only "The approval link asks the human to sign in: they must sign in first, then click Approve." in Troubleshooting). The two surfaces give different orders.
- If the account was created but Clerk drops `redirect_url`, he lands on `/console` showing "Give your first agent a home." and the CLI link is gone; he must reopen the printed link (still valid for the remaining minutes) or the page's "Enter the code your agent printed after running `agent-drive login`." entry form at `/connect`.

---

## SETUP-011: Sandbox agent with no global installs uses npx and `--no-browser`

**Type**: medium
**Topic**: Agent-first install and login (npx fallback)
**Persona**: A CI-style research agent in a Docker container (no GUI, `CI=1`, npm global dir read-only). Its owner, Mei Lin Chen, watches the log from her laptop.
**Goal**: Log in using npx and get Mei Lin to approve from her own browser.
**Preconditions**: Mei Lin has an account and is signed in on her laptop. Container has Node 24.
**Surface**: mixed
**Ideal path**: 5 — npx login, relay link and code, Mei Lin types verification code, Approve, agent continues.
**Alternate paths**: `agent-drive login --no-browser` explicitly (help text `login [--name AGENT] [--no-browser]`); install globally with `npm install -g @dennisonbertram/agent-drive` where allowed; or skip the browser entirely with `AGENT_DRIVE_API_KEY` or `login --api URL --token-stdin` using a key made in the console API keys tab (human-first path).

### Steps

1. Agent tries `npm install -g @dennisonbertram/agent-drive` → fails (EACCES). llms.txt anticipates this: "No global installs allowed (sandbox)? Run it with npx instead".
2. Agent runs `npx -y @dennisonbertram/agent-drive@latest login --name "research-bot"` → prints the four lines; no browser opens because `CI` is set and stdout is not a TTY.
3. Agent posts to Mei Lin: link `https://agentdrive.xyz/connect?code=NPGD-BHSX`, code, and `Verification code: 9c01 e4aa 17d3 6b82`.
4. Mei Lin opens the link on her laptop, checks the code, types the verification code, clicks `Approve agent` → "Access approved for research-bot".
5. Agent's npx process finishes: `Logged in as agent research-bot.` etc. The agent must keep using the `npx -y @dennisonbertram/agent-drive@latest` prefix "for every command below" (llms.txt), e.g. `npx -y @dennisonbertram/agent-drive@latest credentials export --stdout | <secret store>`.

### Variations

- Container destroyed after login: config at `~/.config/agent-drive/config.json` is lost; `docs/sandboxes.md` says use `AGENT_DRIVE_CREDENTIALS`. Next run begins the whole flow again unless the bundle was stored.
- The agent names itself with the default: no `--name`, so the page shows "Connect 3b1f9c2a7d4e agent?" (container hostname + " agent"), meaningless to Mei Lin; she can't tell which sandbox it is except via `Details` > `Machine`.
- Slow npx cold start: each `npx -y ...@latest` call re-resolves the latest version; no offline cache assumed.

### Edge Cases

- Node older than 24: package declares `engines.node >=24.0.0`; I found no explicit version check in `cli.ts`, so the failure shape is whatever npm or Node emits (not verified).
- `CI` set on a developer's laptop suppresses the browser silently; the printed link is the only cue.
- Self-hosted origin: llms.txt appends ` --api <origin>/api` to every command only when served from a non-public origin. A user who copies the commands from `docs/quickstart.md` on the public site gets the default API.

---

## SETUP-012: The login code expires, and the user runs login again

**Type**: medium
**Topic**: Agent-first install and login (expired code and polling)
**Persona**: Jonas Weber, an iOS developer, runs `agent-drive login` and then goes to a meeting for 15 minutes.
**Goal**: Recover from an expired pairing request.
**Preconditions**: CLI installed, Jonas has an account.
**Surface**: mixed
**Ideal path**: 3 — see the expiry message, rerun `agent-drive login`, approve the new link.
**Alternate paths**: Re-enter the new code manually at `/connect` ("Code from your agent", `Continue`) instead of using the link; ask the agent to rerun login.

### Steps

1. `agent-drive login` → prints link `.../connect?code=FWXT-GDCN`, code, `Verification code: 5e21 90ab c7d3 48f6`, `Waiting for approval...`. Browser opens.
2. Jonas leaves the tab unapproved for 15 minutes. CLI polls `/api/oauth/token` every 5 s (`authorization_pending`).
3. At 10 minutes the CLI stops: `The login code expired. Run `agent-drive login` again.` (also triggered by `expired_token` from the server). Exit code non-zero.
4. Jonas returns, clicks `Approve agent` in the old tab (verification code typed) → inline error "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." Alternatively, the review page loads at all? On a fresh load of the old link the card shows tag "No pairing" and "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code."
5. He runs `agent-drive login` again → new code `BJRK-VTLM` and new verification code; the old code does not carry over; `known_drive_ids` from any saved keys is sent so reconnects reuse his drive.
6. He opens the new link and approves → success lines.

### Variations

- Jonas types the new verification code against the old code page: "This code does not match the one your agent printed. Check the terminal again and type it exactly."
- Laptop sleeps mid-poll: on wake, fetch failures count; five in a row abort with `Lost contact with Agent Drive at https://agentdrive.xyz/api. Run `agent-drive login` again.`
- Rate limit: starting more than 20 logins per IP per hour returns 429 `slow_down` (`docs/agent-login.md` and `api-device-login.md:54`); the CLI shows `Agent Drive refused the login request: ...` with the server description; the word `slow_down` in a start response is not the polling meaning.

### Edge Cases

- Neither the CLI nor `/connect` shows a time limit before it happens; the "10 minutes" appears in docs only (`docs/agent-login.md`). The page refetches on window focus at most 10 times and stops at expiry (`connect.tsx:285-341`), so a stale card can look valid until Approve.
- A `/connect` page left open does not poll; a second `login` leaves two pending rows, both valid until expiry (approve the right one by checking the code).

---

## SETUP-013: Typing the verification code wrong, and the approve that never shows a Deny

**Type**: short
**Topic**: Agent-first install and login (approval page, verification code)
**Persona**: Aisha Okonkwo, cautious, security-minded; she distrusts a link an agent printed.
**Goal**: Confirm the request is hers and approve it, or refuse it.
**Preconditions**: Signed in; a pending `/connect?code=` from her own `login`.
**Surface**: mixed
**Ideal path**: 3 — read the card, type verification code, `Approve agent`.
**Alternate paths**: To refuse: close the page and let it expire (no `Deny` button on `/connect`, although `POST /api/console/device/:code/deny` exists and the CLI handles `access_denied`).

### Steps

1. Aisha opens `/connect?code=HQRM-ZVWD` → "Connect nightly-sync?" with `Details` closed.
2. She opens `Details` → rows Machine, Account, Drive, Access, Writes, Requested (and "Offered by" only for `grant` offers).
3. She types the verification code with a typo `a1b2 c3d4 e5f6 7891` → error "This code does not match the one your agent printed. Check the terminal again and type it exactly."
4. She retypes (spacing is flexible per `normalizeVerificationCode`; not verified in detail) → success page "Access approved for nightly-sync".

### Variations

- She sees an unexpected `Machine` name and wants to deny: page says "If it does not, close this page; the request expires on its own." and the note "You can revoke access any time in Console, Agents." is shown near the button.

### Edge Cases

- "Does this code match your terminal?" shows the 8-letter code, but the real protection is the 16-hex verification code; the page's wording makes the first sound like the check.
- The `Account` fact is only inside `Details`; a user with two Clerk accounts could approve under the wrong one without seeing the email unless Details is opened.

---

## SETUP-014: Reading llms.txt directly in a browser and trying the old tarball

**Type**: short
**Topic**: Agent-first install and login (the llms.txt document)
**Persona**: Devon Park, an indie developer, follows a link to `https://agentdrive.xyz/llms.txt` from a blog post to see what his agent will be told.
**Goal**: Understand what the agent does before pasting.
**Preconditions**: None.
**Surface**: web (browser)
**Ideal path**: 2 — open `/llms.txt`, scroll to "## Set up (local agent with a shell)".
**Alternate paths**: `/llms-full.txt` (index plus full docs); `/docs/quickstart` human page; console Agents tab link "Read what your agent will see (llms.txt)"; Markdown twins like `/pricing.md`.

### Steps

1. Visit `/llms.txt` → plain text, starting "# Agent Drive", "> Encrypted file storage for agents..." then Docs and Pages lists ending with "[Everything in one file](.../llms-full.txt)".
2. Scrolls; steps 1 to 6 are numbered. Step 4 offers three backup options; step 6 says "Setup is complete only when it prints `check ok`."
3. Notes sections "Sandboxes", "Adding another agent to your drive", "Hosted assistants" ("not supported").

### Variations

- A user on the header looks for an `llms.txt` link: not there; only reachable via the hero prompt text, console panels, docs, or typing the URL.
- Devon searches an old blog for `curl .../cli/agent-drive.tgz`: `docs/agent-login.md:24` still says "The site still serves `/cli/agent-drive.tgz` for older instructions", but it is a build artifact (gitignored), not an advertised route; all current surfaces say npm.

### Edge Cases

- llms.txt tells the human to "type the verification code into the page — it never shows it", while `docs/quickstart.md:35` tells them only to "check that the code matches", so the same instruction differs by surface.
- A hosted chat assistant (no shell) pasted the line: llms.txt says "Chat assistants ... are not supported ... Tell the human this."

---

## SETUP-015: Human-first alternative: console API key and `login --token-stdin`

**Type**: medium
**Topic**: Agent-first install and login (alternate to device flow)
**Persona**: Rafael Souza, ops engineer who dislikes browser pairing and wants to wire a long-lived server agent by pasting a key.
**Goal**: Log the CLI in without the device flow.
**Preconditions**: Signed up, console open at `/console`, CLI installed.
**Surface**: mixed
**Ideal path**: 7 — console onboarding "Prefer to set up a drive yourself?" → `New drive`, recovery file, Agents `Create your first agent`, API keys `+ New API key`, copy secret, terminal pipe.
**Alternate paths**: Device flow (SETUP-009); `AGENT_DRIVE_API_KEY` env var, which makes `login` save that key instead of starting browser approval.

### Steps

1. In `/console` onboarding click `New drive` → dialog "We’ll generate a unique encryption key in your browser. Save it somewhere safe: the server cannot recover it." Type `Drive name` `ops-archive`, click `Create drive`.
2. Receipt dialog → `Download recovery file and continue`, then `I saved it`.
3. Agents tab → `Create your first agent`.
4. API keys tab → `+ New API key`; secret shown once; tick "I saved my API key securely".
5. In terminal: `printf '%s' "<your API key>" | agent-drive login --api https://agentdrive.xyz/api --token-stdin` → prints whoami JSON (no "Logged in as agent" lines); config saved.
6. The drive key is not in the CLI config; `agent-drive check` refuses with `drive key not backed up` or no key; Rafael must run `agent-drive credentials import --from <recovery file>`.

### Variations

- He forgets `--api`: default API is used (same value for public site).
- He pipes the key without `--token-stdin`: `login` starts the device flow instead (the stdin is ignored), which is surprising.

### Edge Cases

- `--token-stdin` outside `login`: "--token-stdin is only supported by `login`."
- The success output differs from device login: no "Usable drives" line.

---

## Notes for walkers

- Contradictions to record: (a) `home.ts:8` and `console.tsx:316` omit the verification code that `connect.tsx` requires; (b) quickstart.md step 1 "Sign up" vs llms.txt which has no sign-up step and `/connect` which sends signed-out users to sign-in; (c) docs/agent-login.md:24 `/cli/agent-drive.tgz` claim vs npm everywhere else; (d) `account-seal.ts:31` says set a passphrase "under Settings" while `settings-client.tsx:103` says setup happens in Files (outside this topic, seen when login ends).
- Not verified at runtime: Clerk's exact wording for an unknown email, whether `redirect_url` survives email verification, Node-version failure text.

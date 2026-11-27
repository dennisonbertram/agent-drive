# Setup topic: Approve on /connect

> ID note: stories in this file now use catalog IDs SETUP-016 to SETUP-025 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-016, 02 = SETUP-017, 03 = SETUP-018, 04 = SETUP-019, 05 = SETUP-020, 06 = SETUP-021, 07 = SETUP-022, 08 = SETUP-023, 09 = SETUP-024, 10 = SETUP-025.


Source: code read in `/Users/dennison/develop/agent-drive-ux-setup` (`apps/web/app/(app)/connect/connect.tsx`, `page.tsx`, `apps/web/src/api/device.ts`, `packages/agent-drive/src/device.ts`, `verification.ts`, docs, `llms.txt` route). Nothing was run. Line numbers refer to `connect.tsx` unless noted.

Facts used by several stories:
- Code format: the page accepts only the letters `BCDFGHJKLMNPQRSTVWXZ` in the pattern `XXXX-XXXX` (line 40). The input auto-uppercases and inserts the hyphen (`formatCode`, line 73), so typing a vowel or Y is accepted into the box but fails on `Continue` with "Enter the code in the form XXXX-XXXX." (line 199).
- Verification code: four hex groups, `a1b2 c3d4 e5f6 7890`, case, spaces, dots and hyphens are optional (`verification.ts`). Any other character (for example the letter `g`, or a trailing quote) gives "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." The same fact is on the CLI (`Verification code: ...`, `device.ts:159`), `/llms.txt` (route.ts:32-34), and `docs/connect-an-agent.md:7`.
- The "reconnect" path is implicit. If the agent name was used before, the page lists the prior drive in the summary and Details and says "It reconnects to the drive it used before and keeps its previous permissions." There is no "reconnect" label or button.
- "Use one of my drives instead (needs its recovery file)" appears only when the request creates a drive, has no previous scopes, has no offer, and the account has at least one drive (line ~675).

---

## SETUP-016: First approval, everything matches (happy path)
**Type**: short
**Topic**: Approve on /connect
**Persona**: Priya Raman, indie developer, just signed up, has Claude Code running in a terminal and a browser already signed in to agentdrive.xyz.
**Goal**: Approve her agent and get a new encrypted drive.
**Preconditions**: Signed in. No drives. `agent-drive login --name "priya-claude"` has printed its output and the browser opened because stdout is a terminal.
**Surface**: mixed (CLI + web)
**Ideal path**: 4 — read the verification code, type it, click Approve, return to the terminal.
**Alternate paths**: Open the link by hand with `--no-browser`; open `/connect` with no code and type the code (see 02); `agent-drive grant` is only for a second agent.
### Steps
1. In the terminal Priya reads `Open this link to approve: https://agentdrive.xyz/connect?code=BCDF-GHJK`, `Check that the code matches: BCDF-GHJK`, `Verification code: a1b2 c3d4 e5f6 7890`, `Waiting for approval...` → the browser tab is already at `/connect?code=BCDF-GHJK`.
2. The page shows the tag "Pairing request", h1 "Connect priya-claude?", and the line "New encrypted drive · full access". Below it: "This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it." → she compares the big code under "Does this code match your terminal?" with the terminal. They match.
3. She clicks into the field `Verification code` (placeholder `a1b2 c3d4 e5f6 7890`, hint "Type the code from your agent’s terminal. This page never shows it.") and types `a1b2 c3d4 e5f6 7890`.
4. She clicks `Approve agent` → the button reads `Working…`, then the card changes to tag "Approval saved", h1 "Access approved for priya-claude", "You approved priya-claude to read, write, delete and share its new drive. Return to your agent to finish setup and confirm it is ready." and a button `Open console`.
5. She returns to the terminal → within about 5 seconds the CLI prints `Logged in as agent priya-claude.` and `New drive <id> created; its key is saved in the config file.` followed by the backup hint.
### Variations
- She clicks `Open console` before looking at the terminal. Console shows a drive, a passphrase banner and a "Not backed up" chip; the agent has not yet been told to back up.
- She types the code in capitals or without spaces (`A1B2C3D4E5F67890`). It is accepted.
### Edge Cases
- Nothing on the page says how long the code lives (10 minutes) or that the CLI polls every 5 seconds, so a user who sees no instant change may think approval failed.
- The same pairing code appears in three places (CLI line 2, URL, big code on the page). The verification code appears only in the CLI and must be typed by hand, even though the browser was opened by the CLI itself.

---

## SETUP-017: Code entered by hand on a bare /connect (agent on another machine)
**Type**: short
**Topic**: Approve on /connect
**Persona**: Tomás Herrera, runs Codex over SSH on a cloud VM; his laptop browser is where he is signed in.
**Goal**: Approve an agent whose terminal he cannot open a browser from.
**Preconditions**: Signed in on laptop. On the VM `agent-drive login --name "tomas-codex" --no-browser` printed the link and codes.
**Surface**: mixed
**Ideal path**: 5 — go to `/connect`, type the code, `Continue`, type verification code, `Approve agent`.
**Alternate paths**: Copy the whole link `.../connect?code=XXXX-XXXX` from the SSH session into the laptop browser (3 steps, skips code typing). Visit `/connect` from nowhere in the UI: there is no link to `/connect` in the site header or console nav (console reaches it only through the text instructions), so a user must know the URL.
### Steps
1. On the VM Tomás reads `Check that the code matches: QTWN-ZLRK` and `Verification code: 09fe 4a21 77bc d3e0`.
2. On the laptop he opens `https://agentdrive.xyz/connect` → card tag "Awaiting code", h1 "Connect an agent", "Enter the code your agent printed after running `agent-drive login`." and the field "Code from your agent" (placeholder `XXXX-XXXX`).
3. He types `qtwnzlrk` → the field shows `QTWN-ZLRK`.
4. He clicks `Continue` (`Looking up…`) → the page moves to "Pairing request" and "Connect tomas-codex?".
5. He types the verification code and clicks `Approve agent` → "Access approved for tomas-codex".
### Variations
- He pastes `QTWN-ZLRK` with spaces or lowercase: formatting normalizes it.
- He makes a typo, `QTWN-ZLRL` (valid letters): "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." and the tag becomes "No pairing". The message does not say which of the three it is.
### Edge Cases
- If he reads the code aloud wrong and types `QTWN-AEIO` (vowels), the box accepts the text but `Continue` says "Enter the code in the form XXXX-XXXX." This is misleading: the form is right, the letters are not allowed. The page never says which letters are used.
- Pressing `Continue` with an empty box: "Enter the code your agent printed."
- If he is signed out, `/connect` (no code) redirects to `/sign-in?redirect_url=%2Fconnect`.

---

## SETUP-018: Brand-new user arrives from the CLI link and is signed out
**Type**: long
**Topic**: Approve on /connect
**Persona**: Mei Lin Chen, product designer, asked her agent to "Set up Agent Drive: https://agentdrive.xyz/llms.txt". She has no account.
**Goal**: Create an account and approve her agent before the code expires.
**Preconditions**: Agent ran `agent-drive login --name "mei-cursor"`; the browser opened on `https://agentdrive.xyz/connect?code=KWPD-RSTV`. Mei is signed out. Code lifetime is 10 minutes.
**Surface**: mixed
**Ideal path**: 7 — sign up, return to /connect, type verification code, approve.
**Alternate paths**: Go to `/sign-up` first from the landing page and then open the link; sign in with an existing account; if the code expires, the agent reruns `agent-drive login` and she starts again with a new link.
### Steps
1. The agent tells her: "Open this link (you must be signed in to Agent Drive), check that the code matches..." (the `/llms.txt` wording). She opens the link → redirect to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DKWPD-RSTV` (`page.tsx` redirect).
2. She sees the Clerk sign-in form and no account. She looks for the link to the other form (`AuthLinks`) and clicks it → sign-up form.
3. She finishes sign-up (email code, etc.) → Clerk returns her to `/connect?code=KWPD-RSTV` because `redirect_url` is preserved (unverified for the sign-up to sign-in switch: the redirect parameter may be lost when she changes forms; this was not run).
4. The page loads "Connect mei-cursor?" with "New encrypted drive · full access".
5. She does not know what to do with "Verification code". She goes back to the agent chat or terminal, scrolls up and finds `Verification code: 5d70 aa13 90e2 b4c8`.
6. She types it and clicks `Approve agent` → "Access approved for mei-cursor".
7. She returns to the agent, which finishes and now asks her to choose a backup option.
### Variations
- Spent 10 minutes on sign-up: step 4 shows "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code." with tag "No pairing" (the page was loaded with the code but the lookup returned 404). She must ask the agent to rerun login, and gets a new code AND a new verification code; the old verification code no longer works.
- Her agent's terminal is not visible to her (a chat UI that summarizes tool output): she cannot find the verification code and must ask the agent to repeat the exact line.
### Edge Cases
- `docs/quickstart.md:35` and `home.ts:8` ("Your agent shows a pairing code, and you approve it in your account.") do not mention a verification code at all, so a user who read only those has no warning.
- `console.tsx:316` says "open it and click Approve" (no typing). The page then blocks Approve until a code is typed.
- A user who opens `/console` directly instead of the link would be redirected to `/sign-in` with no return page (discovery item 10).

---

## SETUP-019: Wrong and malformed verification codes
**Type**: medium
**Topic**: Approve on /connect
**Persona**: Jamal Okafor, backend engineer, in a hurry, reading the code off a tiled tmux pane where the font makes `0` and `o` look similar.
**Goal**: Get past the verification gate without approving the wrong thing.
**Preconditions**: Signed in; pending request for `jamal-pi` at `/connect?code=HBGN-CXZM`; terminal shows `Verification code: 7c0e b91d 2f48 a0d6`.
**Surface**: mixed
**Ideal path**: 3 — type the code correctly and click `Approve agent`.
**Alternate paths**: None to bypass; the page requires the code on every approval shape, and the server checks it again (`docs/connect-an-agent.md:7`).
### Steps
1. He clicks `Approve agent` with the `Verification code` field empty → the field gets focus and shows "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890." No request is sent.
2. He types `7coe b91d 2f48 a0d6` (letter `o` instead of zero) → he clicks `Approve agent`. Because `o` is not a hex digit, the same "Enter the verification code your agent printed..." error shows. The message does not say the character is invalid.
3. He types `7c0e b91d 2f48 a0d7` (last digit wrong) → `Approve agent` shows `Working…` briefly, then "This code does not match the one your agent printed. Check the terminal again and type it exactly." The check runs in the browser against the request's public key, before the approve call.
4. He retypes `7c0e b91d 2f48 a0d6` → "Access approved for jamal-pi".
### Variations
- Pasting the code with the `Verification code:` label included: the label contains letters outside `a-f` (`V`, `r`, `i`, ...), so it is rejected with the "four groups" message.
- Pasting with dots or hyphens (`7c0e-b91d-2f48-a0d6`) works.
### Edge Cases
- The mismatch message says "Check the terminal again" and never mentions the other cause: the service returning a different key. A user who typed correctly and still sees the mismatch is told only to retype.
- Another process printed a similar line to the same terminal: the `device.unit.test.ts` cases show the CLI sanitizes embedded newlines, so a forged second `Verification code:` line should not appear (verified in tests only).
- Each failed local check does not call the server, so it does not consume the "30 per 10 minute" console budget (the check is before `api(... /approve)`; by code reading).

---

## SETUP-020: The code does not match the terminal, and there is no Deny button
**Type**: short
**Topic**: Approve on /connect
**Persona**: Dana Whitfield, security-minded engineering manager. A colleague sent her a link "to approve my agent", and the code on the page differs from what the colleague's terminal screenshot shows.
**Goal**: Refuse a request she does not trust.
**Preconditions**: Signed in; request for `dev-box-3` is pending.
**Surface**: web
**Ideal path**: 1 — close the page (only option on the page).
**Alternate paths**: None in the UI. The API has `POST /api/console/device/:code/deny` (`device.ts:924`) and the CLI handles `access_denied` ("Approval was denied. No access was granted."), but no control calls it.
### Steps
1. She opens the link → "Connect dev-box-3?" with a big code under "Does this code match your terminal?" that she compares with the screenshot. It differs.
2. She looks for a refuse control. The only buttons are `Approve agent`, the `Details` toggle and the delegate checkbox. The page says "If it does not, close this page; the request expires on its own." (line 836) → she closes the tab.
### Variations
- She opens `Details` to see Machine, Account, Drive, Access, Writes and Requested first. Machine shows the hostname the agent reported (not verified).
- The request stays pending for up to 10 minutes. If the colleague's real agent was a different request, nothing is lost.
### Edge Cases
- The text "You can revoke access any time in Console, Agents." (line 874) is the only safety net after a wrong Approve, but the console has no mention of which approval came from `/connect`.
- Someone else's valid code could be approved by anyone signed in who also types the right verification code; without the verification code the approve fails. Dana's refusal is safe only because the verification code is not on the page.

---

## SETUP-021: Reconnect an agent that was approved before
**Type**: medium
**Topic**: Approve on /connect
**Persona**: Luis Navarro, runs `agent-drive login --name "luis-claude"` again after reinstalling his laptop OS and losing `~/.config/agent-drive/config.json`; the credential backup was never done.
**Goal**: Get his agent working again against its old drive.
**Preconditions**: Account has agent `luis-claude` with an earlier approval and one drive, `luis-claude`. New login uses the same agent name.
**Surface**: mixed
**Ideal path**: 3 — type verification code, `Approve agent`, then restore the key from backup.
**Alternate paths**: `agent-drive credentials import` from a backup (no browser); `Use one of my drives instead` is not offered here because the request already has previous scopes (the link requires `!request.scopes`); a different agent name would create a new drive (see 01).
### Steps
1. CLI prints the link and codes → `/connect?code=...` opens.
2. The page shows h1 "Connect luis-claude?" and the summary line with the old drive name and its access, for example "luis-claude · full access". The text below reads "It reconnects to the drive it used before and keeps its previous permissions." Details lists Drive with the old drive name.
3. He types the verification code and clicks `Approve agent` → "You approved luis-claude to read, write, delete and share luis-claude. Return to your agent to finish setup and confirm it is ready." (the done sentence reads awkwardly when agent and drive share a name).
4. CLI: `Logged in as agent luis-claude.` and `The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.` The key for the old drive is not on this machine, so the CLI cannot read old files. The CLI line "Login finished but this agent has no usable drive key..." or "No usable key for: <ids>. You can list names but not read contents." applies.
### Variations
- Previous permissions were read-only: summary says "read only", Writes "No writes" and the user cannot change that here.
- Previous approval had `delegate`: the checkbox is NOT pre-ticked (server drops `delegate` on reconnect, `device.ts:679`), so he must tick it again; the page does not say so.
### Edge Cases
- The word "reconnect" never appears as a choice. A user who wanted a fresh drive has no option on this screen (the "Use a new drive instead" button only appears after choosing the existing-drive mode, which is hidden here). To get a new drive he must rerun login with a different `--name`.
- The page says "keeps its previous permissions" but does not say the old drive's key is not recovered by the approval; this is only learned from the CLI.

---

## SETUP-022: Use one of my drives instead (recovery file handoff)
**Type**: long
**Topic**: Approve on /connect
**Persona**: Amara Nwosu, runs Agent Drive for a small research team. Her old sandbox vanished, she kept `agent-drive-<id>.key.json` from the console. She starts a new agent `amara-codex`.
**Goal**: Give the new agent the existing drive with read-only access limited to the folder `/papers`.
**Preconditions**: Account has drive `research` and its recovery file on disk. `agent-drive login --name "amara-codex"` pending, new name so no previous scopes.
**Surface**: mixed
**Ideal path**: 9 — open Details, switch mode, choose drive, choose file, tick Read only, fill folder, type verification code, approve.
**Alternate paths**: Paste the key into `Drive key` instead of choosing a file; paste an `adcred1.` bundle (accepted); `agent-drive grant` from another agent that already holds the key; `credentials issue` for a sandbox; approve the default new drive instead.
### Steps
1. `/connect?code=...` shows "Connect amara-codex?" and "New encrypted drive · full access". She expands `Details` and clicks `Use one of my drives instead (needs its recovery file)` → Details closes (the page removes the `open` attribute) and the form shows `Drive` (select), `Drive key` (password input, placeholder "Paste the drive key or an adcred1… bundle"), `Or choose a file`, `Read only`, `Only allow writes under (optional)` (placeholder `/inbox/x`), and `Use a new drive instead`. Summary line becomes "Existing drive · choose below".
2. She picks `research` in the `Drive` select (the first drive is preselected; up to 100 drives load, then `Load more drives`).
3. She clicks `Or choose a file` and selects the recovery file. The hint reads "The key is checked against the drive before it is sent. A drive with no files or trace inbox has nothing to check it against."
4. She ticks `Read only` and types `/papers` in `Only allow writes under (optional)`. (Read only plus a write folder is allowed in the form; read only wins, scopes become `read`.)
5. She types the verification code and clicks `Approve agent` → the browser checks the key against the drive, seals it to the agent's public key, and posts only the sealed blob.
6. Done card: "You approved amara-codex to read the drive research." with `Open console`.
### Variations
- Choosing a file AND pasting text: the file wins (`keyFile ? keyFile.text() : pasted`).
- A file over 16 KB: "This is not a valid drive key file."
- Drive has no files and no trace inbox: approval works, and the done card adds "This drive has nothing to check the key against, so it could not be checked before sending."
- She clicks `Use a new drive instead` mid-way: key, file and field error are cleared, the form returns to the new-drive summary.
### Edge Cases
- Wrong drive's key: "This key does not open the selected drive. Check the drive and paste its own key."
- Garbage text: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle."
- Key field empty and no file: "Paste the drive key or choose a recovery file." appears as a key error.
- Drive deleted in another tab: "This drive is no longer available. Reload the page and pick it again."
- Network drop during the check: "The key could not be checked against the drive. Try again." (a form-level banner, not a field error).
- Folder `papers/` or `papers`: "Enter a folder that starts with / and does not end with /, for example /inbox/agent." The error comes back from the server after the key was sealed, not before.
- The link text says "needs its recovery file" but the form also takes a pasted key or bundle (discovery item 9). The folder limit applies only to this mode; in the default mode "Writes" shows "Anywhere in the drive" with no way to restrict it.
- The link is hidden if the account has no drives, so a user with a recovery file but a new account will not see it.
- The sentence "You can revoke access any time in Console, Agents." stays the same.

---

## SETUP-023: Delegate checkbox for an orchestrator agent
**Type**: medium
**Topic**: Approve on /connect
**Persona**: Ravi Subramanian, runs a coordinator agent `ravi-lead` that will spin up worker sandboxes and give each its own scoped access.
**Goal**: Approve `ravi-lead` so it can add other agents, then add one worker.
**Preconditions**: Signed in; request for `ravi-lead` pending.
**Surface**: mixed
**Ideal path**: 6 — expand Details, tick delegate, verify code, approve, then `grant` from the CLI and approve the worker.
**Alternate paths**: `agent-drive credentials issue --name worker-1 --to PATH` (no browser approval per worker, needs `delegate`); approve without delegate and add workers by hand with the console `+ New API key`.
### Steps
1. The page shows "Connect ravi-lead?" and "New encrypted drive · full access". He does not see the delegate option: it is inside the collapsed `Details`.
2. He clicks `Details` and sees the checkbox "Let this agent add other agents to its drives" with the small text "It can hand another agent the key and permissions it holds itself, never more, and it cannot pass this permission on. You still approve each new agent here."
3. He ticks it → the summary line changes to "New encrypted drive · full access · can add other agents".
4. He types the verification code and clicks `Approve agent`; the done card names no delegate status ("You approved ravi-lead to read, write, delete and share its new drive.").
5. Later `ravi-lead` runs `agent-drive grant QMPT-WZVK --verify "..."` for the worker. Ravi opens that worker's `/connect` link → Details now shows "Offered by ravi-lead"; the summary says "<drive> · full access · offered by ravi-lead"; the explanation reads "ravi-lead sealed the drive key for this login; Agent Drive never sees it."
### Variations
- He forgets the checkbox: `grant` from `ravi-lead` fails with "The API key needs the delegate scope." (`device.ts:795`). He must reconnect, which needs a second approval; see 06 (delegate is not pre-ticked).
- The worker's request also shows the delegate checkbox, unticked by default; delegate is never inherited from the offer (`device.ts:664`).
- A worker approved with `delegate` ticked can add more agents; the page text says the granting agent "cannot pass this permission on", which contradicts allowing the checkbox on an offered request unless the human ticks it again.
### Edge Cases
- The checkbox is shown on every request, including a read-only offer. Ticking it on an offer with `read` only still produces a delegate that can only pass on `read`.
- Delegate is only mentioned inside a collapsed `<details>`, so many users never see it; `/llms.txt` says "Other options on the page are optional; the defaults are right."
- The summary line reflects delegate but the final "Approval saved" card does not.
- While the page is open, the agent's `grant` can arrive. The page re-fetches on window focus (at most 10 times, stopped at expiry or on any error) and shows "ravi-lead offered a drive for this login. Review it before you approve." Without refocusing, he approves the older view and gets: "The request changed; review it again." after an automatic reload.

---

## SETUP-024: Code expired, already used, or rate limited
**Type**: medium
**Topic**: Approve on /connect
**Persona**: Hana Sato, left the browser tab open over lunch, then clicks Approve. She also double-clicked once.
**Goal**: Recover from an expired approval and a second attempt.
**Preconditions**: Request was created 14 minutes ago (lifetime 10 minutes); the CLI has already printed `The login code expired. Run `agent-drive login` again.`
**Surface**: mixed
**Ideal path**: 4 — rerun login, open new link, type new verification code, approve.
**Alternate paths**: Rerun with `--no-browser` and paste the URL; enter the new code at bare `/connect` (see 02).
### Steps
1. She returns to the tab still showing "Connect hana-cursor?" and types the verification code. She clicks `Approve agent` → browser check passes locally.
2. The server answers 404 → banner "This request expired or was already used. Run `agent-drive login` in your agent to get a new code." The backticks are plain text in this string (line 517), unlike the "wrong, expired" message on the entry card, which renders `agent-drive login` as code.
3. In the terminal she runs `agent-drive login --name "hana-cursor"` again → new link, new code, new verification code (the old one is now useless).
4. She opens the new link and approves with the new verification code → success.
### Variations
- She refreshes the old URL before step 2: the page loads with tag "No pairing" and "This code is wrong, expired, or already used. Run `agent-drive login` in your agent to get a new code."
- She double-clicks `Approve agent`: the first click sets `busyRef`; the second is ignored, button reads `Working…`. Only one approval is posted.
- She opens the same link on her phone after approving on the laptop: the code is consumed, so "wrong, expired, or already used".
- Trying many codes: after too many attempts the API returns "Too many device code attempts. Wait 10 minutes and try again." (`device.ts:746`), shown as the form error or as the entry-card error. The budget (30 per 10 minutes, shared with the agent's `grant` calls) is not mentioned on the page.
### Edge Cases
- The page never shows a countdown or the expiry time; `expires_at` is fetched and used only to stop refetching.
- If her session expires while the page is open, any call returns 401, the page redirects to `/sign-in` (no `redirect_url`), and the typed verification code and any key text are lost. After sign-in she lands on `/console`, not `/connect`.
- The CLI side: `The login code expired. Run `agent-drive login` again.` is on the terminal; the page and CLI both name the same command but only the CLI knows the state.

---

## SETUP-025: Approving while signed in to the wrong account
**Type**: medium
**Topic**: Approve on /connect
**Persona**: Elena Petrova, has a personal account (`elena@gmail.example`) and a work account (`elena@labcorp.example`). Her browser is signed in to the personal one. The agent she is setting up belongs to work.
**Goal**: Approve the agent into the work account's drives.
**Preconditions**: Browser session is the personal account; work drives live in the other account.
**Surface**: web
**Ideal path**: 5 — notice the account, sign out, sign in as work, reopen the link, approve.
**Alternate paths**: Open the link in a private window and sign in there; skip the check and approve (agent gets a drive in the wrong account).
### Steps
1. She opens `/connect?code=...` → "Connect work-pi?" and the summary "New encrypted drive · full access". The signed-in email is shown only as `Account` inside the collapsed `Details`; nothing in the card header names the account.
2. She does not expand `Details`. She types the verification code and clicks `Approve agent` → "Access approved for work-pi". The drive is created under the personal account.
3. She later sees no drive in the work console and has to revoke the agent in the personal console under Agents, then rerun `agent-drive login`.
### Variations
- She expands `Details` first, sees `Account: elena@gmail.example`, and recognizes the problem: she clicks the Clerk `UserButton` in the header to sign out and returns to the link (the `redirect_url` path preserves the code).
- Her account has existing drives: `Use one of my drives instead` appears and shows the personal drives, which is a second hint she is in the wrong account.
### Edge Cases
- In test mode (no Clerk) the account shows "Local test session"; if Clerk has no primary email, "Signed-in account".
- The page gives no warning, and the server cannot know which account the person meant. The email address is the only evidence.
- The `Open console` button after approval goes to `/console` of the same (wrong) account.

---

## Story count

| Type | Stories |
|------|---------|
| short | 01, 02, 05 (3) |
| medium | 04, 06, 08, 09, 10 (5) |
| long | 03, 07 (2) |

## Contradictions and copy notes (with file:line)

1. `docs/quickstart.md:35` ("check that the code matches the one in the terminal, and click Approve"), `apps/web/src/content/home.ts:8` and `apps/web/app/(app)/console/console.tsx:316` omit the required verification code; `apps/web/app/llms.txt/route.ts:32-34`, `docs/connect-an-agent.md:7`, `packages/agent-drive/src/device.ts:159` and `connect.tsx:~845` include it.
2. `docs/agent-login.md:509-510` says "There is no public-key fingerprint" for the recovery-file handoff, while `docs/agent-login.md:131/155` and `connect.tsx` require `deviceVerification` on every approval shape.
3. `connect.tsx:517` shows literal backticks around `agent-drive login` in a plain string; `connect.tsx:583` renders it as code.
4. `connect.tsx:199` "Enter the code in the form XXXX-XXXX." is also shown for vowel/Y letters (pattern at line 40 allows only consonants), and the page never explains the alphabet.
5. `connect.tsx:685` "Use one of my drives instead (needs its recovery file)" under-describes the key inputs (also pasted key, `adcred1` bundle).
6. `connect.tsx:836` "close this page; the request expires on its own" versus a working deny API (`apps/web/src/api/device.ts:924`) and the CLI message "Approval was denied. No access was granted." (`packages/agent-drive/src/device.ts:193`).
7. `connect.tsx:696` delegate: the small text says "You still approve each new agent here." but the delegate checkbox appears on every request, including the ones an agent offers.

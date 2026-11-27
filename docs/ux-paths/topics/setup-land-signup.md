# Setup stories: Land, evaluate and sign up

> ID note: stories in this file now use catalog IDs SETUP-001 to SETUP-008 (see `docs/ux-paths/catalog-setup.md`). Short references such as "story 03" or "see 02" mean the Nth story of this file: 01 = SETUP-001, 02 = SETUP-002, 03 = SETUP-003, 04 = SETUP-004, 05 = SETUP-005, 06 = SETUP-006, 07 = SETUP-007, 08 = SETUP-008.


Topic: landing, pricing, Clerk sign-up, first `/console` with no drives (onboarding panel, loading and failure states).
Source: code read in `/Users/dennison/develop/agent-drive-ux-setup` (nothing was run). Temporary IDs; final numbering happens at merge.

Key code: `apps/web/app/(app)/page.tsx`, `apps/web/src/content/home.ts`, `apps/web/app/site-header.tsx`, `apps/web/app/(app)/pricing/page.tsx`, `apps/web/src/content/pricing.ts`, `apps/web/app/(app)/sign-up/[[...sign-up]]/page.tsx`, `apps/web/app/(app)/console/page.tsx`, `apps/web/app/(app)/console/console.tsx` (loading/failure ~2830, onboarding ~2850), `apps/web/app/llms.txt/route.ts`, `apps/web/app/(app)/connect/connect.tsx`, `packages/agent-drive/src/device.ts`.

## Cross-story notes (same fact on several surfaces; contradictions)

- The setup line `Set up Agent Drive: <origin>/llms.txt` appears in: landing hero `SetupPanel` ("Give this to your agent", button `Copy` with label "Copy agent instruction"), landing closing section ("Give your agent a drive."), console onboarding panel (button `Copy`), console "Connect an agent" dialog, `docs/quickstart.md`, `/index.md` twin, and `/llms.txt` itself ("Instruction a human gives you"). The landing uses the hardcoded `CANONICAL_ORIGIN` (`home.ts`); console uses a hook that falls back to `https://agentdrive.xyz` (`console.tsx` ~295).
- The terminal alternative `npm install -g @dennisonbertram/agent-drive` appears only on the landing hero ("or in a terminal:", `Copy command`) and in the `/index.md` twin. The console onboarding panel does not offer it.
- "Free to start": `home.ts:8` (hero), pricing card `Start with Free`, billing page "no card required" (`billing-client.tsx:353`), landing plan table `Sign up free`.
- CONTRADICTION A (approval steps): the landing (`home.ts:8`: "Your agent shows a pairing code, and you approve it in your account."), the onboarding panel (`console.tsx:2857-2858`: "open it and click Approve"; steps at 2874-2877 "The agent shows a pairing code." / "You approve it once."), and `docs/quickstart.md:35` all say the human only clicks Approve. The real flow also needs a typed "Verification code" (`device.ts:159`, `connect.tsx:838`, validation message at `connect.tsx:371`, and `llms.txt` step 2 which tells the agent to relay it). The button is labeled `Approve agent` (`connect.tsx:871`), not "Approve".
- CONTRADICTION B (sign-up vs sign-in): `docs/quickstart.md` step 1 says "Create your account at /sign-up", but the agent path via `/llms.txt` never mentions sign-up, and `/connect` redirects signed-out users to `/sign-in?redirect_url=...` (`connect/page.tsx:19`). The sign-in page only has the small line "New here? Sign up free" (`site-header.tsx` `AuthLinks`) plus whatever Clerk shows.
- CONTRADICTION C (return path): `/connect` keeps `redirect_url`; `/console` and `/console/billing` do plain `redirect('/sign-in')` (`console/page.tsx:11`, `billing/page.tsx:15`), dropping the return path. Clerk middleware (`proxy.ts:18`, `auth.protect()`) may add its own redirect first; not verified at runtime.
- CONTRADICTION D (paid plan labels): landing plan table shows `Choose plan` (links to `/pricing`, `page.tsx:405`) or "Coming soon"; `/pricing` shows `Choose Developer` / `Choose Team` (to `/console/billing`) or a disabled `Coming soon` button; the footer text under the disabled state reads "Paid checkout is not enabled on this deployment..." (`pricing.ts:16`), wording aimed at self-hosters, shown to every public visitor.
- Two names for one thing: the onboarding panel calls the page `CONNECT YOUR AGENT` / "Give your first agent a home."; the Files toolbar button for the same job later is `Connect an agent`; the landing calls it "Give your agent a drive."

---

## SETUP-001: Hand the setup line to Claude Code from the landing page
**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Priya, a solo developer who lost a Claude Code sandbox's notes yesterday, reading the landing page on her laptop.
**Goal**: Start setup by copying the line and pasting it into her agent.
**Preconditions**: Signed out, no account.
**Surface**: web (browser)
**Ideal path**: 3 — read the hero, click `Copy`, paste into the agent.
**Alternate paths**: Terminal: `Copy command` for `npm install -g @dennisonbertram/agent-drive` (hero, "or in a terminal:"); closing section "Give your agent a drive." has a second `Copy` ("Copy agent instruction again"); `/index.md` twin text; read `/llms.txt` directly; `docs/quickstart.md` (starts with "1. Sign up").
### Steps
1. Open `/` → hero "Agent files that outlive the sandbox." with lede "Agents get a cloud drive to save work that outlives a session or sandbox."
2. Read panel tag "Give this to your agent" with `> Set up Agent Drive: https://agentdrive.xyz/llms.txt`; click `Copy prompt` caption button (aria label "Copy agent instruction") → button feedback (copied state).
3. Read under it: "Free to start. Your agent shows a pairing code, and you approve it in your account." → Priya notes she has no account yet and wonders whether she must sign up first.
4. Paste into Claude Code → agent fetches `/llms.txt` (see Agent install topic).
### Variations
- She uses `Copy command` instead and runs the npm command herself, then does not know the next command (the landing never shows `agent-drive login`).
### Edge Cases
- Clipboard permission denied: `CopyButton` behavior in `copy-button.tsx` (check feedback text in walkers).
- The hero shows no "Sign up" requirement before the paste; the header CTA `Sign up free` is the only sign-up cue on screen.

## SETUP-002: Compare plans and pick Free from the pricing page
**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Marcus, a research engineer who needs to store multi-GB protein files and wants to know limits before signing up.
**Goal**: Find drive count, storage and download limits and start on Free.
**Preconditions**: Signed out. Deployment with paid checkout ON for one run, OFF for the variation.
**Surface**: web (browser)
**Ideal path**: 3 — header `Pricing`, read cards, `Start with Free`.
**Alternate paths**: Landing plan table ("Start free.") with the same facts and `Sign up free`; `/pricing.md`; header `Sign up free` directly.
### Steps
1. On `/`, click header link `Pricing` → `/pricing` heading "A home for every agent." eyebrow "START SMALL. KEEP YOUR KEYS."
2. Read three cards Free ($0), Developer ($20), Team ($200), each listing drives, storage, downloads, operations → he compares storage against his file sizes.
3. Read "How usage works" ("NO SURPRISES IN THE FINE PRINT") including the per-upload size limit → decides Free is enough to try.
4. Click `Start with Free` → `/sign-up`.
### Variations
- Paid checkout off: a status line "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans." and disabled `Coming soon` buttons. Marcus cannot tell if paid plans are ever coming for the hosted site.
- Paid on: he clicks `Choose Developer` while signed out → `/console/billing` → redirect to `/sign-in` with no return path (CONTRADICTION C). After signing up he lands on `/console`, not billing, and must find `Billing & limits`.
### Edge Cases
- Landing table says `Choose plan` (to `/pricing`), so a paid-plan click on the landing costs one extra page.
- Egress not metered (`S3_EGRESS_METERING=none`) changes the downloads row wording.

## SETUP-003: First sign-up with Clerk and arrival at an empty console
**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Aisha, a platform engineer at a 5-person startup, signing up with a work email.
**Goal**: Create an account and understand what to do on the first console screen.
**Preconditions**: Signed out, Clerk configured.
**Surface**: web (browser)
**Ideal path**: 5 — `Sign up free`, complete Clerk form, land on onboarding, `Copy`, paste into agent.
**Alternate paths**: `Start with Free` on `/pricing`; `Sign up free` in landing plan table or closing section or footer; `/sign-up` directly; from `/sign-in` the line "New here? Sign up free"; Clerk's own switch link on the sign-in form; social sign-in if the Clerk instance enables it (not defined in this repo).
### Steps
1. On `/`, click header `Sign up free` → `/sign-up` (header now marks this link current; page has "Already have an account? Sign in · Pricing · Docs" links).
2. Fill the Clerk `SignUp` form (fields and email verification are defined by the Clerk instance, not this repo) → verification step.
3. After success Clerk redirects to `fallbackRedirectUrl` `/console` → brief card "Opening your workspace…" with "Loading your drives and access settings." (account row is created on first authenticated load).
4. The Files tab shows the onboarding panel: eyebrow "CONNECT YOUR AGENT", h2 "Give your first agent a home.", text "Paste this line into your agent. It installs the CLI and gives you a link; open it and click Approve. The agent sets up its own encrypted drive.", code `Set up Agent Drive: https://agentdrive.xyz/llms.txt`, button `Copy`, numbered steps "Paste one line into your agent." / "The agent shows a pairing code." / "You approve it once.", and "Prefer to set up a drive yourself?" with `New drive`.
5. Aisha clicks `Copy`, switches to her terminal agent and pastes → agent starts setup.
6. She sees tabs Files, Agents, API keys, Usage, Trash and Files toolbar `Refresh`; the `Connect an agent` button is NOT shown yet (only when drives exist), so the panel is the only path.
### Variations
- She had arrived via `/sign-up?redirect_url=/connect?code=ABCD-EFGH` from a CLI link: Clerk should return her to `/connect`, so she never sees the onboarding panel on this visit.
- She uses Google/GitHub social sign-up if enabled.
### Edge Cases
- Email verification code expired or wrong: shown by Clerk, not by this repo.
- She expects a plan choice step; there is none (every account starts on Free).
- Panel says "click Approve" but the page she will later see needs a typed "Verification code" and a button `Approve agent` (CONTRADICTION A).

## SETUP-004: The "Set up a drive myself" detour from the empty console
**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Tomás, a cautious engineer who does not want an agent to create his drive before he has seen the console.
**Goal**: Create a drive by hand and keep the recovery file safe before involving any agent.
**Preconditions**: Just signed up, no drives, onboarding panel visible.
**Surface**: web (browser)
**Ideal path**: 5 — `New drive`, name it, `Create drive`, `Download recovery file and continue`, confirm.
**Alternate paths**: Drive-menu `New drive` appears only after a drive exists; Agent-first (stories 01/03) lets the agent create the drive; Agents tab "Create your first agent" is gated by "Create a drive first." text.
### Steps
1. In the onboarding panel, under "Prefer to set up a drive yourself?", click `New drive` → dialog with field `Drive name`.
2. Type "research-notes", click `Create drive` → a receipt step warning "The recovery file contains a secret in plaintext. Store it in a password manager or ..." with `Download recovery file and continue`.
3. Click it → browser downloads the file; the dialog asks "Did the recovery file save?" (confirm control exists; exact buttons to be checked by walkers).
4. Dialog closes → Files shows the new empty drive with "Ready for your first file." and "Connect an agent with the CLI or MCP to upload encrypted files."; toolbar now shows `Connect an agent`.
5. Tomás clicks `Connect an agent` → dialog with the same setup line, link "Read what your agent will see (llms.txt)", and MCP snippets for "Claude Code", "Codex (~/.codex/config.toml)", "Cursor or any MCP client".
### Variations
- Skips downloading the file (closes the dialog): a "Not backed up" chip and passphrase banner appear (other topic).
- The landing and onboarding text say "The agent sets up its own encrypted drive", so Tomás wonders whether the agent will create a second drive. The approval page offers "Use one of my drives instead (needs its recovery file)".
### Edge Cases
- Download blocked by the browser: dialog text "Use Download recovery file, then I saved it, to try again." (`console.tsx` ~2620 area).
- Free plan drive limit (see `/pricing` Free card) reached on a second `New drive`.

## SETUP-005: Console cannot load the workspace on first visit
**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Jun, signing up on hotel Wi-Fi that drops requests.
**Goal**: Get past a failed first load.
**Preconditions**: Signed in with a fresh account; the `/api/console/...` calls fail or return an unexpected response.
**Surface**: web (browser)
**Ideal path**: 2 — read the message, click `Try again`.
**Alternate paths**: Browser refresh (the card says "refresh to try again"); sign out and back in via `UserButton` ("Your account").
### Steps
1. Land on `/console` after sign-up → card "Opening your workspace…" / "Loading your drives and access settings."
2. The load fails → card changes to h2 "Workspace unavailable" with "Check the connection, then refresh to try again." and button `Try again`.
3. Click `Try again` (disabled while `busy`) → returns to the loading card, then the onboarding panel when the call succeeds.
### Variations
- Session expired mid-call: "Your session expired. Sign in again." then redirect to `/sign-in` (no return path).
- Unexpected response body: error text "Agent Drive returned an unexpected response. Try again." (`console.tsx:282`) is only used in some paths; the failure card itself shows the fixed text above, not the specific error (`setError(reason.message)` at line 1088 only toggles the failure state).
### Edge Cases
- No toast or detail tells Jun what failed (server vs network); the card text blames the connection in all cases.
- The failure card is the same whether it is the first visit or a returning owner's visit; the toolbar buttons (`Refresh`) are present but the content is hidden.
- Screen reader: the loading card has no announced status (check by walkers).

## SETUP-006: Agent-driven setup where the human has no account yet
**Type**: long
**Topic**: Land, evaluate and sign up
**Persona**: Elena, a game developer using Codex on a MacBook who has never opened agentdrive.xyz; she pastes the line from a friend's tweet without visiting the site.
**Goal**: Finish first setup from the CLI link, signing up in the middle.
**Preconditions**: No Agent Drive account, Node 24+, agent has a shell.
**Surface**: mixed (CLI + web)
**Ideal path**: 12 — agent install, login, open link, sign up, return to `/connect`, type verification code, `Approve agent`, agent finishes.
**Alternate paths**: Sign up first at `/sign-up`, then paste the line (stories 03 then 01); `agent-drive login --no-browser`; `npx -y @dennisonbertram/agent-drive@latest login --name "<your agent name>"` when global installs are blocked.
### Steps
1. Elena pastes "Set up Agent Drive: https://agentdrive.xyz/llms.txt" into Codex → agent fetches `/llms.txt`, runs `npm install -g @dennisonbertram/agent-drive`.
2. Agent runs `agent-drive login --name "Elena Codex"` → terminal prints "Open this link to approve: https://agentdrive.xyz/connect?code=ABCD-EFGH", "Check that the code matches: ABCD-EFGH", "Verification code: a1b2 c3d4 e5f6 7890", "Waiting for approval...". The CLI also opens the browser (`--no-browser` disables it).
3. Agent tells Elena to open the link, check the code, type the verification code, and click Approve (per `/llms.txt` step 2).
4. Browser opens `/connect?code=ABCD-EFGH` while signed out → redirect to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DABCD-EFGH`.
5. Elena sees a sign-in form; she has no account. She looks for a way to create one. The visible cue is "New here? Sign up free" under the card (and Clerk's own link) → clicks it; `authHref` keeps `redirect_url`.
6. She completes Clerk sign-up → returns to `/connect?code=ABCD-EFGH`.
7. Page tag "Pairing request", h1 "Connect Elena Codex?", summary (for example "New encrypted drive · full access"), `Details` collapsed; question "Does this code match your terminal?"
8. She types the verification code into the "Verification code" field → no mismatch error.
9. Clicks `Approve agent` → done page: tag "Approval saved", h1 "Access approved for Elena Codex", button `Open console`.
10. Back in the terminal, the CLI finishes login and prints drive info and a backup hint.
11. Agent runs the backup and check steps (`agent-drive credentials export --to ...`, `agent-drive check`; other topics).
12. Elena clicks `Open console` → `/console` shows the new drive (no onboarding panel, because a drive exists), with a passphrase banner and "Not backed up" chip until step 11 completes.
### Variations
- The code is expired (10-minute lifetime): the page shows an expired state; the agent re-runs `agent-drive login`.
- She skips typing the verification code: field error "Enter the verification code your agent printed, as four groups like a1b2 c3d4 e5f6 7890."
- She clicks the link in a browser already signed in to another Clerk account: the page shows "Account" in `Details`; she may approve into the wrong account.
### Edge Cases
- Elena never saw the landing or pricing page, so nothing told her plans exist; billing is reachable only via `Billing & limits` in the console.
- Clerk sign-up verification email arrives slowly; the 10-minute code expiry can lapse.
- `docs/quickstart.md` step 1 says sign up first; the agent path does not (CONTRADICTION B).

## SETUP-007: Evaluate before committing (docs, compare, FAQ, llms.txt)
**Type**: medium
**Topic**: Land, evaluate and sign up
**Persona**: Dana, a security-minded tech lead who must justify the tool to her CTO before anyone signs up.
**Goal**: Confirm encryption, key loss behavior, pricing and supported agents without creating an account.
**Preconditions**: Signed out.
**Surface**: web (browser)
**Ideal path**: 6 — landing sections, FAQ, `Docs`, `Pricing`.
**Alternate paths**: `/index.md`, `/pricing.md`, `/docs.md`, `/compare.md` Markdown twins (reachable by URL, Accept header or `types: text/markdown` alternate); `/llms.txt` as plain text; footer links (Contact mailto, GitHub icon, `/privacy`, `/terms`).
### Steps
1. On `/`, scroll the hero and "The problem" section ("Sandboxes end. Machines change. Platforms switch.").
2. Reach "Encrypted. Sharable. Works anywhere." → reads "We store only ciphertext and never see your drive keys."
3. In "Why not S3, git or Dropbox?" click a `/compare/<slug>` row, or `See …` link `/compare`.
4. Open the FAQ ("Questions, answered.") → "What happens if I lose the drive key?" answer: "Nobody can open the files, including us. Save the recovery file when you create a drive, or ask your agent to run `agent-drive credentials export --to <a safe path>`." She notes the file is saved at drive creation, but with the agent-first path the human never creates the drive.
5. Reads "Can a chat assistant in a vendor's cloud use it?" → "Not yet." Realizes her team uses ChatGPT, not a shell agent, and may stop here.
6. Clicks header `Docs` → docs index; finds quickstart, which says "1. Sign up" first.
### Variations
- Reads the "See every file your agents saved." console screenshot and wonders whether the console can read files (it decrypts in the browser).
- Reads "Which agents work with it?" "Claude Code, Codex, pi and opencode."
### Edge Cases
- The landing says "Free to start" but the Free allowances are only on the plan table; the hero does not link to them.
- Landing is `force-dynamic` and calls `billingRates()`/`checkoutConfigured()`; a failure there silently shows `Coming soon` instead of an error.

## SETUP-008: Visiting a deployment where sign-in is not configured
**Type**: short
**Topic**: Land, evaluate and sign up
**Persona**: Ravi, a developer self-hosting Agent Drive from the repo for the first time with no Clerk keys.
**Goal**: Understand why he cannot create an account.
**Preconditions**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` unset (or `AGENT_DRIVE_TEST_AUTH=1`).
**Surface**: web (browser)
**Ideal path**: 2 — click `Sign up free`, read the panel.
**Alternate paths**: `/sign-in` shows the equivalent panel; `AGENT_DRIVE_TEST_AUTH=1` with secret in development shows "Local test session" (dev only).
### Steps
1. Click header `Sign up free` → `/sign-up` with panel h1 "Create your account" and "Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
2. Click "Already have an account? Sign in" → `/sign-in` with h1 "Sign in" and "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
3. Visit `/console` → `consoleUserId()` has no user → redirect to `/sign-in`, the same panel.
### Variations
- Pricing page shows "Paid checkout is not enabled on this deployment..." in addition.
### Edge Cases
- The two panels say "human access" and "Clerk instance" with no link to self-host docs.
- Dead end: the page offers no next step beyond the header.

# Topic: Sign-up, sign-in and first console visit

Source: code at main 2870d7a. Sign-in/up are Clerk components (`apps/web/app/(app)/sign-in/[[...sign-in]]`, `sign-up/[[...sign-up]]`), themed by `appearance.ts`. Redirects are in `console/page.tsx` and `connect/page.tsx`. First-visit UI is `console/console.tsx`. Clerk's own screens (email code, password, reset) are not in this repo, so their wording is not recorded here.

## STORY-001: Visitor reads the landing page, then signs up through the pricing page
**Type**: medium
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Priya Nair, a developer who runs Claude Code on a laptop and saw a link to agentdrive.xyz in a thread.
**Goal**: Create an account to try the Free plan.
**Preconditions**: Signed out, Clerk configured, no account.
**Ideal path**: 2 — one visible "Sign up" action on the landing page, then one Clerk form that lands in the console.
**Alternate paths**: Landing "Console" link (redirects to `/sign-in`, then the Clerk form has its own sign-up link); pricing "Start with Free" (`/sign-up`); typing `/sign-up` directly; `/connect?code=` link from an agent (redirects to `/sign-in`).
### Steps
1. Open `/`. Nav shows Docs, Pricing, llms.txt, Sign in, Console. The hero shows "Give this to your agent" with `Set up Agent Drive: https://agentdrive.xyz/llms.txt` and a Copy button → no "Sign up" or "Get started" button exists anywhere in the nav or hero (gap).
2. Click "Sign in" hoping it also covers new users → Clerk `SignIn` form on `/sign-in`, with Clerk's own "Sign up" link.
3. Go back, click "Pricing" instead, scan the Free / Developer / Team cards → Free card has "Start with Free".
4. Click "Start with Free" → `/sign-up`, Clerk `SignUp` form with the orange primary color from `appearance.ts`.
5. Complete the Clerk form → redirected to `/console` (`signUpFallbackRedirectUrl`).
6. Console shows "Opening your workspace…" then the empty-account onboarding (see the first-visit story) → the account row is created on this first authenticated console load.
### Variations
- Priya clicks "Console" first: she is bounced to `/sign-in` and has to find the sign-up link in the Clerk card.
- She skips the sign-up and pastes the line into her agent; the agent prints a link that asks her to sign in first (see first-run-setup topic).
### Edge Cases
- The sign-up step happens before she has seen the console, so the only promise of what the product is before signing up comes from the landing page and pricing.
- The same "Sign in" and "Console" links appear twice on the landing page (top nav at line ~89 and footer at ~411), and "Sign in" and "Console" both lead to the same sign-in form when signed out.

## STORY-002: Returning owner signs in and lands in the console
**Type**: short
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Marcus Webb, an existing user returning after two weeks.
**Goal**: Open his files.
**Preconditions**: Account with one drive; signed out (cookie cleared).
**Ideal path**: 2 — click Sign in, authenticate, land in the console.
**Alternate paths**: Go straight to `/console` (server redirect to `/sign-in`); Clerk keeps a live session so `/console` opens directly.
### Steps
1. Open `/` and click "Sign in" → `/sign-in` with the Clerk `SignIn` card.
2. Enter credentials → redirect to `/console` (`fallbackRedirectUrl`).
3. Console shows "Opening your workspace…" ("Loading your drives and access settings.") → then the Files tab for his first drive.
4. Look for his files; the Download button is disabled with the tooltip "Load your drive key first" → he must paste a drive key again (covered in the download topic).
### Variations
- Bookmarked `/console` while signed out: redirect to `/sign-in` with no `redirect_url`, so he lands on `/console` afterwards, which is the same place anyway.
- Opens `/console/billing` or `/console/settings` signed out: those pages also require sign-in (same redirect).
### Edge Cases
- Deep links to a tab, drive or file do not exist; tab and drive are client state, so after signing in he always starts at Files for the first drive.
- He is signed in as a different Clerk account than the one that approved his agents: the console shows an empty onboarding and none of his agents (hesitation: "Where did my files go?"). The `/connect` page shows the email in "Account" to help him notice this.

## STORY-003: Brand-new account sees the first-visit onboarding
**Type**: medium
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Lena Fischer, just finished the Clerk sign-up, has not touched an agent yet.
**Goal**: Understand what to do next and get a first drive.
**Preconditions**: New account, zero drives, zero agents.
**Ideal path**: 3 — create a drive, save the key, continue (or skip the console entirely and paste the agent line).
**Alternate paths**: The "Connect an agent" panel on the Agents tab (copy the llms.txt line, no drive needed first); the sidebar "Connect an agent" button in the empty Files state; paste the line into an agent, which creates the drive during `/connect` approval.
### Steps
1. Land on `/console` → brief "Opening your workspace…", then the Files tab shows the onboarding card: eyebrow "A LITTLE SETUP. A LASTING WORKSPACE.", heading "Give your first agent a home.", button "Create your first drive ↗", and the steps "01 Create a drive / 02 Save your key / 03 Connect an agent".
2. Lena reads "Create a drive, save your encryption key, and connect an agent" and wonders whether she or the agent should create the drive; the agent line is not on this card (gap: the card does not mention the paste-one-line route that the landing page promised).
3. Click "Create your first drive ↗" → dialog with "Drive name" (max 128) and button "Create drive".
4. Type "Research notes" and click "Create drive" → drive-key receipt dialog (key generated in the browser).
5. Read the receipt; "Save recovery key" downloads `agent-drive-<id>.key.json`; the checkbox "I saved my drive key securely" unlocks "Continue to drive". The dialog cannot be closed until acknowledged.
6. Click "Continue to drive" → the drives strip shows "Research notes" with its size and file count; the Files tab shows "Ready for your first file." with the "Connect an agent" button.
7. Click "Connect an agent" → jumps to the API keys tab, which says "Create an agent first." (gap: the button label promises the agent setup panel but lands on the key-creation guard; the paste-one-line panel lives on the Agents tab).
8. Open the Agents tab → "Connect an agent" panel with the copyable line and "Read what your agent will see (llms.txt)".
### Variations
- Lena closes the browser before ticking "I saved my drive key securely": the drive exists, the key is gone from her browser, and the key-backup banner will stay red (see the key-lifecycle topic).
- Free plan reaches its 3-drive limit: "Create drive" fails with a plan-limit error.
### Edge Cases
- The same "connect an agent" information appears in three places with different destinations: onboarding card step 03 (text only), Files empty state button (goes to API keys), Agents tab panel (the real instructions).
- Drive creation here and device-login drive creation produce two different kinds of drive ("Research notes" with a browser-made key vs. one auto-made for an agent whose key is on the agent's machine); nothing on the onboarding card explains the difference.

## STORY-004: Visitor opens a sign-in page on an installation with no Clerk
**Type**: short
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Tomas Rivera, self-hosting Agent Drive for a weekend project without Clerk keys.
**Goal**: Sign in to the console.
**Preconditions**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` unset or placeholder, test auth off.
**Ideal path**: 1 — a clear message with the fix, since no human sign-in can exist.
**Alternate paths**: development test auth (`AGENT_DRIVE_TEST_AUTH=1`, `POST /api/test-session` from loopback with a bearer secret) gives a signed cookie.
### Steps
1. Open `/sign-in` → panel "Sign in": "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
2. Try `/sign-up` → panel "Create your workspace": "Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
3. Open `/console` → `consoleUserId()` returns null, so it redirects to `/sign-in` and shows the same panel (a redirect loop is avoided because the sign-in page does not redirect back).
4. Open `/connect?code=ABCD-EFGH` → redirected to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DABCD-EFGH` and the same panel; the agent's login can never be approved.
### Variations
- Dev with test auth: console shows the avatar letter "T" and "Local test session" instead of the Clerk `UserButton`; `/connect` shows "Local test session" as Account.
### Edge Cases
- No "Back to home" or doc link in the panel; the BrandMark is the only way out.
- Test auth requested but misconfigured (secret under 32 characters or not development): fails closed, `consoleUserId()` is null and the user sees the same "not configured" panel even though Clerk keys might exist (`clerkConfigured()` is false whenever test mode is requested).

## STORY-005: Session expires while the console is open
**Type**: medium
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Aisha Khan, leaves the console tab open overnight with a half-typed API key label.
**Goal**: Continue working the next morning.
**Preconditions**: Signed in earlier; Clerk session has lapsed.
**Ideal path**: 2 — sign in again and return to what she was doing.
**Alternate paths**: reload the page (server redirect to `/sign-in`).
### Steps
1. Return to the open console tab → the page still shows the old Files list from client state.
2. Click the "Agents" tab or "Retry" → the console `api()` call gets 401, throws "Your session expired. Sign in again." and also runs `window.location.assign('/sign-in')`.
3. Land on `/sign-in` (no `redirect_url`) and sign in → `/console`, back at the Files tab of the first drive.
4. Her loaded key (kept only in page memory) is gone, along with the tab, drive selection and unsent dialog text (gap: no "return to where you were").
### Variations
- Session lapses while a dialog is open (for example creating an API key): the create call returns 401 and the page navigates away, losing the dialog. An API key may already have been created on the server before the response was lost only if the 401 came afterwards, which the code does not suggest; she checks the API keys list after signing in.
- The same 401 on `/connect`: it redirects to `/sign-in` without keeping the code (the page's own `api()` calls `assign('/sign-in')`, not the `redirect_url` form), so she must reopen the original link.
### Edge Cases
- The error text appears only briefly because the redirect starts at once; she may only see a flash.
- Only the initial server render of `/connect` keeps `?code=`; mid-page expiry loses it (inconsistent with the first load).

## STORY-006: Agent-printed approval link sends a signed-out human through sign-in
**Type**: medium
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Diego Alvarez, signed out of his laptop browser, clicks the link his terminal agent printed.
**Goal**: Approve the agent without losing the pairing code.
**Preconditions**: Agent ran `agent-drive login`, link `https://agentdrive.xyz/connect?code=BKQD-MWRT` printed; Diego is signed out.
**Ideal path**: 2 — sign in, land on the approval page with the code filled in.
**Alternate paths**: new user: use the Clerk sign-up link from the sign-in card (Clerk then decides the redirect, see edge cases); the CLI opens the browser itself when stdout is a terminal and `CI` is unset.
### Steps
1. Open the link → server runs `consoleUserId()`, gets null, redirects to `/sign-in?redirect_url=%2Fconnect%3Fcode%3DBKQD-MWRT`.
2. Sign in with Clerk → returns to `/connect?code=BKQD-MWRT`.
3. `/connect` loads the request and shows "Connect <agent>?" with the code, Agent, Machine, Account (his email), Requested time.
4. Compare the code with the terminal and click "Approve agent" → "Approved".
### Variations
- Diego is signed in under a personal email but intended the work account: the "Account" row shows the email, so he can notice; there is no sign-out or switch-account control on the page itself (gap).
- The agent code expires after 10 minutes (600 s) while he signs in: the page shows the "This code is wrong, expired, or already used. Run agent-drive login in your agent to get a new one." banner.
### Edge Cases
- A brand-new user following this link gets the Clerk sign-in card first; if he uses the Clerk "Sign up" link, whether `redirect_url` survives depends on Clerk, and the sign-up page here sets only the `/console` fallback. If it is lost he lands on an empty console and the code is still pending (not verifiable from this repo, flag for browser testing).
- A new user who reaches `/console` instead of `/connect` sees the "Give your first agent a home." onboarding with no hint that an agent is waiting for approval (gap).

## STORY-007: Signed-in owner finds sign-out and account controls
**Type**: short
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Hana Sato, on a shared office laptop who wants to end her session.
**Goal**: Sign out.
**Preconditions**: Signed in with Clerk.
**Ideal path**: 2 — open the account menu, click sign out.
**Alternate paths**: none found in this app (no sign-out link on billing or settings pages).
### Steps
1. In the console sidebar, look at the bottom → profile row with the Clerk `UserButton` and the text "Your account".
2. Click the avatar → Clerk's menu (manage account, sign out; wording from Clerk).
3. Choose sign out → Clerk ends the session; the next `/console` visit redirects to `/sign-in`.
4. She then opens the sidebar link "Billing & limits" earlier in the day on a small screen: the sidebar is behind a toggle (narrow layout), so the profile row is hidden until she opens it.
### Variations
- Test-auth mode: the row shows an avatar "T" and "Local test session" with no sign-out control.
- On `/console/billing` and `/console/settings`: no profile row or sign-out is described in the console shell for these pages (not verified; flag for browser check).
### Edge Cases
- Console memory (loaded drive key) is not cleared on sign-out by the app itself; Clerk navigation reloads the page, which clears it.
- There is no in-app password, email or notification preference page; all of it is delegated to Clerk.

## STORY-008: Console is unreachable on first load
**Type**: short
**Topic**: Sign-up, sign-in and first console visit
**Persona**: Owen Brooks, on hotel wifi that drops the API request.
**Goal**: Open his workspace.
**Preconditions**: Signed in; `/api/console/*` fails (network or 5xx).
**Ideal path**: 1 — one visible retry action.
**Alternate paths**: browser refresh.
### Steps
1. Open `/console` → "Opening your workspace…" / "Loading your drives and access settings."
2. The load fails → panel changes to "Workspace unavailable": "Check the connection, then refresh to try again." and an error banner with the message.
3. He looks for a Retry button → none on this panel (gap; the file list has "Retry" for files only). He refreshes the page.
4. The workspace loads → Files tab.
### Variations
- Failure is a 401 instead: he is redirected to sign-in with "Your session expired. Sign in again."
### Edge Cases
- Failure after drives load but before usage loads: Usage and strip stats may be missing while the Files tab still works (not verified).

# Topic: Sign-up, sign-in and first console load

Surfaces: `/sign-up`, `/sign-in` (Clerk `<SignUp>`/`<SignIn>`, path routing, `fallbackRedirectUrl="/console"`), `proxy.ts` (`auth.protect()` on `/console` and `/console/*`), `console/page.tsx` (`redirect('/sign-in')` if no user), console client `api()` (401 -> `window.location.assign('/sign-in')`), `UserButton`. Production uses a Clerk development instance with email verification code. The exact Clerk field labels are Clerk-owned and are not in this repo; those steps are marked "Clerk UI".

## STORY-001: First-time sign-up with emailed code and first console load

**Type**: long
**Topic**: Sign-up, sign-in and first console load
**Persona**: Maya Okafor, developer creating a workspace for her research agent with maya.okafor@example.com
**Goal**: Get from landing to an empty, ready console
**Preconditions**: Anonymous; Clerk dev instance configured
**Ideal path**: 4 — click CTA, enter email, enter code, land on console
**Alternate paths**: Landing nav "Sign in" -> Clerk sign-up link; /pricing "Start with Free"; direct /sign-up; GitHub OAuth button (if enabled in Clerk)

### Steps

1. On https://agent-drive.vercel.app click "Create your workspace ↗" → /sign-up shows brand "a/ agent drive" above the Clerk sign-up card
2. Enter email address and any required fields (Clerk UI) → Continue
3. Clerk asks for a verification code (Clerk UI) → Check inbox
4. Switch to email, find the 6-digit code, copy it → Back to tab
5. Paste the code (Clerk UI) → Account created, session cookie set
6. Browser goes to `/console` (fallbackRedirectUrl) → Page is rendered with `key={userId}`; sidebar "Personal workspace / OPERATOR CONSOLE", UserButton with "Your account"
7. Main area shows "Opening your workspace…" / "Loading your drives and access settings." → Client fetches drives, agents, keys, usage in parallel
8. First load provisions the Agent Drive account behind the scenes (no confirmation message) → Panel changes
9. Files tab shows onboarding "Give your first agent a home." with eyebrow "A LITTLE SETUP. A LASTING WORKSPACE." and button "Create your first drive ↗" → Steps strip "01 Create a drive / 02 Save your key / 03 Connect an agent"
10. Sees badge "CLIENT-SIDE ENCRYPTED" and sidebar "Keys stay with you." → Reassured; nav count next to Files shows 0

### Variations

- Maya mistypes the code: Clerk shows its own error (Clerk UI) and lets her retry or request a new code.
- Email arrives slowly; she waits on the code step and may request a resend (Clerk UI).
- Sign-up with GitHub if Clerk has the provider on: skips the code.

### Edge Cases

- She closes the tab at the code step and later visits /sign-up again; Clerk resumes or restarts (Clerk behavior).
- Dev instance: Clerk may show a "Development mode" badge to the user (Clerk behavior, unverified).
- No welcome or explanation of "Personal workspace"; the empty state is the first onboarding.

## STORY-002: Returning user signs in from the landing page

**Type**: short
**Topic**: Sign-up, sign-in and first console load
**Persona**: Tomas Berg, existing user on a new laptop
**Goal**: Reach the console with existing files
**Preconditions**: Account exists; signed out
**Ideal path**: 3 — Sign in, enter email and code, land on console
**Alternate paths**: "Open console" on landing (redirects to /sign-in); direct /console; direct /sign-in

### Steps

1. Click "Sign in" in the landing nav → /sign-in with Clerk card and a link to /sign-up (signUpUrl)
2. Enter email and complete the verification step (Clerk UI) → Redirect to /console
3. Console shows "Opening your workspace…" then "Drives & files" with the selected drive and file table → Drive key is NOT loaded; badge "Key required for downloads"

### Variations

- Clerk may ask for a new emailed code on an unrecognized device (Clerk setting).

### Edge Cases

- Sign-in on a new browser does not restore drive keys (they live in page memory only) so downloads need "Load drive key" each session.

## STORY-003: Unauthenticated deep link to billing, then sign-in

**Type**: medium
**Topic**: Sign-up, sign-in and first console load
**Persona**: Priya Raman, who bookmarked https://agent-drive.vercel.app/console/billing
**Goal**: Reach "Billing & limits" after being logged out
**Preconditions**: Existing account, session expired or cleared
**Ideal path**: 2 — sign in, land on billing
**Alternate paths**: Go to /console then click sidebar "Billing & limits"

### Steps

1. Open /console/billing → Middleware `auth.protect()` redirects to /sign-in (Clerk adds a redirect URL for the original page)
2. Sign in with email and code → Expected return to billing; if the redirect param is dropped, `fallbackRedirectUrl` sends her to /console instead (unverified which)
3. If on /console, click "Billing & limits" in sidebar → /console/billing shows "Billing & limits"

### Variations

- Same flow for /console/settings ("Activity & deletion").

### Edge Cases

- Page-level guards (`redirect('/sign-in')`) lose the original target if middleware is bypassed (unconfigured or test mode).
- /api/console/\* is not page-protected by middleware; unauthenticated calls return 401 from the handler instead of a redirect.

## STORY-004: Session expires while the console is open

**Type**: medium
**Topic**: Sign-up, sign-in and first console load
**Persona**: Jonas Weber, who left the Usage tab open overnight
**Goal**: Continue working without losing work
**Preconditions**: Console open, Clerk session expired
**Ideal path**: 2 — sign in again, resume
**Alternate paths**: none found

### Steps

1. Click "Refresh" on the console → `api()` receives HTTP 401
2. Page does `window.location.assign('/sign-in')` immediately → Whole page navigates; error text "Your session expired. Sign in again." is thrown but the page is already leaving, so it is barely seen
3. Sign in with email and code → /console reloads
4. Console reopens at the Files tab; any in-memory drive key is gone → Must "Load drive key" again

### Variations

- Session expires while the "Create a drive" receipt modal is open: the `beforeunload` warning is registered, so the browser may prompt before navigation; losing the unsaved drive key is the severe case.
- Expires while the API-key receipt is open: the secret shown once is lost.

### Edge Cases

- No toast tells the user why they were signed out.
- Unsaved modal input is discarded.

## STORY-005: Sign out via UserButton and sign back in

**Type**: short
**Topic**: Sign-up, sign-in and first console load
**Persona**: Aisha Rahman, using a shared lab computer
**Goal**: End her session safely
**Preconditions**: Signed in, drive key loaded
**Ideal path**: 2 — open account menu, Sign out
**Alternate paths**: Closing the tab discards in-memory drive keys but keeps the Clerk session

### Steps

1. Click the avatar next to "Your account" at the sidebar bottom (Clerk `UserButton`) → Menu opens with manage account and Sign out (Clerk UI)
2. Choose Sign out → Clerk signs out; destination is Clerk's default after sign out (likely the landing page, unverified)
3. Press browser Back → /console redirects to /sign-in rather than showing cached data

### Variations

- Aisha clicks the brand "a/ agent drive" instead; this goes to landing but she stays signed in (landing shows "Sign in" even though a session exists).

### Edge Cases

- Landing and pricing are not session-aware: after sign-in they still offer "Sign in" and "Create your workspace".

## STORY-006: Signed-in user hits /sign-in or /sign-up again

**Type**: short
**Topic**: Sign-up, sign-in and first console load
**Persona**: Lena Fischer, who clicks the landing "Sign in" while already logged in
**Goal**: Get to the console
**Preconditions**: Active Clerk session
**Ideal path**: 1 — one click
**Alternate paths**: "Open console" button on landing goes directly to /console

### Steps

1. On landing click "Sign in" → /sign-in loads; Clerk detects an existing session and redirects to `/console` (fallbackRedirectUrl) rather than showing a form (Clerk behavior)
2. Console opens → Same flow as the loading state

### Variations

- Clerk shows "already signed in" messaging instead of redirecting (Clerk behavior, unverified).

### Edge Cases

- Two landing buttons ("Sign in" and "Open console") both lead to the console for signed-in users.

## STORY-007: Self-hosted install without Clerk keys

**Type**: short
**Topic**: Sign-up, sign-in and first console load
**Persona**: Ravi Shah, evaluating a self-hosted build
**Goal**: Sign in
**Preconditions**: Clerk env vars missing or placeholder
**Ideal path**: 2 — it cannot succeed; clear message
**Alternate paths**: none found

### Steps

1. Visit /sign-in → Panel h1 "Sign in", "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
2. Visit /sign-up → Panel h1 "Create your workspace", "Sign-up is not configured on this installation. ..."
3. Visit /console → Redirects to /sign-in, same panel; no link out to docs

### Variations

- Test-auth builds (`AGENT_DRIVE_TEST_AUTH=1`, development only) accept a signed cookie; the console shows "Local test session" instead of `UserButton`.

### Edge Cases

- Test auth requested outside development fails closed: `consoleUserId()` returns null, so the user is redirected to /sign-in.

## STORY-008: First console load fails (workspace unavailable)

**Type**: medium
**Topic**: Sign-up, sign-in and first console load
**Persona**: Sofia Marin on hotel Wi-Fi right after signing up
**Goal**: Reach the onboarding screen
**Preconditions**: New session; the `/api/console/*` calls fail or time out
**Ideal path**: 2 — Refresh, success
**Alternate paths**: Reload the whole page

### Steps

1. Land on /console → "Opening your workspace…" panel
2. A request fails → Panel heading becomes "Workspace unavailable" with "Check the connection, then refresh to try again."; an error banner also appears above with the error message
3. Click header "Refresh" → Re-runs the same four fetches
4. Succeeds → Onboarding "Give your first agent a home." appears

### Variations

- Sofia reloads the browser instead; `/console` re-renders the same states.

### Edge Cases

- The "+ New drive" button is disabled until `ready`, so she cannot start before load succeeds.
- Error text may be generic ("The request could not be completed.") if the server gives no message.

## STORY-009: Mobile sign-up and first console view

**Type**: medium
**Topic**: Sign-up, sign-in and first console load
**Persona**: Kenji Watanabe on a 390px phone, getting the verification code from his mail app
**Goal**: Sign up and see the console
**Preconditions**: Anonymous, narrow viewport
**Ideal path**: 4 — CTA, email, code, console
**Alternate paths**: none found

### Steps

1. Tap "Create your workspace" → Clerk card on /sign-up
2. Enter email, leave the browser to open the mail app, copy the code → Returns; the page may reload; Clerk keeps the in-progress sign-up (Clerk behavior)
3. Paste code → Redirect to /console
4. Console at <=760px: sidebar collapses to the top (`.workspace-label`, `.nav-label`, `.privacy-note` hidden); the profile avatar is pinned top-right and the "Your account" label hidden → Tabs Files/Agents/API keys/Usage/Trash scroll or wrap
5. Sees onboarding "Give your first agent a home." → Taps "Create your first drive ↗"

### Variations

- Landscape tablet 760-1100 px uses the two-column shell with different widths.

### Edge Cases

- The "Keys stay with you." reassurance is hidden on mobile.
- Creating a drive that downloads a recovery key file on mobile browsers may behave differently (checked in the provisioning topic).

## STORY-010: Account-switching or wrong-account sign-in

**Type**: medium
**Topic**: Sign-up, sign-in and first console load
**Persona**: Dev Patel, who has two emails (work and personal) and signs in with the wrong one
**Goal**: Reach the console that holds his drives
**Preconditions**: Two Clerk identities; drives live under the work one
**Ideal path**: 4 — sign out, sign in with the right account
**Alternate paths**: UserButton may offer "Add account"/switch (Clerk setting)

### Steps

1. Sign in with the personal email → Console loads
2. Files tab shows onboarding "Give your first agent a home." (empty) → Dev thinks his data is gone
3. Click "Usage" and "Agents" tabs → Also empty
4. Realizes the wrong email; open UserButton → Sign out (Clerk UI)
5. Sign in with work email and code → Console shows his drives

### Variations

- GitHub OAuth was used the first time and email the second; they may map to different accounts (Clerk linking behavior, unverified).

### Edge Cases

- The console never displays the signed-in email; only "Your account" and "Personal workspace", so he must open the UserButton menu to find out.
- Because first load auto-provisions, the wrong-account visit silently created a second empty Agent Drive account.

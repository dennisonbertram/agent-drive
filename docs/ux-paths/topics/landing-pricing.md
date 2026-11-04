# Topic: Landing, pricing and plan discovery (anonymous visitor)

Surfaces: `/` (apps/web/app/(app)/page.tsx), `/pricing` (apps/web/app/(app)/pricing/page.tsx), `proxy.ts` matcher. Pricing and landing are NOT in the Clerk middleware matcher, so they load with no auth.

## STORY-001: Visitor reads the hero and starts a workspace

**Type**: short
**Topic**: Landing, pricing and plan discovery
**Persona**: Maya Okafor, a developer running two Claude Code agents, who just clicked a link to https://agent-drive.vercel.app
**Goal**: Understand what the product is and begin sign-up
**Preconditions**: Anonymous, desktop browser, Clerk configured
**Ideal path**: 2 — open landing, click the primary CTA
**Alternate paths**: Nav "Sign in" -> /sign-in then the Clerk "Sign up" link; "Open console" -> /console -> redirect to /sign-in; /pricing "Start with Free" -> /sign-up

### Steps

1. Open https://agent-drive.vercel.app → Landing shows eyebrow "A WORKSPACE THAT OUTLIVES THE SESSION", h1 "Your agents. Their own drive.", copy about memory and "Encrypted before it leaves their machine."
2. Read the terminal preview `$ agent-drive put ./handoff.md /memory/handoff.md` and "A fresh session. The same context." → Understands it is a CLI-first product
3. Click "Create your workspace ↗" → Navigates to /sign-up with Clerk sign-up form

### Variations

- Maya first scrolls to the three cards ("01 / PRIVATE BY DESIGN" "You hold the keys.", "02 / BUILT FOR AGENTS" "Less setup. More doing.", "03 / HUMAN OVERSIGHT" "A clear view of the work.") before clicking.

### Edge Cases

- The landing has no mention of price or plans in the body; only the nav "Pricing" button leads there.
- Two CTAs that look like peers: "Create your workspace" (primary) and "Open console" (secondary). A first-time visitor clicking "Open console" gets bounced to sign-in (see STORY-004).

## STORY-002: Evaluator compares plans on /pricing

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Tomas Berg, tech lead deciding whether his team's 6 agents fit on Free or need Developer
**Goal**: Determine which plan covers about 8 drives, 40 GiB of traces and moderate API use
**Preconditions**: Anonymous, desktop
**Ideal path**: 3 — landing -> Pricing -> read cards
**Alternate paths**: Direct URL /pricing; pricing is also reachable from the console only indirectly (billing page plan cards repeat the same numbers after sign-in)

### Steps

1. On landing click nav "Pricing" → /pricing loads with eyebrow "START SMALL. KEEP YOUR KEYS.", h1 "A home for every agent.", "Client-side encryption on every plan. Choose the room your agents need."
2. Read the Free card → "$0.00 / month", "3 drives", "5 GiB stored ciphertext", "5 GiB monthly downloads included", "1,000,000 API operations / month", "CLI, MCP, web console, and encrypted sharing"
3. Read Developer card (highlighted as `selected`) → "$20.00 / month", "25 drives", "100 GiB stored ciphertext", "100 GiB monthly downloads included", "10,000,000 API operations / month"
4. Read Team card → "$200.00 / month", "250 drives", "1024 GiB stored ciphertext" (the Team card prints 1024 GiB, not "1 TiB"), "1024 GiB monthly downloads included", "100,000,000 API operations / month"
5. Conclude 8 drives and 40 GiB means Developer → Scrolls to "How usage works" to check what counts toward storage
6. Read "All retained file versions count toward storage, including overwritten files and trash." → Realizes 40 GiB of live data plus versions may exceed 100 GiB over time; hesitates

### Variations

- Tomas compares the figures with the post-login Billing & limits plan cards, which show the same numbers (duplicated information on two surfaces).

### Edge Cases

- Plan names render as raw keys (`free`, `developer`, `team`) in `<h2>`; capitalization depends on CSS.
- Free-plan stop behavior ("Free accounts stop at their included allowances") is in fine print only, not on the Free card.

## STORY-003: Visitor notices paid checkout is disabled

**Type**: short
**Topic**: Landing, pricing and plan discovery
**Persona**: Priya Raman, founder who wants to pay for Developer today
**Goal**: Buy the Developer plan
**Preconditions**: Anonymous; deployment lacks Stripe prices/rates (`!paidAvailable`)
**Ideal path**: 3 — Pricing, read banner, choose Free
**Alternate paths**: Developer "Manage your plan" -> /console/billing (requires sign-in, then shows "Choose developer" and a disabled-checkout banner "Paid checkout is not enabled...")

### Steps

1. Open /pricing → A status banner reads "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans."
2. Click Developer's "Manage your plan" → Anonymous user is sent to /console/billing and is redirected to /sign-in (the button label promises "manage" a plan she does not have)
3. Sign in, land on billing, see the billing disabled banner → Cannot buy; the information is repeated on a second surface, only after an account was made

### Variations

- Deployment fully configured: banner is absent and Developer button still says "Manage your plan".

### Edge Cases

- Banner says "when sign-in and storage are configured", wording aimed at operators, not buyers.
- Team and Developer buttons are identical in label and target; the plan chosen is not carried through.

## STORY-004: Curious visitor clicks "Open console" while signed out

**Type**: short
**Topic**: Landing, pricing and plan discovery
**Persona**: Jonas Weber, who assumes "Open console" is a demo
**Goal**: See the console without an account
**Preconditions**: Anonymous
**Ideal path**: 1 — a visible demo or clear sign-in label
**Alternate paths**: Direct visit to /console or /console/billing or /console/settings (all redirect)

### Steps

1. Click "Open console" on the hero → Middleware `auth.protect()` redirects to Clerk sign-in at /sign-in
2. Sees the sign-in form instead of any console preview → Confused, clicks "Sign up" link under the form or goes back

### Variations

- Test or unconfigured deployment: the Sign in page shows "Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access." (see signup-signin topic).

### Edge Cases

- The label "Open console" suggests entry for returning users, yet sits beside "Create your workspace" and duplicates nav "Sign in" in effect.

## STORY-005: Cost-conscious visitor works out overage and "Not charged" egress

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Lena Fischer, a data engineer who will archive about 300 GiB and download often
**Goal**: Estimate monthly cost on Developer including overages
**Preconditions**: Anonymous; rates published; `S3_EGRESS_METERING=none` on production
**Ideal path**: 3 — open pricing, read rates, compute
**Alternate paths**: Same rates on /console/billing after sign-in

### Steps

1. Open /pricing and scroll to "How usage works" → Reads about 5 GiB max per encrypted upload and that the original file must leave room for encryption overhead
2. Read "Additional usage on paid plans" → List: "Extra drive / month", "Extra GiB stored / month", "Extra GiB downloaded" = "Not charged", "Extra 1,000 API operations"
3. Notes Developer includes 100 GiB storage, so 200 GiB extra x the storage rate → Needs a calculator; no estimator exists
4. Read caption → "Downloads are measured from observed storage logs, not just issued links. Logs can arrive late..." and "Spending caps block new writes; they are not guaranteed invoice or network-traffic ceilings."
5. Wonders whether "Not charged" is permanent → Nothing states it is current-deployment behavior only

### Variations

- Egress metered deployment: egress row shows a dollar amount instead of "Not charged".
- Rates unpublished: panel text "Overage rates have not been published for this deployment. Paid checkout stays disabled until billing is fully configured."

### Edge Cases

- Prices are described as "Base prices are in USD, before applicable taxes."
- Caption describes egress measurement even when egress is "Not charged", which is contradictory-looking.

## STORY-006: Security-minded reader checks what is private

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Dr. Aisha Rahman, a privacy-focused researcher storing agent notes
**Goal**: Learn exactly what the service can and cannot see before signing up
**Preconditions**: Anonymous
**Ideal path**: 2 — read the landing card and the pricing data card
**Alternate paths**: none found (no separate security or docs page; only the external Quickstart link)

### Steps

1. On landing read "01 / PRIVATE BY DESIGN" -> "You hold the keys." → "File contents encrypt on your device. The storage service receives ciphertext, never your drive key."
2. Go to /pricing, scroll to "Your data and access" → "Private contents." card says paths, sizes, tags and activity metadata remain visible, and "Save your recovery keys: we cannot recover lost keys."
3. Read "Leave on your terms." → Deletion "disables access and uses a retryable background purge, not an instant erasure claim."
4. Compare the two surfaces → Landing never mentions plaintext metadata; only pricing does. Aisha feels the landing oversells

### Variations

- She clicks "Quickstart" (external GitHub docs link) to verify claims, leaving the app.

### Edge Cases

- "Quickstart" opens GitHub in the same tab; there is no way back except browser Back.

## STORY-007: Developer follows the Quickstart link from pricing, then returns

**Type**: short
**Topic**: Landing, pricing and plan discovery
**Persona**: Kenji Watanabe, CLI-first engineer
**Goal**: See how an agent connects before creating an account
**Preconditions**: Anonymous
**Ideal path**: 2 — Pricing -> Quickstart
**Alternate paths**: Landing has no Quickstart link at all

### Steps

1. Open /pricing → Header nav has "Quickstart" and "Sign in" (landing nav instead has "Pricing" and "Sign in")
2. Click "Quickstart" → GitHub `docs/quickstart.md` in the same tab (href to dennisonbertram/agent-drive)
3. Read, then press browser Back → Returns to /pricing

### Variations

- The CLI is not published to npm, so the quickstart requires building from the checkout; Kenji may bounce.

### Edge Cases

- Nav items differ between landing and pricing (inconsistent header).

## STORY-008: Mobile visitor browses landing and pricing

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Sofia Marin, reading a shared link on a 390px phone
**Goal**: Read pricing and tap through to sign-up
**Preconditions**: Anonymous, viewport 390 px wide
**Ideal path**: 3 — landing, Pricing, Start with Free
**Alternate paths**: Direct hero CTA "Create your workspace"

### Steps

1. Open landing on phone → Hero stacks; nav buttons "Pricing" and "Sign in" in header
2. Tap "Pricing" → Pricing layout; below 700px the "How usage works" grid collapses to one column and the header wraps (`.pricing-page .billing-header { flex-wrap: wrap }`)
3. Scroll the three plan cards → Cards stack; rate list values use `white-space: nowrap`, risk of tight rows
4. Tap "Start with Free" → /sign-up

### Variations

- Tablet 760-1100px uses intermediate grid rules from globals.css.

### Edge Cases

- Long terminal command in the landing preview may need horizontal scroll or wrap on narrow screens (verify visually).

## STORY-009: Returning, signed-in user opens pricing and clicks "Start with Free"

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Dev Patel, existing Free user who is already signed in and wonders about upgrading
**Goal**: Find upgrade info from the public site
**Preconditions**: Signed in with Clerk; has a Free account
**Ideal path**: 3 — pricing -> Manage your plan -> choose
**Alternate paths**: Console sidebar "Billing & limits"; API keys tab links to billing; CLI quota errors print an `Upgrade:` URL

### Steps

1. Visit https://agent-drive.vercel.app/pricing → Page is identical to the anonymous version: header offers "Sign in" even though he is signed in (no account-aware nav)
2. Free card still says "Start with Free" → Sends him to /sign-up (Clerk will typically redirect an already-signed-in user onward; verify)
3. Click Developer "Manage your plan" → /console/billing opens with plan cards "Choose developer"
4. Realizes Free and Developer cards on pricing don't indicate "Current plan" → Must compare against billing page

### Variations

- He uses landing "Open console" which now goes straight to /console.

### Edge Cases

- Pricing cannot show current plan because it is static and anonymous.

## STORY-010: Visitor on an unconfigured installation

**Type**: medium
**Topic**: Landing, pricing and plan discovery
**Persona**: Ravi Shah, a self-hoster who deployed without Clerk keys
**Goal**: Find out why sign-up does nothing useful
**Preconditions**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` or `CLERK_SECRET_KEY` missing or placeholder
**Ideal path**: 2 — sign-up -> read message
**Alternate paths**: Sign in page shows the equivalent message

### Steps

1. Landing loads normally → CTAs still shown
2. Click "Create your workspace" → /sign-up shows panel h1 "Create your workspace" and "Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access."
3. Click brand "a/ agent drive" → Back to landing
4. Click "Open console" → `consoleUserId()` null so redirect to /sign-in -> panel "Sign-in is not configured on this installation..."
5. Open /pricing → Banner "Paid checkout is not enabled on this deployment..." also shown

### Variations

- Placeholder strings like "replace-me" or "your_secret_key" in the env also count as unconfigured.

### Edge Cases

- Middleware skips Clerk entirely when unconfigured, so /console is not protected by middleware but the page still redirects.
- Visitor-facing text mentions "Clerk instance", operator jargon.

## STORY-011: Long evaluation: landing to pricing to sign-up with hesitation

**Type**: long
**Topic**: Landing, pricing and plan discovery
**Persona**: Hannah Lindqvist, solo developer comparing storage options for her research agent
**Goal**: Decide, then start on Free
**Preconditions**: Anonymous, desktop
**Ideal path**: 3 — landing, Start with Free via pricing, create account
**Alternate paths**: Hero "Create your workspace" skips pricing entirely

### Steps

1. Open landing → Reads hero copy
2. Scrolls feature cards → Reads three cards
3. Reads footer "AGENT DRIVE Persistent storage. Independent agents." → No links in landing footer
4. Looks for a price on the landing page → None
5. Clicks "Pricing" → /pricing
6. Reads banner "Paid checkout is not enabled..." → Slight doubt about the product being production-ready
7. Reads Free card "3 drives, 5 GiB" → Decides OK for experimentation
8. Scrolls to "How usage works" → Notes trash and old versions count toward storage
9. Scrolls to "Private contents." → Notes "we cannot recover lost keys"
10. Clicks the brand link "a/ agent drive" → Back to landing (pricing footer link "AGENT DRIVE" also goes home)
11. Clicks "Pricing" again to recheck 5 GiB → Reloads
12. Clicks "Sign in" in the nav by mistake (she has no account) → /sign-in
13. Sees Clerk sign-in form with a sign-up link → Clicks it, reaching /sign-up
14. Alternatively returns to /pricing and clicks "Start with Free" → /sign-up, same destination
15. Starts sign-up (continues in signup-signin topic) → Verification code flow

### Variations

- Hannah uses browser Back after step 5 to re-read the hero.

### Edge Cases

- The landing footer is not a link; pricing footer "AGENT DRIVE" is a link (inconsistent).
- No way to jump to Pricing from /sign-in or /sign-up pages (only brand link to landing).

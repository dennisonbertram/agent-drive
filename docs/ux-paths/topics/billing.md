# Topic 9: Usage, billing and plan changes

Code read: `apps/web/app/(app)/console/billing/billing-client.tsx`, `console/console.tsx` (Usage tab), `src/billing/{policy,ledger,providers}.ts`, `packages/agent-drive/src/cli.ts`. Context: Stripe TEST mode, Developer $20/mo, Team $200/mo, overage $2/drive, $0.05/GiB, $0.01/1,000 ops, egress "not metered".

Cross-surface notes: storage/operations appear on the console Usage tab ("ENCRYPTED STORAGE", "API OPERATIONS", "Usage by author") AND on `/console/billing` ("RETAINED STORAGE", "Usage by agent"). The same agent is labelled "Human console" on Usage but "Console" on Billing for `__console__`. Plan allowances appear on `/pricing`, on the billing plan cards and (as the limit) in the "RETAINED STORAGE" card. Overage rates appear on `/pricing` ("Additional usage on paid plans") and in "Configured overage rates".

## STORY-001: Check this month's usage from the Usage tab and hop to billing

**Type**: short
**Topic**: Usage, billing and plan changes
**Persona**: Maya Okafor, indie developer with two research agents, wondering whether she is near the Free 5 GiB limit
**Goal**: See how much storage and how many operations were used this month
**Preconditions**: Signed in, Free plan, 2 drives, some files uploaded by agents
**Ideal path**: 2 — open the Usage tab, read the cards
**Alternate paths**: `/console/billing` "RETAINED STORAGE" card shows storage plus the included amount directly (1 navigation); `/pricing` shows only allowances, not personal usage

### Steps

1. Open `/console`, click sidebar "Usage" → Cards "ENCRYPTED STORAGE" (e.g. 3.4 GiB, "All committed versions, including trash"), "API OPERATIONS" ("Successful operations this calendar month").
2. Look for how much of 5 GiB is left → Cards show no allowance; only per-drive rows "x / quota" or "· account limits apply" appear under "Storage by drive". Maya hesitates.
3. Click "Billing & limits" inside the "EGRESS & COST" card → Navigates to `/console/billing`; "RETAINED STORAGE" shows "5.0 GiB included · 2 drives".

### Variations

- Reach billing via the sidebar link "Billing & limits" instead of the card button.

### Edge Cases

- "EGRESS & COST" card contains only a button, no egress or cost figure, so the label promises more than it shows.
- Storage counts trash and all versions, so deleting files to Trash does not reduce the number.
- Brand-new account: "No storage used yet."

## STORY-002: Read the Billing & limits page on the Free plan

**Type**: short
**Topic**: Usage, billing and plan changes
**Persona**: Tomás Rivera, first-time visitor to billing, evaluating whether Free is enough
**Goal**: Understand what he is paying and what is included
**Preconditions**: Free plan, Stripe configured (checkoutConfigured true)
**Ideal path**: 1 — open `/console/billing`
**Alternate paths**: none found for the current-usage view besides Usage tab (partial)

### Steps

1. Click "Billing & limits" → "Loading your billing details…" then three cards: "{Month} · ESTIMATE" (`$0.00`, "$0.00 in metered overage", "Excludes tax. Base fees may be prorated on your Stripe invoice."), "RETAINED STORAGE", "OBSERVED DOWNLOADS".
2. Read the downloads card → Shows "Not metered — provider does not charge egress" and "0 B authorized this month"; small text "Actual transfer reports can be delayed or incomplete. Authorizations are not charges." Tomás is unsure what "authorized" means.
3. Scroll to "A plan for your agents" → Tag "free · no card required"; Free card button "Current plan" disabled; Developer "Choose developer", Team "Choose team".
4. Read "Configured overage rates" → Free shows the checkout rates card (rateCard falls back to `checkoutRates`): "$2.00 per extra drive/month · $0.05 per extra GiB stored/month · downloads not charged · $0.01 per 1,000 extra operations." with "Paid plans only."

### Variations

- Checkout not configured: banner "Paid checkout is not enabled. Stripe prices, metering and overage rates must be configured first. You can keep using the Free plan." and both choose buttons disabled.

### Edge Cases

- Plan names render lowercase ("developer", "free") straight from the id.
- Error load: red banner with "Refresh" button; 401 redirects to `/sign-in`.

## STORY-003: Upgrade from Free to Developer with the Stripe test card

**Type**: medium
**Topic**: Usage, billing and plan changes
**Persona**: Maya Okafor, hit 4.6 GiB and wants room for a month of agent runs
**Goal**: Move to the Developer plan ($20/mo)
**Preconditions**: Free plan, no Stripe customer, Stripe test mode
**Ideal path**: 3 — click Choose developer, pay on Stripe, land back on billing
**Alternate paths**: Agent hits 402 and CLI prints `Upgrade: <origin>/console/billing` -> same page; `/pricing` "Manage your plan" CTA (per discovery) -> billing

### Steps

1. Open `/console/billing`, click "Choose developer" → No confirm dialog (confirm only shows when current plan is not free); button disabled while busy, then browser redirected to checkout.stripe.com.
2. On Stripe enter test email, card 4242 4242 4242 4242, any future expiry, CVC 123, name → Stripe Checkout accepts.
3. Pay/Subscribe → Redirect back to the app (billing page); webhook updates plan.
4. Back on `/console/billing` read the tag → Should read "developer · active"; button on Developer card "Current plan"; Team card now "Change to team". "Invoices & payment details" button appears in the heading (hasCustomer).
5. Check estimate card → Shows `$20.00` base plus `$0.00 in metered overage`.

### Variations

- Maya cancels on the Stripe page and returns: still Free; clicking again resumes the same checkout session (recovery logic; "Resume the previous plan checkout before changing plans." if she tries Team instead while a Developer checkout is pending).
- Slow webhook: she returns while the plan still shows free; error text "Checkout completed; subscription status is being updated." may show; she must click "Refresh".

### Edge Cases

- Stripe redirect URL not on checkout.stripe.com/billing.stripe.com -> error "The payment provider returned an unexpected URL."
- Declined card (4000 0000 0000 0002) stays on Stripe with its own error; the app shows nothing.
- Checkout recovery after 23 hours is ambiguous: "Checkout recovery is ambiguous after 23 hours; reconcile the Stripe checkout manually." - dead end for a human.

## STORY-004: Change from Developer to Team with proration

**Type**: medium
**Topic**: Usage, billing and plan changes
**Persona**: Priya Nair, platform engineer whose agents grew to 40 drives (Developer allows 25)
**Goal**: Upgrade to Team ($200/mo) and understand the charge
**Preconditions**: Developer plan, active subscription
**Ideal path**: 2 — click "Change to team", confirm
**Alternate paths**: "Invoices & payment details" (Stripe portal) for plan changes if portal allows; none else

### Steps

1. Open `/console/billing`; notice estimate includes overage (e.g. 15 extra drives x $2.00 = $30.00 → `$50.00`) → Reads "$30.00 in metered overage".
2. Click "Change to team" → Browser confirm: "Change to team? Stripe will prorate the base-plan change on your next invoice. Your existing spending cap stays in place."
3. Click OK → No redirect; page reloads data; banner "Plan updated. Stripe will apply prorations on your next invoice."
4. Re-read cards → Tag "team · active", estimate now `$200.00` + overage `$0.00` (250 drives).

### Variations

- Click Cancel on the confirm: nothing happens, no message.
- Priya tries Free: its button reads "Included by default" and is disabled; there is no in-app downgrade to Free.

### Edge Cases

- Confirm uses a native `window.confirm` unlike the in-app modals.
- Estimate may lag until period recalculation; text says base fees may be prorated.
- Stripe returns incompatible items: "The Stripe subscription items are incompatible with billing."

## STORY-005: Agent hits the Free allowance and the human upgrades

**Type**: long
**Topic**: Usage, billing and plan changes
**Persona**: Jordan Lee runs a nightly coding agent; the agent reports a failure Jordan must unblock
**Goal**: Recover from a 402 payment-required during `agent-drive put` by upgrading, then confirm writes work
**Preconditions**: Free plan, 4.98 GiB stored, drive key and API key configured on the agent machine
**Ideal path**: 5 — read Upgrade URL, open it, choose developer, pay, re-run put
**Alternate paths**: Console Usage tab -> "Billing & limits"; delete data (but Trash still counts so deleting does not help quickly); raise nothing via spend cap (cap only reduces)

### Steps

1. Agent runs `agent-drive put ./dump.tar /archive/dump.tar --drive <id>` → stderr: error "Your plan allowance would be exceeded. Upgrade or enable configured overage billing." then `Upgrade: https://agent-drive.vercel.app/console/billing`.
2. Jordan copies the URL into a browser, signed in → `/console/billing` loads; storage card near full (4.9 GiB of 5.0 GiB included).
3. Jordan hesitates: tries `agent-drive rm` on old files first → Items go to Trash; "RETAINED STORAGE" does not drop ("All versions count, including trash").
4. Clicks "Choose developer" → Stripe Checkout.
5. Pays with 4242 4242 4242 4242 → Returns to billing, tag "developer · active".
6. Agent retries the same put → Succeeds and prints version JSON.
7. Jordan opens Usage tab -> numbers rise; rate card now "Configured overage rates" from `rates`.

### Variations

- Receiving quota error `quota_exceeded` "The drive quota would be exceeded." instead: this is a per-drive `--quota`, not billing; the Upgrade URL does not appear and upgrading does not fix it.
- Message "Your subscription needs attention before new writes can be accepted." appears for a paid plan with failed payment: the fix is the portal, not Choose.

### Edge Cases

- Unauthenticated Jordan opening the Upgrade URL is sent to sign-in; after sign-in it may land on `/console` (not guaranteed to return to billing).
- Webhook delay: first retry may still 402.
- CLI says "Retry after: N seconds" for rate limits, which is a different failure with no upgrade link.

## STORY-006: Set a write cap and alert threshold

**Type**: medium
**Topic**: Usage, billing and plan changes
**Persona**: Dana Whitfield, cost-conscious founder on Developer
**Goal**: Cap monthly spend at $30 and email dana@example.com at $25
**Preconditions**: Developer plan, active
**Ideal path**: 4 — fill three fields, save
**Alternate paths**: none found (no API-key/CLI route; PATCH `/api/console/billing/settings` is console-only)

### Steps

1. Scroll to "Boundaries, not surprises." → Reads that a write cap stops new uploads once estimated spend reaches it; existing files stay readable.
2. Type `30` into "Monthly write cap (USD)" → Accepted.
3. Type `25` in "Email me at (USD)" and `dana@example.com` in "Alert email" → Accepted; if email delivery is off, caption "Email delivery is not configured. You can save a threshold, but alerts will remain queued until delivery is enabled."
4. Click "Save spending controls" → Button "Working…", then banner "Spending controls saved." and fields reload.

### Variations

- Dana types `$30` -> error "Enter a dollar amount with at most two decimal places." (the `$` is rejected).
- `12.345` -> same error; `20000000` -> "The maximum limit is $10,000,000."
- Blank cap to remove it: "Leave blank for no cap."

### Edge Cases

- Cap includes the base fee: on Developer ($20 base) a cap of `$20` or less is already reached, so writes block immediately; a `0` cap is documented to block immediately, but a low non-zero cap behaves the same without warning.
- Agent hitting the cap sees 402 "Your monthly write spend cap has been reached. Existing files remain readable." with the Upgrade URL pointing back to the same billing page, which cannot upgrade beyond; the human must raise/clear the cap.
- Alert threshold has no validation against the cap.

## STORY-007: Cap reached mid-month, agent blocked, human raises the cap

**Type**: long
**Topic**: Usage, billing and plan changes
**Persona**: Dana Whitfield, after an agent burst of 3M operations; a teammate agent "ci-bot" starts failing
**Goal**: Find out why writes fail, understand which agent caused it, and unblock
**Preconditions**: Developer plan, cap $25, estimate at $25.00
**Ideal path**: 5 — open billing, read estimate, raise cap, save, agent retries
**Alternate paths**: Upgrade to Team (also lifts allowance but cap stays: "Your existing spending cap stays in place.") ; Usage tab "Usage by author" for who is responsible (no cost shown)

### Steps

1. ci-bot's `put` fails → stderr "Your monthly write spend cap has been reached. Existing files remain readable." + `Upgrade: .../console/billing`.
2. Dana opens the link → Estimate card shows `$25.00`, overage lines.
3. Scrolls to "Usage by agent" → Rows: agent, RETAINED STORAGE, OBSERVED DOWNLOADS ("Not metered — provider does not charge egress" repeated in every row), OPERATIONS.
4. Considers downloading the CSV → selects Export period "Current month", clicks "Download CSV" → file `agent-drive-usage-2026-11.csv`.
5. Changes "Monthly write cap (USD)" from `25` to `60`, clicks "Save spending controls" → "Spending controls saved."
6. ci-bot retries → Write succeeds.
7. Reads caption → "This breakdown supplements your Stripe invoice—it is not a per-agent allocation of charges."

### Variations

- Dana tries the Team card to "fix" it: the confirm text reminds her the cap stays.
- Reads still work during the block; downloads continue within allowance.

### Edge Cases

- Reads are not blocked, so "cap" is a write cap only; label is accurate but the Upgrade URL on the error suggests upgrading.
- Transfer logs may arrive later so the estimate can understate.

## STORY-008: Manage payment method and invoices through the Stripe portal

**Type**: short
**Topic**: Usage, billing and plan changes
**Persona**: Priya Nair, needs to update a card and download an invoice
**Goal**: Reach invoices, payment method, and cancellation
**Preconditions**: Paid plan, Stripe customer exists (hasCustomer)
**Ideal path**: 2 — click "Invoices & payment details", act in Stripe
**Alternate paths**: none found

### Steps

1. Click "Invoices & payment details" in the page heading → Button disabled while busy; redirect to billing.stripe.com.
2. Update card with 4242 4242 4242 4242 or cancel the subscription in Stripe → Stripe confirms; Priya returns via Stripe's link.
3. Back in app, reload → Tag shows new `subscriptionStatus` (e.g. "canceled") after the webhook.

### Variations

- Free account with no customer: button absent entirely.
- Cancelled plan: tag shows e.g. "developer · canceled"; writes may be refused with "Your subscription needs attention before new writes can be accepted." (for statuses not active/trialing/canceled/incomplete_expired).

### Edge Cases

- "A Stripe customer has not been created yet." conflict if portal is called before any checkout.
- No in-app text explains that cancel is only through the portal.
- Account deletion is not a downgrade (settings page copy says so) and billing page does not link to it.

## STORY-009: Review last month's usage and export CSV

**Type**: medium
**Topic**: Usage, billing and plan changes
**Persona**: Sam Brooks, bookkeeper reconciling the October Stripe invoice
**Goal**: Export per-agent usage for October
**Preconditions**: At least one past period with statements
**Ideal path**: 3 — pick period, Download CSV
**Alternate paths**: none found (Stripe invoice from the portal has totals but not per-agent)

### Steps

1. Open `/console/billing`, scroll to "Usage by agent" → Heading with "{Month} · UTC calendar month".
2. Open "Export period" select → Options "Current month" and past months (e.g. "October 2026").
3. Choose "October 2026" → Table still shows the CURRENT month (the table renders `billing.agents`, only the CSV uses the chosen statement). Sam is confused.
4. Click "Download CSV" → File `agent-drive-usage-2026-10.csv` with columns period_start, period_end, agent_id, agent_name, retained_storage_bytes, observed_egress_bytes, successful_api_operations, egress_log_source ("provider does not charge egress").
5. Open CSV → Agent name raw `__console__` here, whereas UI shows "Console".

### Variations

- No past periods: select has only "Current month".

### Edge Cases

- Free-looking dollar totals are absent from CSV (bytes and ops only).
- Agent names starting with `=`, `+`, `@`, `-` are prefixed with `'` in CSV.
- With no agents, caption "Agent usage will appear after your first operation."

## STORY-010: Billing page with checkout disabled or load failure

**Type**: short
**Topic**: Usage, billing and plan changes
**Persona**: Leo Park, self-hosting evaluator with no Stripe keys
**Goal**: Understand why he cannot upgrade
**Preconditions**: Free plan, Stripe prices not configured; or API failing
**Ideal path**: 1 — read the banner
**Alternate paths**: none found

### Steps

1. Open `/console/billing` → Banner "Paid checkout is not enabled. Stripe prices, metering and overage rates must be configured first. You can keep using the Free plan."
2. Try "Choose developer" → Disabled.
3. Hover/ask for why → No tooltip; only banner. Overage rates card absent (no `checkoutRates`).

### Variations

- Network failure: alert "Billing could not be loaded." with "Refresh"; the page body stays empty.
- Paid account later loses configuration: "Contact your workspace operator to restore payment setup."

### Edge Cases

- Server-side `POST /checkout` would answer "Paid checkout is not configured." if the button were bypassed.
- "Need a custom enterprise plan? Contact your workspace operator." has no contact link.

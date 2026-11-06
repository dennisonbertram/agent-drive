# Topic: Billing, usage and limits

Code read: console Usage tab (`console.tsx`), `/console/billing` (`billing-client.tsx`, `page.tsx`), `/pricing` (`page.tsx`), `src/billing/ledger.ts` (enforcement and error text), `src/api/errors.ts`, `packages/agent-drive/src/mcp.ts` (error mapping).

Facts used below: Usage tab has stat cards ENCRYPTED STORAGE, API OPERATIONS, and EGRESS & COST with a "Billing & limits" link, then "Storage by drive" (progress bar only when a per-drive quota is set; default drive quota is unlimited, shown as "account limits apply") and "Usage by author". Billing page banner when checkout is off: "Paid checkout is not enabled. Stripe prices, metering and overage rates must be configured first. You can keep using the Free plan." and paid buttons are disabled. Pricing page when off: "Paid checkout is not enabled on this deployment..." and paid cards show a disabled "Coming soon" button. Spend cap field: "Monthly write cap (USD)", "Alert when spend reaches (USD)", "Alert email", button "Save spending controls", success "Spending controls saved."; invalid input "Enter a dollar amount with at most two decimal places."; above $10,000,000 "The maximum limit is $10,000,000." Limit errors are HTTP 402 payment_required with messages like "Your plan allowance would be exceeded. Upgrade or enable configured overage billing.", "Your monthly write spend cap has been reached. Existing files remain readable.", "Your monthly download allowance has been reached.", "Your monthly API operation allowance has been reached."; per-key rate limit is 429 "This API key has reached its request limit. Retry shortly." (default 600 per minute).

## STORY-072: Check usage after a heavy week

**Type**: short
**Topic**: Billing, usage and limits
**Persona**: Mara Okafor, a solo developer whose agents have been syncing logs and who wants to know if she is near the Free limits.
**Goal**: See how much storage and how many operations she has used.
**Preconditions**: Free plan, two drives, several agents.
**Ideal path**: 2 — open the Usage view and read it.
**Alternate paths**: /console/billing shows storage vs included allowance ("5.0 GiB included · 2 drives"); the same number appears in both places.

### Steps

1. Open /console, click "Usage" → stat cards: ENCRYPTED STORAGE (e.g. 3.2 GiB, "All committed versions, including trash"), API OPERATIONS ("Successful operations this calendar month"), EGRESS & COST with a "Billing & limits" button.
2. Scroll to "Storage by drive" → bars/rows per drive with "N live files · M stored versions"; no allowance of the plan is shown on this tab (gap: she must go to Billing to learn that 5 GiB is the limit).
3. Scroll to "Usage by author" → rows for each agent and "Console"; columns AGENT, STORAGE, VERSIONS, OPERATIONS.
4. Click "Billing & limits" → /console/billing opens with the same storage figure plus the included amount.

### Variations

- Fresh account: "No storage used yet."
- She expects to see downloads on the Usage tab; the card only says "EGRESS & COST" and sends her to another page (gap).

### Edge Cases

- Storage number includes trash, so deleting files to "free space" does not reduce it (explained only in small grey text).
- Billing page also has "Usage by agent" with different columns (RETAINED STORAGE, OBSERVED DOWNLOADS, OPERATIONS): the same data shown on two surfaces under two names ("Usage by author" vs "Usage by agent").

## STORY-073: A prospect reads pricing with checkout not configured

**Type**: short
**Topic**: Billing, usage and limits
**Persona**: Noor Hassan, evaluating Agent Drive for a team, on a self-hosted deployment without Stripe.
**Goal**: Find out what the paid plans cost and subscribe.
**Preconditions**: Signed out; deployment has no Stripe rates or checkout.
**Ideal path**: 2 — read pricing, click a paid plan.
**Alternate paths**: /console/billing when signed in shows the same limitation.

### Steps

1. Open /pricing → heading "A home for every agent."; status banner "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans."
2. Read cards: free $0.00, developer $20.00, team $200.00, each with drives, stored ciphertext, downloads, API operations.
3. Click "Coming soon" on Developer → nothing happens (disabled button).
4. Scroll to "Additional usage on paid plans" → "Overage rates have not been published for this deployment. Paid checkout stays disabled until billing is fully configured."
5. Click "Start with Free" → /sign-up.

### Variations

- With billing configured: banner absent, buttons read "Choose Developer" / "Choose Team" and link to /console/billing (she must sign in first and then pick the plan again: two surfaces for one decision).
- S3_EGRESS_METERING=none: downloads line and rate show "Not charged".

### Edge Cases

- Plan names show in lowercase on the cards ("free", "developer", "team") because they come straight from the plan keys.
- Banner says to the visitor that the "paid prices ... describe the supported plans" yet no way to buy them exists (dead end).

## STORY-074: Upgrade from Free to Developer through Stripe

**Type**: long
**Topic**: Billing, usage and limits
**Persona**: Dev Patel, whose agent just got "Your plan allowance would be exceeded" and who is ready to pay $20.
**Goal**: Move to the Developer plan and keep writing.
**Preconditions**: Free plan at the limit; checkout and rates configured.
**Ideal path**: 3 — click Choose developer, complete card form, return.
**Alternate paths**: Pricing page card "Choose Developer" leads to the same billing page.

### Steps

1. Console sidebar "Billing & limits" → heading "Billing & limits", cards: current-month estimate, RETAINED STORAGE, OBSERVED DOWNLOADS; tag "free · no card required".
2. Scroll to "A plan for your agents" → three plans; Free reads "Current plan" disabled, developer "Choose developer", team "Choose team".
3. Click "Choose developer" → page working; browser navigates to checkout.stripe.com (URL is checked: only checkout.stripe.com or billing.stripe.com over https are allowed).
4. Pay in Stripe; return to /console/billing → tag now shows "developer · active", button "Current plan", free shows "Included by default".
5. Open "Configured overage rates" → per extra drive, per GiB, per 1,000 operations.
6. Agent retries the write → succeeds.

### Variations

- Payment fails later: the plan stays, writes are refused with "Your subscription needs attention before new writes can be accepted."; the banner text says contact the operator to restore payment setup when checkout is not configured.
- Already paid: button reads "Change to team" with a confirm "Change to team? Stripe will prorate the base-plan change on your next invoice. Your existing spending cap stays in place." then notice "Plan updated. Stripe will apply prorations on your next invoice."
- "Invoices & payment details" (top right) opens the Stripe portal; it appears only if a Stripe customer exists.

### Edge Cases

- Provider returns an unexpected URL → error "The payment provider returned an unexpected URL."
- No downgrade path is offered for Free ("Included by default" disabled); downgrading is via the Stripe portal only.
- The estimate says "Excludes tax", and the page repeats several disclaimers about delayed transfer logs.

## STORY-075: Set a monthly spend cap and an alert

**Type**: medium
**Topic**: Billing, usage and limits
**Persona**: Hana Ito, a team lead who fears a runaway agent loop on the Developer plan.
**Goal**: Stop writes at $50 and get an email at $30.
**Preconditions**: Developer plan active.
**Ideal path**: 2 — type two amounts and the email, save.
**Alternate paths**: none found (no CLI or API for humans other than PATCH /api/console/billing/settings).

### Steps

1. Open /console/billing, scroll to "Boundaries, not surprises." → explanation "A write cap stops new uploads and other file writes once your estimated monthly spend reaches it. Existing files remain readable within your download allowance."
2. Type `50` in "Monthly write cap (USD)", `30` in "Alert when spend reaches (USD)", `hana@example.com` in "Alert email".
3. Click "Save spending controls" → button shows "Working…", then notice "Spending controls saved."
4. Reload → fields show 50.00 and 30.00.

### Variations

- She types `$50` → "Enter a dollar amount with at most two decimal places."
- She types `50.123` → same error.
- She types `0` → the help text says a zero cap blocks new writes immediately; she did not mean that and must clear it.
- Email delivery off: caption "Email delivery is not configured. You can save a threshold, but alerts will remain queued until delivery is enabled."

### Edge Cases

- Blank field means no cap; clearing both and saving removes them.
- The caption says the cap is not a guaranteed invoice ceiling (reads continue, logs arrive late).
- A cap lower than the base fee blocks all writes right away (estimate includes the plan's base fee).

## STORY-076: Agent hits the spend cap and tells the human

**Type**: long
**Topic**: Billing, usage and limits
**Persona**: Tomas Berg's agent "trace-bot", uploading /inbox/trace-bot/2026-11-05.jsonl when the monthly cap is reached.
**Goal**: Understand the failure, still read earlier files, and get the human to raise the cap.
**Preconditions**: Spend cap reached; agent has write scope.
**Ideal path**: 3 — see the cap message, tell the human, human raises the cap.
**Alternate paths**: Human can wait for the next UTC month.

### Steps

1. `agent-drive put ./2026-11-05.jsonl /inbox/trace-bot/2026-11-05.jsonl` → fails with an error whose server message is "Your monthly write spend cap has been reached. Existing files remain readable." (HTTP 402, code payment_required).
2. Agent runs `agent-drive get /inbox/trace-bot/2026-11-04.jsonl --output ./old.jsonl` → works.
3. Agent tells the human which page to open; human goes to /console/billing → "Monthly write cap (USD)" field shows 50.00.
4. Human changes to `100`, clicks "Save spending controls" → "Spending controls saved."
5. Agent retries `put` → success.

### Variations

- Through MCP, the tool error text for payment_required is the generic "The account requires a billing plan or payment action." which does not say it is the spend cap (gap).
- On the Free plan the message differs: "Your plan allowance would be exceeded. Upgrade or enable configured overage billing."

### Edge Cases

- The Usage tab and the console never show a "cap reached" indicator (gap): the human only learns from the agent's report.
- Drive creation also counts as a write: creating a drive under the cap fails the same way.

## STORY-077: Free account hits download and operation limits

**Type**: medium
**Topic**: Billing, usage and limits
**Persona**: Luis Romero, running a backup restore that fetches many files from a Free account.
**Goal**: Understand why `get` and `share` start failing.
**Preconditions**: Free plan, near 5 GiB downloads or 1M operations.
**Ideal path**: 2 — read the error, open Billing.
**Alternate paths**: Console Download button for files draws on the same monthly download allowance.

### Steps

1. `agent-drive get /backups/db.tar --output db.tar` → error "Your monthly download allowance has been reached." (402).
2. Opens /console/billing → card OBSERVED DOWNLOADS shows e.g. "4.9 GiB" or "Not connected", line "N GiB authorized this month".
3. Notes confusion: authorized vs observed differ; small text explains "Authorizations are not charges."
4. Next call fails with "Your monthly API operation allowance has been reached." for any other command.

### Variations

- Paid plan with active subscription and configured rates keeps working past allowances and bills overage.
- With S3_EGRESS_METERING=none, downloads show "Not metered — provider does not charge egress" and the download allowance is not enforced on cost (message still fires based on authorizations).

### Edge Cases

- A burst of requests triggers a different message: "This API key has reached its request limit. Retry shortly." (429 with retry-after), unrelated to billing.
- The limit message does not say how to fix it from the CLI; the agent must relay "upgrade" to the human.

## STORY-078: Export a past month's usage as CSV

**Type**: medium
**Topic**: Billing, usage and limits
**Persona**: Priya Nair, preparing an expense note for October.
**Goal**: Download per-agent usage for last month.
**Preconditions**: At least one earlier statement period.
**Ideal path**: 3 — pick the period, click Download CSV, open it.
**Alternate paths**: none found.

### Steps

1. /console/billing → scroll to "Usage by agent" with "Export period" select defaulting to "Current month".
2. Choose "October 2026" → select updates; the table shown still describes the current month until she downloads (the table is bound to the current period only; the chosen statement is used only for the CSV) (gap: the table does not change).
3. Click "Download CSV" → file `agent-drive-usage-2026-10.csv` with columns period_start, period_end, agent_id, agent_name, retained_storage_bytes, observed_egress_bytes, successful_api_operations, egress_log_source.

### Variations

- Agent named with a leading `=` is prefixed with an apostrophe in the CSV to avoid spreadsheet formulas.
- No agents yet: caption "Agent usage will appear after your first operation."

### Edge Cases

- Console writes appear as "Console" in the table but as `__console__` in the CSV.
- Footnote: per-agent breakdown is not an allocation of charges.

## STORY-079: Billing page fails to load or the session expires

**Type**: short
**Topic**: Billing, usage and limits
**Persona**: Noor Hassan, returning to billing after a long day.
**Goal**: Reach billing details; recover from errors.
**Preconditions**: Signed in; session expired or API down.
**Ideal path**: 1 — sign in again.
**Alternate paths**: none found.

### Steps

1. Open /console/billing with an expired session → server redirect to /sign-in.
2. If the session expires while the page is open and she clicks Save → browser goes to /sign-in with message "Sign in to manage billing." not shown (redirect happens).
3. If the API errors → red banner (alert) with message and a "Refresh" button; clicking retries loading.

### Variations

- Loading state: "Loading your billing details…"
- Stripe portal button "Invoices & payment details" hidden for accounts that never paid.

### Edge Cases

- After sign-in she lands on /console, not back on billing (redirect target not preserved from this page; only /connect preserves its destination) (gap, not verified in a browser).
- Console navigation to billing is a full page change from the sidebar link, so the active tab selection and unlocked drive key (page memory) are lost when she returns (gap).

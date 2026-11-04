# STORY-080: Upgrade from Free to Developer (with STORY-082 variation)

Verdict: **acceptable** (leaning convoluted on the billing screen itself, but the journey has only one extra hop).
Steps: actual 5 from /pricing or the console, ideal 3 (catalog Ideal path, `docs/ux-paths/catalog.md` line ~2121: "click Choose developer, pay on Stripe, land back on billing").

Evidence key: [M] measured in a live screenshot in `docs/ux-flow/screens/` or in code; [S] suspected, not observed. The Stripe checkout and the return trip were not exercised, so everything after "Choose developer" is from the catalog and code only [S].

## Friction Scorecard

| Measure                  | Finding                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps vs ideal           | From /pricing: (1) click "Manage your plan" on Developer, (2) scroll past three stat cards to the plan cards, (3) click "Choose developer", (4) pay on Stripe, (5) return to billing. Ideal is 3. The extra steps are the hub hop and the scroll.                                    | [M] 01-pricing.jpg; `pricing/page.tsx:77-79` (non-free CTA links to `/console/billing`); 07-billing-top.jpg (the Developer button is cut off at the bottom edge, below the fold). |
| Steps from the Usage tab | Usage -> "Billing & limits" -> scroll -> Choose developer -> Stripe -> return. Same count, 5.                                                                                                                                                                                        | [M] 05-console-usage.jpg                                                                                                                                                          |
| Decisions                | Plan choice (real). Team vs Developer is also offered, which is fine. Spending cap, alert threshold, alert email are shown above/near the upgrade action but nobody needs them before paying.                                                                                        | [M] 08-billing-controls.jpg                                                                                                                                                       |
| Re-entry                 | None found. The signed-in user is not asked for anything the app knows. Stripe collects email and card, which is unavoidable.                                                                                                                                                        | [S] catalog steps 1-3                                                                                                                                                             |
| Confirmations            | None before checkout from Free (confirm only shows when the plan is not free). That is correct: checkout is itself the confirmation.                                                                                                                                                 | `billing-client.tsx:209` (confirm only in change-plan path)                                                                                                                       |
| Dead ends                | Pricing page gives a signed-in Free user no direct upgrade (the CTA is a hub link). After a slow webhook the user must find "Refresh" by hand; the catalog notes a ~23 hour ambiguous-recovery state that tells the human to "reconcile manually". Declined card: app shows nothing. | catalog STORY-080 Variations/Edge Cases [S]; `billing-client.tsx:291` Refresh button [M]                                                                                          |
| Hesitations              | (a) "Manage your plan" on a plan you do not have. (b) "Observed downloads: Not metered..." giant headline makes a nervous buyer wonder what is broken. (c) The same plan cards on /pricing and billing make users wonder if one is stale.                                            | [M] 01-pricing.jpg, 07-billing-top.jpg                                                                                                                                            |

## Take-away Pass (per screen)

### /pricing (01-pricing.jpg)

- Keep: three plan cards, rates table, "Start with Free". This is the right place for comparison.
- Fix: both paid buttons say "Manage your plan". On Pricing there is nothing to manage yet. Signed-out visitors also get this label (`pricing/page.tsx:79` shows the same text regardless of state) [M].
- Fix: "Team lists 1024 GiB stored ciphertext" here, but "1.0 TiB encrypted storage" on billing. Same limit, two units and two names [M: 01-pricing.jpg vs 07-billing-top.jpg].
- Nothing else to remove.

### Console Usage tab (05-console-usage.jpg)

- Remove or merge: the "EGRESS & COST" card holds only a "Billing & limits" button plus a two-line caption. It is a card that is really a link, and it is visually cramped (button and text sit side by side) [M]. The sidebar already has "Billing & limits" [M], so this is a second route to the same page (heuristic 13). Replace with a real number (estimated cost this month) that links through, or delete it.
- Units mismatch: Usage shows "3.8 MB"; Billing shows "3.8 MiB" for the same figure [M]. Pick one (the billing limits are in GiB, so use MiB/GiB everywhere).
- The Usage "Storage by drive" row says "3.8 MB · account limits apply", which repeats the card above it.

### /console/billing top (07-billing-top.jpg)

- Biggest issue, hierarchy: "Not metered — provider does not charge egress" is set as a 3-line headline, the largest text on the page, for something the user cannot act on and which is a non-event [M]. Make the headline "6.6 MiB" (the real number sits in small print under it) with "Downloads are not charged" as the caption.
- Duplicate: "A plan for your agents" repeats the /pricing cards (same features, slightly different wording: "5.0 GiB encrypted storage" vs "5 GiB stored ciphertext") [M]. On billing the user needs: current plan, the one best upgrade, and the price. Not three full cards of feature bullets.
- "Retained storage 3.8 MiB, 5.0 GiB included · 1 drives": "1 drives" is a plural bug [M].
- Missing: no sidebar. The page uses "Back to workspace" instead of the console nav [M], so the user has left the console to upgrade and has to find the way back; the same page is a sidebar item in the console [M 05-console-usage.jpg]. Inconsistent.

### /console/billing lower (08, 09)

- "Configured overage rates" paragraph restates what /pricing's "Additional usage on paid plans" table says, and is labelled "Paid plans only" while the user is on Free [M 08-billing-controls.jpg]. For a Free user considering upgrade it is relevant; for the upgrade itself it is noise. Collapse it into the upgrade card as one line ("Beyond the plan: $2/drive, $0.05/GiB stored").
- "Boundaries, not surprises." section: four controls and a paragraph, large and visually loud (second-largest headline on the page), shown to a Free user who cannot be charged overage ("Free accounts stop at their included allowances" per /pricing) [M 01-pricing.jpg]. Collapse behind a "Spending controls" disclosure, or show only after the user has a paid plan. [S: whether Free users can usefully use caps; the page itself says a cap only reduces spend.]
- "Email delivery is not configured. You can save a threshold, but alerts will remain queued until delivery is enabled." is operator-facing and tells an ordinary user they are saving something that does nothing [M 09-billing-controls-2.jpg]. Hide the Alert email fields when delivery is off, or say "Email alerts are not available yet."
- "Email me at (USD)" is a threshold label that reads like a sentence fragment; "Alert me when spend reaches (USD)" is clearer.
- "Usage by agent" with Export period + Download CSV: legitimate, but it is a different job (statements, STORY-086) sitting below the upgrade. Fine as the last section.

## The Simpler Version

1. On /pricing, the Developer card button says "Upgrade to Developer" and Team says "Upgrade to Team" (signed-in) or "Sign in to upgrade" (signed-out). Free keeps "Start with Free".
2. That button goes straight to Stripe Checkout (or to `/console/billing?upgrade=developer`, which starts checkout immediately). No hub screen, no scroll.
3. Pay on Stripe, return to billing with a banner: "You are on Developer. Writes will work again." The page shows the new plan and refreshes itself until the webhook lands (instead of a manual Refresh button).

Concrete changes, smallest first:

- Rename pricing CTAs per plan and state (`pricing/page.tsx:77-79`).
- Delete the "EGRESS & COST" card's button-only content or give it a number (Usage page).
- Make the "Not metered" card a normal-size number card.
- On billing for Free users: replace the three plan cards with one "Upgrade to Developer, $20/month" panel (include "Compare plans" link to /pricing); keep full cards only for paid users changing plan (STORY-081).
- Use the console sidebar on billing instead of "Back to workspace".
- Collapse "Configured overage rates" and "Boundaries, not surprises" into a closed "Spending controls" section.
- Standardise units (MiB/GiB, not MB or TiB/"1024 GiB") and fix "1 drives".

## STORY-082 variation (agent hits Free limit)

Catalog Ideal is 5: read Upgrade URL, open it, choose developer, pay, re-run put. Actual path is the same plus the scroll noted above [S, from catalog]. Notes:

- The CLI prints `Upgrade: <origin>/console/billing`, which lands on the long billing page with the three stat cards first. The user arrives with one goal (unblock the agent) and sees a headline about egress. If the Upgrade URL pointed to `/console/billing?upgrade=developer`, or the page led with "Your storage is at 4.9 of 5.0 GiB. Upgrade to Developer ($20/month, 100 GiB)", this would be 3 steps for Jordan [S].
- The catalog's step 3 (Jordan deletes files first; Trash still counts) shows the page does not say why storage does not drop. The caption "All versions count, including trash" is present [M 07-billing-top.jpg] but tiny; it matters most when the user is at the limit, so show it only then, next to the upgrade button.

## Clarity Issues

1. "Manage your plan" on Pricing, for a plan the user does not have (and for signed-out visitors) [M 01-pricing.jpg; `pricing/page.tsx:79`]. Use "Upgrade" / "Choose Developer".
2. Operator-facing copy shown to end users: "Email delivery is not configured..." [M 09-billing-controls-2.jpg]; "Need a custom enterprise plan? Contact your workspace operator." (who is the operator for a Personal workspace?) [M 08-billing-controls.jpg]; "Paid checkout is not enabled. Stripe prices, metering and overage rates must be configured" (`billing-client.tsx:351`) [code only, not seen live]. These describe deployment state, not user choices.
3. Unit and wording drift: "3.8 MB" vs "3.8 MiB"; "1024 GiB stored ciphertext" vs "1.0 TiB encrypted storage"; "5 GiB monthly downloads included" vs "download allowance" [M]. One concept, one name.
4. "Not metered — provider does not charge egress" plus "6.6 MiB authorized this month" and "Authorizations are not charges" asks a buyer to understand egress, authorization and metering to read a number [M 07-billing-top.jpg]. Plain version: "Downloads: 6.6 MiB this month. Free of charge."
5. Plan tag format "developer · active" (catalog step 4) is lowercase and reads as a status code [S; from catalog]. "Developer plan" is enough.
6. "Boundaries, not surprises." and "A plan for your agents" are slogans as section titles [M]. "Spending limits" and "Plans" say what the section is.

## Not verified

Stripe Checkout, return redirect, webhook delay, Refresh behavior, Team card state after upgrade, and the "Invoices & payment details" button were not observed in this pass.

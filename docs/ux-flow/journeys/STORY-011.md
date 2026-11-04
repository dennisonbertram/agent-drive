# STORY-011: Long evaluation, landing to pricing to sign-up

Verdict: **acceptable**. Steps actual 3 to 4 clicks on the direct route (Ideal 3), but the catalog's walk is 15 steps because of hesitation and a few dead ends.

Evidence: `screens/00-landing.jpg`, `screens/01-pricing.jpg` (live production, 2026-11-03), catalog STORY-011, and lead-measured sign-up page. Nothing here was re-measured by me; the screenshots are cropped at the fold, so below-fold claims are marked "suspected".

## Friction Scorecard

| Check                           | Finding                                                                                                                                                                                                                                                                                                                                                | Status                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Steps vs Ideal (3)              | Route: landing, "Pricing" nav, "Start with Free", sign-up = 3 clicks. Matches Ideal. The hero button "Create your workspace" is a 1-click shortcut (00-landing).                                                                                                                                                                                       | measured                                                    |
| Decisions a default could carry | Landing hero has two equal-looking-ish buttons, "Create your workspace" (green) and "Open console" (white). "Open console" is meaningless to an anonymous visitor (it only redirects to sign-in per catalog).                                                                                                                                          | measured (00-landing)                                       |
| Re-entry of known data          | None before Clerk.                                                                                                                                                                                                                                                                                                                                     | measured                                                    |
| Confirmations guarding nothing  | None.                                                                                                                                                                                                                                                                                                                                                  | measured                                                    |
| Dead ends / detours             | (a) Pricing page nav shows "Quickstart" + "Sign in" but no "Create account"; landing nav shows "Pricing" + "Sign in". A hesitating visitor who clicks "Sign in" by mistake gets a sign-in form (catalog step 12). (b) Catalog says no price on landing, so price needs a click (step 4-5). (c) Catalog: sign-in/sign-up pages have no link to pricing. | (a) measured from the two screenshots; (b),(c) from catalog |
| Hesitations                     | Pricing shows only "Manage your plan" on Developer and Team, for an anonymous visitor who has no plan to manage. This reads as a wrong label (01-pricing). Catalog step 6 also records a "Paid checkout is not enabled" banner that doesn't appear above the fold in today's screenshot; I can't tell if it was removed or is below.                   | measured (label); banner unknown                            |
| Trust gap                       | Hero says "Encrypted before it leaves their machine", but the lost-key warning ("we cannot recover lost keys") lives only deep on pricing (catalog step 9). A visitor learns the trade-off after choosing a plan.                                                                                                                                      | suspected, catalog step 9                                   |

## Take-away Pass

**00-landing**

- Hero: headline, one paragraph, 2 buttons, code block, 3 feature cards. The code block (`agent-drive put ./handoff.md /memory/handoff.md`) is the strongest proof for a developer; keep.
- "Open console" secondary button: removable for anonymous visitors; "Sign in" in the nav already does this. Fails take-away test (#8).
- The eyebrow "A WORKSPACE THAT OUTLIVES THE SESSION" repeats the hero idea (#12). Small cost; collapse into the paragraph or drop.
- One primary action: yes, green "Create your workspace" (#9 passes).

**01-pricing**

- Three cards, one green primary "Start with Free", two white "Manage your plan". The Developer card has a green outline, suggesting it is "recommended", while the loud filled button is on Free. Two competing signals (#9, #10).
- Every card repeats the identical last bullet "CLI, MCP, web console, and encrypted sharing" (01-pricing). It differentiates nothing; remove from the cards and say it once under the heading (#12).
- "5 GiB monthly downloads included" and "5 GiB stored ciphertext" sit adjacent with the same number and read as one limit; "ciphertext" is jargon (see Clarity).
- Price shows "$0.00" with trailing zeros; "$0" is lighter.
- The "Additional usage" table is below the fold and not needed to decide to start on Free. Progressive disclosure would put it behind "Paid plan overage".

## The Simpler Version

1. Landing: one primary "Create account" button, plus nav "Pricing" and "Sign in". Show "Free to start" under the button so a price is visible without a click (answers catalog step 4).
2. Clerk sign-up (email, or GitHub/Google).
3. Email code, then empty console.

Visitors who want to compare plans still use the nav "Pricing". Concrete changes:

- Drop "Open console" from the anonymous hero (or rename it "Sign in" and make it the nav link only).
- Put "Create account" in the pricing nav so every pricing visit has an exit to sign-up (today only the Free card has one).
- Anonymous visitors: relabel "Manage your plan" to "Start free, upgrade later" or disable with "Coming soon" (matches the "checkout not enabled" banner in the catalog).
- Move the "we cannot recover lost keys" line up next to "Client-side encryption on every plan" on pricing, so the trade-off is read before the signup.
- Drop the duplicated last bullet from each card.

## Clarity Issues

- "Workspace" (landing button "Create your workspace") vs "account" (Clerk: "Create your account") vs "Personal workspace / Operator console" (console sidebar, 02-console-files). The user created an account, got a "workspace", and is then asked to create a "drive". Three nouns for the first minute. (#14)
- "Ciphertext" in "5 GiB stored ciphertext" (01-pricing): say "5 GiB of encrypted storage".
- "Manage your plan" for a visitor with no plan (01-pricing).
- "Start small. Keep your keys." eyebrow plus "A home for every agent." headline: the eyebrow's "keep your keys" is the first hint of the recovery key responsibility, but it is not explained here.
- Landing "Their own drive" is good for the concept; keep.
- Inconsistent nav between landing ("Pricing") and pricing ("Quickstart"): the same slot changes meaning (00 vs 01 screenshots).

Functional bug, one line: catalog notes "Start with Free" and sign-in-by-mistake both end at sign-up, fine; no functional bug found.

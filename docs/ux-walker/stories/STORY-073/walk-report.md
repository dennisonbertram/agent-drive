# STORY-073: A prospect reads pricing with checkout not configured — walk report
Result: PASS on the story's expectations (copy and states match), with product findings about dead ends and deployment-operator wording shown to a prospect. Used a separate signed-out browser session (ux-walker-c-so) that never called /api/test-session. Environment note: Clerk is not configured locally, so /sign-up shows a message instead of a form; that is an environment limitation, not a product finding.

## Steps
1. /pricing (step-1-pricing.png): nav Pricing / llms.txt / Sign in / Open console; eyebrow "START SMALL. KEEP YOUR KEYS."; heading "A home for every agent."; banner "Paid checkout is not enabled on this deployment. The Free plan is available when sign-in and storage are configured; the paid prices below describe the supported plans." Geometry audit clean.
2. Plan cards: FREE $0.00, DEVELOPER $20.00, TEAM $200.00, each with drives, stored ciphertext, monthly downloads, API operations and a shared line "CLI, MCP, web console, and encrypted sharing". The cards have equal columns. Plan names are shown in capitals here, not the lowercase the story mentions (presentation differs from the catalog text).
3. Clicked "Coming soon" on Developer: nothing happens, no tooltip or message. The button is disabled with aria-describedby="pricing-availability" (the banner), which is good for screen readers but invisible to a sighted user at the button.
4. Scrolled to "How usage works" / "ADDITIONAL USAGE ON PAID PLANS" (step-4-usage-fine-print.png): "Overage rates have not been published for this deployment. Paid checkout stays disabled until billing is fully configured." Two columns, clean, three columns of "Private contents / Built around agents / Leave on your terms" below.
5. Clicked "Start with Free": /sign-up (step-5-signup.png) shows "Create your workspace" and "Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance to enable human access." The card has no link back to pricing or home other than the small logo above it.
6. Mobile 390x844 (mobile-check.png): nav fits on one line, banner wraps to 4 lines, cards stack, no overflow. (The Next.js dev badge overlapping the "$20.00" is a dev-mode artifact.)

## Look pass
- The same fact ("paid checkout is not enabled/disabled") is stated three times: the banner, the "Coming soon" buttons and the "Additional usage" panel.
- The banner speaks to the operator ("when sign-in and storage are configured", "Stripe", "this deployment"), not to a prospect evaluating the service.
- The dead end described in the story is real: prices are shown for plans that cannot be bought and there is no contact or waitlist path for Developer or Team.

## Flow log
- Ideal path 2 (read pricing, click a paid plan): the paid plan click is a dead end by design. A prospect reaches the free path in 1 click, then a dead end at /sign-up in this environment.
- No data re-entry. Hesitations: whether "Coming soon" means checkout opens soon or whether this deployment is not hosted.

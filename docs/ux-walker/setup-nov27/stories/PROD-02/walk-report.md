# Walk report PROD-02: Pricing page and plan choice

Story reference: SETUP-002. Target: https://agentdrive.xyz release 0.5.1, signed out, viewport 1280x800 plus one 390x844 check. Session uxw-prod-public.

Status: partial. Pricing is clear and renders cleanly at both sizes; Start with Free goes to /sign-up. Landing/pricing downloads mismatch (F-PROD-01-1) and generic sign-in after Choose Developer (F-PROD-01-8).

## Steps

1. Action: Open /pricing
   Screenshot: step-1.png
   Shows: Heading 'A home for every agent.', three cards Free $0.00, Developer $20.00, Team $200.00; Start with Free is the one filled primary, others outlined. Geometry clean.

2. Action: Scroll full page
   Screenshot: step-2-full.png
   Shows: How usage works, additional usage prices, three principles, footer with only 'Contact' (no Docs/Terms/Privacy links). Text says 'Downloads not charged', which contradicts the landing table.

3. Action: Mobile 390x844
   Screenshot: step-3-mobile.png
   Shows: Cards stack, no horizontal overflow (0). Clean.

4. Action: Visit /console/billing signed out (target of Choose Developer / Choose Team)
   Screenshot: step-4-choose-dev-signedout.png
   Shows: Redirects to /sign-in?redirect_url=https%3A%2F%2Fagentdrive.xyz%2Fconsole%2Fbilling. Return path is kept. Form is generic, 'Welcome back!'. Not submitted.

## Findings

- F-PROD-01-1 (medium): Landing plan table and /pricing disagree on downloads.

## Flow Log

Ideal 3 (Pricing, read, Start with Free); needed 3. Paid choice adds a sign-in with no context. Duplicated info: plan facts on landing and pricing with a conflict.

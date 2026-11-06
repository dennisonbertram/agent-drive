# C01-C Convention: Vercel / Linear / GitHub header with a hamburger sheet

## What the category does
- **Vercel, Linear, Stripe, GitHub:** desktop header is brand, a short centre nav, then right-aligned "Log in" (text) and one filled "Sign up". On phones the nav collapses to a menu button; the filled "Sign up" usually stays visible beside it (GitHub, Linear) and the menu opens a full-width sheet of large rows with Log in and Sign up at the bottom.
- **Dropbox, Box, Google Drive:** auth pages carry a footer line "Don't have an account? Sign up" and a link back to the marketing site; pricing pages repeat the same header as the home page.
- **Clerk's own components** (used here) ship a "Don't have an account? Sign up" footer by default.

## Change
Same shared `SiteHeader` as proposal A (Docs, Pricing, Sign in, orange "Sign up free"), but on phones use the platform convention: brand, orange "Sign up free", and a hamburger icon button that opens a full-width sheet (`<dialog>` or an existing `Dialog`-style pattern) with 56 px rows: Docs, Pricing, Sign in. Sheet closes on Escape, link tap and the close button, and traps focus. On the auth pages rely on Clerk's built-in footer link (`signUpUrl`/`signInUrl` are already passed; `appearance.ts` does not hide it, but the audit never rendered the real Clerk card, so this is unverified) and add "Pricing" and "Docs" links below the card. On the pricing page the Free plan card button reads "Start with Free" and links to `/sign-up` (GitHub/Vercel pricing pattern), alongside the header button.

## Files and tokens
- `site-header.tsx` (shared) plus a small client component for the sheet (needs state and focus handling; the console already has a `Dialog` in `console.tsx` lines 203-250 to copy the focus behaviour from; extracting it to a shared component is the right move but adds scope).
- both auth pages, `(app)/pricing/page.tsx` plan card.
- Tokens: `--sig`, `--line-strong`, `--paper-2` for sheet rows; icon button 44x44.

## Effort
M. A client component, focus handling and a Clerk theme change are all new surface area.

## Risks
- Hamburger hides Docs/Pricing behind a tap; analytics from similar products show menu use is low, but for this product Pricing is secondary to the signup button anyway.
- Clerk footer behaviour is unverified until a Clerk-configured run (problems.md open item 1). If Clerk's footer does not appear, fall back to proposal A's line.
- A focus-trapping sheet is the most code of the three; bugs here are accessibility bugs.

## Acceptance criteria
1. Same shared component on / and /pricing. Met.
2. One orange "Sign up free", "Sign in" text, no Console signed out, Docs once. Met.
3. At 390 Sign up free is inline; the sheet exposes Docs, Pricing, Sign in with 56 px rows after one tap on the menu button. Met (menu is "menu button" form).
4. One click to sign up from the first viewport at all widths. Met.
5. Auth cross-links through Clerk's footer plus an added Pricing/Docs row. Met if Clerk footer renders; otherwise add the line from A.
6. Final CTA gets "Create a free account" beside Copy. Met (same as A).

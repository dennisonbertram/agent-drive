# C01-B Restructure: shared page shell with a two-row phone header and an auth shell

## Change
Treat the public pages as one layout, not per-page markup. Add a route-group layout `(app)/(site)/layout.tsx` (or a `SiteShell` component) that renders the header and footer once for `/`, `/pricing`, `/sign-in` and `/sign-up`. Pages stop rendering their own header. The auth pages then get the brand header and a footer with the cross-links for free, which also fixes A-4/A-6 (auth card floats in 11% of the viewport with nothing around it).

Header, signed out: brand left; centre-left links Docs, Pricing; right: "Sign in" text link and orange **Sign up free**.

Phones: no menu button, no JavaScript. The header wraps into two rows by design:
```
Row 1 (56 px):  [Agent Drive]                       [Sign up free]
Row 2 (44 px):  Docs       Pricing       Sign in          (equal thirds, 1px top rule)
```
Every item is visible immediately, every target is 44 px tall. Pricing's page-specific `aria-current` stays.

Signed-in visitors: Row 2 / right side shows Console (orange) and the account menu is not duplicated.

Landing hero: put a secondary "Create a free account" `l-btn` next to the first Copy panel as well as the final CTA, because the agent-first line (Copy) is the product's lead but humans need an obvious account path (ux-flow proposal 2).

Auth shell footer line: "New here? Create a free account · Already have an account? Sign in · Pricing · Docs" rendered in the shell, so Clerk's card needs no change.

## Files and tokens
- New `apps/web/app/(app)/(site)/layout.tsx` plus `site-header.tsx`, `site-footer.tsx`; move `page.tsx`, `pricing/`, `sign-in/`, `sign-up/` into the group (URLs unchanged). `/connect` and `/console` stay outside.
- Delete the landing and pricing header/footer markup and CSS (`.l-nav`, `.l-links`, `.l-footer nav`, `.billing-header`, `.billing-links`).
- Tokens only: `--line-strong`, `--line`, `--sig`, `--muted`; buttons use existing `.button.primary`.

## Effort
M (route moves, import path fixes, header/footer CSS, e2e selectors for the nav).

## Risks
- Moving folders touches every relative import (`'../../../brand-mark'`) and any test that references paths.
- Two-row header costs about 44 px more vertical space at 390; hero starts lower (hero already starts at 44 px padding, so the Copy panel stays inside 844 px).
- Landing has its own `--bg`, `--i` tokens (landing.css); the shared header must use the global tokens so the rule and ink colour match on both pages.

## Acceptance criteria
1. Single header and footer in one layout, so height and rule are identical by definition at 1440/768/390. Met.
2. One orange "Sign up free", "Sign in" text, no Console while signed out, Docs once. Met.
3. All five items visible at 390 without scrolling or a menu, 44 px targets. Met.
4. Sign up is one click from the first viewport everywhere, including the auth pages. Met.
5. Auth pages cross-link via the shell footer (and the header's Sign up/Sign in pair). Met.
6. Final CTA "Create a free account" beside Copy; also in the hero. Met.

# C01-A Minimal: one shared header, `<details>` menu on phones

## Change

Extract the header into one server component, `SiteHeader`, and render it on `/` and `/pricing`. It replaces `.l-nav` (landing) and `.billing-header` (pricing), which differ today in height (60 px both, but pricing wraps below 768 px), link set, and CTA style.

Items, left to right: brand, Docs (`/llms.txt`, once), Pricing, Sign in (text link), **Sign up free** (orange `.button.primary` style). Drop the duplicate `llms.txt` link and the "Console" / "Open console" links for signed-out visitors. Signed-in visitors see Console instead of Sign in + Sign up free (decided in the server component with the existing `consoleUserId()` from `src/console/auth.ts`; if Clerk is unconfigured it returns null and the signed-out header shows).

Phones (below 760 px): brand, then a visible **Sign up free** button, then a native `<details><summary>Menu</summary>` that lists Docs, Pricing, Sign in as 48 px rows. No JavaScript, no new dependency.

Auth pages: add one line under the Clerk card in `sign-in/page.tsx` and `sign-up/page.tsx`: "New here? Create a free account" / "Already have an account? Sign in", plus "Pricing" and "Docs" links. Final landing CTA: add a `l-btn` link "Create a free account" next to the existing Copy button.

## Before / after (ASCII)

```
Before 1440:  [Agent Drive]            Docs Pricing llms.txt Sign in Console
Before 390:   [Agent Drive]                                  (no nav at all)

After 1440:   [Agent Drive]            Docs  Pricing  Sign in  [Sign up free]
After 390:    [Agent Drive]            [Sign up free] [Menu v]
                                        +-----------------+
                                        | Docs            |  48 px rows
                                        | Pricing         |
                                        | Sign in         |
                                        +-----------------+
```

## Files and tokens

- New `apps/web/app/site-header.tsx` (server component, uses `BrandMark`, `Link`).
- Edit `(app)/page.tsx` lines 82-93 and `(app)/pricing/page.tsx` lines 34-46 to render it; remove footer duplicate `Docs`/`llms.txt` in `(app)/page.tsx` footer.
- CSS: one `.site-header` block in `globals.css` (tokens `--line-strong`, `--sig`, `--muted`, `--ink`); delete `.l-nav`, `.l-links`, `.billing-header`, `.billing-links*` and the 620 px `a[href='/llms.txt']{display:none}` rule.
- Edit the two auth pages and `(app)/page.tsx` final section (`.l-final`).

## Effort

S (about half a day). Delete more CSS than added.

## Risks

- `<details>` does not close on outside click; acceptable. The orange button and the menu both sit in a 390 px row: 130 + 80 px plus brand 130 px fits with 20 px gutters.
- Clerk's own card may already show a footer link to the other page (unverified, needs a Clerk-configured run, per problems.md A-5). The extra line may duplicate it. If so, keep ours and hide Clerk's footer in `appearance.ts`.
- Header needs request-time auth: `/` already uses `headers()` so it is dynamic; `/pricing` becomes dynamic too (loses static caching).

## Acceptance criteria

1. One component, one height (60 px), one border rule on both pages at every width. Met by construction.
2. Exactly one orange "Sign up free", text "Sign in", no Console when signed out, Docs once. Met.
3. At 390 the Sign up free button is visible, the menu holds Sign in/Docs/Pricing within one tap, all targets at least 44 px (set `min-height: 44px`). Met.
4. Sign up is one click from the first viewport at all widths. Met (orange button always visible).
5. Auth pages cross-link to each other plus Pricing/Docs via the added line. Met.
6. Final CTA gets "Create a free account" beside Copy. Met.

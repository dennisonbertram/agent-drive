# K3+K4 B Restructure: numbered two-step start, sticky header with a filled sign-up

## Change

Replace the hero's prompt panel, the "Free to start." line and the terminal line with one block called `StartSteps`. It shows the real onboarding order: the human gives the prompt to their agent, the agent shows a pairing code, and the human approves it, which requires an account. Sign-up becomes the filled button in step 2, where the human needs it. The final CTA reuses the same block. The header becomes sticky, with nav on the left and actions on the right.

**Hero / final CTA: `StartSteps` (new function in `page.tsx`, replaces `SetupPanel`)**

```
GET STARTED                       (optional tag; the mock omits it)
(1) Paste this into your agent
    Claude Code, Codex, OpenCode or any agent with a shell.
    [dark panel: > Set up Agent Drive: https://agentdrive.xyz/llms.txt   [Copy prompt]]
(2) Approve your agent
    It shows a pairing code. Approve it in your free account.
    [■ Sign up free]   Have an account? Sign in
Prefer a terminal?  npm install -g @dennisonbertram/agent-drive  [Copy]
```

- `<ol class="l-steps">` with two `<li class="l-step">`. Each is a 28 px circled number in a 28 px grid column, a 17 px/500 heading, a 14 px ink-2 subline, and a body in column 2.
- Step 1: the existing dark panel without its own tag. Copy is an outline button (`.l-btn` with a white border, transparent fill) with the caption "Copy prompt". It is full width under 760 px.
- Step 2: `<Link className="l-btn signal" href="/sign-up">Sign up free</Link>`, then "Have an account? <Link href="/sign-in">Sign in</Link>", an underlined text link with a 44 px min-height.
- The terminal line keeps `.l-cli`. The prefix changes from "or in a terminal:" to "Prefer a terminal?", and the chip is 44 px.
- New copy in `src/content/home.ts`: `START = { one: 'Paste this into your agent', oneSub: 'Claude Code, Codex, OpenCode or any agent with a shell.', two: 'Approve your agent', twoSub: 'It shows a pairing code. Approve it in your free account.' }`. Delete `HERO.next` and use `START` in the `/index.md` output.
- Final section: `<h2>Give your agent a drive.</h2><StartSteps …/>`. `.l-final-row` and the separate "Create a free account" button go away.

**Header (`site-header.tsx`, `site-header.css`)**

- Order: `BrandMark`, `nav` (Docs, Pricing) directly after the brand, then `.site-actions` with "Sign in" (a text link, hidden under 760 px), **Sign up free** (filled orange, 44 px), and the menu button.
- The menu button becomes a 44x44 icon button (three-line icon, `aria-label="Menu"`). It keeps the existing popover and the `aria-expanded` mirroring in `site-menu.tsx`.
- Phone menu: a sheet spanning the gutters, `inset: 60px 20px auto 20px`, with 48 px rows and hairline dividers. It lists Docs, Pricing, Sign in. Sign up free stays visible in the bar.
- Sticky at every width: `position: sticky; top: 0; z-index: 50`. Header height is 56 px under 760 px and 60 px above. Requires `.landing { overflow-x: clip }` instead of `hidden`; otherwise sticky does nothing on `/`.
- The wordmark is kept at 360 px. It fits: 16 + 10 + 104 + 8 + 111 + 8 + 44 = 301 px, inside 320. Delete the `@media (max-width: 360px)` block (H-27).

**Elsewhere: one name, targets, links**

- Pricing: "Start free" becomes "Sign up free" (filled `signal`), and the heading "Start free." becomes "Plans and limits." Footer `.sf-cta` and `AuthLinks` use "Sign up free".
- K4 rules as in proposal A, items 6 to 10: `.l-btn` min-height 44, `.l-copy` 44, one underlined text-link rule for `.l-also a`, `.feat > div > a` and `.l-pnote a`, 44 px footer rows, and a 44 px brand.

## Before / after

```
390 before                          390 after
[▣ Agent Drive] [Menu] [Sign up]    [▣ Agent Drive]   [■ Sign up free] [≡]   sticky
GIVE THIS TO YOUR AGENT             (1) Paste this into your agent
[■ Copy]                                [panel …  [□ Copy prompt]]
Free to start.                      (2) Approve your agent
or in a terminal: …                     [■ Sign up free]  Have an account? Sign in
                                    Prefer a terminal? npm … [COPY]
```

Mocks were rendered in Playwright Chromium 1.64 because headless Chrome could not render 390. Each #audit pass found 0 targets under 44 px and no horizontal overflow:

- 390x844: `<scratchpad>/uxv-home/mocks/K3-B-390.png`. Both steps and the step 2 button fit in the first 844 px.
- 390x844, menu open: `<scratchpad>/uxv-home/mocks/K3-B-390-menu.png`
- 360x780: `<scratchpad>/uxv-home/mocks/K3-B-360.png`
- 1440x900: `<scratchpad>/uxv-home/mocks/K3-B-1440.png`
- Source: `<scratchpad>/uxv-home/mocks/K3-B-hero.html`

## Files

- `apps/web/app/(app)/page.tsx`: `SetupPanel` becomes `StartSteps`. Update the hero and `.l-final` markup, and the pricing button label and heading.
- `apps/web/src/content/home.ts`: add `START`, remove `HERO.next`, and update the markdown template.
- `apps/web/app/styles/landing.css`: new `.l-steps`, `.l-step`, `.l-num`; remove `.l-next` and `.l-final-row`. Also `.landing { overflow-x: clip }` and the K4 rules.
- `apps/web/app/site-header.tsx`, `site-menu.tsx` (icon and label only), `styles/site-header.css`.
- `apps/web/app/site-footer.tsx`, `styles/site-footer.css`.
- Tests: `tests/e2e/landing.spec.ts`, which expects "Start free" and "Free to start.". `tests/e2e/site-header.spec.ts` line 29 expects one "Sign up free" link per page, which is now two on `/`, so scope it to the header. Lines 87, 114 and 135 expect "Create a free account", and line 139 expects the button "Copy agent instruction again". `tests/e2e/scaffold.spec.ts` line 24 expects "Copy agent instruction" (keep that `aria-label`).

## Effort

M, about one day: one new component, header markup, CSS, copy, and four test files.

## Risks

- **Two identical orange "Sign up free" buttons in the first phone screen** (header and step 2). They sit in separate regions, which is the same pattern Vercel and Supabase use, but a strict reader of "one filled per screen" could object. A fallback is to make the header button outline while the hero is in view, using an `IntersectionObserver` in `site-menu.tsx`. That adds JavaScript, so it is not proposed by default.
- Step 2 says sign-up comes after pasting. A human who signs up first still works, because the agent's code can be approved later, and the order on the page does not block them. Verify that the pairing screen accepts a human who signed up before the agent asked.
- The hero gets taller at 1440: the action block ends at about y = 810, compared with y = 690 today. The figure stays vertically centred. Check that this does not conflict with K2's page-length budget (about +120 px at 1440, about +60 px at 390).
- Requires `overflow-x: clip`, as in A.

## Acceptance criteria

| Criterion                                                    | How B meets it                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K3: exactly one filled primary per region, and it is sign-up | Header: Sign up free. Hero: Sign up free in step 2, with Copy as outline. Pricing: Free card only. Final: the same `StartSteps`. Met.                   |
| K3: agent prompt prominent but secondary or clearly labelled | It is step 1, with a numbered heading that names the agent and the agents it works with. It comes first in reading order but is an outline action. Met. |
| K3: header sticky on phones, "Sign up free" primary          | Sticky at all widths, filled orange, always visible next to the icon menu. Met in CSS; sticky scroll not observed in a running app.                     |
| K3: one name for sign-up                                     | "Sign up free" everywhere. "Have an account? Sign in" is the other action. Met.                                                                         |
| K4: every target ≥ 44 px at 390/360                          | The mock audit found 0 targets under 44 px in the header, hero and menu at both widths. The rest of the page relies on the A rules and is not verified. |
| K4: one link style per role                                  | Text links underlined (including "Sign in" in step 2). Nav links plain. Actions are `.l-btn`. Met.                                                      |
| K4: menu aligned to the gutter                               | The sheet spans x = 20 to 370 at 390, the same as content edges. Mock `K3-B-390-menu.png`. Met.                                                         |

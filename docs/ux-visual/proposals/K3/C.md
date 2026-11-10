# K3+K4 C Convention: sign-up button pair plus a tabbed install box

## What comparable developer-tool sites do

These patterns are recalled from those sites. They were **not re-checked live on 2026-11-09**, so confirm them before quoting them as current:

- **Vercel**: sticky header with an outline "Log In" and a filled "Sign Up". The hero has a filled primary and an outline secondary button side by side. The phone header keeps the filled sign-up and puts everything else behind a full-screen menu.
- **Supabase**: the header has an outline "Sign in" and a filled "Start your project". The hero repeats the same filled label next to a secondary button, so one name is used in both places.
- **Resend, Railway, Linear**: the hero has one filled "get started" button and one quiet secondary (docs or demo). Nothing else in the hero is filled.
- **Bun, Deno, uv**: the install command lives in a dark code box with a small copy icon, often with tabs for each install route. It is visually secondary to the sign-up or download button.

The common rule is that sign-up is the hero's filled primary, and the install or CLI path is a labelled code box beneath it with an icon copy button. Applied here, the "install route" tabs become **Your agent** and **Terminal**.

## Change

**Hero (`page.tsx`)**

- After the lede, add a button row (`.l-ctas`) with **Sign up free** (`l-btn signal`, 48 px, links to `/sign-up`) and **Read the docs** (`l-btn`, links to `/docs`). Under 760 px both buttons are equal width (`flex: 1 1 0`).
- Under the button row, add an install box (`.l-install`, dark, 10 px radius). It has two tabs, `YOUR AGENT` (default) and `TERMINAL`, 44 px tall with an orange 2 px underline on the selected tab. The body shows the command and a 44x44 icon copy button with `aria-label` "Copy agent prompt" or "Copy install command".
  - Build the tabs as a native radio group styled as tabs, with the body shown by `:has(input:checked)`. Arrow keys and focus work without JavaScript. Use `<fieldset>` and `<legend class="sr-only">Set up with</legend>`. Then `CopyButton` stays the only client component.
- Caption under the box: "Paste it into Claude Code, Codex or any agent. It shows a pairing code that you approve in your account." This replaces `HERO.next` and the separate `.l-cli` line, so the terminal command now lives in the Terminal tab.
- Final CTA: `<h2>Give your agent a drive.</h2>` followed by the same button row and install box. Delete `.l-final-row`.

**Header (`site-header.tsx`, `site-header.css`)**

- Desktop: brand, then Docs and Pricing next to it. On the right are **Sign in** (outline `.l-btn` look) and **Sign up free** (filled), following Vercel and Supabase.
- Phones: brand, **Sign up free** (filled), and a borderless 44x44 three-line icon button. The menu opens as a full-width white sheet below the header (`inset: 57px 0 0 0`, content padded 20 px). It has 52 px rows for Docs, Pricing and Sign in, and no second sign-up button. Body scroll locks while it is open (`:has(#site-nav:popover-open) { overflow: hidden }` on `html`).
- Sticky at all widths. Requires `.landing { overflow-x: clip }`.
- Wordmark kept at 360. Delete the `max-width: 360px` block.

**Elsewhere**: pricing "Start free" becomes "Sign up free" (filled), heading "Start free." becomes "Plans and limits.". Footer CTA and `AuthLinks` become "Sign up free". Apply the K4 rules from A, items 6 to 10.

## Before / after

```
1440 before                                   1440 after
Pricing Docs Sign in [□ Sign up free]         ▣ Agent Drive Docs Pricing     [□ Sign in] [■ Sign up free]
[dark panel … [■ Copy]]                       [■ Sign up free] [□ Read the docs]
Free to start.                                ┌ YOUR AGENT │ TERMINAL ───────────┐
or in a terminal: npm … [COPY]                │ > Set up Agent Drive: …     [⧉] │
                                              └──────────────────────────────────┘
                                              Paste it into Claude Code, Codex or any agent…
```

Mocks were rendered in Playwright Chromium 1.64 because headless Chrome could not render 390. Each #audit pass found 0 targets under 44 px and no horizontal overflow:

- 390x844: `<scratchpad>/uxv-home/mocks/K3-C-390.png`. Sign-up, docs, the install box and the caption all fit above y = 580.
- 390x844, menu open: `<scratchpad>/uxv-home/mocks/K3-C-390-menu.png`
- 360x780: `<scratchpad>/uxv-home/mocks/K3-C-360.png`. Code is 13 px on phones so the URL does not break mid-word.
- 1440x900: `<scratchpad>/uxv-home/mocks/K3-C-1440.png`
- Source: `<scratchpad>/uxv-home/mocks/K3-C-hero.html`

## Files

- `apps/web/app/(app)/page.tsx`: `SetupPanel` becomes `StartBlock` (button row, install box and caption). Update the hero, `.l-final` and pricing labels.
- `apps/web/src/content/home.ts`: replace `HERO.next` with `HERO.caption`, and update the markdown template so it still lists both setup routes.
- `apps/web/app/styles/landing.css`: new `.l-ctas`, `.l-install`, `.l-tabs`, `.l-icon-copy`; remove `.l-next`, `.l-cli`, `.l-cmd`, `.l-copy` and `.l-final-row`. Add `overflow-x: clip` and the K4 rules.
- `apps/web/app/(app)/copy-button.tsx`: allow children (an SVG icon) in place of `caption`. This is a small prop change.
- `apps/web/app/site-header.tsx`, `site-menu.tsx`, `styles/site-header.css`.
- `apps/web/app/site-footer.tsx`, `styles/site-footer.css`.
- Tests: same as B. `scaffold.spec.ts` looks up the button "Copy agent instruction", so keep that exact `aria-label` on the Your agent tab's copy button, not "Copy agent prompt" as in the mock.

## Effort

M, about one day. The tabs are the only new interaction, and they are CSS only.

## Risks

- **The agent path drops in priority.** The filled sign-up comes first, so a human may sign up and land in an empty console before giving the prompt to their agent. Check that the console's empty state shows the same prompt (`console.tsx` lines 242 and 1841 already render "Copy agent instruction", so it probably does).
- The terminal command is hidden behind a tab, one click deeper than today. Agents reading the page get it from `/index.md` and `llms.txt`, so the impact is limited to humans who prefer a CLI.
- An icon-only copy button is less clear than "Copy prompt". It needs a "Copied" state with visible text, and the existing `CopyButton` status text already does that.
- Two orange "Sign up free" buttons in the first phone screen, as in B.
- `:has()` needs Safari 15.4 or Firefox 121. Older browsers show both tab bodies, which still works.
- Requires `overflow-x: clip`, as in A.

## Acceptance criteria

| Criterion                                                    | How C meets it                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K3: exactly one filled primary per region, and it is sign-up | Header: Sign up free. Hero: Sign up free. "Read the docs" is outline, and copy is an outline icon button. Pricing: Free card only. Final: the same block. Met. |
| K3: agent prompt prominent but secondary or clearly labelled | It sits in a dark box directly under the buttons, on the default "Your agent" tab, with a caption explaining the pairing code. It is secondary. Met.           |
| K3: header sticky on phones, "Sign up free" primary          | Sticky, filled, always visible. Met in CSS; sticky scroll not observed in a running app.                                                                       |
| K3: one name for sign-up                                     | "Sign up free" everywhere. "Sign in" is the other action. Met.                                                                                                 |
| K4: every target ≥ 44 px at 390/360                          | The mock audit found 0 targets under 44 px in the header, hero, tabs and menu at both widths. The rest of the page relies on the A rules and is not verified.  |
| K4: one link style per role                                  | Text links underlined. Nav links plain. Actions are `.l-btn`. Tabs are their own role. Met.                                                                    |
| K4: menu aligned to the gutter                               | Full-width sheet whose rows start at x = 20 and end at 370, the same as content. Mock `K3-C-390-menu.png`. Met.                                                |

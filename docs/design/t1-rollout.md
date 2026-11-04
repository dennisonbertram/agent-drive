# T1 "Rack" design rollout

Reference mockup: `docs/design/t1-rack-reference.html` (approved by the user, 2026-11-04).
Design system: tokens and component styles in `apps/web/app/globals.css`; fonts in `apps/web/app/layout.tsx`.
Message: every agent gets its own portable drive. Encryption is small print only.

## Rules

- Tokens first: warm aluminium grey ground with faint dot grid, black ink, ONE signal orange for LEDs, readouts, primary actions. Space Grotesk (display/text) + IBM Plex Mono (labels, paths, codes) via `next/font/google`.
- Glass only as smoked windows on hardware objects and the nav; content (tables, forms, terminal) on solid surfaces.
- Reuse existing class names and markup; change styles in globals.css. Change TSX only where structure must change (e.g. the hero rack, drive bay strip). No new dependencies.
- Keep every behaviour, label used by tests, aria attribute and test id. Run the affected e2e spec after each wave.
- Real product facts only. No invented features or prices.

## Waves (one loop iteration each; mark [x] when merged into feat/t1-rack-design)

- [x] 0 Foundation (0bc98f1): tokens, fonts, body/dot grid, typography scale, buttons (primary/secondary/copy), badges, inputs/forms, focus ring, status LED primitive, eyebrow/labels, links
- [x] 1 Landing (8fdd038) (`app/(app)/page.tsx`): nav, brand, hero copy "Every agent gets a drive.", rack illustration (inline SVG/CSS), setup rows + copy, works-with, numbered callouts, footer
- [x] 2 (ffb0854) Console shell (`console.tsx`): sidebar → drive bay strip + section nav, topbar/breadcrumb, workspace, panels, files table (path/size/author/modified/actions), backup status line (LED + one line), empty/loading states
- [x] 3 (be0f3fd) Console secondary: agents, API keys, usage stats, trash, versions, dialogs (Load drive key, New drive), onboarding, privacy note, forms
- [x] 4 (acfbeef; Deny kept: existing product behaviour) Connect / approval (`connect.tsx`): device-pairing card, code on smoked display, one Approve button, revoke note; all its states (waiting, approved, expired, error)
- [x] 5 (746596b) Share page (`app/s/[id]`)
- [x] 6 (551a30a; Clerk widgets unseen locally) Pricing, billing, settings, sign-in/up (Clerk appearance variables)
- [ ] 7 /ux-visual audit across all surfaces and viewports; fix findings

Waves 1–6 run in parallel on branches t1/landing, t1/console-shell, t1/console-panels, t1/connect, t1/share, t1/account (see parallel-brief.md); the lead merges them here.

- Audit notes: pricing/billing use the old "a/ agent drive" brand mark (landing uses the new one); double rule under the pricing header.
- All waves merged at b4fbb02: typecheck, lint pass; Playwright e2e 10/10 pass.

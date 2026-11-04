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
- [ ] 0 Foundation: tokens, fonts, body/dot grid, typography scale, buttons (primary/secondary/copy), badges, inputs/forms, focus ring, status LED primitive, eyebrow/labels, links
- [ ] 1 Landing (`app/(app)/page.tsx`): nav, brand, hero copy "Every agent gets a drive.", rack illustration (inline SVG/CSS), setup rows + copy, works-with, numbered callouts, footer
- [ ] 2 Console shell (`console.tsx`): sidebar → drive bay strip + section nav, topbar/breadcrumb, workspace, panels, files table (path/size/author/modified/actions), backup status line (LED + one line), empty/loading states
- [ ] 3 Console secondary: agents, API keys, usage stats, trash, versions, dialogs (Load drive key, New drive), onboarding, privacy note, forms
- [ ] 4 Connect / approval (`connect.tsx`): device-pairing card, code on smoked display, one Approve button, revoke note; all its states (waiting, approved, expired, error)
- [ ] 5 Share page (`app/s/[id]`)
- [ ] 6 Pricing, billing, settings, sign-in/up (Clerk appearance variables)
- [ ] 7 /ux-visual audit across all surfaces and viewports; fix findings

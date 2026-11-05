# Parallel wave brief (shared by waves 1–6)

Approved direction: T1 "Rack" — read `docs/design/t1-rack-reference.html` (open in a browser and read its CSS) and `docs/design/t1-rollout.md` (rules). Message: every agent gets its own portable drive; encryption is small print only.

## Tokens (contract; wave 0 defines them on :root in parallel)

Use only these names, always with the fallback value so your page renders before wave 0 merges:
`var(--bg,#e9e8e4) var(--panel,#f3f2ee) var(--al1,#f4f3f0) var(--al2,#d6d4cf) var(--al3,#bdbab4) var(--ink,#121211) var(--muted,#5d5b56) var(--line,rgba(18,18,17,.16)) var(--line-soft,rgba(18,18,17,.09)) var(--sig,#ff5a1f) var(--sig-text,#ff7a45) var(--sig-dark,#b8400f) var(--smoke,#17160f) var(--sans,'Space Grotesk',system-ui,sans-serif) var(--mono,'IBM Plex Mono',ui-monospace,Menlo,monospace)`.
Signal orange only for LEDs, readouts and primary actions; black text on orange. Small orange text on light uses --sig-dark.
Do NOT edit `:root`, base element rules, generic buttons/badges/forms/eyebrow, or `app/layout.tsx` — wave 0 owns those. If your area needs a primitive (e.g. a status LED), define a local class in your own file.

## How to avoid conflicts

- Create your own stylesheet `apps/web/app/styles/<your-area>.css` and import it from your page/component file (Next.js app dir allows global CSS imports from any layout/page/component; see node_modules/next/dist/docs/01-app/01-getting-started/11-css.md).
- MOVE the rule blocks for your area's class prefixes out of `apps/web/app/globals.css` into your file (delete them from globals.css as whole blocks), then restyle them there. Only touch blocks for your own prefixes.
- Only edit the TSX files you own. Keep every behaviour, visible label used by tests, aria attribute, role and test id. Prefer CSS changes; change markup only where the new design needs structure.
- Real product facts only (see docs/design and the existing page copy); no invented features, numbers or prices.

## Verification (each agent)

- `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` on changed files, and `pnpm test:unit` if you touched TS logic.
- Do NOT run Playwright e2e (parallel runs collide on port 3100 and the shared DB); the lead runs e2e after merging.
- Local services: Postgres 5432, MinIO on **19000** (export `S3_ENDPOINT=http://127.0.0.1:19000`).
- Visual: start your own dev server on YOUR port with test auth, e.g. `cd apps/web && AGENT_DRIVE_TEST_AUTH=1 AGENT_DRIVE_TEST_AUTH_SECRET=<random hex> S3_ENDPOINT=http://127.0.0.1:19000 DATABASE_URL=postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive S3_REGION=us-east-1 S3_BUCKET=agent-drive-local S3_ACCESS_KEY_ID=agent_drive_local S3_SECRET_ACCESS_KEY=agent_drive_local_secret pnpm exec next dev -p <port>` in the background (check playwright.config.ts and tests/e2e/console.spec.ts for the exact env and how /api/test-session signs in). Use synthetic data only.
- Screenshot every surface/state you changed at 1440x900 and 390 wide with `agent-browser --session <your-area> ...` (never npx, never the default session) into `docs/design/shots/<your-area>/`. Open each with Read; fix anything broken, misaligned, wrapped badly, overflowing or low-contrast. Stop your dev server when done.

## Commit and handoff

No push, PR or deploy. One commit on your branch: `style(web): T1 rack design for <area>` with a body, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Report: changed files, which globals.css blocks you moved, commands and results, screenshot paths, and anything unverified. Report blockers early.

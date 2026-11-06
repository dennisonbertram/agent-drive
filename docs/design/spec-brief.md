# Spec-sheet re-skin brief (shared by all areas)

Approved direction: the spec-sheet sales page, `docs/design/spec-reference.html`. Open it in a browser and read its CSS before you start. It replaces the T1 "Rack" look everywhere.

Message: agents save files to their drive natively, and the files survive the sandbox ending, the machine changing, and the work moving to a different agent platform. Encryption is a supporting fact, not the headline.

## Look

- White paper, black ink, thin black rules. No dot grid, no metal gradients, no rack slots, no screws, no glass.
- Inter Tight for text (headings weight 500, tight negative letter-spacing), JetBrains Mono for labels, paths, codes and commands.
- Small uppercase mono labels (`.tag` in the reference) above headings and groups.
- Buttons: 1px black border, 6px radius, a 2px solid black drop shadow underneath; press moves down 1px. Primary action is signal orange with black text. One primary per screen.
- Status colours: `--danger` (#b42318) for errors, `--ok` (#1a7f37) for confirmed-good status. Status only, never decoration; orange stays for the primary action and the LED.
- Signal orange only for the primary action and the small status LED. Orange text on white uses `--sig-dark`.
- Dark code panels (`#111`, white mono text) for commands the user copies.
- Tables and lists: hairline row dividers, mono for paths and sizes, no zebra striping.
- Generous whitespace on marketing pages; app pages (console) stay dense and must fit 1280x800 without page scroll where they did before.

## Tokens (contract; the base agent defines these on :root)

Use only these names, always with the fallback so your page renders before the base merges:
`var(--bg,#fff) var(--panel,#fff) var(--paper-2,#f6f5f2) var(--ink,#111) var(--ink-2,#3b3a37) var(--muted,#6b6963) var(--line,rgba(17,17,17,.16)) var(--line-strong,#111) var(--sig,#ff4a1c) var(--sig-dark,#b8360c) var(--danger,#b42318) var(--ok,#1a7f37) var(--code-bg,#111) var(--code-ink,#fff) var(--code-muted,#a8a69f) var(--sans,'Inter Tight',system-ui,sans-serif) var(--mono,'JetBrains Mono',ui-monospace,Menlo,monospace)`.

Old T1 token names (`--al1`, `--al2`, `--al3`, `--smoke`, `--sig-text`, `--line-soft`, `--text-2`, `--accent`, `--link`) stay defined by the base agent as aliases for one release so nothing breaks, but do not use them in new rules; replace them in the files you own.

Do NOT edit `:root`, base element rules, generic buttons/badges/forms/`.eyebrow`, `app/layout.tsx` or `app/brand-mark.tsx` unless you are the base agent. If your area needs a primitive, define a local class in your own stylesheet.

## Ownership

| Agent         | Owns                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| base          | `app/layout.tsx` (fonts), `app/globals.css` (tokens, base elements, generic primitives), `app/brand-mark.tsx` (square mark with a bottom bar, as in the reference) |
| landing       | `app/(app)/page.tsx`, `app/styles/landing.css`, landing e2e expectations                                                                                           |
| console       | `app/(app)/console/console.tsx`, `app/(app)/console/page.tsx`, `app/styles/console.css`, `app/styles/console-panels.css`                                           |
| connect-share | `app/(app)/connect/*`, `app/s/[id]/*`, `app/styles/connect.css`, `app/styles/share.css`                                                                            |
| account       | `app/(app)/sign-in/*`, `app/(app)/sign-up/*`, `app/(app)/pricing/*`, `app/(app)/console/settings/*`, `app/(app)/console/billing/*`, `app/styles/account.css`       |

Only edit the files you own. Keep every behaviour, visible label used by tests, aria attribute, role and test id. Prefer CSS changes; change markup only where the new design needs structure. Real product facts only: copy comes from the existing page, the reference, `apps/web/src/billing/policy.ts` and the CLI help in `packages/agent-drive/src/cli.ts`. No invented features, numbers, prices or placeholder codes.

## Verification (each agent)

- `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check` on changed files, `pnpm test:unit` if you touched TS logic.
- Do NOT run Playwright e2e; the lead runs it after merging (parallel runs collide on port 3100 and the shared DB). If you change a label an e2e spec asserts, update the spec in the same commit and say so.
- Local services: Postgres 5432, MinIO on **19000** (always `S3_ENDPOINT=http://127.0.0.1:19000`).
- Visual: start your own dev server on YOUR port in the background: `cd apps/web && AGENT_DRIVE_TEST_AUTH=1 AGENT_DRIVE_TEST_AUTH_SECRET=<random hex> S3_ENDPOINT=http://127.0.0.1:19000 DATABASE_URL=postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive S3_REGION=us-east-1 S3_BUCKET=agent-drive-local S3_ACCESS_KEY_ID=agent_drive_local S3_SECRET_ACCESS_KEY=agent_drive_local_secret pnpm exec next dev -p <port>`. Check `playwright.config.ts` and `tests/e2e/console.spec.ts` for the exact env and how POST `/api/test-session` (userId matching `^e2e_`) signs in. Synthetic data only. Record the PID and stop only your own server when done.
- Screenshot every surface and state you changed at 1440x900 and 390 wide with `agent-browser --session <your-area> ...` (never npx, never the default session) into `docs/design/shots/spec-<your-area>/`. Open each with Read and compare with the reference; fix anything broken, misaligned, wrapped badly, overflowing or low-contrast.

## Commit and handoff

No push, PR or deploy. One commit on your branch: `style(web): spec-sheet design for <area>` with a body saying what changed and why, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Report: changed files, commands and results, screenshot paths, and anything unverified. Report blockers early.

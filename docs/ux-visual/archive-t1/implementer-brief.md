# Implementer brief (Phase 6) — shared by all ux-visual fix packages

Read first: docs/ux-visual/problems.md (your clusters, acceptance criteria, files), the findings and screenshots it cites under docs/ux-visual/pages/, docs/design/t1-rack-reference.html (the approved look), docs/design/t1-rollout.md (rules), apps/web/AGENTS.md (this Next.js differs from training data; read node_modules/next/dist/docs before relying on framework behaviour).

Rules

- Edit ONLY the files your package owns (listed in your task). Other packages run in parallel in other worktrees.
- Fix at the root: tokens/shared classes first, then pages. No ad-hoc colours: use the :root tokens (--bg --panel --al1..3 --ink --muted --line --line-soft --sig --sig-text --sig-dark --smoke --sans --mono).
- Presentation only. Do not change product behaviour, API calls, permissions or copy meaning; items marked "product-change: needs user decision" in problems.md are out of scope. Keep every label, role, aria attribute and test id the e2e tests rely on (tests/e2e/\*.spec.ts).
- For layout/behaviour changes write a failing Playwright assertion first in the relevant tests/e2e spec (e.g. path column width ≥ 240px at 768, no page scroll at 1440x900, banner visible near the form after a validation error), confirm it fails, then fix.
- e2e runs share port 3100 and the DB, so serialize them with a lock: `L=<scratchpad>; until mkdir "$L" 2>/dev/null; do sleep 15; done; S3_ENDPOINT=http://127.0.0.1:19000 pnpm exec playwright test <spec>; rmdir "$L"` (always rmdir, even on failure). Make sure no other `next dev` from YOUR worktree is running when you run e2e (Next allows one dev server per app dir).
- Visual check: your own dev server on YOUR port (see task) with local test auth (env as in playwright.config.ts; AGENT*DRIVE_TEST_AUTH=1, S3_ENDPOINT=http://127.0.0.1:19000, DATABASE_URL=postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive, and a random AGENT_DRIVE_TEST_AUTH_SECRET you generate). Sign in via POST /api/test-session with userId `e2e*<pkg>\_<n>`. Screenshot every affected surface at 1440x900, 1920x1080, 768x1024 and 375x812 with `agent-browser --session <pkg> ...` (never npx, never default) into docs/ux-visual/verification/<pkg>/after/; remove the Next dev badge before capture; open each with Read and fix what is wrong. Stop your dev server when done.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` if TS logic changed, your e2e spec(s) via the lock.
- Commit once (or once per cluster) on your branch: `fix(web): ux-visual <cluster ids> — <decision in a few words>`, body naming the acceptance criteria met, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, PR or deploy.

Handoff: changed files, cluster → criterion → evidence (measurement or screenshot path), test commands and results (including the failing-first run), anything not done or unverified, any deviation and why. Report blockers early.

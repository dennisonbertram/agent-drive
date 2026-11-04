# Public page fixes (branch ux-walker/public-page-fixes)

- F-002-01: pricing allowances of 1024 GiB or more now show as TiB ("1 TiB") via an `allowance` helper in pricing/page.tsx.
- F-003-01: Developer/Team buttons now read "Choose Developer" / "Choose Team"; href unchanged (/console/billing, routing tracked in issue #24).
- F-006-04: paid-plan links use `prefetch={false}` (confirmed in Next docs, 01-app/01-getting-started/04-linking-and-navigating.md). Not verified live; no browser run.
- F-006-01: landing page adds "File names, sizes, tags, and activity stay visible to the service so it can list and bill them."

Checks: tsc clean, eslint clean, prettier clean, unit vitest 21 files / 77 tests pass. Playwright scaffold e2e not run (Postgres/MinIO not reachable). No existing tests referenced the changed strings.

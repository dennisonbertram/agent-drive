# Agent Drive UX discovery

Baseline: `75fad601`. Catalog workflow: `wfr-c57fec7c04a34f4d907ce0cc3ea2bd09`.

Next.js web console plus CLI/MCP, not a native app. Public routes: `/`, `/pricing`, `/sign-in`, `/sign-up`, `/s/[id]`. Authenticated routes: `/console`, `/console/billing`, `/console/settings`. Console tabs: Files, Agents, API keys, Usage, Trash. The console creates drives and credentials; upload and share creation use CLI/MCP. Keys and plaintext remain client-side. Browser keys are memory-only, not persistent authentication credentials.

Five approved topic reviews covered onboarding, files/keys, sharing, billing, and deletion/audit. Consolidation produced 42 stories from 45 candidates. `catalog.md` contains their complete steps, source references, dependencies and coverage matrix. Ideal action counts are design benchmarks, not measured results.

The catalog is source-derived. Local verification uses disposable synthetic authentication and real local PostgreSQL/MinIO. Real Clerk signup, Stripe, email and hosted deployment remain unverified. Owner/member/viewer team UI and browser upload do not exist and were not invented. Native skills do not apply. The user prohibited paid GitHub Actions.

Adaptations: Devin workflow reviewers replace Claude-specific swarm names. Browser automation uses the existing Devin Chrome/Playwright rather than requiring `agent-browser`. No external-model or narrated-audio provider calls are assumed. Reports do not file GitHub issues or authorize merges.

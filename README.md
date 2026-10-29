# Agent Drive

Google Drive for agents: encrypted file storage on S3, used through an MCP server, a CLI, and a skill.

- [User stories](docs/user-stories.md)
- [Build plan](docs/plan.md)

## Phase 0 foundation

This branch contains repository and CI scaffolding only. The web app is a placeholder, and the
package does not yet implement product operations, a database schema, or MCP tools. Integration,
MCP, and browser tests in this phase are explicitly scaffold smoke checks, not product acceptance.
The MCP SDK handshake test covers infrastructure only; product MCP tools are pending Phase 3.

### Requirements

- Node.js `24.22.2` (the supported Node 24 LTS line; see `.nvmrc`)
- Corepack and the pinned pnpm version (`pnpm@11.24.0`)
- Docker Engine and Docker Compose

Enable Corepack once if needed, then install dependencies:

```sh
corepack enable pnpm
pnpm install
cp .env.example .env
```

Start the local PostgreSQL and MinIO services and wait for their health checks and deterministic
bucket initialization:

```sh
pnpm services:up
```

The Compose defaults and `.env.example` credentials are public local-development-only values; never
reuse them outside local development. The S3 access key and secret are also used as MinIO's local
root credentials. MinIO's API is at `http://localhost:9000`, its console is at
`http://localhost:9001`, and the database is at `localhost:5432`. Compose creates the
`agent-drive-local` bucket. Keep these services running for local development; use
`docker compose down` when intentionally stopping them.

Install the local Playwright browser once:

```sh
pnpm exec playwright install chromium
```

### Checks

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:mcp
pnpm test:e2e
pnpm build
```

`test:integration` requires the Compose services and verifies a PostgreSQL query plus MinIO
put/get/delete. `test:mcp` verifies an in-memory SDK initialize handshake only. `test:e2e` starts
the local web placeholder and checks it renders. These smoke checks do not assert any product
behavior.

### Environment variables

Copy `.env.example` to `.env` for local configuration. It lists the database connection and
PostgreSQL credentials; MinIO root credentials and S3 endpoint, region, bucket, and access keys;
Auth.js URL/secret and GitHub OAuth client ID/secret; the API base URL; the per-drive
`AGENT_DRIVE_KEY_<DRIVE_NAME>` convention; and placeholder Stripe, sender, and email API settings.
OAuth, billing, email, and drive-key placeholders are not used by the Phase 0 scaffold. A real
drive key should be stored in a secure secret manager, not committed to `.env.example`.

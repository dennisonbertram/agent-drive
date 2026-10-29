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

PostgreSQL uses the Docker Official Image published in Amazon ECR Public because Docker Hub pulls
were rate-limited in the development environment. MinIO's documented Quay image returned an
authorization error there, so Compose builds MinIO server and client from pinned upstream releases
using Docker Official Go and Debian base images. No third-party MinIO mirror is used.

The Compose defaults and `.env.example` credentials are public local-development-only values; never
reuse them outside local development. The S3 access key and secret are also used as MinIO's local
root credentials. MinIO's API is at `http://localhost:9000`, its console is at
`http://localhost:9001`, and the database is at `localhost:5432`. Compose creates the
`agent-drive-local` bucket. Keep these services running for local development; use
`docker compose down` when intentionally stopping them. To use alternate host ports, set
`POSTGRES_HOST_PORT`, `MINIO_API_HOST_PORT`, and `MINIO_CONSOLE_HOST_PORT`.

Apply the checked-in Phase 1 schema after the services are healthy:

```sh
DATABASE_URL=postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive \
  pnpm --dir apps/web db:migrate
```

The first agent credential is created only by an explicit local operator command. It is never
available through an unauthenticated HTTP endpoint:

```sh
pnpm --dir apps/web provision:local
```

The command requires a loopback `DATABASE_URL` and interactive account and agent names. It prints
the high-entropy API token once; only its SHA-256 hash is stored.

Install the local Playwright browser once:

```sh
pnpm exec playwright install chromium
```

### Checks

```sh
pnpm verify
```

`pnpm verify` is the required local regression gate before merge. It runs lint, typecheck, unit,
integration, MCP, Playwright, and build checks in that order. Start the Compose services with
`pnpm services:up` and install the Playwright browser before running it. The GitHub Actions workflow
is `workflow_dispatch` only; it does not run automatically on pull requests or pushes.

`test:integration` requires the Compose services and verifies a PostgreSQL query plus MinIO
put/get/delete. `test:mcp` verifies an in-memory SDK initialize handshake only. `test:e2e` starts
the local web placeholder and checks it renders. These smoke checks do not assert any product
behavior.

### Environment variables

Copy `.env.example` to `.env` for local configuration. It lists the database connection and
PostgreSQL credentials; MinIO root credentials and S3 endpoint, region, bucket, and access keys;
Clerk publishable and secret keys; the API base URL; the per-drive
`AGENT_DRIVE_KEY_<DRIVE_NAME>` convention; and placeholder Stripe, sender, and email API settings.
Clerk is the planned human-auth provider; GitHub OAuth can be configured as a Clerk provider.
Authentication, billing, email, and drive-key placeholders are not used by the Phase 0 scaffold. A
real drive key should be stored in a secure secret manager, not committed to `.env.example`.

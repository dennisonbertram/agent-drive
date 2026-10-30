# Agent Drive

Google Drive for agents: encrypted file storage on S3, used through an MCP server, a CLI, and a skill.

- [User stories](docs/user-stories.md)
- [Build plan](docs/plan.md)
- [Phase 1 API contract](docs/api.md)
- [Client encryption format](docs/crypto.md)
- [CLI and sync](docs/cli.md)

## Phase 2 client quickstart

After applying the database migration and provisioning a local management key as described below,
build the workspace CLI:

```sh
pnpm --filter agent-drive build
```

Set the local API endpoint and paste the one-time management credential at the hidden prompt:

```sh
export AGENT_DRIVE_API_URL=http://127.0.0.1:3000
read -rs -p "Management API key: " AGENT_DRIVE_API_KEY
printf '\n'
export AGENT_DRIVE_API_KEY
pnpm agent-drive login --api "$AGENT_DRIVE_API_URL"
```

Create an agent and a drive. **Back up the printed drive key immediately.** The server cannot
recover it:

```sh
pnpm agent-drive agent create --name local-agent
pnpm agent-drive drive create --name my-drive
```

Use the returned agent and drive IDs to create a scoped file-operation key. Save the one-time API
token securely, then use it with the locally retained drive key:

```sh
pnpm agent-drive key create --agent AGENT_ID --drive DRIVE_ID --label local-cli --scope read --scope write --scope delete
read -rs -p "Scoped API key: " AGENT_DRIVE_API_KEY
printf '\n'
export AGENT_DRIVE_API_KEY
printf 'hello from an agent\n' > ./sample.txt
pnpm agent-drive put ./sample.txt /sample.txt --drive DRIVE_ID
pnpm agent-drive get /sample.txt --drive DRIVE_ID --output ./sample.downloaded.txt
```

The CLI encrypts bytes before uploading. Drive keys never go to the API or object storage.

## MCP server

Build the private workspace package from this checkout and configure your MCP host to run the
compiled local CLI. Agent Drive reads API credentials and drive keys from its private config file
or environment variables; it never accepts a drive key as a command-line argument. Changes to the
saved configuration require restarting the MCP process.

Claude Code (replace the checkout path and config path with local absolute paths):

```sh
claude mcp add --transport stdio agent-drive \
  --env AGENT_DRIVE_CONFIG=/ABSOLUTE/PATH/.config/agent-drive/config.json \
  -- node /ABSOLUTE/PATH/agent-drive/packages/agent-drive/dist/cli.js mcp
```

Codex (`~/.codex/config.toml`), forwarding credential variables from the local environment rather
than placing their values in the TOML file:

```toml
[mcp_servers.agent-drive]
command = "node"
args = ["/ABSOLUTE/PATH/agent-drive/packages/agent-drive/dist/cli.js", "mcp"]
env_vars = ["AGENT_DRIVE_API_URL", "AGENT_DRIVE_API_KEY", "AGENT_DRIVE_CONFIG", "AGENT_DRIVE_KEY"]
```

Set `AGENT_DRIVE_API_URL` and `AGENT_DRIVE_API_KEY` securely in the environment or use the saved
config created by `pnpm agent-drive login`. Per-drive key environment variables use
`AGENT_DRIVE_KEY_<DRIVE_ID>` and take precedence over `AGENT_DRIVE_KEY`, then saved drive keys.
Drive keys and API credentials are secrets; never paste them into prompts, handoffs, or source
control. The API key needs the scopes required by the tools you intend to use.

Install the included skill into your working project's skill directory (or read
`skills/agent-drive/SKILL.md` directly). From this checkout, choose your host:

```sh
# Claude Code project skill
mkdir -p .claude/skills
cp -R skills/agent-drive .claude/skills/
# Codex project skill
mkdir -p .agents/skills
cp -R skills/agent-drive .agents/skills/
```

The `share` tool explicitly returns `not_implemented` until the Phase 5 sharing backend exists.
Live Claude Code verification remains pending until the Phase 4 console/manual validation work;
no Claude binary or external service is installed or invoked by this repository's tests.

## Local development environment

The repository includes the Phase 1 authenticated API, Phase 2 encrypted client/CLI, and Phase 3
MCP tools and skill.

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

Expired upload intents and their `staging/` objects are cleaned opportunistically when a new
upload is requested. Run the bounded maintenance command periodically for installations that may
be idle:

```sh
pnpm --dir apps/web maintenance:cleanup-expired-uploads
```

Configure the object store to expire only staging objects after one day as a backstop. For the
local MinIO service, apply this lifecycle rule once:

```sh
docker compose run --rm minio-init ilm rule add \
  --prefix staging/ --expire-days 1 local/agent-drive-local
```

Production S3 deployments should configure the equivalent one-day lifecycle rule for the exact
`staging/` prefix. Never apply this expiration to immutable `objects/`; Phase 7 will add production
lifecycle enforcement.

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
put/get/delete. `test:mcp` exercises all MCP tools through a spawned stdio server against the local
API adapter and services. `test:e2e` starts the local web placeholder and checks it renders.
Console/browser product flows remain later-phase work.

### Environment variables

Copy `.env.example` to `.env` for local configuration. It lists the database connection and
PostgreSQL credentials; MinIO root credentials and S3 endpoint, region, bucket, and access keys;
Clerk publishable and secret keys; the API base URL; the per-drive
`AGENT_DRIVE_KEY_<DRIVE_ID>` convention; and placeholder Stripe, sender, and email API settings.
Clerk is the planned human-auth provider; GitHub OAuth can be configured as a Clerk provider.
Authentication, billing, and email integrations remain staged work. A real drive key should be
stored in a secure secret manager, not committed to `.env.example`.

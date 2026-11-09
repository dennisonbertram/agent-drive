# Agent Drive

Encrypted storage your agents keep across sandboxes. Use it through an MCP server, a CLI, and a skill.

- [User stories](docs/user-stories.md)
- [Build plan](docs/plan.md)
- [HTTP API](docs/api.md)
- [Client encryption format](docs/crypto.md)
- [CLI and MCP reference](docs/cli.md)
- [Quickstart](docs/quickstart.md)
- [Deployment, deletion maintenance, and release gates](docs/deployment.md)

## Client quickstart

After applying the database migration and provisioning a local management key as described below,
build the workspace CLI:

```sh
pnpm --filter @dennisonbertram/agent-drive build
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

Install the CLI, then add it to your MCP host. Agent Drive reads API credentials and drive keys
from its private config file or environment variables; it never accepts a drive key as a
command-line argument. Changes to the saved configuration require restarting the MCP process.

```sh
npm install -g @dennisonbertram/agent-drive
claude mcp add agent-drive -- agent-drive mcp
```

To run from source instead (for contributors), build the workspace package and point the host at
the compiled CLI with `node /ABSOLUTE/PATH/agent-drive/packages/agent-drive/dist/cli.js mcp`.

Codex (`~/.codex/config.toml`), forwarding credential variables from the local environment rather
than placing their values in the TOML file:

```toml
[mcp_servers.agent-drive]
command = "agent-drive"
args = ["mcp"]
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

The `skills/agent-drive-trace-archive` skill archives an agent's old trace files weekly, deleting
local copies only after the downloaded copy's SHA-256 matches. Install it the same way as above.

The `share` tool creates expiring encrypted links through the implemented sharing backend.
The stdio regression tests use a real local API and storage, not a live Claude Code session;
no Claude binary or external service is installed or invoked by those tests.

## Local development environment

The repository includes the authenticated storage API, encrypted client/CLI, MCP tools and skill,
human console, encrypted sharing, billing controls, and deletion/audit interfaces. Hosted
authentication, payments, storage configuration, and deployment require dedicated configuration
and live acceptance; local regression tests are not evidence of a production launch.

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

Apply all checked-in schema migrations after the services are healthy:

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
`staging/` prefix. Never apply this expiration to immutable `objects/`; the production template
and maintenance requirements are documented in the [deployment runbook](docs/deployment.md).

For CLI-only local development without Clerk, bootstrap an account with the explicit operator
command below. The human console instead provisions an account after an authenticated sign-in.
Neither path exposes credentials through an unauthenticated HTTP endpoint:

```sh
pnpm --dir apps/web provision:local
```

The command requires a loopback `DATABASE_URL` and interactive account and agent names. It prints
the high-entropy API key once; only its SHA-256 hash is stored.

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
API adapter and services. `test:e2e` starts a dedicated local web server and exercises account
onboarding, browser-generated drive-key recovery, real CLI uploads, byte-for-byte browser
downloads, locked/wrong-key states, version restore, trash recovery, and API-key revocation.
Only the authentication provider is stubbed; database, storage, CLI, and encryption are real.
Browser traces are disabled because the journey displays one-time test secrets. This regression
does not prove a live Clerk OAuth handshake or a live Claude Code session.

### Human console

Configure `DATABASE_URL` and the `S3_*` variables in the web app's environment. Next.js reads
app-local variables from `apps/web/.env.local`; the root `.env` used by Docker Compose is not
automatically loaded by Next.js. Add the Agent Drive Clerk instance's
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` securely to the web environment.
Do not reuse credentials from another application. Enable GitHub in that instance's Clerk
dashboard if GitHub sign-in is desired; Clerk handles the provider callback and session.

```sh
pnpm --filter @agent-drive/web dev
```

Visit `/sign-up`, then `/console`. Create a drive, save its recovery file, create an agent,
and issue a scoped API key. The API key authorizes server operations; the separate drive key
decrypts file contents. The browser generates the drive key using Web Crypto and keeps it in
page memory only. Refreshing the page locks downloads until the key is loaded again. Recovery
JSON files contain the secret in plaintext: keep them in a password manager or another secure
location. The service cannot recover lost keys.

### Encrypted share links

Create an expiring share link from the CLI:

```sh
agent-drive share /reports/result.csv --drive DRIVE_ID --expires-in 24h
agent-drive share list --drive DRIVE_ID
agent-drive share revoke SHARE_ID --drive DRIVE_ID
```

MCP clients can use the `share` tool with a drive ID, path, and optional ISO expiry. The
default lifetime is seven days; the API accepts lifetimes from 60 seconds through 30 days.
The CLI accepts a minimum of 2 minutes to allow time for the request to reach the API.
The response URL is `/s/<id>#k=<file-key>`. The file key is unwrapped locally and exists only
in the URL fragment, which browsers do not send to the server. The public page fetches encrypted
bytes through a short-lived presigned URL and decrypts them in the browser.

Anyone who has the complete URL can decrypt the pinned file until it expires or is revoked.
Revocation prevents new metadata requests and download URLs, but cannot recall data already
downloaded or a presigned URL already issued (which can remain usable for at most 60 seconds).
The server stores share metadata and never stores the file key.

Public share pages and APIs require HTTPS in production. Terminate TLS at Vercel or a
TLS-terminating reverse proxy. Development permits HTTP only on exact loopback hosts
(`localhost`, `127.0.0.1`, or `[::1]`). A server-side 403 and HSTS header cannot prevent
active interception of a first HTTP visit; client-generated links use HTTPS except for
those loopback development hosts.

The console can browse names and metadata while locked. Downloads fetch ciphertext directly
from object storage and decrypt locally; no drive key is sent to the API. Allow browser GET
requests from the console's origin in the production bucket's CORS policy. Files currently
buffer in memory during download/decryption. Uploads use the CLI or MCP. Restoring a historical
or deleted file creates a new immutable version. Agent access can be revoked by disabling all
of its API keys; to rotate a key, issue a replacement, update the agent, then revoke the old key.

Plan allowances are calendar-month limits: Free includes 3 drives, 5 GiB retained storage,
5 GiB of authorized downloads, and 1 million successful API operations; Developer includes
25 drives, 100 GiB, 100 GiB, and 10 million operations for a proposed $20 monthly base; Team
includes 250 drives, 1 TiB (1024 GiB), 1 TiB, and 100 million operations for a proposed $200
monthly base. Configured overage rates are cents per additional drive-month, retained GiB-month,
egress GiB, and 1,000 successful operations, respectively. New drives use account limits by
default. An upgrade does not change an explicitly configured or legacy per-drive cap.
The operation allowance gates file reads (including public shares) as well as writes when
overage billing is unavailable. Account controls, billing recovery, and deletion remain available.
This operation quota is separate from the spending cap, which only blocks writes.
Quota-controlled requests reserve a pending audit record under the account lock before running.
Completion changes it atomically to success or failure: pending requests consume capacity but
are not billed. A crashed process can leave a pending record consuming capacity for that month;
operators should reconcile those records before marking them failed. Audit timestamps for
reserved operations record admission time, keeping month-boundary accounting consistent.

Usage reports encrypted committed bytes, including historical and deleted-file versions, and
recorded API operation attempts. Storage is grouped by drive and version author. Billing uses
calendar-month peak retained storage and allocated drives, authorized-download bytes, and
successful API operations. A presigned download URL gates the authorized-download allowance;
it does not prove that bytes were transferred. Billable egress is calculated from observed S3
response bytes in access logs. Metadata reads do not consume authorized-download allowance.
Presigned URLs remain reusable until their short expiry, so authorized-download allowances
are not hard caps on bytes served by S3. Replayed transfers are metered when logs arrive.
Deployments needing an exact per-transfer ceiling require an additional download gateway;
the direct-S3 v1 architecture does not provide one.
Historical versions remain billable until deleted. Per-tier rates are snapshotted for each
billing period, and the displayed base amount is a conservative estimate; Stripe proration and
tax determine the final invoice. Spend caps block new writes based on the ledger's currently
observed monthly amount; they do not block reads or make existing files unavailable. Delayed S3
logs, monthly peak allocation, rate snapshots, spend caps, and bounded provider retries can
require reconciliation. Alert delivery and Stripe meter reports are asynchronous.

Paid-tier changes are made with the in-app plan controls. Use the billing portal for invoices,
payment details, and cancellation.

Billing is configured through the four `BILLING_*_CENTS` rate variables. Run
`pnpm --dir apps/web billing:run` once manually during setup, then schedule it hourly through
an external worker. Configure the S3 server-access-log bucket/prefix, Stripe monthly USD base
prices at the specified proposal amounts, a one-cent-per-credit monthly metered usage price
attached to an active sum meter with the configured event name, webhook signing secret, customer
portal, trusted public HTTPS URL, and optional Resend sender/API key. Checkout is disabled by
default unless rates, known Stripe prices, and the S3 log source are configured. The
developer/team base amounts in policy are proposal defaults, not live pricing. Statements
contain a monthly CSV-compatible breakdown; Stripe invoices remain the payment record. Missing
S3, Stripe, or email configuration leaves durable delivery work pending and visible for operator
reconciliation. For Cloudflare R2, set `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`,
`S3_REGION=auto`, and `S3_BUCKET`; map an R2 API token access key ID and secret to
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Set `S3_EGRESS_METERING=none` and leave
`S3_LOGS_*` unset because R2 does not charge egress or provide server access logs. Configure bucket
CORS for the public origin with GET/HEAD/PUT. Deletion uses `ListObjectsV2` on R2. Synthetic
fixtures and test-mode signatures verify application wiring only;
they do not prove production billing, email collection, or egress metering.

The Playwright runner creates a random test-auth secret and enables a development-only provider
stub in its dedicated server. `/api/test-session` requires that secret, a loopback hostname, and
a synthetic `e2e_` identity. Cookies are signed, short-lived, and HTTP-only. Production never
accepts these identities, even if test variables are accidentally configured. Never enable
`AGENT_DRIVE_TEST_AUTH` on a shared development server. A running app on port 3100 must be
stopped before `pnpm test:e2e`; the test runner intentionally does not reuse arbitrary servers.

### Environment variables

Copy `.env.example` to `.env` for local configuration. It lists the database connection and
PostgreSQL credentials; MinIO root credentials and S3 endpoint, region, bucket, and access keys;
Clerk publishable and secret keys; the API base URL; the per-drive
`AGENT_DRIVE_KEY_<DRIVE_ID>` convention; and placeholder Stripe, sender, and email API settings.
Clerk is the human-auth provider; GitHub OAuth can be configured as a Clerk provider.
Billing checkout, metering, and email require the additional Stripe, S3 log, rate, and
`API_KEY_REQUESTS_PER_MINUTE` variables listed in `.env.example`. A real drive key should be
stored in a secure secret manager, not committed to `.env.example`.

# Credential-free acceptance simulation

Simulation checks application behavior before dedicated Agent Drive credentials exist. It does
**not** certify provider configuration or a hosted launch. No GitHub Actions, real payments, or
external email are needed.

## Reproduce locally

Follow the [local setup](../README.md#local-development-environment), apply migrations, and install
Playwright Chromium. Use a disposable local PostgreSQL database and MinIO bucket, never production
resources: the integration suites create and delete synthetic data. Stop an existing development
server on port 3100 before the managed browser suite. Keep the test origin `http://localhost:3100`;
changing its hostname can invalidate same-origin checks.

Run the new provider boundary checks on their own:

```sh
pnpm test:unit apps/web/src/console/clerk-boundary.unit.test.ts
pnpm test:integration apps/web/src/billing/provider-http.integration.test.ts
```

Run the complete local release gate:

```sh
pnpm verify
```

Leave `NODE_ENV` unset when starting the gate; Next.js chooses development for its test server and
production for its build. If the host injects a nonstandard value, remove it first. Do not substitute
an unmanaged preview for the normal Playwright server: sharing acceptance inspects its captured
server log for accidental disclosure of secret fragments.

## What is real, and what is simulated?

| Boundary                    | Local execution                                                                                                                                             | Not established by simulation                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Human sign-in               | Signed, expiring development-only synthetic session; separate tests exercise the production `consoleUserId` branch using simulated Clerk results and errors | Clerk signup, MFA, OAuth, cookies, domain settings, session refresh, or provider availability                                 |
| Workspace and authorization | Actual application handlers, PostgreSQL migrations/transactions, account separation, scoped credentials and revocation                                      | Hosted database TLS, pooling, permissions, or network limits                                                                  |
| File lifecycle              | Actual CLI/client encryption, MinIO uploads/downloads, browser decryption, versions, trash/restore and byte equality                                        | AWS IAM, deployed CORS, actual access-log delivery, lifecycle timing or regional behavior                                     |
| MCP                         | Actual SDK stdio client/server, local API and object storage                                                                                                | Installation and tool selection inside a live Claude Code/Codex host                                                          |
| Sharing                     | Actual encrypted links, anonymous browser download, expiry/revocation and secret-fragment assertions                                                        | Hosted routing, CDN behavior or every recipient browser                                                                       |
| Billing providers           | Real Stripe SDK HTTP serialization/error parsing and signature verification against a loopback fake provider; real database state transitions               | Stripe accepting the requests, real price/meter setup, checkout UI, final invoice/tax/proration amounts or payment settlement |
| Email                       | Production email adapter sends real HTTP to a loopback sink through a test-only fetch redirect                                                              | Resend sender verification, delivery, spam filtering or inbox rendering                                                       |
| Quotas and workers          | Application accounting, synthetic S3 log ingestion, durable retry/outbox and deletion integration tests                                                     | Scheduler deployment, delayed real logs, production throughput or worker monitoring                                           |
| Release                     | Production build and the release smoke's local synthetic-auth mode                                                                                          | A deployed Vercel environment or a completed hosted release                                                                   |

The HTTP provider simulation replaces **only the network destination/configuration** of Stripe's
constructor; it does not replace SDK resource methods. SDK retries are disabled in this test so
application-level recovery is exercised deterministically. Resend's fixed URL is redirected only
inside the test process. Neither seam adds a test endpoint, authentication bypass, or configurable
fake-provider URL to production code. Unknown HTTP routes fail the simulation.

## Permanent scenarios

The provider HTTP journey checks:

1. Checkout receives a simulated HTTP 503. The account stays Free, and a later attempt reuses the
   stored idempotency key and customer rather than creating another customer.
2. Checkout request encoding contains the base plan, metered item without quantity, account
   metadata, billing anchor and trusted success/cancel URLs. Resuming reuses the existing session.
3. A modified signed payload and a live/test-mode mismatch are rejected. A valid signed completion
   activates Developer; duplicate and stale events do not fetch or change the subscription again.
4. A simulated HTTP 402 rejects an upgrade without changing the local plan. A subsequent success
   activates Team using the subscription-update path and explicit payment/proration parameters.
5. An invoice failure using the nested subscription reference records `past_due`; recovery routes
   to the billing portal instead of creating another subscription.
6. Meter and email 503 failures propagate; successful retries preserve their identifiers and
   encoded payloads. Separate maintenance tests verify durable outbox retry and expiry behavior.
7. Deletion's provider adapter expires an open session, cancels the subscription with a stable
   idempotency key, and accepts a signed cancellation event that returns the account to Free.

The full gate additionally exercises the storage, CLI, MCP, console, sharing, accounting,
cross-account permissions, deletion and UX regression suites. Test definitions are not execution
evidence: retain the command output and browser report from each actual run.

## Required live-key acceptance

Once dedicated credentials are available, use isolated test-mode resources before accepting real
customers. Never reuse keys belonging to another application.

- **Clerk:** complete real signup and returning signin on the deployed origin; verify signout,
  expiry, two-user isolation, and that the synthetic-session endpoint is disabled.
- **AWS/PostgreSQL:** run encrypted upload/download from both CLI and browser, inspect deployed
  private-access/CORS policies, verify actual S3 log arrival, migrate through the intended connection,
  and exercise the deployed cleanup worker on disposable data.
- **Stripe test mode:** configure the exact base prices and usage meter; complete hosted checkout,
  deliver signed webhooks to the deployed route, replay events, simulate failed payment and recovery,
  upgrade/cancel, and reconcile usage against the resulting test invoice. Verify webhook delivery
  retries and scheduler execution rather than only invoking handlers directly.
- **Email:** use a verified sender and a controlled recipient; confirm receipt and retry behavior.
- **Agent host:** connect the published configuration in the intended MCP host and complete a
  real tool-mediated roundtrip without placing credentials in prompts.
- **Hosted release:** follow the [staged deployment procedure](deployment.md), including candidate
  smoke, promotion only on success, and post-promotion smoke. A local pass cannot waive these gates.

Even after those checks, reusable presigned S3 URLs and delayed access logs mean usage allowances
are not exact per-transfer network caps. That is a documented architecture limitation, not something
a passing mock can eliminate.

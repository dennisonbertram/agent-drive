# Agent Drive — User Stories

Status: draft for review (2026-10-29). Pricing numbers are proposals, not decisions.

## The idea

Agents now get their own sandboxes, GPUs, and (through AgentMail) their own email
inboxes. They do not get their own storage. Today they borrow a human's Box or
Google Drive account, which means human OAuth, human folder structures, and no
clear record of which agent or machine wrote which file.

Agent Drive is a drive built for agents. It is a paid MCP server and an HTTP API
on top of object storage (Amazon S3 first; Cloudflare R2, Google Cloud Storage,
or the customer's own bucket later), plus a skill that teaches agents when and
how to use it. The model is AgentMail: one API call creates an inbox there; one
call creates a drive here.

AgentMail reference point (third-party pricing pages, not verified against
agentmail.to): Free = 3 inboxes / 3,000 emails per month; Developer = $20/month
for 10 inboxes; Startup = $200/month for 150 inboxes; Enterprise = custom.

## Terms

- **Account**: the paying human or organization.
- **Agent**: a named agent identity inside an account (for example `support-bot`
  or `claude-code@dennison-laptop`). Every write is attributed to one.
- **Machine**: the host or sandbox an agent runs on. Recorded on every write so
  the same agent on two machines stays distinguishable.
- **User**: the end user an agent is acting for, if any. Optional tag on writes.
- **Drive**: a storage namespace with its own quota, keys, and policies. An agent
  can have a private drive; a team of agents can share one.
- **Key**: an API key scoped to one agent, one drive, and a set of permissions
  (read, write, delete, share).
- **Trace**: a structured record of an agent run (messages, tool calls, results,
  outcome) stored for debugging, evaluation, or training.

## Personas

1. **The agent** — the main user. Calls MCP tools; never sees a web page.
2. **The developer** — builds agents; wires up the MCP server, keys, and skill.
3. **The operator / human owner** — wants to see, retrieve, and control what
   their agents stored.
4. **The ML / evals engineer** — wants agent traces as clean datasets.
5. **The admin / finance owner** — pays, sets limits, needs invoices and audit.
6. **A receiving party** — a human or another agent that gets a file shared to it.

---

## Epic 1 — Setup and identity

- **S1.1** As a developer, I want to sign up and get an API key in under a
  minute, so that I can try Agent Drive without a sales call.
  *Accept:* email or GitHub sign-up, free tier, key shown once, quickstart snippet.
- **S1.2** As a developer, I want to add Agent Drive to Claude Code, Codex, or
  any MCP client with one command or one config block, so that my agent has
  storage immediately. *Accept:* remote MCP URL + key header; `claude mcp add`
  example; works over Streamable HTTP.
- **S1.3** As a developer, I want to create agent identities and drives through
  the API, so that I can provision storage for each agent I deploy (the
  AgentMail "create inbox" moment). *Accept:* `POST /agents`, `POST /drives`,
  idempotent by client-supplied name.
- **S1.4** As a developer, I want to issue a key per agent with narrow
  permissions, so that a compromised agent can damage only its own drive.
- **S1.5** As an agent, I want to call `whoami`, so that I know which agent,
  drive, quota, and permissions I am operating under.
- **S1.6** As an agent running in a fresh sandbox, I want the machine identity
  attached automatically (from an env var or the key's registration), so that
  my writes are labeled with where they came from without extra work.

## Epic 2 — Core file operations (the MCP tools)

- **S2.1** As an agent, I want to write a file by path (`put`), so that I can
  save outputs. Small text content goes inline; large files use a presigned
  upload URL so bytes go straight to the bucket.
- **S2.2** As an agent, I want to read a file (`get`), returning text inline when
  small and a presigned download URL when large or binary.
- **S2.3** As an agent, I want to `list` a folder with sizes, timestamps, and
  author, so that I can find what I or other agents saved.
- **S2.4** As an agent, I want to `move`, `copy`, and `delete` files, so that I
  can keep my drive organized.
- **S2.5** As an agent, I want to attach metadata (tags, a short description,
  the user and task it relates to) when I write, so that later searches work.
- **S2.6** As an agent, I want every overwrite to keep the prior version, so that
  a bad write by me or another agent can be undone. *Accept:* `versions` and
  `restore` tools; versions count toward quota.
- **S2.7** As an agent, I want conditional writes (only if the file has not
  changed since I read it), so that two agents editing one file do not silently
  overwrite each other.
- **S2.8** As an agent, I want `append` for logs and JSONL, so that I can stream
  records without rewriting the whole file.
- **S2.9** As an agent, I want clear, actionable errors (quota exceeded,
  permission denied, file not found, payment required), so that I can recover or
  tell my human what to do.

## Epic 3 — Agent memory and work handoff

- **S3.1** As an agent, I want a persistent workspace that survives the end of
  my session or sandbox, so that tomorrow's run can pick up today's notes,
  plans, and partial results.
- **S3.2** As an agent, I want a conventional layout (for example `/memory`,
  `/work/<task-id>`, `/outputs`, `/traces`), so that I and other agents know
  where things go without being told each time. The skill defines this.
- **S3.3** As an agent finishing a long task, I want to write a handoff file
  (state, next steps, open questions), so that another agent or a later session
  can continue.
- **S3.4** As a developer running ephemeral sandboxes, I want an agent to `sync`
  a local directory to and from its drive, so that sandbox teardown does not
  lose work.
- **S3.5** As an agent, I want scratch files that expire automatically (TTL), so
  that temporary data does not pile up and cost money.

## Epic 4 — Traces for training and evaluation

- **S4.1** As an agent, I want to save a trace of my run in a standard format,
  so that my developers can debug and train on it. *Accept:* one documented
  JSONL schema (run id, agent, machine, user, model, messages, tool calls,
  outcome, cost); accept common existing formats on import.
- **S4.2** As a developer, I want traces captured automatically by a hook or SDK
  wrapper, so that I do not depend on the agent remembering to save them.
- **S4.3** As an operator, I want secrets and personal data redacted from traces
  before storage, so that the trace store is safe to share with an ML team.
  *Accept:* default redaction of keys/tokens; configurable PII rules; redaction
  is recorded in the trace metadata.
- **S4.4** As an ML engineer, I want to label a trace (success, failure, rating,
  free-text note), so that I can build preference and fine-tuning datasets.
- **S4.5** As an ML engineer, I want to query traces by agent, machine, user,
  model, date, outcome, and label, and export the result as one dataset (JSONL
  or Parquet), so that I can feed a training or eval pipeline directly.
- **S4.6** As an operator, I want to set retention per drive (for example keep
  traces 90 days, labeled traces forever), so that storage cost stays bounded.
- **S4.7** As a user whose data appears in traces, I want my data excluded from
  training exports when I opt out or request deletion, so that the operator can
  honor privacy requests. *Accept:* delete-by-user-tag across all drives.

## Epic 5 — Keeping agents, users, and machines separate

- **S5.1** As an operator, I want every file and version to record the agent,
  machine, and user (if any) that wrote it, so that I can always answer "who
  wrote this and from where."
- **S5.2** As an operator running one agent for many end users, I want
  per-user folders the agent can reach only while acting for that user, so that
  one customer's data never leaks into another's session.
- **S5.3** As an operator, I want shared team drives and private agent drives,
  so that agents can collaborate where intended and stay isolated elsewhere.
- **S5.4** As an agent, I want to filter list and search results by author,
  machine, or user, so that I see only what is relevant to my current task.
- **S5.5** As an admin, I want an audit log of every read, write, share, and
  delete, with the key that did it, so that I can investigate incidents.

## Epic 6 — Sharing and handoff to others

- **S6.1** As an agent, I want to create an expiring share link for a file, so
  that I can hand a report to a human in chat, email, or a ticket.
- **S6.2** As an agent, I want to share a file or folder with another agent's
  identity (read or write), so that agents in a pipeline can pass work.
- **S6.3** As an agent, I want each drive to have an inbox folder that others
  can drop files into without reading the rest of my drive, so that humans and
  agents can send me inputs.
- **S6.4** As an agent using AgentMail, I want to save email attachments to my
  drive and attach drive files to outgoing email by reference, so that the two
  services work together. (Integration; not a dependency.)
- **S6.5** As a receiving human, I want a share link to open a clean preview
  page without creating an account.

## Epic 7 — Finding things

- **S7.1** As an agent, I want to search by filename, path, tag, and metadata.
- **S7.2** As an agent, I want full-text search over text files.
- **S7.3** As an agent, I want semantic search ("find the pricing research from
  last week"), so that I can recall material without knowing the path.
  (Later; requires indexing cost decisions.)
- **S7.4** As an agent, I want `recent` (what changed in this drive since a
  time), so that I can catch up on what other agents did.

## Epic 8 — Human console

- **S8.1** As an operator, I want a web console to browse drives, preview
  files, and download them, so that I can see what my agents produced.
- **S8.2** As an operator, I want to manage agents, keys, and drives in the
  console (create, rotate, revoke), so that I can respond quickly to a leak.
- **S8.3** As an operator, I want to see usage per agent and per drive (storage,
  egress, operations, cost), so that I know which agent is expensive.
- **S8.4** As an operator, I want to restore deleted files and old versions from
  the console.

## Epic 9 — Bring your own bucket

- **S9.1** As a company with data-residency rules, I want Agent Drive to store
  bytes in my own S3 bucket, so that data never leaves my cloud account while
  I still get the agent API, attribution, sharing, and traces. *Accept:* connect
  via IAM role (no long-lived keys); Agent Drive stores metadata only.
- **S9.2** As a developer, I want to pick a region (US, EU) for hosted drives.
- **S9.3** As a developer, I want R2 and GCS as backends, so that I can avoid S3
  egress pricing or stay in my existing cloud.

## Epic 10 — Paying for it

- **S10.1** As a developer, I want a free tier large enough to build a real
  prototype, without a credit card.
- **S10.2** As a developer, I want simple plans priced per agent drive plus
  storage, similar to AgentMail, so that I can predict my bill.
- **S10.3** As a developer, I want usage-based overage (storage GB-months,
  egress GB, operations) instead of a hard stop, with an optional hard cap.
- **S10.4** As an admin, I want spend limits per account, per agent, and per
  drive, and alerts at thresholds, so that a looping agent cannot run up a bill.
- **S10.5** As an agent with no account, I want to pay for storage myself
  through a machine-payment protocol (for example HTTP 402 payments such as
  x402, or a Stripe agent payment method), so that I can provision a drive
  without a human sign-up. *Status:* option to evaluate; may not be in v1.
- **S10.6** As an agent that hits its quota, I want a `payment required` error
  that includes an upgrade link I can give my human, so that the fix is one
  click for them.
- **S10.7** As a finance owner, I want monthly invoices with per-agent cost
  breakdown, and card or invoice billing.
- **S10.8** As a platform company, I want to resell drives to my own customers
  under my account (sub-accounts, usage export), so that I can build on Agent
  Drive.

### Pricing sketch (proposal)

| Plan | Price | Agent drives | Storage included | Notes |
|---|---|---|---|---|
| Free | $0 | 3 | 5 GB | No card; 30-day trace retention |
| Developer | $20/mo | 25 | 100 GB | Versioning, share links, overage billing |
| Team | $200/mo | 250 | 1 TB | Trace datasets & export, audit log, SSO-lite |
| Enterprise | Custom | Custom | Custom | BYO bucket, EU region, SOC 2, SLA |

Overage: storage, egress, and operations at a markup over the backend cost.
Raw S3 Standard is roughly $0.023 per GB-month in us-east-1 (to verify before
pricing). BYO-bucket customers pay a platform fee only, since they pay AWS
directly.

## Epic 11 — Safety and governance

- **S11.1** As an operator, I want all data encrypted at rest and in transit,
  with per-account keys and optional customer-managed keys (Enterprise).
- **S11.2** As an agent, I want file contents returned as data clearly marked as
  untrusted, so that instructions planted in a stored file do not hijack me.
  The skill reinforces this.
- **S11.3** As an operator, I want to block or quarantine dangerous uploads
  (malware scan, size limits, type limits).
- **S11.4** As an admin, I want account and drive deletion that removes all data,
  versions, and backups within a stated period, with an export first.
- **S11.5** As an admin, I want rate limits per key, so that one runaway agent
  cannot degrade service for others.

## Epic 12 — The skill

- **S12.1** As an agent, I want a skill that tells me when to save to Agent Drive
  (finished outputs, memory, handoffs, traces) and when not to (secrets,
  throwaway scratch), so that I use it consistently without being prompted.
- **S12.2** As an agent, I want the skill to define the folder layout and naming
  conventions from S3.2, and the trace schema from S4.1.
- **S12.3** As a developer, I want the skill installable in Claude Code, Codex,
  and other skill-aware clients, and readable as plain Markdown elsewhere.

---

## Proposed v1 cut

The smallest product a developer would pay $20/month for:

- Epic 1: S1.1–S1.5
- Epic 2: S2.1–S2.6, S2.9
- Epic 3: S3.1, S3.2, S3.3
- Epic 4: S4.1, S4.3 (secret redaction only), S4.5 (export only, simple filters)
- Epic 5: S5.1, S5.3, S5.5
- Epic 6: S6.1
- Epic 7: S7.1, S7.4
- Epic 8: S8.1, S8.2, S8.3
- Epic 10: S10.1, S10.2, S10.3, S10.4, S10.6
- Epic 11: S11.1, S11.2, S11.5
- Epic 12: S12.1, S12.2

Deferred: per-user isolation (S5.2), agent-to-agent sharing and inboxes (S6.2,
S6.3), AgentMail integration, full-text and semantic search, trace labeling,
auto-capture hooks, BYO bucket, other backends, agent self-payment, reselling.

## Open questions

TBD — see the questions asked in the session; answers will be recorded here.

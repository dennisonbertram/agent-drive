# Agent Drive — User Stories

Status: agreed v1 scope (2026-10-29). Pricing numbers are proposals, not decisions.

## The idea

Agents now get their own sandboxes, GPUs, and (through AgentMail) their own email
inboxes. They do not get their own storage. Today they borrow a human's Box or
Google Drive account, which means human OAuth, human folder structures, and no
clear record of which agent or machine wrote which file.

Agent Drive is Google Drive for agents. It is a paid service on top of Amazon S3,
used through an MCP server, a CLI, and a skill that teaches agents when and how
to use it. The model is AgentMail: one call there creates an inbox; one call
here creates a drive.

**File contents are encrypted on the client before upload** (except opt-in
OpenRouter webhook traces, which the server encrypts on receipt). The Agent Drive
server and S3 only ever hold ciphertext at rest. The encryption key stays with the
customer.

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
- **Drive**: a storage namespace with its own quota, API keys, and encryption key.
- **API key**: authenticates an agent to the Agent Drive server, scoped to one
  agent, one or more drives, and a set of permissions (read, write, delete, share).
- **Drive key**: the secret that encrypts and decrypts a drive's file contents.
  Generated on the client; never sent to the server.

## Consequences of client-side encryption

These are deliberate and shape the stories below:

- The MCP server runs **locally** (stdio, installed with npm), because it must
  hold the drive key to encrypt and decrypt. A hosted remote MCP server cannot
  do this without seeing plaintext.
- **Lose the drive key, lose the data.** The product must make key backup
  obvious at drive creation.
- The server **cannot** search file contents, generate previews, or scan for
  malware. Search works on paths, tags, and metadata only.
- Share links carry the decryption key in the URL fragment (`#k=…`), which
  browsers do not send to servers. The share page decrypts in the browser.
- In v1, paths, sizes, timestamps, tags, and authorship are stored in plaintext
  so that listing, search, and the console work. Encrypting names too is a
  later option.

## Personas

1. **The agent** — the main user. Calls MCP tools or the CLI; never sees a web page.
2. **The developer** — builds agents; installs the MCP server, keys, and skill.
3. **The operator / human owner** — wants to see, retrieve, and control what
   their agents stored.
4. **The admin / finance owner** — pays, sets limits, needs invoices and audit.
5. **A receiving party** — a human or another agent that gets a file shared to it.

---

## Epic 1 — Setup and identity

- **S1.1** As a developer, I want to sign up and get an API key in under a
  minute, so that I can try Agent Drive without a sales call.
  *Accept:* GitHub or email sign-up, free tier, API key shown once.
- **S1.2** As a developer, I want to add Agent Drive to Claude Code, Codex, or
  any MCP client with one command, so that my agent has storage immediately.
  *Accept:* `npx agent-drive mcp` works as a stdio MCP server; a
  `claude mcp add` example is in the README.
- **S1.3** As a developer, I want to create agents and drives through the CLI
  or API, so that I can provision storage for each agent I deploy.
  *Accept:* idempotent by client-supplied name.
- **S1.4** As a developer, I want an API key per agent with narrow
  permissions, so that a compromised agent can damage only its own drives.
- **S1.5** As an agent, I want to call `whoami`, so that I know which agent,
  drives, quota, and permissions I am operating under.
- **S1.6** As an agent in a fresh sandbox, I want the machine identity attached
  automatically (hostname or an env var), so that my writes are labeled with
  where they came from.

## Epic 2 — Encryption and keys

- **S2.1** As a developer, I want a drive key generated on my machine when I
  create a drive, and shown to me with a clear "save this" prompt, so that only
  I can read my data.
- **S2.2** As a developer, I want to give the drive key to an agent through an
  env var or key file, so that agents on several machines can share one drive.
- **S2.3** As an operator, I want proof that the server never sees plaintext:
  stored objects and database rows contain no file contents.
- **S2.4** As an operator, I want to rotate a drive key (re-encrypt with a new
  key) after a leak. *(Later.)*
- **S2.5** As an agent, I want a clear error when my drive key is missing or
  wrong, instead of garbage data.

## Epic 3 — Core file operations

Exposed identically as MCP tools, CLI commands, and a client library.

- **S3.1** As an agent, I want to write a file by path (`put`), so that I can
  save outputs. Large files upload straight to S3 through presigned URLs.
- **S3.2** As an agent, I want to read a file (`get`), returning text inline
  when small and writing to a local path when large or binary.
- **S3.3** As an agent, I want to `list` a folder with sizes, timestamps, and
  author.
- **S3.4** As an agent, I want to `move`, `copy`, and `delete` files.
- **S3.5** As an agent, I want to attach tags and a short description when I
  write (stored as plaintext metadata), so that later searches work.
- **S3.6** As an agent, I want every overwrite to keep the prior version, with
  `versions` and `restore`, so that a bad write can be undone. Versions count
  toward quota.
- **S3.7** As an agent, I want conditional writes (only if the file has not
  changed since I read it), so that two agents do not silently overwrite each
  other.
- **S3.8** As an agent, I want clear, actionable errors (quota exceeded,
  permission denied, not found, payment required).

## Epic 4 — Agent workspace and handoff

- **S4.1** As an agent, I want a persistent workspace that survives the end of
  my session or sandbox, so that later runs can pick up notes and results.
- **S4.2** As an agent, I want a conventional layout (`/memory`,
  `/work/<task-id>`, `/outputs`, `/inbox`), defined by the skill.
- **S4.3** As an agent finishing a long task, I want to write a handoff file
  (state, next steps, open questions) another agent can continue from.
- **S4.4** As a developer running ephemeral sandboxes, I want `sync` between a
  local directory and a drive folder, so that teardown does not lose work.
- **S4.5** As an agent, I want scratch files that expire (TTL). *(Later.)*

## Epic 5 — Keeping agents, users, and machines separate

- **S5.1** As an operator, I want every file version to record the agent,
  machine, and user (if any) that wrote it.
- **S5.2** As an operator, I want shared team drives and private agent drives.
- **S5.3** As an agent, I want to filter list and search by author, machine, or
  user.
- **S5.4** As an admin, I want an audit log of every read, write, share, and
  delete, with the API key that did it.
- **S5.5** As an operator running one agent for many end users, I want
  per-user folders the agent can reach only while acting for that user. *(Later.)*

## Epic 6 — Sharing

- **S6.1** As an agent, I want to create an expiring share link for a file, so
  that I can hand a result to a human. The link includes the decryption key in
  the URL fragment; the share page decrypts in the browser.
- **S6.2** As a receiving human, I want the link to open a download page with no
  account required.
- **S6.3** As an operator, I want to revoke a share link.
- **S6.4** As an agent, I want to share a folder with another agent's identity.
  *(Later.)* Write restrictions by folder were delivered at the API level
  (a key can be limited to writing certain folders); reads stay drive-wide, and
  sharing a folder with another agent was not delivered.

## Epic 7 — Finding things

- **S7.1** As an agent, I want to search by path, filename, tag, and author.
- **S7.2** As an agent, I want `recent` (what changed in a drive since a time),
  so that I can catch up on what other agents did.
- Full-text and semantic search are not possible server-side with client-side
  encryption. A local index is a later option.

## Epic 8 — Human console

- **S8.1** As an operator, I want a web console to browse drives and download
  files. Downloads decrypt in the browser after I enter or load the drive key.
- **S8.2** As an operator, I want to create, rotate, and revoke agents and API
  keys in the console.
- **S8.3** As an operator, I want usage per agent and per drive (storage,
  egress, operations, cost).
- **S8.4** As an operator, I want to restore deleted files and old versions.

## Epic 9 — Paying for it

- **S9.1** As a developer, I want a free tier large enough for a real prototype,
  with no credit card.
- **S9.2** As a developer, I want plans priced per drive plus storage, like
  AgentMail, so that my bill is predictable.
- **S9.3** As a developer, I want usage-based overage instead of a hard stop,
  with an optional hard cap.
- **S9.4** As an admin, I want spend limits and alerts per account, so that a
  looping agent cannot run up a bill.
- **S9.5** As an agent that hits its quota, I want a `payment required` error
  with an upgrade link I can give my human.
- **S9.6** As a finance owner, I want monthly invoices with per-agent breakdown.
- **S9.7** As an agent with no account, I want to pay for a drive myself through
  a machine-payment protocol (for example x402). *(Later.)*

### Pricing sketch (proposal)

| Plan | Price | Drives | Storage included | Notes |
|---|---|---|---|---|
| Free | $0 | 3 | 5 GB | No card |
| Developer | $20/mo | 25 | 100 GB | Versioning, share links, overage billing |
| Team | $200/mo | 250 | 1 TB | Audit log, team drives |
| Enterprise | Custom | Custom | Custom | BYO bucket, EU region, SLA |

Overage covers storage, egress, and operations at a markup over S3 cost. Raw S3
Standard is roughly $0.023 per GB-month in us-east-1 (to verify before pricing).

## Epic 10 — Safety and governance

- **S10.1** As an operator, I want contents encrypted on the client (Epic 2)
  and all traffic over TLS.
- **S10.2** As an agent, I want file contents returned as data clearly marked as
  untrusted, so that instructions planted in a stored file do not hijack me.
- **S10.3** As an admin, I want account and drive deletion that removes all
  objects and versions within a stated period.
- **S10.4** As an admin, I want rate limits per API key and size limits per
  file.

## Epic 11 — The skill

- **S11.1** As an agent, I want a skill that tells me when to save to Agent Drive
  (finished outputs, memory, handoffs) and when not to (secrets, throwaway
  scratch).
- **S11.2** As an agent, I want the skill to define the folder layout from S4.2.
- **S11.3** As a developer, I want the skill installable in Claude Code and
  Codex, and readable as plain Markdown elsewhere.

## Later (not v1)

Bring-your-own bucket, R2/GCS backends, EU region, encrypted filenames, key
rotation (S2.4), TTL scratch (S4.5), per-user isolation (S5.5), agent-to-agent
sharing (S6.4), local full-text index, agent self-payment (S9.7), reselling
and sub-accounts, AgentMail attachment integration.

## Decisions (2026-10-29)

- **First customer:** indie and agent developers, self-serve.
- **Payment:** a human pays (Stripe subscription plus usage).
- **Storage:** our own hosted S3.
- **Product framing:** Google Drive for agents. Trace capture is opt-in: a drive
  owner can send agent traces (for example an OpenRouter webhook) into
  `/traces/...`. Training-data use of traces is not part of the product.
- **Encryption:** file contents are encrypted on the client before upload, with
  one exception: an OpenRouter webhook delivers its trace to the server in
  plaintext over TLS, and the server encrypts it to the drive's trace-inbox
  public key on receipt, never holding the drive key.

## Open questions

- Exact plan limits and overage prices: TBD after measuring S3 costs.

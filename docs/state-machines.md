# Lifecycle ownership

An operation may finish after its caller has cancelled it, changed accounts, or lost a worker
lease. Completion alone does not authorize the operation to publish state. The following
lifecycles make that ownership explicit without introducing a general state-machine library.

| Lifecycle            | States / transitions                                                                    | Authority to publish                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Account-key vault    | loading → none / locked → unlocked; lock, reset, or clear invalidate pending work       | Vault epoch, unlock sequence, and record-read sequence; stale reads cannot install records or keys.                  |
| Console refresh      | identity change → empty / loading → ready                                               | Identity-effect cleanup and refresh sequence invalidate old account responses.                                       |
| Device-connect UI    | entry → loading → review → approving → done; conflict returns to review                 | Request generation owns lookup, offer refresh, and approval results. Only one approval starts at a time.             |
| Inbox cache          | absent → pending → fulfilled; rejected → absent                                         | A failed promise may remove only its own cache entry.                                                                |
| Client event polling | polling ↔ waiting → results / timeout / aborted                                        | Cancellation and deadline are checked after requests; each wait removes its abort listener.                          |
| Database transaction | starting → active → committing → committed                                              | Callback failure rolls back; failure during COMMIT is an unknown outcome, not proof of rollback.                     |
| Billing outbox       | pending → leased → delivered / retryable; retry-window expiry → reconciliation          | Exact lease value, unexpired lease, pending status, and provider idempotency window fence writes.                    |
| Deletion job         | pending → leased → cleanup checkpoints → completed → periodic sweep                     | Exact, unexpired claim fences checkpoints and completion; ownership is renewed before subsequent destructive stages. |
| Capture spool        | idle → draining; more work requests another drain; stop / invalid / finish are terminal | A single drainer owns queued work; its filesystem lock must outlive in-flight work.                                  |

## Boundaries that must remain explicit

### Unknown commit outcomes

`withTransaction` throws `TransactionCommitUnknownError` if COMMIT fails, and discards the
connection. The server may already have committed the transaction. Upload, copy/restore, and
trace-ingestion cleanup must therefore retain copied ciphertext in that case. Retaining a
possible orphan is safer than deleting an object referenced by a committed version. Do not
reinterpret this error as a definite rollback or retry a non-idempotent operation blindly.

An ordinary callback failure still rolls back. If rollback itself fails, the connection is
discarded while preserving the original failure.

### Leases are ownership, not exactly-once execution

Use PostgreSQL's full-precision timestamp text as the claim value; round-tripping through a
JavaScript Date loses precision. Use `clock_timestamp()` for expiry checks that occur after
waiting or external I/O, because `now()` is fixed at transaction start.

An external operation already in flight cannot be recalled when a lease expires. Billing
providers still need stable idempotency keys and bounded retry windows. Deletion actions must
remain repeatable, and a worker that loses its claim must not advance to another stage or
overwrite a replacement worker's checkpoint. Prefix sweeps continue after completion to
remove objects from previously authorized uploads that arrive late.

### Browser ownership

Check ownership after asynchronous reads and cryptography, before publishing data, errors, or
secret material. Invalidating an operation does not necessarily abort its network request.
On account changes, clear visible data and key-derived caches as well as invalidating requests.

### Capture shutdown

Stopping or timing out a drain does not mean an already-started write has settled. Keep the
lock while that write is in flight, avoid starting further queued writes, and preserve queued
data for recovery. A lock's age alone does not prove its process is dead.

## Existing transactional lifecycles

Not every lifecycle needs a new enum. Device authorization already has pending, approved,
denied, and consumed states, row locks, expiry checks, and offering-key revalidation at
exchange. File upload/commit and version mutations already serialize database changes and
use idempotency and expected-version checks. Preserve those guards rather than layering a
second, independent source of state on top of them.

Regression coverage lives beside the corresponding vault, inbox, client, transaction,
billing, deletion, and capture modules, with device-connect coverage in the agent-login
Playwright suite. These tests exercise superseded operations and ownership loss, not just
the successful path.

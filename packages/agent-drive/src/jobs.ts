import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentDriveApiError, StreamSizeLimitError } from './client.js';
import { WorkerUnavailableError } from './job-command.js';
import type { AgentDriveClient, FileEntry, RecentEvent, RecentPage, Version } from './client.js';
import { plaintextSize } from './crypto-format.js';

/**
 * Filesystem-mounted jobs on a dedicated drive.
 *
 * An agent writes a draft under /jobs/<id>/request.md plus flat attachments under
 * /jobs/<id>/inputs/, then submits by renaming request.md to submitted.md (a
 * version-guarded rename through `agent-drive jobs submit` or the dashboard's
 * Submit action). That rename produces the durable submission event a worker
 * dispatches on — the file at submitted.md is evidence, not the trigger, and
 * the event pins the exact request version the run must execute. A worker
 * claims each id with a private receipt under /jobs/.agent-drive/claims/ plus a
 * visible create-only /jobs/<id>/status.json, runs the handler, writes
 * /jobs/<id>/outputs/<name>, then marks the claim done or failed. The receipt
 * is the authoritative record: it carries the claimed, running and terminal
 * state, the approved request version and the committed output versions. The
 * worker never reads drafts, foreign paths or jobs on other drives, and never
 * executes anything derived from a request's contents.
 */

export type JobFile = { name: string; bytes: Uint8Array };

export type JobInput = {
  id: string;
  /** The pinned plaintext of the submitted request version. */
  request: Uint8Array;
  /** Flat input attachments, pinned at pickup, sorted by path. */
  inputs: JobFile[];
};

export type JobHandler = {
  (job: JobInput, signal: AbortSignal): Promise<JobFile[]>;
  /**
   * Optional readiness probe run at startup and again before every claim. A
   * throw stops claiming — including the adapter's WorkerUnavailableError,
   * which is matched by name so the check survives package duplication.
   */
  assertReady?(): void;
};

/** Narrow client surfaces so each entry point can be used with a restricted client. */
export type InitJobsClient = Pick<AgentDriveClient, 'put'>;
export type SubmitJobClient = Pick<AgentDriveClient, 'getVersionMetadata' | 'rename'>;
export type RunJobsClient = Pick<
  AgentDriveClient,
  'get' | 'getVersionMetadata' | 'put' | 'list' | 'recent' | 'recentHead' | 'pendingJobSubmissions'
>;

export const JOBS_README_PATH = '/jobs/README.md';

export const JOB_LIMITS = {
  requestBytes: 64 * 1024,
  maxInputs: 16,
  inputBytes: 8 * 1024 * 1024,
  totalInputBytes: 32 * 1024 * 1024,
  /** Outputs reuse the input budget so a runaway handler cannot flood the drive. */
  maxOutputs: 16,
  outputBytes: 8 * 1024 * 1024,
  totalOutputBytes: 32 * 1024 * 1024,
} as const;

const JOBS_PREFIX = '/jobs/';
const CLAIM_PREFIX = '/jobs/.agent-drive/claims/';
// The server's MAX_PAGE_SIZE (apps/web/src/api/validation.ts). Never exceed it.
const PAGE_LIMIT = 100;
// In-memory dedupe state stays bounded on long-running workers.
const SETTLED_LIMIT = 4096;
const BACKOFF_LIMIT = 1024;
const BACKOFF_MAX_MS = 300_000;
// Bounded stall evidence for a listing that repeats cursors.
const CURSOR_TRACK_LIMIT = 16;

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const JOB_PATH = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/([^/].*)$/;

const utf8 = new TextEncoder();

export type JobFailureReason =
  | 'request_missing'
  | 'request_too_large'
  | 'request_unavailable'
  | 'too_many_inputs'
  | 'invalid_input_name'
  | 'input_too_large'
  | 'inputs_too_large'
  | 'input_unavailable'
  | 'handler_error'
  | 'invalid_output'
  | 'output_commit_failed'
  | 'internal_error';

export type SubmitJobResult = {
  id: string;
  /** The canonical submission path, /jobs/<id>/submitted.md. */
  path: string;
  /**
   * submitted — the draft was moved by this call (or its lost acknowledgement
   * reconciled); present — submitted.md exists but pickup cannot be proven;
   * claimed — the protected worker receipt exists.
   */
  state: 'submitted' | 'present' | 'claimed';
  versionId: string;
};

export type InitJobsResult = { path: string; created: boolean };

export type RunJobsOptions = {
  /** Drain the submissions visible in one pass and return (reporting errors). */
  once: boolean;
  /** Cooperative stop; a job in flight stays held as running for manual recovery. */
  signal?: AbortSignal;
  /** Base event poll interval right after activity (default 4s). */
  pollMs?: number;
  /** Poll ceiling while idle; the interval doubles to this (default 45s). */
  pollMaxMs?: number;
  /** Rare full reconcile covering lost event joins (default 1h). */
  rescanMs?: number;
  /** Base backoff after a discovery or claim outage (default 5s). */
  retryMs?: number;
  /** Sleep override for tests and schedulers; abort must cancel the wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const GUIDE = `# Agent Drive jobs

This is a dedicated jobs drive. Agents drop work under /jobs/<id>/, one trusted
worker executes it, and results land as ordinary encrypted files.

## Layout

/jobs/<id>/request.md            draft request (markdown). The worker never reads this.
/jobs/<id>/inputs/<name>         optional flat input files (no directories)
/jobs/<id>/submitted.md          the request the worker picks up
/jobs/<id>/status.json           worker-owned visible status
/jobs/<id>/outputs/<name>        worker-written results
/jobs/.agent-drive/claims/<id>.json  internal execution receipt (worker-owned)

## Submit a job

1. Write /jobs/<id>/request.md and any /jobs/<id>/inputs/<name> files.
2. Submit with \`agent-drive jobs submit <id>\` or the dashboard's Submit action.
   Both guard the source version and require submitted.md to be absent. The CLI
   uses metadata only and needs read+write scopes, but no local drive key.
   On Linux, mounted POSIX mv guards versions seen at the rename syscall, but may
   replace an existing destination when the key has delete. Prefer jobs submit or
   dashboard Submit when the destination must be absent.
3. The durable submission is the request.md -> submitted.md MOVE EVENT, not the
   file: the worker dispatches on that event and runs the exact request version
   it pins. A file that merely appears at submitted.md (a put, copy or restore)
   is never picked up, and if the pinned version is gone the job is dropped —
   the worker never substitutes a different version.
4. A queued job has a pending submit event and no receipt. Submitting again
   reports present unless the protected receipt proves pickup; status.json by
   itself does not prove a claim. A receipt without status.json is still claimed.

Job ids: ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$
Limits: request 64KiB; up to 16 inputs of 8MiB each, 32MiB total.
Outputs are held to the same budget.
The worker needs read+write scopes and a write path covering /jobs/, including
.agent-drive/claims/. A submitter's write paths should cover ONLY its own
request.md, submitted.md and inputs/ — never status.json, outputs/ or
.agent-drive/, which are worker-owned. Write paths limit writes, not reads: any
read-scoped key on this drive can see file metadata and download ciphertext
from other jobs; plaintext requires the drive key. Use separate drives for
privacy.

## status.json and the claims receipt are worker-owned — never edit or move them

The worker creates the execution receipt first, then status.json. The receipt is
an ordinary encrypted file on the drive, not access-restricted: drive readers can
see its metadata and ciphertext. It is the authoritative job record and durable
duplicate-run guard; keep it outside submitter write paths. It records the
approved requestVersionId, the running or terminal state, and each committed
output as {name, versionId} — including a failure's partial commits:

- {"state":"running"}    a worker claimed the job and may still be running
- {"state":"done"}       every output under outputs/ is committed
- {"state":"failed"}     a fixed "reason" code says why (no raw errors or secrets)

status.json keeps the same state plus name-only "outputs" for compatibility. A
queued submission has neither status.json nor a receipt. Once the receipt
exists, missing status.json means the worker is still creating visible state or
stopped before it could do so; the outcome is unknown and the id remains held.
Moving status.json aside never reruns the job because the receipt remains.

## Manual recovery

Jobs are never retried automatically. If a worker stops mid-job, status.json
stays "running" (or is absent while the receipt is present) and the id stays
claimed — partial results are never marked done. To recover, create the job
again under a NEW id (request.md + inputs, then submit). Deleting both
status.json and the receipt to force a rerun is deliberately unsupported.
`;

function isNotFound(error: unknown) {
  return error instanceof AgentDriveApiError && error.status === 404;
}

function isPermanentAuthorizationFailure(error: unknown) {
  return error instanceof AgentDriveApiError && (error.status === 401 || error.status === 403);
}

/** The adapter's shared error base; subclasses such as cleanup failures are fatal too. */
function isWorkerUnavailable(error: unknown) {
  return error instanceof WorkerUnavailableError;
}

/**
 * The durable submit signal: a `move` of /jobs/<id>/request.md to the same id's
 * submitted.md carrying the submitted versionId. Every event is re-qualified —
 * servers without the jobSubmissions flag may return unfiltered pages, and a
 * file simply appearing at submitted.md (a put, copy or restore) is never a
 * submission. Returns the id and the pinned request version, or null.
 */
function submissionOf(event: RecentEvent): { id: string; versionId: string } | null {
  if (event.operation !== 'move' || event.versionId === null) return null;
  const parts = jobPathParts(event.path);
  if (!parts || parts[1] !== 'submitted.md') return null;
  const id = parts[0];
  return event.previousPath === `${JOBS_PREFIX}${id}/request.md`
    ? { id, versionId: event.versionId }
    : null;
}

/** A create-only collision that can only mean the id was claimed before. */
function isClaimed(error: unknown) {
  return (
    error instanceof AgentDriveApiError &&
    error.status === 409 &&
    (error.state === 'exists' || error.state === 'trashed')
  );
}

class JobFailure extends Error {
  constructor(readonly reason: JobFailureReason) {
    super(reason);
    this.name = 'JobFailure';
  }
}

function jobDirectory(id: string) {
  if (!JOB_ID.test(id))
    throw new TypeError(
      'A job id is 1-64 ASCII characters: alphanumeric, then alphanumeric, "_" or "-".',
    );
  return `/jobs/${id}`;
}

/** The job id and intra-directory remainder of a /jobs/<id>/<rest> path, or null. */
function jobPathParts(path: string): [id: string, rest: string] | null {
  const match = JOB_PATH.exec(path);
  const id = match?.[1];
  const rest = match?.[2];
  return id !== undefined && rest !== undefined ? [id, rest] : null;
}

/**
 * A flat file name: no separators, dot segments, or control characters, and at
 * most 255 UTF-8 bytes (the filesystem byte limit, not a character count).
 */
function validFileName(name: string) {
  if (name === '' || name === '.' || name === '..') return false;
  if (utf8.encode(name).byteLength > 255) return false;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || ch === '/' || ch === '\\') return false;
  }
  return true;
}

/** Case- and normalization-folded key for detecting ambiguous duplicate names. */
function nameKey(name: string) {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Throws on a repeated or stalled page cursor so a buggy listing can never loop
 * forever. `cursors` is a small per-scan set that tracks only recent cursors.
 */
function guardPageCursor(cursors: Set<string>, previous: string | undefined, next: string | null) {
  if (next === null) return;
  if (next === previous || cursors.has(next))
    throw new AgentDriveApiError(
      'internal_error',
      502,
      'The drive listing returned a stalled cursor.',
    );
  cursors.add(next);
  const oldest = cursors.keys().next().value;
  if (cursors.size > CURSOR_TRACK_LIMIT && oldest !== undefined) cursors.delete(oldest);
}

/**
 * Creates /jobs/README.md with the operator guide. Idempotent: an existing
 * (even trashed) README is left untouched; any other conflict is an error.
 */
export async function initJobs(client: InitJobsClient, driveId: string): Promise<InitJobsResult> {
  try {
    await client.put(driveId, JOBS_README_PATH, utf8.encode(GUIDE), { mode: 'create' });
    return { path: JOBS_README_PATH, created: true };
  } catch (error) {
    if (isClaimed(error)) return { path: JOBS_README_PATH, created: false };
    throw error;
  }
}

/**
 * Submits a draft: atomically renames /jobs/<id>/request.md to submitted.md,
 * guarded by the draft's current version and an absent destination. An existing
 * submission is reported present unless its protected receipt proves pickup; a
 * lost acknowledgement is reconciled only when the destination carries the
 * pinned draft version — anything else is a conflict owned by someone else.
 */
export async function submitJob(
  client: SubmitJobClient,
  driveId: string,
  id: string,
): Promise<SubmitJobResult> {
  const dir = jobDirectory(id);
  const requestPath = `${dir}/request.md`;
  const submittedPath = `${dir}/submitted.md`;
  const statusPath = `${dir}/status.json`;
  const receiptPath = `${CLAIM_PREFIX}${id}.json`;

  const metadata = async (path: string) => {
    try {
      return await client.getVersionMetadata(driveId, path);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  const existing = await metadata(submittedPath);
  if (existing) {
    // status.json is visible and can be copied or forged; only the protected
    // receipt proves that the worker claimed this id.
    const receipt = await metadata(receiptPath);
    return {
      id,
      path: submittedPath,
      state: receipt ? 'claimed' : 'present',
      versionId: existing.id,
    };
  }

  // The receipt is the authoritative record even when the submission and status
  // were moved aside: a held id with no visible submission path is a clear
  // conflict, never an invitation to rename the draft into a duplicate run.
  const heldReceipt = await metadata(receiptPath);
  const heldStatus = heldReceipt ? null : await metadata(statusPath);
  if (heldReceipt || heldStatus)
    throw new AgentDriveApiError('conflict', 409, `Job "${id}" is already claimed.`, {
      state: 'exists',
    });

  const draft = await metadata(requestPath);
  if (!draft) throw new AgentDriveApiError('not_found', 404, `No job draft exists for "${id}".`);

  try {
    const renamed = await client.rename(driveId, requestPath, submittedPath, {
      ifSourceVersionId: draft.id,
      ifDestinationVersionId: null,
      operationId: randomUUID(),
    });
    return { id, path: submittedPath, state: 'submitted', versionId: renamed.versionId };
  } catch (error) {
    // A rename to an absent destination preserves the source version, so a
    // submitted.md carrying the pinned draft version can only be this call's
    // landed submission. A different version belongs to someone else's
    // instruction and must surface as a conflict, not as our success.
    let landed: Version | null = null;
    try {
      landed = await metadata(submittedPath);
    } catch {
      // The recheck itself failed; keep the original error.
    }
    if (landed && landed.id === draft.id)
      return { id, path: submittedPath, state: 'submitted', versionId: landed.id };
    if (landed)
      throw new AgentDriveApiError(
        'conflict',
        409,
        `Job "${id}" was already submitted by a different request.`,
        { state: 'exists', currentVersionId: landed.id },
      );
    throw error;
  }
}

/**
 * Runs jobs from a dedicated drive until the signal aborts (or once drains one
 * pass and reports acquisition errors). Watch mode captures a head cursor BEFORE
 * the startup scan, then follows the commit-ordered event feed with adaptive
 * abortable pacing — never polling every couple of seconds and never relisting
 * the whole drive per poll. A rare paced reconcile (rescanMs) plus per-job
 * backoff cover lost joins and transient claim failures.
 */
export async function runJobs(
  client: RunJobsClient,
  driveId: string,
  handler: JobHandler,
  options: RunJobsOptions,
): Promise<void> {
  const signal = options.signal;
  // timers/promises setTimeout takes the signal directly: abort cancels the
  // underlying timer instead of leaving a referenced handle behind.
  const sleep =
    options.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      delay(ms, undefined, signal ? { signal } : undefined).then(() => {}));
  const basePollMs = options.pollMs ?? 4_000;
  const pollMaxMs = options.pollMaxMs ?? 45_000;
  const rescanMs = options.rescanMs ?? 3_600_000;
  const retryMs = options.retryMs ?? 5_000;
  const jobSignal = signal ?? new AbortController().signal;

  /**
   * Ids claimed by anyone or dispatched by this worker: never reconsidered.
   * Bounded; evicting an old id can only cost one harmless re-claim conflict.
   */
  const settled = new Set<string>();
  const remember = (id: string) => {
    backoff.delete(id);
    settled.delete(id);
    settled.add(id);
    const oldest = settled.keys().next().value;
    if (settled.size > SETTLED_LIMIT && oldest !== undefined) settled.delete(oldest);
  };
  const isSettled = (id: string) => {
    if (!settled.has(id)) return false;
    remember(id);
    return true;
  };
  /** Discovered submissions awaiting pickup, keyed by id and pinned version. */
  const pending = new Map<string, { versionId: string }>();
  /**
   * Per-id exponential backoff for recoverable claim/discovery failures. The
   * entry survives while a retry is queued so the delay keeps GROWING across
   * attempts instead of resetting; it is cleared on success, on a permanent
   * rejection, or when the id is remembered settled.
   */
  const backoff = new Map<string, { at: number; delay: number; versionId: string }>();
  /** First discovery/acquisition error; once mode reports it after the drain. */
  let firstError: unknown;
  /** A terminal receipt could not be saved; watch mode must stop with its diagnosis. */
  let terminalPersistenceFailure: Error | undefined;

  const enqueue = (submission: { id: string; versionId: string }) => {
    const { id, versionId } = submission;
    if (!JOB_ID.test(id) || isSettled(id)) return;
    const cool = backoff.get(id);
    if (cool !== undefined) {
      // A newer submit event supersedes: the retry pins the latest version.
      cool.versionId = versionId;
      if (cool.at > Date.now()) return;
    }
    pending.set(id, { versionId });
  };

  const retryLater = (id: string, versionId: string) => {
    const prior = backoff.get(id);
    const nextDelay = Math.min((prior?.delay ?? retryMs) * 2, BACKOFF_MAX_MS);
    backoff.set(id, {
      at: Date.now() + (prior?.delay ?? retryMs),
      delay: nextDelay,
      versionId,
    });
    const oldest = backoff.keys().next().value;
    if (backoff.size > BACKOFF_LIMIT && oldest !== undefined) backoff.delete(oldest);
  };

  const recordError = (error: unknown) => {
    if (firstError === undefined) firstError = error;
  };

  /** Sanitized operator-facing error for an ambiguous terminal write. */
  const persistenceError = (id: string) =>
    new Error(
      `Job "${id}": its terminal state may not have persisted; check status.json ` +
        'and the claims receipt before any manual recovery.',
    );

  const recordPersistenceError = (id: string) => {
    const error = persistenceError(id);
    terminalPersistenceFailure ??= error;
    recordError(error);
  };

  const nap = async (ms: number) => {
    if (!signal) return sleep(ms);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      sleep(ms, signal).then(onAbort, (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
      if (signal.aborted) onAbort();
    });
  };

  const headCursor = () => client.recentHead(driveId, signal);

  /** Newest-first tail cursor, captured BEFORE a scan so the join cannot be lost. */
  let cursor: string | null = null;

  const observe = (event: RecentEvent) => {
    // Only the durable submit event enqueues work. Draft writes, status writes,
    // outputs, deletes and files merely appearing at submitted.md are ignored.
    const submission = submissionOf(event);
    if (submission) enqueue(submission);
  };

  const runOne = async (id: string, versionId: string) => {
    if (signal?.aborted) return;
    const dir = `/jobs/${id}`;
    const submittedPath = `${dir}/submitted.md`;
    const statusPath = `${dir}/status.json`;
    const inputsPrefix = `${dir}/inputs/`;
    const receiptPath = `${CLAIM_PREFIX}${id}.json`;

    // This pinned metadata query also proves that the current live file at this
    // path still owns the submitted version. A missing, moved, trashed, or
    // replaced file is dropped without an unpinned metadata request.
    let requestMeta: Version;
    try {
      requestMeta = await client.getVersionMetadata(driveId, submittedPath, {
        versionId,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (isNotFound(error)) {
        backoff.delete(id);
        return;
      }
      if (!isPermanentAuthorizationFailure(error)) retryLater(id, versionId);
      throw error;
    }

    // The durable receipt is the authoritative claim: it survives the visible
    // status file being moved aside, so an already-executed job can never rerun.
    // Claim BEFORE any handler invocation or content download. A conflict —
    // including a trashed receipt — means a previous worker owns the id forever.
    // An ambiguous error must never run: the job backs off and is rediscovered,
    // where a landed receipt surfaces as the conflict and a lost one can retry.
    const claimedAt = new Date().toISOString();
    let receipt: Version;
    try {
      receipt = await client.put(
        driveId,
        receiptPath,
        utf8.encode(
          `${JSON.stringify({
            version: 1,
            job: id,
            state: 'running',
            requestVersionId: versionId,
            claimedAt,
          })}\n`,
        ),
        { mode: 'create', ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      if (isClaimed(error)) remember(id);
      else {
        if (!isPermanentAuthorizationFailure(error)) retryLater(id, versionId);
        throw error;
      }
      return;
    }

    // The visible status guard is written only by the receipt holder, so a live
    // worker's status is never overwritten. Any failure after the receipt landed
    // means the id is claimed: the job stays held rather than ever rerunning.
    let claim: Version;
    try {
      claim = await client.put(
        driveId,
        statusPath,
        utf8.encode(
          `${JSON.stringify({
            version: 1,
            job: id,
            state: 'running',
            startedAt: new Date().toISOString(),
          })}\n`,
        ),
        { mode: 'create', ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      remember(id);
      if (!isClaimed(error)) throw error;
      return;
    }
    remember(id);
    const startedAt = new Date().toISOString();
    /** Every output version committed so far; the receipt records all of them. */
    const committed: { name: string; versionId: string }[] = [];

    /**
     * Guarded terminal updates: the authoritative receipt first, then the
     * visible status. Either write failing leaves the outcome ambiguous — the
     * running claim stays held, committed outputs are never rolled back, and
     * the ambiguity is reported rather than guessed away.
     */
    const persistTerminal = async (state: 'done' | 'failed', reason?: JobFailureReason) => {
      const finishedAt = new Date().toISOString();
      const receiptBody = {
        version: 1,
        job: id,
        state,
        ...(reason !== undefined ? { reason } : {}),
        requestVersionId: versionId,
        claimedAt,
        finishedAt,
        outputs: committed,
      };
      const statusBody = {
        version: 1,
        job: id,
        state,
        claimedBy: claim.agentId,
        startedAt,
        finishedAt,
        ...(state === 'done' ? { outputs: committed.map((output) => output.name) } : { reason }),
      };
      try {
        await client.put(driveId, receiptPath, utf8.encode(`${JSON.stringify(receiptBody)}\n`), {
          ifVersionId: receipt.id,
          ...(signal ? { signal } : {}),
        });
      } catch {
        // Never publish a terminal visible state without its authoritative receipt.
        recordPersistenceError(id);
        return;
      }
      try {
        await client.put(driveId, statusPath, utf8.encode(`${JSON.stringify(statusBody)}\n`), {
          ifVersionId: claim.id,
          ...(signal ? { signal } : {}),
        });
      } catch {
        // The receipt is already durable. Preserve it and report the visible
        // status discrepancy rather than trying to roll back the receipt.
        recordPersistenceError(id);
      }
    };

    type Stage = 'request' | 'inputs' | 'handler' | 'outputs' | 'finalize';
    const reasonFor = (stage: Stage, error: unknown): JobFailureReason => {
      if (error instanceof JobFailure) return error.reason;
      if (error instanceof StreamSizeLimitError)
        return stage === 'request' ? 'request_too_large' : 'input_too_large';
      if (stage === 'request') return isNotFound(error) ? 'request_missing' : 'request_unavailable';
      if (stage === 'inputs') return 'input_unavailable';
      if (stage === 'handler') return 'handler_error';
      if (stage === 'outputs') return 'output_commit_failed';
      return 'internal_error';
    };

    let stage: Stage = 'request';
    try {
      // The pinned request version is the metadata observed at pickup; the size
      // bound is enforced from ciphertext metadata before any download.
      let requestSize: number;
      try {
        requestSize = plaintextSize(requestMeta.ciphertextSize);
      } catch {
        throw new JobFailure('request_unavailable');
      }
      if (requestSize > JOB_LIMITS.requestBytes) throw new JobFailure('request_too_large');

      stage = 'inputs';
      const inputEntries: FileEntry[] = [];
      let pageCursor: string | undefined;
      const cursors = new Set<string>();
      do {
        if (signal?.aborted) return;
        const page = await client.list(
          driveId,
          inputsPrefix,
          PAGE_LIMIT,
          pageCursor,
          undefined,
          signal,
        );
        for (const entry of page.items) {
          // The prefix is advisory: only ever use paths proven under inputs/.
          if (!entry.path.startsWith(inputsPrefix)) throw new JobFailure('invalid_input_name');
          inputEntries.push(entry);
          if (inputEntries.length > JOB_LIMITS.maxInputs) throw new JobFailure('too_many_inputs');
        }
        const next = page.nextCursor;
        guardPageCursor(cursors, pageCursor, next);
        pageCursor = next ?? undefined;
      } while (pageCursor);

      const inputNames = new Set<string>();
      let inputBytes = 0;
      for (const entry of inputEntries) {
        const name = entry.path.slice(inputsPrefix.length);
        if (!validFileName(name) || inputNames.has(nameKey(name)))
          throw new JobFailure('invalid_input_name');
        inputNames.add(nameKey(name));
        let size: number;
        try {
          size = plaintextSize(entry.ciphertextSize);
        } catch {
          throw new JobFailure('input_unavailable');
        }
        if (size > JOB_LIMITS.inputBytes) throw new JobFailure('input_too_large');
        inputBytes += size;
        if (inputBytes > JOB_LIMITS.totalInputBytes) throw new JobFailure('inputs_too_large');
      }

      stage = 'request';
      const request = (
        await client.get(driveId, submittedPath, {
          versionId,
          maxPlaintextBytes: JOB_LIMITS.requestBytes,
          ...(signal ? { signal } : {}),
        })
      ).bytes;
      stage = 'inputs';
      const inputs: JobFile[] = [];
      for (const entry of inputEntries) {
        inputs.push({
          name: entry.path.slice(inputsPrefix.length),
          bytes: (
            await client.get(driveId, entry.path, {
              versionId: entry.versionId,
              maxPlaintextBytes: JOB_LIMITS.inputBytes,
              ...(signal ? { signal } : {}),
            })
          ).bytes,
        });
      }

      stage = 'handler';
      if (signal?.aborted) return;
      const produced = await handler({ id, request, inputs }, jobSignal);
      if (signal?.aborted) return;

      stage = 'outputs';
      if (!Array.isArray(produced) || produced.length > JOB_LIMITS.maxOutputs)
        throw new JobFailure('invalid_output');
      const outputNames = new Set<string>();
      let outputBytes = 0;
      for (const output of produced) {
        if (
          !output ||
          typeof output.name !== 'string' ||
          !validFileName(output.name) ||
          !(output.bytes instanceof Uint8Array)
        )
          throw new JobFailure('invalid_output');
        const folded = nameKey(output.name);
        if (outputNames.has(folded)) throw new JobFailure('invalid_output');
        outputNames.add(folded);
        outputBytes += output.bytes.byteLength;
        if (
          output.bytes.byteLength > JOB_LIMITS.outputBytes ||
          outputBytes > JOB_LIMITS.totalOutputBytes
        )
          throw new JobFailure('invalid_output');
      }
      for (const output of produced) {
        const wrote = await client.put(driveId, `${dir}/outputs/${output.name}`, output.bytes, {
          mode: 'create',
          ...(signal ? { signal } : {}),
        });
        committed.push({ name: output.name, versionId: wrote.id });
      }

      stage = 'finalize';
      await persistTerminal('done');
    } catch (error) {
      // A stopped worker leaves the claim held as running for manual recovery.
      if (signal?.aborted) return;
      // A dead executable is fatal for the worker, not a job failure.
      if (isWorkerUnavailable(error)) throw error;
      await persistTerminal('failed', reasonFor(stage, error));
    }
  };

  const drain = async () => {
    // Requeue ids whose backoff elapsed before taking new work. The backoff
    // entry stays so a failed retry keeps the grown delay.
    const now = Date.now();
    for (const [id, cool] of backoff)
      if (cool.at <= now && !isSettled(id)) pending.set(id, { versionId: cool.versionId });
    for (;;) {
      if (signal?.aborted) return;
      const next = pending.entries().next().value as [string, { versionId: string }] | undefined;
      if (next === undefined) return;
      const [id, submission] = next;
      pending.delete(id);
      if (isSettled(id)) continue;
      // Readiness is re-checked before every claim; a dead executable is fatal.
      await handler.assertReady?.();
      try {
        await runOne(id, submission.versionId);
      } catch (error) {
        // Acquisition errors are remembered for the once-mode report; a single
        // bad job — buggy or not — never kills the worker or starves the next.
        if (
          isWorkerUnavailable(error) ||
          isPermanentAuthorizationFailure(error) ||
          error === terminalPersistenceFailure
        )
          throw error;
        recordError(error);
      }
      if (!options.once && terminalPersistenceFailure) throw terminalPersistenceFailure;
    }
  };

  /**
   * One pass over the durable submission feed. Each page is re-qualified and
   * drained before the next is fetched, so memory stays bounded.
   */
  const scan = async () => {
    const cursors = new Set<string>();
    let pageCursor: string | undefined;
    do {
      if (signal?.aborted) return;
      const page = await client.pendingJobSubmissions(driveId, PAGE_LIMIT, pageCursor, signal);
      for (const event of page.items) observe(event);
      const next = page.nextCursor;
      guardPageCursor(cursors, pageCursor, next);
      pageCursor = next ?? undefined;
      await drain();
    } while (pageCursor);
  };

  const follow = async (page: RecentPage, firstCursor: string | undefined) => {
    const cursors = new Set<string>();
    let previous = firstCursor;
    for (;;) {
      if (signal?.aborted) return;
      for (const event of page.items) observe(event);
      if (page.latestCursor) cursor = page.latestCursor;
      await drain();
      if (!page.nextCursor) return;
      guardPageCursor(cursors, previous, page.nextCursor);
      previous = page.nextCursor;
      page = await client.recent(driveId, undefined, PAGE_LIMIT, page.nextCursor, signal);
    }
  };

  if (options.once) {
    await handler.assertReady?.();
    await scan();
    // Report the first discovery or acquisition failure instead of a false pass.
    if (firstError !== undefined && !signal?.aborted) throw firstError;
    return;
  }
  if (signal?.aborted) return;
  await handler.assertReady?.();

  let pollMs = basePollMs;
  // The startup scan runs as the loop's first reconcile: a transient outage at
  // boot recovers like any other poll failure instead of killing the worker.
  let nextReconcile = Date.now();

  /**
   * Captures the head BEFORE the reconcile scan so the join cannot be lost, then
   * advances the cursor only if the scan succeeded: a failed scan keeps the
   * older cursor so its unobserved events stay in the follow stream.
   */
  const reconcile = async () => {
    const head = await headCursor();
    await scan();
    if (head) cursor = head;
    nextReconcile = Date.now() + rescanMs;
  };

  for (;;) {
    if (signal?.aborted) return;
    try {
      if (Date.now() >= nextReconcile) await reconcile();
      const page = await client.recent(driveId, undefined, PAGE_LIMIT, cursor ?? undefined, signal);
      const idle = page.items.length === 0;
      await follow(page, cursor ?? undefined);
      await drain();
      await nap(pollMs);
      // Adaptive pacing: settle at the base interval after activity and double
      // toward the ceiling while idle.
      pollMs = idle ? Math.min(pollMs * 2, pollMaxMs) : basePollMs;
    } catch (error) {
      if (signal?.aborted) return;
      if (
        isWorkerUnavailable(error) ||
        isPermanentAuthorizationFailure(error) ||
        error === terminalPersistenceFailure
      )
        throw error;
      // Timeout or transport outage: pace, then reconcile from a fresh head
      // captured before the recovery scan plus the authoritative cursor.
      await nap(retryMs);
      if (signal?.aborted) return;
      try {
        await reconcile();
      } catch (error) {
        if (signal?.aborted) return;
        if (
          isWorkerUnavailable(error) ||
          isPermanentAuthorizationFailure(error) ||
          error === terminalPersistenceFailure
        )
          throw error;
        // Still down; the outer loop keeps the paced cadence.
      }
    }
  }
}

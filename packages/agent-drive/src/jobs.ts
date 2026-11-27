import { randomUUID } from 'node:crypto';
import { AgentDriveApiError, StreamSizeLimitError } from './client.js';
import type { AgentDriveClient, FileEntry, RecentEvent, RecentPage, Version } from './client.js';
import { plaintextSize } from './crypto-format.js';

/**
 * Filesystem-mounted jobs on a dedicated drive.
 *
 * An agent writes a draft under /jobs/<id>/request.md plus flat attachments under
 * /jobs/<id>/inputs/, then submits by renaming request.md to submitted.md (a
 * version-guarded rename through `agent-drive jobs submit` or the dashboard's
 * Submit action). A worker discovers submitted.md files, claims each id with a
 * private create-only receipt under /jobs/.agent-drive/claims/ plus a visible
 * create-only /jobs/<id>/status.json, runs the handler, writes
 * /jobs/<id>/outputs/<name>, then marks the claim done or failed. The worker
 * never reads drafts, foreign paths or jobs on other drives, and never executes
 * anything derived from a request's contents.
 */

export type JobFile = { name: string; bytes: Uint8Array };

export type JobInput = {
  id: string;
  /** The pinned plaintext of /jobs/<id>/submitted.md at pickup. */
  request: Uint8Array;
  /** Flat input attachments, pinned at pickup, sorted by path. */
  inputs: JobFile[];
};

export type JobHandler = (job: JobInput, signal: AbortSignal) => Promise<JobFile[]>;

/** Narrow client surfaces so each entry point can be used with a restricted client. */
export type InitJobsClient = Pick<AgentDriveClient, 'put'>;
export type SubmitJobClient = Pick<AgentDriveClient, 'getVersionMetadata' | 'rename'>;
export type RunJobsClient = Pick<
  AgentDriveClient,
  'get' | 'getVersionMetadata' | 'list' | 'put' | 'recent'
> & {
  /**
   * Newest event-feed cursor (recentHead lands on AgentDriveClient in a parallel
   * change). Optional: without it the first poll walks the oldest events once
   * before settling on the tail.
   */
  recentHead?(driveId: string, signal?: AbortSignal): Promise<string | null>;
};

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
const SUBMIT_OPERATIONS = new Set<RecentEvent['operation']>(['put', 'copy', 'restore', 'move']);

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
   * reconciled); queued — a submission already existed; claimed — a status.json
   * already exists, so a worker owns or finished the job.
   */
  state: 'submitted' | 'queued' | 'claimed';
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
  /** Sleep override for tests and schedulers. */
  sleep?: (ms: number) => Promise<void>;
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
/jobs/.agent-drive/claims/<id>.json  private execution receipt (worker-owned)

## Submit a job

1. Write /jobs/<id>/request.md and any /jobs/<id>/inputs/<name> files.
2. Submit with \`agent-drive jobs submit <id>\` or the dashboard's Submit action.
   Both perform a version-guarded rename of request.md to submitted.md: the draft
   must still be what you wrote and the destination must not exist. A plain mv or
   \`agent-drive mv\` is NOT version-guarded and can clobber a concurrent submitter.
3. A submission already present means the job is queued; a status.json or a claim
   receipt means it is claimed. Submitting again never creates a duplicate run.

Job ids: ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$
Limits: request 64KiB; up to 16 inputs of 8MiB each, 32MiB total.
Outputs are held to the same budget.
Runner credentials need read+write over all of /jobs/, including .agent-drive/.

## status.json and the claims receipt are worker-owned — never edit or move them

Before dispatch the worker creates BOTH the receipt and status.json create-only.
Either existing — even trashed — means the id is claimed forever:

- {"state":"running"}    a worker claimed the job and may still be running
- {"state":"done"}       every output under outputs/ is committed
- {"state":"failed"}     a fixed "reason" code says why (no raw errors or secrets)

The receipt survives the visible status file being moved aside, so a moved or
missing status.json does NOT rerun an already-executed job. submitted.md with no
status.json means the claim lives in the receipt: the worker died mid-claim or
the visible status was moved; the job stays claimed.

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
 * guarded by the draft's current version and an absent destination. A submission
 * that already exists is reported queued (or claimed) and never duplicated; a
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
    // The status check must answer truthfully: an API or auth failure is not a queue.
    const status = await metadata(statusPath);
    return {
      id,
      path: submittedPath,
      state: status ? 'claimed' : 'queued',
      versionId: existing.id,
    };
  }

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
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
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
  const pending = new Map<string, true>();
  /** Per-id exponential backoff for recoverable claim/discovery failures. */
  const backoff = new Map<string, { at: number; delay: number }>();
  /** First discovery/acquisition error; once mode reports it after the drain. */
  let firstError: unknown;

  const enqueue = (id: string) => {
    if (!JOB_ID.test(id) || isSettled(id) || pending.has(id)) return;
    const cool = backoff.get(id);
    if (cool !== undefined && cool.at > Date.now()) return;
    pending.set(id, true);
  };

  const retryLater = (id: string) => {
    const prior = backoff.get(id);
    const delay = Math.min((prior?.delay ?? retryMs) * 2, BACKOFF_MAX_MS);
    backoff.set(id, { at: Date.now() + (prior?.delay ?? retryMs), delay });
    const oldest = backoff.keys().next().value;
    if (backoff.size > BACKOFF_LIMIT && oldest !== undefined) backoff.delete(oldest);
  };

  const recordError = (error: unknown) => {
    if (firstError === undefined) firstError = error;
  };

  const nap = async (ms: number) => {
    if (!signal) return sleep(ms);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      sleep(ms).then(onAbort, (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
      if (signal.aborted) onAbort();
    });
  };

  const headCursor = async () => {
    if (!client.recentHead) return null;
    return client.recentHead(driveId, signal);
  };

  /** Newest-first tail cursor, captured BEFORE a scan so the join cannot be lost. */
  let cursor: string | null = null;
  if (!options.once) {
    try {
      cursor = await headCursor();
    } catch {
      if (signal?.aborted) return;
      // A null cursor makes the first poll walk the oldest events once — bounded
      // — then settle on the last-row cursor the feed returns.
    }
  }

  const observe = (event: RecentEvent) => {
    const parts = jobPathParts(event.path);
    if (!parts) return;
    const [id, rest] = parts;
    // Only a submission enqueues work. Draft writes, status writes, outputs and
    // deletes are deliberately ignored — pickup verifies state truthfully.
    if (rest === 'submitted.md' && SUBMIT_OPERATIONS.has(event.operation)) enqueue(id);
  };

  const fail = async (
    id: string,
    statusPath: string,
    claim: Version,
    startedAt: string,
    reason: JobFailureReason,
  ) => {
    try {
      await client.put(
        driveId,
        statusPath,
        utf8.encode(
          `${JSON.stringify({
            version: 1,
            job: id,
            state: 'failed',
            claimedBy: claim.agentId,
            startedAt,
            finishedAt: new Date().toISOString(),
            reason,
          })}\n`,
        ),
        { ifVersionId: claim.id, ...(signal ? { signal } : {}) },
      );
    } catch {
      // The status is contested or the drive is unreachable: the running claim
      // stays held for manual new-id recovery rather than being clobbered.
    }
  };

  const runOne = async (id: string) => {
    const dir = `/jobs/${id}`;
    const submittedPath = `${dir}/submitted.md`;
    const statusPath = `${dir}/status.json`;
    const inputsPrefix = `${dir}/inputs/`;
    const receiptPath = `${CLAIM_PREFIX}${id}.json`;

    // Liveness check and request pin in one metadata call: a submission deleted
    // before pickup is dropped; anything else is a recoverable discovery error.
    let requestMeta: Version;
    try {
      requestMeta = await client.getVersionMetadata(driveId, submittedPath);
    } catch (error) {
      if (isNotFound(error)) return;
      retryLater(id);
      throw error;
    }

    // The durable receipt is the authoritative claim: it survives the visible
    // status file being moved aside, so an already-executed job can never rerun.
    // Claim BEFORE any handler invocation or content download. A conflict —
    // including a trashed receipt — means a previous worker owns the id forever.
    // An ambiguous error must never run: the job backs off and is rediscovered,
    // where a landed receipt surfaces as the conflict and a lost one can retry.
    try {
      await client.put(
        driveId,
        receiptPath,
        utf8.encode(
          `${JSON.stringify({ version: 1, job: id, claimedAt: new Date().toISOString() })}\n`,
        ),
        { mode: 'create', ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      if (isClaimed(error)) remember(id);
      else {
        retryLater(id);
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
        const page = await client.list(driveId, inputsPrefix, PAGE_LIMIT, pageCursor);
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
          versionId: requestMeta.id,
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
      for (const output of produced)
        await client.put(driveId, `${dir}/outputs/${output.name}`, output.bytes, {
          mode: 'create',
          ...(signal ? { signal } : {}),
        });

      stage = 'finalize';
      await client.put(
        driveId,
        statusPath,
        utf8.encode(
          `${JSON.stringify({
            version: 1,
            job: id,
            state: 'done',
            claimedBy: claim.agentId,
            startedAt,
            finishedAt: new Date().toISOString(),
            outputs: produced.map((output) => output.name),
          })}\n`,
        ),
        { ifVersionId: claim.id, ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      // A stopped worker leaves the claim held as running for manual recovery.
      if (signal?.aborted) return;
      await fail(id, statusPath, claim, startedAt, reasonFor(stage, error));
    }
  };

  const drain = async () => {
    // Requeue ids whose backoff elapsed before taking new work.
    const now = Date.now();
    for (const [id, cool] of backoff)
      if (cool.at <= now) {
        backoff.delete(id);
        enqueue(id);
      }
    for (;;) {
      if (signal?.aborted) return;
      const id = pending.keys().next().value as string | undefined;
      if (id === undefined) return;
      pending.delete(id);
      if (isSettled(id)) continue;
      try {
        await runOne(id);
      } catch (error) {
        // Acquisition errors are remembered for the once-mode report; a single
        // bad job — buggy or not — never kills the worker or starves the next.
        recordError(error);
      }
    }
  };

  /**
   * One pass over /jobs/. Entries for a job id sort contiguously, so only the
   * current id's flags live in memory; completed pages drain promptly.
   */
  const scan = async () => {
    const cursors = new Set<string>();
    let currentId: string | null = null;
    let hasSubmitted = false;
    let hasStatus = false;
    const finalize = () => {
      if (currentId !== null && hasSubmitted && !hasStatus) enqueue(currentId);
      currentId = null;
      hasSubmitted = false;
      hasStatus = false;
    };
    let pageCursor: string | undefined;
    do {
      const page = await client.list(driveId, JOBS_PREFIX, PAGE_LIMIT, pageCursor);
      for (const item of page.items) {
        const parts = jobPathParts(item.path);
        if (!parts) continue;
        const [id, rest] = parts;
        if (id !== currentId) {
          finalize();
          currentId = id;
        }
        if (rest === 'status.json') hasStatus = true;
        else if (rest === 'submitted.md') hasSubmitted = true;
      }
      const next = page.nextCursor;
      guardPageCursor(cursors, pageCursor, next);
      pageCursor = next ?? undefined;
      await drain();
    } while (pageCursor);
    finalize();
    await drain();
  };

  const follow = async (page: RecentPage, firstCursor: string | undefined) => {
    const cursors = new Set<string>();
    let previous = firstCursor;
    for (;;) {
      for (const event of page.items) observe(event);
      if (page.latestCursor) cursor = page.latestCursor;
      if (!page.nextCursor) return;
      guardPageCursor(cursors, previous, page.nextCursor);
      previous = page.nextCursor;
      page = await client.recent(driveId, undefined, PAGE_LIMIT, page.nextCursor, signal);
    }
  };

  await scan();
  if (options.once || signal?.aborted) {
    // Report the first discovery or acquisition failure instead of a false pass.
    if (firstError !== undefined && !signal?.aborted) throw firstError;
    return;
  }

  let pollMs = basePollMs;
  let nextReconcile = Date.now() + rescanMs;
  for (;;) {
    if (signal?.aborted) return;
    try {
      if (Date.now() >= nextReconcile) {
        // Capture the head BEFORE the reconcile scan so the join cannot be lost.
        const head = await headCursor();
        if (head) cursor = head;
        await scan();
        nextReconcile = Date.now() + rescanMs;
      }
      const page = await client.recent(driveId, undefined, PAGE_LIMIT, cursor ?? undefined, signal);
      const idle = page.items.length === 0;
      await follow(page, cursor ?? undefined);
      await drain();
      await nap(pollMs);
      // Adaptive pacing: settle at the base interval after activity and double
      // toward the ceiling while idle.
      pollMs = idle ? Math.min(pollMs * 2, pollMaxMs) : basePollMs;
    } catch {
      if (signal?.aborted) return;
      // Timeout or transport outage: pace, then reconcile from a fresh head
      // captured before the recovery scan plus the authoritative cursor.
      await nap(retryMs);
      if (signal?.aborted) return;
      try {
        const head = await headCursor();
        if (head) cursor = head;
        await scan();
        nextReconcile = Date.now() + rescanMs;
      } catch {
        if (signal?.aborted) return;
        // Still down; the outer loop keeps the paced cadence.
      }
    }
  }
}

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AgentDriveApiError, StreamSizeLimitError } from './client.js';
import type { FileEntry, RecentEvent, RecentPage, Version } from './client.js';
import { encryptedSize } from './crypto-format.js';
import { initJobs, JOB_LIMITS, runJobs, submitJob } from './jobs.js';
import type { JobFile, JobInput } from './jobs.js';

const DRIVE = '00000000-0000-4000-8000-0000000000d1';

const utf8 = new TextEncoder();
const textBytes = (value: string) => utf8.encode(value);

// The real server rejects limit > MAX_PAGE_SIZE=100 (apps/web/src/api/validation.ts:8).
const REAL_PAGE_LIMIT = 100;

type StoredFile = {
  fileId: string;
  versionId: string;
  path: string;
  bytes: Uint8Array;
  createdAt: string;
};

function versionObject(file: StoredFile): Version {
  return {
    id: file.versionId,
    path: file.path,
    ciphertextSize: encryptedSize(file.bytes.byteLength),
    wrappedKey: 'wrapped-key',
    agentId: 'agent-test',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: file.createdAt,
  };
}

function entryObject(file: StoredFile): FileEntry {
  return {
    fileId: file.fileId,
    versionId: file.versionId,
    path: file.path,
    ciphertextSize: encryptedSize(file.bytes.byteLength),
    agentId: 'agent-test',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: file.createdAt,
  };
}

function conflict(
  state: 'exists' | 'changed' | 'trashed' | 'absent',
  currentVersionId: string | null,
  message: string,
) {
  return new AgentDriveApiError('conflict', 409, message, { state, currentVersionId });
}

const notFound = () => new AgentDriveApiError('not_found', 404, 'File not found.');

const outage = () => new AgentDriveApiError('internal_error', 500, 'synthetic outage');

/**
 * In-memory drive with the server's observable semantics: create-only and CAS puts,
 * guarded idempotent rename, version-pinned reads, trash, path-sorted paginated list,
 * page limits capped at the real MAX_PAGE_SIZE, a commit-ordered recent-event
 * feed whose latestCursor is the LAST RETURNED ROW, not the tail, and a
 * jobSubmissions view modelling the server-side filter: only `move` events from
 * /jobs/<id>/request.md to the same /jobs/<id>/submitted.md with a nonnull
 * versionId, whose file is still alive at the submitted path, and whose id has
 * no worker receipt (live or trashed).
 */
class FakeDrive {
  readonly calls: string[] = [];
  /** Cursor argument of every 'recent' call, in order. */
  readonly recentArgs: (string | undefined)[] = [];
  /** Call signatures that arrived carrying an abort signal. */
  readonly signalSeen = new Set<string>();
  /** When true, pendingJobSubmissions behaves like a pre-flag server: every event. */
  unfilteredSubmissions = false;
  private readonly live = new Map<string, StoredFile>();
  private readonly trashed = new Map<string, StoredFile>();
  private readonly history = new Map<string, StoredFile>();
  private readonly events: RecentEvent[] = [];
  private readonly renames = new Map<
    string,
    { params: string; result: { id: string; path: string; versionId: string } }
  >();
  private clock = 0;
  private recentPolls = 0;

  /** Remaining injected 500s per call signature (e.g. 'put:/jobs/x/status.json'). */
  readonly failures = new Map<string, number>();
  /** Persistent injected errors per call signature, thrown before failures. */
  readonly inject = new Map<string, () => unknown>();
  /** Runs just before a matching call executes (after it is logged). */
  before: ((call: string) => void) | undefined;
  /** Runs inside recent() before the page is computed; arg = 'recent' call count. */
  pollHook: ((call: number) => void | Promise<void>) | undefined;
  /** Transforms a computed list page (prefix, page) — for corrupt-page tests. */
  listTransform:
    | ((
        prefix: string | undefined,
        page: { items: FileEntry[]; nextCursor: string | null },
      ) => {
        items: FileEntry[];
        nextCursor: string | null;
      })
    | undefined;
  /** Transforms a pendingJobSubmissions page — for stalled-cursor tests. */
  jobsTransform: ((page: RecentPage) => RecentPage) | undefined;

  private stamp() {
    this.clock += 1;
    return new Date(1_700_000_000_000 + this.clock * 1000).toISOString();
  }

  private record(
    operation: RecentEvent['operation'],
    path: string,
    previousPath: string | null,
    versionId: string | null,
  ) {
    this.events.push({
      id: randomUUID(),
      operation,
      path,
      previousPath,
      versionId,
      agentId: 'agent-test',
      agentName: null,
      machineId: null,
      userId: null,
      createdAt: this.stamp(),
    });
  }

  private fail(call: string) {
    this.calls.push(call);
    this.before?.(call);
    const injected = this.inject.get(call);
    if (injected) throw injected();
    const remaining = this.failures.get(call) ?? 0;
    if (remaining > 0) {
      this.failures.set(call, remaining - 1);
      throw outage();
    }
  }

  async put(
    _driveId: string,
    path: string,
    bytes: Uint8Array,
    options: {
      mode?: 'create' | 'overwrite';
      ifVersionId?: string | null;
      allowTrashedCreate?: boolean;
      signal?: AbortSignal;
    } = {},
  ) {
    this.fail(`put:${path}`);
    if (options.signal) this.signalSeen.add(`put:${path}`);
    const guard = options.ifVersionId;
    const live = this.live.get(path);
    const trashed = this.trashed.get(path);
    const createOnly = guard === null || (guard === undefined && options.mode !== 'overwrite');
    if (createOnly) {
      if (live) throw conflict('exists', live.versionId, 'The file already exists.');
      if (trashed && !options.allowTrashedCreate)
        throw conflict('trashed', trashed.versionId, 'The file is in the trash.');
      return this.commit(path, bytes);
    }
    if (guard !== undefined) {
      if (!live)
        throw conflict(trashed ? 'trashed' : 'absent', trashed?.versionId ?? null, 'Changed.');
      if (live.versionId !== guard) throw conflict('changed', live.versionId, 'The file changed.');
      return this.commit(path, bytes);
    }
    return this.commit(path, bytes);
  }

  private commit(path: string, bytes: Uint8Array) {
    const file: StoredFile = {
      fileId: this.live.get(path)?.fileId ?? randomUUID(),
      versionId: randomUUID(),
      path,
      bytes: new Uint8Array(bytes),
      createdAt: this.stamp(),
    };
    this.live.set(path, file);
    this.trashed.delete(path);
    this.history.set(file.versionId, file);
    this.record('put', path, null, file.versionId);
    return versionObject(file);
  }

  async get(
    _driveId: string,
    path: string,
    options: { versionId?: string; maxPlaintextBytes?: number; signal?: AbortSignal } = {},
  ) {
    this.fail(`get:${path}`);
    if (options.signal) this.signalSeen.add(`get:${path}`);
    const file = options.versionId ? this.history.get(options.versionId) : this.live.get(path);
    if (!file || file.path !== path) throw notFound();
    if (
      options.maxPlaintextBytes !== undefined &&
      file.bytes.byteLength > options.maxPlaintextBytes
    )
      throw new StreamSizeLimitError(file.bytes.byteLength, options.maxPlaintextBytes);
    return { bytes: new Uint8Array(file.bytes), version: versionObject(file) };
  }

  async getVersionMetadata(
    _driveId: string,
    path: string,
    options: { versionId?: string; signal?: AbortSignal } = {},
  ) {
    this.fail(`meta:${path}`);
    if (options.signal) this.signalSeen.add(`meta:${path}`);
    const file = options.versionId ? this.history.get(options.versionId) : this.live.get(path);
    if (!file || file.path !== path) throw notFound();
    return versionObject(file);
  }

  async list(
    _driveId: string,
    prefix?: string,
    limit = 100,
    cursor?: string,
    _filters?: { tag?: string; agentId?: string; machine?: string; user?: string },
    signal?: AbortSignal,
  ) {
    this.fail(`list:${prefix ?? ''}`);
    if (signal) this.signalSeen.add(`list:${prefix ?? ''}`);
    if (limit > REAL_PAGE_LIMIT)
      throw new AgentDriveApiError('validation_error', 400, 'limit must be between 1 and 100.');
    const ordered = [...this.live.values()]
      .filter((file) => !prefix || file.path.startsWith(prefix))
      .map((file) => file.path)
      .sort();
    const start = cursor ? Number(cursor) : 0;
    const page = {
      items: ordered.slice(start, start + limit).map((path) => entryObject(this.live.get(path)!)),
      nextCursor: start + limit < ordered.length ? String(start + limit) : null,
    };
    return this.listTransform ? this.listTransform(prefix, page) : page;
  }

  async rename(
    _driveId: string,
    path: string,
    destinationPath: string,
    options: {
      ifSourceVersionId: string;
      ifDestinationVersionId: string | null;
      operationId: string;
    },
  ) {
    this.fail(`rename:${path}->${destinationPath}`);
    const params = JSON.stringify([
      path,
      destinationPath,
      options.ifSourceVersionId,
      options.ifDestinationVersionId,
    ]);
    const prior = this.renames.get(options.operationId);
    if (prior) {
      if (prior.params !== params)
        throw new AgentDriveApiError('conflict', 409, 'The operation ID was reused.');
      return prior.result;
    }
    const source = this.live.get(path);
    if (!source) throw conflict('absent', null, 'The source is missing.');
    if (source.versionId !== options.ifSourceVersionId)
      throw conflict('changed', source.versionId, 'The source changed.');
    const destination = this.live.get(destinationPath);
    if (options.ifDestinationVersionId === null) {
      if (destination) throw conflict('exists', destination.versionId, 'The destination exists.');
    } else if (!destination || destination.versionId !== options.ifDestinationVersionId) {
      throw conflict(
        destination ? 'changed' : 'absent',
        destination?.versionId ?? null,
        'The destination changed.',
      );
    }
    this.moveRaw(path, destinationPath);
    const moved = this.live.get(destinationPath)!;
    const result = { id: moved.fileId, path: destinationPath, versionId: moved.versionId };
    this.renames.set(options.operationId, { params, result });
    return result;
  }

  private moveRaw(path: string, destinationPath: string) {
    const source = this.live.get(path);
    if (!source) throw notFound();
    // A rename preserves the source version on the destination.
    const moved = { ...source, path: destinationPath };
    this.live.delete(path);
    this.trash(path);
    this.live.set(destinationPath, moved);
    this.history.set(moved.versionId, moved);
    this.record('move', destinationPath, path, moved.versionId);
  }

  /** Test helper: a standard file move (the unguarded client move()). */
  move(path: string, destinationPath: string) {
    this.calls.push(`move:${path}->${destinationPath}`);
    this.moveRaw(path, destinationPath);
  }

  private trash(path: string) {
    const file = this.live.get(path);
    if (!file) return;
    this.live.delete(path);
    this.trashed.set(path, file);
  }

  /** Test helper: move a live file to the trash, recording a delete event. */
  remove(path: string) {
    const file = this.live.get(path);
    if (!file) throw notFound();
    this.trash(path);
    this.record('delete', path, null, file.versionId);
  }

  /** Tail cursor of the event feed: the parallel client change's recentHead. */
  async recentHead(_driveId: string, signal?: AbortSignal): Promise<string | null> {
    this.fail('recentHead');
    if (signal) this.signalSeen.add('recentHead');
    void _driveId;
    return this.events.length > 0 ? String(this.events.length) : null;
  }

  async recent(
    _driveId: string,
    since?: string,
    limit = 50,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<RecentPage> {
    this.recentArgs.push(cursor);
    this.recentPolls += 1;
    await this.pollHook?.(this.recentPolls);
    this.fail('recent');
    if (signal) this.signalSeen.add('recent');
    if (limit > REAL_PAGE_LIMIT)
      throw new AgentDriveApiError('validation_error', 400, 'limit must be between 1 and 100.');
    let start = 0;
    if (cursor) start = Number(cursor);
    else if (since) {
      while (start < this.events.length && this.events[start]!.createdAt <= since) start += 1;
    }
    const items = this.events.slice(start, start + limit);
    return {
      items,
      nextCursor: start + limit < this.events.length ? String(start + limit) : null,
      // Real semantics: the cursor of the LAST RETURNED ROW, not the tail.
      latestCursor: items.length > 0 ? String(start + items.length) : (cursor ?? null),
    };
  }

  /**
   * The server's /recent?jobSubmissions=1 view: qualifying move events only —
   * a `move` from /jobs/<valid-id>/request.md to the same id's submitted.md
   * carrying a versionId, the file still alive at the submitted path, and no
   * worker receipt (live or trashed) for the id. `unfilteredSubmissions`
   * models a pre-flag server that ignores the query and returns everything;
   * the worker must still qualify each event itself.
   */
  async pendingJobSubmissions(
    _driveId: string,
    limit = 50,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<RecentPage> {
    this.fail('jobSubmissions');
    if (signal) this.signalSeen.add('jobSubmissions');
    if (limit > REAL_PAGE_LIMIT)
      throw new AgentDriveApiError('validation_error', 400, 'limit must be between 1 and 100.');
    const qualifies = (event: RecentEvent) => {
      if (this.unfilteredSubmissions) return true;
      if (event.operation !== 'move' || event.versionId === null) return false;
      const match = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/submitted\.md$/.exec(event.path);
      if (!match || event.previousPath !== `/jobs/${match[1]}/request.md`) return false;
      if (!this.live.has(event.path)) return false;
      const receipt = `/jobs/.agent-drive/claims/${match[1]}.json`;
      return !this.live.has(receipt) && !this.trashed.has(receipt);
    };
    // Keyset cursor over the raw event stream: `limit` counts qualifying items,
    // and nextCursor is the last scanned position — so a receipt landing during
    // a mid-scan drain can never shift or skip later pages.
    const start = cursor ? Number(cursor) : -1;
    const items: RecentEvent[] = [];
    let scanned = start;
    for (let index = start + 1; index < this.events.length && items.length < limit; index += 1) {
      scanned = index;
      if (qualifies(this.events[index]!)) items.push(this.events[index]!);
    }
    const page: RecentPage = {
      items,
      nextCursor: this.events.some((event, index) => index > scanned && qualifies(event))
        ? String(scanned)
        : null,
      latestCursor: null,
    };
    return this.jobsTransform ? this.jobsTransform(page) : page;
  }

  /** Test helper: append an arbitrary event to the feed (e.g. a malformed move). */
  emit(event: Pick<RecentEvent, 'operation' | 'path' | 'previousPath' | 'versionId'>) {
    this.events.push({
      id: randomUUID(),
      agentId: 'agent-test',
      agentName: null,
      machineId: null,
      userId: null,
      createdAt: this.stamp(),
      ...event,
    });
  }

  has(path: string) {
    return this.live.has(path);
  }

  file(path: string) {
    return this.live.get(path);
  }

  bytes(path: string) {
    const file = this.live.get(path);
    if (!file) throw new Error(`no live file at ${path}`);
    return file.bytes;
  }

  text(path: string) {
    return new TextDecoder().decode(this.bytes(path));
  }

  status(id: string): Record<string, unknown> | null {
    const file = this.live.get(`/jobs/${id}/status.json`);
    return file
      ? (JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>)
      : null;
  }

  receipt(id: string): Record<string, unknown> | null {
    const file = this.live.get(`/jobs/.agent-drive/claims/${id}.json`);
    return file
      ? (JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>)
      : null;
  }

  eventCount() {
    return this.events.length;
  }
}

const asClient = (drive: FakeDrive) =>
  drive as unknown as Parameters<typeof initJobs>[0] &
    Parameters<typeof submitJob>[0] &
    Parameters<typeof runJobs>[0];

/**
 * Seeds a real submission: request.md plus an actual request.md -> submitted.md
 * move (the only operation that produces a qualifying submission event).
 * `viaSubmit` routes the move through submitJob's guarded rename instead.
 */
async function seedSubmission(
  drive: FakeDrive,
  id: string,
  options: {
    request?: Uint8Array;
    inputs?: { name: string; bytes: Uint8Array }[];
    viaSubmit?: boolean;
  } = {},
) {
  const client = asClient(drive);
  for (const input of options.inputs ?? [])
    await drive.put(DRIVE, `/jobs/${id}/inputs/${input.name}`, input.bytes);
  await drive.put(DRIVE, `/jobs/${id}/request.md`, options.request ?? textBytes('do work'));
  if (options.viaSubmit === false) {
    drive.move(`/jobs/${id}/request.md`, `/jobs/${id}/submitted.md`);
  } else {
    await submitJob(client, DRIVE, id);
  }
}

const okHandler = async (job: JobInput): Promise<JobFile[]> => [
  { name: 'result.txt', bytes: textBytes(`done:${new TextDecoder().decode(job.request)}`) },
];

describe('initJobs', () => {
  it('creates /jobs/README.md once and never overwrites it', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);

    const first = await initJobs(client, DRIVE);
    expect(first).toEqual({ path: '/jobs/README.md', created: true });
    expect(drive.text('/jobs/README.md')).toContain('jobs');

    const second = await initJobs(client, DRIVE);
    expect(second.created).toBe(false);
    expect(drive.calls.filter((call) => call === 'put:/jobs/README.md')).toHaveLength(2);
    // The surviving README is still the first write's bytes.
    expect(drive.text('/jobs/README.md')).toContain('jobs');
  });

  it('treats a trashed README as initialized and does not resurrect it', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await initJobs(client, DRIVE);
    drive.remove('/jobs/README.md');

    const again = await initJobs(client, DRIVE);
    expect(again.created).toBe(false);
    expect(drive.has('/jobs/README.md')).toBe(false);
  });

  it('does not treat an unrelated namespace conflict as initialized', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    drive.inject.set(
      'put:/jobs/README.md',
      () => new AgentDriveApiError('conflict', 409, 'The namespace is reserved.'),
    );
    await expect(initJobs(client, DRIVE)).rejects.toThrow(AgentDriveApiError);
  });
});

describe('submitJob', () => {
  it('renames the draft to submitted.md guarded by source version and absent destination', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await drive.put(DRIVE, '/jobs/job-1/request.md', textBytes('please'));

    const result = await submitJob(client, DRIVE, 'job-1');
    expect(result.state).toBe('submitted');
    expect(result.path).toBe('/jobs/job-1/submitted.md');
    expect(drive.has('/jobs/job-1/request.md')).toBe(false);
    expect(drive.text('/jobs/job-1/submitted.md')).toBe('please');
    expect(drive.calls).toContain('rename:/jobs/job-1/request.md->/jobs/job-1/submitted.md');
    expect(result.versionId).toBe(drive.file('/jobs/job-1/submitted.md')!.versionId);
  });

  it('rejects invalid ids without touching the drive', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    for (const id of ['', '-lead', '_lead', 'has space', 'a/b', 'dot.name', 'é', 'x'.repeat(65)]) {
      await expect(submitJob(client, DRIVE, id)).rejects.toThrow(TypeError);
    }
    expect(drive.calls).toHaveLength(0);
  });

  it('reports an existing submission as queued without a duplicate rename', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-2');

    const again = await submitJob(client, DRIVE, 'job-2');
    expect(again.state).toBe('queued');
    expect(drive.calls.filter((call) => call.startsWith('rename:')).length).toBe(1); // only the original submission renamed
  });

  it('reports a claimed job instead of queued when a status file exists', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-3');
    await drive.put(DRIVE, '/jobs/job-3/status.json', textBytes('{"state":"running"}'));

    const result = await submitJob(client, DRIVE, 'job-3');
    expect(result.state).toBe('claimed');
  });

  it('reports claimed when the receipt exists but visible status is missing', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-receipt-only');
    await drive.put(
      DRIVE,
      '/jobs/.agent-drive/claims/job-receipt-only.json',
      textBytes('{"version":1}'),
    );

    const result = await submitJob(client, DRIVE, 'job-receipt-only');
    expect(result.state).toBe('claimed');
  });

  it('propagates an API or auth failure on the status check instead of reporting queued', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-3b');
    drive.inject.set(
      'meta:/jobs/job-3b/status.json',
      () => new AgentDriveApiError('permission_denied', 403, 'denied'),
    );

    await expect(submitJob(client, DRIVE, 'job-3b')).rejects.toMatchObject({ status: 403 });
  });

  it('fails when neither a draft nor a submission exists', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await expect(submitJob(client, DRIVE, 'job-4')).rejects.toThrow(AgentDriveApiError);
  });

  it('reconciles a lost acknowledgement when the destination carries the pinned draft version', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await drive.put(DRIVE, '/jobs/job-6/request.md', textBytes('draft'));
    const draftVersion = drive.file('/jobs/job-6/request.md')!.versionId;
    drive.before = (call) => {
      if (call.startsWith('rename:')) {
        // The rename landed (version preserved on the destination) but its reply was lost.
        drive.move('/jobs/job-6/request.md', '/jobs/job-6/submitted.md');
        throw outage();
      }
    };

    const result = await submitJob(client, DRIVE, 'job-6');
    expect(result.state).toBe('submitted');
    expect(result.versionId).toBe(draftVersion);
  });

  it('fails as a conflict when a different submission owns the destination', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await drive.put(DRIVE, '/jobs/job-7/request.md', textBytes('my draft'));
    drive.before = (call) => {
      if (call.startsWith('rename:')) {
        // A racing submitter landed a DIFFERENT request at submitted.md.
        void drive.put(DRIVE, '/jobs/job-7/submitted.md', textBytes('their request'));
      }
    };

    await expect(submitJob(client, DRIVE, 'job-7')).rejects.toMatchObject({
      status: 409,
      state: 'exists',
    });
    expect(drive.text('/jobs/job-7/submitted.md')).toBe('their request');
  });

  it('never retries a stale source version after it changed', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await drive.put(DRIVE, '/jobs/job-8/request.md', textBytes('v1'));
    drive.before = (call) => {
      if (call.startsWith('rename:')) {
        // The user kept editing: the pinned draft version is now stale.
        void drive.put(DRIVE, '/jobs/job-8/request.md', textBytes('v2'), { mode: 'overwrite' });
      }
    };

    await expect(submitJob(client, DRIVE, 'job-8')).rejects.toMatchObject({
      status: 409,
      state: 'changed',
    });
    // Exactly one guarded rename was attempted — no automatic resubmission.
    expect(drive.calls.filter((call) => call.startsWith('rename:'))).toHaveLength(1);
    expect(drive.has('/jobs/job-8/submitted.md')).toBe(false);
  });

  it('conflicts without renaming the draft when the id is held but no submission is visible', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-held-sub');
    // A worker claimed the job, then the submission and status were moved aside.
    await drive.put(
      DRIVE,
      '/jobs/.agent-drive/claims/job-held-sub.json',
      textBytes('{"version":1}'),
    );
    drive.move('/jobs/job-held-sub/submitted.md', '/jobs/job-held-sub/submitted.moved.md');
    // The submitter wrote a fresh draft under the same id.
    await drive.put(DRIVE, '/jobs/job-held-sub/request.md', textBytes('new draft'));

    await expect(submitJob(client, DRIVE, 'job-held-sub')).rejects.toMatchObject({
      status: 409,
    });
    // No rename ran and the draft is untouched.
    expect(drive.calls.filter((call) => call.startsWith('rename:'))).toHaveLength(1);
    expect(drive.text('/jobs/job-held-sub/request.md')).toBe('new draft');
    expect(drive.has('/jobs/job-held-sub/submitted.md')).toBe(false);
  });

  it('conflicts when only a visible status remains of a held job', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await drive.put(DRIVE, '/jobs/job-status-only/status.json', textBytes('{"state":"running"}'));
    await drive.put(DRIVE, '/jobs/job-status-only/request.md', textBytes('draft'));

    await expect(submitJob(client, DRIVE, 'job-status-only')).rejects.toMatchObject({
      status: 409,
    });
    expect(drive.calls.filter((call) => call.startsWith('rename:'))).toHaveLength(0);
    expect(drive.has('/jobs/job-status-only/submitted.md')).toBe(false);
  });
});

describe('runJobs once', () => {
  it('claims, downloads pinned inputs, invokes the handler, commits outputs, then CASes done', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-a', {
      request: textBytes('summarize'),
      inputs: [
        { name: 'a.txt', bytes: textBytes('alpha') },
        { name: 'b.txt', bytes: textBytes('beta') },
      ],
    });

    const seen: JobInput[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job);
        return [{ name: 'out.txt', bytes: textBytes('ok') }];
      },
      { once: true },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe('job-a');
    expect(new TextDecoder().decode(seen[0]!.request)).toBe('summarize');
    expect(seen[0]!.inputs.map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
    expect(drive.text('/jobs/job-a/outputs/out.txt')).toBe('ok');
    const status = drive.status('job-a');
    expect(status?.state).toBe('done');
    expect(status?.outputs).toEqual(['out.txt']);
    // Receipt and status are created before any download or invocation.
    const receipt = drive.calls.indexOf('put:/jobs/.agent-drive/claims/job-a.json');
    const firstStatus = drive.calls.indexOf('put:/jobs/job-a/status.json');
    const firstGet = drive.calls.findIndex((call) => call.startsWith('get:'));
    expect(receipt).toBeGreaterThanOrEqual(0);
    expect(firstStatus).toBeGreaterThan(receipt);
    expect(firstGet).toBeGreaterThan(firstStatus);
    // Watch-mode head probes are skipped in once mode.
    expect(drive.calls).not.toContain('recentHead');
  });

  it('never re-runs a job that already has a status file (rerun/reconnect)', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-b');
    await drive.put(DRIVE, '/jobs/job-b/status.json', textBytes('{"state":"done"}'));

    let invoked = 0;
    await runJobs(
      client,
      DRIVE,
      async () => {
        invoked += 1;
        return [];
      },
      { once: true },
    );
    expect(invoked).toBe(0);
  });

  it('lets a second worker observe the existing claim and never invoke the handler', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-c');

    let workerA = 0;
    let workerB = 0;
    await runJobs(client, DRIVE, async () => ((workerA += 1), []), { once: true });
    await runJobs(client, DRIVE, async () => ((workerB += 1), []), { once: true });

    expect(workerA).toBe(1);
    expect(workerB).toBe(0);
    expect(drive.status('job-c')?.state).toBe('done');
  });

  it('does not rerun a completed job when the visible status file is moved aside', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-moved');

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(1);
    expect(drive.status('job-moved')?.state).toBe('done');

    // A user moves the worker-owned status file aside — a standard unguarded move.
    drive.move('/jobs/job-moved/status.json', '/jobs/job-moved/status.moved.json');
    expect(drive.has('/jobs/job-moved/status.json')).toBe(false);

    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    // The durable receipt blocks the re-claim; no false "running" status appears.
    expect(invoked).toBe(1);
    expect(drive.has('/jobs/job-moved/status.json')).toBe(false);
    expect(drive.has('/jobs/.agent-drive/claims/job-moved.json')).toBe(true);
  });

  it('never runs a job whose claim receipt exists without a status (worker died mid-claim)', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-orphan');
    await drive.put(DRIVE, '/jobs/.agent-drive/claims/job-orphan.json', textBytes('{}'));

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/job-orphan/status.json')).toBe(false);
  });

  it('skips a job whose receipt lands between the scan and pickup', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-race');
    let raced = false;
    drive.before = (call) => {
      if (call === 'put:/jobs/.agent-drive/claims/job-race.json' && !raced) {
        raced = true;
        // A racing worker's receipt lands first.
        void drive.put(DRIVE, '/jobs/.agent-drive/claims/job-race.json', textBytes('{}'));
      }
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    // No false running status is created for a job we do not own.
    expect(drive.has('/jobs/job-race/status.json')).toBe(false);
  });

  it('treats a trashed status.json as claimed and never invokes the handler', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-trashed');
    await drive.put(DRIVE, '/jobs/job-trashed/status.json', textBytes('{"state":"failed"}'));
    drive.remove('/jobs/job-trashed/status.json');

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/job-trashed/status.json')).toBe(false);
  });

  it('treats a trashed claim receipt as claimed and never invokes the handler', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-treceipt');
    await drive.put(DRIVE, '/jobs/.agent-drive/claims/job-treceipt.json', textBytes('{}'));
    drive.remove('/jobs/.agent-drive/claims/job-treceipt.json');

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/job-treceipt/status.json')).toBe(false);
  });

  it('reports an ambiguous claim error in once mode and does not invoke, then claims cleanly', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-d');
    drive.failures.set('put:/jobs/.agent-drive/claims/job-d.json', 1); // first claim attempt 500s

    let invoked = 0;
    await expect(
      runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true }),
    ).rejects.toThrow(AgentDriveApiError);
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/.agent-drive/claims/job-d.json')).toBe(false);
    expect(drive.has('/jobs/job-d/status.json')).toBe(false);

    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(1);
    expect(drive.status('job-d')?.state).toBe('done');
  });

  it('reports an ambiguous status write, holds the claim, and never runs the job again', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-held');
    drive.failures.set('put:/jobs/job-held/status.json', 1); // visible claim write 500s

    let invoked = 0;
    await expect(
      runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true }),
    ).rejects.toThrow(AgentDriveApiError);
    expect(invoked).toBe(0);
    // The receipt landed, so the id stays claimed: a fresh worker never reruns it.
    expect(drive.has('/jobs/.agent-drive/claims/job-held.json')).toBe(true);

    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/job-held/status.json')).toBe(false);
  });

  it('reports a discovery outage in once mode instead of a false pass', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    drive.failures.set('jobSubmissions', 1);

    await expect(runJobs(client, DRIVE, async () => [], { once: true })).rejects.toThrow(
      AgentDriveApiError,
    );
  });

  it('reports a repeated submission cursor as a discovery error instead of looping', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-a');
    drive.jobsTransform = (page) => ({ ...page, nextCursor: 'STUCK' });

    await expect(runJobs(client, DRIVE, async () => [], { once: true })).rejects.toThrow(
      AgentDriveApiError,
    );
  });

  it('drops a stale submission deleted between discovery and pickup without claiming it', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-e');
    await seedSubmission(drive, 'job-f');
    drive.before = (call) => {
      // The submission is discovered by the scan, then deleted before pickup.
      if (call === 'meta:/jobs/job-e/submitted.md') drive.remove('/jobs/job-e/submitted.md');
    };

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      { once: true },
    );
    expect(seen).toEqual(['job-f']);
    expect(drive.has('/jobs/job-e/status.json')).toBe(false);
  });

  it('ignores drafts, foreign paths, non-move events and invalid ids during discovery', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    // Model a pre-flag server that returns every event: qualification is ours.
    drive.unfilteredSubmissions = true;
    await drive.put(DRIVE, '/jobs/draft-only/request.md', textBytes('draft'));
    await drive.put(DRIVE, '/elsewhere/submitted.md', textBytes('x'));
    // A file appearing at submitted.md without a move is not a submission.
    await drive.put(DRIVE, '/jobs/direct/submitted.md', textBytes('x'));
    // A move from a different source is not a submission.
    await drive.put(DRIVE, '/jobs/wrongsrc/notes.md', textBytes('x'));
    drive.move('/jobs/wrongsrc/notes.md', '/jobs/wrongsrc/submitted.md');
    // Malformed events: invalid ids, nested paths, missing versionId, copy/restore.
    drive.emit({
      operation: 'move',
      path: '/jobs/bad id/submitted.md',
      previousPath: '/jobs/bad id/request.md',
      versionId: 'v',
    });
    drive.emit({
      operation: 'move',
      path: '/jobs/-bad/submitted.md',
      previousPath: '/jobs/-bad/request.md',
      versionId: 'v',
    });
    drive.emit({
      operation: 'move',
      path: '/jobs/nested/deep/submitted.md',
      previousPath: '/jobs/nested/deep/request.md',
      versionId: 'v',
    });
    drive.emit({
      operation: 'move',
      path: '/jobs/nover/submitted.md',
      previousPath: '/jobs/nover/request.md',
      versionId: null,
    });
    drive.emit({
      operation: 'copy',
      path: '/jobs/copied/submitted.md',
      previousPath: '/jobs/copied/request.md',
      versionId: 'v',
    });
    await seedSubmission(drive, 'good', { request: textBytes('run me'), viaSubmit: false });

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      { once: true },
    );
    expect(seen).toEqual(['good']);
  });

  it('discovers pending submissions across all submission pages at the real page limit', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    // Drafts never qualify; 110 real submissions span two event pages.
    for (let index = 0; index < 30; index += 1)
      await drive.put(
        DRIVE,
        `/jobs/pad-${String(index).padStart(3, '0')}/request.md`,
        textBytes('x'),
      );
    const ids: string[] = [];
    for (let index = 0; index < 110; index += 1) {
      const id = `job-${String(index).padStart(3, '0')}`;
      ids.push(id);
      await seedSubmission(drive, id, { viaSubmit: false });
    }

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      { once: true },
    );
    expect(seen).toEqual(ids);
    expect(drive.calls.filter((call) => call === 'jobSubmissions').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('stops scanning at a page boundary when the signal aborts mid-scan', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    // 210 submissions force three event pages at the real page limit.
    for (let index = 0; index < 210; index += 1)
      await seedSubmission(drive, `pad-${String(index).padStart(3, '0')}`, { viaSubmit: false });
    const controller = new AbortController();
    drive.before = (call) => {
      if (call === 'jobSubmissions' && drive.calls.length > 0) {
        const pages = drive.calls.filter((c) => c === 'jobSubmissions').length;
        if (pages === 2) controller.abort();
      }
    };

    await runJobs(client, DRIVE, async () => [], {
      once: true,
      signal: controller.signal,
    });
    // The abort lands on page two; page three must never be fetched.
    expect(drive.calls.filter((call) => call === 'jobSubmissions')).toHaveLength(2);
  });

  it('drains only the submissions visible in one pass', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-g');
    drive.before = (call) => {
      if (call.startsWith('get:') && !drive.has('/jobs/job-late/submitted.md')) {
        // A submission that lands mid-run is left for the next pass.
        void drive
          .put(DRIVE, '/jobs/job-late/request.md', textBytes('late'))
          .then(() => drive.move('/jobs/job-late/request.md', '/jobs/job-late/submitted.md'));
      }
    };

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      { once: true },
    );
    expect(seen).toEqual(['job-g']);
  });

  it('runs the version recorded by the submit event even if it changes mid-run', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-h', { request: textBytes('v1-request'), viaSubmit: false });
    const pinned = drive.file('/jobs/job-h/submitted.md')!.versionId;
    drive.before = (call) => {
      // Between pinning and download, someone overwrites the request.
      if (call === 'get:/jobs/job-h/submitted.md')
        void drive.put(DRIVE, '/jobs/job-h/submitted.md', textBytes('v2-request'), {
          mode: 'overwrite',
        });
    };

    let requestText = '';
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        requestText = new TextDecoder().decode(job.request);
        return [];
      },
      { once: true },
    );
    expect(requestText).toBe('v1-request');
    expect(drive.text('/jobs/job-h/submitted.md')).toBe('v2-request');
    expect(pinned).toBeTruthy();
  });

  it('runs the version recorded by the submit event even if the file changed before pickup', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-pin', {
      request: textBytes('v1-request'),
      viaSubmit: false,
    });
    const pinned = drive.file('/jobs/job-pin/submitted.md')!.versionId;
    // A plain overwrite after the submit move is NOT a new submission.
    await drive.put(DRIVE, '/jobs/job-pin/submitted.md', textBytes('v2-request'), {
      mode: 'overwrite',
    });

    let requestText = '';
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        requestText = new TextDecoder().decode(job.request);
        return [];
      },
      { once: true },
    );
    expect(requestText).toBe('v1-request');
    const receipt = drive.receipt('job-pin');
    expect(receipt?.state).toBe('done');
    expect(receipt?.requestVersionId).toBe(pinned);
  });

  it('never substitutes a different version when the submitted version is gone', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-gone', { viaSubmit: false });
    // A later (fabricated) move event carries a version that never landed.
    drive.emit({
      operation: 'move',
      path: '/jobs/job-gone/submitted.md',
      previousPath: '/jobs/job-gone/request.md',
      versionId: randomUUID(),
    });

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    // The newest qualifying event pins a version that cannot be fetched: the job
    // is dropped, never claimed, and no substitute version runs.
    expect(invoked).toBe(0);
    expect(drive.has('/jobs/.agent-drive/claims/job-gone.json')).toBe(false);
    expect(drive.has('/jobs/job-gone/status.json')).toBe(false);
  });

  it('pins attachment versions at pickup', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-i', { inputs: [{ name: 'in.txt', bytes: textBytes('v1') }] });
    drive.before = (call) => {
      if (call === 'get:/jobs/job-i/inputs/in.txt')
        void drive.put(DRIVE, '/jobs/job-i/inputs/in.txt', textBytes('v2'), { mode: 'overwrite' });
    };

    let inputText = '';
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        inputText = new TextDecoder().decode(job.inputs[0]!.bytes);
        return [];
      },
      { once: true },
    );
    expect(inputText).toBe('v1');
  });
});

describe('runJobs input bounds', () => {
  async function runSeeded(id: string, seed: (drive: FakeDrive) => Promise<void>) {
    const drive = new FakeDrive();
    await seed(drive);
    let invoked = 0;
    await runJobs(
      asClient(drive),
      DRIVE,
      async () => {
        invoked += 1;
        return [];
      },
      { once: true },
    );
    return { drive, invoked, status: drive.status(id) };
  }

  it('rejects a request over 64KiB before any download or invocation', async () => {
    const { drive, invoked, status } = await runSeeded('big-request', (fake) =>
      seedSubmission(fake, 'big-request', {
        request: new Uint8Array(JOB_LIMITS.requestBytes + 1),
      }),
    );
    expect(invoked).toBe(0);
    expect(status?.reason).toBe('request_too_large');
    expect(drive.calls.filter((call) => call.startsWith('get:'))).toHaveLength(0);
  });

  it('rejects more than 16 inputs before downloading', async () => {
    const { invoked, status } = await runSeeded('many-inputs', (fake) =>
      seedSubmission(fake, 'many-inputs', {
        inputs: Array.from({ length: JOB_LIMITS.maxInputs + 1 }, (_, index) => ({
          name: `in-${index}.txt`,
          bytes: textBytes('x'),
        })),
      }),
    );
    expect(invoked).toBe(0);
    expect(status?.reason).toBe('too_many_inputs');
  });

  it('rejects a single input over 8MiB before downloading', async () => {
    const { invoked, status } = await runSeeded('fat-input', (fake) =>
      seedSubmission(fake, 'fat-input', {
        inputs: [{ name: 'fat.bin', bytes: new Uint8Array(JOB_LIMITS.inputBytes + 1) }],
      }),
    );
    expect(invoked).toBe(0);
    expect(status?.reason).toBe('input_too_large');
  });

  it('rejects inputs totalling over 32MiB before downloading', async () => {
    const { invoked, status } = await runSeeded('wide-inputs', (fake) =>
      seedSubmission(fake, 'wide-inputs', {
        inputs: Array.from({ length: 6 }, (_, index) => ({
          name: `part-${index}.bin`,
          bytes: new Uint8Array(Math.floor(JOB_LIMITS.totalInputBytes / 5) + 1),
        })),
      }),
    );
    expect(invoked).toBe(0);
    expect(status?.reason).toBe('inputs_too_large');
  });

  it('rejects hostile input names and nested paths', async () => {
    for (const name of ['../status.json', 'a/b', '..', 'deep/evil.txt']) {
      const { invoked, status } = await runSeeded('hostile', async (fake) => {
        await seedSubmission(fake, 'hostile', { viaSubmit: false });
        await fake.put(DRIVE, `/jobs/hostile/inputs/${name}`, textBytes('x'));
      });
      expect(invoked).toBe(0);
      expect(status?.reason).toBe('invalid_input_name');
    }
  });

  it('rejects control characters and trailing newlines in input names', async () => {
    for (const name of ['tab\tname', 'line\nbreak', 'trailing\n', 'nul\x00char']) {
      const { invoked, status } = await runSeeded('control', async (fake) => {
        await seedSubmission(fake, 'control', { viaSubmit: false });
        await fake.put(DRIVE, `/jobs/control/inputs/${name}`, textBytes('x'));
      });
      expect(invoked).toBe(0);
      expect(status?.reason).toBe('invalid_input_name');
    }
  });

  it('rejects input names over 255 UTF-8 bytes and folded duplicates', async () => {
    const overlong = 'é'.repeat(130); // 260 bytes, well under 255 characters
    const { invoked, status } = await runSeeded('longname', async (fake) => {
      await seedSubmission(fake, 'longname', { viaSubmit: false });
      await fake.put(DRIVE, `/jobs/longname/inputs/${overlong}`, textBytes('x'));
    });
    expect(invoked).toBe(0);
    expect(status?.reason).toBe('invalid_input_name');

    // Composed vs decomposed é normalize to the same folded name.
    const dup = await runSeeded('folded', async (fake) => {
      await seedSubmission(fake, 'folded', { viaSubmit: false });
      await fake.put(DRIVE, '/jobs/folded/inputs/café.txt', textBytes('1')); // composed U+00E9
      await fake.put(DRIVE, '/jobs/folded/inputs/cafe\u0301.txt', textBytes('2')); // decomposed e+U+0301
    });
    expect(dup.invoked).toBe(0);
    expect(dup.status?.reason).toBe('invalid_input_name');
  });

  it('rejects an input entry that lies outside the inputs prefix', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'escapee');
    drive.listTransform = (prefix, page) => {
      if (!prefix?.endsWith('/inputs/')) return page;
      return {
        items: [
          ...page.items,
          {
            fileId: randomUUID(),
            versionId: randomUUID(),
            path: '/jobs/escapee/../escapee/status.json',
            ciphertextSize: 1,
            agentId: 'agent-test',
            machineId: null,
            userId: null,
            tags: [],
            description: null,
            createdAt: new Date(0).toISOString(),
          },
        ],
        nextCursor: page.nextCursor,
      };
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.status('escapee')?.reason).toBe('invalid_input_name');
  });

  it('fails the job but not the worker when a pinned input cannot be downloaded', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'vanished', {
      inputs: [{ name: 'gone.txt', bytes: textBytes('x') }],
    });
    drive.failures.set('get:/jobs/vanished/inputs/gone.txt', 1);

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), { once: true });
    expect(invoked).toBe(0);
    expect(drive.status('vanished')?.state).toBe('failed');
    expect(drive.status('vanished')?.reason).toBe('input_unavailable');
  });
});

describe('runJobs failure and finalization', () => {
  it('marks a throwing handler failed without leaking the raw error message', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-throws');

    await runJobs(
      client,
      DRIVE,
      async () => {
        throw new Error('secret bearer token leaked in message');
      },
      { once: true },
    );
    const status = drive.status('job-throws');
    expect(status?.state).toBe('failed');
    expect(status?.reason).toBe('handler_error');
    expect(JSON.stringify(status)).not.toContain('secret bearer token');
  });

  it('still processes later jobs after a handler failure (no denial)', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-f1');
    await seedSubmission(drive, 'job-f2');

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        if (job.id === 'job-f1') throw new Error('boom');
        return [];
      },
      { once: true },
    );
    expect(seen).toEqual(['job-f1', 'job-f2']);
    expect(drive.status('job-f1')?.state).toBe('failed');
    expect(drive.status('job-f2')?.state).toBe('done');
  });

  it('rejects invalid handler output without committing partial results as done', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-bad-out');

    await runJobs(
      client,
      DRIVE,
      async () => [
        { name: 'ok.txt', bytes: textBytes('x') },
        { name: '../escape', bytes: textBytes('x') },
      ],
      { once: true },
    );
    expect(drive.status('job-bad-out')?.state).toBe('failed');
    expect(drive.status('job-bad-out')?.reason).toBe('invalid_output');
  });

  it('rejects malformed handler output entries without invoking puts', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-malformed-out');

    await runJobs(
      client,
      DRIVE,
      async () => [{ name: 42 as unknown as string, bytes: textBytes('x') }],
      { once: true },
    );
    expect(drive.status('job-malformed-out')?.reason).toBe('invalid_output');
    expect(drive.calls.filter((call) => call.includes('/outputs/'))).toHaveLength(0);
  });

  it('rejects duplicate output names (ambiguous case-insensitive)', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-dup-out');

    await runJobs(
      client,
      DRIVE,
      async () => [
        { name: 'A.txt', bytes: textBytes('1') },
        { name: 'a.txt', bytes: textBytes('2') },
      ],
      { once: true },
    );
    expect(drive.status('job-dup-out')?.reason).toBe('invalid_output');
    expect(drive.has('/jobs/job-dup-out/outputs/A.txt')).toBe(false);
  });

  it('fails the job when an output commit conflicts, leaving outputs uncommitted as done', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-out-conflict');
    await drive.put(DRIVE, '/jobs/job-out-conflict/outputs/result.txt', textBytes('squatter'));

    await runJobs(client, DRIVE, okHandler, { once: true });
    expect(drive.status('job-out-conflict')?.state).toBe('failed');
    expect(drive.status('job-out-conflict')?.reason).toBe('output_commit_failed');
    expect(drive.text('/jobs/job-out-conflict/outputs/result.txt')).toBe('squatter');
  });

  it('leaves a contested status alone when the done CAS conflicts', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-contested');
    let puts = 0;
    drive.before = (call) => {
      if (call === 'put:/jobs/job-contested/status.json') {
        puts += 1;
        if (puts === 2) {
          // An outsider rewrote status.json between claim and finalize.
          void drive.put(DRIVE, '/jobs/job-contested/status.json', textBytes('{"state":"other"}'), {
            mode: 'overwrite',
          });
        }
      }
    };

    // The ambiguous terminal write is reported, not silently swallowed.
    await expect(runJobs(client, DRIVE, okHandler, { once: true })).rejects.toThrow(
      /job-contested/,
    );
    // The worker's CAS lost; it must not blast the contested status with an overwrite.
    expect(drive.text('/jobs/job-contested/status.json')).toBe('{"state":"other"}');
    // Committed outputs are kept and the authoritative receipt still records done.
    expect(drive.has('/jobs/job-contested/outputs/result.txt')).toBe(true);
    expect(drive.receipt('job-contested')?.state).toBe('done');
  });

  it('leaves a job held as running when the worker is aborted mid-handler', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-stopped');
    const controller = new AbortController();

    await runJobs(
      client,
      DRIVE,
      async () => {
        controller.abort();
        return [{ name: 'late.txt', bytes: textBytes('x') }];
      },
      { once: true, signal: controller.signal },
    );

    const status = drive.status('job-stopped');
    expect(status?.state).toBe('running');
    // No outputs are committed after the abort.
    expect(drive.has('/jobs/job-stopped/outputs/late.txt')).toBe(false);
  });
});

describe('runJobs daemon follow', () => {
  it.each([
    ['recentHead', 401],
    ['jobSubmissions', 403],
  ])('surfaces permanent authorization failure from %s promptly', async (call, status) => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const error = new AgentDriveApiError('permission_denied', status, 'denied');
    drive.inject.set(call, () => error);

    await expect(
      runJobs(client, DRIVE, async () => [], {
        once: false,
        signal: new AbortController().signal,
        sleep: async () => {},
      }),
    ).rejects.toBe(error);
  });

  it('surfaces a permanent authorization failure while creating the claim receipt', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-no-claim-scope');
    const error = new AgentDriveApiError('permission_denied', 403, 'denied');
    drive.inject.set('put:/jobs/.agent-drive/claims/job-no-claim-scope.json', () => error);

    await expect(
      runJobs(client, DRIVE, async () => [], {
        once: false,
        signal: new AbortController().signal,
        sleep: async () => {},
      }),
    ).rejects.toBe(error);
  });

  it('probes the head cursor before the startup scan so no join is lost', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    let scanned = false;
    let polls = 0;
    drive.before = (call) => {
      // The submission lands between the head probe and the first submissions page.
      if (call === 'jobSubmissions' && !scanned) {
        scanned = true;
        void drive
          .put(DRIVE, '/jobs/joined/request.md', textBytes('hi'))
          .then(() => drive.move('/jobs/joined/request.md', '/jobs/joined/submitted.md'));
      }
      if (call === 'recent') {
        polls += 1;
        if (polls >= 3) controller.abort();
      }
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), {
      once: false,
      signal: controller.signal,
      pollMs: 1,
      pollMaxMs: 2,
    });
    expect(invoked).toBe(1);
    expect(drive.calls[0]).toBe('recentHead');
    expect(drive.calls.indexOf('recentHead')).toBeLessThan(drive.calls.indexOf('jobSubmissions'));
    expect(drive.status('joined')?.state).toBe('done');
  });

  it('picks up submissions from move events and advances the follow cursor', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    drive.pollHook = async (call) => {
      if (call === 1) await seedSubmission(drive, 'job-live');
      if (call >= 4) controller.abort();
    };

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      { once: false, signal: controller.signal, pollMs: 1, pollMaxMs: 2 },
    );

    expect(seen).toEqual(['job-live']);
    // Cursor keeps advancing (never resets) as events are consumed.
    const cursors = drive.recentArgs.map((args) => args);
    expect(cursors[cursors.length - 1]).toBe(String(drive.eventCount()));
    for (const cursor of cursors.slice(1)) expect(cursor).not.toBeUndefined();
  });

  it('backs off with adaptive idle pacing instead of polling at a fixed rate', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    const naps: number[] = [];
    drive.pollHook = (call) => {
      if (call >= 5) controller.abort();
    };

    await runJobs(client, DRIVE, async () => [], {
      once: false,
      signal: controller.signal,
      pollMs: 10,
      pollMaxMs: 40,
      retryMs: 1,
      sleep: async (ms) => {
        naps.push(ms);
      },
    });

    // Each idle poll doubles the nap toward the ceiling: 10, 20, 40, 40, ...
    expect(naps.length).toBeGreaterThanOrEqual(3);
    expect(naps[0]).toBe(10);
    expect(naps[1]).toBe(20);
    expect(Math.max(...naps)).toBeLessThanOrEqual(40);
    expect(naps).toContain(40);
  });

  it('backs off on outages instead of spinning, and recovers through a rescan', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    let sleeps = 0;
    let injected = false;
    drive.failures.set('recent', 1); // the first poll 500s
    drive.pollHook = async (call) => {
      if (call === 2 && !injected) {
        injected = true;
        await seedSubmission(drive, 'job-recovered');
      }
      if (call >= 4) controller.abort();
    };

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      {
        once: false,
        signal: controller.signal,
        pollMs: 1,
        pollMaxMs: 2,
        retryMs: 1,
        sleep: async () => {
          sleeps += 1;
        },
      },
    );
    expect(sleeps).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual(['job-recovered']);
  });

  it('ignores events for drafts, outputs, status files and status deletes', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    drive.pollHook = async (call) => {
      if (call === 1) {
        await drive.put(DRIVE, '/jobs/noise/request.md', textBytes('draft'));
        await drive.put(DRIVE, '/jobs/noise/outputs/x.txt', textBytes('x'));
        await drive.put(DRIVE, '/jobs/noise/status.json', textBytes('{}'));
        drive.remove('/jobs/noise/status.json');
      }
      if (call >= 3) controller.abort();
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), {
      once: false,
      signal: controller.signal,
      pollMs: 1,
      pollMaxMs: 2,
    });
    expect(invoked).toBe(0);
  });

  it('reconciles a lost join through a paced rescan', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    let heads = 0;
    drive.before = (call) => {
      // Inject between the startup scan and the SECOND head probe: the new head
      // stays ahead of the submission's event, so only the reconcile scan that
      // follows that head can ever discover it.
      if (call === 'recentHead') {
        heads += 1;
        if (heads === 2) void seedSubmission(drive, 'reconciled', { viaSubmit: false });
      }
      if (call === 'recent' && drive.has('/jobs/reconciled/status.json')) controller.abort();
      if (call === 'recent' && drive.calls.filter((c) => c === 'recent').length > 20)
        controller.abort();
    };

    const seen: string[] = [];
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        seen.push(job.id);
        return [];
      },
      {
        once: false,
        signal: controller.signal,
        pollMs: 1,
        pollMaxMs: 2,
        rescanMs: 0, // reconcile every loop for the test
        sleep: async () => {},
      },
    );
    expect(seen).toEqual(['reconciled']);
    expect(drive.status('reconciled')?.state).toBe('done');
  });

  it('cancels the idle poll timer on shutdown instead of holding the process open', async () => {
    vi.useFakeTimers();
    try {
      const drive = new FakeDrive();
      const client = asClient(drive);
      const controller = new AbortController();
      drive.pollHook = (call) => {
        // Fire while the worker is parked in the post-poll nap.
        if (call === 1) setTimeout(() => controller.abort(), 20);
      };
      // No sleep override: the regression is the DEFAULT nap timer surviving abort.
      const worker = runJobs(client, DRIVE, async () => [], {
        once: false,
        signal: controller.signal,
        pollMs: 60_000,
        pollMaxMs: 60_000,
        retryMs: 1,
      });
      await vi.advanceTimersByTimeAsync(20);
      await worker;
      // The abort timer and the default nap timer are both gone after shutdown.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers a queued submission after a transient first-scan outage without a new event', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    // The submission is already queued before the worker starts; nothing new lands.
    await seedSubmission(drive, 'job-boot');
    const controller = new AbortController();
    drive.failures.set('jobSubmissions', 1); // the startup scan's first page 500s
    drive.pollHook = () => {
      if (drive.status('job-boot') || drive.eventCount() > 50) controller.abort();
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), {
      once: false,
      signal: controller.signal,
      pollMs: 1,
      pollMaxMs: 2,
      retryMs: 1,
      sleep: async () => {},
    });
    expect(invoked).toBe(1);
    expect(drive.status('job-boot')?.state).toBe('done');
  });

  it('keeps the old cursor when a recovery scan fails after a new head, so no work is lost', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    drive.failures.set('recent', 1); // the first poll 500s -> recovery reconcile
    let scans = 0;
    drive.before = (call) => {
      if (call === 'jobSubmissions') {
        scans += 1;
        // The recovery scan (second page fetch) fails AFTER the fresh head was captured.
        if (scans === 2) throw outage();
      }
    };
    drive.pollHook = async (call) => {
      if (call === 1)
        // Lands before the recovery head probe; its event sits below that head.
        await seedSubmission(drive, 'job-slip');
      if (drive.status('job-slip')?.state === 'done' || call > 20) controller.abort();
    };

    let invoked = 0;
    await runJobs(client, DRIVE, async () => ((invoked += 1), []), {
      once: false,
      signal: controller.signal,
      pollMs: 1,
      pollMaxMs: 2,
      retryMs: 1,
      sleep: async () => {},
    });
    // Advancing the cursor to the new head despite the failed scan would skip
    // job-slip's submit event; the retry must follow from the older cursor.
    expect(invoked).toBe(1);
    expect(drive.status('job-slip')?.state).toBe('done');
  });
});

describe('worker receipt as the authoritative record', () => {
  it('stores the approved request version and committed output versions on the receipt', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-rec', { request: textBytes('go') });
    const submittedVersion = drive.file('/jobs/job-rec/submitted.md')!.versionId;

    await runJobs(client, DRIVE, okHandler, { once: true });

    const receipt = drive.receipt('job-rec');
    expect(receipt?.state).toBe('done');
    expect(receipt?.requestVersionId).toBe(submittedVersion);
    const outVersion = drive.file('/jobs/job-rec/outputs/result.txt')!.versionId;
    expect(receipt?.outputs).toEqual([{ name: 'result.txt', versionId: outVersion }]);
    // The visible status keeps its historical name-only shape.
    expect(drive.status('job-rec')?.outputs).toEqual(['result.txt']);
  });

  it('records the failure reason and partially committed outputs on the receipt', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-partial');
    // A squatting output makes the SECOND output commit fail after the first lands.
    await drive.put(DRIVE, '/jobs/job-partial/outputs/b.txt', textBytes('squatter'));

    await runJobs(
      client,
      DRIVE,
      async () => [
        { name: 'a.txt', bytes: textBytes('1') },
        { name: 'b.txt', bytes: textBytes('2') },
      ],
      { once: true },
    );

    const receipt = drive.receipt('job-partial');
    expect(receipt?.state).toBe('failed');
    expect(receipt?.reason).toBe('output_commit_failed');
    expect(receipt?.outputs).toEqual([
      { name: 'a.txt', versionId: drive.file('/jobs/job-partial/outputs/a.txt')!.versionId },
    ]);
    expect(drive.status('job-partial')?.state).toBe('failed');
    expect(drive.status('job-partial')?.reason).toBe('output_commit_failed');
  });
});

describe('terminal persistence reporting', () => {
  it('surfaces a failed-state persistence outage instead of silently holding', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-unpersisted');
    let statusPuts = 0;
    let receiptPuts = 0;
    drive.before = (call) => {
      if (call === 'put:/jobs/job-unpersisted/status.json') {
        statusPuts += 1;
        if (statusPuts === 2) throw outage(); // the 'failed' CAS fails
      }
      if (call === 'put:/jobs/.agent-drive/claims/job-unpersisted.json') {
        receiptPuts += 1;
        if (receiptPuts === 2) throw outage(); // the receipt 'failed' CAS fails
      }
    };

    await expect(
      runJobs(
        client,
        DRIVE,
        async () => {
          throw new Error('boom');
        },
        { once: true },
      ),
    ).rejects.toThrow(/job-unpersisted/);
    // Both writes failed: the running claim and receipt stay held, not clobbered.
    expect(drive.status('job-unpersisted')?.state).toBe('running');
    expect(drive.receipt('job-unpersisted')?.state).toBe('running');
  });

  it('still records the failure on the receipt when the visible status write fails', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-visfail');
    let statusPuts = 0;
    drive.before = (call) => {
      if (call === 'put:/jobs/job-visfail/status.json') {
        statusPuts += 1;
        if (statusPuts === 2) throw outage(); // only the 'failed' CAS fails
      }
    };

    await expect(
      runJobs(
        client,
        DRIVE,
        async () => {
          throw new Error('boom');
        },
        { once: true },
      ),
    ).rejects.toThrow(/job-visfail/);
    // The authoritative receipt carries the failure even though the visible
    // status could not be updated.
    const receipt = drive.receipt('job-visfail');
    expect(receipt?.state).toBe('failed');
    expect(receipt?.reason).toBe('handler_error');
    expect(drive.status('job-visfail')?.state).toBe('running');
  });
});

describe('worker availability', () => {
  const unavailable = () => {
    const error = new Error('worker executable unavailable');
    error.name = 'WorkerUnavailableError';
    return error;
  };

  it('does not claim any job when assertReady reports the worker unavailable', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-avail');
    const handler = Object.assign(async () => [] as JobFile[], {
      assertReady: () => {
        throw unavailable();
      },
    });

    await expect(runJobs(client, DRIVE, handler, { once: true })).rejects.toMatchObject({
      name: 'WorkerUnavailableError',
    });
    // Nothing was claimed.
    expect(drive.has('/jobs/.agent-drive/claims/job-avail.json')).toBe(false);
    expect(drive.has('/jobs/job-avail/status.json')).toBe(false);
  });

  it('stops claiming further jobs once the worker becomes unavailable mid-drain', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-w1');
    await seedSubmission(drive, 'job-w2');
    let checks = 0;
    const handler = Object.assign(async () => [] as JobFile[], {
      assertReady: () => {
        checks += 1;
        // startup check + job-w1 pass; the check before job-w2's claim fails
        if (checks === 3) throw unavailable();
      },
    });

    await expect(runJobs(client, DRIVE, handler, { once: true })).rejects.toMatchObject({
      name: 'WorkerUnavailableError',
    });
    expect(drive.status('job-w1')?.state).toBe('done');
    expect(drive.has('/jobs/.agent-drive/claims/job-w2.json')).toBe(false);
    expect(drive.has('/jobs/job-w2/status.json')).toBe(false);
  });

  it('surfaces a fatal error when the executable disappears after the claim', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-dead');
    const handler = async (): Promise<JobFile[]> => {
      throw unavailable();
    };

    await expect(runJobs(client, DRIVE, handler, { once: true })).rejects.toMatchObject({
      name: 'WorkerUnavailableError',
    });
    // The claim stays held as running; no 'failed' is persisted for a dead worker.
    expect(drive.status('job-dead')?.state).toBe('running');
    expect(drive.receipt('job-dead')?.state).toBe('running');
  });

  it('stops a watching worker when the executable dies mid-job', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-mid-dead');
    const handler = async (): Promise<JobFile[]> => {
      throw unavailable();
    };

    await expect(
      runJobs(client, DRIVE, handler, {
        once: false,
        signal: new AbortController().signal,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ name: 'WorkerUnavailableError' });
    // The held claim is preserved; no terminal failure is fabricated.
    expect(drive.status('job-mid-dead')?.state).toBe('running');
    expect(drive.receipt('job-mid-dead')?.state).toBe('running');
  });

  it('halts a watching worker before scanning when assertReady fails', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const handler = Object.assign(async () => [] as JobFile[], {
      assertReady: () => {
        throw unavailable();
      },
    });

    await expect(
      runJobs(client, DRIVE, handler, {
        once: false,
        signal: new AbortController().signal,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ name: 'WorkerUnavailableError' });
    // The worker stopped before any scan or claim.
    expect(drive.calls).not.toContain('jobSubmissions');
  });
});

describe('signal and pacing', () => {
  it('passes the shutdown signal to submission paging, metadata and input listing', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-sig', {
      inputs: [{ name: 'in.txt', bytes: textBytes('x') }],
    });
    const controller = new AbortController();

    await runJobs(client, DRIVE, async () => [], { once: true, signal: controller.signal });

    expect(drive.signalSeen.has('jobSubmissions')).toBe(true);
    expect(drive.signalSeen.has('meta:/jobs/job-sig/submitted.md')).toBe(true);
    expect(drive.signalSeen.has('list:/jobs/job-sig/inputs/')).toBe(true);
    expect(drive.signalSeen.has('get:/jobs/job-sig/submitted.md')).toBe(true);
  });

  it('drains each submissions page before fetching the next', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const ids: string[] = [];
    for (let index = 0; index < 110; index += 1) {
      const id = `job-${String(index).padStart(3, '0')}`;
      ids.push(id);
      await seedSubmission(drive, id, { viaSubmit: false });
    }

    await runJobs(client, DRIVE, async () => [], { once: true });

    const pageCalls = drive.calls
      .map((call, index) => (call === 'jobSubmissions' ? index : -1))
      .filter((index) => index >= 0);
    expect(pageCalls).toHaveLength(2);
    // Jobs from the first page are claimed before the second page is fetched.
    const firstClaim = drive.calls.indexOf('put:/jobs/.agent-drive/claims/job-000.json');
    const lastPageOneClaim = drive.calls.indexOf('put:/jobs/.agent-drive/claims/job-099.json');
    expect(firstClaim).toBeGreaterThan(pageCalls[0]!);
    expect(lastPageOneClaim).toBeGreaterThan(pageCalls[0]!);
    expect(lastPageOneClaim).toBeLessThan(pageCalls[1]!);
  });

  it('drains each live-feed page before fetching the next', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    const controller = new AbortController();
    drive.pollHook = async (call) => {
      // 60 submissions land during the first poll: 120 feed events (> one page).
      if (call === 1)
        for (let index = 0; index < 60; index += 1)
          await seedSubmission(drive, `feed-${String(index).padStart(3, '0')}`, {
            viaSubmit: false,
          });
      if (call >= 6 || drive.status('feed-059')) controller.abort();
    };

    await runJobs(client, DRIVE, async () => [], {
      once: false,
      signal: controller.signal,
      pollMs: 1,
      pollMaxMs: 2,
      sleep: async () => {},
    });

    const recentCalls = drive.calls
      .map((call, index) => (call === 'recent' ? index : -1))
      .filter((index) => index >= 0);
    expect(recentCalls.length).toBeGreaterThanOrEqual(2);
    // A claim landed before the second page of the feed was fetched.
    const firstClaim = drive.calls.indexOf('put:/jobs/.agent-drive/claims/feed-000.json');
    const lastPageOneClaim = drive.calls.indexOf('put:/jobs/.agent-drive/claims/feed-049.json');
    expect(firstClaim).toBeGreaterThan(recentCalls[0]!);
    expect(lastPageOneClaim).toBeGreaterThan(recentCalls[0]!);
    expect(lastPageOneClaim).toBeLessThan(recentCalls[1]!);
    expect(drive.status('feed-059')?.state).toBe('done');
  });

  it('keeps the grown backoff delay across retries instead of resetting it', async () => {
    vi.useFakeTimers();
    try {
      const drive = new FakeDrive();
      const client = asClient(drive);
      await seedSubmission(drive, 'job-backoff', { viaSubmit: false });
      const controller = new AbortController();
      // Every claim attempt 500s: recoverable, so the id keeps backing off.
      drive.inject.set('put:/jobs/.agent-drive/claims/job-backoff.json', () => outage());
      const attempts: number[] = [];
      drive.before = (call) => {
        if (call === 'put:/jobs/.agent-drive/claims/job-backoff.json') attempts.push(Date.now());
      };
      drive.pollHook = () => {
        vi.setSystemTime(Date.now() + 1); // one tick per poll
        if (attempts.length >= 4) controller.abort();
      };

      await runJobs(client, DRIVE, async () => [], {
        once: false,
        signal: controller.signal,
        pollMs: 1,
        pollMaxMs: 2,
        retryMs: 2,
        rescanMs: 0,
        sleep: async () => {},
      });

      expect(attempts).toHaveLength(4);
      const gaps = attempts.slice(1).map((at, index) => at - attempts[index]!);
      // Delays double per failure (2, 4, 8): a reset would retry every ~2 ticks.
      expect(gaps[1]).toBeGreaterThan(gaps[0]!);
      expect(gaps[2]).toBeGreaterThan(gaps[1]!);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed claim against the pinned submission version', async () => {
    const drive = new FakeDrive();
    const client = asClient(drive);
    await seedSubmission(drive, 'job-retry', { request: textBytes('v1'), viaSubmit: false });
    // The file changed after the move; the first claim attempt 500s once.
    await drive.put(DRIVE, '/jobs/job-retry/submitted.md', textBytes('v2'), {
      mode: 'overwrite',
    });
    drive.failures.set('put:/jobs/.agent-drive/claims/job-retry.json', 1);
    const controller = new AbortController();
    drive.pollHook = (call) => {
      if (drive.status('job-retry') || call > 200) controller.abort();
    };

    let requestText = '';
    await runJobs(
      client,
      DRIVE,
      async (job) => {
        requestText = new TextDecoder().decode(job.request);
        return [];
      },
      {
        once: false,
        signal: controller.signal,
        pollMs: 1,
        pollMaxMs: 2,
        retryMs: 1,
        rescanMs: 0,
        sleep: async () => {},
      },
    );

    expect(requestText).toBe('v1');
    expect(drive.status('job-retry')?.state).toBe('done');
  });
});

describe('recent feed semantics', () => {
  it('latestCursor is the last returned row, not the tail of the feed', async () => {
    const drive = new FakeDrive();
    await drive.put(DRIVE, '/one.txt', textBytes('1'));
    await drive.put(DRIVE, '/two.txt', textBytes('2'));

    const first = await drive.recent(DRIVE, undefined, 1, '0');
    expect(first.items).toHaveLength(1);
    expect(first.latestCursor).toBe('1');
    expect(first.nextCursor).toBe('1');

    const second = await drive.recent(DRIVE, undefined, 1, first.latestCursor!);
    expect(second.items).toHaveLength(1);
    expect(second.latestCursor).toBe('2');
    expect(second.nextCursor).toBeNull();

    // An empty page echoes the cursor that was sent.
    const tail = await drive.recent(DRIVE, undefined, 1, '2');
    expect(tail.items).toHaveLength(0);
    expect(tail.latestCursor).toBe('2');
  });

  it('recentHead returns the tail cursor, not the first row', async () => {
    const drive = new FakeDrive();
    expect(await drive.recentHead(DRIVE)).toBeNull();
    await drive.put(DRIVE, '/a.txt', textBytes('1'));
    await drive.put(DRIVE, '/b.txt', textBytes('2'));
    expect(await drive.recentHead(DRIVE)).toBe('2');
  });
});

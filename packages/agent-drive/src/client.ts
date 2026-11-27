import { createHash } from 'node:crypto';
import {
  CHUNK_SIZE,
  DriveCryptoError,
  decryptWithFileKeyStream,
  encryptFile,
  encryptFileStream,
  envelopeVersion,
  openFrameRange,
  unwrapFileKey,
} from './crypto.js';
import { ciphertextFrameRange, inspectHeader } from './crypto-format.js';
import { plaintextSize } from './crypto-format.js';
import {
  readExactRangeBody,
  sameVersion,
  type RangeReader,
  type RangeReaderOptions,
} from './mount-range.js';
import type { TraceInbox, TraceInboxRecord } from './trace-inbox.js';
import type { SealedDriveKey } from './seal.js';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ClientOptions = {
  apiUrl: string;
  apiKey: string;
  machine?: string;
  driveKey?: string | ((driveId: string) => string | undefined);
  fetch?: FetchLike;
};

export type PutOptions = {
  tags?: string[];
  description?: string;
  userId?: string;
  mode?: 'create' | 'overwrite';
  ifVersionId?: string;
  /** Allow create-only writes over the exact trashed state observed by the upload intent. */
  allowTrashedCreate?: boolean;
  /** Aborts an in-flight upload (used by capture shutdown). */
  signal?: AbortSignal;
};

export type PutStreamOptions = PutOptions & {
  /** Persist the stable intent ID before the ciphertext upload begins. */
  onIntent?: (intentId: string) => void | Promise<void>;
  /** Persist that storage accepted the full ciphertext before the commit request begins. */
  onUploadComplete?: (intentId: string) => void | Promise<void>;
};

export type GetOptions = {
  versionId?: string;
  /** Reject this plaintext size limit before requesting ciphertext. */
  maxPlaintextBytes?: number;
  signal?: AbortSignal;
};

export type Version = {
  id: string;
  path: string;
  ciphertextSize: number;
  wrappedKey: string;
  agentId: string;
  machineId: string | null;
  userId: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
};

export type FileEntry = {
  fileId: string;
  versionId: string;
  path: string;
  ciphertextSize: number;
  agentId: string;
  machineId: string | null;
  userId: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
};

export type FolderEntry = {
  kind: 'folder';
  path: string;
  items: number;
  ciphertextSize: number;
  createdAt: string;
};

type FolderEntryWire = {
  kind: 'folder';
  path: string;
  items: number;
  ciphertext_size: number | string;
  created_at: string;
};

type FileEntryWire = {
  id: string;
  path: string;
  version_id: string;
  ciphertext_size: number | string;
  agent_id: string;
  machine_id: string | null;
  user_id: string | null;
  tags: string[] | null;
  description: string | null;
  created_at: string;
};

export type Drive = {
  id: string;
  name: string;
  quota_bytes: number;
  created_at: string;
  created?: boolean;
  agentOnly?: boolean;
};

/** The account's public key for sealing drive keys to the owner; null until a passphrase is set. */
export type AccountPublicKey = { keyId: string; publicKey: string; format: number };

export type Agent = { id: string; name: string; created_at: string };

export type ApiKey = {
  id: string;
  agent_id: string;
  label: string;
  drive_ids: string[];
  scopes: string[];
  write_paths?: string[];
  issued_by_agent_id?: string | null;
  revoked_at?: string | null;
  created_at: string;
  token?: string;
};

export type Whoami = {
  accountId: string;
  agentId: string;
  keyId: string;
  scopes: string[];
  writePaths?: string[];
  driveIds: string[] | null;
};

export type DeviceRequestFacts = {
  user_code: string;
  client_name: string;
  machine: string | null;
  created_at: string;
  expires_at: string;
  public_key: string;
};

export type RecentEvent = {
  id: string;
  operation: 'put' | 'copy' | 'restore' | 'move' | 'delete';
  path: string;
  previousPath: string | null;
  versionId: string | null;
  agentId: string;
  agentName: string | null;
  machineId: string | null;
  userId: string | null;
  createdAt: string;
};

export type RecentPage = Page<RecentEvent> & { latestCursor: string | null };

export type Share = {
  id: string;
  path: string;
  versionId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status?: 'active' | 'expired' | 'revoked' | 'unavailable';
  url?: string;
};

export type ConflictState = 'exists' | 'changed' | 'trashed' | 'absent';
const conflictStates: unknown[] = ['exists', 'changed', 'trashed', 'absent'];
// Same pattern as uuid() in apps/web/src/api/validation.ts; keep in sync.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fileEntry(item: FileEntryWire): FileEntry {
  return {
    fileId: item.id,
    versionId: item.version_id,
    path: item.path,
    ciphertextSize: Number(item.ciphertext_size),
    agentId: item.agent_id,
    machineId: item.machine_id,
    userId: item.user_id,
    tags: item.tags ?? [],
    description: item.description,
    createdAt: item.created_at,
  };
}

export class AgentDriveApiError extends Error {
  readonly upgradeUrl: string | undefined;
  readonly retryAfter: number | undefined;
  readonly currentVersionId: string | null | undefined;
  readonly state: ConflictState | undefined;

  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    details: {
      upgradeUrl?: string | undefined;
      retryAfter?: number | undefined;
      currentVersionId?: string | null | undefined;
      state?: ConflictState | undefined;
    } = {},
  ) {
    super(message);
    this.upgradeUrl = details.upgradeUrl;
    this.retryAfter = details.retryAfter;
    this.currentVersionId = details.currentVersionId;
    this.state = details.state;
    this.name = 'AgentDriveApiError';
  }
}

export class StreamSizeLimitError extends Error {
  readonly code = 'size_limit_exceeded';

  constructor(
    readonly plaintextBytes: number,
    readonly maxPlaintextBytes: number,
  ) {
    super(`File is ${plaintextBytes} bytes; the inline limit is ${maxPlaintextBytes} bytes.`);
    this.name = 'StreamSizeLimitError';
  }
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateUrl(value: string, api: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('A valid URL is required.');
  }
  if (parsed.username || parsed.password || (api && parsed.hash)) {
    throw new TypeError('URLs must not contain credentials or fragments.');
  }
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))
  ) {
    throw new TypeError('Only HTTPS or exact localhost HTTP URLs are allowed.');
  }
  return parsed;
}

function validatedUpgradeUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    return validateUrl(value, false).toString();
  } catch {
    return undefined;
  }
}

function validatedRetryAfter(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function encode(value: string) {
  return encodeURIComponent(value);
}

function driveKeyFor(
  value: string | undefined | ((driveId: string) => string | undefined),
  driveId: string,
) {
  return typeof value === 'function' ? value(driveId) : value;
}

function isVersionMetadata(value: unknown): value is Version {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Version>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.path === 'string' &&
    Number.isSafeInteger(candidate.ciphertextSize) &&
    typeof candidate.wrappedKey === 'string' &&
    typeof candidate.agentId === 'string' &&
    (typeof candidate.machineId === 'string' || candidate.machineId === null) &&
    (typeof candidate.userId === 'string' || candidate.userId === null) &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string') &&
    (typeof candidate.description === 'string' || candidate.description === null) &&
    typeof candidate.createdAt === 'string'
  );
}

function versionCopy(version: Version): Version {
  return {
    id: version.id,
    path: version.path,
    ciphertextSize: version.ciphertextSize,
    wrappedKey: version.wrappedKey,
    agentId: version.agentId,
    machineId: version.machineId,
    userId: version.userId,
    tags: [...version.tags],
    description: version.description,
    createdAt: version.createdAt,
  };
}

const RECENT_POLL_MS = 2000;

function isAbort(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

// response.text() is raced against the signal so a body that stalls after headers cannot hang.
function readText(response: Response, signal?: AbortSignal | null): Promise<string> {
  if (!signal) return response.text();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    response
      .text()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class AgentDriveClient {
  private readonly baseUrl: URL;
  private readonly fetcher: FetchLike;

  constructor(private readonly options: ClientOptions) {
    const origin = validateUrl(options.apiUrl, true);
    origin.pathname = '/api/v1/';
    origin.search = '';
    origin.hash = '';
    this.baseUrl = origin;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (!options.apiKey) throw new TypeError('An API key is required.');
  }

  get apiOrigin() {
    return this.baseUrl.origin;
  }

  /** Opaque local-journal scope. It contains no API key or drive key. */
  writebackScopeId(driveId: string) {
    const credentialFingerprint = createHash('sha256').update(this.options.apiKey).digest('hex');
    const scopedIdentity = JSON.stringify([
      'agent-drive-mount-writeback-v1',
      this.baseUrl.href,
      driveId,
      credentialFingerprint,
    ]);
    return createHash('sha256').update(scopedIdentity).digest('hex');
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const url = new URL(path.replace(/^\/+/u, ''), this.baseUrl);
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.options.apiKey}`);
    headers.set('accept', 'application/json');
    if (this.options.machine) headers.set('x-agent-drive-machine', this.options.machine);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await this.fetcher(url, {
      ...init,
      headers,
      redirect: 'error',
    });
    const text = await readText(response, init.signal);
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    if (!response.ok) {
      const error =
        body && typeof body === 'object' && 'error' in body
          ? (
              body as {
                error?: {
                  code?: string;
                  message?: string;
                  upgradeUrl?: unknown;
                  retryAfter?: unknown;
                  currentVersionId?: unknown;
                  state?: unknown;
                };
              }
            ).error
          : undefined;
      throw new AgentDriveApiError(
        error?.code ?? 'internal_error',
        response.status,
        error?.message ?? `Agent Drive request failed with HTTP ${response.status}.`,
        {
          upgradeUrl: validatedUpgradeUrl(error?.upgradeUrl),
          retryAfter: validatedRetryAfter(error?.retryAfter),
          currentVersionId:
            error?.currentVersionId === null ||
            (typeof error?.currentVersionId === 'string' &&
              uuidPattern.test(error.currentVersionId))
              ? error.currentVersionId
              : undefined,
          state: conflictStates.includes(error?.state)
            ? (error?.state as ConflictState)
            : undefined,
        },
      );
    }
    return body as T;
  }

  private async storage(url: string, init: RequestInit = {}) {
    const parsed = validateUrl(url, false);
    const response = await this.fetcher(parsed, { ...init, redirect: 'error' });
    if (!response.ok) {
      throw new AgentDriveApiError(
        'storage_error',
        response.status,
        `Storage request failed with HTTP ${response.status}.`,
      );
    }
    return response;
  }

  private async authorizeRange(
    driveId: string,
    path: string,
    versionId: string,
    range: string,
    signal: AbortSignal,
    pinned?: Version,
  ) {
    const query = new URLSearchParams({
      path,
      metadataOnly: '1',
      authorizeRange: '1',
      versionId,
      range,
    });
    const result = await this.request<Version & { downloadRange?: unknown; downloadUrl?: unknown }>(
      `drives/${encode(driveId)}/get?${query.toString()}`,
      { signal },
    );
    if (
      !isVersionMetadata(result) ||
      result.id !== versionId ||
      result.path !== path ||
      (pinned && !sameVersion(result, pinned))
    )
      throw new AgentDriveApiError('internal_error', 502, 'The pinned file metadata changed.');
    if (result.downloadRange !== range)
      throw new AgentDriveApiError(
        'storage_error',
        502,
        'The server did not authorize the requested byte range.',
      );
    if (typeof result.downloadUrl !== 'string' || !result.downloadUrl)
      throw new AgentDriveApiError(
        'storage_error',
        502,
        'The server does not support authorized range downloads.',
      );
    return { version: versionCopy(result), downloadUrl: result.downloadUrl };
  }

  private async readAuthorizedRange(
    downloadUrl: string,
    range: string,
    ciphertextBytes: number,
    signal: AbortSignal,
  ) {
    const response = await this.fetcher(validateUrl(downloadUrl, false), {
      headers: { range },
      signal,
      redirect: 'error',
    });
    try {
      return await readExactRangeBody(response, range, ciphertextBytes, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AgentDriveApiError(
        'storage_error',
        502,
        error instanceof Error ? error.message : 'The storage range response was invalid.',
      );
    }
  }

  private readonly inboxes = new Map<string, TraceInboxRecord>();

  /** The drive's trace inbox record, or null. Only a found record is cached (an inbox may be created later). */
  async traceInbox(driveId: string, signal?: AbortSignal): Promise<TraceInboxRecord | null> {
    const cached = this.inboxes.get(driveId);
    if (cached) return cached;
    const { inbox } = await this.request<{
      inbox: (TraceInboxRecord & { createdAt?: string }) | null;
    }>(`drives/${encode(driveId)}/trace-inbox`, signal ? { signal } : {});
    if (!inbox) return null;
    const record = {
      keyId: inbox.keyId,
      publicKey: inbox.publicKey,
      wrappedPrivateKey: inbox.wrappedPrivateKey,
    };
    this.inboxes.set(driveId, record);
    return record;
  }

  /** For a v2 envelope: the inbox record bound to the requested drive. v1 never calls the server. */
  private async inboxFor(
    driveId: string,
    wrappedKey: string,
    signal?: AbortSignal,
  ): Promise<TraceInbox | undefined> {
    if (envelopeVersion(wrappedKey) !== 2) return undefined;
    const record = await this.traceInbox(driveId, signal);
    if (!record) {
      throw new DriveCryptoError(
        'inbox_key_required',
        `This file was sealed to the trace inbox of drive ${driveId}, but that drive has no trace inbox.`,
      );
    }
    return { driveId, ...record };
  }

  private keyFor(driveId: string) {
    return driveKeyFor(this.options.driveKey, driveId);
  }

  async whoami() {
    return this.request<Whoami>('whoami');
  }

  async createAgent(name: string) {
    return this.request<Agent>('agents', { method: 'POST', body: JSON.stringify({ name }) });
  }

  async createDrive(name: string, quotaBytes?: number, agentOnly?: boolean) {
    const body = {
      name,
      ...(quotaBytes === undefined ? {} : { quotaBytes }),
      ...(agentOnly === undefined ? {} : { agentOnly }),
    };
    return this.request<Drive>('drives', { method: 'POST', body: JSON.stringify(body) });
  }

  /** The owner's account public key (sealed-slot target), or null when no passphrase is set up. */
  async accountKey(): Promise<AccountPublicKey | null> {
    const result = await this.request<
      { keyId?: string; publicKey?: string; format?: number } & { accountKey?: unknown }
    >('account-key');
    if (result.accountKey === null) return null;
    if (
      typeof result.keyId !== 'string' ||
      typeof result.publicKey !== 'string' ||
      typeof result.format !== 'number'
    )
      throw new AgentDriveApiError('internal_error', 500, 'The account key response is invalid.');
    return { keyId: result.keyId, publicKey: result.publicKey, format: result.format };
  }

  /** Idempotent: 201 {status:'created'} or 200 {status:'exists'} when a slot is already stored. */
  async addAccountKeySlot(
    driveId: string,
    body: { keyId: string; sealed: SealedDriveKey },
  ): Promise<{ status: 'created' | 'exists'; revision?: number }> {
    return this.request<{ status: 'created' | 'exists'; revision?: number }>(
      `drives/${encode(driveId)}/account-key-slot`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  async createKey(
    agentId: string | undefined,
    label: string,
    driveIds: string[],
    scopes: string[],
    writePaths?: string[],
    agentName?: string,
  ) {
    return this.request<ApiKey>('keys', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        ...(agentName ? { agentName } : {}),
        label,
        driveIds,
        scopes,
        ...(writePaths ? { writePaths } : {}),
      }),
    });
  }

  async deviceRequest(code: string) {
    return this.request<DeviceRequestFacts>(`device/${encode(code)}`);
  }

  async grantDevice(
    code: string,
    body: {
      driveId: string;
      scopes: string[];
      writePaths: string[];
      sealedDriveKey: SealedDriveKey;
    },
  ) {
    return this.request<{ status: 'offered'; revision: number }>(`device/${encode(code)}/grant`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async revokeKey(keyId: string) {
    return this.request<{ id: string; revoked_at: string }>(`keys/${encode(keyId)}`, {
      method: 'DELETE',
    });
  }

  async listAgents(limit?: number, cursor?: string) {
    return this.request<Page<Agent>>(this.pagePath('agents', limit, cursor));
  }

  async listDrives(limit?: number, cursor?: string) {
    return this.request<Page<Drive>>(this.pagePath('drives', limit, cursor));
  }

  async listKeys(limit?: number, cursor?: string) {
    return this.request<Page<ApiKey>>(this.pagePath('keys', limit, cursor));
  }

  // Immediate children of `folder` (files and folder rows) and/or newest-first order. Opt-in:
  // plain `list` is unchanged.
  async browse(
    driveId: string,
    options: {
      folder?: string;
      prefix?: string;
      sort?: 'path' | 'modified';
      limit?: number;
      cursor?: string;
      filters?: { tag?: string; agentId?: string; machine?: string; user?: string };
    },
  ): Promise<Page<FileEntry | FolderEntry>> {
    const page = await this.request<Page<FileEntryWire | FolderEntryWire>>(
      this.pagePath(`drives/${encode(driveId)}/list`, options.limit, options.cursor, {
        ...(options.folder ? { prefix: options.folder, delimiter: '/' } : {}),
        ...(!options.folder && options.prefix ? { prefix: options.prefix } : {}),
        ...(options.sort ? { sort: options.sort } : {}),
        ...options.filters,
      }),
    );
    return {
      ...page,
      items: page.items.map((item) =>
        'kind' in item && item.kind === 'folder'
          ? {
              kind: 'folder' as const,
              path: item.path,
              items: item.items,
              ciphertextSize: Number(item.ciphertext_size),
              createdAt: item.created_at,
            }
          : fileEntry(item as FileEntryWire),
      ),
    };
  }

  async list(
    driveId: string,
    prefix?: string,
    limit?: number,
    cursor?: string,
    filters?: { tag?: string; agentId?: string; machine?: string; user?: string },
    signal?: AbortSignal,
  ): Promise<Page<FileEntry>> {
    const page = await this.request<Page<FileEntryWire>>(
      this.pagePath(`drives/${encode(driveId)}/list`, limit, cursor, {
        ...(prefix ? { prefix } : {}),
        ...filters,
      }),
      signal ? { signal } : {},
    );
    return {
      ...page,
      items: page.items.map(fileEntry),
    };
  }

  async versions(driveId: string, path: string, limit?: number, cursor?: string) {
    return this.request<Page<Version>>(
      this.pagePath(`drives/${encode(driveId)}/versions`, limit, cursor, { path }),
    );
  }

  async recent(
    driveId: string,
    since?: string,
    limit?: number,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return this.request<RecentPage>(
      this.pagePath(
        `drives/${encode(driveId)}/recent`,
        limit,
        cursor,
        since ? { since } : undefined,
      ),
      signal ? { signal } : {},
    );
  }

  /**
   * Job submissions still waiting for a worker: the transactional move events that renamed
   * /jobs/<id>/request.md to /jobs/<same id>/submitted.md while the submitted file is still at
   * that path and no worker receipt claims the job id. Each item carries the event's pinned
   * versionId (the submitted draft version), oldest first; page with `cursor`. Servers that do
   * not know `jobSubmissions` ignore it and return the ordinary event feed — the caller must
   * still revalidate each event's path, version and receipt before acting on it.
   */
  async pendingJobSubmissions(
    driveId: string,
    limit?: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<RecentPage> {
    return this.request<RecentPage>(
      this.pagePath(`drives/${encode(driveId)}/recent`, limit, cursor, {
        jobSubmissions: '1',
      }),
      signal ? { signal } : {},
    );
  }

  /**
   * The cursor of the newest committed event on the drive, or null when it has none. Pass it to
   * `recent` as `cursor` to see only later events. Servers that support `head=1` answer with one
   * indexed row; older servers ignore it and return the first page, whose latestCursor is still a
   * safe (if older) resume point — the caller just sees more events.
   */
  async recentHead(driveId: string, signal?: AbortSignal): Promise<string | null> {
    const page = await this.request<RecentPage>(
      `drives/${encode(driveId)}/recent?head=1&limit=1`,
      signal ? { signal } : {},
    );
    return page.latestCursor ?? null;
  }

  /**
   * Polls `recent` until an event appears or `waitMs` passes. Returns within `waitMs` plus the
   * abort latency of one in-flight request; a stalled server cannot hold it longer. Each poll is
   * one metered `drive.recent` operation.
   */
  async waitForRecent(
    driveId: string,
    options: {
      since?: string;
      cursor?: string;
      limit?: number;
      waitMs: number;
      signal?: AbortSignal;
    },
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ): Promise<RecentPage> {
    const deadline = Date.now() + options.waitMs;
    const caller = options.signal;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || caller?.aborted) break;
      try {
        const page = await this.recent(
          driveId,
          options.since,
          options.limit,
          options.cursor,
          caller
            ? AbortSignal.any([AbortSignal.timeout(remaining), caller])
            : AbortSignal.timeout(remaining),
        );
        if (caller?.aborted || Date.now() >= deadline) break;
        if (page.items.length > 0) return page;
      } catch (error) {
        if (!isAbort(error)) throw error;
        break;
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      const napping = sleep(Math.min(RECENT_POLL_MS, left));
      if (!caller) await napping;
      else
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            caller.removeEventListener('abort', onAbort);
            resolve();
          };
          caller.addEventListener('abort', onAbort, { once: true });
          napping.then(onAbort, (error: unknown) => {
            caller.removeEventListener('abort', onAbort);
            reject(error);
          });
          if (caller.aborted) onAbort();
        });
    }
    return { items: [], nextCursor: null, latestCursor: options.cursor ?? null };
  }

  async search(
    driveId: string,
    query?: { q?: string; tag?: string; agentId?: string; machine?: string; user?: string },
    limit?: number,
    cursor?: string,
  ) {
    return this.request<Page<Version>>(
      this.pagePath(`drives/${encode(driveId)}/search`, limit, cursor, query),
    );
  }

  async createShare(
    driveId: string,
    path: string,
    options: { versionId?: string; expiresAt?: string } = {},
  ) {
    const query = new URLSearchParams({ path, metadataOnly: '1' });
    if (options.versionId) query.set('versionId', options.versionId);
    const selected = await this.request<{ id: string; wrappedKey: string }>(
      `drives/${encode(driveId)}/get?${query.toString()}`,
    );
    const fileKey = await unwrapFileKey(
      selected.wrappedKey,
      this.keyFor(driveId),
      await this.inboxFor(driveId, selected.wrappedKey),
    );
    const created = await this.request<{
      id: string;
      path: string;
      versionId: string;
      expiresAt: string;
      createdAt: string;
    }>(`drives/${encode(driveId)}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        path,
        versionId: selected.id,
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      }),
    });
    return {
      id: created.id,
      path: created.path,
      versionId: created.versionId,
      expiresAt: created.expiresAt,
      url: `${this.apiOrigin}/s/${created.id}#k=${fileKey}`,
    };
  }

  async listShares(driveId: string, limit?: number, cursor?: string) {
    return this.request<Page<Share>>(
      this.pagePath(`drives/${encode(driveId)}/shares`, limit, cursor),
    );
  }

  async revokeShare(driveId: string, shareId: string) {
    return this.request<{ id: string; revokedAt: string }>(
      `drives/${encode(driveId)}/shares/${encode(shareId)}`,
      { method: 'DELETE' },
    );
  }

  /** Fetch pinned file metadata without fetching ciphertext or plaintext. */
  async getVersionMetadata(
    driveId: string,
    path: string,
    options: Pick<GetOptions, 'versionId' | 'signal'> = {},
  ) {
    const query = new URLSearchParams({ path, metadataOnly: '1' });
    if (options.versionId) query.set('versionId', options.versionId);
    return this.request<Version>(
      `drives/${encode(driveId)}/get?${query.toString()}`,
      options.signal ? { signal: options.signal } : {},
    );
  }

  async put(driveId: string, path: string, plaintext: Uint8Array, options: PutOptions = {}) {
    if (options.mode === 'create' && options.ifVersionId !== undefined) {
      throw new TypeError('Create-only writes cannot include ifVersionId.');
    }
    if (options.allowTrashedCreate && options.mode !== 'create') {
      throw new TypeError('allowTrashedCreate requires create-only mode.');
    }
    const encrypted = await encryptFile(plaintext, this.keyFor(driveId));
    return this.putEncrypted(driveId, path, encrypted.ciphertext, encrypted.wrappedKey, options);
  }

  /** Encrypt and upload a bounded stream through the normal intent, upload and commit flow. */
  async putStream(
    driveId: string,
    path: string,
    plaintext: AsyncIterable<Uint8Array>,
    plaintextBytes: number,
    options: PutStreamOptions = {},
  ) {
    if (options.mode === 'create' && options.ifVersionId !== undefined) {
      throw new TypeError('Create-only writes cannot include ifVersionId.');
    }
    if (options.allowTrashedCreate && options.mode !== 'create') {
      throw new TypeError('allowTrashedCreate requires create-only mode.');
    }
    const encrypted = await encryptFileStream(plaintext, plaintextBytes, this.keyFor(driveId));
    const body: Record<string, unknown> = {
      path,
      ciphertextSize: encrypted.ciphertextSize,
      wrappedKey: encrypted.wrappedKey,
    };
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.description !== undefined) body.description = options.description;
    if (options.userId !== undefined) body.userId = options.userId;
    if (options.ifVersionId !== undefined) body.ifVersionId = options.ifVersionId;
    else if (options.mode !== 'overwrite') body.ifVersionId = null;
    if (options.allowTrashedCreate) body.allowTrashedCreate = true;
    const intent = await this.request<{
      intentId: string;
      uploadUrl: string;
      ciphertextSize: number;
    }>(`drives/${encode(driveId)}/put`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (typeof intent.intentId !== 'string' || intent.intentId.length === 0) {
      throw new AgentDriveApiError('storage_error', 502, 'The upload intent ID was missing.');
    }
    if (intent.ciphertextSize !== encrypted.ciphertextSize) {
      throw new AgentDriveApiError('storage_error', 502, 'The upload intent size did not match.');
    }
    await options.onIntent?.(intent.intentId);
    const iterator = encrypted.ciphertext[Symbol.asyncIterator]();
    let resolveUpload!: () => void;
    let rejectUpload!: (reason?: unknown) => void;
    const uploadFinished = new Promise<void>((resolve, reject) => {
      resolveUpload = resolve;
      rejectUpload = reject;
    });
    uploadFinished.catch(() => {});
    const uploadBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            resolveUpload();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          rejectUpload(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        rejectUpload(reason ?? new Error('The upload stream was cancelled.'));
        await iterator.return?.(reason);
      },
    });
    await this.storage(intent.uploadUrl, {
      method: 'PUT',
      body: uploadBody,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(encrypted.ciphertextSize),
      },
      duplex: 'half',
      ...(options.signal ? { signal: options.signal } : {}),
    } as RequestInit);
    await uploadFinished;
    await options.onUploadComplete?.(intent.intentId);
    return this.replayCommit(
      driveId,
      intent.intentId,
      options.signal ? { signal: options.signal } : {},
    );
  }

  /** Idempotently retry commit for a durable intent whose acknowledgement may have been lost. */
  async replayCommit(driveId: string, intentId: string, options: Pick<PutOptions, 'signal'> = {}) {
    if (typeof intentId !== 'string' || intentId.length === 0 || intentId.length > 128) {
      throw new TypeError('A valid upload intent ID is required.');
    }
    const committed = await this.request<{ version: Version }>(`drives/${encode(driveId)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ intentId }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return committed.version;
  }

  /** Uploads bytes that were already encrypted with `encryptFile`. */
  async putEncrypted(
    driveId: string,
    path: string,
    ciphertext: Uint8Array<ArrayBuffer>,
    wrappedKey: string,
    options: PutOptions = {},
  ) {
    if (options.mode === 'create' && options.ifVersionId !== undefined) {
      throw new TypeError('Create-only writes cannot include ifVersionId.');
    }
    if (options.allowTrashedCreate && options.mode !== 'create') {
      throw new TypeError('allowTrashedCreate requires create-only mode.');
    }
    const body: Record<string, unknown> = {
      path,
      ciphertextSize: ciphertext.byteLength,
      wrappedKey,
    };
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.description !== undefined) body.description = options.description;
    if (options.userId !== undefined) body.userId = options.userId;
    if (options.ifVersionId !== undefined) body.ifVersionId = options.ifVersionId;
    else if (options.mode !== 'overwrite') body.ifVersionId = null;
    if (options.allowTrashedCreate) body.allowTrashedCreate = true;
    const intent = await this.request<{
      intentId: string;
      uploadUrl: string;
      ciphertextSize: number;
    }>(`drives/${encode(driveId)}/put`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await this.storage(intent.uploadUrl, {
      method: 'PUT',
      body: ciphertext,
      headers: { 'content-type': 'application/octet-stream' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const committed = await this.request<{ version: Version }>(`drives/${encode(driveId)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ intentId: intent.intentId }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return committed.version;
  }

  async get(driveId: string, path: string, options: GetOptions = {}) {
    const stream = await this.getStream(driveId, path, options);
    const bytes = new Uint8Array(stream.plaintextBytes);
    let offset = 0;
    try {
      for await (const chunk of stream.plaintext) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, version: stream.version };
    } catch (error) {
      bytes.fill(0);
      throw error;
    }
  }

  /** Opens a version-pinned reader that fetches only complete authenticated ciphertext frames. */
  async openRangeReader(
    driveId: string,
    path: string,
    versionId: string,
    options: RangeReaderOptions = {},
  ): Promise<RangeReader> {
    if (!versionId) throw new TypeError('A versionId is required for a ranged reader.');
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const headerRange = 'bytes=0-24';
    let header = new Uint8Array(0);
    let fileKey = '';
    let closed = false;
    try {
      const authorized = await this.authorizeRange(driveId, path, versionId, headerRange, signal);
      const selectedVersion = authorized.version;
      const inbox = await this.inboxFor(driveId, selectedVersion.wrappedKey, signal);
      fileKey = await unwrapFileKey(selectedVersion.wrappedKey, this.keyFor(driveId), inbox);
      header = await this.readAuthorizedRange(
        authorized.downloadUrl,
        headerRange,
        selectedVersion.ciphertextSize,
        signal,
      );

      let headerInfo: ReturnType<typeof inspectHeader>;
      try {
        headerInfo = inspectHeader(header, selectedVersion.ciphertextSize);
      } catch {
        throw new AgentDriveApiError(
          'storage_error',
          502,
          'The ciphertext header did not match the selected version.',
        );
      }

      const cache = new Map<number, Uint8Array>();
      const pendingFrames = new Map<number, Promise<Uint8Array>>();
      let cacheBytes = 0;
      const maxCacheBytes = 4 * CHUNK_SIZE;
      const assertOpen = () => {
        if (closed) throw new DOMException('The range reader is closed.', 'AbortError');
        if (signal.aborted)
          throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
      };
      const cacheFrame = (index: number, frame: Uint8Array) => {
        assertOpen();
        const prior = cache.get(index);
        if (prior) {
          cacheBytes -= prior.byteLength;
          prior.fill(0);
          cache.delete(index);
        }
        cache.set(index, frame);
        cacheBytes += frame.byteLength;
        while (cacheBytes > maxCacheBytes) {
          const oldest = cache.keys().next().value as number | undefined;
          if (oldest === undefined) break;
          const evicted = cache.get(oldest);
          cache.delete(oldest);
          if (evicted) {
            cacheBytes -= evicted.byteLength;
            evicted.fill(0);
          }
        }
      };
      const loadFrame = async (index: number): Promise<Uint8Array> => {
        assertOpen();
        const cached = cache.get(index);
        if (cached) {
          cache.delete(index);
          cache.set(index, cached);
          return cached;
        }
        const pending = pendingFrames.get(index);
        if (pending) return pending;

        const operation = (async () => {
          const ciphertextRange = ciphertextFrameRange(headerInfo, index, 1);
          const range = `bytes=${ciphertextRange.offset}-${ciphertextRange.offset + ciphertextRange.length - 1}`;
          const frameAuthorization = await this.authorizeRange(
            driveId,
            path,
            versionId,
            range,
            signal,
            selectedVersion,
          );
          const ciphertext = await this.readAuthorizedRange(
            frameAuthorization.downloadUrl,
            range,
            selectedVersion.ciphertextSize,
            signal,
          );
          let frame: Uint8Array | undefined;
          const source: AsyncIterable<Uint8Array> = {
            async *[Symbol.asyncIterator]() {
              yield ciphertext;
            },
          };
          try {
            for await (const plaintext of openFrameRange(
              source,
              fileKey,
              header,
              index,
              1,
              selectedVersion.ciphertextSize,
            )) {
              if (frame) {
                plaintext.fill(0);
                throw new Error('The frame decryptor returned more than one plaintext frame.');
              }
              frame = plaintext;
            }
            const expectedFrameBytes = Math.min(
              CHUNK_SIZE,
              headerInfo.plaintextBytes - index * CHUNK_SIZE,
            );
            if (!frame || frame.byteLength !== expectedFrameBytes)
              throw new AgentDriveApiError(
                'storage_error',
                502,
                'The authenticated frame length did not match the selected version.',
              );
            cacheFrame(index, frame);
            return frame;
          } catch (error) {
            frame?.fill(0);
            throw error;
          } finally {
            ciphertext.fill(0);
          }
        })();
        pendingFrames.set(index, operation);
        try {
          return await operation;
        } finally {
          if (pendingFrames.get(index) === operation) pendingFrames.delete(index);
        }
      };

      const close = async () => {
        if (closed) return;
        closed = true;
        controller.abort(new DOMException('The range reader is closed.', 'AbortError'));
        await Promise.allSettled(pendingFrames.values());
        header.fill(0);
        fileKey = '';
        for (const frame of cache.values()) frame.fill(0);
        cache.clear();
        cacheBytes = 0;
      };

      return {
        version: versionCopy(selectedVersion),
        plaintextBytes: headerInfo.plaintextBytes,
        read: async (offset: number, size: number) => {
          assertOpen();
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > headerInfo.plaintextBytes)
            throw new RangeError(
              'offset must be a non-negative position within the selected file.',
            );
          if (!Number.isSafeInteger(size) || size < 0)
            throw new RangeError('size must be a non-negative safe integer.');
          if (size > maxCacheBytes)
            throw new RangeError(`A ranged read cannot exceed ${maxCacheBytes} bytes.`);
          if (offset + size > Number.MAX_SAFE_INTEGER)
            throw new RangeError('The requested read range is too large.');
          const end = Math.min(headerInfo.plaintextBytes, offset + size);
          const result = new Uint8Array(end - offset);
          let written = 0;
          try {
            while (offset + written < end) {
              assertOpen();
              const absoluteOffset = offset + written;
              const frameIndex = Math.floor(absoluteOffset / CHUNK_SIZE);
              const frame = await loadFrame(frameIndex);
              const inFrameOffset = absoluteOffset - frameIndex * CHUNK_SIZE;
              const count = Math.min(frame.byteLength - inFrameOffset, end - absoluteOffset);
              result.set(frame.subarray(inFrameOffset, inFrameOffset + count), written);
              written += count;
            }
            return result;
          } catch (error) {
            result.fill(0);
            throw error;
          }
        },
        close,
      };
    } catch (error) {
      controller.abort(error);
      header.fill(0);
      fileKey = '';
      throw error;
    }
  }

  /** Open a metered download as authenticated plaintext chunks. */
  async getStream(driveId: string, path: string, options: GetOptions = {}) {
    const query = new URLSearchParams({ path });
    if (options.versionId) query.set('versionId', options.versionId);
    if (options.maxPlaintextBytes !== undefined) {
      if (!Number.isSafeInteger(options.maxPlaintextBytes) || options.maxPlaintextBytes < 0)
        throw new TypeError('maxPlaintextBytes must be a non-negative safe integer.');
      query.set('maxPlaintextBytes', String(options.maxPlaintextBytes));
      // Older servers understand metadataOnly but ignore maxPlaintextBytes. This prevents them
      // from authorizing a download until the client has checked the selected version's size.
      query.set('metadataOnly', '1');
      query.set('authorizeIfWithinLimit', '1');
    }
    let metadata = await this.request<Version & { downloadUrl?: string }>(
      `drives/${encode(driveId)}/get?${query.toString()}`,
      options.signal ? { signal: options.signal } : {},
    );
    const plaintextBytes = plaintextSize(metadata.ciphertextSize);
    if (options.maxPlaintextBytes !== undefined && plaintextBytes > options.maxPlaintextBytes)
      throw new StreamSizeLimitError(plaintextBytes, options.maxPlaintextBytes);
    if (!metadata.downloadUrl && options.maxPlaintextBytes !== undefined) {
      const pinnedQuery = new URLSearchParams({ path, versionId: metadata.id });
      pinnedQuery.set('maxPlaintextBytes', String(options.maxPlaintextBytes));
      const pinned = await this.request<Version & { downloadUrl?: string }>(
        `drives/${encode(driveId)}/get?${pinnedQuery.toString()}`,
        options.signal ? { signal: options.signal } : {},
      );
      if (pinned.id !== metadata.id || pinned.ciphertextSize !== metadata.ciphertextSize)
        throw new AgentDriveApiError('internal_error', 502, 'The pinned file metadata changed.');
      metadata = pinned;
    }
    if (!metadata.downloadUrl)
      throw new AgentDriveApiError('internal_error', 502, 'The download URL is missing.');
    const fileKeyPromise = this.inboxFor(driveId, metadata.wrappedKey, options.signal).then(
      (inbox) => unwrapFileKey(metadata.wrappedKey, this.keyFor(driveId), inbox),
    );
    fileKeyPromise.catch(() => {});
    const response = await this.storage(
      metadata.downloadUrl,
      options.signal ? { signal: options.signal } : {},
    );
    if (!response.body)
      throw new AgentDriveApiError('storage_error', 502, 'The download body is missing.');
    const reader = response.body.getReader();
    let cancelled = false;
    let sourceComplete = false;
    let sourceReading = false;
    let readerReleased = false;
    const releaseReader = () => {
      if (readerReleased) return;
      readerReleased = true;
      reader.releaseLock();
    };
    const cancelReader = async (reason?: unknown) => {
      if (cancelled || sourceComplete) return;
      cancelled = true;
      try {
        await reader.cancel(reason);
      } finally {
        if (!sourceReading) releaseReader();
      }
    };
    const ciphertext: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        sourceReading = true;
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) {
              sourceComplete = true;
              return;
            }
            yield result.value;
          }
        } finally {
          sourceReading = false;
          if (!sourceComplete) await cancelReader().catch(() => undefined);
          releaseReader();
        }
      },
    };
    let fileKey: string;
    try {
      fileKey = await fileKeyPromise;
    } catch (error) {
      await cancelReader(error).catch(() => undefined);
      throw error;
    }
    const decrypted = decryptWithFileKeyStream(ciphertext, fileKey, metadata.ciphertextSize);
    const plaintext: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        const iterator = decrypted[Symbol.asyncIterator]();
        let complete = false;
        let seen = 0;
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done) {
              complete = true;
              if (seen !== plaintextBytes)
                throw new AgentDriveApiError(
                  'storage_error',
                  502,
                  'The plaintext size did not match.',
                );
              return;
            }
            seen += next.value.byteLength;
            if (
              seen > plaintextBytes ||
              (options.maxPlaintextBytes !== undefined && seen > options.maxPlaintextBytes)
            )
              throw new StreamSizeLimitError(seen, options.maxPlaintextBytes ?? plaintextBytes);
            yield next.value;
          }
        } finally {
          if (!complete) {
            try {
              await iterator.return?.();
            } finally {
              await cancelReader().catch(() => undefined);
            }
          }
        }
      },
    };
    return {
      plaintext,
      plaintextBytes,
      version: metadata,
      cancel: async (reason?: unknown) => {
        await cancelReader(reason).catch(() => undefined);
      },
    };
  }

  async move(driveId: string, path: string, destinationPath: string, userId?: string) {
    return this.request<{ id: string; path: string }>(`drives/${encode(driveId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ path, destinationPath, ...(userId ? { userId } : {}) }),
    });
  }

  async mkdir(driveId: string, path: string) {
    return this.request<{ path: string; directory_id: string; created_at: string }>(
      `drives/${encode(driveId)}/mkdir`,
      { method: 'POST', body: JSON.stringify({ path }) },
    );
  }

  async rmdir(driveId: string, path: string) {
    return this.request<{ path: string }>(`drives/${encode(driveId)}/rmdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async rename(
    driveId: string,
    path: string,
    destinationPath: string,
    options: {
      ifSourceVersionId: string;
      ifDestinationVersionId: string | null;
      operationId: string;
    },
  ) {
    return this.request<{ id: string; path: string; versionId: string }>(
      `drives/${encode(driveId)}/rename`,
      {
        method: 'POST',
        body: JSON.stringify({ path, destinationPath, ...options }),
      },
    );
  }

  async unlink(driveId: string, path: string, ifVersionId: string) {
    return this.request<{ id: string; path: string; deleted_at: string }>(
      `drives/${encode(driveId)}/unlink`,
      {
        method: 'POST',
        body: JSON.stringify({ path, ifVersionId }),
      },
    );
  }

  async copy(
    driveId: string,
    path: string,
    destinationPath: string,
    options: { versionId?: string; userId?: string } = {},
  ) {
    return this.request<{ version: Version }>(`drives/${encode(driveId)}/copy`, {
      method: 'POST',
      body: JSON.stringify({
        path,
        destinationPath,
        ...(options.versionId ? { versionId: options.versionId } : {}),
        ...(options.userId ? { userId: options.userId } : {}),
      }),
    });
  }

  async delete(driveId: string, path: string, userId?: string) {
    return this.request<{ id: string; path: string; deleted_at: string }>(
      `drives/${encode(driveId)}/delete`,
      {
        method: 'POST',
        body: JSON.stringify({ path, ...(userId ? { userId } : {}) }),
      },
    );
  }

  async restore(driveId: string, path: string, versionId?: string, userId?: string) {
    return this.request<{ version: Version }>(`drives/${encode(driveId)}/restore`, {
      method: 'POST',
      body: JSON.stringify({
        path,
        ...(versionId ? { versionId } : {}),
        ...(userId ? { userId } : {}),
      }),
    });
  }

  private pagePath(path: string, limit?: number, cursor?: string, params?: Record<string, string>) {
    const query = new URLSearchParams(params);
    if (limit !== undefined) query.set('limit', String(limit));
    if (cursor !== undefined) query.set('cursor', cursor);
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
  }
}

/** Drops the presigned download URL and the wrapped file key from anything an agent is shown. */
export function publicOutput<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => publicOutput(item)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'wrappedKey' && key !== 'downloadUrl')
        .map(([key, item]) => [key, publicOutput(item)]),
    ) as T;
  return value;
}

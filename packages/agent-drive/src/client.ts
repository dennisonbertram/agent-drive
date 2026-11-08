import {
  DriveCryptoError,
  decryptFile,
  encryptFile,
  envelopeVersion,
  unwrapFileKey,
} from './crypto.js';
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
  /** Aborts an in-flight upload (used by capture shutdown). */
  signal?: AbortSignal;
};

export type GetOptions = { versionId?: string };

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
};

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

  private readonly inboxes = new Map<string, TraceInboxRecord>();

  /** The drive's trace inbox record, or null. Only a found record is cached (an inbox may be created later). */
  async traceInbox(driveId: string): Promise<TraceInboxRecord | null> {
    const cached = this.inboxes.get(driveId);
    if (cached) return cached;
    const { inbox } = await this.request<{
      inbox: (TraceInboxRecord & { createdAt?: string }) | null;
    }>(`drives/${encode(driveId)}/trace-inbox`);
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
  private async inboxFor(driveId: string, wrappedKey: string): Promise<TraceInbox | undefined> {
    if (envelopeVersion(wrappedKey) !== 2) return undefined;
    const record = await this.traceInbox(driveId);
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

  async createDrive(name: string, quotaBytes?: number) {
    const body = quotaBytes === undefined ? { name } : { name, quotaBytes };
    return this.request<Drive>('drives', { method: 'POST', body: JSON.stringify(body) });
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
  ): Promise<Page<FileEntry>> {
    const page = await this.request<Page<FileEntryWire>>(
      this.pagePath(`drives/${encode(driveId)}/list`, limit, cursor, {
        ...(prefix ? { prefix } : {}),
        ...filters,
      }),
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
        await Promise.race([
          napping,
          new Promise<void>((resolve) =>
            caller.addEventListener('abort', () => resolve(), { once: true }),
          ),
        ]);
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

  async put(driveId: string, path: string, plaintext: Uint8Array, options: PutOptions = {}) {
    if (options.mode === 'create' && options.ifVersionId !== undefined) {
      throw new TypeError('Create-only writes cannot include ifVersionId.');
    }
    const encrypted = await encryptFile(plaintext, this.keyFor(driveId));
    return this.putEncrypted(driveId, path, encrypted.ciphertext, encrypted.wrappedKey, options);
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
    const query = new URLSearchParams({ path });
    if (options.versionId) query.set('versionId', options.versionId);
    const metadata = await this.request<Version & { downloadUrl: string }>(
      `drives/${encode(driveId)}/get?${query.toString()}`,
    );
    const response = await this.storage(metadata.downloadUrl);
    const ciphertext = new Uint8Array(await response.arrayBuffer());
    const bytes = await decryptFile(
      ciphertext,
      metadata.wrappedKey,
      this.keyFor(driveId),
      await this.inboxFor(driveId, metadata.wrappedKey),
    );
    return { bytes, version: metadata };
  }

  async move(driveId: string, path: string, destinationPath: string, userId?: string) {
    return this.request<{ id: string; path: string }>(`drives/${encode(driveId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ path, destinationPath, ...(userId ? { userId } : {}) }),
    });
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

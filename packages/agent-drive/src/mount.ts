import { spawn, type ChildProcess } from 'node:child_process';
import { access, lstat, mkdir, readdir, rmdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import type { AgentDriveClient, FileEntry, FolderEntry, Version } from './client.js';
import { AgentDriveApiError } from './client.js';
import { plaintextSize } from './crypto-format.js';
import { configPath } from './config.js';

export const MOUNT_MAX_READ_BYTES = 1024 * 1024;
export const MOUNT_MAX_WRITE_BYTES = 1024 * 1024;
const MAX_PROTOCOL_LINE_BYTES = 64 * 1024;
const MAX_PROTOCOL_WRITE_LINE_BYTES = 1536 * 1024;
const MAX_PROTOCOL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_CACHE_ENTRIES = 4096;
const METADATA_CACHE_TTL_MS = 2000;
const MAX_ACTIVE_LISTING_STATES = 256;
const LISTING_STATE_TTL_MS = 5 * 60 * 1000;

export type MountEntry = {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
  versionId?: string;
};
type MountRequest = {
  id: string | number;
  op: string;
  path?: unknown;
  destinationPath?: unknown;
  cursor?: unknown;
  versionId?: unknown;
  baseVersionId?: unknown;
  ifVersionId?: unknown;
  ifSourceVersionId?: unknown;
  ifDestinationVersionId?: unknown;
  operationId?: unknown;
  handleId?: unknown;
  data?: unknown;
  offset?: unknown;
  size?: unknown;
  truncateOnOpen?: unknown;
  incomplete?: unknown;
};
export type MountResponse =
  | { id: string | number; ok: true; entries: MountEntry[]; nextCursor: string | null }
  | { id: string | number; ok: true; entry: MountEntry }
  | { id: string | number; ok: true; entry: unknown }
  | { id: string | number; ok: true; data: string; eof?: boolean }
  | { id: string | number; ok: true; capabilities: MountCapabilities }
  | { id: string | number; ok: true; handleId: string; recoveryPath: string; size: number }
  | { id: string | number; ok: true; bytesWritten: number }
  | { id: string | number; ok: true; size: number }
  | { id: string | number; ok: true; version: { id: string; path: string } }
  | { id: string | number; ok: true; recoveryPath?: string }
  | { id: string | number; ok: true }
  | {
      id: string | number;
      ok: false;
      errno: string;
      recoveryPath?: string;
      currentVersionId?: string;
      mutationOutcome?: 'notSubmitted' | 'unknown';
    };

export type MountCapabilities = {
  readOnly: boolean;
  write: boolean;
  delete: boolean;
  writePaths: string[];
  maxReadBytes: number;
  maxWriteBytes: number;
  ops: string[];
};

type MountReader = {
  readonly version: Version;
  readonly plaintextBytes: number;
  read(offset: number, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
};
type MountClient = Pick<AgentDriveClient, 'browse'> & {
  openRangeReader(
    driveId: string,
    path: string,
    versionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<MountReader>;
  getVersionMetadata?: (
    driveId: string,
    path: string,
    options?: { versionId?: string; signal?: AbortSignal },
  ) => Promise<Version>;
  mkdir?: (driveId: string, path: string) => Promise<unknown>;
  rmdir?: (driveId: string, path: string) => Promise<unknown>;
  unlink?: (driveId: string, path: string, ifVersionId: string) => Promise<unknown>;
  rename?: (
    driveId: string,
    path: string,
    destinationPath: string,
    options: {
      ifSourceVersionId: string;
      ifDestinationVersionId: string | null;
      operationId: string;
    },
  ) => Promise<unknown>;
};

type MountStagedEntry = {
  path: string;
  size: number;
  handleId?: string;
  recoveryPath: string;
  state: string;
  versionId?: string;
};

type MountWriteback = {
  openWrite(
    path: string,
    baseVersionId: string | null,
    sizeHint?: number,
    truncateOnOpen?: boolean,
    allowTrashedCreate?: boolean,
    incomplete?: boolean,
  ): Promise<{
    handleId: string;
    recoveryPath: string;
    size: number;
  }>;
  write(handleId: string, offset: number, data: Uint8Array): Promise<{ bytesWritten: number }>;
  truncate(handleId: string, size: number): Promise<{ size: number }>;
  completeWrite?(handleId: string): Promise<void>;
  readStaged(
    handleId: string,
    offset: number,
    size: number,
  ): Promise<{ data: Uint8Array; eof: boolean }>;
  flush(handleId: string): Promise<{ id: string; path: string }>;
  release(handleId: string): Promise<{ recoveryPath?: string }>;
  closeWithoutFlush(handleId: string): Promise<{ recoveryPath?: string }>;
  listStaged(prefix?: string): Promise<MountStagedEntry[]>;
  recover(): Promise<unknown[]>;
  close(): Promise<void>;
};

function validPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) return false;
  if (value === '/') return true;
  if (value.endsWith('/') || value.includes('\\')) return false;
  return value
    .slice(1)
    .split('/')
    .every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function mountErrno(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (
    typeof code === 'string' &&
    [
      'ENOENT',
      'EACCES',
      'EIO',
      'EROFS',
      'EINVAL',
      'ESTALE',
      'ENOSPC',
      'EDQUOT',
      'EFBIG',
      'EBUSY',
      'EBADF',
    ].includes(code)
  )
    return code;
  if (error instanceof AgentDriveApiError) {
    if (error.code === 'quota_exceeded') return 'ENOSPC';
    if (error.code === 'payment_required') return 'EDQUOT';
    if (error.status === 404) return 'ENOENT';
    if (error.status === 403 || error.status === 401) return 'EACCES';
    if (error.status === 409) return 'ESTALE';
  }
  return 'EIO';
}

function mountErrorDetails(error: unknown) {
  const record = error as { recoveryPath?: unknown; currentVersionId?: unknown } | undefined;
  return {
    ...(typeof record?.recoveryPath === 'string' ? { recoveryPath: record.recoveryPath } : {}),
    ...(typeof record?.currentVersionId === 'string'
      ? { currentVersionId: record.currentVersionId }
      : {}),
  };
}

const STAGED_VERSION_PREFIX = 'staged:';

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function requestPath(request: MountRequest) {
  if (!validPath(request.path)) throw Object.assign(new Error('Invalid path.'), { code: 'EINVAL' });
  return request.path as string;
}

function entryName(path: string, parent: string) {
  if (!validPath(path) || parentPath(path) !== parent)
    throw Object.assign(new Error('Invalid entry path.'), { code: 'EIO' });
  const name = path.slice(parent === '/' ? 1 : parent.length + 1);
  if (!name || name.includes('/') || name === '.' || name === '..' || name.includes('\\'))
    throw Object.assign(new Error('Invalid entry path.'), { code: 'EIO' });
  return name;
}

function mtime(value: string) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function fileMountEntry(item: FileEntry, parent: string): MountEntry {
  return {
    name: entryName(item.path, parent),
    kind: 'file',
    size: plaintextSize(item.ciphertextSize),
    mtimeMs: mtime(item.createdAt),
    versionId: item.versionId,
  };
}

function folderMountEntry(item: FolderEntry, parent: string): MountEntry {
  return {
    name: entryName(item.path, parent),
    kind: 'directory',
    size: 0,
    mtimeMs: mtime(item.createdAt),
  };
}

function stagedMountEntry(staged: MountStagedEntry, parent: string): MountEntry {
  return {
    name: entryName(staged.path, parent),
    kind: 'file',
    size: staged.size,
    mtimeMs: Date.now(),
    versionId: `${STAGED_VERSION_PREFIX}${staged.handleId}`,
  };
}

function parentPath(path: string) {
  if (path === '/') return '/';
  const slash = path.lastIndexOf('/');
  return slash === 0 ? '/' : path.slice(0, slash);
}

/** Create a validated, reusable request dispatcher for the native mount helper. */
export async function createMountBridge(
  client: MountClient,
  driveId: string,
  options: {
    signal?: AbortSignal;
    capabilities?: MountCapabilities;
    writeback?: MountWriteback;
  } = {},
) {
  let activeReader: { key: string; reader: MountReader } | undefined;
  const stagedHandles = new Map<string, { path: string; size: number; recoveryPath: string }>();
  const activeWriteHandles = new Set<string>();
  const stagedTokenVersions = new Map<string, { path: string; versionId: string; size: number }>();
  const metadataCache = new Map<string, { entry: MountEntry; expiresAt: number }>();
  const listingStates = new Map<
    string,
    { candidates: Map<string, MountStagedEntry>; expiresAt: number }
  >();
  const shutdownController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, shutdownController.signal])
    : shutdownController.signal;
  let closed = false;
  let requestTail = Promise.resolve();
  let readerTail = Promise.resolve();
  // Flush stays on the mutation tail, while immutable remote reads can bypass its wait.
  let activeFlushes = 0;
  const capabilities =
    options.capabilities ??
    ({
      readOnly: true,
      write: false,
      delete: false,
      writePaths: [],
      maxReadBytes: MOUNT_MAX_READ_BYTES,
      maxWriteBytes: MOUNT_MAX_WRITE_BYTES,
      ops: ['stat', 'list', 'read', 'capabilities'],
    } satisfies MountCapabilities);
  let writeback = options.writeback;
  if (capabilities.write && !writeback) {
    const module = await import('./mount-writeback.js');
    writeback = await module.createMountWriteback({
      client: client as AgentDriveClient,
      driveId,
      journalRoot: join(dirname(configPath()), 'mount-writeback'),
    });
  }
  if (writeback) {
    for (const result of await writeback.recover()) {
      if (!result || typeof result !== 'object') continue;
      const recovery = result as { path?: unknown; state?: unknown; recoveryPath?: unknown };
      if (
        (recovery.state === 'conflict' || recovery.state === 'pending') &&
        typeof recovery.recoveryPath === 'string'
      ) {
        process.stderr.write(
          `Agent Drive mount recovery: ${recovery.state} for ${typeof recovery.path === 'string' && recovery.path ? recovery.path : '(unknown remote path)'}; local recovery file: ${recovery.recoveryPath}\n`,
        );
      }
    }
  }

  function canWrite(path: string) {
    if (!capabilities.write || capabilities.readOnly)
      throw Object.assign(new Error('The mount is read-only.'), { code: 'EROFS' });
    if (
      capabilities.writePaths.length > 0 &&
      !capabilities.writePaths.some(
        (root) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`),
      )
    )
      throw Object.assign(new Error('The path is outside the allowed write paths.'), {
        code: 'EACCES',
      });
  }

  function canDelete(path: string) {
    canWrite(path);
    if (!capabilities.delete)
      throw Object.assign(new Error('Delete permission is required.'), { code: 'EACCES' });
  }

  function requireWriteback() {
    if (!writeback) throw Object.assign(new Error('The mount is read-only.'), { code: 'EROFS' });
    return writeback;
  }

  function requireStagedHandle(handleId: unknown) {
    if (typeof handleId !== 'string' || handleId.length < 1 || handleId.length > 128)
      throw Object.assign(new Error('Invalid write handle.'), { code: 'EINVAL' });
    const stage = stagedHandles.get(handleId);
    if (!stage)
      throw Object.assign(new Error('The write handle is not available.'), { code: 'EBADF' });
    canWrite(stage.path);
    return stage;
  }

  function invalidateMetadata(path: string) {
    for (const key of metadataCache.keys()) {
      if (key === path || key.startsWith(`${path}/`)) metadataCache.delete(key);
    }
  }

  async function stagedForPath(path: string) {
    if (!writeback) return undefined;
    const values = await writeback.listStaged(parentPath(path));
    return values.find((entry) => entry.path === path);
  }

  async function resolveMutationVersion(
    path: string,
    requestedVersion: unknown,
    ensureActive: () => void = () => {},
  ) {
    if (!validVersion(requestedVersion))
      throw Object.assign(new Error('A pinned file version is required.'), { code: 'EINVAL' });
    const requestedHandleId = requestedVersion.startsWith(STAGED_VERSION_PREFIX)
      ? requestedVersion.slice(STAGED_VERSION_PREFIX.length)
      : undefined;
    const staged = await stagedForPath(path);
    if (staged) {
      if (!requestedHandleId || !staged.handleId || staged.handleId !== requestedHandleId)
        throw Object.assign(new Error('The staged file is no longer available.'), {
          code: 'ESTALE',
        });
      ensureActive();
      stagedHandles.set(staged.handleId, {
        path,
        size: staged.size,
        recoveryPath: staged.recoveryPath,
      });
      const version = await requireWriteback().flush(staged.handleId);
      if (!validUuid(version.id))
        throw Object.assign(new Error('The committed file version is invalid.'), { code: 'EIO' });
      const committed = { path, versionId: version.id, size: staged.size };
      stagedTokenVersions.set(staged.handleId, committed);
      return version.id;
    }
    if (!requestedHandleId) {
      if (!validUuid(requestedVersion))
        throw Object.assign(new Error('The pinned file version is invalid.'), { code: 'EINVAL' });
      return requestedVersion;
    }
    const committed = stagedTokenVersions.get(requestedHandleId);
    if (!committed || committed.path !== path || !validUuid(committed.versionId))
      throw Object.assign(new Error('The staged file path changed.'), { code: 'ESTALE' });
    return committed.versionId;
  }

  async function getReader(path: string, versionId: string) {
    const key = `${path}\0${versionId}`;
    if (activeReader?.key === key) return activeReader.reader;
    const previous = activeReader;
    activeReader = undefined;
    if (previous) await previous.reader.close();
    if (signal.aborted) throw signal.reason ?? new Error('Mount stopped.');
    const reader = await client.openRangeReader(driveId, path, versionId, {
      signal,
    });
    if (reader.version.id !== versionId) {
      await reader.close();
      throw Object.assign(new Error('The requested version is no longer available.'), {
        code: 'ESTALE',
      });
    }
    if (!Number.isSafeInteger(reader.plaintextBytes) || reader.plaintextBytes < 0) {
      await reader.close();
      throw Object.assign(new Error('The range reader returned an invalid plaintext size.'), {
        code: 'EIO',
      });
    }
    activeReader = { key, reader };
    return reader;
  }

  async function list(path: string, cursor: string | undefined): Promise<MountResponse> {
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096))
      throw Object.assign(new Error('Invalid cursor.'), { code: 'EINVAL' });
    const page = await client.browse(driveId, {
      folder: path,
      ...(cursor ? { cursor } : {}),
    });
    const cursorKey = cursor === undefined ? undefined : `${path}\0${cursor}`;
    const listing = cursorKey ? listingStates.get(cursorKey) : undefined;
    if (cursorKey) listingStates.delete(cursorKey);
    const candidates = new Map<string, MountStagedEntry>();
    if (cursor === undefined && capabilities.write && !capabilities.readOnly && writeback) {
      for (const staged of await writeback.listStaged(path)) {
        if (
          !validPath(staged.path) ||
          parentPath(staged.path) !== path ||
          !Number.isSafeInteger(staged.size) ||
          staged.size < 0 ||
          !staged.handleId
        )
          continue;
        candidates.set(entryName(staged.path, path), staged);
        stagedHandles.set(staged.handleId, {
          path: staged.path,
          size: staged.size,
          recoveryPath: staged.recoveryPath,
        });
      }
    } else if (listing && listing.expiresAt > Date.now()) {
      for (const [name, staged] of listing.candidates) candidates.set(name, staged);
    }
    const entriesByName = new Map<string, MountEntry>();
    for (const item of page.items) {
      let entry =
        'kind' in item && item.kind === 'folder'
          ? folderMountEntry(item, path)
          : fileMountEntry(item as FileEntry, path);
      const staged = candidates.get(entry.name);
      if (staged) {
        candidates.delete(entry.name);
        if (entry.kind === 'file' && staged.versionId === entry.versionId)
          entry = stagedMountEntry(staged, path);
      }
      const childPath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
      const previous = entriesByName.get(entry.name);
      if (!previous || entry.kind === 'directory') entriesByName.set(entry.name, entry);
      const cachedEntry = metadataCache.get(childPath)?.entry;
      if (!cachedEntry || cachedEntry.kind !== 'directory' || entry.kind === 'directory')
        metadataCache.set(childPath, { entry, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
    }
    if (page.nextCursor && candidates.size > 0) {
      const now = Date.now();
      for (const [key, value] of listingStates) {
        if (value.expiresAt <= now) listingStates.delete(key);
      }
      const nextKey = `${path}\0${page.nextCursor}`;
      listingStates.delete(nextKey);
      listingStates.set(nextKey, { candidates, expiresAt: now + LISTING_STATE_TTL_MS });
      while (listingStates.size > MAX_ACTIVE_LISTING_STATES) {
        const oldest = listingStates.keys().next().value;
        if (oldest === undefined) break;
        listingStates.delete(oldest);
      }
    } else if (!page.nextCursor) {
      for (const [name, staged] of candidates) {
        const entry = stagedMountEntry(staged, path);
        entriesByName.set(name, entry);
        const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
        metadataCache.set(childPath, { entry, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
      }
    }
    while (metadataCache.size > MAX_METADATA_CACHE_ENTRIES) {
      const first = metadataCache.keys().next().value;
      if (first === undefined) break;
      metadataCache.delete(first);
    }
    const entries = [...entriesByName.values()];
    return { id: '', ok: true, entries, nextCursor: page.nextCursor };
  }

  async function stat(path: string): Promise<MountEntry> {
    if (path === '/') return { name: '', kind: 'directory', size: 0, mtimeMs: 0 };
    const cached = metadataCache.get(path);
    if (cached?.entry.kind === 'directory' && cached.expiresAt > Date.now()) return cached.entry;
    const staged = await stagedForPath(path);
    if (staged && staged.handleId) {
      let directoryCursor: string | undefined;
      const directoryCursors = new Set<string>();
      for (;;) {
        const page = await client.browse(driveId, {
          folder: parentPath(path),
          ...(directoryCursor ? { cursor: directoryCursor } : {}),
        });
        const directory = page.items.find(
          (candidate) =>
            'kind' in candidate && candidate.kind === 'folder' && candidate.path === path,
        );
        if (directory) return folderMountEntry(directory as FolderEntry, parentPath(path));
        if (!page.nextCursor) break;
        if (directoryCursors.has(page.nextCursor))
          throw Object.assign(new Error('Repeated list cursor.'), { code: 'EIO' });
        directoryCursors.add(page.nextCursor);
        directoryCursor = page.nextCursor;
      }
      stagedHandles.set(staged.handleId, {
        path: staged.path,
        size: staged.size,
        recoveryPath: staged.recoveryPath,
      });
      return {
        name: entryName(path, parentPath(path)),
        kind: 'file',
        size: staged.size,
        mtimeMs: Date.now(),
        versionId: `${STAGED_VERSION_PREFIX}${staged.handleId}`,
      };
    }
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.entry;
      metadataCache.delete(path);
    }
    const parent = parentPath(path);
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const page = await client.browse(driveId, {
        folder: parent,
        ...(cursor ? { cursor } : {}),
      });
      const item =
        page.items.find(
          (candidate) =>
            'kind' in candidate && candidate.kind === 'folder' && candidate.path === path,
        ) ?? page.items.find((candidate) => candidate.path === path);
      if (item)
        return 'kind' in item && item.kind === 'folder'
          ? folderMountEntry(item, parent)
          : fileMountEntry(item as FileEntry, parent);
      if (!page.nextCursor) break;
      if (seen.has(page.nextCursor))
        throw Object.assign(new Error('Repeated list cursor.'), { code: 'EIO' });
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw Object.assign(new Error('Path not found.'), { code: 'ENOENT' });
  }

  async function statVersion(path: string, versionId: string, requestSignal?: AbortSignal) {
    if (!client.getVersionMetadata)
      throw Object.assign(new Error('Pinned version metadata is unavailable.'), { code: 'EIO' });
    const metadata = await client.getVersionMetadata(driveId, path, {
      versionId,
      signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
    });
    if (metadata.id !== versionId || metadata.path !== path)
      throw Object.assign(new Error('The requested version metadata did not match.'), {
        code: 'ESTALE',
      });
    return {
      name: entryName(path, parentPath(path)),
      kind: 'file' as const,
      size: plaintextSize(metadata.ciphertextSize),
      mtimeMs: mtime(metadata.createdAt),
      versionId: metadata.id,
    };
  }

  let closePromise: Promise<void> | undefined;
  const bridge = {
    dispatch: async (
      input: unknown,
      requestSignal?: AbortSignal,
      progress = { mutationSubmitted: false },
    ): Promise<MountResponse> => {
      const fallbackId =
        input &&
        typeof input === 'object' &&
        'id' in input &&
        (typeof input.id === 'string' ||
          (typeof input.id === 'number' && Number.isSafeInteger(input.id)))
          ? (input.id as string | number)
          : '';
      let isMutation = false;
      try {
        if (closed) throw Object.assign(new Error('Mount bridge is closed.'), { code: 'EIO' });
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw Object.assign(new Error('Invalid request.'), { code: 'EINVAL' });
        const request = input as MountRequest;
        if (
          !(typeof request.id === 'string'
            ? request.id.length > 0 && request.id.length <= 256
            : Number.isSafeInteger(request.id) && (request.id as number) >= 0)
        )
          throw Object.assign(new Error('Invalid request id.'), { code: 'EINVAL' });
        isMutation = ['mkdir', 'rmdir', 'unlink', 'rename'].includes(request.op);
        const ensureRequestActive = () => {
          if (requestSignal?.aborted)
            throw Object.assign(new Error('The request was canceled before submission.'), {
              code: 'ECANCELED',
            });
        };
        ensureRequestActive();
        if (request.op === 'capabilities') return { id: request.id, ok: true, capabilities };
        const path = ['list', 'stat', 'read'].includes(request.op)
          ? requestPath(request)
          : undefined;
        if (request.op === 'list') {
          const response = await list(path!, request.cursor as string | undefined);
          return { ...response, id: request.id } as MountResponse;
        }
        if (request.op === 'stat') {
          if (request.versionId === undefined)
            return { id: request.id, ok: true, entry: await stat(path!) };
          if (!validUuid(request.versionId) || path === '/')
            throw Object.assign(new Error('Invalid pinned stat request.'), { code: 'EINVAL' });
          return {
            id: request.id,
            ok: true,
            entry: await statVersion(path!, request.versionId, requestSignal),
          };
        }
        if (request.op === 'read') {
          if (
            path === '/' ||
            !validVersion(request.versionId) ||
            !Number.isSafeInteger(request.offset) ||
            (request.offset as number) < 0 ||
            !Number.isSafeInteger(request.size) ||
            (request.size as number) < 0 ||
            (request.size as number) > MOUNT_MAX_READ_BYTES ||
            (request.offset as number) + (request.size as number) > Number.MAX_SAFE_INTEGER
          )
            throw Object.assign(new Error('Invalid read request.'), { code: 'EINVAL' });
          const requestedSize = request.size as number;
          const stagedHandleId = request.versionId.startsWith(STAGED_VERSION_PREFIX)
            ? request.versionId.slice(STAGED_VERSION_PREFIX.length)
            : undefined;
          if (stagedHandleId) {
            const stage = stagedHandles.get(stagedHandleId);
            if (stage && stage.path !== path)
              throw Object.assign(new Error('The staged read path does not match its handle.'), {
                code: 'EINVAL',
              });
            if (stage) canWrite(stage.path);
            if (stage && writeback) {
              try {
                const result = await writeback.readStaged(
                  stagedHandleId,
                  request.offset as number,
                  requestedSize,
                );
                if (
                  !(result.data instanceof Uint8Array) ||
                  result.data.byteLength > requestedSize ||
                  typeof result.eof !== 'boolean'
                )
                  throw Object.assign(new Error('The staged reader returned invalid data.'), {
                    code: 'EIO',
                  });
                const encoded = Buffer.from(result.data);
                const data = encoded.toString('base64');
                encoded.fill(0);
                return { id: request.id, ok: true, data };
              } catch (error) {
                if (mountErrno(error) !== 'EBADF') throw error;
              }
            }
            const committed = stagedTokenVersions.get(stagedHandleId);
            if (!committed || committed.path !== path)
              throw Object.assign(new Error('The staged file handle is no longer available.'), {
                code: 'ESTALE',
              });
            canWrite(committed.path);
            const reader = await getReader(path!, committed.versionId);
            const expected = Math.max(
              0,
              Math.min(requestedSize, committed.size - (request.offset as number)),
            );
            const bytes = await reader.read(request.offset as number, requestedSize);
            if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected) {
              const invalid = activeReader;
              activeReader = undefined;
              await invalid?.reader.close().catch(() => undefined);
              throw Object.assign(new Error('The range reader returned an invalid byte count.'), {
                code: 'EIO',
              });
            }
            const encoded = Buffer.from(bytes);
            const data = encoded.toString('base64');
            encoded.fill(0);
            return { id: request.id, ok: true, data };
          }
          const reader = await getReader(path!, request.versionId);
          const expectedBytes = Math.max(
            0,
            Math.min(requestedSize, reader.plaintextBytes - (request.offset as number)),
          );
          if (expectedBytes === 0) return { id: request.id, ok: true, data: '' };
          let bytes: Uint8Array;
          try {
            bytes = await reader.read(request.offset as number, requestedSize);
          } catch (error) {
            const failed = activeReader;
            activeReader = undefined;
            await failed?.reader.close().catch(() => undefined);
            throw error;
          }
          if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expectedBytes) {
            const invalid = activeReader;
            activeReader = undefined;
            await invalid?.reader.close().catch(() => undefined);
            throw Object.assign(new Error('The range reader returned an invalid byte count.'), {
              code: 'EIO',
            });
          }
          const encoded = Buffer.from(bytes);
          const data = encoded.toString('base64');
          encoded.fill(0);
          return { id: request.id, ok: true, data };
        }
        if (request.op === 'openWrite') {
          const target = requestPath(request);
          canWrite(target);
          if (
            !(request.baseVersionId === null || validUuid(request.baseVersionId)) ||
            (request.truncateOnOpen !== undefined && typeof request.truncateOnOpen !== 'boolean') ||
            (request.incomplete !== undefined && typeof request.incomplete !== 'boolean') ||
            (request.size !== undefined &&
              (!Number.isSafeInteger(request.size) ||
                (request.size as number) < 0 ||
                (request.size as number) > 5 * 1024 * 1024 * 1024))
          )
            throw Object.assign(new Error('Invalid open-write request.'), { code: 'EINVAL' });
          const opened = await requireWriteback().openWrite(
            target,
            request.baseVersionId as string | null,
            request.size as number | undefined,
            request.truncateOnOpen === true,
            request.baseVersionId === null,
            request.incomplete === true,
          );
          stagedHandles.set(opened.handleId, {
            path: target,
            size: opened.size,
            recoveryPath: opened.recoveryPath,
          });
          activeWriteHandles.add(opened.handleId);
          return { id: request.id, ok: true, ...opened } as MountResponse;
        }
        if (request.op === 'write') {
          if (
            typeof request.handleId !== 'string' ||
            request.handleId.length < 1 ||
            request.handleId.length > 128 ||
            !Number.isSafeInteger(request.offset) ||
            (request.offset as number) < 0 ||
            typeof request.data !== 'string' ||
            Buffer.byteLength(request.data) > Math.ceil(MOUNT_MAX_WRITE_BYTES / 3) * 4
          )
            throw Object.assign(new Error('Invalid write request.'), { code: 'EINVAL' });
          const stage = requireStagedHandle(request.handleId);
          const decoded = Buffer.from(request.data, 'base64');
          if (
            decoded.byteLength > MOUNT_MAX_WRITE_BYTES ||
            decoded.toString('base64') !== request.data
          ) {
            decoded.fill(0);
            throw Object.assign(new Error('Invalid base64 write data.'), { code: 'EINVAL' });
          }
          try {
            const result = await requireWriteback().write(
              request.handleId,
              request.offset as number,
              decoded,
            );
            stage.size = Math.max(stage.size, (request.offset as number) + result.bytesWritten);
            return { id: request.id, ok: true, ...result } as MountResponse;
          } finally {
            decoded.fill(0);
          }
        }
        if (request.op === 'truncate') {
          if (
            typeof request.handleId !== 'string' ||
            !Number.isSafeInteger(request.size) ||
            (request.size as number) < 0
          )
            throw Object.assign(new Error('Invalid truncate request.'), { code: 'EINVAL' });
          const stage = requireStagedHandle(request.handleId);
          const result = await requireWriteback().truncate(
            request.handleId,
            request.size as number,
          );
          stage.size = result.size;
          return { id: request.id, ok: true, ...result } as MountResponse;
        }
        if (request.op === 'completeWrite') {
          if (typeof request.handleId !== 'string')
            throw Object.assign(new Error('Invalid complete-write request.'), { code: 'EINVAL' });
          requireStagedHandle(request.handleId);
          const writer = requireWriteback();
          if (!writer.completeWrite)
            throw Object.assign(new Error('Write completion is unavailable.'), { code: 'EIO' });
          await writer.completeWrite(request.handleId);
          return { id: request.id, ok: true } as MountResponse;
        }
        if (request.op === 'readStaged') {
          if (
            typeof request.handleId !== 'string' ||
            !Number.isSafeInteger(request.offset) ||
            (request.offset as number) < 0 ||
            !Number.isSafeInteger(request.size) ||
            (request.size as number) < 0 ||
            (request.size as number) > MOUNT_MAX_READ_BYTES
          )
            throw Object.assign(new Error('Invalid staged-read request.'), { code: 'EINVAL' });
          requireStagedHandle(request.handleId);
          const result = await requireWriteback().readStaged(
            request.handleId,
            request.offset as number,
            request.size as number,
          );
          if (
            !(result.data instanceof Uint8Array) ||
            result.data.byteLength > (request.size as number)
          )
            throw Object.assign(new Error('The staged reader returned invalid data.'), {
              code: 'EIO',
            });
          const bytes = Buffer.from(result.data);
          const data = bytes.toString('base64');
          bytes.fill(0);
          return { id: request.id, ok: true, data, eof: result.eof } as MountResponse;
        }
        if (request.op === 'flush') {
          if (typeof request.handleId !== 'string')
            throw Object.assign(new Error('Invalid flush request.'), { code: 'EINVAL' });
          const stage = requireStagedHandle(request.handleId);
          const version = await requireWriteback().flush(request.handleId);
          if (!validUuid(version.id))
            throw Object.assign(new Error('The committed file version is invalid.'), {
              code: 'EIO',
            });
          stagedTokenVersions.set(request.handleId, {
            path: stage.path,
            versionId: version.id,
            size: stage.size,
          });
          return { id: request.id, ok: true, version } as MountResponse;
        }
        if (request.op === 'release') {
          if (typeof request.handleId !== 'string')
            throw Object.assign(new Error('Invalid release request.'), { code: 'EINVAL' });
          const stage = requireStagedHandle(request.handleId);
          let failure: unknown;
          try {
            const version = await requireWriteback().flush(request.handleId);
            if (!validUuid(version.id))
              throw Object.assign(new Error('The committed file version is invalid.'), {
                code: 'EIO',
              });
            stagedTokenVersions.set(request.handleId, {
              path: stage.path,
              versionId: version.id,
              size: stage.size,
            });
          } catch (error) {
            failure = error;
          }
          let result: { recoveryPath?: string };
          try {
            result = await requireWriteback().release(request.handleId);
          } finally {
            activeWriteHandles.delete(request.handleId);
          }
          if (failure) throw failure;
          if (result.recoveryPath)
            return { id: request.id, ok: false, errno: 'EIO', recoveryPath: result.recoveryPath };
          return { id: request.id, ok: true } as MountResponse;
        }
        if (request.op === 'closeWrite') {
          if (typeof request.handleId !== 'string')
            throw Object.assign(new Error('Invalid write-handle close request.'), {
              code: 'EINVAL',
            });
          const stage = stagedHandles.get(request.handleId);
          if (!stage) {
            activeWriteHandles.delete(request.handleId);
            return { id: request.id, ok: true } as MountResponse;
          }
          let result: { recoveryPath?: string };
          try {
            result = await requireWriteback().closeWithoutFlush(request.handleId);
          } finally {
            activeWriteHandles.delete(request.handleId);
          }
          stagedHandles.delete(request.handleId);
          return {
            id: request.id,
            ok: true,
            ...(result.recoveryPath ? { recoveryPath: result.recoveryPath } : {}),
          } as MountResponse;
        }
        if (request.op === 'mkdir') {
          const target = requestPath(request);
          canWrite(target);
          if (!client.mkdir)
            throw Object.assign(new Error('Directory creation is unavailable.'), { code: 'EIO' });
          ensureRequestActive();
          progress.mutationSubmitted = true;
          const entry = await client.mkdir(driveId, target);
          invalidateMetadata(target);
          return { id: request.id, ok: true, entry } as MountResponse;
        }
        if (request.op === 'rmdir') {
          const target = requestPath(request);
          canDelete(target);
          if (!client.rmdir)
            throw Object.assign(new Error('Directory removal is unavailable.'), { code: 'EIO' });
          ensureRequestActive();
          progress.mutationSubmitted = true;
          const entry = await client.rmdir(driveId, target);
          invalidateMetadata(target);
          return { id: request.id, ok: true, entry } as MountResponse;
        }
        if (request.op === 'unlink') {
          const target = requestPath(request);
          canDelete(target);
          if (!validVersion(request.ifVersionId))
            throw Object.assign(new Error('A pinned file version is required.'), {
              code: 'EINVAL',
            });
          if (!client.unlink)
            throw Object.assign(new Error('File deletion is unavailable.'), { code: 'EIO' });
          const ifVersionId = await resolveMutationVersion(
            target,
            request.ifVersionId,
            ensureRequestActive,
          );
          ensureRequestActive();
          progress.mutationSubmitted = true;
          const entry = await client.unlink(driveId, target, ifVersionId);
          invalidateMetadata(target);
          return { id: request.id, ok: true, entry } as MountResponse;
        }
        if (request.op === 'rename') {
          const source = requestPath(request);
          const destination = request.destinationPath;
          if (!validPath(destination))
            throw Object.assign(new Error('Invalid destination path.'), { code: 'EINVAL' });
          const target = destination as string;
          canWrite(source);
          canWrite(target);
          if (
            !validVersion(request.ifSourceVersionId) ||
            !(
              request.ifDestinationVersionId === null ||
              validVersion(request.ifDestinationVersionId)
            ) ||
            typeof request.operationId !== 'string' ||
            !request.operationId ||
            request.operationId.length > 128 ||
            !validUuid(request.operationId)
          )
            throw Object.assign(new Error('Invalid rename request.'), { code: 'EINVAL' });
          if (request.ifDestinationVersionId !== null) {
            if (!capabilities.delete)
              throw Object.assign(
                new Error('Delete permission is required to replace a destination.'),
                { code: 'EACCES' },
              );
          }
          if (!client.rename)
            throw Object.assign(new Error('Rename is unavailable.'), { code: 'EIO' });
          if (
            [...activeWriteHandles].some(
              (handleId) => stagedHandles.get(handleId)?.path === source,
            ) ||
            [...activeWriteHandles].some((handleId) => stagedHandles.get(handleId)?.path === target)
          )
            throw Object.assign(new Error('An open write handle prevents rename.'), {
              code: 'EBUSY',
            });
          const ifSourceVersionId = await resolveMutationVersion(
            source,
            request.ifSourceVersionId,
            ensureRequestActive,
          );
          const ifDestinationVersionId =
            request.ifDestinationVersionId === null
              ? null
              : await resolveMutationVersion(
                  target,
                  request.ifDestinationVersionId,
                  ensureRequestActive,
                );
          ensureRequestActive();
          progress.mutationSubmitted = true;
          const entry = await client.rename(driveId, source, target, {
            ifSourceVersionId,
            ifDestinationVersionId,
            operationId: request.operationId,
          });
          invalidateMetadata(source);
          invalidateMetadata(target);
          return { id: request.id, ok: true, entry } as MountResponse;
        }
        if (['create'].includes(request.op))
          throw Object.assign(new Error('Unsupported operation.'), { code: 'EINVAL' });
        throw Object.assign(new Error('Unsupported operation.'), { code: 'EINVAL' });
      } catch (error) {
        return {
          id: fallbackId,
          ok: false,
          errno: mountErrno(error),
          ...mountErrorDetails(error),
          ...(requestSignal?.aborted && isMutation
            ? { mutationOutcome: progress.mutationSubmitted ? 'unknown' : 'notSubmitted' }
            : {}),
        };
      }
    },
    request(input: unknown, requestSignal?: AbortSignal): Promise<MountResponse> {
      const requestId =
        input &&
        typeof input === 'object' &&
        'id' in input &&
        (typeof input.id === 'string' ||
          (typeof input.id === 'number' && Number.isSafeInteger(input.id)))
          ? (input.id as string | number)
          : '';
      const isMutation =
        input &&
        typeof input === 'object' &&
        'op' in input &&
        ['mkdir', 'rmdir', 'unlink', 'rename'].includes(String(input.op));
      const progress = { mutationSubmitted: false };
      const canceled = (): MountResponse => ({
        id: requestId,
        ok: false,
        errno: 'EIO',
        ...(isMutation
          ? { mutationOutcome: progress.mutationSubmitted ? 'unknown' : 'notSubmitted' }
          : {}),
      });
      if (requestSignal?.aborted) return Promise.resolve(canceled());
      const op = input && typeof input === 'object' && 'op' in input ? String(input.op) : undefined;
      const independentRead = ['capabilities', 'stat', 'list', 'read'].includes(op ?? '');
      const bypassFlushWait = independentRead && activeFlushes > 0;
      const scheduleRead = () => {
        if (closed) return dispatchRequest(input, requestSignal, progress);
        const queued = readerTail.then(async () => {
          if (requestSignal?.aborted) return canceled();
          return await dispatchRequest(input, requestSignal, progress);
        });
        readerTail = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued;
      };
      const pending = bypassFlushWait
        ? op === 'read'
          ? scheduleRead()
          : dispatchRequest(input, requestSignal, progress)
        : requestTail.then(async () => {
            if (op === 'read') return await scheduleRead();
            if (op !== 'flush') return await dispatchRequest(input, requestSignal, progress);
            activeFlushes += 1;
            try {
              return await dispatchRequest(input, requestSignal, progress);
            } finally {
              activeFlushes -= 1;
            }
          });
      if (!bypassFlushWait) {
        requestTail = pending.then(
          () => undefined,
          () => undefined,
        );
      }
      if (!requestSignal) return pending;
      return new Promise<MountResponse>((resolveRequest, rejectRequest) => {
        const onAbort = () => resolveRequest(canceled());
        requestSignal.addEventListener('abort', onAbort, { once: true });
        pending.then(
          (response) => {
            requestSignal.removeEventListener('abort', onAbort);
            resolveRequest(response);
          },
          (error) => {
            requestSignal.removeEventListener('abort', onAbort);
            rejectRequest(error);
          },
        );
      });
    },
    async close() {
      if (closePromise) return closePromise;
      closed = true;
      shutdownController.abort(new DOMException('The mount bridge is closing.', 'AbortError'));
      closePromise = (async () => {
        await requestTail;
        await readerTail;
        metadataCache.clear();
        const reader = activeReader;
        activeReader = undefined;
        try {
          await reader?.reader.close();
        } finally {
          try {
            await writeback?.close();
          } finally {
            stagedHandles.clear();
            activeWriteHandles.clear();
            stagedTokenVersions.clear();
          }
        }
      })();
      return closePromise;
    },
  };
  const dispatchRequest = bridge.dispatch;
  return bridge;
}

export function resolveMountHelper(
  moduleUrl = import.meta.url,
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.AGENT_DRIVE_MOUNT_HELPER;
  if (configured !== undefined) {
    if (!isAbsolute(configured))
      throw new Error('AGENT_DRIVE_MOUNT_HELPER must be an absolute path.');
    return configured;
  }
  if (process.platform !== 'linux')
    throw new Error('No packaged Agent Drive mount helper is available for this platform.');
  const architecture =
    process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : undefined;
  if (!architecture)
    throw new Error(`No packaged Agent Drive mount helper is available for ${process.arch}.`);
  const packageDirectory = dirname(fileURLToPath(moduleUrl));
  return resolve(packageDirectory, '..', 'native', `linux-${architecture}`, 'agent-drive-mount');
}

function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^AGENT_DRIVE_/u.test(key)),
  ) as NodeJS.ProcessEnv;
}

export async function runLinuxMount(
  client: MountClient,
  driveId: string,
  mountPoint: string,
  options: {
    helperPath?: string;
    signal?: AbortSignal;
    readWrite?: boolean;
    capabilities?: MountCapabilities;
    writeback?: MountWriteback;
  } = {},
) {
  const helperPath = options.helperPath ?? resolveMountHelper();
  if (!isAbsolute(helperPath)) throw new Error('The mount helper path must be absolute.');
  try {
    if (!(await stat(helperPath)).isFile()) throw new Error('not a file');
    await access(helperPath, constants.X_OK);
  } catch {
    throw new Error('The Agent Drive mount helper is missing or not executable.');
  }
  if (options.signal?.aborted) return;
  const abortController = new AbortController();
  let child: ChildProcess | undefined;
  let shutdownNotice: NodeJS.Timeout | undefined;
  const clearShutdownNotice = () => {
    if (shutdownNotice) {
      clearTimeout(shutdownNotice);
      shutdownNotice = undefined;
    }
  };
  const requestStop = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    if (!shutdownNotice) {
      shutdownNotice = setTimeout(() => {
        shutdownNotice = undefined;
        if (
          options.signal?.aborted &&
          !abortController.signal.aborted &&
          child &&
          child.exitCode === null &&
          child.signalCode === null
        )
          process.stderr.write(
            'Agent Drive mount shutdown is waiting for open files. Close files and leave the mounted directory to finish unmounting.\n',
          );
      }, 2000);
      shutdownNotice.unref();
    }
  };
  const bridge = await createMountBridge(client, driveId, {
    signal: abortController.signal,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.writeback ? { writeback: options.writeback } : {}),
  });
  options.signal?.addEventListener('abort', requestStop, { once: true });
  let closed = false;
  let mountPointCleanup: (() => Promise<void>) | undefined;
  const fail = (error: Error) => {
    if (!closed) {
      closed = true;
      abortController.abort(error);
      child?.kill('SIGTERM');
    }
    return error;
  };
  try {
    if (options.signal?.aborted || abortController.signal.aborted) return;
    const prepared = await prepareMountPoint(mountPoint);
    mountPointCleanup = prepared.cleanup;
    if (options.signal?.aborted || abortController.signal.aborted) return;
    const runningChild = spawn(
      helperPath,
      [prepared.path, ...(options.readWrite ? ['--read-write'] : [])],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment(process.env),
      },
    );
    child = runningChild;
    if (!runningChild.stdin || !runningChild.stdout || !runningChild.stderr)
      throw new Error('Mount helper pipes are unavailable.');
    runningChild.stderr.resume(); // Diagnostics from the native helper are intentionally not forwarded.
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let queue = Promise.resolve();
    let protocolFailure: Error | undefined;
    let processing = false;
    const send = async (response: MountResponse) => {
      if (!runningChild.stdin || runningChild.stdin.destroyed)
        throw new Error('Mount helper stopped reading requests.');
      const line = `${JSON.stringify(response)}\n`;
      if (Buffer.byteLength(line) > MAX_PROTOCOL_RESPONSE_BYTES)
        throw new Error('Mount helper response is too large.');
      await new Promise<void>((resolveWrite, rejectWrite) => {
        runningChild.stdin!.write(line, (error) => (error ? rejectWrite(error) : resolveWrite()));
      });
    };
    const scheduleDrain = () => {
      if (processing || protocolFailure) return;
      processing = true;
      runningChild.stdout!.pause();
      queue = queue
        .then(async () => {
          for (;;) {
            const newline = pending.indexOf('\n');
            if (newline < 0) break;
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            const lineBytes = Buffer.byteLength(line);
            if (lineBytes > MAX_PROTOCOL_WRITE_LINE_BYTES)
              throw new Error('Mount helper protocol line is too long.');
            let request: unknown;
            try {
              request = JSON.parse(line);
            } catch {
              throw new Error('Mount helper sent malformed protocol data.');
            }
            if (
              lineBytes > MAX_PROTOCOL_LINE_BYTES &&
              (!request ||
                typeof request !== 'object' ||
                !('op' in request) ||
                request.op !== 'write')
            )
              throw new Error('Mount helper protocol metadata line is too long.');
            await send(await bridge.request(request));
          }
        })
        .catch((error: unknown) => {
          protocolFailure = fail(
            error instanceof Error ? error : new Error('Mount helper protocol failed.'),
          );
        })
        .finally(() => {
          processing = false;
          if (protocolFailure) return;
          if (pending.includes('\n')) scheduleDrain();
          else runningChild.stdout!.resume();
        });
    };
    const onData = (chunk: Buffer) => {
      pending += decoder.write(chunk);
      if (Buffer.byteLength(pending) > MAX_PROTOCOL_WRITE_LINE_BYTES && !pending.includes('\n')) {
        protocolFailure = fail(new Error('Mount helper protocol line is too long.'));
        return;
      }
      if (pending.includes('\n')) scheduleDrain();
    };
    runningChild.stdout.on('data', onData);
    const exitResult = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
    }>((resolveExit) => {
      let forceKill: NodeJS.Timeout | undefined;
      let processError: Error | undefined;
      const clearForceKill = () => {
        if (forceKill) {
          clearTimeout(forceKill);
          forceKill = undefined;
        }
      };
      const onInternalAbort = () => {
        if (processError || runningChild.exitCode !== null || runningChild.signalCode !== null)
          return;
        runningChild.kill('SIGTERM');
        if (!forceKill) {
          forceKill = setTimeout(() => {
            forceKill = undefined;
            if (runningChild.exitCode === null && runningChild.signalCode === null)
              runningChild.kill('SIGKILL');
          }, 2000);
          forceKill.unref();
        }
      };
      if (abortController.signal.aborted) onInternalAbort();
      else abortController.signal.addEventListener('abort', onInternalAbort, { once: true });
      if (options.signal?.aborted) requestStop();
      runningChild.once('error', (error) => {
        processError = error;
        clearForceKill();
        clearShutdownNotice();
      });
      runningChild.once('close', (code, signal) => {
        clearForceKill();
        clearShutdownNotice();
        abortController.signal.removeEventListener('abort', onInternalAbort);
        resolveExit({ code, signal, ...(processError ? { error: processError } : {}) });
      });
    });
    closed = true;
    if (pending.trim() || decoder.end().trim())
      throw new Error('Mount helper ended with an incomplete protocol line.');
    await queue;
    if (protocolFailure) throw protocolFailure;
    if (exitResult.error) throw exitResult.error;
    if (options.signal?.aborted) return;
    if (exitResult.code !== 0)
      throw new Error(
        `Mount helper exited (${exitResult.signal ?? exitResult.code ?? 'unknown'}).`,
      );
  } finally {
    closed = true;
    clearShutdownNotice();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    options.signal?.removeEventListener('abort', requestStop);
    abortController.abort(new Error('Mount bridge closed.'));
    try {
      await bridge.close();
    } finally {
      await mountPointCleanup?.();
    }
  }
}

async function prepareMountPoint(mountPoint: string) {
  const path = resolve(mountPoint);
  let created = false;
  try {
    const current = await lstat(path);
    if (current.isSymbolicLink() || !current.isDirectory())
      throw new Error('Mountpoint must be a real directory, not a symlink.');
    if ((await readdir(path)).length > 0) throw new Error('Mountpoint must be empty.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path, { mode: 0o700 });
    created = true;
  }
  const owned = created ? await lstat(path) : undefined;
  if (owned && (!owned.isDirectory() || owned.isSymbolicLink()))
    throw new Error('The created mountpoint was replaced.');
  return {
    path,
    async cleanup() {
      if (!owned) return;
      try {
        const current = await lstat(path);
        if (
          current.isSymbolicLink() ||
          !current.isDirectory() ||
          current.dev !== owned.dev ||
          current.ino !== owned.ino ||
          (await readdir(path)).length !== 0
        )
          return;
        await rmdir(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath, rename, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { withSqliteFileLock } from './config.js';
import type { AgentDriveClient, PutStreamOptions, Version } from './client.js';

export const MOUNT_WRITE_MAX_BYTES = 1024 * 1024;
export const MOUNT_READ_MAX_BYTES = 1024 * 1024;
export const MOUNT_FILE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export type MountWritebackRpcRequest =
  | {
      id: string;
      op: 'openWrite';
      path: string;
      baseVersionId: string | null;
      size?: number;
      truncateOnOpen?: boolean;
    }
  | { id: string; op: 'write'; handleId: string; offset: number; data: string }
  | { id: string; op: 'truncate'; handleId: string; size: number }
  | { id: string; op: 'readStaged'; handleId: string; offset: number; size: number }
  | { id: string; op: 'flush' | 'release'; handleId: string };

export type MountNamespaceMutationRequest =
  | { id: string; op: 'mkdir' | 'rmdir'; path: string }
  | { id: string; op: 'unlink'; path: string; ifVersionId: string }
  | {
      id: string;
      op: 'rename';
      path: string;
      destinationPath: string;
      ifSourceVersionId: string;
      ifDestinationVersionId: string | null;
      operationId: string;
    };

export type MountWritebackOptions = {
  client: AgentDriveClient;
  driveId: string;
  /** Private local root; the scope directory and files are created mode 0700/0600. */
  journalRoot: string;
};

export type WritebackVersion = Pick<Version, 'id' | 'path'>;

export type MountWritebackOpenedFile = {
  handleId: string;
  recoveryPath: string;
  size: number;
};

export type MountWritebackRead = { data: Uint8Array; eof: boolean };

export type MountWritebackRecovery = {
  path: string;
  state: 'committed' | 'conflict' | 'pending' | 'busy';
  recoveryPath: string;
  versionId?: string;
  currentVersionId?: string;
  errorCode?: string;
};

export type MountWritebackStagedEntry = {
  path: string;
  size: number;
  handleId?: string;
  recoveryPath: string;
  state: JournalState;
  versionId?: string;
};

export class MountWritebackError extends Error {
  readonly code: string;
  readonly recoveryPath?: string;
  readonly path?: string;
  readonly currentVersionId?: string;

  constructor(
    code: string,
    message: string,
    details: { path?: string; recoveryPath?: string; currentVersionId?: string } = {},
  ) {
    super(message);
    this.name = 'MountWritebackError';
    this.code = code;
    if (details.path !== undefined) this.path = details.path;
    if (details.recoveryPath !== undefined) this.recoveryPath = details.recoveryPath;
    if (details.currentVersionId !== undefined) this.currentVersionId = details.currentVersionId;
  }
}

export class MountWritebackConflictError extends MountWritebackError {
  constructor(path: string, recoveryPath: string, currentVersionId?: string) {
    super('ESTALE', `The remote file changed. Local edits are preserved at ${recoveryPath}.`, {
      path,
      recoveryPath,
      ...(currentVersionId ? { currentVersionId } : {}),
    });
    this.name = 'MountWritebackConflictError';
  }
}

export type MountWriteback = {
  readonly scopeId: string;
  readonly scopePath: string;
  openWrite(
    path: string,
    baseVersionId: string | null,
    sizeHint?: number,
    truncateOnOpen?: boolean,
    allowTrashedCreate?: boolean,
  ): Promise<MountWritebackOpenedFile>;
  write(handleId: string, offset: number, data: Uint8Array): Promise<{ bytesWritten: number }>;
  truncate(handleId: string, size: number): Promise<{ size: number }>;
  readStaged(handleId: string, offset: number, size: number): Promise<MountWritebackRead>;
  flush(handleId: string): Promise<WritebackVersion>;
  release(handleId: string): Promise<{ recoveryPath?: string }>;
  listStaged(prefix?: string): Promise<MountWritebackStagedEntry[]>;
  recover(): Promise<MountWritebackRecovery[]>;
  close(): Promise<void>;
};

type JournalState = 'hydrating' | 'clean' | 'dirty' | 'uploading' | 'uploaded' | 'conflict';
type PendingMutation =
  | { kind: 'write'; offset: number; data: string }
  | { kind: 'truncate'; size: number };

type JournalRecord = {
  format: 1;
  scopeId: string;
  id: string;
  path: string;
  baseVersionId: string | null;
  allowTrashedCreate?: boolean;
  tags?: string[];
  description?: string | null;
  state: JournalState;
  size: number;
  generation: number;
  committedGeneration: number;
  versionId?: string;
  intentId?: string;
  pendingMutation?: PendingMutation;
  conflictVersionId?: string;
  errorCode?: string;
};

type LockOwnership = {
  key: string;
  releaseWork: () => void;
  done: Promise<void>;
  released: boolean;
};
type ActiveSession = {
  record: JournalRecord;
  journalPath: string;
  dataPath: string;
  data: Awaited<ReturnType<typeof open>>;
  lock: LockOwnership;
  queue: Promise<void>;
  closed: boolean;
};

const JOURNAL_MAX_BYTES = 2 * 1024 * 1024;
const activePathLocks = new Set<string>();

function recordPath(scopePath: string, id: string) {
  return join(scopePath, `${id}.json`);
}

function stagePath(scopePath: string, id: string) {
  return join(scopePath, `${id}.data`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiErrorDetails(error: unknown) {
  if (!isRecord(error)) return {};
  return {
    code: typeof error.code === 'string' ? error.code : undefined,
    status: typeof error.status === 'number' ? error.status : undefined,
    state: typeof error.state === 'string' ? error.state : undefined,
    currentVersionId:
      typeof error.currentVersionId === 'string' ? error.currentVersionId : undefined,
  };
}

function checkRemotePath(path: string): void {
  if (
    !isAbsolute(path) ||
    path.length > 1024 ||
    path === '/' ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new MountWritebackError('EINVAL', 'The remote path is not canonical.');
  }
}

function parentRemotePath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator <= 0 ? '/' : path.slice(0, separator);
}

function checkSize(value: number, label: string, max = MOUNT_FILE_MAX_BYTES): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new MountWritebackError('EINVAL', `${label} is outside the supported range.`);
  }
}

function errno(error: unknown): string {
  if (error instanceof MountWritebackError) return error.code;
  if (isRecord(error) && typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)) {
    return error.code;
  }
  return 'EIO';
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const info = await lstat(absolute);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  ) {
    throw new MountWritebackError(
      'EACCES',
      'The writeback directory must be owner-only and must not be a symlink.',
    );
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function persistRecord(scopePath: string, record: JournalRecord): Promise<void> {
  const target = recordPath(scopePath, record.id);
  const temporary = join(scopePath, `${record.id}.${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
    await chmod(target, 0o600);
    await syncDirectory(scopePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    throw new MountWritebackError('EIO', 'The writeback journal file is invalid.');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new MountWritebackError(
      'EACCES',
      'The writeback journal is not owned by the current user.',
    );
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const infoAfterOpen = await file.stat();
    if (
      !infoAfterOpen.isFile() ||
      infoAfterOpen.dev !== info.dev ||
      infoAfterOpen.ino !== info.ino
    ) {
      throw new MountWritebackError('EIO', 'The writeback journal file changed while opening.');
    }
    await file.chmod(0o600);
    return await file.readFile();
  } finally {
    await file.close();
  }
}

function parseJournal(raw: Buffer, expectedScopeId: string, expectedId?: string): JournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new MountWritebackError('EIO', 'The writeback journal contains invalid data.');
  }
  if (!isRecord(value)) throw new MountWritebackError('EIO', 'The writeback journal is invalid.');
  const allowedFields = new Set([
    'format',
    'scopeId',
    'id',
    'path',
    'baseVersionId',
    'allowTrashedCreate',
    'tags',
    'description',
    'state',
    'size',
    'generation',
    'committedGeneration',
    'versionId',
    'intentId',
    'pendingMutation',
    'conflictVersionId',
    'errorCode',
  ]);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    throw new MountWritebackError('EIO', 'The writeback journal contains an unsupported field.');
  }
  const record = value as unknown as JournalRecord;
  if (
    record.format !== 1 ||
    record.scopeId !== expectedScopeId ||
    typeof record.id !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(record.id) ||
    (expectedId !== undefined && record.id !== expectedId) ||
    typeof record.path !== 'string' ||
    (typeof record.baseVersionId !== 'string' && record.baseVersionId !== null) ||
    !['hydrating', 'clean', 'dirty', 'uploading', 'uploaded', 'conflict'].includes(record.state) ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    record.size > MOUNT_FILE_MAX_BYTES ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 0 ||
    !Number.isSafeInteger(record.committedGeneration) ||
    record.committedGeneration < -1
  ) {
    throw new MountWritebackError('EIO', 'The writeback journal is invalid.');
  }
  checkRemotePath(record.path);
  if (
    record.tags !== undefined &&
    (!Array.isArray(record.tags) ||
      record.tags.length > 32 ||
      record.tags.some((tag) => typeof tag !== 'string'))
  ) {
    throw new MountWritebackError('EIO', 'The writeback journal tags are invalid.');
  }
  if (
    record.allowTrashedCreate !== undefined &&
    (typeof record.allowTrashedCreate !== 'boolean' || record.baseVersionId !== null)
  ) {
    throw new MountWritebackError('EIO', 'The writeback journal recreate option is invalid.');
  }
  if (
    record.description !== undefined &&
    record.description !== null &&
    typeof record.description !== 'string'
  ) {
    throw new MountWritebackError('EIO', 'The writeback journal description is invalid.');
  }
  if (
    record.intentId !== undefined &&
    (typeof record.intentId !== 'string' || record.intentId.length > 128)
  ) {
    throw new MountWritebackError('EIO', 'The writeback journal intent is invalid.');
  }
  if ((record.state === 'uploading' || record.state === 'uploaded') && !record.intentId) {
    throw new MountWritebackError('EIO', 'The writeback journal intent is missing.');
  }
  if (record.pendingMutation !== undefined) {
    const pending = record.pendingMutation;
    if (!isRecord(pending))
      throw new MountWritebackError('EIO', 'The writeback journal mutation is invalid.');
    if (pending.kind === 'write') {
      if (
        !Number.isSafeInteger(pending.offset) ||
        pending.offset < 0 ||
        typeof pending.data !== 'string'
      ) {
        throw new MountWritebackError('EIO', 'The writeback journal mutation is invalid.');
      }
      const bytes = Buffer.from(pending.data, 'base64');
      if (
        bytes.byteLength > MOUNT_WRITE_MAX_BYTES ||
        (pending.offset as number) + bytes.byteLength > MOUNT_FILE_MAX_BYTES ||
        bytes.toString('base64') !== pending.data
      ) {
        throw new MountWritebackError('EIO', 'The writeback journal mutation is invalid.');
      }
    } else if (pending.kind === 'truncate') {
      checkSize(pending.size, 'Journal truncate size');
    } else {
      throw new MountWritebackError('EIO', 'The writeback journal mutation is invalid.');
    }
  }
  return record;
}

async function acquirePathLock(lockDirectory: string, pathHash: string): Promise<LockOwnership> {
  const databasePath = resolve(join(lockDirectory, `${pathHash}.sqlite`));
  if (activePathLocks.has(databasePath)) {
    throw new MountWritebackError('EBUSY', 'Another local mount has this file open.');
  }
  try {
    const info = await lstat(databasePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (info.mode & 0o200) === 0) ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    ) {
      throw new MountWritebackError('EACCES', 'The writeback lock database is unsafe.');
    }
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }
  if (activePathLocks.has(databasePath)) {
    throw new MountWritebackError('EBUSY', 'Another local mount has this file open.');
  }
  activePathLocks.add(databasePath);
  let releaseWork!: () => void;
  let resolveAcquired!: () => void;
  let rejectAcquired!: (error: unknown) => void;
  let enteredWork = false;
  const released = new Promise<void>((resolveRelease) => {
    releaseWork = resolveRelease;
  });
  const acquired = new Promise<void>((resolveAcquire, rejectAcquire) => {
    resolveAcquired = resolveAcquire;
    rejectAcquired = rejectAcquire;
  });
  const done = withSqliteFileLock(
    databasePath,
    async () => {
      enteredWork = true;
      resolveAcquired();
      await released;
    },
    { owner: 'mount-writeback', timeoutMs: 0 },
  ).catch((error: unknown) => {
    if (!enteredWork) rejectAcquired(error);
    throw error;
  });
  done.catch(() => undefined);
  try {
    await acquired;
    return {
      key: databasePath,
      releaseWork,
      done,
      released: false,
    };
  } catch (error) {
    activePathLocks.delete(databasePath);
    if (error instanceof MountWritebackError) throw error;
    if (error instanceof Error && /timed out waiting for .* lock database/iu.test(error.message)) {
      throw new MountWritebackError('EBUSY', 'Another local mount has this file open.');
    }
    if (
      error instanceof Error &&
      /unsafe permissions|must be a regular file/iu.test(error.message)
    ) {
      throw new MountWritebackError('EACCES', 'The writeback lock database is unsafe.');
    }
    throw new MountWritebackError('EIO', 'The writeback lock could not be acquired.');
  }
}

async function releasePathLock(lock: LockOwnership): Promise<void> {
  if (lock.released) return;
  lock.released = true;
  lock.releaseWork();
  try {
    await lock.done;
  } finally {
    activePathLocks.delete(lock.key);
  }
}

async function unlinkOwnedRegular(
  path: string,
  expected?: { dev: number; ino: number },
): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return false;
    if (expected && (info.dev !== expected.dev || info.ino !== expected.ino)) return false;
    const confirmed = await lstat(path);
    if (
      !confirmed.isFile() ||
      confirmed.isSymbolicLink() ||
      confirmed.dev !== info.dev ||
      confirmed.ino !== info.ino
    )
      return false;
    await unlink(path);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return true;
    throw error;
  }
}

async function unlinkJournalRecord(
  scopePath: string,
  scopeId: string,
  id: string,
): Promise<boolean> {
  const path = recordPath(scopePath, id);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const record = parseJournal(await readRegularFile(path, JOURNAL_MAX_BYTES), scopeId, id);
    const confirmed = await lstat(path);
    if (
      !confirmed.isFile() ||
      confirmed.isSymbolicLink() ||
      confirmed.dev !== info.dev ||
      confirmed.ino !== info.ino
    )
      return false;
    if (record.id !== id) return false;
    await unlink(path);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return true;
    throw error;
  }
}

async function writeAll(
  file: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let written = 0;
  while (written < buffer.byteLength) {
    const result = await file.write(
      buffer,
      written,
      buffer.byteLength - written,
      position + written,
    );
    if (result.bytesWritten === 0)
      throw new MountWritebackError('EIO', 'A local write made no progress.');
    written += result.bytesWritten;
  }
}

async function applyPendingMutation(session: ActiveSession): Promise<void> {
  const mutation = session.record.pendingMutation;
  if (!mutation) return;
  if (mutation.kind === 'write') {
    const bytes = Buffer.from(mutation.data, 'base64');
    await writeAll(session.data, bytes, mutation.offset);
    session.record.size = Math.max(session.record.size, mutation.offset + bytes.byteLength);
  } else {
    await session.data.truncate(mutation.size);
    session.record.size = mutation.size;
  }
  await session.data.sync();
  session.record.generation += 1;
  session.record.state = 'dirty';
  delete session.record.pendingMutation;
  delete session.record.errorCode;
  await persistRecord(dirname(session.journalPath), session.record);
}

async function mutate(session: ActiveSession, mutation: PendingMutation): Promise<void> {
  session.record.pendingMutation = mutation;
  await persistRecord(dirname(session.journalPath), session.record);
  await applyPendingMutation(session);
}

function serialized<T>(session: ActiveSession, operation: () => Promise<T>): Promise<T> {
  const previous = session.queue;
  let release!: () => void;
  session.queue = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  return previous.then(operation).finally(release);
}

function attachRecovery(error: unknown, record: JournalRecord, dataPath: string): Error {
  const details = apiErrorDetails(error);
  if (details.status === 409 && details.code === 'conflict') {
    record.state = 'conflict';
    if (details.currentVersionId) record.conflictVersionId = details.currentVersionId;
    else delete record.conflictVersionId;
    if (details.state !== undefined) {
      record.errorCode = 'ESTALE';
      return new MountWritebackConflictError(record.path, dataPath, details.currentVersionId);
    }
    record.errorCode = 'EIO';
    return new MountWritebackError(
      'EIO',
      `The upload intent expired. Local edits are preserved at ${dataPath}.`,
      {
        path: record.path,
        recoveryPath: dataPath,
      },
    );
  }
  if (error instanceof Error) {
    Object.assign(error as Error & { recoveryPath?: string; path?: string }, {
      recoveryPath: dataPath,
      path: record.path,
    });
    return error;
  }
  return new MountWritebackError(
    'EIO',
    'The write could not be committed; local edits are preserved.',
    {
      path: record.path,
      recoveryPath: dataPath,
    },
  );
}

function toVersion(record: JournalRecord): WritebackVersion {
  if (!record.versionId)
    throw new MountWritebackError('EIO', 'The staged file has no committed version.');
  return { id: record.versionId, path: record.path };
}

async function removeJournalFiles(session: ActiveSession): Promise<void> {
  const dir = dirname(session.journalPath);
  const dataInfo = await session.data.stat().catch(() => undefined);
  await session.data.close().catch(() => undefined);
  session.closed = true;
  await unlinkOwnedRegular(session.dataPath, dataInfo);
  await unlinkJournalRecord(dir, session.record.scopeId, session.record.id);
  await syncDirectory(dir);
}

export async function createMountWriteback(
  options: MountWritebackOptions,
): Promise<MountWriteback> {
  if (!options.driveId || options.driveId.length > 256)
    throw new MountWritebackError('EINVAL', 'A drive id is required.');
  if (!options.journalRoot.trim())
    throw new MountWritebackError('EINVAL', 'A private journal root is required.');
  if (!options.client || typeof options.client.writebackScopeId !== 'function') {
    throw new MountWritebackError(
      'EINVAL',
      'The client does not support scoped writeback journals.',
    );
  }
  const scopeId = options.client.writebackScopeId(options.driveId);
  if (!/^[a-f0-9]{64}$/.test(scopeId))
    throw new MountWritebackError('EINVAL', 'The writeback scope identity is invalid.');
  const requestedRoot = resolve(options.journalRoot);
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(requestedRoot);
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (typeof process.getuid === 'function' && rootInfo.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (rootInfo.mode & 0o077) !== 0)
  ) {
    throw new MountWritebackError('EACCES', 'The writeback root must be an owner-only directory.');
  }
  const root = await realpath(requestedRoot);
  if (root === '/' || dirname(root) === '/' || root === resolve(homedir())) {
    throw new MountWritebackError(
      'EINVAL',
      'The writeback root must be a dedicated private directory.',
    );
  }
  await ensurePrivateDirectory(root);
  const scopePath = join(root, scopeId);
  await ensurePrivateDirectory(scopePath);
  const lockDirectory = join(scopePath, '.locks');
  await ensurePrivateDirectory(lockDirectory);
  const sessions = new Map<string, ActiveSession>();

  const requireSession = (handleId: string): ActiveSession => {
    const session = sessions.get(handleId);
    if (!session || session.closed)
      throw new MountWritebackError('EBADF', 'The write handle is closed.');
    return session;
  };

  const hydrate = async (
    session: ActiveSession,
    sizeHint?: number,
    truncateOnOpen = false,
  ): Promise<void> => {
    const record = session.record;
    if (record.baseVersionId === null) {
      if (sizeHint !== undefined && sizeHint !== 0)
        throw new MountWritebackError('EINVAL', 'A new file must start empty.');
      record.state = 'dirty';
      record.committedGeneration = -1;
      record.size = 0;
      await session.data.sync();
      await persistRecord(scopePath, record);
      return;
    }
    if (truncateOnOpen) {
      const metadata = await options.client.getVersionMetadata(options.driveId, record.path, {
        versionId: record.baseVersionId,
      });
      if (metadata.id !== record.baseVersionId || (sizeHint !== undefined && sizeHint !== 0)) {
        throw new MountWritebackError('ESTALE', 'The opened remote version changed.');
      }
      record.tags = [...metadata.tags];
      record.description = metadata.description;
      record.size = 0;
      record.state = 'dirty';
      record.generation = 0;
      record.committedGeneration = -1;
      await session.data.truncate(0);
      await session.data.sync();
      await persistRecord(scopePath, record);
      return;
    }
    const stream = await options.client.getStream(options.driveId, record.path, {
      versionId: record.baseVersionId,
    });
    if (stream.version.id !== record.baseVersionId)
      throw new MountWritebackError('ESTALE', 'The opened remote version changed.');
    if (
      stream.plaintextBytes > MOUNT_FILE_MAX_BYTES ||
      (sizeHint !== undefined && sizeHint !== stream.plaintextBytes)
    ) {
      throw new MountWritebackError('ESTALE', 'The opened remote size changed.');
    }
    let offset = 0;
    for await (const chunk of stream.plaintext) {
      offset += chunk.byteLength;
      if (offset > stream.plaintextBytes || offset > MOUNT_FILE_MAX_BYTES) {
        throw new MountWritebackError(
          'EIO',
          'The opened remote stream exceeded its declared size.',
        );
      }
      await writeAll(session.data, chunk, offset - chunk.byteLength);
    }
    if (offset !== stream.plaintextBytes)
      throw new MountWritebackError('EIO', 'The opened remote stream was incomplete.');
    await session.data.truncate(offset);
    await session.data.sync();
    record.size = offset;
    record.state = 'clean';
    record.generation = 0;
    record.committedGeneration = 0;
    record.versionId = stream.version.id;
    record.tags = [...stream.version.tags];
    record.description = stream.version.description;
    await persistRecord(scopePath, record);
  };

  const commitSession = async (session: ActiveSession): Promise<WritebackVersion> => {
    const record = session.record;
    if (record.pendingMutation) await applyPendingMutation(session);
    if (record.state === 'conflict') {
      throw new MountWritebackConflictError(
        record.path,
        session.dataPath,
        record.conflictVersionId,
      );
    }
    if (record.generation === record.committedGeneration) return toVersion(record);
    await session.data.sync();
    if (record.state === 'uploaded' && record.intentId) {
      try {
        const version = await options.client.replayCommit(options.driveId, record.intentId);
        record.state = 'clean';
        record.baseVersionId = version.id;
        record.versionId = version.id;
        record.committedGeneration = record.generation;
        delete record.intentId;
        delete record.errorCode;
        delete record.allowTrashedCreate;
        await persistRecord(scopePath, record);
        return { id: version.id, path: version.path };
      } catch (error) {
        const failure = attachRecovery(error, record, session.dataPath);
        if (apiErrorDetails(error).status === 409 && apiErrorDetails(error).code === 'conflict') {
          await persistRecord(scopePath, record);
        }
        throw failure;
      }
    }
    if (record.state === 'uploading') {
      record.state = 'dirty';
      delete record.intentId;
      await persistRecord(scopePath, record);
    }
    const plaintext = (async function* () {
      const buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < record.size) {
        const length = Math.min(buffer.byteLength, record.size - offset);
        const result = await session.data.read(buffer, 0, length, offset);
        if (result.bytesRead === 0)
          throw new MountWritebackError('EIO', 'The local staging file was truncated.');
        offset += result.bytesRead;
        yield buffer.slice(0, result.bytesRead);
      }
    })();
    const putOptions: PutStreamOptions = {
      ...(record.baseVersionId === null
        ? { mode: 'create' as const }
        : { ifVersionId: record.baseVersionId }),
      ...(record.baseVersionId === null && record.allowTrashedCreate
        ? { allowTrashedCreate: true }
        : {}),
      ...(record.tags !== undefined ? { tags: [...record.tags] } : {}),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      onIntent: async (intentId) => {
        record.state = 'uploading';
        record.intentId = intentId;
        await persistRecord(scopePath, record);
      },
      onUploadComplete: async (intentId) => {
        if (record.intentId !== intentId)
          throw new MountWritebackError('EIO', 'The upload intent changed.');
        record.state = 'uploaded';
        await persistRecord(scopePath, record);
      },
    };
    try {
      const version = await options.client.putStream(
        options.driveId,
        record.path,
        plaintext,
        record.size,
        putOptions,
      );
      record.state = 'clean';
      record.baseVersionId = version.id;
      record.versionId = version.id;
      record.committedGeneration = record.generation;
      delete record.intentId;
      delete record.errorCode;
      delete record.allowTrashedCreate;
      await persistRecord(scopePath, record);
      return { id: version.id, path: version.path };
    } catch (error) {
      const failure = attachRecovery(error, record, session.dataPath);
      if (apiErrorDetails(error).status === 409 && apiErrorDetails(error).code === 'conflict') {
        await persistRecord(scopePath, record);
      }
      throw failure;
    }
  };

  const releaseSession = async (
    session: ActiveSession,
    flush: boolean,
  ): Promise<{ recoveryPath?: string }> => {
    let recoveryPath: string | undefined;
    try {
      if (flush) await commitSession(session);
    } catch {
      recoveryPath = session.dataPath;
    }
    sessions.delete(session.record.id);
    const pending =
      session.record.pendingMutation !== undefined ||
      session.record.state === 'conflict' ||
      session.record.state === 'uploading' ||
      session.record.state === 'uploaded' ||
      session.record.generation !== session.record.committedGeneration;
    if (!recoveryPath && !pending) await removeJournalFiles(session);
    else {
      await session.data.close().catch(() => undefined);
      session.closed = true;
    }
    await releasePathLock(session.lock);
    return recoveryPath || pending ? { recoveryPath: session.dataPath } : {};
  };

  const guardExistingJournal = async (path: string): Promise<void> => {
    const entries = await readdir(scopePath, { withFileTypes: true });
    for (const entry of entries) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name);
      if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
      const id = match[1]!;
      let record: JournalRecord;
      try {
        record = parseJournal(
          await readRegularFile(recordPath(scopePath, id), JOURNAL_MAX_BYTES),
          scopeId,
          id,
        );
      } catch {
        throw new MountWritebackError(
          'EIO',
          'An unreadable writeback journal must be recovered before opening files.',
          {
            recoveryPath: recordPath(scopePath, id),
          },
        );
      }
      if (record.path !== path) continue;
      const hasPendingData =
        record.pendingMutation !== undefined ||
        record.state === 'dirty' ||
        record.state === 'uploading' ||
        record.state === 'uploaded' ||
        record.state === 'conflict' ||
        record.generation !== record.committedGeneration;
      if (hasPendingData) {
        throw new MountWritebackError('EBUSY', `Recover local edits before opening this path.`, {
          path,
          recoveryPath: stagePath(scopePath, id),
          ...(record.conflictVersionId ? { currentVersionId: record.conflictVersionId } : {}),
        });
      }
      if (record.state === 'hydrating' || record.state === 'clean') {
        await unlinkOwnedRegular(stagePath(scopePath, id));
        await unlinkJournalRecord(scopePath, scopeId, id);
      }
    }
  };

  const writeback: MountWriteback = {
    scopeId,
    scopePath,
    async openWrite(
      path,
      baseVersionId,
      sizeHint,
      truncateOnOpen = false,
      allowTrashedCreate = false,
    ) {
      checkRemotePath(path);
      if (baseVersionId !== null && (!baseVersionId || baseVersionId.length > 128)) {
        throw new MountWritebackError('EINVAL', 'The opened base version is invalid.');
      }
      if (sizeHint !== undefined) checkSize(sizeHint, 'Open size');
      if (allowTrashedCreate && baseVersionId !== null) {
        throw new MountWritebackError('EINVAL', 'Trashed recreation requires a create-only open.');
      }
      const pathHash = createHash('sha256').update(path).digest('hex');
      const lock = await acquirePathLock(lockDirectory, pathHash);
      try {
        await guardExistingJournal(path);
      } catch (error) {
        await releasePathLock(lock);
        throw error;
      }
      const id = randomUUID();
      const dataPath = stagePath(scopePath, id);
      const journalPath = recordPath(scopePath, id);
      let data: ActiveSession['data'] | undefined;
      try {
        data = await open(
          dataPath,
          constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await data.chmod(0o600);
        const record: JournalRecord = {
          format: 1,
          scopeId,
          id,
          path,
          baseVersionId,
          ...(allowTrashedCreate ? { allowTrashedCreate: true } : {}),
          state: 'hydrating',
          size: 0,
          generation: 0,
          committedGeneration: -1,
        };
        await persistRecord(scopePath, record);
        const session: ActiveSession = {
          record,
          journalPath,
          dataPath,
          data,
          lock,
          queue: Promise.resolve(),
          closed: false,
        };
        await hydrate(session, sizeHint, truncateOnOpen);
        sessions.set(id, session);
        return { handleId: id, recoveryPath: dataPath, size: record.size };
      } catch (error) {
        const dataInfo = await data?.stat().catch(() => undefined);
        await data?.close().catch(() => undefined);
        await unlinkOwnedRegular(dataPath, dataInfo).catch(() => undefined);
        await unlinkJournalRecord(scopePath, scopeId, id).catch(() => undefined);
        await releasePathLock(lock);
        throw error;
      }
    },
    async write(handleId, offset, data) {
      const session = requireSession(handleId);
      checkSize(offset, 'Write offset');
      if (!(data instanceof Uint8Array) || data.byteLength > MOUNT_WRITE_MAX_BYTES) {
        throw new MountWritebackError('EINVAL', 'A write must contain at most 1 MiB.');
      }
      if (offset + data.byteLength > MOUNT_FILE_MAX_BYTES)
        throw new MountWritebackError('EFBIG', 'The local file is too large.');
      const copy = Buffer.from(data).toString('base64');
      await serialized(
        session,
        async () => await mutate(session, { kind: 'write', offset, data: copy }),
      );
      return { bytesWritten: data.byteLength };
    },
    async truncate(handleId, size) {
      const session = requireSession(handleId);
      checkSize(size, 'Truncate size');
      await serialized(session, async () => await mutate(session, { kind: 'truncate', size }));
      return { size };
    },
    async readStaged(handleId, offset, size) {
      const session = requireSession(handleId);
      checkSize(offset, 'Read offset');
      checkSize(size, 'Read size', MOUNT_READ_MAX_BYTES);
      return await serialized(session, async () => {
        const length = Math.min(size, Math.max(0, session.record.size - offset));
        const data = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const result = await session.data.read(data, read, length - read, offset + read);
          if (result.bytesRead === 0) break;
          read += result.bytesRead;
        }
        return { data: data.subarray(0, read), eof: offset + read >= session.record.size };
      });
    },
    async flush(handleId) {
      const session = requireSession(handleId);
      try {
        return await serialized(session, async () => await commitSession(session));
      } catch (error) {
        if (error instanceof MountWritebackError && !error.recoveryPath) {
          throw new MountWritebackError(error.code, error.message, {
            path: session.record.path,
            recoveryPath: session.dataPath,
            ...(error.currentVersionId ? { currentVersionId: error.currentVersionId } : {}),
          });
        }
        throw error;
      }
    },
    async release(handleId) {
      const session = requireSession(handleId);
      return await serialized(session, async () => await releaseSession(session, true));
    },
    async listStaged(folderPath) {
      const folder = folderPath ?? '/';
      if (folder !== '/') checkRemotePath(folder);
      const entries = await readdir(scopePath, { withFileTypes: true });
      const staged: MountWritebackStagedEntry[] = [];
      for (const entry of entries) {
        const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name);
        if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
        const id = match[1]!;
        const record = parseJournal(
          await readRegularFile(recordPath(scopePath, id), JOURNAL_MAX_BYTES),
          scopeId,
          id,
        );
        if (
          record.state === 'clean' ||
          record.state === 'hydrating' ||
          parentRemotePath(record.path) !== folder
        )
          continue;
        const active = sessions.get(id);
        staged.push({
          path: record.path,
          size: record.size,
          ...(active ? { handleId: id } : {}),
          recoveryPath: stagePath(scopePath, id),
          state: record.state,
          ...(record.versionId ? { versionId: record.versionId } : {}),
        });
        if (staged.length > 1000)
          throw new MountWritebackError('E2BIG', 'Too many staged files to list at once.');
      }
      return staged.sort((left, right) => left.path.localeCompare(right.path));
    },
    async recover() {
      const results: MountWritebackRecovery[] = [];
      const entries = await readdir(scopePath, { withFileTypes: true });
      for (const entry of entries) {
        const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name);
        if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
        const id = match[1]!;
        const path = recordPath(scopePath, id);
        let record: JournalRecord;
        try {
          record = parseJournal(await readRegularFile(path, JOURNAL_MAX_BYTES), scopeId, id);
        } catch {
          results.push({ path: '', state: 'pending', recoveryPath: path, errorCode: 'EIO' });
          continue;
        }
        const active = sessions.get(id);
        let session = active;
        if (!session) {
          const pathHash = createHash('sha256').update(record.path).digest('hex');
          let lock: LockOwnership;
          try {
            lock = await acquirePathLock(lockDirectory, pathHash);
          } catch (error) {
            if (error instanceof MountWritebackError && error.code === 'EBUSY') {
              results.push({
                path: record.path,
                state: 'busy',
                recoveryPath: stagePath(scopePath, id),
                errorCode: 'EBUSY',
              });
              continue;
            }
            throw error;
          }
          if (record.state === 'hydrating') {
            await unlinkOwnedRegular(stagePath(scopePath, id)).catch(() => undefined);
            await unlinkJournalRecord(scopePath, scopeId, id).catch(() => undefined);
            await releasePathLock(lock);
            continue;
          }
          const dataPath = stagePath(scopePath, id);
          let data: ActiveSession['data'];
          try {
            const info = await lstat(dataPath);
            if (!info.isFile() || info.isSymbolicLink())
              throw new MountWritebackError('EIO', 'The staging file is unsafe.');
            data = await open(dataPath, constants.O_RDWR | constants.O_NOFOLLOW);
            await data.chmod(0o600);
            if (record.pendingMutation) {
              session = {
                record,
                journalPath: path,
                dataPath,
                data,
                lock,
                queue: Promise.resolve(),
                closed: false,
              };
              await applyPendingMutation(session);
            }
            session ??= {
              record,
              journalPath: path,
              dataPath,
              data,
              lock,
              queue: Promise.resolve(),
              closed: false,
            };
          } catch (error) {
            await releasePathLock(lock);
            results.push({
              path: record.path,
              state: 'pending',
              recoveryPath: dataPath,
              errorCode: errno(error),
            });
            continue;
          }
        }
        try {
          const version = await serialized(session, async () => await commitSession(session!));
          results.push({
            path: record.path,
            state: 'committed',
            recoveryPath: session.dataPath,
            versionId: version.id,
          });
          if (!active) await releaseSession(session, false);
        } catch (error) {
          const details = apiErrorDetails(error);
          const failure = attachRecovery(error, session.record, session.dataPath);
          if (session.record.state === 'conflict')
            await persistRecord(scopePath, session.record).catch(() => undefined);
          results.push({
            path: session.record.path,
            state: session.record.state === 'conflict' ? 'conflict' : 'pending',
            recoveryPath: session.dataPath,
            ...(details.currentVersionId ? { currentVersionId: details.currentVersionId } : {}),
            errorCode: errno(failure),
          });
          if (!active) {
            sessions.set(session.record.id, session);
            await releaseSession(session, false);
          }
        }
      }
      return results;
    },
    async close() {
      const failures: string[] = [];
      for (const session of [...sessions.values()]) {
        const result = await writeback.release(session.record.id);
        if (result.recoveryPath) failures.push(result.recoveryPath);
      }
      if (failures.length) {
        throw new MountWritebackError(
          'EIO',
          `Uncommitted local edits remain at: ${failures.join(', ')}`,
        );
      }
    },
  };
  return writeback;
}

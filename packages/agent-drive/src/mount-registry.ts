import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import {
  configPath,
  DEFAULT_API_URL,
  isValidDriveKey,
  originOf,
  readConfig,
  withSqliteFileLock,
} from './config.js';

// Persistent, per-user, non-secret registry of named drive and live-workspace
// mounts. Definitions never start a mount, service, Finder helper, or sandbox.

export const MOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const SANDBOX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const LIVE_SANDBOX_ID_PATTERN = /^m_[A-Za-z0-9_-]{1,126}$/u;
const REGISTRY_VERSION = 1;
const MALFORMED = 'Agent Drive mount registry is malformed; refusing to overwrite it.';

export type MountpointState = 'free' | 'symlink' | 'directory' | 'other';

export type DriveMountRegistryEntry = {
  kind: 'drive';
  name: string;
  mountpoint: string;
  driveId: string;
  /** Account API context recorded verbatim; authorization is compared by origin. */
  apiUrl: string;
  readOnly: boolean;
  /** Exact Instabox sandbox ID supplied at registration; metadata only, never resolved. */
  sandboxId?: string;
  registeredAt?: string;
};

export type LiveWorkspaceRegistryEntry = {
  kind: 'live-workspace';
  name: string;
  mountpoint: string;
  /** Exact Instabox sandbox ID, used as the only live workspace selector. */
  sandboxId: string;
  /** Absolute path inside the selected sandbox. */
  root: string;
  readOnly: boolean;
  /** Start/resume this explicit sandbox on its first file operation. New entries default on. */
  wakeOnAccess: boolean;
  registeredAt?: string;
};

export type MountRegistryEntry = DriveMountRegistryEntry | LiveWorkspaceRegistryEntry;

export type RegisterMountInput = {
  name: string;
  mountpoint: string;
  driveId: string;
  apiUrl: string;
  readOnly?: boolean;
  sandboxId?: string;
};

export type RegisterLiveWorkspaceInput = {
  name: string;
  mountpoint: string;
  sandboxId: string;
  root: string;
  readOnly?: boolean;
  wakeOnAccess?: boolean;
};

export type MountStatus = MountRegistryEntry & {
  filesystem: { state: MountpointState; target?: string };
};

export function mountRegistryPath() {
  return join(dirname(configPath()), 'mounts.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function assertRegistryPathSafe(path: string) {
  if (resolve(path) === resolve(configPath()))
    throw new Error(
      'Mount registry path collides with the Agent Drive config; refusing to overwrite credentials.',
    );
}

function validName(value: unknown) {
  if (typeof value !== 'string' || !MOUNT_NAME_PATTERN.test(value))
    throw new Error(
      'Invalid mount name; use 1-64 letters, digits, "-" or "_", starting with a letter or digit.',
    );
  return value;
}

function validMountpoint(value: unknown) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0'))
    throw new Error('Invalid mountpoint; use an absolute path.');
  return resolve(value);
}

export function linuxMountInfoContainsPath(mountInfo: string, mountpoint: string): boolean {
  const expectedPath = resolve(mountpoint);
  return mountInfo.split('\n').some((line) => {
    const mountPath = line.split(' ')[4];
    if (mountPath === undefined) return false;
    // mountinfo encodes path whitespace and backslashes as three-digit octal escapes.
    const decodedPath = mountPath.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
    return decodedPath === expectedPath;
  });
}

/** Validate Finder alias prerequisites before `connect` reserves its registry name. */
export async function validateLiveWorkspaceMountpoint(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const mountpoint = validMountpoint(value);
  if (platform !== 'darwin') return mountpoint;

  const parent = dirname(mountpoint);
  let resolvedParent: string;
  let parentInfo;
  try {
    resolvedParent = await realpath(parent);
    parentInfo = await lstat(resolvedParent);
  } catch (error) {
    if (isCode(error, 'ENOENT'))
      throw new Error(`Finder mountpoint parent does not exist: ${parent}`);
    throw error;
  }
  if (!parentInfo.isDirectory())
    throw new Error(`Finder mountpoint parent is not a directory: ${parent}`);
  try {
    await access(resolvedParent, constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(`Finder mountpoint parent is not writable: ${parent}`);
  }

  try {
    await lstat(mountpoint);
    throw new Error(`Finder mountpoint already exists: ${mountpoint}`);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return mountpoint;
    throw error;
  }
  return mountpoint;
}

function validDriveId(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\0'))
    throw new Error('Invalid drive ID.');
  return value;
}

function validApiUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Invalid API URL; use an absolute http(s) URL.');
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Invalid API URL; use an absolute http(s) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Invalid API URL; use an absolute http(s) URL.');
  return trimmed;
}

function validSandboxId(value: unknown) {
  if (typeof value !== 'string' || !SANDBOX_ID_PATTERN.test(value))
    throw new Error('Invalid sandbox ID.');
  return value;
}

function validLiveSandboxId(value: unknown) {
  if (typeof value !== 'string' || !LIVE_SANDBOX_ID_PATTERN.test(value))
    throw new Error('Invalid Instabox sandbox ID; use its exact m_... ID, not a name or alias.');
  return value;
}

function malformed(): never {
  throw new Error(MALFORMED);
}

function validWorkspaceRoot(value: unknown) {
  if (
    typeof value !== 'string' ||
    !posix.isAbsolute(value) ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.includes('//') ||
    (value !== '/' && value.endsWith('/')) ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid workspace root; use a normalized absolute sandbox path.');
  return value;
}

/** A registry entry read from disk: required fields are strict, unknown fields are ignored. */
function storedEntry(value: unknown): MountRegistryEntry {
  if (!isRecord(value)) malformed();
  const common = {
    name:
      typeof value.name === 'string' && MOUNT_NAME_PATTERN.test(value.name)
        ? value.name
        : malformed(),
    mountpoint:
      typeof value.mountpoint === 'string' &&
      isAbsolute(value.mountpoint) &&
      !value.mountpoint.includes('\0')
        ? resolve(value.mountpoint)
        : malformed(),
    readOnly:
      value.readOnly === undefined
        ? false
        : typeof value.readOnly === 'boolean'
          ? value.readOnly
          : malformed(),
  };
  if (value.kind === 'live-workspace') {
    const entry: LiveWorkspaceRegistryEntry = {
      kind: 'live-workspace',
      ...common,
      sandboxId:
        typeof value.sandboxId === 'string' && LIVE_SANDBOX_ID_PATTERN.test(value.sandboxId)
          ? value.sandboxId
          : malformed(),
      root: (() => {
        try {
          return validWorkspaceRoot(value.root);
        } catch {
          return malformed();
        }
      })(),
      wakeOnAccess:
        value.wakeOnAccess === undefined
          ? false
          : typeof value.wakeOnAccess === 'boolean'
            ? value.wakeOnAccess
            : malformed(),
    };
    if (value.registeredAt !== undefined) {
      if (typeof value.registeredAt !== 'string') malformed();
      entry.registeredAt = value.registeredAt;
    }
    return entry;
  }
  if (value.kind !== undefined && value.kind !== 'drive') malformed();
  const entry: DriveMountRegistryEntry = {
    kind: 'drive',
    ...common,
    driveId:
      typeof value.driveId === 'string' &&
      value.driveId.length >= 1 &&
      value.driveId.length <= 256 &&
      !value.driveId.includes('\0')
        ? value.driveId
        : malformed(),
    apiUrl: (() => {
      if (typeof value.apiUrl !== 'string' || !value.apiUrl.trim()) return malformed();
      const trimmed = value.apiUrl.trim();
      try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : malformed();
      } catch {
        return malformed();
      }
    })(),
  };
  if (value.sandboxId !== undefined) {
    if (typeof value.sandboxId !== 'string' || !SANDBOX_ID_PATTERN.test(value.sandboxId))
      malformed();
    entry.sandboxId = value.sandboxId as string;
  }
  if (value.registeredAt !== undefined) {
    if (typeof value.registeredAt !== 'string') malformed();
    entry.registeredAt = value.registeredAt;
  }
  return entry;
}

async function readRegistryFile(path: string): Promise<MountRegistryEntry[]> {
  assertRegistryPathSafe(path);
  let serialized: string;
  try {
    serialized = await readFile(path, 'utf8');
  } catch (error) {
    if (isCode(error, 'ENOENT')) return [];
    throw new Error('Unable to read the Agent Drive mount registry.', { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(MALFORMED);
  }
  if (!isRecord(value)) throw new Error(MALFORMED);
  if (!Array.isArray(value.mounts)) throw new Error(MALFORMED);
  return (value.mounts as unknown[]).map(storedEntry);
}

export async function readMountRegistry(): Promise<MountRegistryEntry[]> {
  return readRegistryFile(mountRegistryPath());
}

export async function findMountEntry(name: string): Promise<MountRegistryEntry> {
  const entry = (await readMountRegistry()).find((mount) => mount.name === name);
  if (!entry) throw new Error(`No mount registered as '${name}'.`);
  return entry;
}

async function writeRegistryFile(path: string, mounts: MountRegistryEntry[]) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  let created = true;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(
      `${JSON.stringify({ version: REGISTRY_VERSION, mounts }, null, 2)}\n`,
      'utf8',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    created = false;
    await chmod(path, 0o600);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

/** Env and --key-file keys are not durable; drive mounts require saved
 *  authorization for the entry's API origin. */
async function requireSavedAuthorization(entry: DriveMountRegistryEntry) {
  const origin = originOf(entry.apiUrl);
  if (origin === undefined) throw new Error('Invalid API URL; use an absolute http(s) URL.');
  const saved = await readConfig();
  // Mirror loadConfig's bearer binding: a saved API key serves only its recorded origin.
  if (!saved.apiKey || originOf(saved.apiUrl ?? DEFAULT_API_URL) !== origin)
    throw new Error(
      `No saved API key for ${origin}. Run \`agent-drive login --api ${entry.apiUrl}\` before registering the mount.`,
    );
  const key = saved.driveKeys?.[entry.driveId];
  if (
    key === undefined ||
    saved.driveKeyOrigins?.[entry.driveId] !== origin ||
    !isValidDriveKey(key)
  )
    throw new Error(
      `No saved drive key for ${entry.driveId} on ${origin}. Save the drive key on this machine before registering the mount.`,
    );
}

export async function registerMount(input: RegisterMountInput): Promise<DriveMountRegistryEntry> {
  const entry: DriveMountRegistryEntry = {
    kind: 'drive',
    name: validName(input.name),
    mountpoint: validMountpoint(input.mountpoint),
    driveId: validDriveId(input.driveId),
    apiUrl: validApiUrl(input.apiUrl),
    readOnly:
      input.readOnly === undefined
        ? false
        : typeof input.readOnly === 'boolean'
          ? input.readOnly
          : (() => {
              throw new Error('Invalid read-only flag.');
            })(),
    ...(input.sandboxId !== undefined ? { sandboxId: validSandboxId(input.sandboxId) } : {}),
    registeredAt: new Date().toISOString(),
  };
  const path = mountRegistryPath();
  assertRegistryPathSafe(path);
  await requireSavedAuthorization(entry);
  // The lock database opens inside withSqliteFileLock, so the parent directory
  // must exist before the lock is taken.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return await withSqliteFileLock(
    `${path}.lock.sqlite`,
    async () => {
      const mounts = await readRegistryFile(path);
      for (const existing of mounts) {
        if (existing.name === entry.name)
          throw new Error(`A mount named '${entry.name}' is already registered.`);
        if (existing.mountpoint === entry.mountpoint)
          throw new Error(
            `The mountpoint ${entry.mountpoint} is already registered as '${existing.name}'.`,
          );
      }
      await writeRegistryFile(path, [...mounts, entry]);
      return entry;
    },
    { owner: 'mount-registry' },
  );
}

/** Remove only the exact live-workspace registration created by this connect attempt. */
export async function unregisterLiveWorkspaceIfUnchanged(
  entry: LiveWorkspaceRegistryEntry,
): Promise<boolean> {
  const path = mountRegistryPath();
  assertRegistryPathSafe(path);
  return await withSqliteFileLock(
    `${path}.lock.sqlite`,
    async () => {
      const mounts = await readRegistryFile(path);
      const index = mounts.findIndex(
        (current) =>
          current.kind === 'live-workspace' &&
          current.name === entry.name &&
          current.registeredAt === entry.registeredAt &&
          current.mountpoint === entry.mountpoint &&
          current.sandboxId === entry.sandboxId &&
          current.root === entry.root &&
          current.readOnly === entry.readOnly &&
          current.wakeOnAccess === entry.wakeOnAccess,
      );
      if (index < 0) return false;
      const next = [...mounts];
      next.splice(index, 1);
      await writeRegistryFile(path, next);
      return true;
    },
    { owner: 'mount-registry' },
  );
}

export async function registerLiveWorkspace(
  input: RegisterLiveWorkspaceInput,
  options: { preventFinderAliases?: boolean } = {},
): Promise<LiveWorkspaceRegistryEntry> {
  const entry: LiveWorkspaceRegistryEntry = {
    kind: 'live-workspace',
    name: validName(input.name),
    mountpoint: validMountpoint(input.mountpoint),
    sandboxId: validLiveSandboxId(input.sandboxId),
    root: validWorkspaceRoot(input.root),
    readOnly:
      input.readOnly === undefined
        ? false
        : typeof input.readOnly === 'boolean'
          ? input.readOnly
          : (() => {
              throw new Error('Invalid read-only flag.');
            })(),
    wakeOnAccess:
      input.wakeOnAccess === undefined
        ? true
        : typeof input.wakeOnAccess === 'boolean'
          ? input.wakeOnAccess
          : (() => {
              throw new Error('Invalid wake-on-access flag.');
            })(),
    registeredAt: new Date().toISOString(),
  };
  const path = mountRegistryPath();
  assertRegistryPathSafe(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return await withSqliteFileLock(
    `${path}.lock.sqlite`,
    async () => {
      const mounts = await readRegistryFile(path);
      for (const existing of mounts) {
        if (existing.name === entry.name)
          throw new Error(`A mount named '${entry.name}' is already registered.`);
        if (
          options.preventFinderAliases === true &&
          existing.kind === 'live-workspace' &&
          existing.sandboxId === entry.sandboxId &&
          existing.root === entry.root
        )
          throw new Error(
            `This workspace is already registered as '${existing.name}' at ${existing.mountpoint}. Use that Finder mount instead of adding an alias.`,
          );
        if (existing.mountpoint === entry.mountpoint)
          throw new Error(
            `The mountpoint ${entry.mountpoint} is already registered as '${existing.name}'.`,
          );
      }
      await writeRegistryFile(path, [...mounts, entry]);
      return entry;
    },
    { owner: 'mount-registry' },
  );
}

export async function setLiveWorkspaceWakePolicy(
  name: string,
  wakeOnAccess: boolean,
): Promise<LiveWorkspaceRegistryEntry> {
  const valid = validName(name);
  if (typeof wakeOnAccess !== 'boolean') throw new Error('Invalid wake-on-access flag.');
  const path = mountRegistryPath();
  assertRegistryPathSafe(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return withSqliteFileLock(
    `${path}.lock.sqlite`,
    async () => {
      const mounts = await readRegistryFile(path);
      const index = mounts.findIndex((entry) => entry.name === valid);
      if (index < 0) throw new Error(`No mount registered as '${valid}'.`);
      const entry = mounts[index]!;
      if (entry.kind !== 'live-workspace')
        throw new Error(`Mount '${valid}' is not a live workspace.`);
      const updated = { ...entry, wakeOnAccess };
      mounts[index] = updated;
      await writeRegistryFile(path, mounts);
      return updated;
    },
    { owner: 'mount-registry' },
  );
}

export async function describeMountpoint(
  mountpoint: string,
): Promise<{ state: MountpointState; target?: string }> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(mountpoint);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return { state: 'free' };
    throw error;
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(mountpoint).catch(() => undefined);
    return { state: 'symlink', ...(target === undefined ? {} : { target }) };
  }
  if (info.isDirectory()) return { state: 'directory' };
  return { state: 'other' };
}

export async function mountStatus(name?: string): Promise<MountStatus[]> {
  const mounts = await readMountRegistry();
  const selected = name === undefined ? mounts : mounts.filter((mount) => mount.name === name);
  if (name !== undefined && selected.length === 0)
    throw new Error(`No mount registered as '${name}'.`);
  return Promise.all(
    selected.map(async (entry) => ({
      ...entry,
      filesystem: await describeMountpoint(entry.mountpoint),
    })),
  );
}

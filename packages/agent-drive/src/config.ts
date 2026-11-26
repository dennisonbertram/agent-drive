import { chmod, link, lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { decodeDriveKey } from './crypto.js';
import { loadConfig } from './credentials.js';

export type AgentDriveConfig = {
  apiUrl?: string;
  apiKey?: string;
  driveKeys?: Record<string, string>;
  /** Origin each drive key was saved for; keys with none are assigned the saved apiUrl's origin when read. */
  driveKeyOrigins?: Record<string, string>;
  /** Where each drive key was last backed up (§9). */
  keyBackup?: Record<string, KeyBackup>;
  /** Account public key SHA-256 fingerprint pinned per API origin (key substitution defence). */
  accountKeyPins?: Record<string, string>;
  /** Set by `credentials export`, consumed by `credentials confirm`. Holds a hash, never the key. */
  pendingExport?: PendingExport | null;
};

export type PendingExport = { apiKeyHash: string; driveIds: string[] };

export type KeyBackup = { at: string; method: 'file' | 'stdout' | 'env' };

export const DEFAULT_API_URL = 'https://agentdrive.xyz/api';

export async function resolveLoginApiUrl(flag: string | undefined) {
  return flag ?? process.env.AGENT_DRIVE_API_URL ?? (await readConfig()).apiUrl ?? DEFAULT_API_URL;
}

/** The --drive flag, else the only drive key saved for this API origin, else an error naming the choices. */
export function resolveDriveId(flag: string | undefined, config: AgentDriveConfig, apiUrl: string) {
  if (flag) return flag;
  const origin = originOf(apiUrl);
  const ids = Object.keys(config.driveKeys ?? {}).filter(
    (id) => config.driveKeyOrigins?.[id] === origin,
  );
  if (ids.length === 1) return ids[0]!;
  throw new Error(
    `A --drive ID is required. ${ids.length ? `Configured drives for this API: ${ids.join(', ')}.` : 'No drive key is configured for this API.'}`,
  );
}

export function configPath() {
  return process.env.AGENT_DRIVE_CONFIG ?? join(homedir(), '.config', 'agent-drive', 'config.json');
}

export async function readConfig(): Promise<AgentDriveConfig> {
  let serialized: string;
  try {
    serialized = await readFile(configPath(), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw new Error('Unable to read Agent Drive configuration.');
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Agent Drive configuration is malformed; refusing to overwrite it.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent Drive configuration is malformed; refusing to overwrite it.');
  }
  const record = value as Record<string, unknown>;
  if (
    (record.apiUrl !== undefined && typeof record.apiUrl !== 'string') ||
    (record.apiKey !== undefined && typeof record.apiKey !== 'string') ||
    (record.driveKeys !== undefined &&
      (!record.driveKeys ||
        typeof record.driveKeys !== 'object' ||
        Array.isArray(record.driveKeys) ||
        Object.values(record.driveKeys).some((key) => typeof key !== 'string'))) ||
    (record.driveKeyOrigins !== undefined &&
      (!record.driveKeyOrigins ||
        typeof record.driveKeyOrigins !== 'object' ||
        Array.isArray(record.driveKeyOrigins) ||
        Object.values(record.driveKeyOrigins).some((origin) => typeof origin !== 'string'))) ||
    (record.keyBackup !== undefined &&
      (!record.keyBackup ||
        typeof record.keyBackup !== 'object' ||
        Array.isArray(record.keyBackup))) ||
    (record.accountKeyPins !== undefined &&
      (!record.accountKeyPins ||
        typeof record.accountKeyPins !== 'object' ||
        Array.isArray(record.accountKeyPins) ||
        Object.values(record.accountKeyPins).some((pin) => typeof pin !== 'string'))) ||
    (record.pendingExport != null &&
      (typeof record.pendingExport !== 'object' ||
        typeof (record.pendingExport as PendingExport).apiKeyHash !== 'string' ||
        !Array.isArray((record.pendingExport as PendingExport).driveIds)))
  ) {
    throw new Error('Agent Drive configuration is malformed; refusing to overwrite it.');
  }
  // One-time migration: a key saved before origins were recorded belongs to the saved apiUrl's
  // origin. It is persisted by the next writeConfig, which merges what readConfig returns.
  const legacyOrigin = typeof record.apiUrl === 'string' ? originOf(record.apiUrl) : undefined;
  const keys = (record.driveKeys ?? {}) as Record<string, string>;
  const origins = { ...(record.driveKeyOrigins as Record<string, string> | undefined) };
  if (legacyOrigin)
    for (const id of Object.keys(keys)) if (origins[id] === undefined) origins[id] = legacyOrigin;
  return {
    ...(typeof record.apiUrl === 'string' ? { apiUrl: record.apiUrl } : {}),
    ...(typeof record.apiKey === 'string' ? { apiKey: record.apiKey } : {}),
    ...(record.driveKeys !== undefined
      ? { driveKeys: { ...(record.driveKeys as Record<string, string>) } }
      : {}),
    ...(Object.keys(origins).length || record.driveKeyOrigins !== undefined
      ? { driveKeyOrigins: origins }
      : {}),
    ...(record.keyBackup !== undefined
      ? { keyBackup: { ...(record.keyBackup as Record<string, KeyBackup>) } }
      : {}),
    ...(record.accountKeyPins !== undefined
      ? { accountKeyPins: { ...(record.accountKeyPins as Record<string, string>) } }
      : {}),
    ...(record.pendingExport != null
      ? { pendingExport: record.pendingExport as PendingExport }
      : {}),
  };
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export async function writeConfig(config: AgentDriveConfig) {
  const path = configPath();
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const timeoutAt = Date.now() + 10_000;
  const lockDbPath = `${path}.lock.sqlite`;
  const database = await openConfigLockDatabase(lockDbPath);
  let databaseInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    databaseInfo = await lstat(lockDbPath);
    if (!databaseInfo.isFile())
      throw new Error(`Configuration lock database must be a regular file: ${lockDbPath}`);
  } catch (error) {
    database.close();
    throw error;
  }
  let databaseLocked = false;
  let lockOwned = false;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  let backupsCleared = false;
  try {
    await acquireConfigLockDatabase(database, timeoutAt, lockDbPath);
    databaseLocked = true;
    await acquireConfigFileLock(lockPath, lockDbPath, databaseInfo, timeoutAt);
    lockOwned = true;

    const current = await readConfig();
    // A new API key invalidates every exported bundle, so earlier backup records are stale.
    const keyChanged = config.apiKey !== undefined && config.apiKey !== current.apiKey;
    backupsCleared = keyChanged && Object.keys(current.keyBackup ?? {}).length > 0;
    const previousBackup = keyChanged ? undefined : current.keyBackup;
    const mergedDriveKeys = { ...current.driveKeys, ...config.driveKeys };
    const merged: AgentDriveConfig = {
      ...current,
      ...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
      ...(current.driveKeys || config.driveKeys ? { driveKeys: mergedDriveKeys } : {}),
      ...(current.driveKeyOrigins || config.driveKeyOrigins
        ? { driveKeyOrigins: { ...current.driveKeyOrigins, ...config.driveKeyOrigins } }
        : {}),
      ...(previousBackup || config.keyBackup
        ? { keyBackup: { ...previousBackup, ...config.keyBackup } }
        : {}),
    };
    if (keyChanged && !config.keyBackup) delete merged.keyBackup;
    if (merged.pendingExport === null) delete merged.pendingExport;
    const handle = await open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    try {
      if (temporaryCreated) await rm(temporary, { force: true });
    } finally {
      try {
        if (lockOwned) await releaseConfigFileLock(lockPath, databaseInfo);
      } finally {
        try {
          if (databaseLocked && database.isTransaction) database.exec('ROLLBACK');
        } finally {
          database.close();
        }
      }
    }
  }
  return { backupsCleared };
}

let sqliteImport: Promise<typeof import('node:sqlite')> | undefined;

async function openConfigLockDatabase(path: string) {
  let handle;
  let created = false;
  try {
    handle = await open(path, 'wx', 0o600);
    created = true;
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
    const existing = await lstat(path).catch((statError: unknown) => {
      throw new Error(`Unable to inspect configuration lock database at ${path}.`, {
        cause: statError,
      });
    });
    if (!existing.isFile())
      throw new Error(`Configuration lock database must be a regular file: ${path}`);
    if ((existing.mode & 0o077) !== 0 || (existing.mode & 0o200) === 0)
      throw new Error(`Configuration lock database has unsafe permissions: ${path}`);
    handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  }
  try {
    if (created) await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  try {
    const info = await lstat(path);
    if (!info.isFile())
      throw new Error(`Configuration lock database must be a regular file: ${path}`);
  } catch (error) {
    throw new Error(`Unable to access configuration lock database at ${path}.`, { cause: error });
  }
  const { DatabaseSync } = await getSqlite();
  try {
    return new DatabaseSync(path);
  } catch (error) {
    throw new Error(`Unable to open configuration lock database at ${path}.`, { cause: error });
  }
}

function getSqlite() {
  return (sqliteImport ??= import('node:sqlite'));
}

async function acquireConfigLockDatabase(
  database: import('node:sqlite').DatabaseSync,
  timeoutAt: number,
  path: string,
) {
  while (true) {
    try {
      database.exec('BEGIN IMMEDIATE');
      return;
    } catch (error) {
      if (!isSqliteBusy(error))
        throw new Error(`Unable to acquire configuration lock database at ${path}.`, {
          cause: error,
        });
      if (Date.now() >= timeoutAt)
        throw new Error(`Timed out waiting for configuration lock database at ${path}.`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
}

async function acquireConfigFileLock(
  lockPath: string,
  lockDbPath: string,
  databaseInfo: Awaited<ReturnType<typeof lstat>>,
  timeoutAt: number,
) {
  while (true) {
    try {
      await link(lockDbPath, lockPath);
      return;
    } catch (error) {
      if (!isCode(error, 'EEXIST'))
        throw new Error(`Unable to acquire configuration lock at ${lockPath}.`, { cause: error });
    }

    const info = await lstat(lockPath).catch((error: unknown) => {
      if (isCode(error, 'ENOENT')) return undefined;
      throw new Error(`Unable to inspect configuration lock at ${lockPath}.`, { cause: error });
    });
    if (info?.isFile()) {
      if (info.dev === databaseInfo.dev && info.ino === databaseInfo.ino) {
        // This marker is a hard link to the lock database. Only a writer holding the SQLite
        // transaction can remove it; older clients can only create a directory at this path.
        await unlink(lockPath).catch((error: unknown) => {
          if (!isCode(error, 'ENOENT')) throw error;
        });
        continue;
      }
      throw new Error(`Configuration lock path is occupied by an unrelated file: ${lockPath}`);
    }
    if (info && !info.isDirectory())
      throw new Error(
        `Configuration lock path is not a regular file or legacy directory: ${lockPath}`,
      );
    if (Date.now() >= timeoutAt) {
      const legacy = info?.isDirectory()
        ? ` The lock is a legacy directory; confirm no Agent Drive command is running, then remove ${lockPath} manually.`
        : '';
      throw new Error(`Timed out waiting for configuration lock at ${lockPath}.${legacy}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

async function releaseConfigFileLock(
  lockPath: string,
  databaseInfo: Awaited<ReturnType<typeof lstat>>,
) {
  const info = await lstat(lockPath).catch((error: unknown) => {
    if (isCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (!info || !info.isFile() || info.dev !== databaseInfo.dev || info.ino !== databaseInfo.ino)
    return;
  await unlink(lockPath).catch((error: unknown) => {
    if (!isCode(error, 'ENOENT'))
      throw new Error(`Unable to release configuration lock at ${lockPath}.`, { cause: error });
  });
}

function isSqliteBusy(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errcode' in error &&
    (error.errcode === 5 || error.errcode === 6)
  );
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function machineName() {
  return process.env.AGENT_DRIVE_MACHINE ?? hostname();
}

/** A saved key is trusted for an origin only if it was saved for it and decodes to 32 bytes. */
export function keysForOrigin(config: AgentDriveConfig, origin: string) {
  return Object.fromEntries(
    Object.entries(config.driveKeys ?? {}).filter(
      ([id, key]) => config.driveKeyOrigins?.[id] === origin && isValidDriveKey(key),
    ),
  );
}

export function isValidDriveKey(key: string) {
  try {
    decodeDriveKey(key);
    return true;
  } catch {
    return false;
  }
}

export function driveKeyEnvironmentName(driveId: string) {
  return `AGENT_DRIVE_KEY_${driveId.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
}

export async function resolveConnection(apiUrlFlag?: string) {
  const saved = await loadConfig(apiUrlFlag);
  const apiUrl = apiUrlFlag || process.env.AGENT_DRIVE_API_URL || saved.apiUrl || DEFAULT_API_URL;
  const apiKey = process.env.AGENT_DRIVE_API_KEY || saved.apiKey;
  if (!apiUrl || !apiKey) {
    throw new Error(
      'API configuration is missing. Run `agent-drive login` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY.',
    );
  }
  return { apiUrl, apiKey, config: saved };
}

export async function resolveDriveKey(
  driveId: string,
  apiUrl: string,
  keyFile?: string,
  config?: AgentDriveConfig,
) {
  const fromDriveEnvironment = process.env[driveKeyEnvironmentName(driveId)];
  if (fromDriveEnvironment) return fromDriveEnvironment.trim();
  if (process.env.AGENT_DRIVE_KEY) return process.env.AGENT_DRIVE_KEY.trim();
  if (keyFile) return (await readFile(keyFile, 'utf8')).trim();
  // A saved drive key goes only to the origin it was recorded for; explicit env and
  // --key-file keys keep their precedence at any origin.
  const origin = originOf(apiUrl);
  if (origin === undefined) return undefined;
  const saved = config ?? {};
  const key = saved.driveKeys?.[driveId];
  return key !== undefined && saved.driveKeyOrigins?.[driveId] === origin && isValidDriveKey(key)
    ? key
    : undefined;
}

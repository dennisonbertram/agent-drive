import { chmod, mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
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
  /** Set by `credentials export`, consumed by `credentials confirm`. Holds a hash, never the key. */
  pendingExport?: PendingExport | null;
};

export type PendingExport = { apiKeyHash: string; driveIds: string[] };

export type KeyBackup = { at: string; method: 'file' | 'stdout' | 'env' };

export const DEFAULT_API_URL = 'https://agentdrive.xyz/api';

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
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        throw new Error(`Unable to acquire configuration lock at ${lockPath}.`);
      }
      if (Date.now() >= timeoutAt) {
        throw new Error(
          `Timed out waiting for configuration lock at ${lockPath}. If no Agent Drive command is running, remove the stale lock directory manually.`,
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  let backupsCleared = false;
  try {
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
        await rmdir(lockPath);
      } catch (error) {
        if (!isCode(error, 'ENOENT')) {
          throw new Error(`Unable to release configuration lock at ${lockPath}.`);
        }
      }
    }
  }
  return { backupsCleared };
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

export async function resolveConnection() {
  const saved = await loadConfig();
  const apiUrl = process.env.AGENT_DRIVE_API_URL || saved.apiUrl || DEFAULT_API_URL;
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
  keyFile?: string,
  config?: AgentDriveConfig,
) {
  const fromDriveEnvironment = process.env[driveKeyEnvironmentName(driveId)];
  if (fromDriveEnvironment) return fromDriveEnvironment.trim();
  if (process.env.AGENT_DRIVE_KEY) return process.env.AGENT_DRIVE_KEY.trim();
  if (keyFile) return (await readFile(keyFile, 'utf8')).trim();
  return config?.driveKeys?.[driveId];
}

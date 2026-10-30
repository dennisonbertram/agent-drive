import { chmod, mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hostname, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export type AgentDriveConfig = {
  apiUrl?: string;
  apiKey?: string;
  driveKeys?: Record<string, string>;
};

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
        Object.values(record.driveKeys).some((key) => typeof key !== 'string')))
  ) {
    throw new Error('Agent Drive configuration is malformed; refusing to overwrite it.');
  }
  return {
    ...(typeof record.apiUrl === 'string' ? { apiUrl: record.apiUrl } : {}),
    ...(typeof record.apiKey === 'string' ? { apiKey: record.apiKey } : {}),
    ...(record.driveKeys !== undefined
      ? { driveKeys: { ...(record.driveKeys as Record<string, string>) } }
      : {}),
  };
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
  try {
    const current = await readConfig();
    const mergedDriveKeys = { ...current.driveKeys, ...config.driveKeys };
    const merged: AgentDriveConfig = {
      ...current,
      ...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
      ...(current.driveKeys || config.driveKeys ? { driveKeys: mergedDriveKeys } : {}),
    };
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
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function machineName() {
  return process.env.AGENT_DRIVE_MACHINE ?? hostname();
}

export function driveKeyEnvironmentName(driveId: string) {
  return `AGENT_DRIVE_KEY_${driveId.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
}

export async function resolveConnection() {
  const saved = await readConfig();
  const apiUrl = process.env.AGENT_DRIVE_API_URL ?? saved.apiUrl;
  const apiKey = process.env.AGENT_DRIVE_API_KEY ?? saved.apiKey;
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

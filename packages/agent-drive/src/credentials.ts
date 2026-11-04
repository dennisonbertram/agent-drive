import { chmod, open } from 'node:fs/promises';
import {
  readConfig,
  writeConfig,
  DEFAULT_API_URL,
  type AgentDriveConfig,
  type KeyBackup,
} from './config.js';

export const BUNDLE_PREFIX = 'adcred1.';

export type Bundle = {
  v: 1;
  apiUrl: string;
  apiKey: string;
  driveKeys: Record<string, string>;
  driveKeyOrigins: Record<string, string>;
};

export const BACKUP_HINT =
  "Back up this agent's credentials before this machine or sandbox goes away: `agent-drive credentials export --to <a path that survives>` or `agent-drive credentials export --stdout | <your secret store>`. Until then `agent-drive check` will not pass.";

export function encodeBundle(bundle: Bundle) {
  return BUNDLE_PREFIX + Buffer.from(JSON.stringify(bundle)).toString('base64url');
}

const isStringMap = (v: unknown): v is Record<string, string> =>
  Boolean(v) &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v as object).every((x) => typeof x === 'string');

export function decodeBundle(text: string): Bundle {
  const bad = () => new Error('Not a valid Agent Drive credentials bundle.');
  const trimmed = text.trim();
  if (!trimmed.startsWith(BUNDLE_PREFIX)) throw bad();
  let value: Partial<Bundle>;
  try {
    value = JSON.parse(
      Buffer.from(trimmed.slice(BUNDLE_PREFIX.length), 'base64url').toString('utf8'),
    );
  } catch {
    throw bad();
  }
  if (
    !value ||
    value.v !== 1 ||
    typeof value.apiUrl !== 'string' ||
    typeof value.apiKey !== 'string' ||
    !isStringMap(value.driveKeys) ||
    !isStringMap(value.driveKeyOrigins)
  )
    throw bad();
  return value as Bundle;
}

/** The AGENT_DRIVE_CREDENTIALS bundle, if set. Errors never include its content. */
export function envBundle(): Bundle | undefined {
  const raw = process.env.AGENT_DRIVE_CREDENTIALS?.trim();
  if (!raw) return undefined;
  try {
    return decodeBundle(raw);
  } catch {
    throw new Error('AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle.');
  }
}

/**
 * The saved config with the environment bundle merged in memory. Saved values win over the
 * bundle (a later login is newer than a stored backup); bundle drives count as backed up.
 * Never write the result back: writeConfig re-reads the file itself.
 */
export async function loadConfig(): Promise<AgentDriveConfig> {
  const saved = await readConfig();
  const bundle = envBundle();
  if (!bundle) return saved;
  const at = new Date().toISOString();
  const driveKeys = { ...bundle.driveKeys, ...saved.driveKeys };
  const keyBackup: Record<string, KeyBackup> = { ...saved.keyBackup };
  for (const id of Object.keys(bundle.driveKeys))
    if (driveKeys[id] === bundle.driveKeys[id]) keyBackup[id] = { at, method: 'env' };
  return {
    apiUrl: saved.apiUrl ?? bundle.apiUrl,
    apiKey: saved.apiKey ?? bundle.apiKey,
    driveKeys,
    driveKeyOrigins: { ...bundle.driveKeyOrigins, ...saved.driveKeyOrigins },
    keyBackup,
  };
}

export function unbackedUp(config: AgentDriveConfig, driveIds: string[]) {
  return driveIds.filter((id) => !config.keyBackup?.[id]);
}

type Io = { isTTY: boolean; write: (text: string) => void };

/** Writes a bundle to a 0600 file or (to a non-TTY) stdout, and records the backup. */
export async function exportCredentials(
  options: { to?: string; force?: boolean; stdout?: boolean },
  io: Io,
) {
  if (Boolean(options.to) === Boolean(options.stdout))
    throw new Error('Pass exactly one of --to <path> or --stdout.');
  if (options.stdout && io.isTTY)
    throw new Error(
      'Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials export --stdout | <your secret store>`, or use --to <path>.',
    );
  const config = await loadConfig();
  const apiKey = process.env.AGENT_DRIVE_API_KEY || config.apiKey;
  if (!apiKey) throw new Error('There is no API key to back up. Run `agent-drive login` first.');
  const driveKeys = config.driveKeys ?? {};
  const ids = Object.keys(driveKeys);
  if (!ids.length) throw new Error('There are no drive keys on this machine to back up.');
  const apiUrl = process.env.AGENT_DRIVE_API_URL || config.apiUrl || DEFAULT_API_URL;
  const bundle = encodeBundle({
    v: 1,
    apiUrl,
    apiKey,
    driveKeys,
    driveKeyOrigins: config.driveKeyOrigins ?? {},
  });
  const method = options.to ? 'file' : 'stdout';
  if (options.to) {
    let handle;
    try {
      handle = await open(options.to, options.force ? 'w' : 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`${options.to} already exists; pass --force to overwrite it.`);
      throw new Error(`Unable to write ${options.to}.`);
    }
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${bundle}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    await chmod(options.to, 0o600);
  } else io.write(`${bundle}\n`);
  const at = new Date().toISOString();
  await writeConfig({ keyBackup: Object.fromEntries(ids.map((id) => [id, { at, method }])) });
  return { method: method as 'file' | 'stdout', driveIds: ids, apiUrl, apiKey };
}

/** Merges a bundle into the saved config; imported keys count as backed up. */
export async function importCredentials(text: string, method: 'file' | 'stdout') {
  const bundle = decodeBundle(text);
  const at = new Date().toISOString();
  await writeConfig({
    apiUrl: bundle.apiUrl,
    apiKey: bundle.apiKey,
    driveKeys: bundle.driveKeys,
    driveKeyOrigins: bundle.driveKeyOrigins,
    keyBackup: Object.fromEntries(Object.keys(bundle.driveKeys).map((id) => [id, { at, method }])),
  });
  return Object.keys(bundle.driveKeys);
}

/** Tells the service a key was backed up (never the key). A failure is only a warning. */
export async function reportKeyBackup(
  apiUrl: string,
  apiKey: string,
  driveIds: string[],
  method: 'file' | 'stdout' | 'env',
  deps: { fetch?: typeof fetch; warn?: (message: string) => void } = {},
) {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const warn = deps.warn ?? ((m: string) => process.stderr.write(`${m}\n`));
  for (const id of driveIds) {
    try {
      const response = await doFetch(
        `${apiUrl.replace(/\/+$/u, '')}/v1/drives/${encodeURIComponent(id)}/key-backup`,
        {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ method }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      warn(`Warning: could not report the key backup for drive ${id} to Agent Drive.`);
    }
  }
}

let reportedEnv = false;
/** Reports bundle-supplied drives once per process. */
export async function reportEnvBackups(apiUrl: string, apiKey: string) {
  const bundle = envBundle();
  if (!bundle || reportedEnv) return;
  reportedEnv = true;
  await reportKeyBackup(apiUrl, apiKey, Object.keys(bundle.driveKeys), 'env');
}

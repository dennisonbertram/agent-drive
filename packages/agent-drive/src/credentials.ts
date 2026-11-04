import { createHash } from 'node:crypto';
import { validateUrl } from './client.js';
import { decodeDriveKey } from './crypto.js';
import { writeFileSafely } from './safe-write.js';
import {
  readConfig,
  resolveDriveKey,
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
  "Back up this agent's credentials before this machine or sandbox goes away: `agent-drive credentials export --to <a path that survives>` or `agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm`. Until then `agent-drive check` will not pass.";

export function encodeBundle(bundle: Bundle) {
  return BUNDLE_PREFIX + Buffer.from(JSON.stringify(bundle)).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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
  // Reject the whole bundle on any invalid field.
  try {
    validateUrl(value.apiUrl, true);
  } catch {
    throw bad();
  }
  if (!value.apiKey || value.apiKey.length > 512) throw bad();
  for (const [id, key] of Object.entries(value.driveKeys)) {
    if (!UUID.test(id)) throw bad();
    try {
      decodeDriveKey(key);
    } catch {
      throw bad();
    }
  }
  for (const id of Object.keys(value.driveKeyOrigins)) if (!UUID.test(id)) throw bad();
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
  const effectiveUrl = process.env.AGENT_DRIVE_API_URL || saved.apiUrl || bundle.apiUrl;
  const effectiveOrigin = originOf(effectiveUrl);
  // A bundle is a backup only of the connection it holds: same API key and origin.
  const sameConnection =
    (process.env.AGENT_DRIVE_API_KEY || saved.apiKey || bundle.apiKey) === bundle.apiKey &&
    originOf(bundle.apiUrl) === effectiveOrigin;
  const driveKeys = { ...bundle.driveKeys, ...saved.driveKeys };
  const keyBackup: Record<string, KeyBackup> = { ...saved.keyBackup };
  for (const id of Object.keys(bundle.driveKeys))
    if (
      sameConnection &&
      driveKeys[id] === bundle.driveKeys[id] &&
      bundle.driveKeyOrigins[id] === effectiveOrigin
    )
      keyBackup[id] = { at, method: 'env' };
  return {
    apiUrl: saved.apiUrl ?? bundle.apiUrl,
    apiKey: saved.apiKey ?? bundle.apiKey,
    driveKeys,
    driveKeyOrigins: { ...bundle.driveKeyOrigins, ...saved.driveKeyOrigins },
    keyBackup,
  };
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function unbackedUp(config: AgentDriveConfig, driveIds: string[]) {
  return driveIds.filter((id) => !config.keyBackup?.[id]);
}

type Io = { isTTY: boolean; write: (text: string) => Promise<void> };

const pendingFor = (apiKey: string, driveIds: string[]) => ({
  apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
  driveIds,
});

/**
 * Writes a bundle to a 0600 file (recorded as a backup) or to a non-TTY stdout. A stdout export
 * is not recorded: pipe it to a secret store, then run `agent-drive credentials confirm`.
 */
export async function exportCredentials(
  options: { to?: string; force?: boolean; stdout?: boolean },
  io: Io,
) {
  if (Boolean(options.to) === Boolean(options.stdout))
    throw new Error('Pass exactly one of --to <path> or --stdout.');
  if (options.stdout && io.isTTY)
    throw new Error(
      'Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm`, or use --to <path>.',
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
  if (options.to) {
    try {
      await writeFileSafely(options.to, `${bundle}\n`, {
        mode: 0o600,
        overwrite: Boolean(options.force),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`${options.to} already exists; pass --force to overwrite it.`);
      if (error instanceof Error && /symlink/u.test(error.message)) throw error;
      throw new Error(`Unable to write ${options.to}.`);
    }
    const at = new Date().toISOString();
    await writeConfig({
      keyBackup: Object.fromEntries(ids.map((id) => [id, { at, method: 'file' }])),
    });
    return { method: 'file' as const, driveIds: ids, apiUrl, apiKey };
  }
  await io.write(`${bundle}\n`);
  await writeConfig({ pendingExport: pendingFor(apiKey, ids) });
  return { method: 'stdout' as const, driveIds: ids, apiUrl, apiKey };
}

/**
 * Records that the last export was stored (`credentials confirm`). Only drives named by a
 * pending export made with the current API key are recorded, and the marker is then cleared.
 */
export async function confirmCredentials(method: 'stdout' | 'file' = 'stdout') {
  const config = await loadConfig();
  const apiKey = process.env.AGENT_DRIVE_API_KEY || config.apiKey;
  const pending = config.pendingExport;
  if (!apiKey || !pending || pending.apiKeyHash !== pendingFor(apiKey, []).apiKeyHash)
    throw new Error(
      'There is no matching credentials export to confirm. Run `agent-drive credentials export` first.',
    );
  const ids = pending.driveIds.filter((id) => config.driveKeys?.[id]);
  const at = new Date().toISOString();
  await writeConfig({
    keyBackup: Object.fromEntries(ids.map((id) => [id, { at, method }])),
    pendingExport: null,
  });
  const apiUrl = process.env.AGENT_DRIVE_API_URL || config.apiUrl || DEFAULT_API_URL;
  return { method, driveIds: ids, apiUrl, apiKey };
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
      // Same HTTPS/loopback rule as the client, checked before the token is attached.
      const base = validateUrl(apiUrl, true).toString().replace(/\/+$/u, '');
      const response = await doFetch(`${base}/v1/drives/${encodeURIComponent(id)}/key-backup`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ method }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      warn(`Warning: could not report the key backup for drive ${id} to Agent Drive.`);
    }
  }
}

let reportedEnv = false;
/** Reports bundle drives (once per process) whose effective key is the bundle's key for this origin. */
export async function reportEnvBackups(
  apiUrl: string,
  apiKey: string,
  deps: Parameters<typeof reportKeyBackup>[4] = {},
) {
  const bundle = envBundle();
  if (!bundle || reportedEnv) return;
  reportedEnv = true;
  if (bundle.apiKey !== apiKey || originOf(bundle.apiUrl) !== originOf(apiUrl)) return;
  const config = await loadConfig();
  const origin = originOf(apiUrl);
  const ids: string[] = [];
  for (const [id, key] of Object.entries(bundle.driveKeys))
    if (
      bundle.driveKeyOrigins[id] === origin &&
      (await resolveDriveKey(id, undefined, config)) === key
    )
      ids.push(id);
  await reportKeyBackup(apiUrl, apiKey, ids, 'env', deps);
}

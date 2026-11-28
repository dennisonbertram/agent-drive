import { createHash } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateUrl, type AgentDriveClient } from './client.js';
import { decodeDriveKey } from './crypto.js';
import { writeFileSafely } from './safe-write.js';
import {
  copyToClipboard,
  exportTo1Password,
  parseTarget,
  realTargetDeps,
  type TargetDeps,
} from './backup-targets.js';
import {
  readConfig,
  resolveDriveKey,
  resolveDriveId,
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
  "Back up this agent's credentials before this machine or sandbox goes away: `agent-drive credentials export --to 1password` (1Password), `agent-drive credentials export --to clipboard` (copy, paste it into Apple Passwords or another password manager, then run `agent-drive credentials confirm`), `agent-drive credentials export --to <a file outside the sandbox, on a path that survives it>` (the folder must already exist), or `agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm`. Start with `--to 1password` if you use 1Password. Until then `agent-drive check` will not pass.";

export function encodeBundle(bundle: Bundle) {
  return BUNDLE_PREFIX + Buffer.from(JSON.stringify(bundle)).toString('base64url');
}

/** A bundle holding only the named drives' keys (all of them when `driveIds` is omitted). */
export function buildBundle(
  source: Pick<Bundle, 'apiUrl' | 'apiKey'> &
    Partial<Pick<Bundle, 'driveKeys' | 'driveKeyOrigins'>>,
  driveIds?: string[],
) {
  const driveKeys = source.driveKeys ?? {};
  const origins = source.driveKeyOrigins ?? {};
  const ids = driveIds ?? Object.keys(driveKeys);
  return encodeBundle({
    v: 1,
    apiUrl: source.apiUrl,
    apiKey: source.apiKey,
    driveKeys: Object.fromEntries(
      ids.filter((id) => driveKeys[id]).map((id) => [id, driveKeys[id]!]),
    ),
    driveKeyOrigins: Object.fromEntries(
      ids.filter((id) => origins[id]).map((id) => [id, origins[id]!]),
    ),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const isStringMap = (v: unknown): v is Record<string, string> =>
  Boolean(v) &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v as object).every((x) => typeof x === 'string');

export function decodeBundle(text: string): Bundle {
  const bad = () => new Error('Not a valid Agent Drive credentials bundle.');
  // Accept the whole `AGENT_DRIVE_CREDENTIALS=adcred1....` line that `credentials issue` prints.
  const trimmed = text.trim().replace(/^AGENT_DRIVE_CREDENTIALS=/u, '');
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
 * A stored bearer is emitted only for the origin it was recorded with — an explicitly
 * selected --api/AGENT_DRIVE_API_URL at another origin never inherits it. The emitted
 * apiUrl is the effective URL, so apiUrl and apiKey always describe one connection. Callers
 * that already resolved a connection may provide both overrides to pin it during the merge.
 */
export async function loadConfig(
  apiUrlOverride?: string,
  apiKeyOverride?: string,
): Promise<AgentDriveConfig> {
  const saved = await readConfig();
  const bundle = envBundle();
  const effectiveUrl =
    apiUrlOverride ||
    process.env.AGENT_DRIVE_API_URL ||
    saved.apiUrl ||
    bundle?.apiUrl ||
    DEFAULT_API_URL;
  const effectiveOrigin = originOf(effectiveUrl);
  // A bearer recorded for one origin is never served at another. A config written before
  // apiUrl existed binds its apiKey to the default API.
  const apiKey =
    apiKeyOverride ??
    (process.env.AGENT_DRIVE_API_KEY || undefined) ??
    (originOf(saved.apiUrl ?? DEFAULT_API_URL) === effectiveOrigin ? saved.apiKey : undefined) ??
    (bundle !== undefined && originOf(bundle.apiUrl) === effectiveOrigin
      ? bundle.apiKey
      : undefined);
  if (!bundle) {
    const withoutBundle: AgentDriveConfig = { ...saved, apiUrl: effectiveUrl };
    if (apiKey === undefined) delete withoutBundle.apiKey;
    else withoutBundle.apiKey = apiKey;
    return withoutBundle;
  }
  const at = new Date().toISOString();
  // A bundle is a backup only of the connection it holds: same API key and origin.
  const sameConnection = apiKey === bundle.apiKey && originOf(bundle.apiUrl) === effectiveOrigin;
  const driveKeys = { ...bundle.driveKeys, ...saved.driveKeys };
  const driveKeyOrigins = { ...bundle.driveKeyOrigins, ...saved.driveKeyOrigins };
  // Bundles written before drive-key origins were recorded bind their keys to the bundle's
  // own API — the same migration readConfig applies to saved configs.
  const bundleOrigin = originOf(bundle.apiUrl);
  for (const [id, bundleKey] of Object.entries(bundle.driveKeys)) {
    const savedKey = saved.driveKeys?.[id];
    // Keys and origins are one record. The saved key wins, so never leave the bundle's
    // origin attached to a different saved value that has no origin of its own.
    if (
      savedKey !== undefined &&
      savedKey !== bundleKey &&
      saved.driveKeyOrigins?.[id] === undefined
    )
      delete driveKeyOrigins[id];
    if (bundleOrigin)
      if (driveKeyOrigins[id] === undefined && (savedKey === undefined || savedKey === bundleKey))
        driveKeyOrigins[id] = bundleOrigin;
  }
  const keyBackup: Record<string, KeyBackup> = { ...saved.keyBackup };
  for (const id of Object.keys(bundle.driveKeys))
    if (
      sameConnection &&
      driveKeys[id] === bundle.driveKeys[id] &&
      driveKeyOrigins[id] === effectiveOrigin
    )
      keyBackup[id] = { at, method: 'env' };
  return {
    apiUrl: effectiveUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    driveKeys,
    driveKeyOrigins,
    keyBackup,
    // Pins were read from config.json by the first version of auto-sealing; keep the legacy
    // read as a fallback. New pins only ever live in `<config>.state/account-seal.json`.
    ...(saved.accountKeyPins ? { accountKeyPins: saved.accountKeyPins } : {}),
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

async function writeBundleFile(path: string, bundle: string, force?: boolean) {
  try {
    await writeFileSafely(path, `${bundle}\n`, { mode: 0o600, overwrite: Boolean(force) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(`${path} already exists; pass --force to overwrite it.`);
    if (error instanceof Error && /symlink/u.test(error.message)) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        `Unable to write ${path}: its parent folder does not exist. Create it first, or pick another path.`,
      );
    throw new Error(`Unable to write ${path}.`);
  }
}

/**
 * Mints a new agent's key through a `delegate` key and prints a bundle holding only that key and
 * the chosen drive's key. The caller's own key and saved config are never part of it or changed.
 */
export async function issueCredentials(
  options: {
    name: string;
    drive?: string;
    scopes?: string[];
    writePaths?: string[];
    label?: string;
    machine?: string;
    apiUrl?: string;
    to?: string;
    force?: boolean;
    stdout?: boolean;
  },
  io: Io,
  createKey: AgentDriveClient['createKey'],
) {
  if (Boolean(options.to) === Boolean(options.stdout))
    throw new Error('Pass exactly one of --to <path> or --stdout.');
  if (options.stdout && io.isTTY)
    throw new Error(
      'Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials issue --name <agent> --stdout | <your secret store>`, or use --to <path>.',
    );
  if (options.to && !options.force) {
    // lstat: a dangling symlink counts as present. Only ENOENT means the path is free.
    const present = await lstat(options.to).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (present) throw new Error(`${options.to} already exists; pass --force to overwrite it.`);
  }
  if (options.to) {
    // Check before the agent and key are created, so a bad path cannot leave an orphan agent.
    const parent = dirname(options.to);
    const isFolder = await stat(parent).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!isFolder)
      throw new Error(
        `Unable to write ${options.to}: its parent folder does not exist. Create it first, or pick another path.`,
      );
  }
  const config = await loadConfig(options.apiUrl);
  const apiUrl =
    options.apiUrl || process.env.AGENT_DRIVE_API_URL || config.apiUrl || DEFAULT_API_URL;
  const drive = resolveDriveId(options.drive, config, apiUrl);
  const driveKey = await resolveDriveKey(drive, apiUrl, undefined, config);
  if (!driveKey) throw new Error(`There is no drive key for ${drive} on this machine.`);
  try {
    decodeDriveKey(driveKey);
  } catch {
    throw new Error(`The drive key for ${drive} on this machine is not a valid drive key.`);
  }
  const scopes = options.scopes?.length ? options.scopes : ['read', 'write'];
  const writePaths = options.writePaths ?? [];
  const label = options.label ?? `${options.name} (issued by ${options.machine ?? 'unknown'})`;
  const key = await createKey(undefined, label, [drive], scopes, writePaths, options.name);
  if (!key.token) throw new Error('The service did not return a token.');
  const bundle = buildBundle(
    {
      apiUrl,
      apiKey: key.token,
      driveKeys: { [drive]: driveKey },
      // resolveDriveKey only returns a saved key for this origin; explicit environment and
      // key-file values are intentionally unbound until issued into this bundle.
      driveKeyOrigins: { [drive]: new URL(apiUrl).origin },
    },
    [drive],
  );
  const line = `AGENT_DRIVE_CREDENTIALS=${bundle}`;
  if (options.to) {
    try {
      await writeBundleFile(options.to, line, options.force);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unable to write the file.';
      throw new Error(
        `${reason} The agent '${options.name}' and its API key were already created; the key was not saved. Revoke it in the console, or retry with a new --name.`,
      );
    }
  } else await io.write(`${line}\n`);
  return { agentName: options.name, keyId: key.id, scopes, writePaths };
}

/**
 * Writes a bundle to a 0600 file (recorded as a backup) or to a non-TTY stdout. A stdout export
 * is not recorded: pipe it to a secret store, then run `agent-drive credentials confirm`.
 */
export async function exportCredentials(
  options: {
    to?: string;
    force?: boolean;
    stdout?: boolean;
    vault?: string;
    keepClipboard?: boolean;
  },
  io: Io,
  deps: TargetDeps = realTargetDeps,
) {
  const target = parseTarget(options.to);
  if (Boolean(options.to) === Boolean(options.stdout))
    throw new Error(
      'Pass exactly one target: --to 1password, --to clipboard, --to <path>, or --stdout (`agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm`). --to 1password is the simplest if you use 1Password.',
    );
  if (options.stdout && io.isTTY)
    throw new Error(
      'Refusing to print credentials to a terminal. Pipe them to a secret store: `agent-drive credentials export --stdout | <your secret store> && agent-drive credentials confirm`, or use --to <path>.',
    );
  const config = await loadConfig();
  const apiKey = process.env.AGENT_DRIVE_API_KEY || config.apiKey;
  if (!apiKey) throw new Error('There is no API key to back up. Run `agent-drive login` first.');
  const driveKeys = config.driveKeys ?? {};
  const ids = Object.keys(driveKeys);
  if (!ids.length)
    throw new Error(
      'No drive keys are saved on this machine to export. A key provided only through AGENT_DRIVE_KEY or AGENT_DRIVE_CREDENTIALS is not included; make sure you have a durable copy of it. Otherwise run `agent-drive login`.',
    );
  const apiUrl = process.env.AGENT_DRIVE_API_URL || config.apiUrl || DEFAULT_API_URL;
  const bundle = buildBundle({
    apiUrl,
    apiKey,
    driveKeys,
    driveKeyOrigins: config.driveKeyOrigins ?? {},
  });
  const done = <M extends 'file' | 'stdout'>(method: M) => ({
    method,
    target: undefined,
    clearing: undefined,
    driveIds: ids,
    apiUrl,
    apiKey,
  });
  if (target === '1password') {
    await exportTo1Password(bundle, `Agent Drive – ${ids.join(', ')}`, options.vault, deps);
    const at = new Date().toISOString();
    await writeConfig({
      keyBackup: Object.fromEntries(ids.map((id) => [id, { at, method: 'stdout' }])),
    });
    return { ...done('stdout'), target };
  }
  if (target === 'clipboard') {
    // The clear timer starts at once and stays alive if the config write fails.
    const clearing = await copyToClipboard(bundle, Boolean(options.keepClipboard), deps);
    try {
      // Not a backup yet: `credentials confirm` records it after the user saved it.
      await writeConfig({ pendingExport: pendingFor(apiKey, ids) });
    } catch (error) {
      await clearing;
      throw error;
    }
    return { ...done('stdout'), target, clearing };
  }
  if (options.to) {
    await writeBundleFile(options.to, bundle, options.force);
    const at = new Date().toISOString();
    await writeConfig({
      keyBackup: Object.fromEntries(ids.map((id) => [id, { at, method: 'file' }])),
    });
    return done('file');
  }
  await io.write(`${bundle}\n`);
  await writeConfig({ pendingExport: pendingFor(apiKey, ids) });
  return done('stdout');
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

export const REPORT_CONCURRENCY = 4;

/**
 * Tells the service a key was backed up (never the key). Reports run a few at a time under one
 * shared 5s deadline, so a bundle of many drives cannot hold the calling command for a round
 * trip per drive. A failure is only a warning.
 */
export async function reportKeyBackup(
  apiUrl: string,
  apiKey: string,
  driveIds: string[],
  method: 'file' | 'stdout' | 'env',
  deps: { fetch?: typeof fetch; warn?: (message: string) => void } = {},
) {
  if (!driveIds.length) return;
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const warn = deps.warn ?? ((m: string) => process.stderr.write(`${m}\n`));
  const deadline = AbortSignal.timeout(5000);
  let next = 0;
  const worker = async () => {
    while (next < driveIds.length) {
      const id = driveIds[next++]!;
      try {
        if (deadline.aborted) throw new Error('deadline');
        // Same HTTPS/loopback rule as the client, checked before the token is attached.
        const base = validateUrl(apiUrl, true).toString().replace(/\/+$/u, '');
        const response = await doFetch(`${base}/v1/drives/${encodeURIComponent(id)}/key-backup`, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ method }),
          signal: deadline,
        });
        // 403: a read-only key may not report (the endpoint needs write). Expected, so no warning.
        if (response.status === 403) continue;
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        warn(`Warning: could not report the key backup for drive ${id} to Agent Drive.`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REPORT_CONCURRENCY, driveIds.length) }, worker));
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
  const origin = originOf(apiUrl);
  const effectiveConfig = await loadConfig(apiUrl);
  const ids: string[] = [];
  for (const [id, key] of Object.entries(bundle.driveKeys))
    if (
      effectiveConfig.driveKeyOrigins?.[id] === origin &&
      effectiveConfig.driveKeys?.[id] === key &&
      (await resolveDriveKey(id, apiUrl, undefined, effectiveConfig)) === key
    )
      ids.push(id);
  await reportKeyBackup(apiUrl, apiKey, ids, 'env', deps);
}

import { spawn } from 'node:child_process';
import { validateUrl, type AgentDriveClient } from './client.js';
import {
  configPath,
  isValidDriveKey,
  keysForOrigin,
  machineName,
  readConfig,
  writeConfig,
} from './config.js';
import { BACKUP_HINT } from './credentials.js';
import { generateDriveKey } from './crypto.js';
import {
  generateDeviceKeyPair,
  sealDriveKey,
  unsealDriveKey,
  type SealedDriveKey,
} from './seal.js';

type TokenResponse = {
  access_token: string;
  scope?: string;
  write_paths?: string[];
  api_url?: string;
  agent_name?: string;
  drive_ids?: string[];
  new_drive_id?: string | null;
  sealed_drive_keys?: Record<string, SealedDriveKey>;
};

export type DeviceLoginOptions = {
  apiUrl: string;
  name: string;
  machine: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log: (line: string) => void;
  openBrowser: boolean;
};

export function defaultAgentName() {
  return `${machineName().slice(0, 64 - ' agent'.length)} agent`;
}

function sameOrigin(a: string | undefined, b: string) {
  try {
    return a !== undefined && new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function openUrl(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command as string, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
}

export function shouldOpenBrowser(noBrowser: boolean | undefined) {
  return !noBrowser && Boolean(process.stdout.isTTY) && !process.env.CI;
}

export async function deviceLogin(options: DeviceLoginOptions) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  // Same transport policy as the API client: HTTPS, or exact loopback HTTP.
  validateUrl(options.apiUrl, true);
  const base = options.apiUrl.replace(/\/+$/u, '');
  const post = async (path: string, body: Record<string, unknown>, bearer?: string) => {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new NetworkError();
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  };

  // The saved API key and drive keys are only trusted for the origin they were saved for.
  const origin = new URL(base).origin;
  const saved = await readConfig();
  const savedKeys = sameOrigin(saved.apiUrl, base) ? keysForOrigin(saved, origin) : {};
  const previousKey = sameOrigin(saved.apiUrl, base) ? saved.apiKey : undefined;
  const knownDriveIds = Object.keys(savedKeys).slice(0, 20);
  const { privateKey, publicKey } = await generateDeviceKeyPair();
  let started;
  try {
    started = await post(
      '/oauth/device_authorization',
      {
        client_name: options.name,
        machine: options.machine,
        public_key: publicKey,
        ...(knownDriveIds.length ? { known_drive_ids: knownDriveIds } : {}),
      },
      previousKey,
    );
  } catch {
    throw new Error(`Could not reach Agent Drive at ${base}. Check the network and try again.`);
  }
  if (!started.ok) {
    const description = started.data.error_description ?? started.data.error ?? started.status;
    throw new Error(`Agent Drive refused the login request: ${String(description)}`);
  }
  const grant = started.data as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  const link = grant.verification_uri_complete ?? grant.verification_uri;
  options.log(`Open this link to approve: ${link}`);
  options.log(`Check that the code matches: ${grant.user_code}`);
  options.log('Waiting for approval...');
  if (options.openBrowser) openUrl(link);

  let interval = grant.interval ?? 5;
  let elapsed = 0;
  let failures = 0;
  let token: TokenResponse | undefined;
  while (!token) {
    if (elapsed + interval > grant.expires_in) throw expired();
    await sleep(interval * 1000);
    elapsed += interval;
    let result;
    try {
      result = await post('/oauth/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: grant.device_code,
      });
      failures = 0;
    } catch {
      if (++failures >= 5)
        throw new Error(
          `Lost contact with Agent Drive at ${base}. Run \`agent-drive login\` again.`,
        );
      continue;
    }
    if (result.ok) {
      token = result.data as unknown as TokenResponse;
      continue;
    }
    const code = result.data.error;
    if (code === 'authorization_pending') continue;
    if (code === 'slow_down') interval += 5;
    else if (code === 'access_denied')
      throw new Error('Approval was denied. No access was granted.');
    else if (code === 'expired_token') throw expired();
    else
      throw new Error(
        `Login failed: ${String(code ?? result.status)}. Run \`agent-drive login\` again.`,
      );
  }

  const driveKeys: Record<string, string> = {};
  const unsealed: string[] = [];
  const noKey: string[] = [];
  for (const driveId of token.drive_ids ?? []) {
    // The new drive's key is generated below, so it is never "missing".
    if (driveId === token.new_drive_id) continue;
    const sealed = token.sealed_drive_keys?.[driveId];
    if (!sealed) {
      if (savedKeys[driveId]) continue;
      noKey.push(driveId);
      continue;
    }
    try {
      const key = await unsealDriveKey(privateKey, driveId, sealed);
      if (!isValidDriveKey(key)) throw new Error('Invalid key.');
      driveKeys[driveId] = key;
      unsealed.push(driveId);
    } catch {
      options.log(`Could not unseal the key for drive ${driveId}; it is not saved.`);
      noKey.push(driveId);
    }
  }
  if (token.api_url && token.api_url.replace(/\/+$/u, '') !== base)
    options.log('Ignored a different API URL returned by the server.');
  if (token.new_drive_id) driveKeys[token.new_drive_id] = generateDriveKey();
  const { backupsCleared } = await writeConfig({
    apiUrl: base,
    apiKey: token.access_token,
    driveKeys,
    driveKeyOrigins: Object.fromEntries(Object.keys(driveKeys).map((id) => [id, origin])),
  });

  if (backupsCleared)
    options.log(
      'The API key changed, so earlier credential backups are out of date. Run `agent-drive credentials export` again.',
    );
  const usable = [
    ...new Set(
      [...(token.drive_ids ?? []), ...(token.new_drive_id ? [token.new_drive_id] : [])].filter(
        (id) => driveKeys[id] || savedKeys[id],
      ),
    ),
  ];
  if (!usable.length)
    throw new Error(
      `Login finished but this agent has no usable drive key. Run \`agent-drive login\` again; the owner's approval will create a drive for this agent. (The login was saved to ${configPath()}.)`,
    );
  options.log(`Logged in as agent ${token.agent_name ?? options.name}.`);
  options.log(`Usable drives: ${usable.join(', ')}`);
  options.log(`Scopes: ${token.scope ?? ''}`);
  if (token.write_paths?.length) options.log(`Writes limited to: ${token.write_paths.join(', ')}`);
  options.log(`Config: ${configPath()}`);
  if (token.new_drive_id) {
    options.log(`New drive ${token.new_drive_id} created; its key is saved in the config file.`);
    options.log(BACKUP_HINT);
  }
  if (noKey.length)
    options.log(
      `No usable key for: ${noKey.join(', ')}. You can list names but not read contents.`,
    );
  return { unsealed, noKey, usable, newDriveId: token.new_drive_id ?? null };
}

class NetworkError extends Error {}

function expired() {
  return new Error('The login code expired. Run `agent-drive login` again.');
}

/**
 * An agent that holds a drive seals its drive key to a pending login and offers it. The human
 * still approves on /connect. Prints the request facts and the approval URL, never a key.
 */
export async function grantLogin(options: {
  code: string;
  drive?: string;
  readOnly?: boolean;
  scopes?: string[];
  writePaths?: string[];
  client: AgentDriveClient;
  driveKeys: Record<string, string>;
  log: (line: string) => void;
}) {
  const { client } = options;
  const ids = Object.keys(options.driveKeys);
  const drive = options.drive ?? (ids.length === 1 ? ids[0] : undefined);
  if (!drive) throw new Error('Pass --drive <id>; this machine holds no single default drive key.');
  const driveKey = options.driveKeys[drive];
  if (!driveKey) throw new Error(`There is no drive key for ${drive} on this machine.`);
  const code = options.code.toUpperCase();
  const who = await client.whoami();
  const scopes = options.scopes?.length
    ? options.scopes
    : options.readOnly
      ? ['read']
      : ['read', 'write'];
  if (!options.scopes?.length && !scopes.every((scope) => who.scopes.includes(scope)))
    throw new Error(
      `This key does not hold ${scopes.join(' and ')}; pass --scope for what it may grant.`,
    );
  const writePaths = options.writePaths?.length ? options.writePaths : (who.writePaths ?? []);
  const request = await client.deviceRequest(code);
  options.log(
    `Request from ${request.client_name}${request.machine ? ` on ${request.machine}` : ''}, made ${request.created_at}.`,
  );
  const sealedDriveKey = await sealDriveKey(request.public_key, drive, driveKey);
  await client.grantDevice(code, { driveId: drive, scopes, writePaths, sealedDriveKey });
  options.log(
    `Offered drive ${drive} to ${request.client_name} (${scopes.join(' ')}; ${
      writePaths.length ? `writes under ${writePaths.join(', ')}` : 'writes anywhere in the drive'
    }). The owner approves at ${client.apiOrigin}/connect?code=${code}.`,
  );
}

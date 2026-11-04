import { randomBytes } from 'node:crypto';
import { DriveCryptoError } from './crypto.js';
import { AgentDriveApiError, type AgentDriveClient } from './client.js';

export const SCOPE_HINT =
  'Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope.';

/** Lines to print on stderr for an API error. */
export function apiErrorLines(error: AgentDriveApiError) {
  return [
    error.message,
    error.code === 'permission_denied' ? SCOPE_HINT : '',
    error.upgradeUrl ? `Upgrade: ${error.upgradeUrl}` : '',
    error.retryAfter === undefined ? '' : `Retry after: ${error.retryAfter} seconds`,
  ].filter(Boolean);
}

export function createdDriveNote(configPath: string) {
  return `Drive key saved to ${configPath}; back it up.`;
}

/** `{ driveId: hasKey }`; whoami returns null driveIds for manage keys, so there is nothing to map. */
export async function localKeyMap(
  driveIds: string[] | null,
  resolve: (driveId: string) => Promise<string | undefined>,
) {
  const result: Record<string, boolean> = {};
  for (const id of driveIds ?? []) result[id] = Boolean(await resolve(id));
  return result;
}

export function pickCheckDrive(
  explicit: string | undefined,
  candidates: string[],
  hasKey: Record<string, boolean>,
) {
  if (explicit) {
    if (!hasKey[explicit])
      throw new Error(`There is no key for drive ${explicit} on this machine.`);
    return explicit;
  }
  const usable = candidates.filter((id) => hasKey[id]);
  if (!usable.length)
    throw new Error('There is no usable drive key on this machine. Run `agent-drive login` again.');
  if (usable.length > 1) throw new Error('More than one usable drive. Pass --drive ID.');
  return usable[0] as string;
}

export async function runCheck(
  client: Pick<AgentDriveClient, 'put' | 'get' | 'list'>,
  driveId: string,
) {
  const payload = randomBytes(16);
  const path = '/.agent-drive/check.txt';
  // A wrong key would still pass the round trip below, so first prove it opens an existing file.
  const existing = (await client.list(driveId)).items.filter((item) => item.path !== path);
  const newest = existing.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (newest) {
    try {
      await client.get(driveId, newest.path);
    } catch (error) {
      if (error instanceof DriveCryptoError)
        throw new Error('This drive key cannot decrypt existing files.');
      throw error;
    }
  }
  await client.put(driveId, path, payload, { mode: 'overwrite' });
  const back = await client.get(driveId, path);
  if (!Buffer.from(back.bytes).equals(payload))
    throw new Error(
      `Check failed: the bytes read back from drive ${driveId} do not match (mismatch).`,
    );
  return `check ok drive=${driveId}`;
}

import { randomBytes } from 'node:crypto';
import { driveKeyEnvironmentName } from './config.js';
import { BACKUP_HINT } from './credentials.js';
import { DriveCryptoError } from './crypto.js';
import { AgentDriveApiError, type AgentDriveClient } from './client.js';

export const SCOPE_HINT =
  'Run `agent-drive login` again to reconnect, or ask the owner for a key with that scope.';

const DELEGATE_HINT =
  'Run `agent-drive login` again; on the approval page, tick "Let this agent add other agents to its drives" (under "Optional") before approving.';

/** What a conflict loser should do next; shared by the CLI and the MCP `hint`. */
export function conflictHint(error: AgentDriveApiError) {
  if (error.code !== 'conflict') return undefined;
  if (error.state === 'trashed')
    return 'The file is in the trash: restore it with "restore <path>" or write with --overwrite.';
  if (error.state === 'absent')
    return 'There is no file at this path now; write it without --if-version.';
  if ((error.state === 'exists' || error.state === 'changed') && error.currentVersionId)
    return `Current version: ${error.currentVersionId}. Read the file again, merge your change, then retry with --if-version ${error.currentVersionId}.`;
  return undefined;
}

/** Lines to print on stderr for an API error. */
export function apiErrorLines(error: AgentDriveApiError) {
  return [
    error.message,
    conflictHint(error) ?? '',
    error.code === 'permission_denied' && /scope/iu.test(error.message)
      ? /delegate"? scope/iu.test(error.message)
        ? DELEGATE_HINT
        : SCOPE_HINT
      : '',
    error.upgradeUrl ? `Upgrade: ${error.upgradeUrl}` : '',
    error.retryAfter === undefined ? '' : `Retry after: ${error.retryAfter} seconds`,
  ].filter(Boolean);
}

export function notBackedUpMessage(driveIds: string[]) {
  return `drive key not backed up: ${driveIds.join(', ')}\n${BACKUP_HINT}`;
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

const CHECK_FILE = '/.agent-drive/check.txt';

/** Read-only keys cannot write a check file, so prove the drive key opens an existing live file. */
async function readOnlyCheck(client: Pick<AgentDriveClient, 'get' | 'list'>, driveId: string) {
  let cursor: string | undefined;
  do {
    const page = await client.list(driveId, undefined, 50, cursor);
    for (const file of page.items) {
      if (file.path.endsWith(CHECK_FILE)) continue;
      try {
        await client.get(driveId, file.path);
        return `check ok drive=${driveId} (read-only)`;
      } catch (error) {
        if (error instanceof DriveCryptoError)
          throw new Error('This drive key cannot decrypt existing files.');
        // Deleted or moved between list and get: try the next file.
        if (!(error instanceof AgentDriveApiError && error.status === 404)) throw error;
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  throw new Error(
    `check not verified drive=${driveId}: this read-only key has nothing to decrypt yet; run check again after another agent writes a file.`,
  );
}

export async function runCheck(
  client: Pick<AgentDriveClient, 'put' | 'get' | 'recent' | 'list'>,
  driveId: string,
  access: { scopes: string[]; writePaths: string[] } = { scopes: ['write'], writePaths: [] },
) {
  if (!access.scopes.includes('write')) return readOnlyCheck(client, driveId);
  const payload = randomBytes(16);
  const path = `${access.writePaths[0] ?? ''}${CHECK_FILE}`;
  // A wrong key would still pass the round trip below, so first prove it opens an existing file:
  // the newest one by the recent feed (newest first), not the first page of the path-ordered list.
  const events = (await client.recent(driveId, undefined, 50)).items;
  const newest = events.find(
    (event) =>
      !event.path.endsWith(CHECK_FILE) && ['put', 'copy', 'restore'].includes(event.operation),
  );
  if (newest) {
    try {
      await client.get(driveId, newest.path);
    } catch (error) {
      if (error instanceof DriveCryptoError)
        throw new Error('This drive key cannot decrypt existing files.');
      // ponytail: a file deleted or moved since is skipped, not retried with the next newest.
      if (!(error instanceof AgentDriveApiError && error.status === 404)) throw error;
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

/** Drives that must be backed up before check passes. Env keys and --key-file (for the checked drive only) live outside the config. */
export function backupCandidates(
  keys: Record<string, boolean>,
  driveId: string,
  keyFile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  return Object.keys(keys).filter(
    (id) =>
      keys[id] &&
      !env[driveKeyEnvironmentName(id)] &&
      !env.AGENT_DRIVE_KEY &&
      !(keyFile && id === driveId),
  );
}

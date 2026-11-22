// Auto-seals held drive keys to the owner's account public key (docs/keys-and-recovery.md). The
// console's passphrase unlock then opens every sealed drive with no recovery file. Everything here
// is best-effort for the calling command: failures surface as one warning, never a thrown error.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentDriveClient } from './client.js';
import {
  configPath,
  DEFAULT_API_URL,
  keysForOrigin,
  writeConfig,
  type AgentDriveConfig,
} from './config.js';
import { sealDriveKey } from './seal.js';

export const SEAL_THROTTLE_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_SEAL_SALT = 'agent-drive-account-v1';
const NO_ACCOUNT_KEY_WARNING =
  'Your account has no account key yet, so the console cannot open this drive. ' +
  'Set a passphrase in the console under Settings; agents will add the drive then.';

export type SealStatus = 'sealed' | 'already sealed' | 'agent-only' | 'no account key';
export type SealTarget = { driveId: string; driveKey: string; agentOnly?: boolean };

/** The same fingerprint the console prints on Settings: SHA-256(raw key), first 8 bytes, grouped. */
export function accountKeyFingerprint(publicKey: string): string {
  const hex = createHash('sha256')
    .update(Buffer.from(publicKey, 'base64url'))
    .digest('hex')
    .slice(0, 16);
  return hex.match(/.{4}/g)!.join(' ');
}

export class AccountKeyPinMismatch extends Error {
  constructor(expected: string, actual: string) {
    super(
      `The account public key changed (pinned fingerprint ${expected}, server returned ${actual}). ` +
        'If the owner reset the passphrase in the console, run `agent-drive account seal --repin` to pin the new key.',
    );
    this.name = 'AccountKeyPinMismatch';
  }
}

type SealState = Record<string, string>;

const statePath = () => join(dirname(configPath()), '.state', 'account-seal.json');

async function readSealState(): Promise<SealState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SealState;
  } catch {
    return {};
  }
}

async function writeSealState(state: SealState) {
  const path = statePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function recentlyChecked(state: SealState, driveId: string, now: number) {
  const at = Date.parse(state[driveId] ?? '');
  return Number.isFinite(at) && now - at < SEAL_THROTTLE_MS;
}

/**
 * Seals every held key in `targets` to the account public key. Returns one status per drive
 * attempted; drives skipped by the 24h throttle are absent from the map. Throws
 * AccountKeyPinMismatch when the pinned fingerprint does not match and `repin` is false.
 */
export async function sealDrivesToAccount(opts: {
  client: AgentDriveClient;
  config: AgentDriveConfig;
  targets: SealTarget[];
  /** Bypass the 24h throttle (`account seal`, drive create/login/import/mcp). */
  force?: boolean;
  /** Accept a changed account public key (`account seal --repin`). */
  repin?: boolean;
}): Promise<Map<string, SealStatus>> {
  const { client, config, targets } = opts;
  const result = new Map<string, SealStatus>();
  const key = await client.accountKey();
  if (!key || key.format !== 1) {
    for (const target of targets)
      result.set(target.driveId, target.agentOnly ? 'agent-only' : 'no account key');
    return result;
  }
  const origin = new URL(config.apiUrl ?? DEFAULT_API_URL).origin;
  const fingerprint = accountKeyFingerprint(key.publicKey);
  const pinned = config.accountKeyPins?.[origin];
  if (pinned && pinned !== fingerprint && !opts.repin)
    throw new AccountKeyPinMismatch(pinned, fingerprint);
  if (pinned !== fingerprint)
    await writeConfig({
      ...config,
      accountKeyPins: { ...config.accountKeyPins, [origin]: fingerprint },
    });

  const state = await readSealState();
  const now = Date.now();
  let dirty = false;
  for (const target of targets) {
    if (target.agentOnly) {
      result.set(target.driveId, 'agent-only');
      continue;
    }
    if (!opts.force && recentlyChecked(state, target.driveId, now)) continue;
    const sealed = await sealDriveKey(key.publicKey, target.driveId, target.driveKey, {
      salt: ACCOUNT_SEAL_SALT,
      label: `${key.keyId}:${target.driveId}`,
    });
    const uploaded = await client.addAccountKeySlot(target.driveId, {
      keyId: key.keyId,
      sealed,
    });
    result.set(target.driveId, uploaded.status === 'created' ? 'sealed' : 'already sealed');
    state[target.driveId] = new Date(now).toISOString();
    dirty = true;
  }
  if (dirty) await writeSealState(state);
  return result;
}

/** Drive keys this machine holds for the config's API origin, optionally narrowed to `driveIds`. */
export function heldSealTargets(
  config: AgentDriveConfig,
  drives: { id: string; agentOnly?: boolean }[],
  driveIds?: string[],
): SealTarget[] {
  const held = keysForOrigin(config, new URL(config.apiUrl ?? DEFAULT_API_URL).origin);
  const wanted = driveIds ? new Set(driveIds) : undefined;
  const agentOnly = new Map(drives.map((drive) => [drive.id, drive.agentOnly === true]));
  return Object.entries(held)
    .filter(([driveId]) => !wanted || wanted.has(driveId))
    .map(([driveId, driveKey]) => ({
      driveId,
      driveKey,
      agentOnly: agentOnly.get(driveId) ?? false,
    }));
}

export { NO_ACCOUNT_KEY_WARNING };

/**
 * Best-effort seal for held keys, called after commands that put or use drive keys on this
 * machine. `force` seals regardless of the throttle (create/login/import/mcp); otherwise drives
 * checked in the last 24h are skipped before any network call. Errors become one `warn` line.
 */
export async function autoSealHeldKeys(opts: {
  client: AgentDriveClient;
  config: AgentDriveConfig;
  driveIds?: string[];
  force?: boolean;
  warn: (line: string) => void;
}) {
  try {
    const held = Object.keys(
      keysForOrigin(opts.config, new URL(opts.config.apiUrl ?? DEFAULT_API_URL).origin),
    );
    let wanted = opts.driveIds ? held.filter((id) => opts.driveIds!.includes(id)) : held;
    if (!wanted.length) return;
    if (!opts.force) {
      const state = await readSealState();
      const now = Date.now();
      wanted = wanted.filter((id) => !recentlyChecked(state, id, now));
      if (!wanted.length) return;
    }
    const drives: { id: string; agentOnly?: boolean }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await opts.client.listDrives(undefined, cursor);
      drives.push(...(res.items ?? []));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    // Bulk auto-seal only touches drives the server still lists; a slot POST for a deleted
    // drive would 404 into a warning every day. Explicit --drive targets stay trusted even
    // when the listing missed them.
    const listed = new Set(drives.map((drive) => drive.id));
    if (!opts.driveIds) wanted = wanted.filter((id) => listed.has(id));
    const targets = heldSealTargets(opts.config, drives, wanted);
    if (!targets.length) return;
    const result = await sealDrivesToAccount({
      client: opts.client,
      config: opts.config,
      targets,
      force: true,
    });
    // Only the named events (create/login/import/mcp) warn: an account with no key would
    // otherwise print the same line on every throttled command.
    if (opts.force && [...result.values()].some((status) => status === 'no account key'))
      opts.warn(NO_ACCOUNT_KEY_WARNING);
  } catch (error) {
    opts.warn(
      `Drive key sealing skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

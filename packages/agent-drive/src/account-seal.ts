// Auto-seals held drive keys to the owner's account public key (docs/keys-and-recovery.md). The
// console's passphrase unlock then opens every sealed drive with no recovery file. Everything here
// is best-effort for the calling command: failures surface as one warning, never a thrown error.
//
// Private state (pins, throttle timestamps, agent-only drive ids) lives in `<config>.state/`,
// the same per-config directory backup.ts and capture.ts use, guarded by
// ensurePrivateStateDirectory — never in config.json, so an AGENT_DRIVE_CREDENTIALS bundle's
// secrets are never persisted and a sibling config's state can never be shared or redirected.

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentDriveApiError, AgentDriveClient } from './client.js';
import {
  configPath,
  driveKeyEnvironmentName,
  keysForOrigin,
  type AgentDriveConfig,
} from './config.js';
import { sealDriveKey } from './seal.js';
import { ensurePrivateStateDirectory } from './sync.js';
import { normalizeVerificationCode } from './verification.js';

export const SEAL_THROTTLE_MS = 24 * 60 * 60 * 1000;
/** Background (automatic) sealing must never hold a command; the whole attempt gets this budget. */
export const SEAL_DEADLINE_MS = 5_000;
const ACCOUNT_SEAL_SALT = 'agent-drive-account-v1';
const NO_ACCOUNT_KEY_WARNING =
  'Your account has no account key yet, so the console cannot open this drive. ' +
  'Set a passphrase in the console under Settings; agents will add the drive then.';
const UNREADABLE_PIN_FILE =
  'The account-key pin file is unreadable, so sealing is refused. Confirm the account key ' +
  'fingerprint in the console, then repair the file with `agent-drive account seal --repin --fingerprint <fingerprint>`.';
export const UNKNOWN_TYPE_HINT =
  "unknown drive type: run 'agent-drive account seal --drive ID' with a key that can read drives";
export const UNVERIFIED_HINT =
  'The account key has not been verified on this machine. Copy its fingerprint from the console ' +
  '(Settings) and run `agent-drive account seal --fingerprint "<the fingerprint>"`.' +
  ' Sealing stays off until then.';
export const PIN_REQUIRED_HINT =
  'Copy the account-key fingerprint shown in the console (Settings) and pass --fingerprint.';

export type SealStatus =
  | 'sealed'
  | 'already sealed'
  | 'agent-only'
  | 'no account key'
  | 'failed'
  | 'wrong origin'
  | 'unknown type'
  | 'unverified';
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
        'If the owner reset the passphrase in the console, verify its Settings fingerprint and run `agent-drive account seal --repin --fingerprint <fingerprint>` to pin the new key.',
    );
    this.name = 'AccountKeyPinMismatch';
  }
}

export class AccountSealStateUnreadable extends Error {
  constructor() {
    super(UNREADABLE_PIN_FILE);
    this.name = 'AccountSealStateUnreadable';
  }
}

/** The human-supplied fingerprint does not match the account key the service returned. */
export class AccountKeyFingerprintMismatch extends Error {
  constructor(expected: string, actual: string) {
    super(
      `The supplied fingerprint (${expected}) does not match the account key the service returned (${actual}). ` +
        'Check the fingerprint in the console under Settings; if it is right, the API may be answering with a different account key.',
    );
    this.name = 'AccountKeyFingerprintMismatch';
  }
}

/** A pin change without an independently sourced fingerprint; callers must fail closed. */
export class AccountSealPinRequired extends Error {
  constructor() {
    super(
      `Establishing or replacing the account-key pin needs a verified fingerprint. ${PIN_REQUIRED_HINT}`,
    );
    this.name = 'AccountSealPinRequired';
  }
}

/**
 * A fingerprint the human carried to the agent outside the API: `--fingerprint`, the
 * AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT environment variable, or nothing. Returns the canonical
 * "xxxx xxxx xxxx xxxx" form, or undefined — a malformed value behaves as "no fingerprint",
 * which fails closed rather than silently pinning whatever the API returns.
 */
export function expectedAccountFingerprint(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeVerificationCode(value);
}

type SealState = {
  /** Account public key fingerprint pinned per effective API origin. */
  pins: Record<string, string>;
  /** Pins verified against a fingerprint supplied outside the API, per API origin. */
  verifiedPins: Record<string, string>;
  /** `${origin}\n${driveId}` -> ISO time of the last seal check (any outcome). */
  checked: Record<string, string>;
  /** `${origin}\n${driveId}` recorded agent-only at creation or learned from a slot rejection. */
  agentOnly: string[];
  /** `${origin}\n${driveName}`: a `--agent-only` create intent pending its drive id. */
  pendingAgentOnly: string[];
};

export function accountSealStatePath() {
  return join(`${configPath()}.state`, 'account-seal.json');
}

function emptyState(): SealState {
  return { pins: {}, verifiedPins: {}, checked: {}, agentOnly: [], pendingAgentOnly: [] };
}

/** Marks are origin-scoped: cloned APIs sharing a drive id must not share outcomes. */
const scoped = (origin: string, id: string) => `${origin}\n${id}`;

const isStringMap = (value: unknown): value is Record<string, string> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value as object).every((item) => typeof item === 'string');

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The exact shape accountKeyFingerprint produces: 'a1b2 c3d4 e5f6 7890'. */
const isFingerprint = (value: string) => /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/u.test(value);

type SealStateRead =
  | { kind: 'missing' }
  | { kind: 'ok'; state: SealState }
  | { kind: 'unreadable' };

/**
 * Reads the pin/state file, refusing a symlink outright (O_NOFOLLOW). Distinguishes "no file
 * yet" from "exists but unusable": a truncated write, an invalid `pins`, or a symlink all make
 * the file 'unreadable' so callers fail closed instead of resetting pin protection.
 */
async function readSealStateFile(): Promise<SealStateRead> {
  let serialized: string;
  try {
    const handle = await open(
      accountSealStatePath(),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      serialized = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isCode(error, 'ENOENT')) return { kind: 'missing' };
    return { kind: 'unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { kind: 'unreadable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'unreadable' };
  const record = parsed as Record<string, unknown>;
  // The first version of this file was a flat {driveId: timestamp} map.
  const legacy =
    record.pins === undefined &&
    record.checked === undefined &&
    record.agentOnly === undefined &&
    record.pendingAgentOnly === undefined &&
    record.verifiedPins === undefined;
  if (legacy && isStringMap(record))
    return { kind: 'ok', state: { ...emptyState(), checked: record } };
  // A current-format file is damaged when `pins` is absent or not a map, or any pin is not a
  // real fingerprint: an empty or hand-edited value is corruption, not "no pin". Fail closed.
  if (
    !isStringMap(record.pins) ||
    Object.values(record.pins).some((pin) => !isFingerprint(pin)) ||
    (record.verifiedPins !== undefined &&
      (!isStringMap(record.verifiedPins) ||
        Object.values(record.verifiedPins).some((pin) => !isFingerprint(pin)))) ||
    (record.checked !== undefined && !isStringMap(record.checked)) ||
    (record.agentOnly !== undefined && !isStringList(record.agentOnly)) ||
    (record.pendingAgentOnly !== undefined && !isStringList(record.pendingAgentOnly))
  )
    return { kind: 'unreadable' };
  return {
    kind: 'ok',
    state: {
      pins: record.pins,
      verifiedPins: (record.verifiedPins as Record<string, string> | undefined) ?? {},
      checked: (record.checked as Record<string, string> | undefined) ?? {},
      agentOnly: (record.agentOnly as string[] | undefined) ?? [],
      pendingAgentOnly: (record.pendingAgentOnly as string[] | undefined) ?? [],
    },
  };
}

/**
 * Atomic write: a unique temp file in the same private directory, fsynced, then renamed over
 * `account-seal.json` — an interrupted write can never leave a half-written pin file, and a
 * symlink at the target path is replaced rather than followed.
 */
async function writeSealState(state: SealState) {
  const directory = `${configPath()}.state`;
  await ensurePrivateStateDirectory(directory);
  const path = accountSealStatePath();
  const temporary = join(directory, `account-seal.json.${process.pid}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Reads then writes the seal state under an advisory lock, so a second process compares (and
 * merges) against what the first one committed. `update` mutates the fresh state and reports
 * whether it changed; a throw still releases the lock. An unreadable file throws
 * AccountSealStateUnreadable unless `replaceIfUnreadable` (--repin repairing the pin), in
 * which case the state starts empty and `onReset` fires once — every other origin's pin is
 * gone and the caller must say so. The lock wait is unref'd and bounded by `timeoutAt` (the
 * automatic path's overall 5s budget).
 */
async function withSealState(
  update: (state: SealState) => { changed: boolean } | Promise<{ changed: boolean }>,
  opts: {
    replaceIfUnreadable?: boolean;
    timeoutAt?: number | undefined;
    onReset?: () => void;
  } = {},
): Promise<void> {
  const directory = `${configPath()}.state`;
  await ensurePrivateStateDirectory(directory);
  const lockPath = join(directory, 'account-seal.lock');
  const timeoutAt = opts.timeoutAt ?? Date.now() + 10_000;
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        throw new Error(`Unable to acquire the account-seal state lock at ${lockPath}.`);
      }
      if (Date.now() >= timeoutAt) {
        throw new Error(
          `Timed out waiting for the account-seal state lock at ${lockPath}. If no Agent Drive command is running, remove the stale lock directory manually.`,
        );
      }
      await new Promise((resolveDelay) => {
        const timer = setTimeout(resolveDelay, 50);
        timer.unref();
      });
    }
  }
  try {
    const read = await readSealStateFile();
    let state: SealState;
    if (read.kind === 'unreadable') {
      if (!opts.replaceIfUnreadable) throw new AccountSealStateUnreadable();
      state = emptyState();
      opts.onReset?.();
    } else {
      state = read.kind === 'ok' ? read.state : emptyState();
    }
    if ((await update(state)).changed) await writeSealState(state);
  } finally {
    try {
      await rmdir(lockPath);
    } catch (error) {
      if (!isCode(error, 'ENOENT')) {
        throw new Error(`Unable to release the account-seal state lock at ${lockPath}.`);
      }
    }
  }
}

/** Remembers a drive as agent-only locally, so later seals skip it regardless of the listing. */
export async function recordAgentOnlyDrive(driveId: string, origin: string) {
  await withSealState((state) => {
    const mark = scoped(origin, driveId);
    if (state.agentOnly.includes(mark)) return { changed: false };
    state.agentOnly.push(mark);
    return { changed: true };
  });
}

/**
 * Records a `--agent-only` choice by drive NAME before the remote drive exists: if this write
 * fails the command must stop so a state failure never strands a remote drive. Once creation
 * returns an id, recordAgentOnlyDrive takes over and clearAgentOnlyIntent retires the intent.
 */
export async function recordAgentOnlyIntent(name: string, origin: string) {
  const mark = scoped(origin, name);
  await withSealState((state) => {
    if (state.pendingAgentOnly.includes(mark)) return { changed: false };
    state.pendingAgentOnly.push(mark);
    return { changed: true };
  });
}

export async function clearAgentOnlyIntent(name: string, origin: string) {
  const mark = scoped(origin, name);
  await withSealState((state) => {
    const at = state.pendingAgentOnly.indexOf(mark);
    if (at < 0) return { changed: false };
    state.pendingAgentOnly.splice(at, 1);
    return { changed: true };
  });
}

/** Drive names with a pending --agent-only intent for `origin`; matched through a listing. */
export async function pendingAgentOnlyNames(origin: string) {
  const read = await readSealStateFile();
  const prefix = `${origin}\n`;
  if (read.kind !== 'ok') return new Set<string>();
  return new Set(
    read.state.pendingAgentOnly
      .filter((mark) => mark.startsWith(prefix))
      .map((mark) => mark.slice(prefix.length)),
  );
}

function recentlyChecked(
  checked: Record<string, string>,
  origin: string,
  driveId: string,
  now: number,
) {
  const at = Date.parse(checked[scoped(origin, driveId)] ?? '');
  return Number.isFinite(at) && now - at < SEAL_THROTTLE_MS;
}

/** The slot endpoint's rejection of an agent-only drive; the local list learns from it. */
function isAgentOnlyRejection(error: unknown) {
  return (
    error instanceof AgentDriveApiError &&
    error.code === 'conflict' &&
    error.message.includes('agent-only')
  );
}

/** One-line summary for automatic sealing; the explicit command prints a status per drive. */
function describeFailure(failed: string[], failures: Map<string, unknown>) {
  const first = failures.get(failed[0]!);
  const message = first instanceof Error ? first.message : String(first);
  return `Drive key sealing skipped for ${
    failed.length === 1 ? `drive ${failed[0]}` : `${failed.length} drives`
  }: ${message}`;
}

/**
 * Seals every held key in `targets` to the account public key, keyed by the client's effective
 * API origin. Returns one status per drive attempted; drives skipped by the 24h throttle are
 * absent from the map. A failing drive marks 'failed' and does not stop the rest. Throws
 * AccountKeyPinMismatch when the pinned fingerprint does not match and `repin` is false, and
 * AccountSealStateUnreadable when the pin file cannot be read (fail closed).
 */
export async function sealDrivesToAccount(opts: {
  client: AgentDriveClient;
  config: AgentDriveConfig;
  targets: SealTarget[];
  /** Bypass the 24h throttle (`account seal`, drive create/login/import/mcp). */
  force?: boolean;
  /** Accept a changed account public key (`account seal --repin --fingerprint`); also repairs an unreadable pin file. */
  repin?: boolean;
  /**
   * The account-key fingerprint the human supplied outside the API (flag or env), normalized
   * with expectedAccountFingerprint. First use (no pin anywhere) and every repin require it:
   * without it first use marks each drive 'unverified' — nothing is sealed and nothing is
   * pinned — and repin throws AccountSealPinRequired. A supplied value that does not match the
   * key the service returned throws AccountKeyFingerprintMismatch before anything is posted.
   */
  expectedFingerprint?: string;
  /** Fires once when --repin replaces an unreadable state file: every other origin's pin is gone. */
  onRepair?: () => void;
  /** Collects per-drive failures; without it they only mark the 'failed' status. */
  onFailure?: (driveId: string, error: unknown) => void;
  /**
   * With requireVerifiedType, drives a successful listing proved to exist (either agentOnly
   * flag). A target outside the set and without a local agent-only mark is 'unknown type':
   * sealing skips it rather than transmitting a key to a drive that might be agent-only.
   */
  requireVerifiedType?: boolean;
  verifiedDriveIds?: ReadonlySet<string>;
  /** Overall budget for state-lock waits — the automatic path's 5s deadline as epoch ms. */
  stateDeadlineAt?: number | undefined;
}): Promise<Map<string, SealStatus>> {
  const { client, config, targets } = opts;
  const result = new Map<string, SealStatus>();
  const origin = client.apiOrigin;
  let repaired = false;
  const stateOpts = {
    timeoutAt: opts.stateDeadlineAt,
    replaceIfUnreadable: opts.repin === true,
    onReset: () => {
      if (repaired) return;
      repaired = true;
      opts.onRepair?.();
    },
  };
  // Fail closed before any key can be posted: the pin cannot be compared.
  const initial = await readSealStateFile();
  if (initial.kind === 'unreadable' && !opts.repin) throw new AccountSealStateUnreadable();
  const prefix = `${origin}\n`;
  // Bare ids are pre-origin marks; they apply to every origin (fail closed). Scoped marks
  // apply only to their own origin.
  const localOnly = new Set(
    (initial.kind === 'ok' ? initial.state.agentOnly : []).flatMap((mark) =>
      mark.includes('\n') ? (mark.startsWith(prefix) ? [mark.slice(prefix.length)] : []) : [mark],
    ),
  );
  const pending = targets.filter((target) => {
    // A target key identical to the saved one IS the saved key — it may only seal to the API
    // origin it was saved for, whatever path (keys, resolveKey, env fallback) supplied it.
    // Explicitly supplied keys (env/--key-file, a just-created drive key) differ from the
    // saved value, so they stay allowed. No network call happens for a refused key.
    const saved = config.driveKeys?.[target.driveId];
    if (
      saved !== undefined &&
      saved === target.driveKey &&
      config.driveKeyOrigins?.[target.driveId] !== origin
    ) {
      result.set(target.driveId, 'wrong origin');
      return false;
    }
    if (target.agentOnly === true || localOnly.has(target.driveId)) {
      result.set(target.driveId, 'agent-only');
      return false;
    }
    if (opts.requireVerifiedType === true && opts.verifiedDriveIds?.has(target.driveId) !== true) {
      result.set(target.driveId, 'unknown type');
      return false;
    }
    return true;
  });
  const unknown = targets.filter((target) => result.get(target.driveId) === 'unknown type');
  if (unknown.length) {
    // Stamp the check so a throttled caller does not re-warn on every command.
    const at = new Date().toISOString();
    await withSealState((state) => {
      for (const target of unknown) state.checked[scoped(origin, target.driveId)] = at;
      return { changed: true };
    }, stateOpts).catch(() => {});
  }
  if (!pending.length) return result;
  const key = await client.accountKey();
  if (!key || key.format !== 1) {
    // Record the check: a throttled caller must not rediscover "no account key" every run.
    const at = new Date().toISOString();
    for (const target of pending) result.set(target.driveId, 'no account key');
    await withSealState((state) => {
      for (const target of pending) state.checked[scoped(origin, target.driveId)] = at;
      return { changed: pending.length > 0 };
    }, stateOpts).catch(() => {});
    return result;
  }
  const fingerprint = accountKeyFingerprint(key.publicKey);
  const expected = opts.expectedFingerprint;
  // The human's independently sourced fingerprint must match the key the service returned,
  // always — before any pin compare or slot post.
  if (expected !== undefined && expected !== fingerprint)
    throw new AccountKeyFingerprintMismatch(expected, fingerprint);
  // The pin compare-and-set runs under the state lock, so a second concurrent process compares
  // against the pin the first one committed rather than a stale read.
  let checked: Record<string, string> = {};
  let unverified = false;
  await withSealState((state) => {
    checked = { ...state.checked };
    const statePin = state.pins[origin];
    const configPin = config.accountKeyPins?.[origin];
    const validConfigPin = configPin && isFingerprint(configPin) ? configPin : undefined;
    const pinned = statePin ?? validConfigPin;
    if (opts.repin) {
      // A pin change is never entrusted to the API alone: no verified fingerprint, no repin.
      if (!expected) throw new AccountSealPinRequired();
    } else if (statePin && statePin !== fingerprint) {
      // A changed pin always needs the explicit --repin path, even when the new key was
      // independently verified; silently replacing a known old pin would hide a reset.
      throw new AccountKeyPinMismatch(statePin, fingerprint);
    } else if (pinned && pinned !== fingerprint) {
      throw new AccountKeyPinMismatch(pinned, fingerprint);
    }
    const independentlyVerified =
      expected === fingerprint || validConfigPin === fingerprint;
    const previouslyVerified = state.verifiedPins[origin] === fingerprint;
    if (!independentlyVerified && !previouslyVerified) {
      // Pins written by earlier versions were TOFU pins from this API, not independent
      // verification. Preserve them but require one human-sourced fingerprint before sealing.
      unverified = true;
      return { changed: false };
    }
    let changed = false;
    if (state.pins[origin] !== fingerprint) {
      state.pins[origin] = fingerprint;
      changed = true;
    }
    if (state.verifiedPins[origin] !== fingerprint) {
      state.verifiedPins[origin] = fingerprint;
      changed = true;
    }
    return { changed };
  }, stateOpts);
  if (unverified) {
    const at = new Date().toISOString();
    for (const target of pending) result.set(target.driveId, 'unverified');
    await withSealState((state) => {
      for (const target of pending) state.checked[scoped(origin, target.driveId)] = at;
      return { changed: true };
    }, stateOpts).catch(() => {});
    return result;
  }
  const now = Date.now();
  for (const target of pending) {
    if (!opts.force && recentlyChecked(checked, origin, target.driveId, now)) continue;
    try {
      const sealed = await sealDriveKey(key.publicKey, target.driveId, target.driveKey, {
        salt: ACCOUNT_SEAL_SALT,
        label: `${key.keyId}:${target.driveId}`,
      });
      const uploaded = await client.addAccountKeySlot(target.driveId, {
        keyId: key.keyId,
        sealed,
      });
      result.set(target.driveId, uploaded.status === 'created' ? 'sealed' : 'already sealed');
      const at = new Date(now).toISOString();
      await withSealState((state) => {
        state.checked[scoped(origin, target.driveId)] = at;
        return { changed: true };
      }, stateOpts);
    } catch (error) {
      if (isAgentOnlyRejection(error)) {
        result.set(target.driveId, 'agent-only');
        await recordAgentOnlyDrive(target.driveId, origin).catch(() => {});
      } else {
        result.set(target.driveId, 'failed');
        opts.onFailure?.(target.driveId, error);
      }
    }
  }
  return result;
}

/**
 * Resolves the drive keys this machine holds for `origin` (the client's effective origin) the
 * same way commands resolve them: an explicit `keys`/`resolveKey` answer first (the exact key
 * the calling command used), then an `AGENT_DRIVE_KEY_<ID>` environment key, then — for the
 * drive the calling command used — `AGENT_DRIVE_KEY` and `--key-file`, then the saved config
 * key, but only when its recorded `driveKeyOrigins` entry matches `origin` — a key saved for
 * another API is never sealed here. `agentOnly` flags only ever add the flag: a locally
 * recorded agent-only drive stays agent-only even when the listing says otherwise.
 */
export async function heldSealTargets(opts: {
  config: AgentDriveConfig;
  origin: string;
  /** Candidate drive ids; defaults to the config's held keys, `selectedDriveId` and the list. */
  driveIds?: string[];
  /** agentOnly flags from a drive listing (may be absent on a 403). */
  agentOnly?: ReadonlyMap<string, boolean>;
  /** The drive the calling command resolved; AGENT_DRIVE_KEY/--key-file apply to it. */
  selectedDriveId?: string;
  keyFile?: string;
  /** Exact keys the command already holds (e.g. a just-created drive key); win over resolution. */
  keys?: Record<string, string>;
  /** Resolves keys exactly the way the caller's tools do (the MCP server's driveKey callback). */
  resolveKey?: (driveId: string) => string | undefined;
}): Promise<SealTarget[]> {
  const candidates = new Set(
    opts.driveIds ?? [
      ...Object.keys(keysForOrigin(opts.config, opts.origin)),
      ...(opts.selectedDriveId ? [opts.selectedDriveId] : []),
      ...(opts.agentOnly?.keys() ?? []),
    ],
  );
  const targets: SealTarget[] = [];
  for (const driveId of candidates) {
    let driveKey = opts.keys?.[driveId] ?? opts.resolveKey?.(driveId);
    if (!driveKey) {
      const envKey = process.env[driveKeyEnvironmentName(driveId)]?.trim();
      if (envKey) {
        driveKey = envKey;
      } else if (driveId === opts.selectedDriveId) {
        // Identical to the command's own resolution — env-per-drive, AGENT_DRIVE_KEY, key
        // file — except the saved-key fallback must be bound to this origin.
        driveKey =
          process.env.AGENT_DRIVE_KEY?.trim() ||
          (opts.keyFile ? (await readFile(opts.keyFile, 'utf8')).trim() : undefined) ||
          keysForOrigin(opts.config, opts.origin)[driveId];
      } else {
        driveKey = keysForOrigin(opts.config, opts.origin)[driveId];
      }
    }
    if (!driveKey) continue;
    targets.push({ driveId, driveKey, agentOnly: opts.agentOnly?.get(driveId) === true });
  }
  return targets;
}

export { NO_ACCOUNT_KEY_WARNING };

/**
 * A sealing client whose requests share an overall deadline, so automatic sealing can never
 * hold the calling command. The returned signal marks the budget: an aborted run stays silent.
 * `deadlineAt` is the same budget as epoch ms, for work that does not take an AbortSignal.
 */
export function sealClientWithDeadline(
  apiUrl: string,
  apiKey: string,
  machine?: string,
): { client: AgentDriveClient; deadline: AbortSignal; deadlineAt: number } {
  const deadline = AbortSignal.timeout(SEAL_DEADLINE_MS);
  const deadlineAt = Date.now() + SEAL_DEADLINE_MS;
  const client = new AgentDriveClient({
    apiUrl,
    apiKey,
    ...(machine ? { machine } : {}),
    fetch: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
      }),
  });
  return { client, deadline, deadlineAt };
}

/**
 * Best-effort seal for held keys, called after commands that put or use drive keys on this
 * machine. `force` seals regardless of the throttle (create/login/import/mcp); otherwise drives
 * checked in the last 24h are skipped before any network call. The drive listing is paginated
 * fully; a key without `read` cannot list (403), and a drive whose type is then unproven — not
 * in the listing and without a local mark — is skipped as 'unknown type' rather than being
 * sent a key that could belong to an agent-only drive. Errors become one `warn` line, and
 * nothing is reported once `deadline` aborts the attempt.
 */
export async function autoSealHeldKeys(opts: {
  client: AgentDriveClient;
  config: AgentDriveConfig;
  driveIds?: string[];
  force?: boolean;
  /** The drive the calling command resolved; its key resolution applies. */
  selectedDriveId?: string;
  keyFile?: string;
  /** Exact keys the command already holds (win over every other resolution). */
  keys?: Record<string, string>;
  /** Resolves keys exactly the way the caller's tools do. */
  resolveKey?: (driveId: string) => string | undefined;
  /** When set, nothing is reported after it aborts the attempt. */
  deadline?: AbortSignal;
  /** The same overall budget as epoch ms; bounds state-lock waits too. */
  deadlineAt?: number;
  warn: (line: string) => void;
}) {
  try {
    const origin = opts.client.apiOrigin;
    const held = Object.keys(keysForOrigin(opts.config, origin));
    const early = new Set(opts.driveIds ?? held);
    if (opts.selectedDriveId) early.add(opts.selectedDriveId);
    if (opts.keys) for (const id of Object.keys(opts.keys)) early.add(id);
    if (!early.size) return;
    if (!opts.force) {
      const read = await readSealStateFile();
      if (read.kind === 'unreadable') throw new AccountSealStateUnreadable();
      const checked = read.kind === 'ok' ? read.state.checked : {};
      const now = Date.now();
      if (![...early].some((id) => !recentlyChecked(checked, origin, id, now))) return;
    }
    // The full listing tells bulk sealing which held drives still exist and which are
    // agent-only; recorded --agent-only create intents join in by name. A key without `read`
    // cannot list (403): with no listing and no local mark a drive's type is unproven, so it
    // is skipped rather than sent a key that could belong to an agent-only drive.
    const flags = new Map<string, boolean>();
    const listed = new Set<string>();
    let listingOk = true;
    const pendingNames = await pendingAgentOnlyNames(origin);
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const res = await opts.client.listDrives(undefined, cursor);
        for (const drive of res.items ?? []) {
          listed.add(drive.id);
          flags.set(drive.id, drive.agentOnly === true || pendingNames.has(drive.name));
        }
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
    } catch (error) {
      if (!(error instanceof AgentDriveApiError && error.status === 403)) throw error;
      listingOk = false;
    }
    const candidates = new Set<string>();
    if (opts.driveIds) {
      for (const id of opts.driveIds) candidates.add(id);
      if (opts.selectedDriveId) candidates.add(opts.selectedDriveId);
    } else if (listingOk) {
      // Only listed drives seal: a slot POST for a deleted drive would fail noisily every day.
      for (const id of listed) candidates.add(id);
    } else {
      for (const id of held) candidates.add(id);
      if (opts.selectedDriveId) candidates.add(opts.selectedDriveId);
    }
    const targets = await heldSealTargets({
      config: opts.config,
      origin,
      driveIds: [...candidates],
      agentOnly: flags,
      ...(opts.selectedDriveId ? { selectedDriveId: opts.selectedDriveId } : {}),
      ...(opts.keyFile ? { keyFile: opts.keyFile } : {}),
      ...(opts.keys ? { keys: opts.keys } : {}),
      ...(opts.resolveKey ? { resolveKey: opts.resolveKey } : {}),
    });
    if (!targets.length) return;
    const failures = new Map<string, unknown>();
    // Drives explicitly named by the caller (a just-created drive) are known to exist even
    // when the listing is denied; every other drive needs the listing or a local mark.
    const verified = new Set([...listed, ...(opts.driveIds ?? [])]);
    // A fingerprint the human preset in the environment counts as independently sourced;
    // the first seal verifies and pins it. Without one, first use fails closed.
    const expectedFingerprint = expectedAccountFingerprint(
      process.env.AGENT_DRIVE_ACCOUNT_KEY_FINGERPRINT,
    );
    const result = await sealDrivesToAccount({
      client: opts.client,
      config: opts.config,
      targets,
      force: opts.force === true,
      requireVerifiedType: true,
      verifiedDriveIds: verified,
      stateDeadlineAt: opts.deadlineAt,
      onFailure: (driveId, error) => failures.set(driveId, error),
      ...(expectedFingerprint ? { expectedFingerprint } : {}),
    });
    if (opts.deadline?.aborted) return;
    // Only the named events (create/login/import/mcp) warn: an account with no key would
    // otherwise print the same line on every throttled command.
    if (opts.force && [...result.values()].some((status) => status === 'no account key'))
      opts.warn(NO_ACCOUNT_KEY_WARNING);
    // First use with no fingerprint source: the one-time verification step is the owner's.
    if ([...result.values()].some((status) => status === 'unverified')) opts.warn(UNVERIFIED_HINT);
    const unknown = targets
      .filter((target) => result.get(target.driveId) === 'unknown type')
      .map((target) => target.driveId);
    if (unknown.length)
      opts.warn(
        `Drive key sealing skipped for ${
          unknown.length === 1 ? `drive ${unknown[0]}` : `${unknown.length} drives`
        }: ${UNKNOWN_TYPE_HINT}.`,
      );
    const failed = [...failures.keys()];
    if (failed.length) opts.warn(describeFailure(failed, failures));
  } catch (error) {
    if (opts.deadline?.aborted) return;
    opts.warn(
      `Drive key sealing skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Account passphrase vault: the logic behind "type a passphrase to open every drive".
// Pure TypeScript with injected requests, so it runs under Node tests. React state lives in
// console.tsx. Nothing here touches browser storage, URLs or logs, and no error message ever
// contains a passphrase, a drive key or a private key.
import { envelopeVersion, unwrapFileKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { inboxFor } from './share-link';
import {
  unwrapInboxPrivateKey,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import {
  createAccountKey,
  fingerprint,
  normalizeGeneratedPassphrase,
  parseAccountKeyRecord,
  parseSlot,
  rewrapAccountKey,
  sealToAccount,
  unlockAccountKey,
  unsealFromAccount,
  type AccountKeyRecord,
  type AccountSlot,
} from './account-key';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked' | 'error';
export type LockReason = 'manual' | 'idle' | 'stale';
export type KeyResult = { status: 'key'; key: string } | { status: 'none' | 'mismatch' | 'stale' };
export type VaultRequest = (path: string, method?: string, body?: unknown) => Promise<unknown>;
export type VaultDeps = {
  /** Plain console call. Failures throw an Error that carries `status`. */
  request: VaultRequest;
  /** Same, but wrapped so Clerk's reverification prompt can run (strict routes only). */
  strict: VaultRequest;
  /** Wrapped file key of the newest version of `path`, from the versions route. */
  envelope: (driveId: string, path: string) => Promise<string>;
  /** Any live file of the drive, to check a key against. Undefined for an empty drive. */
  anyPath: (driveId: string) => Promise<string | undefined>;
  /** The drive's trace inbox record, or null when it has none. */
  inbox: (driveId: string) => Promise<TraceInboxRecord | null>;
  onLocked?: ((reason: LockReason) => void) | undefined;
  onChange?: (() => void) | undefined;
};

const STALE_RECORD =
  'Your passphrase record looks older than one this tab already used. Reload the page.';
const CHANGED = 'Your passphrase was changed elsewhere. Reload the page.';
const SLOTS_FAILED = 'Couldn’t load your drives’ keys. Retry.';
const MAX_SLOT_PAGES = 100;

/** Console API call that hands Clerk's reverification body back unchanged. */
export async function vaultRequest(path: string, method = 'GET', body?: unknown) {
  let result: Response;
  try {
    result = await fetch(`/api/console/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Could not reach Agent Drive. Check your connection and try again.');
  }
  const data: unknown = await result.json().catch(() => null);
  // useReverification recognises this body, shows its prompt and calls us again.
  if (result.status === 403 && typeof data === 'object' && data !== null && 'clerk_error' in data)
    return data;
  if (result.status === 401) {
    window.location.assign('/sign-in');
    throw new Error('Your session expired. Sign in again.');
  }
  if (!result.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw Object.assign(new Error(message ?? 'The request could not be completed.'), {
      status: result.status,
    });
  }
  return data;
}

const statusOf = (reason: unknown) => (reason as { status?: number } | null)?.status;

export class Vault {
  status: VaultStatus = 'loading';
  record: AccountKeyRecord | null = null;
  fingerprint = '';
  loadError = '';
  /** True only while the slots request of an unlock is in flight (used by tests). */
  fetchingSlots = false;
  private accountId = '';
  private privateKey: CryptoKey | null = null;
  private slots = new Map<string, AccountSlot>();
  private epoch = 0;
  private unlockSeq = 0;
  private seen = new Map<string, number>();

  constructor(private deps: VaultDeps) {}

  get slotCount() {
    return this.slots.size;
  }
  hasSlot(driveId: string) {
    return this.slots.has(driveId);
  }
  /** Changes on Lock, idle, reset and dispose. Callers capture it before an await and compare. */
  get epochNow() {
    return this.epoch;
  }

  private emit() {
    this.deps.onChange?.();
  }

  /** Reads the session account and the stored record. Never needs the passphrase. */
  async load() {
    const epoch = this.epoch;
    try {
      await this.refreshRecord();
      if (epoch !== this.epoch) return;
      this.status = this.record ? (this.privateKey ? 'unlocked' : 'locked') : 'none';
    } catch (reason) {
      if (epoch !== this.epoch) return;
      this.loadError =
        reason instanceof Error ? reason.message : 'Passphrase unlock is unavailable.';
      this.status = 'error';
    }
    this.emit();
  }

  private async refreshRecord() {
    const [who, result] = await Promise.all([
      this.accountId ? { accountId: this.accountId } : this.deps.request('whoami'),
      this.deps.request('account-key'),
    ]);
    const accountId = (who as { accountId?: unknown }).accountId;
    if (typeof accountId !== 'string') throw new Error('Passphrase unlock is unavailable.');
    this.accountId = accountId;
    const raw = (result as { accountKey: unknown }).accountKey;
    if (raw === null || raw === undefined) {
      this.record = null;
      return;
    }
    const record = await parseAccountKeyRecord(raw, accountId);
    const seen = this.seen.get(record.id);
    if (seen !== undefined && seen > record.wrapGeneration) throw new Error(STALE_RECORD);
    this.seen.set(record.id, Math.max(seen ?? 0, record.wrapGeneration));
    this.record = record;
    this.fingerprint = await fingerprint(record.publicKey);
  }

  /** Tries a generated passphrase with spaces, dashes and case removed, then as typed. */
  private async withPassphrase<T>(passphrase: string, run: (p: string) => Promise<T>) {
    const normalized = normalizeGeneratedPassphrase(passphrase);
    if (normalized === passphrase) return run(passphrase);
    try {
      return await run(normalized);
    } catch {
      return run(passphrase);
    }
  }

  /**
   * Checks the passphrase and loads the slots. Returns false (and installs nothing) if Lock,
   * idle, reset or a cancelled dialog happened first. Throws "That passphrase is not correct."
   */
  async unlock(passphrase: string): Promise<boolean> {
    const epoch = this.epoch;
    const seq = this.unlockSeq;
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    // A fresh read, so a passphrase changed on another device is noticed.
    await this.refreshRecord();
    if (!live()) return false;
    const record = this.record;
    if (!record) {
      this.status = 'none';
      this.emit();
      throw new Error('No passphrase is set up.');
    }
    const privateKey = await this.withPassphrase(passphrase, (p) =>
      unlockAccountKey(record, this.accountId, p),
    );
    if (!live()) return false;
    this.fetchingSlots = true;
    let slots: Map<string, AccountSlot>;
    try {
      slots = await this.fetchSlots(record.id);
    } finally {
      this.fetchingSlots = false;
    }
    if (!live()) return false;
    this.privateKey = privateKey;
    this.slots = slots;
    this.status = 'unlocked';
    this.seen.set(record.id, record.wrapGeneration);
    this.emit();
    return true;
  }

  private async fetchSlots(keyId: string) {
    const slots = new Map<string, AccountSlot>();
    let cursor: string | null = null;
    try {
      for (let page = 0; page < MAX_SLOT_PAGES; page += 1) {
        const result = (await this.deps.request(
          `account-key/slots?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )) as { items: unknown[]; nextCursor: string | null };
        for (const item of result.items) {
          // A malformed slot is skipped; it can only hide one drive, never open one.
          const slot = await parseSlot(item).catch(() => null);
          if (slot && slot.keyId === keyId) slots.set(slot.driveId, slot);
        }
        cursor = result.nextCursor;
        if (!cursor) return slots;
      }
    } catch {
      throw new Error(SLOTS_FAILED);
    }
    return slots;
  }

  /** Stops an unlock attempt that is still running (its dialog was closed). */
  cancelUnlock() {
    this.unlockSeq += 1;
  }

  /**
   * Opens the drive key from its slot and proves it opens the wrapped key of `path`. A key that
   * does not verify is never returned. The caller must also check its own action epoch.
   */
  async keyFor(driveId: string, path: string): Promise<KeyResult> {
    const epoch = this.epoch;
    const slot = this.slots.get(driveId);
    const privateKey = this.privateKey;
    if (!slot || !privateKey) return { status: 'none' };
    let key: string;
    try {
      key = await unsealFromAccount(privateKey, slot.keyId, driveId, slot.sealed);
    } catch {
      return { status: 'mismatch' };
    }
    if (epoch !== this.epoch) return { status: 'stale' };
    const wrapped = await this.deps.envelope(driveId, path);
    if (epoch !== this.epoch) return { status: 'stale' };
    if (!(await this.opens(driveId, wrapped, key))) return { status: 'mismatch' };
    if (epoch !== this.epoch) return { status: 'stale' };
    return { status: 'key', key };
  }

  /** True if `key` opens this wrapped file key (v2 through the drive's inbox record). */
  private async opens(driveId: string, wrapped: string, key: string) {
    let version: 1 | 2;
    try {
      version = envelopeVersion(wrapped);
    } catch {
      return false;
    }
    let inbox: ReturnType<typeof inboxFor> | undefined;
    if (version === 2) {
      const record = await this.deps.inbox(driveId);
      if (!record) return false;
      inbox = inboxFor(driveId, record);
    }
    try {
      await unwrapFileKey(wrapped, key, inbox);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Says what a drive key opens: a file envelope, else the trace inbox of a drive with no files.
   * 'unverifiable' means the drive has neither.
   */
  async verifyKey(
    driveId: string,
    key: string,
  ): Promise<'file' | 'inbox' | 'mismatch' | 'unverifiable'> {
    const path = await this.deps.anyPath(driveId);
    if (path !== undefined) {
      const wrapped = await this.deps.envelope(driveId, path);
      return (await this.opens(driveId, wrapped, key)) ? 'file' : 'mismatch';
    }
    const record = await this.deps.inbox(driveId);
    if (!record) return 'unverifiable';
    try {
      await unwrapInboxPrivateKey(inboxFor(driveId, record), key);
      return 'inbox';
    } catch {
      return 'mismatch';
    }
  }

  /**
   * Seals a drive key into the account. Unless `trusted` (generated in this tab), the key must
   * first open the wrapped key of a real file: `path`, else any file of the drive. A key that
   * cannot be checked, or fails, is never sealed. `live` can cancel the write.
   */
  async addKey(
    driveId: string,
    key: string,
    opts: { path?: string; trusted?: boolean; live?: () => boolean } = {},
  ): Promise<'added' | 'same' | 'skipped' | 'stale'> {
    const epoch = this.epoch;
    const alive = () => epoch === this.epoch && (opts.live?.() ?? true);
    const record = this.record;
    const privateKey = this.privateKey;
    if (!record || !privateKey) return 'skipped';
    if (!opts.trusted) {
      try {
        if (opts.path !== undefined) {
          if (!(await this.opens(driveId, await this.deps.envelope(driveId, opts.path), key)))
            return 'skipped';
        } else {
          const result = await this.verifyKey(driveId, key);
          if (result !== 'file' && result !== 'inbox') return 'skipped';
        }
      } catch {
        return 'skipped';
      }
    }
    if (!alive()) return 'stale';
    const existing = this.slots.get(driveId);
    if (existing) {
      const current = await unsealFromAccount(
        privateKey,
        existing.keyId,
        driveId,
        existing.sealed,
      ).catch(() => null);
      if (current === key) return 'same';
    }
    const sealed = await sealToAccount(record.publicKey, record.id, driveId, key);
    if (!alive()) return 'stale';
    try {
      const result = (await this.deps.request(`drives/${driveId}/account-key`, 'POST', {
        keyId: record.id,
        expectedRevision: existing?.revision ?? null,
        sealed,
      })) as { revision: number };
      if (epoch === this.epoch) {
        this.slots.set(driveId, {
          driveId,
          keyId: record.id,
          format: 1,
          sealed,
          revision: result.revision,
        });
        this.emit();
      }
      return 'added';
    } catch (reason) {
      if (
        statusOf(reason) === 409 &&
        /passphrase was changed/u.test(String((reason as Error).message)) &&
        epoch === this.epoch
      ) {
        this.lock('stale');
        return 'stale';
      }
      return 'skipped';
    }
  }

  /** Creates the account key, unlocks, and seals the given drive keys. */
  async setup(
    passphrase: string,
    keys: Record<string, { key: string; trusted: boolean }>,
  ): Promise<{ added: number; total: number } | null> {
    const epoch = this.epoch;
    const seq = this.unlockSeq;
    // Checked after every await: Lock, idle, reset or a closed dialog cancel the whole setup.
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    if (!this.accountId) await this.load();
    if (!live()) return null;
    const { record, privateKey } = await createAccountKey(this.accountId, passphrase);
    if (!live()) return null;
    const print = await fingerprint(record.publicKey);
    if (!live()) return null;
    await this.deps.strict('account-key', 'POST', {
      id: record.id,
      publicKey: record.publicKey,
      wrappedPrivateKey: record.wrappedPrivateKey,
      kdf: record.kdf,
    });
    if (!live()) return null;
    this.record = record;
    this.fingerprint = print;
    this.privateKey = privateKey;
    this.slots = new Map();
    this.seen.set(record.id, record.wrapGeneration);
    this.status = 'unlocked';
    this.emit();
    let added = 0;
    const entries = Object.entries(keys);
    for (const [driveId, { key, trusted }] of entries) {
      if (!live()) return null;
      const result = await this.addKey(driveId, key, { trusted, live }).catch(() => 'skipped');
      if (result === 'added') added += 1;
    }
    return { added, total: entries.length };
  }

  /** Re-wraps the same private key under a new passphrase. Returns false if locked meanwhile. */
  async change(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    const epoch = this.epoch;
    const seq = this.unlockSeq;
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    const record = this.record;
    if (!record) throw new Error('No passphrase is set up.');
    const next = await this.withPassphrase(oldPassphrase, (p) =>
      rewrapAccountKey(record, this.accountId, p, newPassphrase),
    );
    if (!live()) return false;
    try {
      const result = (await this.deps.strict('account-key', 'PATCH', {
        expectedKeyId: record.id,
        expectedGeneration: record.wrapGeneration,
        wrappedPrivateKey: next.wrappedPrivateKey,
        kdf: next.kdf,
      })) as { accountKey: unknown };
      const saved = await parseAccountKeyRecord(result.accountKey, this.accountId);
      if (!live()) return false;
      this.record = saved;
      this.seen.set(saved.id, saved.wrapGeneration);
      this.emit();
      return true;
    } catch (reason) {
      if (statusOf(reason) === 409) {
        this.lock('stale');
        throw new Error(CHANGED);
      }
      throw reason;
    }
  }

  /** Deletes the account key and every slot. Loaded drive keys stay in the tab. */
  async reset() {
    const record = this.record;
    if (!record) throw new Error('No passphrase is set up.');
    try {
      await this.deps.strict('account-key', 'DELETE', {
        expectedKeyId: record.id,
        confirmation: 'RESET',
      });
    } catch (reason) {
      if (statusOf(reason) === 409) {
        this.lock('stale');
        throw new Error(CHANGED);
      }
      throw reason;
    }
    this.epoch += 1;
    this.privateKey = null;
    this.slots = new Map();
    this.record = null;
    this.fingerprint = '';
    this.seen.delete(record.id);
    this.status = 'none';
    this.emit();
  }

  /** Synchronous: bumps the epoch first so every in-flight step becomes a no-op. */
  lock(reason: LockReason) {
    this.epoch += 1;
    this.privateKey = null;
    this.slots = new Map();
    if (this.record) this.status = 'locked';
    this.emit();
    this.deps.onLocked?.(reason);
  }

  /** Unmount, sign-out or user change: drop the private key and slots, keeping the callbacks. */
  clear() {
    this.epoch += 1;
    this.privateKey = null;
    this.slots = new Map();
    if (this.status === 'unlocked') this.status = 'locked';
  }
}

// Account passphrase vault: the logic behind "type a passphrase to open every drive".
// Pure TypeScript with injected requests, so it runs under Node tests. React state lives in
// console.tsx. Nothing here touches browser storage, URLs or logs, and no error message ever
// contains a passphrase, a drive key or a private key.
import { envelopeVersion, unwrapFileKey } from '../../../../packages/agent-drive/src/crypto.ts';
import { inboxFor } from './share-link';
import {
  verifyInboxKeypair,
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
  type PasskeyWrap,
} from './account-key';
import { enrollAccountPasskey, unlockWithAccountPasskey } from './passkey';
import type { PersistedStore } from './persisted-key';

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
  /** "Keep this browser unlocked" store (IndexedDB in the app, a stub in tests). */
  persisted?: PersistedStore | undefined;
  /**
   * Cross-tab lock channel: notified when this tab locks the browser key so every other tab
   * drops its in-memory key; subscribe locks this vault when another tab posts one.
   */
  peers?: { notify: () => void; subscribe: (onLock: () => void) => void } | undefined;
  /** The currently signed-in user id; persisted keys written under another user are ignored. */
  owner?: (() => string | null) | undefined;
  onLocked?: ((reason: LockReason) => void) | undefined;
  onChange?: (() => void) | undefined;
  /** Surfaces a failure the user must see even when the action that caused it was cancelled. */
  onNotice?: ((line: string) => void) | undefined;
};

const STALE_RECORD =
  'Your passphrase record looks older than one this tab already used. Reload the page.';
const CHANGED = 'Your passphrase was changed elsewhere. Reload the page.';
const SLOTS_FAILED = 'Couldn’t load your drives’ keys. Retry.';
const MAX_SLOT_PAGES = 100;

/** The notice shown whenever deleting the browser-held key cannot be confirmed. */
export const BROWSER_KEY_DELETE_FAILED =
  'The stored key could not be removed; clear this browser’s site data to finish locking it.';

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
  /** Revisions of every slot row seen — including ones this build could not open, so a repair
   * write replaces the row (expectedRevision) instead of losing to it. */
  private slotRevisions = new Map<string, number>();
  private epoch = 0;
  private unlockSeq = 0;
  private recordSeq = 0;
  private seen = new Map<string, number>();
  /** Scoped slot reads still in flight, by drive: concurrent ensureSlot calls share one read. */
  private ensuring = new Map<string, Promise<boolean>>();
  /** Status before the pending load began; cancelUnlock() puts it back. */
  private beforeLoad: { status: VaultStatus; loadError: string } | null = null;
  /** Live passkey ceremonies — every epoch/seq bump aborts them with the work they serve. */
  private ceremonies = new Set<AbortController>();

  constructor(private deps: VaultDeps) {
    // A "Lock this browser" in any other tab drops this tab's in-memory key immediately.
    this.deps.peers?.subscribe(() => this.lock('manual'));
  }

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

  private ceremony() {
    const controller = new AbortController();
    this.ceremonies.add(controller);
    return controller;
  }

  private abortCeremonies() {
    for (const controller of this.ceremonies) controller.abort();
    this.ceremonies.clear();
  }

  /** Reads the session account and the stored record. Never needs the passphrase. */
  async load() {
    const epoch = this.epoch;
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
    this.fetchingSlots = false;
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    // A first-ever load has nothing to go back to, so it falls back to a retryable error.
    this.beforeLoad ??=
      this.status === 'loading'
        ? { status: 'error', loadError: 'Passphrase unlock could not be loaded. Try again.' }
        : { status: this.status, loadError: this.loadError };
    this.status = 'loading';
    this.loadError = '';
    this.emit();
    try {
      if (!(await this.refreshRecord(live))) return;
      // A "Keep this browser unlocked" key survives reloads; a passphrase reset elsewhere makes a
      // new record id, which can never match the stored key.
      if (this.record && !this.privateKey) await this.restorePersisted(live);
      this.beforeLoad = null;
      this.loadError = '';
      this.status = this.record ? (this.privateKey ? 'unlocked' : 'locked') : 'none';
    } catch (reason) {
      if (!live()) return;
      this.beforeLoad = null;
      this.loadError =
        reason instanceof Error ? reason.message : 'Passphrase unlock is unavailable.';
      this.status = 'error';
    }
    this.emit();
  }

  private async refreshRecord(live: () => boolean) {
    const seq = ++this.recordSeq;
    const current = () => live() && seq === this.recordSeq;
    try {
      const [who, result] = await Promise.all([
        this.accountId ? { accountId: this.accountId } : this.deps.request('whoami'),
        this.deps.request('account-key'),
      ]);
      const accountId = (who as { accountId?: unknown }).accountId;
      if (typeof accountId !== 'string') throw new Error('Passphrase unlock is unavailable.');
      const raw = (result as { accountKey: unknown }).accountKey;
      const record = raw == null ? null : await parseAccountKeyRecord(raw, accountId);
      const print = record ? await fingerprint(record.publicKey) : '';
      if (!current()) return false;
      const seen = record ? this.seen.get(record.id) : undefined;
      if (record && seen !== undefined && seen > record.wrapGeneration)
        throw new Error(STALE_RECORD);
      const changed =
        this.record &&
        (this.record.id !== record?.id || this.record.wrapGeneration !== record?.wrapGeneration);
      this.accountId = accountId;
      if (record) this.seen.set(record.id, Math.max(seen ?? 0, record.wrapGeneration));
      this.record = record;
      this.fingerprint = print;
      if (changed && this.privateKey) {
        this.lock('stale');
        return false;
      }
      return true;
    } catch (reason) {
      if (!current()) return false;
      throw reason;
    }
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

  /** Installs the IndexedDB-held key when it belongs to the current record. */
  private async restorePersisted(live: () => boolean) {
    const store = this.deps.persisted;
    const record = this.record;
    if (!store || !record) return;
    const stored = await store.read().catch(() => null);
    if (!live() || !stored || stored.keyId !== record.id) return;
    // A key written under a different signed-in user (or before owners existed) must not open
    // this session's vault: drop it instead of installing it.
    if ((stored.owner ?? null) !== (this.deps.owner?.() ?? null)) {
      await store.clear().catch(() => {});
      return;
    }
    this.fetchingSlots = true;
    let loaded: { slots: Map<string, AccountSlot>; revisions: Map<string, number> };
    try {
      loaded = await this.fetchSlots(record.id);
    } finally {
      if (live()) this.fetchingSlots = false;
    }
    if (!live()) return;
    this.privateKey = stored.key;
    this.slots = loaded.slots;
    this.slotRevisions = loaded.revisions;
  }

  /**
   * Checks the passphrase and loads the slots. Returns false (and installs nothing) if Lock,
   * idle, reset or a cancelled dialog happened first. Throws "That passphrase is not correct."
   * `persist` is "Keep this browser unlocked"; an explicit unchecked box removes a stored key.
   */
  async unlock(passphrase: string, persist = false): Promise<boolean> {
    const epoch = this.epoch;
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
    const startedAt = Date.now();
    this.fetchingSlots = false;
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    // Snapshot the lock counter before the passphrase work: a "Lock this browser" anywhere
    // else during the derivation or the slot fetch must refuse this attempt's write.
    const generation = persist
      ? await this.deps.persisted?.readLockGeneration().catch(() => undefined)
      : undefined;
    // A fresh read, so a passphrase changed on another device is noticed.
    if (!(await this.refreshRecord(live))) return false;
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
    return this.installUnlock(record, privateKey, persist, generation, startedAt, live);
  }

  /**
   * Unlocks via the passkey wrap on the record instead of the passphrase. The credential's own
   * browser prompt — never an assertion the server sees — supplies the key; everything after
   * it (slots fetch, the "Keep this browser unlocked" write and its lock race) is the shared
   * install path of unlock(). Cancel/lock/reset abort the ceremony with the attempt.
   */
  async unlockWithPasskey(persist = false): Promise<boolean> {
    const epoch = this.epoch;
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
    const startedAt = Date.now();
    this.fetchingSlots = false;
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    const generation = persist
      ? await this.deps.persisted?.readLockGeneration().catch(() => undefined)
      : undefined;
    if (!(await this.refreshRecord(live))) return false;
    const record = this.record;
    if (!record) {
      this.status = 'none';
      this.emit();
      throw new Error('No passphrase is set up.');
    }
    if (!record.passkey) throw new Error('This account key has no passkey.');
    const ceremony = this.ceremony();
    let privateKey: CryptoKey;
    try {
      privateKey = await unlockWithAccountPasskey(record, ceremony.signal);
    } finally {
      this.ceremonies.delete(ceremony);
    }
    if (!live()) return false;
    return this.installUnlock(record, privateKey, persist, generation, startedAt, live);
  }

  /**
   * Wraps the account private key under a new passkey and stores the wrap through the strict
   * route. `passphrase` proves the caller holds the key once; `userName` only labels the
   * credential. A stored wrapper makes this a no-op — the server refuses a second one anyway.
   */
  async addPasskey(passphrase: string, userName: string): Promise<boolean> {
    const epoch = this.epoch;
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    if (!(await this.refreshRecord(live))) return false;
    const record = this.record;
    if (!record) {
      this.status = 'none';
      this.emit();
      throw new Error('No passphrase is set up.');
    }
    if (record.passkey) return true;
    const normalized = normalizeGeneratedPassphrase(passphrase);
    const ceremony = this.ceremony();
    let wrap: PasskeyWrap;
    try {
      wrap = await enrollAccountPasskey(
        record,
        normalized === passphrase ? passphrase : normalized,
        userName,
        ceremony.signal,
      );
    } catch (first) {
      // Only a wrong passphrase earns a retry — the generated form retyped with its
      // separators. Retrying any other failure would run a second credential ceremony and
      // bury the real error behind the retry's.
      if (
        normalized === passphrase ||
        !/passphrase is not correct/u.test(String((first as Error)?.message))
      )
        throw first;
      wrap = await enrollAccountPasskey(record, passphrase, userName, ceremony.signal);
    } finally {
      this.ceremonies.delete(ceremony);
    }
    if (!live()) return false;
    try {
      const result = (await this.deps.strict('account-key/passkey', 'POST', {
        expectedKeyId: record.id,
        expectedGeneration: record.wrapGeneration,
        passkey: wrap,
      })) as { accountKey: unknown };
      const saved = await parseAccountKeyRecord(result.accountKey, this.accountId);
      if (!live()) return false;
      this.record = saved;
      this.seen.set(saved.id, saved.wrapGeneration);
      this.emit();
      return true;
    } catch (reason) {
      if (
        live() &&
        statusOf(reason) === 409 &&
        /passphrase was changed/u.test(String((reason as Error).message))
      ) {
        this.lock('stale');
        throw new Error(CHANGED);
      }
      throw reason;
    }
  }

  /**
   * The tail every unlock shares once a private key exists: fetch the slots, commit or remove
   * the browser-held key under its lock-generation snapshot, then expose 'unlocked' — in that
   * order, and refused the moment `live` dies.
   */
  private async installUnlock(
    record: AccountKeyRecord,
    privateKey: CryptoKey,
    persist: boolean,
    generation: number | undefined,
    startedAt: number,
    live: () => boolean,
  ): Promise<boolean> {
    this.fetchingSlots = true;
    let loaded: { slots: Map<string, AccountSlot>; revisions: Map<string, number> };
    try {
      loaded = await this.fetchSlots(record.id);
    } finally {
      if (live()) this.fetchingSlots = false;
    }
    // The identity check runs again right before the write: a sign-out or dialog cancel that
    // happened during fetchSlots must not leave a key behind in IndexedDB.
    if (!live()) return false;
    // The browser-held key must be committed before 'unlocked' is observable: a reload that
    // races the write would otherwise come back to a Locked vault (or a stale stored key).
    if (persist) {
      // Commits only while the snapshot generation still stands — a lock landing meanwhile
      // wins, and this write is refused.
      if (generation !== undefined)
        await this.deps.persisted?.write(
          record.id,
          privateKey,
          this.deps.owner?.() ?? null,
          generation,
          startedAt,
        );
      // Cancelled or superseded while the write committed: remove this attempt's record — but
      // never a newer unlock's — before returning, and await the delete. A failed delete
      // surfaces through the notice instead of succeeding silently.
      if (!live()) {
        await this.deps.persisted?.clear({ keyId: record.id, startedAt }).catch(() => {
          this.deps.onNotice?.(BROWSER_KEY_DELETE_FAILED);
        });
        return false;
      }
    } else {
      // Unchecking "Keep this browser unlocked" must surface a failed delete.
      await this.deps.persisted?.clear();
    }
    if (!live()) return false;
    this.privateKey = privateKey;
    this.slots = loaded.slots;
    this.slotRevisions = loaded.revisions;
    this.status = 'unlocked';
    this.seen.set(record.id, record.wrapGeneration);
    this.emit();
    return true;
  }

  private async fetchSlots(keyId: string, driveId?: string) {
    const slots = new Map<string, AccountSlot>();
    const revisions = new Map<string, number>();
    let cursor: string | null = null;
    try {
      for (let page = 0; page < MAX_SLOT_PAGES; page += 1) {
        const query = driveId
          ? `driveId=${encodeURIComponent(driveId)}&limit=1`
          : `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const result = (await this.deps.request(`account-key/slots?${query}`)) as {
          items: unknown[];
          nextCursor: string | null;
        };
        for (const item of result.items) {
          if (!item || typeof item !== 'object') continue;
          if (driveId && (!('driveId' in item) || item.driveId !== driveId)) continue;
          // A malformed slot is skipped; it can only hide one drive, never open one.
          const slot = await parseSlot(item).catch(() => null);
          if (slot) {
            revisions.set(slot.driveId, slot.revision);
            if (slot.keyId === keyId) slots.set(slot.driveId, slot);
            continue;
          }
          // A row this build cannot open keeps its revision anyway: repairing it must replace
          // the row (expectedRevision) rather than insert a second one that can never win.
          const raw = item as { driveId?: unknown; revision?: unknown };
          if (
            typeof raw.driveId === 'string' &&
            typeof raw.revision === 'number' &&
            Number.isSafeInteger(raw.revision) &&
            raw.revision >= 1
          )
            revisions.set(raw.driveId, raw.revision);
        }
        cursor = result.nextCursor;
        if (!cursor || driveId) return { slots, revisions };
      }
    } catch {
      throw new Error(SLOTS_FAILED);
    }
    return { slots, revisions };
  }

  /** An agent may have enrolled this drive since the browser unlocked. Retry misses on demand. */
  async ensureSlot(driveId: string, refreshCached = false): Promise<boolean> {
    if (this.hasSlot(driveId) && !refreshCached) return true;
    const record = this.record;
    if (!record || !this.privateKey) return false;
    const seq = this.unlockSeq;
    const epoch = this.epoch;
    const originalSlot = this.slots.get(driveId);
    const originalRevision = this.slotRevisions.get(driveId);
    const pendingKey = `${epoch}/${seq}/${driveId}/${refreshCached ? 'refresh' : 'cached'}`;
    const pending = this.ensuring.get(pendingKey);
    if (pending) return pending;
    const request = this.fetchSlots(record.id, driveId).then(({ slots, revisions }) => {
      if (record !== this.record || epoch !== this.epoch || seq !== this.unlockSeq) return false;
      // A key loaded or repaired in this tab while a refresh was in flight wins over its older
      // response. Compare both the slot object and revision so the request cannot restore stale
      // data after a local repair.
      const currentSlot = this.slots.get(driveId);
      const currentRevision = this.slotRevisions.get(driveId);
      if (refreshCached) {
        if (currentSlot !== originalSlot || currentRevision !== originalRevision)
          return Boolean(currentSlot);
      } else if (currentSlot) {
        return true;
      }
      const revision = revisions.get(driveId);
      const slot = slots.get(driveId);
      if (!slot) {
        if (
          refreshCached &&
          this.slots.get(driveId) === originalSlot &&
          this.slotRevisions.get(driveId) === originalRevision
        ) {
          this.slots.delete(driveId);
          if (this.slotRevisions.get(driveId) === originalRevision)
            this.slotRevisions.delete(driveId);
          this.emit();
        }
        return false;
      }
      if (revision !== undefined) this.slotRevisions.set(driveId, revision);
      this.slots.set(driveId, slot);
      this.emit();
      return true;
    });
    this.ensuring.set(pendingKey, request);
    try {
      return await request;
    } finally {
      this.ensuring.delete(pendingKey);
    }
  }

  /** Stops an unlock attempt that is still running (its dialog was closed). */
  cancelUnlock() {
    this.unlockSeq += 1;
    this.abortCeremonies();
    this.fetchingSlots = false;
    if (this.beforeLoad && this.status === 'loading') {
      ({ status: this.status, loadError: this.loadError } = this.beforeLoad);
      this.emit();
    }
    this.beforeLoad = null;
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

  /** The drive key from its slot, unchecked: the caller verifies it (`verifyKey`) before relying on it. */
  async slotKey(driveId: string): Promise<string | null> {
    const epoch = this.epoch;
    const slot = this.slots.get(driveId);
    if (!slot || !this.privateKey) return null;
    const key = await unsealFromAccount(this.privateKey, slot.keyId, driveId, slot.sealed).catch(
      () => null,
    );
    return epoch === this.epoch ? key : null;
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
      await verifyInboxKeypair(inboxFor(driveId, record), key);
      return 'inbox';
    } catch {
      return 'mismatch';
    }
  }

  /** Proves the supplied key opens this exact inbox snapshot. */
  async verifyInboxKey(driveId: string, key: string, record: TraceInboxRecord): Promise<boolean> {
    try {
      await verifyInboxKeypair(inboxFor(driveId, record), key);
      return true;
    } catch {
      return false;
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
        expectedRevision: existing?.revision ?? this.slotRevisions.get(driveId) ?? null,
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
        this.slotRevisions.set(driveId, result.revision);
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
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
    const startedAt = Date.now();
    // Checked after every await: Lock, idle, reset or a closed dialog cancel the whole setup.
    const live = () => epoch === this.epoch && seq === this.unlockSeq;
    const generation = await this.deps.persisted?.readLockGeneration().catch(() => undefined);
    if (!this.accountId && !(await this.refreshRecord(live))) return null;
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
    // Awaited before 'unlocked' is emitted, so the key is durable before a reload can see it —
    // and refused when the lock counter moved since this setup snapshot it.
    if (generation !== undefined)
      await this.deps.persisted?.write(
        record.id,
        privateKey,
        this.deps.owner?.() ?? null,
        generation,
        startedAt,
      );
    // Cancelled or superseded while the write committed: remove this setup's record — but never
    // a newer unlock's — before returning, and await the delete. A failed delete surfaces
    // through the notice instead of succeeding silently.
    if (!live()) {
      await this.deps.persisted?.clear({ keyId: record.id, startedAt }).catch(() => {
        this.deps.onNotice?.(BROWSER_KEY_DELETE_FAILED);
      });
      return null;
    }
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
    const seq = ++this.unlockSeq;
    this.abortCeremonies();
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
      if (live() && statusOf(reason) === 409) {
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
    this.epoch += 1;
    this.abortCeremonies();
    const epoch = this.epoch;
    this.privateKey = null;
    this.slots = new Map();
    this.slotRevisions = new Map();
    this.fetchingSlots = false;
    this.status = 'locked';
    this.emit();
    try {
      await this.deps.strict('account-key', 'DELETE', {
        expectedKeyId: record.id,
        confirmation: 'RESET',
      });
    } catch (reason) {
      if (epoch === this.epoch && statusOf(reason) === 409) {
        this.lock('stale');
        throw new Error(CHANGED);
      }
      throw reason;
    }
    if (epoch !== this.epoch) return;
    this.epoch += 1;
    this.privateKey = null;
    this.slots = new Map();
    this.slotRevisions = new Map();
    this.record = null;
    this.fingerprint = '';
    this.seen.delete(record.id);
    this.status = 'none';
    // The account key is gone; every tab holding its private key drops it too.
    this.notifyPeers();
    void this.deps.persisted?.clear().catch(() => {});
    this.emit();
  }

  /** Synchronous: bumps the epoch first so every in-flight step becomes a no-op. */
  lock(reason: LockReason) {
    this.epoch += 1;
    this.abortCeremonies();
    this.privateKey = null;
    this.slots = new Map();
    this.slotRevisions = new Map();
    this.fetchingSlots = false;
    this.status = this.record ? 'locked' : 'none';
    this.emit();
    this.deps.onLocked?.(reason);
  }

  private notifyPeers() {
    try {
      this.deps.peers?.notify();
    } catch {
      // A broken channel only delays other tabs until their next read.
    }
  }

  /**
   * "Lock this browser": deletes the IndexedDB-held key, then locks. The delete is awaited and
   * its failure propagates — only then is the browser really locked, so the vault stays
   * 'unlocked' when the key could not be removed. Other open tabs are told so they drop their
   * in-memory key immediately.
   */
  async lockBrowser() {
    await this.deps.persisted?.clear();
    this.notifyPeers();
    this.lock('manual');
  }

  /** Unmount: drop account state, keeping the callbacks and the browser-held key. */
  clear() {
    this.epoch += 1;
    this.abortCeremonies();
    this.privateKey = null;
    this.slots = new Map();
    this.slotRevisions = new Map();
    this.fetchingSlots = false;
    this.accountId = '';
    this.record = null;
    this.fingerprint = '';
    this.loadError = '';
    this.beforeLoad = null;
    this.seen = new Map();
    this.status = 'loading';
  }

  /** Sign-out or a different user in this tab: also forget the browser-held key. */
  clearBrowser() {
    this.clear();
    this.notifyPeers();
    void this.deps.persisted?.clear().catch(() => {});
  }
}

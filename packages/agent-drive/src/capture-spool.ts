import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentDriveApiError, type PutOptions } from './client.js';
import { writeFileSafely } from './safe-write.js';
import { ensurePrivateStateDirectory } from './sync.js';

const HOUR = 3_600_000;
const LOCK_MAX_AGE = 600_000;
export const SPOOL_CAP = 512 * 1024 * 1024;

export class SpoolFullError extends Error {
  constructor() {
    super('spool full');
  }
}

export type SidecarMeta = {
  path: string;
  wrappedKey: string;
  ciphertextSize: number;
  tags: string[];
};

export type UploadClient = {
  putEncrypted(
    driveId: string,
    path: string,
    ciphertext: Uint8Array<ArrayBuffer>,
    wrappedKey: string,
    options?: PutOptions,
  ): Promise<unknown>;
};

async function sizeOfAdrv(dir: string) {
  let total = 0;
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith('.adrv')) continue;
    total += (await stat(join(dir, name)).catch(() => undefined))?.size ?? 0;
  }
  return total;
}

/** Ciphertext and sidecars only. A sidecar that exists is complete (it is published last, atomically). */
export class Spool {
  private constructor(
    readonly dir: string,
    private readonly options: {
      capBytes: number;
      beforePublish: (() => void | Promise<void>) | undefined;
    },
  ) {}

  static async open(
    dir: string,
    options: {
      capBytes?: number;
      beforePublish?: () => void | Promise<void>;
      now?: () => number;
    } = {},
  ) {
    await ensurePrivateStateDirectory(dir);
    await ensurePrivateStateDirectory(join(dir, 'invalid'));
    const now = options.now?.() ?? Date.now();
    const names = await readdir(dir);
    const sidecars = new Set(names.filter((n) => n.endsWith('.json')));
    for (const name of names) {
      const stale =
        name.endsWith('.tmp') ||
        (name.endsWith('.adrv') && !sidecars.has(name.replace(/adrv$/u, 'json')));
      if (!stale) continue;
      const info = await stat(join(dir, name)).catch(() => undefined);
      if (info && now - info.mtimeMs > HOUR) await rm(join(dir, name), { force: true });
    }
    return new Spool(dir, {
      capBytes: options.capBytes ?? SPOOL_CAP,
      beforePublish: options.beforePublish,
    });
  }

  async usedBytes() {
    return (await sizeOfAdrv(this.dir)) + (await sizeOfAdrv(join(this.dir, 'invalid')));
  }

  async queued() {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    return { count: names.length, bytes: await sizeOfAdrv(this.dir) };
  }

  async invalidCount() {
    return (await readdir(join(this.dir, 'invalid')).catch(() => [])).filter((n) =>
      n.endsWith('.json'),
    ).length;
  }

  async add(id: string, ciphertext: Uint8Array<ArrayBuffer>, meta: SidecarMeta) {
    if ((await this.usedBytes()) + ciphertext.byteLength > this.options.capBytes)
      throw new SpoolFullError();
    const adrv = join(this.dir, `${id}.adrv`);
    await writeFile(adrv, ciphertext, { mode: 0o600, flag: 'wx' });
    try {
      await this.options.beforePublish?.();
      await writeFileSafely(join(this.dir, `${id}.json`), JSON.stringify(meta), {
        mode: 0o600,
        overwrite: true,
      });
    } catch (error) {
      await rm(adrv, { force: true });
      throw error;
    }
  }
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readOwner(lock: string) {
  try {
    return JSON.parse(await readFile(join(lock, 'owner'), 'utf8')) as Partial<{
      pid: number;
      startedAt: number;
      token: string;
    }>;
  } catch {
    return undefined;
  }
}

async function lockIsStale(lock: string) {
  const owner = await readOwner(lock);
  if (
    owner &&
    Number.isInteger(owner.pid) &&
    typeof owner.startedAt === 'number' &&
    typeof owner.token === 'string'
  )
    return !pidAlive(owner.pid!);
  const info = await stat(lock).catch(() => undefined);
  return !info || Date.now() - info.mtimeMs > LOCK_MAX_AGE;
}

async function takeLock(dir: string) {
  const lock = join(dir, 'drain.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(
        join(lock, 'owner'),
        JSON.stringify({ pid: process.pid, startedAt: Date.now(), token }),
        { mode: 0o600 },
      );
      // Release only a lock that still carries our token.
      return async () => {
        if ((await readOwner(lock))?.token === token)
          await rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await lockIsStale(lock))) return undefined;
      // Only one contender can rename the stale directory away; re-check what we moved.
      const moved = `${lock}.stale.${randomUUID()}`;
      try {
        await rename(lock, moved);
      } catch {
        continue;
      }
      if (await lockIsStale(moved)) await rm(moved, { recursive: true, force: true });
      else {
        await rename(moved, lock).catch(() => {});
        return undefined;
      }
    }
  }
  return undefined;
}

function classify(error: unknown): 'done' | 'invalid' | 'stop' | 'retry' {
  if (!(error instanceof AgentDriveApiError)) return 'retry';
  if (error.status === 409 && (error.state === 'exists' || error.code === 'exists')) return 'done';
  if (error.status === 400 && error.code === 'validation_error') return 'invalid';
  if (error.status === 429 || error.status >= 500) return 'retry';
  return 'stop'; // 401, 402, 403, 413 and any other client error: files stay for the next run
}

/** Uploads spooled traces in name order. Only one process drains a spool at a time. */
export class Drainer {
  uploaded = 0;
  private lifecycle: 'idle' | 'draining' | 'finishing' | 'blocked' | 'finished' = 'idle';
  private blockedBy: 'lock' | 'provider' | undefined;
  private pending = false;
  private runPromise: Promise<void> | undefined;
  private finishPromise: Promise<void> | undefined;
  private warnedInvalid = false;
  private readonly abort = new AbortController();

  constructor(
    readonly spool: Spool,
    private readonly client: UploadClient,
    private readonly driveId: string,
    private readonly options: {
      log: (line: string) => void;
      minBackoffMs?: number;
      maxBackoffMs?: number;
    },
  ) {}

  kick() {
    if (this.lifecycle === 'finished' || this.blockedBy === 'provider' || this.abort.signal.aborted)
      return;
    this.pending = true;
    if (this.blockedBy === 'lock') {
      this.blockedBy = undefined;
      if (this.lifecycle === 'blocked') this.lifecycle = 'idle';
    }
    this.startRun();
  }

  /** Drains what is left, waiting at most until `deadline` (epoch ms), then stops retrying. */
  async finish(deadline: number) {
    if (this.finishPromise) return this.finishPromise;
    if (this.lifecycle === 'finished') return;
    this.lifecycle = 'finishing';
    if (this.blockedBy !== 'provider') this.pending = true;
    if (deadline <= Date.now()) {
      this.abort.abort();
      this.pending = false;
      this.lifecycle = 'finished';
      return;
    }
    this.startRun();
    const wait = deadline - Date.now();
    this.finishPromise = (async () => {
      const timer = setTimeout(() => this.abort.abort(), wait);
      let stop: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.waitForRuns(),
          new Promise<void>((resolve) => (stop = setTimeout(resolve, wait + 200))),
        ]);
      } finally {
        clearTimeout(stop);
        clearTimeout(timer);
        this.abort.abort();
        this.pending = false;
        this.lifecycle = 'finished';
      }
    })();
    return this.finishPromise;
  }

  protected async releaseLock(release: () => Promise<void>) {
    await release();
  }

  private canContinue() {
    return (
      !this.abort.signal.aborted && this.lifecycle !== 'finished' && this.blockedBy !== 'provider'
    );
  }

  private startRun() {
    if (this.runPromise || !this.canContinue()) return;
    if (this.lifecycle !== 'finishing') this.lifecycle = 'draining';
    const run = this.loop();
    const owner = run.finally(() => {
      if (this.runPromise !== owner) return;
      this.runPromise = undefined;
      if (this.lifecycle === 'draining') this.lifecycle = 'idle';
    });
    this.runPromise = owner;
  }

  private async waitForRuns() {
    while (this.runPromise) await this.runPromise;
  }

  private async loop() {
    try {
      while (this.pending && this.canContinue()) {
        const release = await takeLock(this.spool.dir).catch(() => undefined);
        if (!release) {
          this.blockedBy = 'lock';
          if (this.lifecycle !== 'finishing') this.lifecycle = 'blocked';
          return;
        }
        this.blockedBy = undefined;
        try {
          while (this.pending && this.canContinue()) {
            this.pending = false;
            if (this.lifecycle !== 'finishing') this.lifecycle = 'draining';
            await this.pass();
          }
        } finally {
          await this.releaseLock(release);
        }
      }
    } catch (error) {
      this.blockedBy = 'lock';
      if (this.lifecycle !== 'finishing') this.lifecycle = 'blocked';
      this.options.log(`capture warning: upload failed: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number) {
    return new Promise<boolean>((resolve) => {
      const { signal } = this.abort;
      if (!this.canContinue()) return resolve(false);
      const done = (value: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(true), ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async remove(id: string) {
    if (!this.canContinue()) return;
    await rm(join(this.spool.dir, `${id}.json`), { force: true });
    if (!this.canContinue()) return;
    await rm(join(this.spool.dir, `${id}.adrv`), { force: true });
  }

  private async moveToInvalid(id: string) {
    const invalid = join(this.spool.dir, 'invalid');
    if (!this.canContinue()) return;
    await rename(join(this.spool.dir, `${id}.adrv`), join(invalid, `${id}.adrv`)).catch(() => {});
    if (!this.canContinue()) return;
    await rename(join(this.spool.dir, `${id}.json`), join(invalid, `${id}.json`)).catch(() => {});
    if (!this.canContinue()) return;
    if (!this.warnedInvalid) {
      this.warnedInvalid = true;
      this.options.log(`capture warning: the server rejected a trace; moved it to ${invalid}`);
    }
  }

  private async pass() {
    const names = (await readdir(this.spool.dir)).filter((n) => n.endsWith('.json')).sort();
    for (const name of names) {
      if (!this.canContinue()) return;
      const id = name.slice(0, -5);
      let meta: SidecarMeta;
      let ciphertext: Buffer<ArrayBuffer>;
      try {
        const sidecar = await readFile(join(this.spool.dir, name), 'utf8');
        if (!this.canContinue()) return;
        meta = JSON.parse(sidecar) as SidecarMeta;
        ciphertext = await readFile(join(this.spool.dir, `${id}.adrv`));
      } catch {
        if (!this.canContinue()) return;
        await this.moveToInvalid(id);
        continue;
      }
      if (!this.canContinue()) return;
      let delay = this.options.minBackoffMs ?? 1000;
      for (;;) {
        try {
          await this.client.putEncrypted(this.driveId, meta.path, ciphertext, meta.wrappedKey, {
            mode: 'create',
            tags: meta.tags,
            signal: this.abort.signal,
          });
          if (!this.canContinue()) return;
          this.uploaded++;
          await this.remove(id);
          break;
        } catch (error) {
          if (!this.canContinue()) return;
          const verdict = classify(error);
          if (verdict === 'done') {
            await this.remove(id);
            break;
          }
          if (verdict === 'invalid') {
            await this.moveToInvalid(id);
            break;
          }
          if (verdict === 'stop') {
            this.blockedBy = 'provider';
            if (this.lifecycle !== 'finishing') this.lifecycle = 'blocked';
            const cause = error instanceof AgentDriveApiError ? error.code : 'error';
            this.options.log(
              `capture: uploads stopped (${cause}); traces stay in ${this.spool.dir} for the next run`,
            );
            return;
          }
          if (!(await this.sleep(delay))) return;
          delay = Math.min(delay * 2, this.options.maxBackoffMs ?? 60_000);
        }
      }
    }
  }
}

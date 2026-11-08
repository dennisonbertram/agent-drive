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

async function lockIsStale(lock: string) {
  try {
    const owner = JSON.parse(await readFile(join(lock, 'owner'), 'utf8')) as {
      pid: number;
      startedAt: number;
    };
    return !pidAlive(owner.pid) || Date.now() - owner.startedAt > LOCK_MAX_AGE;
  } catch {
    // The owner file may not be written yet; fall back to the directory's age.
    const info = await stat(lock).catch(() => undefined);
    return !info || Date.now() - info.mtimeMs > LOCK_MAX_AGE;
  }
}

async function takeLock(dir: string) {
  const lock = join(dir, 'drain.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(
        join(lock, 'owner'),
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
        {
          mode: 0o600,
        },
      );
      return () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await lockIsStale(lock))) return undefined;
      await rm(lock, { recursive: true, force: true });
    }
  }
  return undefined;
}

function classify(error: unknown): 'done' | 'invalid' | 'stop' | 'retry' {
  if (!(error instanceof AgentDriveApiError)) return 'retry';
  if (error.status === 409 && error.code === 'exists') return 'done';
  if (error.status === 400 && error.code === 'validation_error') return 'invalid';
  if (error.status === 429 || error.status >= 500) return 'retry';
  return 'stop'; // 401, 402, 403, 413 and any other client error: files stay for the next run
}

/** Uploads spooled traces in name order. Only one process drains a spool at a time. */
export class Drainer {
  uploaded = 0;
  private running: Promise<void> | undefined;
  private again = false;
  private stopped = false;
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
    this.again = true;
    if (this.running || this.stopped || this.abort.signal.aborted) return;
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
  }

  /** Drains what is left, waiting at most until `deadline` (epoch ms), then stops retrying. */
  async finish(deadline: number) {
    this.kick();
    const running = this.running;
    if (!running) return;
    const timer = setTimeout(() => this.abort.abort(), Math.max(0, deadline - Date.now()));
    try {
      await running;
    } finally {
      clearTimeout(timer);
      this.abort.abort();
    }
  }

  private async loop() {
    try {
      const release = await takeLock(this.spool.dir).catch(() => undefined);
      if (!release) return;
      try {
        while (this.again && !this.stopped && !this.abort.signal.aborted) {
          this.again = false;
          await this.pass();
        }
      } finally {
        await release();
      }
    } catch (error) {
      this.options.log(`capture warning: upload failed: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number) {
    return new Promise<boolean>((resolve) => {
      const { signal } = this.abort;
      if (signal.aborted) return resolve(false);
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
    await rm(join(this.spool.dir, `${id}.json`), { force: true });
    await rm(join(this.spool.dir, `${id}.adrv`), { force: true });
  }

  private async moveToInvalid(id: string) {
    const invalid = join(this.spool.dir, 'invalid');
    await rename(join(this.spool.dir, `${id}.adrv`), join(invalid, `${id}.adrv`)).catch(() => {});
    await rename(join(this.spool.dir, `${id}.json`), join(invalid, `${id}.json`)).catch(() => {});
    if (!this.warnedInvalid) {
      this.warnedInvalid = true;
      this.options.log(`capture warning: the server rejected a trace; moved it to ${invalid}`);
    }
  }

  private async pass() {
    const names = (await readdir(this.spool.dir)).filter((n) => n.endsWith('.json')).sort();
    for (const name of names) {
      if (this.stopped || this.abort.signal.aborted) return;
      const id = name.slice(0, -5);
      let meta: SidecarMeta;
      let ciphertext: Buffer<ArrayBuffer>;
      try {
        meta = JSON.parse(await readFile(join(this.spool.dir, name), 'utf8')) as SidecarMeta;
        ciphertext = await readFile(join(this.spool.dir, `${id}.adrv`));
      } catch {
        await this.moveToInvalid(id);
        continue;
      }
      let delay = this.options.minBackoffMs ?? 1000;
      for (;;) {
        try {
          await this.client.putEncrypted(this.driveId, meta.path, ciphertext, meta.wrappedKey, {
            mode: 'create',
            tags: meta.tags,
          });
          this.uploaded++;
          await this.remove(id);
          break;
        } catch (error) {
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
            this.stopped = true;
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

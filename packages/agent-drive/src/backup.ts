import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  utimes,
} from 'node:fs/promises';
import { basename, dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { configPath } from './config.js';
import type { AgentDriveClient } from './client.js';
import { ensurePrivateStateDirectory } from './sync.js';

const execFileAsync = promisify(execFile);

const MAX_BYTES = 5 * 1024 ** 3;
export const BACKUP_MAX_FILES = 5_000;
export const BACKUP_MAX_BYTES = 1024 ** 3;
const LARGE_FILE_BYTES = 64 * 1024 ** 2;
const UPLOAD_WORKERS = 4;
const MANIFEST_SAVE_MS = 2_000;
const PROGRESS_MS = 10_000;
const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_REFRESH_MS = 30 * 1000;
type BackupClient = Pick<AgentDriveClient, 'apiOrigin' | 'put'>;
type Manifest = { files: Record<string, string> };
type IgnoreRules = { files: Set<string>; directories: Set<string> };
type ScannedFile = { path: string; relativePath: string; info: Stats };

function within(root: string, path: string) {
  return path === root || path.startsWith(root + sep);
}

// Canonical path; a missing tail is appended to the realpath of the nearest existing parent.
async function canonical(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(await canonical(parent), basename(absolute));
  }
}

async function* walk(
  directory: string,
  skip: (path: string, isDirectory: boolean) => boolean,
  onError: (directory: string, error: unknown) => void,
): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    onError(directory, error);
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (skip(path, entry.isDirectory())) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(path, skip, onError);
    else if (entry.isFile()) yield path;
  }
}

/** Paths listed by `git ls-files` as ignored; empty when there is no work tree. */
async function gitIgnored(root: string): Promise<IgnoreRules> {
  const rules: IgnoreRules = { files: new Set(), directories: new Set() };
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: root, maxBuffer: 512 * 1024 ** 2 },
    );
    for (const entry of stdout.split('\0')) {
      if (entry.endsWith('/')) rules.directories.add(entry.slice(0, -1));
      else if (entry) rules.files.add(entry);
    }
    return rules;
  } catch (error) {
    // Outside a work tree nothing is ignored; anything else fails closed so an
    // unreadable rule set can never turn into a full upload.
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && /not a git repository/iu.test(stderr)) return rules;
    throw new Error(
      `could not read .gitignore rules: ${error instanceof Error ? error.message : 'error'}`,
    );
  }
}

function isIgnored(relativePath: string, rules: IgnoreRules) {
  // A '.' directory entry means git collapsed the whole root to './'.
  if (rules.directories.has('.')) return true;
  if (rules.files.has(relativePath) || rules.directories.has(relativePath)) return true;
  let slash = relativePath.indexOf('/');
  while (slash > 0) {
    if (rules.directories.has(relativePath.slice(0, slash))) return true;
    slash = relativePath.indexOf('/', slash + 1);
  }
  return false;
}

/**
 * Creates backup-<key>.lock holding this pid by linking a fully written temp
 * file into place, so the lock never exists without a pid. A lock held by a
 * live process with a fresh mtime aborts the run; anything else is stale and
 * is moved aside, removed, and the link retried.
 */
async function takeBackupLock(path: string, prefix: string) {
  for (;;) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, path);
        return () => rm(path, { force: true }).then(() => undefined);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    let fresh = false;
    let holder: number | undefined;
    try {
      fresh = Date.now() - (await lstat(path)).mtimeMs < LOCK_STALE_MS;
      const parsed = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
      if (Number.isInteger(parsed)) {
        try {
          process.kill(parsed, 0);
          holder = parsed;
        } catch (error) {
          // EPERM means the process exists but is owned by another user.
          if ((error as NodeJS.ErrnoException).code === 'EPERM') holder = parsed;
        }
      }
    } catch {
      // Unreadable or already removed: treat it as stale below.
    }
    if (fresh && holder !== undefined)
      throw new Error(`another backup to ${prefix} is already running (pid ${holder})`);
    // Move the stale lock aside before removing it so a new lock can be linked.
    // ponytail: two processes reclaiming the same stale lock at once can both
    // reach the rename; the loser can rename and delete a live lock the winner
    // just linked, after which both believe they hold it.
    const stale = `${path}.${process.pid}.${randomUUID()}.stale`;
    try {
      await rename(path, stale);
      await rm(stale, { force: true });
    } catch {
      // Somebody else reclaimed it first; retry the link.
    }
  }
}

/** Reads a regular file through a no-follow descriptor, refusing if it moved outside root. */
export async function readFileInside(path: string, root: string, expected: Stats) {
  const changed = () => new Error('file changed during backup; refusing to read it');
  const same = (a: Stats) => a.isFile() && a.dev === expected.dev && a.ino === expected.ino;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!same(await handle.stat())) throw changed();
    if (!within(root, await realpath(dirname(path)))) throw changed();
    const bytes = new Uint8Array(await handle.readFile());
    if (!same(await lstat(path)) || !within(root, await realpath(dirname(path)))) throw changed();
    return bytes;
  } finally {
    await handle.close();
  }
}

async function loadManifest(path: string): Promise<Manifest> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    if (value && typeof value.files === 'object') return value;
  } catch {
    // Missing or unreadable: every file is uploaded once, which is safe.
  }
  return { files: {} };
}

async function saveManifest(path: string, manifest: Manifest) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(manifest));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function backupDirectory(
  client: BackupClient,
  driveId: string,
  localRoot: string,
  prefix: string,
  options: {
    dryRun?: boolean;
    keyFile?: string;
    yes?: boolean;
    exclude?: string[];
    gitignore?: boolean;
    maxFiles?: number;
    maxBytes?: number;
    progressIntervalMs?: number;
    log?: (line: string) => void;
  } = {},
) {
  const root = await realpath(resolve(localRoot));
  if (!(await lstat(root)).isDirectory()) throw new Error('backup requires a directory.');
  const remotePrefix = prefix === '/' ? '' : prefix.replace(/\/+$/u, '');
  if (remotePrefix !== '' && !remotePrefix.startsWith('/'))
    throw new Error('--prefix must be an absolute remote path.');
  const config = await canonical(configPath());
  const stateDirectory = `${config}.state`;
  const keyFile = options.keyFile ? await canonical(options.keyFile) : undefined;
  const tempPattern = new RegExp(
    `^${basename(config).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`,
    'u',
  );
  const builtinSkip = (path: string) =>
    path === config ||
    path === `${config}.lock` ||
    path === keyFile ||
    within(stateDirectory, path) ||
    (dirname(path) === dirname(config) && tempPattern.test(basename(path)));
  // Keyed by server, drive, and remote prefix; entries by relative path, never the local path.
  const key = createHash('sha256')
    .update(`${client.apiOrigin}|${driveId}|${remotePrefix}`)
    .digest('hex');
  const manifestPath = join(stateDirectory, `backup-${key}.json`);

  const dryRun = options.dryRun ?? false;
  let releaseLock: (() => Promise<void>) | undefined;
  let refreshLock: NodeJS.Timeout | undefined;
  if (!dryRun) {
    await ensurePrivateStateDirectory(stateDirectory);
    const lockPath = join(stateDirectory, `backup-${key}.lock`);
    releaseLock = await takeBackupLock(lockPath, remotePrefix || '/');
    // Keep the lock's mtime fresh so a reused pid cannot keep it alive forever.
    refreshLock = setInterval(() => {
      void utimes(lockPath, new Date(), new Date()).catch(() => undefined);
    }, LOCK_REFRESH_MS);
    refreshLock.unref();
  }

  const result = { uploaded: 0, unchanged: 0, failed: 0, wouldUpload: [] as string[] };
  let manifest: Manifest | undefined;
  let pendingSave: Promise<void> | undefined;
  try {
    // Scan first: the whole folder is walked before anything is uploaded.
    const ignored = options.gitignore
      ? await gitIgnored(root)
      : { files: new Set<string>(), directories: new Set<string>() };
    const excludes = options.exclude ?? [];
    let skipped = 0;
    const skip = (path: string, isDirectory: boolean) => {
      const relativePath = relative(root, path).split(sep).join('/');
      if (
        builtinSkip(path) ||
        // Git never traverses its control metadata, so honoring the ignore rules
        // also skips .git at any depth — the directory, or the file a linked
        // worktree or submodule puts in its place.
        (options.gitignore && relativePath.split('/').includes('.git')) ||
        isIgnored(relativePath, ignored) ||
        excludes.some(
          (glob) =>
            matchesGlob(relativePath, glob) ||
            // 'build/**' does not match 'build'; test 'build/' too so a matched
            // directory is skipped whole, hidden files included.
            (isDirectory && matchesGlob(`${relativePath}/`, glob)),
        )
      ) {
        skipped++;
        return true;
      }
      return false;
    };
    const onError = (directory: string, error: unknown) => {
      result.failed++;
      options.log?.(
        `failed ${directory}: ${error instanceof Error ? error.message : 'cannot read directory'}`,
      );
    };
    const files: ScannedFile[] = [];
    let totalBytes = 0;
    for await (const path of walk(root, skip, onError)) {
      try {
        const info = await lstat(path);
        if (!info.isFile()) continue;
        files.push({ path, relativePath: relative(root, path).split(sep).join('/'), info });
        totalBytes += info.size;
      } catch (error) {
        result.failed++;
        options.log?.(
          `failed ${path}: ${error instanceof Error ? error.message : 'cannot stat file'}`,
        );
      }
    }
    const totalMb = (totalBytes / 1024 ** 2).toFixed(1);
    options.log?.(
      `backup found ${files.length} files (${totalMb} MB) in ${root}; skipped ${skipped} ignored paths`,
    );
    const maxFiles = options.maxFiles ?? BACKUP_MAX_FILES;
    const maxBytes = options.maxBytes ?? BACKUP_MAX_BYTES;
    if (!dryRun && !options.yes && (files.length > maxFiles || totalBytes > maxBytes))
      throw new Error(
        `backup found ${files.length} files (${totalMb} MB) in ${root}, over the limit of ` +
          `${maxFiles} files or ${Math.floor(maxBytes / 1024 ** 2)} MB; narrow the set with ` +
          '--gitignore or --exclude, preview it with --dry-run, or pass --yes to upload anyway.',
      );

    const loaded = await loadManifest(manifestPath);
    manifest = loaded;

    // Save the manifest at most once every MANIFEST_SAVE_MS while uploading.
    let lastSave = 0;
    const saveSoon = () => {
      if (pendingSave || Date.now() - lastSave < MANIFEST_SAVE_MS) return;
      pendingSave = saveManifest(manifestPath, loaded)
        .then(undefined, (error: unknown) => {
          options.log?.(
            `failed to save the backup manifest: ${
              error instanceof Error ? error.message : 'error'
            }`,
          );
        })
        .finally(() => {
          lastSave = Date.now();
          pendingSave = undefined;
        });
    };

    const processFile = async (file: ScannedFile, upload: boolean) => {
      const remote = `${remotePrefix}/${file.relativePath}`;
      try {
        if (file.info.size > MAX_BYTES) throw new Error('file exceeds the 5 GiB limit');
        const bytes = await readFileInside(file.path, root, file.info);
        if (bytes.byteLength !== file.info.size) throw new Error('file changed since the scan');
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (loaded.files[file.relativePath] === hash) {
          result.unchanged++;
          return;
        }
        if (!upload) {
          result.wouldUpload.push(remote);
          return;
        }
        await client.put(driveId, remote, bytes, { mode: 'overwrite' });
        loaded.files[file.relativePath] = hash;
        result.uploaded++;
        saveSoon();
      } catch (error) {
        result.failed++;
        options.log?.(`failed ${remote}: ${error instanceof Error ? error.message : 'error'}`);
      }
    };

    if (dryRun) {
      for (const file of files) await processFile(file, false);
      return result;
    }

    // Files over 64 MiB run one at a time to bound memory; anything else uses 4 workers.
    let largeChain: Promise<void> = Promise.resolve();
    const oneLargeAtATime = (task: () => Promise<void>) => {
      const outcome = largeChain.then(task);
      largeChain = outcome.then(
        () => undefined,
        () => undefined,
      );
      return outcome;
    };
    let doneBytes = 0;
    let done = 0;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const rate = doneBytes / 1024 ** 2 / Math.max((Date.now() - startedAt) / 1000, 0.001);
      options.log?.(
        `backup progress ${done}/${files.length} uploaded=${result.uploaded} ` +
          `unchanged=${result.unchanged} failed=${result.failed} ${rate.toFixed(1)} MB/s`,
      );
    }, options.progressIntervalMs ?? PROGRESS_MS);
    timer.unref();
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next++;
        const file = files[index];
        if (!file) return;
        try {
          if (file.info.size > LARGE_FILE_BYTES)
            await oneLargeAtATime(() => processFile(file, true));
          else await processFile(file, true);
        } finally {
          done++;
          doneBytes += file.info.size;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: UPLOAD_WORKERS }, () => worker()));
    } finally {
      clearInterval(timer);
    }
    return result;
  } finally {
    clearInterval(refreshLock);
    try {
      // The manifest is always saved once at the end, even after a failure.
      if (pendingSave) await pendingSave;
      if (!dryRun && manifest) {
        try {
          await saveManifest(manifestPath, manifest);
        } catch (error) {
          result.failed++;
          options.log?.(
            `failed to save the backup manifest: ${
              error instanceof Error ? error.message : 'error'
            }`,
          );
        }
      }
    } finally {
      await releaseLock?.();
    }
  }
}

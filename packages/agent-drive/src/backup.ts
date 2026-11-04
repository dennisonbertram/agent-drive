import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { configPath } from './config.js';
import type { AgentDriveClient } from './client.js';
import { ensurePrivateStateDirectory } from './sync.js';

const MAX_BYTES = 5 * 1024 ** 3;
type BackupClient = Pick<AgentDriveClient, 'apiOrigin' | 'put'>;
type Manifest = { files: Record<string, string> };

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
  skip: (path: string) => boolean,
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
    if (skip(path)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(path, skip, onError);
    else if (entry.isFile()) yield path;
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
  options: { dryRun?: boolean; keyFile?: string; log?: (line: string) => void } = {},
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
  const skip = (path: string) =>
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
  const manifest = await loadManifest(manifestPath);
  const result = { uploaded: 0, unchanged: 0, failed: 0, wouldUpload: [] as string[] };

  const onError = (directory: string, error: unknown) => {
    result.failed++;
    options.log?.(
      `failed ${directory}: ${error instanceof Error ? error.message : 'cannot read directory'}`,
    );
  };

  for await (const file of walk(root, skip, onError)) {
    const relativePath = relative(root, file).split(sep).join('/');
    const remote = `${remotePrefix}/${relativePath}`;
    try {
      const info = await lstat(file);
      if (!info.isFile()) continue;
      if (info.size > MAX_BYTES) throw new Error('file exceeds the 5 GiB limit');
      const bytes = await readFileInside(file, root, info);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (manifest.files[relativePath] === hash) {
        result.unchanged++;
        continue;
      }
      if (options.dryRun) {
        result.wouldUpload.push(remote);
        continue;
      }
      await client.put(driveId, remote, bytes, { mode: 'overwrite' });
      manifest.files[relativePath] = hash;
      await ensurePrivateStateDirectory(stateDirectory);
      await saveManifest(manifestPath, manifest);
      result.uploaded++;
    } catch (error) {
      result.failed++;
      options.log?.(`failed ${remote}: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  return result;
}

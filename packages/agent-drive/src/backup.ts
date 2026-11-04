import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { configPath } from './config.js';
import type { AgentDriveClient } from './client.js';
import { ensurePrivateStateDirectory } from './sync.js';

const MAX_BYTES = 5 * 1024 ** 3;
type BackupClient = Pick<AgentDriveClient, 'apiOrigin' | 'put'>;
type Manifest = { files: Record<string, string> };

async function* walk(directory: string, skip: string[]): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (skip.some((value) => path === value || path.startsWith(value + sep))) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(path, skip);
    else if (entry.isFile()) yield path;
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
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
) {
  const root = await realpath(resolve(localRoot));
  if (!(await lstat(root)).isDirectory()) throw new Error('backup requires a directory.');
  const remotePrefix = prefix === '/' ? '' : prefix.replace(/\/+$/u, '');
  if (remotePrefix !== '' && !remotePrefix.startsWith('/'))
    throw new Error('--prefix must be an absolute remote path.');
  const stateDirectory = `${configPath()}.state`;
  const skip = [resolve(configPath()), `${resolve(configPath())}.lock`, resolve(stateDirectory)];
  // Keyed by server, drive, and remote prefix; entries by relative path, never the local path.
  const key = createHash('sha256')
    .update(`${client.apiOrigin}|${driveId}|${remotePrefix}`)
    .digest('hex');
  const manifestPath = join(stateDirectory, `backup-${key}.json`);
  const manifest = await loadManifest(manifestPath);
  const result = { uploaded: 0, unchanged: 0, failed: 0, wouldUpload: [] as string[] };

  for await (const file of walk(root, skip)) {
    const relativePath = relative(root, file).split(sep).join('/');
    const remote = `${remotePrefix}/${relativePath}`;
    try {
      const info = await lstat(file);
      if (!info.isFile()) continue;
      if (info.size > MAX_BYTES) throw new Error('file exceeds the 5 GiB limit');
      const bytes = new Uint8Array(await readFile(file));
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

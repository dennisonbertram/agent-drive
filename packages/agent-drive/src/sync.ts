import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { configPath } from './config.js';
import type { AgentDriveClient, Version } from './client.js';

type ManifestEntry = { hash: string; versionId: string };
type Manifest = { files: Record<string, ManifestEntry> };

function canonicalPrefix(value: string) {
  const prefix = value || '/';
  if (
    !prefix.startsWith('/') ||
    prefix.includes('//') ||
    prefix.includes('\\') ||
    prefix.includes('\u0000') ||
    prefix.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Remote prefix must be a canonical absolute path.');
  }
  return prefix === '/' ? '/' : prefix.replace(/\/+$/u, '');
}

function isWithin(root: string, candidate: string) {
  const value = relative(root, candidate);
  return (
    value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep))
  );
}

async function localFiles(root: string, excluded: string[]) {
  const result: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (excluded.some((value) => path === value || isWithin(value, path))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await visit(root);
  return result.sort();
}

async function digest(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function loadManifest(path: string): Promise<Manifest> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { files: {} };
    const files = (value as { files?: unknown }).files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) return { files: {} };
    return { files: files as Record<string, ManifestEntry> };
  } catch {
    return { files: {} };
  }
}

async function saveManifest(path: string, manifest: Manifest) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function relativeRemotePath(path: string, prefix: string) {
  if (prefix === '/') return path.slice(1);
  const marker = `${prefix}/`;
  return path.startsWith(marker) ? path.slice(marker.length) : undefined;
}

function remotePath(prefix: string, relativePath: string) {
  const clean = relativePath.split(sep).join('/');
  return prefix === '/' ? `/${clean}` : `${prefix}/${clean}`;
}

export async function syncDirectory(
  client: AgentDriveClient,
  driveId: string,
  localRoot: string,
  prefix = '/',
) {
  const root = resolve(localRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Sync root must be a real directory, not a symlink.');
  }
  const remotePrefix = canonicalPrefix(prefix);
  const stateDirectory = join(dirname(configPath()), 'state');
  const excluded = resolve(configPath());
  const stateExcluded = resolve(stateDirectory);
  const excludedPaths = [excluded, stateExcluded];
  const who = await client.whoami();
  const identity = `${client.apiOrigin}|${who.accountId}|${driveId}|${remotePrefix}|${root}`;
  const stateKey = createHash('sha256').update(identity).digest('hex');
  const manifestPath = join(stateDirectory, `${stateKey}.json`);
  const manifest = await loadManifest(manifestPath);
  const remote = new Map<string, Version>();
  let cursor: string | undefined;
  do {
    const page = await client.list(driveId, remotePrefix, 100, cursor);
    for (const file of page.items) {
      const path = relativeRemotePath(file.path, remotePrefix);
      if (path !== undefined) remote.set(path, file);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const files = await localFiles(root, excludedPaths);
  const stats = { uploaded: 0, skipped: 0, conflicts: 0 };
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join('/');
    const remoteFile = remote.get(relativePath);
    const prior = manifest.files[relativePath];
    const hash = await digest(file);
    if (prior && (!remoteFile || remoteFile.id !== prior.versionId)) {
      stats.conflicts++;
      throw new Error(`Remote conflict for ${relativePath}; refusing to overwrite.`);
    }
    if (prior && remoteFile && prior.hash === hash && prior.versionId === remoteFile.id) {
      stats.skipped++;
      continue;
    }
    const bytes = await readFile(file);
    const version = await client.put(
      driveId,
      remotePath(remotePrefix, relativePath),
      bytes,
      remoteFile ? { mode: 'overwrite', ifVersionId: remoteFile.id } : { mode: 'create' },
    );
    manifest.files[relativePath] = { hash, versionId: version.id };
    await saveManifest(manifestPath, manifest);
    stats.uploaded++;
  }
  return { ...stats, accountId: who.accountId, manifestPath };
}

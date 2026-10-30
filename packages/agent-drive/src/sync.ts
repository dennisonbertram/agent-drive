import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { configPath } from './config.js';
import type { AgentDriveClient } from './client.js';

type ManifestEntry = { hash: string; versionId: string };
type Manifest = { files: Record<string, ManifestEntry> };
type FileSelection = {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
};
type SyncClient = Pick<AgentDriveClient, 'apiOrigin' | 'whoami' | 'list' | 'put'>;

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

function sameIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function excludedPath(path: string, excluded: string[]) {
  return excluded.some((value) => path === value || isWithin(value, path));
}

async function realPathWithin(root: string, path: string) {
  const value = await realpath(path);
  if (!isWithin(root, value)) {
    throw new Error('A sync directory entry resolved outside the selected root.');
  }
  return value;
}

async function localFiles(root: string, rootRealPath: string, excluded: string[]) {
  const result: FileSelection[] = [];

  async function visit(
    directory: string,
    expected: { dev: number; ino: number; realPath: string },
  ) {
    const before = await lstat(directory);
    const beforeRealPath = await realPathWithin(rootRealPath, directory);
    if (
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      !sameIdentity(before, expected) ||
      beforeRealPath !== expected.realPath
    ) {
      throw new Error('A sync directory changed during traversal.');
    }

    const entries = await readdir(directory);
    const after = await lstat(directory);
    const afterRealPath = await realPathWithin(rootRealPath, directory);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameIdentity(after, expected) ||
      afterRealPath !== expected.realPath
    ) {
      throw new Error('A sync directory changed during traversal.');
    }

    for (const name of entries) {
      const path = join(directory, name);
      if (excludedPath(path, excluded)) continue;
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      const actualPath = await realPathWithin(rootRealPath, path);
      const confirmed = await lstat(path);
      if (
        confirmed.isSymbolicLink() ||
        !sameIdentity(info, confirmed) ||
        actualPath !== (await realPathWithin(rootRealPath, path))
      ) {
        throw new Error('A sync entry changed during traversal.');
      }
      if (confirmed.isDirectory()) {
        await visit(path, { dev: confirmed.dev, ino: confirmed.ino, realPath: actualPath });
      } else if (confirmed.isFile()) {
        result.push({
          path,
          realPath: actualPath,
          dev: confirmed.dev,
          ino: confirmed.ino,
        });
      }
    }
  }

  const rootInfo = await lstat(root);
  const actualRoot = await realpath(root);
  const rootAfter = await lstat(root);
  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    rootAfter.isSymbolicLink() ||
    !rootAfter.isDirectory() ||
    !sameIdentity(rootInfo, rootAfter) ||
    actualRoot !== rootRealPath ||
    (await realpath(root)) !== rootRealPath
  ) {
    throw new Error('Sync root must be a real directory, not a symlink.');
  }
  await visit(root, { dev: rootInfo.dev, ino: rootInfo.ino, realPath: rootRealPath });
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function readSelectedFile(rootRealPath: string, selected: FileSelection) {
  const changed = () =>
    new Error(`Sync file ${selected.path} changed after enumeration; refusing to read it.`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await lstat(selected.path);
    const beforeRealPath = await realPathWithin(rootRealPath, selected.path);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      !sameIdentity(before, selected) ||
      beforeRealPath !== selected.realPath
    ) {
      throw changed();
    }

    const flags =
      fsConstants.O_RDONLY | (process.platform === 'linux' ? (fsConstants.O_NOFOLLOW ?? 0) : 0);
    handle = await open(selected.path, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(opened, selected)) throw changed();

    if (process.platform === 'linux') {
      let descriptorPath: string | undefined;
      try {
        descriptorPath = await realpath(`/proc/self/fd/${handle.fd}`);
      } catch (error) {
        if (!isCode(error, 'ENOENT') && !isCode(error, 'ENOTDIR')) throw error;
      }
      if (descriptorPath && !isWithin(rootRealPath, descriptorPath)) throw changed();
    }

    const afterRealPath = await realPathWithin(rootRealPath, selected.path);
    const after = await lstat(selected.path);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      !sameIdentity(after, selected) ||
      afterRealPath !== selected.realPath
    ) {
      throw changed();
    }
    return new Uint8Array(await handle.readFile());
  } catch (error) {
    if (error instanceof Error && error.message.includes('refusing to read it')) throw error;
    throw new Error(changed().message, { cause: error });
  } finally {
    await handle?.close();
  }
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadManifest(path: string): Promise<Manifest> {
  let serialized: string;
  try {
    serialized = await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { files: Object.create(null) as Record<string, ManifestEntry> };
    }
    throw new Error('Unable to read the private sync manifest.');
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(
      'The private sync manifest is malformed; refusing to discard conflict history.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'The private sync manifest is malformed; refusing to discard conflict history.',
    );
  }
  const files = (value as { files?: unknown }).files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(
      'The private sync manifest is malformed; refusing to discard conflict history.',
    );
  }
  const safeFiles = Object.create(null) as Record<string, ManifestEntry>;
  for (const [relativePath, entry] of Object.entries(files)) {
    if (
      !relativePath ||
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      relativePath.includes('\u0000') ||
      relativePath.split('/').some((part) => part === '' || part === '.' || part === '..') ||
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as ManifestEntry).hash !== 'string' ||
      !/^[0-9a-f]{64}$/u.test((entry as ManifestEntry).hash) ||
      typeof (entry as ManifestEntry).versionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        (entry as ManifestEntry).versionId,
      )
    ) {
      throw new Error(`The private sync manifest entry for ${relativePath} is malformed.`);
    }
    safeFiles[relativePath] = {
      hash: (entry as ManifestEntry).hash,
      versionId: (entry as ManifestEntry).versionId,
    };
  }
  return { files: safeFiles };
}

async function ensurePrivateStateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const directory = await lstat(path);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
    throw new Error(
      `Sync state directory ${path} must be a real directory accessible only to the current user.`,
    );
  }
}

async function saveManifest(path: string, manifest: Manifest) {
  await ensurePrivateStateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
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
  client: SyncClient,
  driveId: string,
  localRoot: string,
  prefix = '/',
  options: { overwriteExisting?: boolean } = {},
) {
  const root = resolve(localRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Sync root must be a real directory, not a symlink.');
  }
  const rootRealPath = await realpath(root);
  const confirmedRoot = await lstat(root);
  if (
    confirmedRoot.isSymbolicLink() ||
    !confirmedRoot.isDirectory() ||
    !sameIdentity(rootStat, confirmedRoot) ||
    (await realpath(root)) !== rootRealPath
  ) {
    throw new Error('Sync root changed during validation.');
  }
  const remotePrefix = canonicalPrefix(prefix);
  const stateDirectory = `${configPath()}.state`;
  await ensurePrivateStateDirectory(stateDirectory);
  const excluded = resolve(configPath());
  const stateExcluded = resolve(stateDirectory);
  const excludedPaths = [excluded, stateExcluded];
  const who = await client.whoami();
  const identity = `${client.apiOrigin}|${who.accountId}|${driveId}|${remotePrefix}|${root}`;
  const stateKey = createHash('sha256').update(identity).digest('hex');
  const manifestPath = join(stateDirectory, `${stateKey}.json`);
  const manifest = await loadManifest(manifestPath);
  const remote = new Map<string, { versionId: string }>();
  let cursor: string | undefined;
  do {
    const page = await client.list(driveId, remotePrefix, 100, cursor);
    for (const file of page.items) {
      const path = relativeRemotePath(file.path, remotePrefix);
      if (path !== undefined) remote.set(path, { versionId: file.versionId });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const files = await localFiles(root, rootRealPath, excludedPaths);
  const stats = { uploaded: 0, skipped: 0, conflicts: 0 };
  for (const file of files) {
    const relativePath = relative(root, file.path).split(sep).join('/');
    const remoteFile = remote.get(relativePath);
    const prior = Object.hasOwn(manifest.files, relativePath)
      ? manifest.files[relativePath]
      : undefined;
    if (!prior && remoteFile && !options.overwriteExisting) {
      stats.conflicts++;
      throw new Error(
        `Remote file ${relativePath} has no local sync history; use --overwrite-existing to replace it.`,
      );
    }
    const bytes = await readSelectedFile(rootRealPath, file);
    const hash = digest(bytes);
    if (prior && (!remoteFile || remoteFile.versionId !== prior.versionId)) {
      stats.conflicts++;
      throw new Error(`Remote conflict for ${relativePath}; refusing to overwrite.`);
    }
    if (prior && remoteFile && prior.hash === hash && prior.versionId === remoteFile.versionId) {
      stats.skipped++;
      continue;
    }
    const version = await client.put(
      driveId,
      remotePath(remotePrefix, relativePath),
      bytes,
      remoteFile ? { mode: 'overwrite', ifVersionId: remoteFile.versionId } : { mode: 'create' },
    );
    manifest.files[relativePath] = { hash, versionId: version.id };
    await saveManifest(manifestPath, manifest);
    stats.uploaded++;
  }
  return { ...stats, accountId: who.accountId, manifestPath };
}

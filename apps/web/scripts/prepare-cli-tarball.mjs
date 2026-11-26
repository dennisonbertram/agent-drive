import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const packageDirectory = join(repositoryRoot, 'packages/agent-drive');
const webDirectory = resolve(scriptDirectory, '..');
const packageJson = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
const registry = 'https://registry.npmjs.org';
const isProduction = process.env.VERCEL_ENV === 'production';
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'agent-drive-cli-pack-'));

const run = async (command, args, options = {}) => {
  const result = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
  return result.stdout;
};

const extractBinary = async (tarball, path) => {
  const { stdout } = await execFileAsync('tar', ['-xOzf', tarball, path], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 33 * 1024 * 1024,
  });
  return stdout;
};

const downloadRegistryTarball = async (packageSpec, integrity) => {
  const tarballUrl = JSON.parse(
    await run('npm', ['view', packageSpec, 'dist.tarball', '--json', `--registry=${registry}`]),
  );
  const url = new URL(tarballUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') {
    throw new Error(`Unexpected registry tarball host: ${url.origin}`);
  }
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || !response.body)
    throw new Error(
      `Could not download ${packageSpec} from npm registry (HTTP ${response.status}).`,
    );

  const tarball = join(temporaryDirectory, 'agent-drive-release.tgz');
  const hash = createHash('sha512');
  let total = 0;
  const integrityTransform = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > 80 * 1024 * 1024)
        return callback(new Error('npm CLI tarball exceeds the 80 MiB package bound.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    integrityTransform,
    createWriteStream(tarball, { flags: 'wx' }),
  );
  if (`sha512-${hash.digest('base64')}` !== integrity)
    throw new Error('Downloaded CLI tarball does not match npm registry integrity.');
  return tarball;
};

const packageManifest = async (tarball) => {
  const listing = (await run('tar', ['-tzf', tarball])).trim().split('\n').filter(Boolean);
  for (const entry of listing) {
    if (
      !entry.startsWith('package/') ||
      entry.startsWith('/') ||
      entry.split('/').includes('..') ||
      entry.includes('\\')
    ) {
      throw new Error(`Unsafe package path in CLI tarball: ${entry}`);
    }
  }
  const result = await run('tar', ['-xOzf', tarball, 'package/package.json']);
  const manifest = JSON.parse(result);
  if (manifest.name !== packageJson.name || manifest.version !== packageJson.version) {
    throw new Error(`CLI tarball identity mismatch: ${manifest.name}@${manifest.version}`);
  }
  return listing;
};

const checkNativeHelpers = async (tarball, listing, { allowMissing }) => {
  const helpers = [
    ['package/native/linux-x64/agent-drive-mount', 62],
    ['package/native/linux-arm64/agent-drive-mount', 183],
  ];
  const present = helpers.filter(([path]) => listing.includes(path));
  if (present.length === 0 && allowMissing) return;
  if (present.length !== helpers.length)
    throw new Error('CLI tarball must include both Linux mount helpers.');

  const verboseListing = (await run('tar', ['-tvzf', tarball])).trim().split('\n');
  for (const [archivePath] of helpers) {
    const entry = verboseListing.find((line) => line.endsWith(` ${archivePath}`));
    if (
      !entry ||
      !entry.startsWith('-') ||
      !/^\S{10}/.test(entry) ||
      !/[x]/.test(entry.slice(1, 10))
    ) {
      throw new Error(`Packaged mount helper is missing or not executable: ${archivePath}`);
    }
  }

  const extractedDirectory = join(temporaryDirectory, 'native-check');
  await mkdir(extractedDirectory, { recursive: true });
  for (const [archivePath, machine] of helpers) {
    const bytes = await extractBinary(tarball, archivePath);
    const destination = join(extractedDirectory, archivePath.split('/').slice(-2).join('-'));
    await writeFile(destination, bytes, { mode: 0o700 });
    const { inspectMountHelper } = await import(
      '../../../packages/agent-drive/scripts/check-native-mount.mjs'
    );
    await inspectMountHelper(destination, machine);
  }
};

try {
  let tarball;
  if (isProduction) {
    const packageSpec = `${packageJson.name}@${packageJson.version}`;
    const integrityOutput = await run('npm', [
      'view',
      packageSpec,
      'dist.integrity',
      '--json',
      `--registry=${registry}`,
    ]);
    const registryIntegrity = JSON.parse(integrityOutput);
    if (typeof registryIntegrity !== 'string' || !registryIntegrity.startsWith('sha512-')) {
      throw new Error(`npm registry returned no SHA-512 integrity for ${packageSpec}`);
    }
    tarball = await downloadRegistryTarball(packageSpec, registryIntegrity);
  } else {
    const packed = await run('npm', [
      'pack',
      '--json',
      '--pack-destination',
      temporaryDirectory,
      packageDirectory,
    ]);
    const packInfo = JSON.parse(packed)[0];
    tarball = join(temporaryDirectory, packInfo.filename);
  }

  const listing = await packageManifest(tarball);
  await checkNativeHelpers(tarball, listing, { allowMissing: !isProduction });
  const outputDirectory = join(webDirectory, 'public/cli');
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, 'agent-drive.tgz');
  try {
    const existing = await lstat(output);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new Error(`Refusing to replace non-file CLI output: ${output}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const stagingDirectory = await mkdtemp(join(outputDirectory, '.cli-pack-'));
  try {
    const stagedOutput = join(stagingDirectory, 'agent-drive.tgz');
    await copyFile(tarball, stagedOutput);
    await rename(stagedOutput, output);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  console.log(
    `Prepared ${isProduction ? 'registry' : 'local'} CLI tarball ${packageJson.name}@${packageJson.version}`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

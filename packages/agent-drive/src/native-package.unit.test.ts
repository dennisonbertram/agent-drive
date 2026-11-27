import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  MAX_MOUNT_HELPER_BYTES,
  inspectMountHelper,
  verifyNativeMountPackage,
} from '../scripts/check-native-mount.mjs';

const directories: string[] = [];
afterEach(() =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

it('includes the native helper verifier in the published package allowlist', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { files?: string[] };
  expect(metadata.files).toContain('scripts/check-native-mount.mjs');
});

async function packageRoot() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-native-package-'));
  directories.push(directory);
  return directory;
}

function elf(machine: number, dynamic = false) {
  const bytes = Buffer.alloc(120);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(1, 56);
  if (dynamic) bytes.writeUInt32LE(3, 64);
  return bytes;
}

async function writeHelper(root: string, platform: 'linux-x64' | 'linux-arm64', machine: number) {
  const directory = join(root, 'native', platform);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'agent-drive-mount');
  await writeFile(path, elf(machine));
  await chmod(path, 0o755);
  return path;
}

it('requires both executable static helpers with the matching Linux ELF machines', async () => {
  const root = await packageRoot();
  await writeHelper(root, 'linux-x64', 62);
  await writeHelper(root, 'linux-arm64', 183);
  await expect(verifyNativeMountPackage(root)).resolves.toEqual([120, 120]);
});

it('permits a preview package with neither helper, but rejects a partial pair', async () => {
  const root = await packageRoot();
  await expect(verifyNativeMountPackage(root, { allowMissing: true })).resolves.toEqual([]);
  await writeHelper(root, 'linux-x64', 62);
  await expect(verifyNativeMountPackage(root, { allowMissing: true })).rejects.toThrow(
    /both Linux mount helpers/u,
  );
});

it('rejects wrong architecture and missing executable mode', async () => {
  const root = await packageRoot();
  const x64 = await writeHelper(root, 'linux-x64', 183);
  await writeHelper(root, 'linux-arm64', 183);
  await expect(verifyNativeMountPackage(root)).rejects.toThrow(/wrong ELF machine/u);
  await writeFile(x64, elf(62));
  await chmod(x64, 0o644);
  await expect(inspectMountHelper(x64, 62)).rejects.toThrow(/not executable/u);
});

it('rejects a dynamic ELF interpreter and an oversized binary', async () => {
  const root = await packageRoot();
  const x64 = await writeHelper(root, 'linux-x64', 62);
  const arm64 = await writeHelper(root, 'linux-arm64', 183);
  await writeFile(x64, elf(62, true));
  await expect(inspectMountHelper(x64, 62)).rejects.toThrow(/dynamic ELF interpreter/u);
  await writeFile(arm64, Buffer.alloc(MAX_MOUNT_HELPER_BYTES + 1));
  await expect(inspectMountHelper(arm64, 183)).rejects.toThrow(/allowed range/u);
});

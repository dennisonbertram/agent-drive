import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_MOUNT_HELPER_BYTES = 32 * 1024 * 1024;

const targets = [
  { directory: 'linux-x64', machine: 62 },
  { directory: 'linux-arm64', machine: 183 },
];

export async function inspectMountHelper(path, expectedMachine) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Mount helper must be a regular file: ${path}`);
  if ((info.mode & 0o111) === 0) throw new Error(`Mount helper is not executable: ${path}`);
  if (info.size < 64 || info.size > MAX_MOUNT_HELPER_BYTES)
    throw new Error(`Mount helper size is outside the allowed range: ${path}`);

  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) throw new Error(`Truncated ELF header: ${path}`);
    if (
      header[0] !== 0x7f ||
      header.toString('ascii', 1, 4) !== 'ELF' ||
      header[4] !== 2 ||
      header[5] !== 1
    )
      throw new Error(`Mount helper must be a little-endian 64-bit ELF binary: ${path}`);

    const machine = header.readUInt16LE(18);
    if (machine !== expectedMachine)
      throw new Error(`Mount helper has the wrong ELF machine (${machine}): ${path}`);

    const programOffset = header.readBigUInt64LE(32);
    const programEntrySize = header.readUInt16LE(54);
    const programCount = header.readUInt16LE(56);
    if (programCount > 1024 || programEntrySize < 4)
      throw new Error(`Mount helper has an invalid ELF program header table: ${path}`);
    const tableEnd = programOffset + BigInt(programEntrySize) * BigInt(programCount);
    if (tableEnd > BigInt(info.size))
      throw new Error(`Mount helper has a truncated ELF program header table: ${path}`);
    for (let i = 0; i < programCount; i++) {
      const entry = Buffer.alloc(4);
      const position = Number(programOffset + BigInt(programEntrySize) * BigInt(i));
      const result = await handle.read(entry, 0, entry.length, position);
      if (result.bytesRead !== entry.length)
        throw new Error(`Truncated ELF program header: ${path}`);
      if (entry.readUInt32LE(0) === 3)
        throw new Error(`Mount helper must not require a dynamic ELF interpreter: ${path}`);
    }
  } finally {
    await handle.close();
  }
  return info.size;
}

export async function verifyNativeMountPackage(packageDirectory, { allowMissing = false } = {}) {
  const packageRoot = resolve(packageDirectory);
  const binaries = targets.map(({ directory, machine }) => ({
    directory,
    machine,
    path: join(packageRoot, 'native', directory, 'agent-drive-mount'),
  }));
  const present = await Promise.all(
    binaries.map(async ({ path }) => {
      try {
        await lstat(path);
        return true;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return false;
        throw error;
      }
    }),
  );
  if (present.every((value) => !value) && allowMissing) return [];
  if (present.some((value) => !value))
    throw new Error('The package must include both Linux mount helpers (x64 and arm64).');
  const sizes = [];
  for (const binary of binaries) {
    sizes.push(await inspectMountHelper(binary.path, binary.machine));
  }
  return sizes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [packageDirectory = '.', ...flags] = process.argv.slice(2);
    const allowMissing = flags.includes('--allow-missing');
    await verifyNativeMountPackage(packageDirectory, { allowMissing });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Mount helper package check failed.');
    process.exitCode = 1;
  }
}

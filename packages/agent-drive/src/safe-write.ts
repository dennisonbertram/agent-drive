import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writes `data` to `path` through a temp file in the same directory (O_EXCL, O_NOFOLLOW),
 * then renames it into place. Never follows or modifies a symlink at `path`. Without
 * `overwrite`, an existing path fails with EEXIST instead of being replaced.
 */
export async function writeFileSafely(
  path: string,
  data: string,
  options: { mode: number; overwrite: boolean },
) {
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink())
    throw new Error(`${path} is a symlink; refusing to write through it.`);
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    options.mode,
  );
  try {
    try {
      await handle.chmod(options.mode);
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.overwrite) await rename(temporary, path);
    else await link(temporary, path); // fails with EEXIST rather than replacing
  } finally {
    await rm(temporary, { force: true });
  }
}

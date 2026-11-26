import type { PoolClient } from 'pg';
import { ApiError } from './errors';

/**
 * The authoritative check runs while the caller holds the drive row lock. Reject exact directory
 * paths and ancestors of explicit directories; descendants remain valid files inside a directory.
 */
export async function assertNoExplicitDirectoryAtFilePath(
  client: PoolClient,
  driveId: string,
  path: string,
) {
  const directoryPrefix = `${path.replace(/[\\%_]/g, '\\$&')}/%`;
  const directory = await client.query(
    `SELECT id FROM drive_directories
      WHERE drive_id = $1 AND (path = $2 OR path LIKE $3 ESCAPE '\\')
      LIMIT 1`,
    [driveId, path, directoryPrefix],
  );
  if (directory.rowCount)
    throw new ApiError('conflict', 'An explicit directory exists at this file path.');
}

/**
 * Reject a destination that would make a live file an ancestor or descendant of another live
 * file. The caller must hold the drive row lock shared by file and directory mutations. Exact
 * ancestor lookups use the drive/path index; descendant lookups use the live path-prefix index.
 * The moving source is excluded so a legacy collision can be resolved by moving that file away.
 */
export async function assertNoLiveFileNamespaceCollision(
  client: PoolClient,
  driveId: string,
  destinationPath: string,
  movingFileId: string | null,
) {
  const ancestors: string[] = [];
  for (
    let separator = destinationPath.indexOf('/', 1);
    separator !== -1;
    separator = destinationPath.indexOf('/', separator + 1)
  )
    ancestors.push(destinationPath.slice(0, separator));

  const escapedPrefix = destinationPath.replace(/[\\%_]/g, '\\$&');
  const result = await client.query(
    `SELECT id FROM files
      WHERE drive_id = $1 AND deleted_at IS NULL AND ($4::uuid IS NULL OR id <> $4)
        AND (path = ANY($2::text[]) OR path LIKE $3 ESCAPE '\\')
      LIMIT 1`,
    [driveId, ancestors, `${escapedPrefix}/%`, movingFileId],
  );
  if (result.rowCount)
    throw new ApiError('conflict', 'A live file already occupies this path as a file or folder.');
}

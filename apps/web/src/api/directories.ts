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

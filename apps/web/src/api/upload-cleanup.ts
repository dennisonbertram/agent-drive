import { withTransaction } from '../db/client';
import { deleteObject } from './storage';

type ExpiredIntent = { id: string; staging_key: string };

export async function cleanupExpiredUploads(limit = 25, accountId?: string) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Cleanup limit must be an integer between 1 and 100.');
  }

  return withTransaction(async (client) => {
    const params: unknown[] = [];
    const accountClause = accountId ? ` AND account_id = $${params.push(accountId)}` : '';
    params.push(limit);
    const expired = await client.query(
      `SELECT id, staging_key FROM upload_intents
        WHERE expires_at < now() - interval '60 seconds'${accountClause}
        ORDER BY expires_at, id
        LIMIT $${params.length}
        FOR UPDATE SKIP LOCKED`,
      params,
    );

    for (const intent of expired.rows as ExpiredIntent[]) {
      if (!intent.staging_key.startsWith('staging/')) {
        throw new Error('Refusing to remove a non-staging object.');
      }
      await deleteObject(intent.staging_key);
      const removed = await client.query(
        'DELETE FROM upload_intents WHERE id = $1 AND staging_key = $2 RETURNING id',
        [intent.id, intent.staging_key],
      );
      if (removed.rowCount !== 1) throw new Error('Expired upload intent changed during cleanup.');
    }
    return expired.rows.length;
  });
}

export async function cleanupAllExpiredUploads(batchSize = 25) {
  let total = 0;
  while (true) {
    const cleaned = await cleanupExpiredUploads(batchSize);
    total += cleaned;
    if (cleaned < batchSize) return total;
  }
}

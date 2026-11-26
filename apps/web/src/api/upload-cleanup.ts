import { getPool, withTransaction } from '../db/client';
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

const UPLOAD_CLEANUP_INTERVAL_MS = 60_000;
const UPLOAD_CLEANUP_FAILURE_RETRY_MS = 5_000;

type OpportunisticUploadCleanupOptions = {
  run?: () => Promise<number>;
  warn?: (message: string) => void;
  now?: () => number;
};

export function createOpportunisticUploadCleanup(options: OpportunisticUploadCleanupOptions = {}) {
  const run = options.run ?? cleanupExpiredUploads;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const now = options.now ?? (() => Date.now());

  let nextEligibleAt = 0;
  let running = false;
  return async function maybeCleanupExpiredUploads(): Promise<boolean> {
    const startedAt = now();
    if (running || startedAt < nextEligibleAt) return false;
    running = true;
    nextEligibleAt = startedAt + UPLOAD_CLEANUP_INTERVAL_MS;
    try {
      await run();
    } catch {
      nextEligibleAt = now() + UPLOAD_CLEANUP_FAILURE_RETRY_MS;
      warn('Expired upload cleanup failed. A later request will retry.');
    } finally {
      running = false;
    }
    return true;
  };
}

export const maybeCleanupExpiredUploads = createOpportunisticUploadCleanup();

export async function cleanupDeviceAuthorizations() {
  const removed = await getPool().query(
    "DELETE FROM device_authorizations WHERE created_at < now() - interval '24 hours'",
  );
  return removed.rowCount ?? 0;
}

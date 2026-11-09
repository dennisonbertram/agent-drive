import { Pool, type PoolClient, type QueryResultRow } from 'pg';

let pool: Pool | undefined;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (process.env.NODE_ENV === 'production' && !connectionString) {
      throw new Error('DATABASE_URL is required in production.');
    }
    pool = new Pool({
      connectionString:
        connectionString ??
        'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
    });
  }
  return pool;
}

export class TransactionCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super('The transaction commit outcome is unknown.', { cause });
    this.name = 'TransactionCommitUnknownError';
  }
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let phase: 'starting' | 'active' | 'committing' | 'committed' = 'starting';
  let discard = false;
  try {
    await client.query('BEGIN');
    phase = 'active';
    const result = await callback(client);
    phase = 'committing';
    await client.query('COMMIT');
    phase = 'committed';
    return result;
  } catch (error) {
    if (phase === 'committing') {
      discard = true;
      // A lost COMMIT reply is not proof of rollback. External objects must be retained.
      throw new TransactionCommitUnknownError(error);
    }
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export type Row = QueryResultRow & Record<string, unknown>;

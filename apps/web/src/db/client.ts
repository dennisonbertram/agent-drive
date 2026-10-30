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

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type Row = QueryResultRow & Record<string, unknown>;

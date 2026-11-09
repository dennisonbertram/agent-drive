import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionCommitUnknownError, withTransaction } from './client';

const { query, release, connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  return { query, release, connect: vi.fn(async () => ({ query, release })) };
});

vi.mock('pg', () => ({
  Pool: class {
    connect = connect;
  },
}));

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  release.mockReset();
});

describe('transaction lifecycle', () => {
  it('returns only after the commit is acknowledged', async () => {
    await expect(withTransaction(async () => 'saved')).resolves.toBe('saved');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(release).toHaveBeenCalledWith(false);
  });

  it('rolls back callback failures and preserves their identity', async () => {
    const failure = new Error('invalid operation');
    await expect(
      withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledWith(false);
  });

  it('distinguishes an unknown commit from a rollback and discards its connection', async () => {
    const failure = new Error('connection lost after commit');
    query.mockImplementation(async (sql) => {
      if (sql === 'COMMIT') throw failure;
      return { rows: [] };
    });
    await expect(withTransaction(async () => 'saved')).rejects.toMatchObject({
      name: 'TransactionCommitUnknownError',
      cause: failure,
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(release).toHaveBeenCalledWith(true);
  });

  it('preserves the original failure and discards a connection when rollback fails', async () => {
    const failure = new Error('operation failed');
    query.mockImplementation(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    });
    const result = withTransaction(async () => {
      throw failure;
    });
    await expect(result).rejects.toBe(failure);
    await expect(result).rejects.not.toBeInstanceOf(TransactionCommitUnknownError);
    expect(release).toHaveBeenCalledWith(true);
  });
});

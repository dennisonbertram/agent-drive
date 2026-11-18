import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest, handleConsoleApiRequest } from './handler';

const { query, state, ids } = vi.hoisted(() => {
  const ids = {
    ACCOUNT: 'aaaaaaaa-0000-4000-8000-000000000001',
    AGENT: 'aaaaaaaa-0000-4000-8000-000000000002',
    KEY: 'aaaaaaaa-0000-4000-8000-000000000003',
  };
  const state = { requests: 1 };
  const query = vi.fn(async (...args: [sql: string, params?: unknown[]]) => {
    const [sql] = args;
    if (sql.includes('pg_advisory_xact_lock')) return {};
    if (sql.includes('console_user_tombstones')) return { rowCount: 0 };
    if (sql.includes('SELECT id, name, deleting_at FROM accounts')) return { rows: [] };
    if (sql.includes('INSERT INTO accounts'))
      return { rows: [{ id: ids.ACCOUNT, name: 'Personal workspace' }] };
    if (sql.includes('INSERT INTO agents')) return { rows: [{ id: ids.AGENT }] };
    if (sql.includes('SELECT id FROM drives')) return { rows: [] };
    if (sql.includes('SELECT deleting_at FROM accounts')) return { rows: [{ deleting_at: null }] };
    if (sql.includes('console_rate_limits'))
      return { rows: [{ requests: state.requests, retry_after: 42 }] };
    if (sql.includes('api_key_rate_limits')) return { rows: [{ requests: 1, retry_after: 42 }] };
    if (sql.includes('FROM api_keys'))
      return {
        rows: [
          {
            id: ids.KEY,
            account_id: ids.ACCOUNT,
            agent_id: ids.AGENT,
            scopes: ['read'],
            write_paths: [],
            drive_ids: [],
          },
        ],
      };
    if (sql.includes('INSERT INTO audit_events')) return { rows: [{ id: 'a' }] };
    return { rows: [], rowCount: 0 };
  });
  return { query, state, ids };
});

const fakeClient = { query };
const fakePool = { query };

vi.mock('../db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/client')>();
  return {
    ...actual,
    getPool: () => fakePool,
    withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(fakeClient)),
  };
});

const consoleWhoami = () =>
  handleConsoleApiRequest(new Request('http://localhost/api/console/whoami'), 'user_123');

afterEach(() => {
  vi.unstubAllEnvs();
  query.mockClear();
  state.requests = 1;
});

describe('console rate limit', () => {
  it('rejects with 429 and Retry-After when the minute window is exceeded', async () => {
    vi.stubEnv('CONSOLE_REQUESTS_PER_MINUTE', '1');
    state.requests = 2;
    const response = await consoleWhoami();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).not.toContain('API key');
    const upsert = query.mock.calls.find(([sql]) => String(sql).includes('console_rate_limits'));
    expect(upsert?.[1]).toEqual([ids.ACCOUNT]);
  });

  it('allows console requests under the limit', async () => {
    const response = await consoleWhoami();
    expect(response.status).toBe(200);
  });

  it('fails closed when CONSOLE_REQUESTS_PER_MINUTE is invalid', async () => {
    vi.stubEnv('CONSOLE_REQUESTS_PER_MINUTE', 'abc');
    const response = await consoleWhoami();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
  });

  it('keeps bearer requests on the API key limiter only', async () => {
    const response = await handleApiRequest(
      new Request('http://localhost/api/v1/whoami', {
        headers: { authorization: 'Bearer adk_test' },
      }),
    );
    expect(response.status).toBe(200);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('api_key_rate_limits'))).toBe(true);
    expect(statements.some((sql) => sql.includes('console_rate_limits'))).toBe(false);
  });
});

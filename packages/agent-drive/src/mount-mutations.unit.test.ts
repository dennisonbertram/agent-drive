import { describe, expect, it, vi } from 'vitest';
import { AgentDriveApiError, AgentDriveClient } from './client.js';

const driveId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000008';
const operationId = '00000000-0000-4000-8000-00000000000a';

describe('AgentDriveClient mount mutations', () => {
  it('uses only explicit authenticated endpoints and sends every guard', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname.endsWith('/mkdir'))
        return Response.json(
          { path: '/docs', directory_id: 'directory-1', created_at: 'now' },
          {
            status: 201,
          },
        );
      if (url.pathname.endsWith('/rmdir')) return Response.json({ path: '/docs' });
      if (url.pathname.endsWith('/rename'))
        return Response.json({ id: 'file-1', path: '/docs/renamed.txt', versionId });
      return Response.json({ id: 'file-1', path: '/docs/renamed.txt', deleted_at: 'now' });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'synthetic-token',
      fetch: fetcher,
    });

    await client.mkdir(driveId, '/docs');
    await client.rmdir(driveId, '/docs');
    await client.rename(driveId, '/docs/source.txt', '/docs/renamed.txt', {
      ifSourceVersionId: versionId,
      ifDestinationVersionId: null,
      operationId,
    });
    await client.unlink(driveId, '/docs/renamed.txt', versionId);

    expect(calls.map(({ url }) => url.pathname)).toEqual([
      `/api/v1/drives/${driveId}/mkdir`,
      `/api/v1/drives/${driveId}/rmdir`,
      `/api/v1/drives/${driveId}/rename`,
      `/api/v1/drives/${driveId}/unlink`,
    ]);
    expect(calls.map(({ init }) => init?.method)).toEqual(['POST', 'POST', 'POST', 'POST']);
    expect(calls.map(({ init }) => JSON.parse(String(init?.body)))).toEqual([
      { path: '/docs' },
      { path: '/docs' },
      {
        path: '/docs/source.txt',
        destinationPath: '/docs/renamed.txt',
        ifSourceVersionId: versionId,
        ifDestinationVersionId: null,
        operationId,
      },
      { path: '/docs/renamed.txt', ifVersionId: versionId },
    ]);
    expect(
      calls.every(
        ({ init }) => new Headers(init?.headers).get('authorization') === 'Bearer synthetic-token',
      ),
    ).toBe(true);
  });

  it('does not fall back to the legacy unconditional delete endpoint', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(
        { error: { code: 'not_found', message: 'Endpoint not found.' } },
        { status: 404 },
      ),
    );
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'synthetic-token',
      fetch: fetcher,
    });

    await expect(client.unlink(driveId, '/docs/renamed.txt', versionId)).rejects.toBeInstanceOf(
      AgentDriveApiError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/drives/${driveId}/unlink`);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AgentDriveClient, AgentDriveApiError } from './client.js';

describe('AgentDriveClient transport guards', () => {
  it('rejects remote HTTP and API credentials or fragments', () => {
    expect(() => new AgentDriveClient({ apiUrl: 'http://example.test', apiKey: 'x' })).toThrow();
    expect(
      () => new AgentDriveClient({ apiUrl: 'https://user:pass@example.test', apiKey: 'x' }),
    ).toThrow();
    expect(
      () => new AgentDriveClient({ apiUrl: 'https://example.test/#secret', apiKey: 'x' }),
    ).toThrow();
    expect(
      () => new AgentDriveClient({ apiUrl: 'http://127.0.0.1:3000', apiKey: 'x' }),
    ).not.toThrow();
  });

  it('keeps plaintext and both credentials away from the wrong endpoint', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ? { url: String(input), init } : { url: String(input) });
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            intentId: 'i',
            uploadUrl: 'http://127.0.0.1:9000/upload?X-Amz-Signature=x',
            ciphertextSize: 0,
          }),
          { status: 201 },
        );
      }
      if (calls.length === 2) return new Response('', { status: 200 });
      return new Response(JSON.stringify({ version: { id: 'v', path: '/x' } }), { status: 201 });
    });
    const driveKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const plaintext = new TextEncoder().encode('sensitive plaintext marker');
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'secret-token',
      driveKey,
      fetch: fetcher,
    });
    await client.put('d', '/x', plaintext);
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer secret-token');
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBeNull();
    expect(calls[1]?.url).toContain('X-Amz-Signature=x');
    const metadata = JSON.stringify(JSON.parse(String(calls[0]?.init?.body)));
    expect(metadata).toContain('"ifVersionId":null');
    expect(metadata).not.toContain('sensitive plaintext marker');
    expect(metadata).not.toContain('secret-token');
    expect(metadata).not.toContain(driveKey);
    expect(String(calls[1]?.init?.body)).not.toContain('sensitive plaintext marker');
    expect(calls[1]?.init?.body).not.toEqual(plaintext);
    expect(calls[1]?.url).not.toContain('secret-token');
    expect(calls[1]?.url).not.toContain(driveKey);
    expect(JSON.stringify(calls[1]?.init?.headers)).not.toContain('secret-token');
    expect(JSON.stringify(calls[1]?.init?.headers)).not.toContain(driveKey);
  });

  it('rejects create-only writes combined with a version guard before sending a request', async () => {
    const fetcher = vi.fn();
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'token',
      driveKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fetch: fetcher,
    });
    await expect(
      client.put('d', '/x', new Uint8Array(), { mode: 'create', ifVersionId: 'version' }),
    ).rejects.toThrow('Create-only writes cannot include ifVersionId');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps typed API errors without logging raw responses', async () => {
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: 'permission_denied', message: 'no' } }), {
          status: 403,
        }),
    });
    await expect(client.whoami()).rejects.toEqual(
      new AgentDriveApiError('permission_denied', 403, 'no'),
    );
  });
});

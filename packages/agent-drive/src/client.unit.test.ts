import { describe, expect, it, vi } from 'vitest';
import { AgentDriveClient, AgentDriveApiError } from './client.js';
import { decodeDriveKey, encryptFile, generateDriveKey } from './crypto.js';
import { seal } from './crypto-format.js';
import { createTraceInbox, sealFileKeyToInbox } from './trace-inbox.js';

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

  it('createKey sends writePaths only when given', async () => {
    const bodies: unknown[] = [];
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'token',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      },
    });
    await client.createKey('a', 'l', ['d'], ['read']);
    await client.createKey('a', 'l', ['d'], ['read', 'write'], ['/inbox/x']);
    expect(bodies[0]).not.toHaveProperty('writePaths');
    expect(bodies[1]).toMatchObject({ writePaths: ['/inbox/x'] });
    await client.createKey(undefined, 'l', ['d'], ['read'], ['/outputs'], 'sandbox-b');
    expect(bodies[2]).toEqual({
      agentName: 'sandbox-b',
      label: 'l',
      driveIds: ['d'],
      scopes: ['read'],
      writePaths: ['/outputs'],
    });
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

  it('keeps conflict state and a UUID current version, and drops forged values', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const bodies = [
      { code: 'conflict', message: 'x', state: 'changed', currentVersionId: id },
      { code: 'conflict', message: 'x', state: 'absent', currentVersionId: null },
      { code: 'conflict', message: 'x', state: 'bogus', currentVersionId: 'not-a-uuid' },
      { code: 'conflict', message: 'x', currentVersionId: '11111111-1111-ffff-ffff-111111111111' },
    ];
    const fetcher = vi.fn();
    for (const error of bodies)
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status: 409 }));
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      fetch: fetcher,
    });
    await expect(client.whoami()).rejects.toMatchObject({ state: 'changed', currentVersionId: id });
    await expect(client.whoami()).rejects.toMatchObject({
      state: 'absent',
      currentVersionId: null,
    });
    for (let i = 0; i < 2; i++) {
      const forged = await client.whoami().catch((e) => e);
      expect(forged.state).toBeUndefined();
      expect(forged.currentVersionId).toBeUndefined();
    }
  });

  it('preserves only safe actionable API metadata', async () => {
    const responses = [
      {
        error: {
          code: 'payment_required',
          message: 'quota reached',
          upgradeUrl: 'https://billing.example.test/console/billing',
          retryAfter: 30,
        },
      },
      {
        error: {
          code: 'payment_required',
          message: 'quota reached',
          upgradeUrl: 'http://remote.example.test/upgrade',
          retryAfter: -1,
        },
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[0]), { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[1]), { status: 402 }));
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      fetch: fetcher,
    });
    await expect(client.whoami()).rejects.toMatchObject({
      upgradeUrl: 'https://billing.example.test/console/billing',
      retryAfter: 30,
    });
    await expect(client.whoami()).rejects.toMatchObject({
      upgradeUrl: undefined,
      retryAfter: undefined,
    });
  });

  describe('waitForRecent', () => {
    const page = (items: unknown[], latestCursor: string | null = null) =>
      new Response(JSON.stringify({ items, nextCursor: null, latestCursor }), { status: 200 });
    const make = (fetcher: typeof fetch) =>
      new AgentDriveClient({ apiUrl: 'http://127.0.0.1:3000', apiKey: 't', fetch: fetcher });

    it('polls until an item appears and never sleeps past the deadline', async () => {
      const fetcher = vi
        .fn()
        .mockImplementationOnce(async () => page([]))
        .mockImplementationOnce(async () => page([]))
        .mockImplementationOnce(async () => page([{ id: 'e' }], 'c1'));
      const sleeps: number[] = [];
      const result = await make(fetcher).waitForRecent(
        'd',
        { cursor: 'c0', waitMs: 3000 },
        async (ms) => {
          sleeps.push(ms);
        },
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(result.items).toHaveLength(1);
      expect(sleeps).toHaveLength(2);
      for (const ms of sleeps) expect(ms).toBeLessThanOrEqual(2000);
      expect(String(fetcher.mock.calls[0]?.[0])).toContain('cursor=c0');
    });

    it('returns empty with the sent cursor when the deadline passes', async () => {
      const result = await make(vi.fn(async () => page([], 'c0'))).waitForRecent('d', {
        cursor: 'c0',
        waitMs: 300,
      });
      expect(result).toEqual({ items: [], nextCursor: null, latestCursor: 'c0' });
    });

    it('is not held by a server that never responds', async () => {
      const stalled = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const started = Date.now();
      const result = await make(stalled as unknown as typeof fetch).waitForRecent('d', {
        waitMs: 400,
      });
      expect(Date.now() - started).toBeLessThan(1500);
      expect(result).toEqual({ items: [], nextCursor: null, latestCursor: null });
    });

    it('stops polling when the caller aborts', async () => {
      const fetcher = vi.fn(async () => page([]));
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const started = Date.now();
      const result = await make(fetcher as unknown as typeof fetch).waitForRecent('d', {
        waitMs: 10_000,
        signal: controller.signal,
      });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result.items).toEqual([]);
      const calls = fetcher.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 2300));
      expect(fetcher.mock.calls.length).toBe(calls);
    });
  });
});

describe('AgentDriveClient.putEncrypted', () => {
  it('uploads given ciphertext as-is with one intent, one PUT and one commit', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ? { url: String(input), init } : { url: String(input) });
      if (calls.length === 1)
        return new Response(
          JSON.stringify({
            intentId: 'i',
            uploadUrl: 'http://127.0.0.1:9000/u',
            ciphertextSize: 3,
          }),
          { status: 201 },
        );
      if (calls.length === 2) return new Response('', { status: 200 });
      return new Response(JSON.stringify({ version: { id: 'v', path: '/x' } }), { status: 201 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      fetch: fetcher,
    });
    const ciphertext = new Uint8Array([1, 2, 3]);
    await client.putEncrypted('d', '/x', ciphertext, 'WRAPPED', { mode: 'create', tags: ['t'] });
    expect(calls.length).toBe(3);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      path: '/x',
      ciphertextSize: 3,
      wrappedKey: 'WRAPPED',
      tags: ['t'],
      ifVersionId: null,
    });
    expect(calls[1]?.init?.body).toBe(ciphertext);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ intentId: 'i' });
  });
});

describe('AgentDriveClient reads of trace-inbox (v2) files', () => {
  const driveA = '11111111-2222-4333-8444-555555555555';
  const driveB = '22222222-2222-4333-8444-555555555555';
  const plaintext = new TextEncoder().encode('{"otlp":{}}');

  async function v2File(driveId: string, driveKey: string) {
    const record = await createTraceInbox(driveId, driveKey);
    const fileKey = generateDriveKey();
    const ciphertext = await seal(
      plaintext,
      decodeDriveKey(fileKey),
      Uint8Array.from({ length: 8 }, (_, i) => i),
    );
    const wrappedKey = await sealFileKeyToInbox(fileKey, { driveId, ...record });
    return { ciphertext, wrappedKey, record };
  }

  function setup(
    file: { ciphertext: Uint8Array; wrappedKey: string },
    inbox: unknown,
    key: string,
  ) {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith('/trace-inbox')) return Response.json({ inbox });
      if (url.pathname.endsWith('/get'))
        return Response.json({
          id: 'v',
          wrappedKey: file.wrappedKey,
          downloadUrl: 'http://127.0.0.1:9000/o',
        });
      return new Response(file.ciphertext as unknown as BodyInit);
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      driveKey: key,
      fetch: fetcher,
    });
    return { client, paths };
  }

  it('fetches the inbox once for two reads', async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    const { client, paths } = setup(file, { ...file.record, createdAt: 'now' }, key);
    expect((await client.get(driveA, '/t')).bytes).toEqual(plaintext);
    expect((await client.get(driveA, '/t')).bytes).toEqual(plaintext);
    expect(paths.filter((p) => p.endsWith('/trace-inbox'))).toHaveLength(1);
  });

  it('never fetches the inbox for a v1 file', async () => {
    const key = generateDriveKey();
    const file = await encryptFile(plaintext, key);
    const { client, paths } = setup(file, null, key);
    expect((await client.get(driveA, '/t')).bytes).toEqual(plaintext);
    expect(paths.some((p) => p.endsWith('/trace-inbox'))).toBe(false);
  });

  it('names the drive when the inbox is missing', async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    const { client } = setup(file, null, key);
    const error = await client.get(driveA, '/t').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'inbox_key_required' });
    expect((error as Error).message).toContain(driveA);
  });

  it("rejects another drive's inbox record", async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    const other = await v2File(driveB, key);
    const { client } = setup(file, other.record, key);
    await expect(client.get(driveA, '/t')).rejects.toMatchObject({ code: 'decryption_failed' });
  });
});

import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AgentDriveClient, AgentDriveApiError, StreamSizeLimitError } from './client.js';
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

    it('releases each sleep listener instead of accumulating cancellation handlers', async () => {
      const controller = new AbortController();
      let polls = 0;
      const fetcher = vi.fn(async () => {
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
        return page(++polls < 20 ? [] : [{ id: 'e' }]);
      });
      const result = await make(fetcher).waitForRecent(
        'd',
        { waitMs: 10_000, signal: controller.signal },
        async () => {},
      );
      expect(result.items).toHaveLength(1);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    });

    it('does not publish late events after cancellation', async () => {
      const controller = new AbortController();
      const fetcher = vi.fn(async () => {
        controller.abort();
        return page([{ id: 'late' }], 'new-cursor');
      });
      const result = await make(fetcher).waitForRecent('d', {
        cursor: 'old-cursor',
        waitMs: 10_000,
        signal: controller.signal,
      });
      expect(result).toEqual({ items: [], nextCursor: null, latestCursor: 'old-cursor' });
    });

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

describe('AgentDriveClient streaming transfers', () => {
  const driveKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const version = {
    id: '11111111-1111-4111-8111-111111111111',
    path: '/x',
    ciphertextSize: 44,
    wrappedKey: 'wrapped',
    agentId: 'a',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('streams an encrypted upload with the declared length and commits only after the body completes', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      if (calls.length === 1)
        return new Response(
          JSON.stringify({
            intentId: 'i',
            uploadUrl: 'http://localhost:9000/u',
            ciphertextSize: 52,
          }),
          { status: 201 },
        );
      if (calls.length === 2) {
        const body = init?.body as ReadableStream<Uint8Array>;
        const reader = body.getReader();
        let length = 0;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
        }
        expect(length).toBe(52);
        expect(new Headers(init?.headers).get('content-length')).toBe('52');
        expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
        return new Response('', { status: 200 });
      }
      return new Response(JSON.stringify({ version }), { status: 201 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const source = (async function* () {
      yield new TextEncoder().encode('stream data');
    })();
    await client.putStream('d', '/x', source, 11, { tags: ['stream'], mode: 'overwrite' });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      path: '/x',
      ciphertextSize: 52,
      tags: ['stream'],
    });
    expect(calls[1]?.init?.headers).not.toHaveProperty('authorization');
    expect(String(calls[2]?.url)).toContain('/commit');
  });

  it('persists upload identity before commit and can replay the same intent after a lost acknowledgement', async () => {
    const events: string[] = [];
    const commitBodies: unknown[] = [];
    let commits = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/put')) {
        return new Response(
          JSON.stringify({
            intentId: 'stable-intent',
            uploadUrl: 'http://localhost:9000/u',
            ciphertextSize: 52,
          }),
          { status: 201 },
        );
      }
      if (url === 'http://localhost:9000/u') {
        const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
        while (!(await reader.read()).done) {}
        events.push('storage-uploaded');
        return new Response('', { status: 200 });
      }
      commitBodies.push(JSON.parse(String(init?.body)));
      commits += 1;
      events.push(`commit-${commits}`);
      if (commits === 1) return new Response('lost acknowledgement', { status: 502 });
      return new Response(JSON.stringify({ version }), { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const source = (async function* () {
      yield new TextEncoder().encode('stream data');
    })();

    await expect(
      client.putStream('d', '/x', source, 11, {
        onIntent: async (intentId) => {
          expect(intentId).toBe('stable-intent');
          events.push('intent-durable');
        },
        onUploadComplete: async (intentId) => {
          expect(intentId).toBe('stable-intent');
          events.push('upload-state-durable');
        },
      }),
    ).rejects.toMatchObject({ status: 502 });

    expect(events).toEqual([
      'intent-durable',
      'storage-uploaded',
      'upload-state-durable',
      'commit-1',
    ]);
    await expect(client.replayCommit('d', 'stable-intent')).resolves.toEqual(version);
    expect(commitBodies).toEqual([{ intentId: 'stable-intent' }, { intentId: 'stable-intent' }]);
  });

  it('sends trashed-create only as an explicit create-only null-version guard', async () => {
    let putBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/put')) {
        putBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            intentId: 'create-intent',
            uploadUrl: 'http://localhost:9000/u',
            ciphertextSize: putBody.ciphertextSize,
          }),
          { status: 201 },
        );
      }
      if (url === 'http://localhost:9000/u') {
        const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
        while (!(await reader.read()).done) {}
        return new Response('', { status: 200 });
      }
      return new Response(JSON.stringify({ version }), { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const source = async function* () {
      yield new TextEncoder().encode('new');
    };

    await client.putStream('d', '/new.txt', source(), 3, {
      mode: 'create',
      allowTrashedCreate: true,
    });

    expect(putBody).toMatchObject({
      path: '/new.txt',
      ifVersionId: null,
      allowTrashedCreate: true,
    });
    await expect(
      client.putStream('d', '/new.txt', source(), 3, {
        mode: 'overwrite',
        allowTrashedCreate: true,
      }),
    ).rejects.toThrow('allowTrashedCreate requires create-only mode.');
  });

  it('derives an opaque writeback scope from API base, drive and credential identity', () => {
    const makeClient = (apiUrl: string, apiKey: string) =>
      new AgentDriveClient({ apiUrl, apiKey, driveKey });
    const first = makeClient('http://localhost:3000', 'first-secret-token');

    expect(first.writebackScopeId('d')).toMatch(/^[a-f0-9]{64}$/);
    expect(first.writebackScopeId('d')).not.toContain('first-secret-token');
    expect(
      makeClient('http://localhost:3000', 'second-secret-token').writebackScopeId('d'),
    ).not.toBe(first.writebackScopeId('d'));
    expect(first.writebackScopeId('other-drive')).not.toBe(first.writebackScopeId('d'));
    expect(
      makeClient('http://localhost:3001', 'first-secret-token').writebackScopeId('d'),
    ).not.toBe(first.writebackScopeId('d'));
  });

  it('fetches pinned metadata without requesting the ciphertext URL', async () => {
    const urls: string[] = [];
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify(version), { status: 200 });
      },
    });

    await expect(client.getVersionMetadata('d', '/x', { versionId: version.id })).resolves.toEqual(
      version,
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('metadataOnly=1');
    expect(urls[0]).toContain(`versionId=${version.id}`);
  });

  it('does not commit when the plaintext stream ends before its declared size', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      if (calls.length === 1)
        return new Response(
          JSON.stringify({
            intentId: 'i',
            uploadUrl: 'http://localhost:9000/u',
            ciphertextSize: 52,
          }),
          { status: 201 },
        );
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
      await expect(reader.read()).resolves.toMatchObject({ done: false });
      await expect(reader.read()).rejects.toThrow();
      return new Response('', { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const shortSource = (async function* () {
      yield new TextEncoder().encode('short');
    })();
    await expect(client.putStream('d', '/x', shortSource, 11)).rejects.toThrow();
    expect(calls).toHaveLength(2);
    expect(calls.some((url) => url.includes('/commit'))).toBe(false);
  });

  it('uses one bounded API request for an in-limit read', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = await encryptFile(plaintext, driveKey);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('http://localhost:3000'))
        return new Response(
          JSON.stringify({
            ...version,
            ciphertextSize: encrypted.ciphertext.byteLength,
            wrappedKey: encrypted.wrappedKey,
            downloadUrl: 'http://localhost:9000/download',
          }),
          { status: 200 },
        );
      return new Response(new Uint8Array(encrypted.ciphertext));
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const stream = await client.getStream('d', '/x', {
      versionId: version.id,
      maxPlaintextBytes: 3,
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('maxPlaintextBytes=3');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(`versionId=${version.id}`);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('metadataOnly=1');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('authorizeIfWithinLimit=1');
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).startsWith('http://localhost:3000')),
    ).toHaveLength(1);
    await stream.cancel();
  });

  it('checks an oversized response from an older server before fetching ciphertext', async () => {
    let authorizations = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('http://localhost:3000')) {
        const url = new URL(String(input));
        const conditionalMetadata = url.searchParams.get('metadataOnly') === '1';
        if (!conditionalMetadata) authorizations += 1;
        return new Response(
          JSON.stringify({
            ...version,
            ciphertextSize: 1024,
            ...(!conditionalMetadata ? { downloadUrl: 'http://localhost:9000/signed-secret' } : {}),
          }),
          { status: 200 },
        );
      }
      throw new Error('ciphertext must not be fetched');
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    await expect(client.getStream('d', '/x', { maxPlaintextBytes: 10 })).rejects.toBeInstanceOf(
      StreamSizeLimitError,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('metadataOnly=1');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('maxPlaintextBytes=10');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('authorizeIfWithinLimit=1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(authorizations).toBe(0);
  });

  it('pins the metadata version when an older server requires a separate signed GET', async () => {
    const plaintext = new Uint8Array([4, 5, 6]);
    const encrypted = await encryptFile(plaintext, driveKey);
    const apiCalls: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === 'http://localhost:3000') {
        apiCalls.push(url);
        const metadata = {
          ...version,
          ciphertextSize: encrypted.ciphertext.byteLength,
          wrappedKey: encrypted.wrappedKey,
        };
        return new Response(
          JSON.stringify(
            url.searchParams.get('metadataOnly') === '1'
              ? metadata
              : { ...metadata, downloadUrl: 'http://localhost:9000/pinned-download' },
          ),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array(encrypted.ciphertext));
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const stream = await client.getStream('d', '/x', { maxPlaintextBytes: 3 });
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream.plaintext) chunks.push(chunk);
    expect([...Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))]).toEqual([...plaintext]);
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[0]?.searchParams.get('metadataOnly')).toBe('1');
    expect(apiCalls[0]?.searchParams.get('maxPlaintextBytes')).toBe('3');
    expect(apiCalls[0]?.searchParams.get('authorizeIfWithinLimit')).toBe('1');
    expect(apiCalls[1]?.searchParams.get('versionId')).toBe(version.id);
    expect(apiCalls[1]?.searchParams.get('maxPlaintextBytes')).toBe('3');
    expect(apiCalls[1]?.searchParams.has('metadataOnly')).toBe(false);
  });

  it('rejects a legacy pinned GET whose metadata differs from its preflight', async () => {
    const encrypted = await encryptFile(new Uint8Array([4, 5, 6]), driveKey);
    const apiCalls: URL[] = [];
    const storageFetch = vi.fn(async (_input: RequestInfo | URL) => new Response());
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin !== 'http://localhost:3000') return storageFetch(input);
      apiCalls.push(url);
      const metadata = {
        ...version,
        ciphertextSize: encrypted.ciphertext.byteLength,
        wrappedKey: encrypted.wrappedKey,
      };
      return new Response(
        JSON.stringify(
          url.searchParams.get('metadataOnly') === '1'
            ? metadata
            : { ...metadata, ciphertextSize: metadata.ciphertextSize + 1, downloadUrl: 'signed' },
        ),
        { status: 200 },
      );
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    await expect(client.getStream('d', '/x', { maxPlaintextBytes: 3 })).rejects.toMatchObject({
      code: 'internal_error',
      status: 502,
    });
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[1]?.searchParams.get('versionId')).toBe(version.id);
    expect(storageFetch).not.toHaveBeenCalled();
  });

  it('decrypts a streamed download and cancels when the consumer stops early', async () => {
    const plaintext = new Uint8Array(1024 * 1024 + 5).fill(42);
    const encrypted = await encryptFile(plaintext, driveKey);
    const ciphertext = new Uint8Array(encrypted.ciphertext);
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: ciphertext.subarray(0, 25) })
        .mockResolvedValueOnce({
          done: false,
          value: ciphertext.subarray(25, 25 + 1024 * 1024 + 16),
        })
        .mockImplementation(() => new Promise(() => {})),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      if (String(input).includes('/get?'))
        return new Response(
          JSON.stringify({
            ...version,
            ciphertextSize: ciphertext.byteLength,
            wrappedKey: encrypted.wrappedKey,
            downloadUrl: 'http://localhost:9000/d',
          }),
          { status: 200 },
        );
      return { ok: true, body: { getReader: () => reader } } as unknown as Response;
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });
    const result = await client.getStream('d', '/x');
    const iterator = result.plaintext[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(plaintext.subarray(0, 1024 * 1024));
    await iterator.return?.();
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the underlying response body when a real stream consumer stops early', async () => {
    const encrypted = await encryptFile(new Uint8Array(1024 * 1024 + 1).fill(17), driveKey);
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encrypted.ciphertext.subarray(0, 25));
        controller.enqueue(encrypted.ciphertext.subarray(25, 25 + 1024 * 1024 + 16));
      },
      cancel: cancelled,
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/get?'))
        return new Response(
          JSON.stringify({
            ...version,
            ciphertextSize: encrypted.ciphertext.byteLength,
            wrappedKey: encrypted.wrappedKey,
            downloadUrl: 'http://localhost:9000/d',
          }),
          { status: 200 },
        );
      return new Response(body, { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });

    const result = await client.getStream('d', '/x');
    const iterator = result.plaintext[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await iterator.return?.();

    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('cancels a streamed download before its first plaintext read', async () => {
    const encrypted = await encryptFile(new Uint8Array(1024 * 1024).fill(17), driveKey);
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encrypted.ciphertext.subarray(0, 25));
      },
      cancel: cancelled,
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/get?'))
        return new Response(
          JSON.stringify({
            ...version,
            ciphertextSize: encrypted.ciphertext.byteLength,
            wrappedKey: encrypted.wrappedKey,
            downloadUrl: 'http://localhost:9000/d',
          }),
          { status: 200 },
        );
      return new Response(body, { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });

    const result = await client.getStream('d', '/x');
    await expect(result.cancel()).resolves.toBeUndefined();

    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('keeps get byte results while honoring its plaintext cap and abort signal', async () => {
    const driveId = '11111111-2222-4333-8444-555555555555';
    const inbox = await createTraceInbox(driveId, driveKey);
    const fileKey = generateDriveKey();
    const ciphertext = await seal(
      new Uint8Array([1, 2, 3]),
      decodeDriveKey(fileKey),
      new Uint8Array(8),
    );
    const wrappedKey = await sealFileKeyToInbox(fileKey, { driveId, ...inbox });
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.includes('/trace-inbox'))
        return new Response(JSON.stringify({ inbox }), { status: 200 });
      if (url.includes('/get?')) {
        const metadata = {
          ...version,
          ciphertextSize: ciphertext.byteLength,
          wrappedKey,
        };
        return new Response(
          JSON.stringify(
            url.includes('metadataOnly=1')
              ? metadata
              : {
                  ...metadata,
                  downloadUrl: 'http://localhost:9000/d',
                },
          ),
          { status: 200 },
        );
      }
      return new Response(ciphertext, { status: 200 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://localhost:3000',
      apiKey: 'token',
      driveKey,
      fetch: fetcher,
    });

    await expect(
      client.get(driveId, '/x', { maxPlaintextBytes: 2, signal: controller.signal }),
    ).rejects.toBeInstanceOf(StreamSizeLimitError);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const result = await client.get(driveId, '/x', {
      maxPlaintextBytes: 3,
      signal: controller.signal,
    });

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.version.id).toBe(version.id);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every((call) => call[1]?.signal === controller.signal)).toBe(true);
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
          ciphertextSize: file.ciphertext.byteLength,
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

  it('requests the trace inbox while the ciphertext is still downloading', async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    const requested: string[] = [];
    let finishDownload!: (response: Response) => void;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      if (url.pathname.endsWith('/trace-inbox')) return Response.json({ inbox: file.record });
      if (url.pathname.endsWith('/get'))
        return Response.json({
          id: 'v',
          ciphertextSize: file.ciphertext.byteLength,
          wrappedKey: file.wrappedKey,
          downloadUrl: 'http://127.0.0.1:9000/o',
        });
      return new Promise<Response>((resolve) => {
        finishDownload = resolve;
      });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      driveKey: key,
      fetch: fetcher,
    });
    const pending = client.get(driveA, '/t');
    await vi.waitFor(
      () => expect(requested.some((path) => path.endsWith('/trace-inbox'))).toBe(true),
      { timeout: 10_000 },
    );
    // The inbox request arrived while the download was still in flight; finish it.
    finishDownload(new Response(file.ciphertext as unknown as BodyInit));
    expect((await pending).bytes).toEqual(plaintext);
  });

  it('keeps the storage error when the overlapped inbox lookup fails too', async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    let rejectInbox!: (error: unknown) => void;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/trace-inbox'))
        return new Promise<Response>((_resolve, reject) => {
          rejectInbox = reject;
        });
      if (url.pathname.endsWith('/get'))
        return Response.json({
          id: 'v',
          ciphertextSize: file.ciphertext.byteLength,
          wrappedKey: file.wrappedKey,
          downloadUrl: 'http://127.0.0.1:9000/o',
        });
      return new Response('down', { status: 500 });
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      driveKey: key,
      fetch: fetcher,
    });
    await expect(client.get(driveA, '/t')).rejects.toMatchObject({ code: 'storage_error' });
    // The abandoned lookup settles later; its rejection must not escape unhandled.
    rejectInbox(new Error('inbox down'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('does not cache a failed trace-inbox request', async () => {
    const key = generateDriveKey();
    const file = await v2File(driveA, key);
    let inboxCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/trace-inbox')) {
        inboxCalls += 1;
        return inboxCalls === 1
          ? new Response('down', { status: 500 })
          : Response.json({ inbox: file.record });
      }
      if (url.pathname.endsWith('/get'))
        return Response.json({
          id: 'v',
          ciphertextSize: file.ciphertext.byteLength,
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
    await expect(client.get(driveA, '/t')).rejects.toMatchObject({ code: 'internal_error' });
    expect((await client.get(driveA, '/t')).bytes).toEqual(plaintext);
    expect(inboxCalls).toBe(2);
  });
});

describe('AgentDriveClient.recentHead', () => {
  const make = (body: unknown) => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(body);
    });
    const client = new AgentDriveClient({
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      fetch: fetcher,
    });
    return { calls, client };
  };

  it('asks for the head row and returns latestCursor', async () => {
    const { calls, client } = make({ items: [], nextCursor: null, latestCursor: 'cursor-1' });
    await expect(client.recentHead('drive-1')).resolves.toBe('cursor-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/v1/drives/drive-1/recent?head=1&limit=1');
  });

  it('returns null when the drive has no events', async () => {
    const { client } = make({ items: [], nextCursor: null, latestCursor: null });
    await expect(client.recentHead('drive-1')).resolves.toBeNull();
  });

  it('falls back to the page latestCursor on servers without head support', async () => {
    const { client } = make({
      items: [{ id: 'e1' }],
      nextCursor: 'page-2',
      latestCursor: 'first-page-cursor',
    });
    await expect(client.recentHead('drive-1')).resolves.toBe('first-page-cursor');
  });
});

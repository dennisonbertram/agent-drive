import { describe, expect, it, vi } from 'vitest';
import { AgentDriveApiError, AgentDriveClient } from './client.js';
import {
  CHUNK_SIZE,
  decodeDriveKey,
  encryptFile,
  encryptFileStream,
  generateDriveKey,
} from './crypto.js';
import { seal } from './crypto-format.js';
import { createTraceInbox, sealFileKeyToInbox } from './trace-inbox.js';

const apiOrigin = 'http://localhost:3000';
const storageOrigin = 'http://localhost:9000';
const driveId = '11111111-2222-4333-8444-555555555555';
const path = '/large.bin';
const versionId = '11111111-1111-4111-8111-111111111111';

function contentRange(range: string, total: number) {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
  if (!match) throw new Error(`Unexpected range: ${range}`);
  return `bytes ${match[1]}-${match[2]}/${total}`;
}

function rangeBounds(range: string) {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
  if (!match) throw new Error(`Unexpected range: ${range}`);
  return { first: Number(match[1]), last: Number(match[2]) };
}

function makeFetcher(options: {
  ciphertext: Uint8Array;
  ciphertextSize?: number;
  wrappedKey: string;
  metadata?: Record<string, unknown>;
  legacy?: boolean;
  echoRange?: (range: string, call: number) => string;
  traceInbox?: unknown;
  storage?: (range: string, total: number, request: RequestInit) => Response;
  onApi?: (url: URL, call: number) => Record<string, unknown> | undefined;
}) {
  const apiCalls: { url: URL; init?: RequestInit }[] = [];
  const storageCalls: { url: URL; init?: RequestInit }[] = [];
  const metadata = {
    id: versionId,
    path,
    ciphertextSize: options.ciphertextSize ?? options.ciphertext.byteLength,
    wrappedKey: options.wrappedKey,
    agentId: 'agent-1',
    machineId: null,
    userId: null,
    tags: [],
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...options.metadata,
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === apiOrigin) {
      apiCalls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname.endsWith('/trace-inbox'))
        return new Response(JSON.stringify({ inbox: options.traceInbox ?? null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const range = url.searchParams.get('range');
      if (!range) throw new Error('The API request must authorize an explicit range.');
      const responseMetadata = options.onApi?.(url, apiCalls.length) ?? metadata;
      return new Response(
        JSON.stringify({
          ...responseMetadata,
          ...(options.legacy
            ? {}
            : {
                downloadRange: options.echoRange?.(range, apiCalls.length) ?? range,
                downloadUrl: `${storageOrigin}/object?sig=fixture`,
              }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    storageCalls.push({ url, ...(init ? { init } : {}) });
    const range = new Headers(init?.headers).get('range');
    if (!range) throw new Error('Storage requests must include the authorized Range header.');
    if (options.storage)
      return options.storage(
        range,
        options.ciphertextSize ?? options.ciphertext.byteLength,
        init ?? {},
      );
    const { first, last } = rangeBounds(range);
    const body = options.ciphertext.slice(first, last + 1);
    return new Response(body, {
      status: 206,
      headers: {
        'content-range': contentRange(
          range,
          options.ciphertextSize ?? options.ciphertext.byteLength,
        ),
        'content-length': String(body.byteLength),
      },
    });
  });
  return { fetcher, apiCalls, storageCalls, metadata };
}

describe('AgentDriveClient ranged mount reader', () => {
  it('reads the last MiB of a 1 GiB version using only the header and its signed final frame', async () => {
    const driveKey = generateDriveKey();
    const plaintextBytes = 1024 ** 3;
    async function* zeroChunks() {
      for (let offset = 0; offset < plaintextBytes; offset += CHUNK_SIZE)
        yield new Uint8Array(Math.min(CHUNK_SIZE, plaintextBytes - offset));
    }
    const encrypted = await encryptFileStream(zeroChunks(), plaintextBytes, driveKey);
    let header: Uint8Array<ArrayBuffer> | undefined;
    let finalFrame: Uint8Array<ArrayBuffer> | undefined;
    let encryptedFrameIndex = -1;
    for await (const frame of encrypted.ciphertext) {
      if (encryptedFrameIndex === -1) header = Uint8Array.from(frame);
      else if (encryptedFrameIndex === plaintextBytes / CHUNK_SIZE - 1)
        finalFrame = Uint8Array.from(frame);
      encryptedFrameIndex += 1;
    }
    if (!header || !finalFrame) throw new Error('The synthetic large ciphertext was incomplete.');
    const finalFrameIndex = plaintextBytes / CHUNK_SIZE - 1;
    const frameSize = finalFrame.byteLength;
    const finalFrameStart = 25 + finalFrameIndex * (CHUNK_SIZE + 16);
    const fetchState = makeFetcher({
      ciphertext: new Uint8Array(0),
      ciphertextSize: encrypted.ciphertextSize,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        const body =
          range === 'bytes=0-24'
            ? header!
            : range === `bytes=${finalFrameStart}-${finalFrameStart + frameSize - 1}`
              ? finalFrame!
              : new Uint8Array(0);
        return new Response(body, {
          status: 206,
          headers: {
            'content-range': contentRange(range, total),
            'content-length': String(body.byteLength),
          },
        });
      },
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    const reader = await client.openRangeReader(driveId, path, versionId);
    const expected = new Uint8Array(CHUNK_SIZE);
    expect(await reader.read(plaintextBytes - CHUNK_SIZE, CHUNK_SIZE)).toEqual(expected);
    expect(await reader.read(plaintextBytes - CHUNK_SIZE, CHUNK_SIZE)).toEqual(expected);

    expect(fetchState.apiCalls.map(({ url }) => url.searchParams.get('range'))).toEqual([
      'bytes=0-24',
      `bytes=${finalFrameStart}-${finalFrameStart + frameSize - 1}`,
    ]);
    expect(
      fetchState.apiCalls.every(({ url }) => url.searchParams.get('metadataOnly') === '1'),
    ).toBe(true);
    expect(
      fetchState.apiCalls.every(({ url }) => url.searchParams.get('authorizeRange') === '1'),
    ).toBe(true);
    expect(
      fetchState.apiCalls.every(({ url }) => url.searchParams.get('versionId') === versionId),
    ).toBe(true);
    expect(
      fetchState.storageCalls.map(({ init }) => new Headers(init?.headers).get('range')),
    ).toEqual(['bytes=0-24', `bytes=${finalFrameStart}-${finalFrameStart + frameSize - 1}`]);
    expect(fetchState.storageCalls.every(({ init }) => init?.redirect === 'error')).toBe(true);
    expect(
      fetchState.storageCalls.every(
        ({ init }) => new Headers(init?.headers).get('authorization') === null,
      ),
    ).toBe(true);
    await reader.close();
  }, 15_000);

  it('caches authenticated frames so nearby 4 KiB reads do not repeat authorization or storage fetches', async () => {
    const driveKey = generateDriveKey();
    const plaintext = new Uint8Array(32 * 1024).map((_, index) => index % 251);
    const encrypted = await encryptFile(plaintext, driveKey);
    const fetchState = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    const reader = await client.openRangeReader(driveId, path, versionId);
    expect(await reader.read(0, 4096)).toEqual(plaintext.slice(0, 4096));
    expect(await reader.read(4096, 4096)).toEqual(plaintext.slice(4096, 8192));

    expect(fetchState.apiCalls).toHaveLength(2);
    expect(fetchState.storageCalls).toHaveLength(2);
  });

  it('retains existing trace-inbox wrapped-key support for pinned reads', async () => {
    const driveKey = generateDriveKey();
    const inbox = await createTraceInbox(driveId, driveKey);
    const fileKey = generateDriveKey();
    const plaintext = new TextEncoder().encode('trace inbox frame');
    const ciphertext = await seal(
      plaintext,
      decodeDriveKey(fileKey),
      Uint8Array.from({ length: 8 }, (_, index) => index),
    );
    const wrappedKey = await sealFileKeyToInbox(fileKey, { driveId, ...inbox });
    const fetchState = makeFetcher({
      ciphertext,
      wrappedKey,
      traceInbox: { ...inbox, createdAt: '2026-01-01T00:00:00.000Z' },
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    const reader = await client.openRangeReader(driveId, path, versionId);
    expect(await reader.read(2, 7)).toEqual(plaintext.slice(2, 9));
    expect(
      fetchState.apiCalls.filter(({ url }) => url.pathname.endsWith('/trace-inbox')),
    ).toHaveLength(1);
    await reader.close();
  });

  it('rejects a legacy metadata-only response without authorizing a whole-file fallback', async () => {
    const driveKey = generateDriveKey();
    const encrypted = await encryptFile(new Uint8Array([1, 2, 3]), driveKey);
    const fetchState = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      legacy: true,
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    await expect(client.openRangeReader(driveId, path, versionId)).rejects.toMatchObject({
      status: 502,
    });
    expect(fetchState.apiCalls).toHaveLength(1);
    expect(fetchState.storageCalls).toHaveLength(0);
  });

  it('rejects an unexpected 200 without reading its body', async () => {
    const driveKey = generateDriveKey();
    const encrypted = await encryptFile(new Uint8Array([1, 2, 3]), driveKey);
    let bodyReads = 0;
    const fetchState = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        if (range === 'bytes=0-24') {
          const header = encrypted.ciphertext.slice(0, 25);
          return new Response(header, {
            status: 206,
            headers: { 'content-range': contentRange(range, total), 'content-length': '25' },
          });
        }
        const body = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              bodyReads += 1;
              controller.enqueue(new Uint8Array(4096));
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(body, { status: 200 });
      },
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    const reader = await client.openRangeReader(driveId, path, versionId);
    await expect(reader.read(0, 3)).rejects.toBeInstanceOf(AgentDriveApiError);
    expect(bodyReads).toBe(0);
  });

  it('aborts a pending bounded storage read and cancels its response body', async () => {
    const driveKey = generateDriveKey();
    const encrypted = await encryptFile(new Uint8Array([1, 2, 3]), driveKey);
    const controller = new AbortController();
    let bodyCancelled = 0;
    const fetchState = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        if (range === 'bytes=0-24') {
          const header = encrypted.ciphertext.slice(0, 25);
          return new Response(header, {
            status: 206,
            headers: { 'content-range': contentRange(range, total), 'content-length': '25' },
          });
        }
        const { first, last } = rangeBounds(range);
        const body = new ReadableStream<Uint8Array>(
          {
            cancel() {
              bodyCancelled += 1;
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(body, {
          status: 206,
          headers: {
            'content-range': contentRange(range, total),
            'content-length': String(last - first + 1),
          },
        });
      },
    });
    const client = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: fetchState.fetcher,
    });

    const reader = await client.openRangeReader(driveId, path, versionId, {
      signal: controller.signal,
    });
    const pendingRead = reader.read(0, 1);
    await vi.waitFor(() => expect(fetchState.storageCalls).toHaveLength(2));
    controller.abort(new DOMException('Test cancellation.', 'AbortError'));
    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(bodyCancelled).toBe(1);
    await reader.close();
  });

  it('rejects malformed 206 metadata, changed pinned metadata, and truncated frame bodies', async () => {
    const driveKey = generateDriveKey();
    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const encrypted = await encryptFile(plaintext, driveKey);

    const wrongContentRange = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        const { first, last } = rangeBounds(range);
        const body = encrypted.ciphertext.slice(first, last + 1);
        return new Response(body, {
          status: 206,
          headers: {
            'content-range': `bytes ${first}-${last}/${total + 1}`,
            'content-length': String(body.byteLength),
          },
        });
      },
    });
    const wrongRangeClient = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: wrongContentRange.fetcher,
    });
    await expect(wrongRangeClient.openRangeReader(driveId, path, versionId)).rejects.toBeInstanceOf(
      AgentDriveApiError,
    );

    const wrongLength = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        const { first, last } = rangeBounds(range);
        const body = encrypted.ciphertext.slice(first, last + 1);
        return new Response(body, {
          status: 206,
          headers: {
            'content-range': contentRange(range, total),
            'content-length': String(body.byteLength + 1),
          },
        });
      },
    });
    const wrongLengthClient = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: wrongLength.fetcher,
    });
    await expect(
      wrongLengthClient.openRangeReader(driveId, path, versionId),
    ).rejects.toBeInstanceOf(AgentDriveApiError);

    const wrongEcho = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      echoRange: (range, call) => (call === 1 ? range : 'bytes=0-24'),
    });
    const wrongEchoClient = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: wrongEcho.fetcher,
    });
    const wrongEchoReader = await wrongEchoClient.openRangeReader(driveId, path, versionId);
    await expect(wrongEchoReader.read(0, 1)).rejects.toBeInstanceOf(AgentDriveApiError);
    expect(wrongEcho.storageCalls).toHaveLength(1);

    const changedMetadata = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      onApi: (_url, call) =>
        call === 1
          ? undefined
          : {
              id: versionId,
              path,
              ciphertextSize: encrypted.ciphertext.byteLength + 1,
              wrappedKey: 'changed-wrapped-key',
              agentId: 'agent-1',
              machineId: null,
              userId: null,
              tags: [],
              description: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
    });
    const changedClient = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: changedMetadata.fetcher,
    });
    const changedReader = await changedClient.openRangeReader(driveId, path, versionId);
    await expect(changedReader.read(0, 1)).rejects.toBeInstanceOf(AgentDriveApiError);
    expect(changedMetadata.storageCalls).toHaveLength(1);

    const truncated = makeFetcher({
      ciphertext: encrypted.ciphertext,
      wrappedKey: encrypted.wrappedKey,
      storage: (range, total) => {
        const { first, last } = rangeBounds(range);
        const body =
          range === 'bytes=0-24'
            ? encrypted.ciphertext.slice(first, last + 1)
            : encrypted.ciphertext.slice(first, last);
        return new Response(body, {
          status: 206,
          headers: {
            'content-range': contentRange(range, total),
            'content-length': String(last - first + 1),
          },
        });
      },
    });
    const truncatedClient = new AgentDriveClient({
      apiUrl: apiOrigin,
      apiKey: 'synthetic-token',
      driveKey,
      fetch: truncated.fetcher,
    });
    const truncatedReader = await truncatedClient.openRangeReader(driveId, path, versionId);
    await expect(truncatedReader.read(0, 1)).rejects.toBeInstanceOf(AgentDriveApiError);
  });
});

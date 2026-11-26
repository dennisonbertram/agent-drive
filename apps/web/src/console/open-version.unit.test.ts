import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import {
  createTraceInbox,
  sealFileKeyToInbox,
  type TraceInboxRecord,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
import { loadInbox, openVersion, type InboxCache } from './open-version';

const DRIVE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const driveKey = generateDriveKey();
const plaintext = new TextEncoder().encode('trace body');
let ciphertext: Uint8Array;
let v1: string;
let v2: string;
let record: TraceInboxRecord;
let otherRecord: TraceInboxRecord;

beforeAll(async () => {
  const file = await encryptFile(plaintext, driveKey);
  ciphertext = file.ciphertext;
  v1 = file.wrappedKey;
  record = await createTraceInbox(DRIVE, driveKey);
  otherRecord = await createTraceInbox(OTHER, driveKey);
  v2 = await sealFileKeyToInbox(await unwrapFileKey(v1, driveKey), { driveId: DRIVE, ...record });
}, 30_000);

afterEach(() => vi.unstubAllGlobals());

function setup(inbox: TraceInboxRecord | null) {
  vi.stubGlobal('fetch', async () => new Response(ciphertext as BodyInit));
  const calls = vi.fn(async () => ({ inbox }));
  return { api: calls as never, calls };
}
const meta = (wrappedKey: string) => ({
  wrappedKey,
  downloadUrl: 'https://example.r2.cloudflarestorage.com/x',
  ciphertextSize: ciphertext.byteLength,
});

describe('openVersion', () => {
  it('does not evict a replacement request when an invalidated request fails', async () => {
    const cache: InboxCache = new Map();
    let reject!: (error: Error) => void;
    const old = loadInbox(
      (() =>
        new Promise((_, fail) => {
          reject = fail;
        })) as never,
      cache,
      DRIVE,
    );
    cache.clear();
    const current = loadInbox((async () => ({ inbox: record })) as never, cache, DRIVE);
    reject(new Error('old request failed'));
    await expect(old).rejects.toThrow('old request failed');
    expect(cache.get(DRIVE)).toBe(current);
    expect(await current).toBe(record);
  });
  it('decrypts a v1 version without asking for the inbox', async () => {
    const { api, calls } = setup(null);
    const out = await openVersion(api, DRIVE, meta(v1), driveKey, new Map() as InboxCache, 1024);
    expect(new TextDecoder().decode(out)).toBe('trace body');
    expect(calls).not.toHaveBeenCalled();
  });

  it('stops collecting plaintext when the preview cap is exceeded', async () => {
    const { api } = setup(null);
    await expect(openVersion(api, DRIVE, meta(v1), driveKey, new Map(), 3)).rejects.toThrow(
      'This file is too large to preview.',
    );
  });

  it('rejects a ciphertext stream whose actual length differs from pinned metadata', async () => {
    const { api } = setup(null);
    await expect(
      openVersion(
        api,
        DRIVE,
        { ...meta(v1), ciphertextSize: ciphertext.byteLength + 1 },
        driveKey,
        new Map(),
        1024,
      ),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });

  it('starts the inbox lookup while the ciphertext is still downloading', async () => {
    let finishDownload!: (response: Response) => void;
    const fetching = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishDownload = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetching);
    const api = vi.fn(async () => ({ inbox: record })) as never;
    const pending = openVersion(api, DRIVE, meta(v2), driveKey, new Map(), 1024);
    // Both transfers were issued and neither has settled.
    expect(api).toHaveBeenCalledTimes(1);
    expect(fetching).toHaveBeenCalledTimes(1);
    finishDownload(new Response(ciphertext as BodyInit));
    expect(new TextDecoder().decode(await pending)).toBe('trace body');
  });

  it('keeps the download error when the overlapped inbox lookup fails too', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    let rejectInbox!: (error: Error) => void;
    const api = (() =>
      new Promise((_, fail) => {
        rejectInbox = fail;
      })) as never;
    await expect(openVersion(api, DRIVE, meta(v2), driveKey, new Map(), 1024)).rejects.toThrow(
      'The encrypted file could not be downloaded.',
    );
    // The abandoned lookup settles later; its rejection must not escape unhandled.
    rejectInbox(new Error('inbox lookup failed'));
  });

  it('retries the inbox lookup after the overlapped request fails', async () => {
    vi.stubGlobal('fetch', async () => new Response(ciphertext as BodyInit));
    let attempts = 0;
    const api = (async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('lookup down');
      return { inbox: record };
    }) as never;
    const cache: InboxCache = new Map();
    await expect(openVersion(api, DRIVE, meta(v2), driveKey, cache, 1024)).rejects.toThrow(
      'lookup down',
    );
    const out = await openVersion(api, DRIVE, meta(v2), driveKey, cache, 1024);
    expect(new TextDecoder().decode(out)).toBe('trace body');
    expect(attempts).toBe(2);
  });

  it('v2 version decrypts via the inbox, fetched once for two opens', async () => {
    const { api, calls } = setup(record);
    const cache: InboxCache = new Map();
    for (let i = 0; i < 2; i += 1) {
      const out = await openVersion(api, DRIVE, meta(v2), driveKey, cache, 1024);
      expect(new TextDecoder().decode(out)).toBe('trace body');
    }
    expect(calls).toHaveBeenCalledTimes(1);
    expect((calls.mock.calls[0] as unknown[])[0]).toBe(`drives/${DRIVE}/trace-inbox`);
  });

  it('says the inbox is gone when the drive has none', async () => {
    const { api } = setup(null);
    await expect(openVersion(api, DRIVE, meta(v2), driveKey, new Map(), 1024)).rejects.toThrow(
      'This trace was sealed to a trace inbox this drive no longer has.',
    );
  });

  it("rejects another drive's inbox record", async () => {
    const { api } = setup(otherRecord);
    await expect(
      openVersion(api, DRIVE, meta(v2), driveKey, new Map(), 1024),
    ).rejects.toMatchObject({
      code: 'decryption_failed',
    });
  });

  it('ignores a driveId inside the server record', async () => {
    const sealedToOther = await sealFileKeyToInbox(await unwrapFileKey(v1, driveKey), {
      driveId: OTHER,
      ...otherRecord,
    });
    const { api } = setup({ ...otherRecord, driveId: OTHER } as TraceInboxRecord);
    await expect(
      openVersion(api, DRIVE, meta(sealedToOther), driveKey, new Map(), 1024),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });
});

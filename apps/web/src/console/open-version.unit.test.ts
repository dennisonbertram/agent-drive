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
import { openVersion, type InboxCache } from './open-version';

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
});

describe('openVersion', () => {
  it('decrypts a v1 version without asking for the inbox', async () => {
    const { api, calls } = setup(null);
    const out = await openVersion(api, DRIVE, meta(v1), driveKey, new Map() as InboxCache);
    expect(new TextDecoder().decode(out)).toBe('trace body');
    expect(calls).not.toHaveBeenCalled();
  });

  it('v2 version decrypts via the inbox, fetched once for two opens', async () => {
    const { api, calls } = setup(record);
    const cache: InboxCache = new Map();
    for (let i = 0; i < 2; i += 1) {
      const out = await openVersion(api, DRIVE, meta(v2), driveKey, cache);
      expect(new TextDecoder().decode(out)).toBe('trace body');
    }
    expect(calls).toHaveBeenCalledTimes(1);
    expect((calls.mock.calls[0] as unknown[])[0]).toBe(`drives/${DRIVE}/trace-inbox`);
  });

  it('says the inbox is gone when the drive has none', async () => {
    const { api } = setup(null);
    await expect(openVersion(api, DRIVE, meta(v2), driveKey, new Map())).rejects.toThrow(
      'This trace was sealed to a trace inbox this drive no longer has.',
    );
  });

  it("rejects another drive's inbox record", async () => {
    const { api } = setup(otherRecord);
    await expect(openVersion(api, DRIVE, meta(v2), driveKey, new Map())).rejects.toMatchObject({
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
      openVersion(api, DRIVE, meta(sealedToOther), driveKey, new Map()),
    ).rejects.toMatchObject({ code: 'decryption_failed' });
  });
});

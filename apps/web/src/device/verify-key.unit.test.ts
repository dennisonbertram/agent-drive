import { beforeAll, describe, expect, it, vi } from 'vitest';
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
import { verifyDriveKey } from './verify-key';

const DRIVE = '55555555-5555-4555-8555-555555555555';
const driveKey = generateDriveKey();
const otherKey = generateDriveKey();
let envelope: string;
let v2Envelope: string;
let inboxRecord: TraceInboxRecord;

beforeAll(async () => {
  envelope = (await encryptFile(new Uint8Array([1, 2, 3]), driveKey)).wrappedKey;
  inboxRecord = await createTraceInbox(DRIVE, driveKey);
  v2Envelope = await sealFileKeyToInbox(await unwrapFileKey(envelope, driveKey), {
    driveId: DRIVE,
    ...inboxRecord,
  });
}, 30_000);

const request = (paths: Record<string, unknown>) => {
  const seen: string[] = [];
  const fn = vi.fn(async (path: string) => {
    seen.push(path);
    if (path in paths) return paths[path];
    throw new Error(`unexpected request ${path}`);
  });
  return { fn, seen };
};

const withFile = (wrappedKey: string) => ({
  [`drives/${DRIVE}/search?limit=5`]: { items: [{ wrappedKey }], nextCursor: null },
  [`drives/${DRIVE}/trace-inbox`]: { inbox: null },
});

describe('verifyDriveKey', () => {
  it('checks the key against a live file envelope without reading a file body', async () => {
    const good = request(withFile(envelope));
    expect(await verifyDriveKey(good.fn, DRIVE, driveKey)).toBe('file');
    expect(good.seen).toEqual([`drives/${DRIVE}/search?limit=5`]);
    const bad = request(withFile(envelope));
    expect(await verifyDriveKey(bad.fn, DRIVE, otherKey)).toBe('mismatch');
  });

  it('tries another encrypted metadata sample after a corrupt or unrelated envelope', async () => {
    const cursor = 'next-sample';
    const r = request({
      [`drives/${DRIVE}/search?limit=5`]: {
        items: [{ wrappedKey: 'corrupt-envelope' }],
        nextCursor: cursor,
      },
      [`drives/${DRIVE}/search?limit=5&cursor=${cursor}`]: {
        items: [{ wrappedKey: envelope }],
        nextCursor: null,
      },
    });

    expect(await verifyDriveKey(r.fn, DRIVE, driveKey)).toBe('file');
    expect(r.seen).toEqual([
      `drives/${DRIVE}/search?limit=5`,
      `drives/${DRIVE}/search?limit=5&cursor=${cursor}`,
    ]);
  });

  it('uses the inbox as authoritative evidence after sampled file envelopes fail', async () => {
    const r = request({
      [`drives/${DRIVE}/search?limit=5`]: {
        items: [{ wrappedKey: 'corrupt-envelope' }],
        nextCursor: null,
      },
      [`drives/${DRIVE}/trace-inbox`]: { inbox: inboxRecord },
    });
    expect(await verifyDriveKey(r.fn, DRIVE, driveKey)).toBe('inbox');
    expect(await verifyDriveKey(r.fn, DRIVE, otherKey)).toBe('mismatch');
  });

  it('preserves transport failures instead of reporting a wrong key', async () => {
    const r = request({
      [`drives/${DRIVE}/search?limit=5`]: {
        items: [{ wrappedKey: 'corrupt-envelope' }],
        nextCursor: null,
      },
    });
    await expect(verifyDriveKey(r.fn, DRIVE, driveKey)).rejects.toThrow('unexpected request');
  });

  it('bounds metadata sampling to two pages', async () => {
    const r = request({
      [`drives/${DRIVE}/search?limit=5`]: { items: [], nextCursor: 'page-2' },
      [`drives/${DRIVE}/search?limit=5&cursor=page-2`]: {
        items: [],
        nextCursor: 'page-3',
      },
      [`drives/${DRIVE}/trace-inbox`]: { inbox: null },
    });
    expect(await verifyDriveKey(r.fn, DRIVE, driveKey)).toBe('unverifiable');
    expect(r.seen).toEqual([
      `drives/${DRIVE}/search?limit=5`,
      `drives/${DRIVE}/search?limit=5&cursor=page-2`,
      `drives/${DRIVE}/trace-inbox`,
    ]);
  });

  it('opens a v2 envelope through the drive’s trace inbox', async () => {
    const good = request({
      ...withFile(v2Envelope),
      [`drives/${DRIVE}/trace-inbox`]: { inbox: inboxRecord },
    });
    expect(await verifyDriveKey(good.fn, DRIVE, driveKey)).toBe('file');
    const bad = request({
      ...withFile(v2Envelope),
      [`drives/${DRIVE}/trace-inbox`]: { inbox: inboxRecord },
    });
    expect(await verifyDriveKey(bad.fn, DRIVE, otherKey)).toBe('mismatch');
  });

  it('a v2 envelope with no inbox record is a mismatch, not unverifiable', async () => {
    const r = request({
      ...withFile(v2Envelope),
      [`drives/${DRIVE}/trace-inbox`]: { inbox: null },
    });
    expect(await verifyDriveKey(r.fn, DRIVE, driveKey)).toBe('mismatch');
  });

  it('checks the trace inbox of an empty drive', async () => {
    const paths = {
      [`drives/${DRIVE}/search?limit=5`]: { items: [], nextCursor: null },
      [`drives/${DRIVE}/trace-inbox`]: { inbox: inboxRecord },
    };
    expect(await verifyDriveKey(request(paths).fn, DRIVE, driveKey)).toBe('inbox');
    expect(await verifyDriveKey(request(paths).fn, DRIVE, otherKey)).toBe('mismatch');
  });

  it('is unverifiable when the drive has neither a file nor an inbox', async () => {
    const r = request({
      [`drives/${DRIVE}/search?limit=5`]: { items: [], nextCursor: null },
      [`drives/${DRIVE}/trace-inbox`]: { inbox: null },
    });
    expect(await verifyDriveKey(r.fn, DRIVE, driveKey)).toBe('unverifiable');
    expect(await verifyDriveKey(r.fn, DRIVE, otherKey)).toBe('unverifiable');
  });

  it('lets metadata errors surface instead of guessing', async () => {
    const r = request({});
    await expect(verifyDriveKey(r.fn, DRIVE, driveKey)).rejects.toThrow('unexpected request');
  });
});

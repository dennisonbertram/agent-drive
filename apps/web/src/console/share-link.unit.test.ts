import { describe, expect, it } from 'vitest';
import {
  decryptWithFileKey,
  encryptFile,
  generateDriveKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import {
  addShareRow,
  createShareLink,
  expiresAtFor,
  recoverShareLink,
  type Request,
  type ShareRow,
} from './share-link';

const DAY = 86_400_000;

async function setup() {
  const driveKey = generateDriveKey();
  const plaintext = new TextEncoder().encode('hello share');
  const { ciphertext, wrappedKey } = await encryptFile(plaintext, driveKey);
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request: Request = async <T>(path: string, method = 'GET', body?: unknown) => {
    calls.push({ path, method, body });
    if (method === 'GET') return { id: 'ver-1', wrappedKey } as T;
    return {
      id: 'A'.repeat(22),
      versionId: 'ver-1',
      expiresAt: (body as { expiresAt: string }).expiresAt,
      createdAt: 'now',
    } as T;
  };
  return { driveKey, ciphertext, plaintext, calls, request };
}

describe('createShareLink', () => {
  it('posts only path, versionId and expiresAt, and keeps keys in the URL fragment', async () => {
    const { driveKey, ciphertext, plaintext, calls, request } = await setup();
    const link = await createShareLink(request, {
      origin: 'https://drive.test',
      driveId: 'd1',
      path: '/a b.txt',
      driveKey,
      expiry: '7d',
      now: 1_000_000,
    });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(Object.keys(post.body as object).sort()).toEqual(['expiresAt', 'path', 'versionId']);
    expect((post.body as { versionId: string }).versionId).toBe('ver-1');
    expect(link.url).toMatch(/^https:\/\/drive\.test\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}$/);
    const fileKey = link.url.split('#k=')[1]!;
    expect(new TextDecoder().decode(await decryptWithFileKey(ciphertext, fileKey))).toBe(
      new TextDecoder().decode(plaintext),
    );
    const seen = JSON.stringify(calls);
    expect(seen).not.toContain(fileKey);
    expect(seen).not.toContain(driveKey);
  });

  it('rejects a wrong drive key before any POST', async () => {
    const { calls, request } = await setup();
    await expect(
      createShareLink(request, {
        origin: 'https://drive.test',
        driveId: 'd1',
        path: '/a.txt',
        driveKey: generateDriveKey(),
        expiry: '1h',
      }),
    ).rejects.toThrow();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('expiresAtFor', () => {
  const t = Date.UTC(2026, 0, 1);
  it('computes each choice', () => {
    expect(Date.parse(expiresAtFor('1h', t))).toBe(t + 3_600_000);
    expect(Date.parse(expiresAtFor('24h', t))).toBe(t + DAY);
    expect(Date.parse(expiresAtFor('7d', t))).toBe(t + 7 * DAY);
    expect(Date.parse(expiresAtFor('30d', t))).toBeLessThanOrEqual(t + 30 * DAY - 59 * 60_000);
  });
});

const row = (id: string, extra: Partial<ShareRow> = {}): ShareRow => ({
  id,
  path: '/a.txt',
  versionId: 'ver-1',
  expiresAt: '2026-02-01T00:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-01-01T00:00:10.000Z',
  status: 'active',
  ...extra,
});

describe('addShareRow', () => {
  it('prepends a new row and never duplicates an id already listed', () => {
    const items = [row('b')];
    expect(addShareRow(items, row('a')).map((r) => r.id)).toEqual(['a', 'b']);
    expect(addShareRow(items, row('b'))).toBe(items);
  });
});

describe('createShareLink onPrepared', () => {
  it('reports the file key and version after unwrapping and before the POST', async () => {
    const { driveKey, calls, request } = await setup();
    let seenPosts = -1;
    let prepared: { fileKey: string; versionId: string } | undefined;
    await createShareLink(request, {
      origin: 'https://drive.test',
      driveId: 'd1',
      path: '/a.txt',
      driveKey,
      expiry: '1h',
      onPrepared: (p) => {
        prepared = p;
        seenPosts = calls.filter((c) => c.method === 'POST').length;
      },
    });
    expect(seenPosts).toBe(0);
    expect(prepared?.versionId).toBe('ver-1');
    expect(prepared?.fileKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is not called when the drive key is wrong', async () => {
    const { request } = await setup();
    let called = false;
    await expect(
      createShareLink(request, {
        origin: 'https://drive.test',
        driveId: 'd1',
        path: '/a.txt',
        driveKey: generateDriveKey(),
        expiry: '1h',
        onPrepared: () => {
          called = true;
        },
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe('recoverShareLink', () => {
  const args = {
    origin: 'https://drive.test',
    driveId: 'd1',
    path: '/a.txt',
    versionId: 'ver-1',
    fileKey: 'K'.repeat(43),
    knownIds: new Set(['old']),
    since: Date.parse('2026-01-01T00:00:00.000Z'),
  };
  const listing = (items: ShareRow[]): Request =>
    (async () => ({ items, nextCursor: null })) as unknown as Request;

  it('rebuilds the URL of a link created after the attempt began', async () => {
    const found = await recoverShareLink(listing([row('old'), row('Z'.repeat(22))]), args);
    expect(found?.id).toBe('Z'.repeat(22));
    expect(found?.url).toBe(`https://drive.test/s/${'Z'.repeat(22)}#k=${'K'.repeat(43)}`);
  });

  it('ignores known, older, other-file, other-version and revoked links', async () => {
    const none = await recoverShareLink(
      listing([
        row('old'),
        row('n1', { createdAt: '2025-12-31T00:00:00.000Z' }),
        row('n2', { path: '/b.txt' }),
        row('n3', { versionId: 'ver-2' }),
        row('n4', { status: 'revoked' }),
      ]),
      args,
    );
    expect(none).toBeNull();
  });
});

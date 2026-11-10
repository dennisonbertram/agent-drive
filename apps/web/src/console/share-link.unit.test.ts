import { describe, expect, it, vi } from 'vitest';
import {
  decryptWithFileKey,
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import {
  createTraceInbox,
  sealFileKeyToInbox,
} from '../../../../packages/agent-drive/src/trace-inbox.ts';
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
  const paged = (
    pages: Record<string, { items: ShareRow[]; nextCursor: string | null } | Error>,
  ) => {
    const calls: string[] = [];
    const request = (async <T>(path: string) => {
      calls.push(path);
      const cursor = new URL(path, 'https://drive.test').searchParams.get('cursor') ?? '';
      const page = pages[cursor];
      if (!page) throw new Error(`unexpected cursor ${cursor}`);
      if (page instanceof Error) throw page;
      return page as T;
    }) as Request;
    return { request, calls };
  };

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

  it('finds the unique candidate after an empty first page and encodes the cursor', async () => {
    const token = 'page +/opaque';
    const { request, calls } = paged({
      '': { items: [], nextCursor: token },
      [token]: { items: [row('Z'.repeat(22))], nextCursor: null },
    });
    const found = await recoverShareLink(request, args);
    expect(found?.id).toBe('Z'.repeat(22));
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!, 'https://drive.test').searchParams.get('cursor')).toBe(token);
    expect(
      calls.every(
        (path) => new URL(path, 'https://drive.test').searchParams.get('limit') === '100',
      ),
    ).toBe(true);
    expect(calls.join('\n')).not.toContain(args.fileKey);
  });

  it('returns no candidate when distinct matches are split across pages', async () => {
    const { request, calls } = paged({
      '': { items: [row('A'.repeat(22))], nextCursor: 'next' },
      next: { items: [row('B'.repeat(22))], nextCursor: null },
    });
    expect(await recoverShareLink(request, args)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('counts a repeated candidate ID once but waits for the terminal page', async () => {
    const id = 'A'.repeat(22);
    const { request, calls } = paged({
      '': { items: [row(id)], nextCursor: 'next' },
      next: { items: [row(id)], nextCursor: null },
    });
    expect((await recoverShareLink(request, args))?.id).toBe(id);
    expect(calls).toHaveLength(2);
  });

  it('does not return a partial candidate when a later page fails', async () => {
    const { request } = paged({
      '': { items: [row('A'.repeat(22))], nextCursor: 'later' },
      later: new Error('later page unavailable'),
    });
    await expect(recoverShareLink(request, args)).rejects.toThrow('later page unavailable');
  });

  it('returns no candidate for a repeated cursor cycle', async () => {
    const { request, calls } = paged({
      '': { items: [row('A'.repeat(22))], nextCursor: 'cursor-A' },
      'cursor-A': { items: [], nextCursor: 'cursor-B' },
      'cursor-B': { items: [], nextCursor: 'cursor-A' },
    });
    expect(await recoverShareLink(request, args)).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('returns no partial candidate when the ten-page budget ends before a terminal page', async () => {
    const pages: Record<string, { items: ShareRow[]; nextCursor: string | null }> = {};
    pages[''] = { items: [row('A'.repeat(22))], nextCursor: 'cursor-1' };
    for (let page = 1; page < 10; page += 1) {
      pages[`cursor-${page}`] = {
        items: [],
        nextCursor: `cursor-${page + 1}`,
      };
    }
    const { request, calls } = paged(pages);
    expect(await recoverShareLink(request, args)).toBeNull();
    expect(calls).toHaveLength(10);
  });
});

describe('createShareLink with a trace inbox', () => {
  const DRIVE = '33333333-3333-4333-8333-333333333333';
  const base = (driveKey: string) => ({
    origin: 'https://drive.test',
    driveId: DRIVE,
    path: '/t.json',
    driveKey,
    expiry: '7d' as const,
  });

  it('v2 envelope: loads the inbox and puts the unsealed file key in the fragment', async () => {
    const { driveKey, ciphertext, plaintext, request } = await setup();
    const v1 = (await request<{ wrappedKey: string }>('x')).wrappedKey;
    const record = await createTraceInbox(DRIVE, driveKey);
    const v2 = await sealFileKeyToInbox(await unwrapFileKey(v1, driveKey), {
      driveId: DRIVE,
      ...record,
    });
    const v2Request: Request = async <T>(path: string, method = 'GET', body?: unknown) =>
      method === 'GET' ? ({ id: 'ver-1', wrappedKey: v2 } as T) : request<T>(path, method, body);
    const inbox = vi.fn(async () => record);
    const link = await createShareLink(v2Request, { ...base(driveKey), inbox });
    expect(inbox).toHaveBeenCalledWith(DRIVE);
    expect(await decryptWithFileKey(ciphertext, link.url.split('#k=')[1]!)).toEqual(plaintext);
  });

  it('v1 envelope never calls the loader', async () => {
    const { driveKey, request } = await setup();
    const inbox = vi.fn(async () => null);
    await createShareLink(request, { ...base(driveKey), inbox });
    expect(inbox).not.toHaveBeenCalled();
  });

  it('ignores a driveId inside the record and never POSTs', async () => {
    const { driveKey, request } = await setup();
    const OTHER = '44444444-4444-4444-8444-444444444444';
    const v1 = (await request<{ wrappedKey: string }>('x')).wrappedKey;
    const record = await createTraceInbox(OTHER, driveKey);
    const v2 = await sealFileKeyToInbox(await unwrapFileKey(v1, driveKey), {
      driveId: OTHER,
      ...record,
    });
    const methods: string[] = [];
    const v2Request: Request = async <T>(path: string, method = 'GET', body?: unknown) => {
      methods.push(method);
      return method === 'GET'
        ? ({ id: 'ver-1', wrappedKey: v2 } as T)
        : request<T>(path, method, body);
    };
    const inbox = async () => ({ ...record, driveId: OTHER }) as typeof record;
    await expect(createShareLink(v2Request, { ...base(driveKey), inbox })).rejects.toBeTruthy();
    expect(methods).not.toContain('POST');
  });
});

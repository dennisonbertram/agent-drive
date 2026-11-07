import { describe, expect, it } from 'vitest';
import {
  decryptWithFileKey,
  encryptFile,
  generateDriveKey,
} from '../../../../packages/agent-drive/src/crypto.ts';
import { createShareLink, expiresAtFor, type Request } from './share-link';

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

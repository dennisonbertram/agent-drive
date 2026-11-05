import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import {
  assertDelegation,
  canonicalPath,
  decodeCursor,
  encodeCursor,
  escapeLikeLiteral,
  jsonBody,
  MAX_BODY_BYTES,
  secureTransportAllowed,
  withinWritePaths,
  writePaths,
} from './validation';

describe('API validation helpers', () => {
  it('cancels a JSON stream as soon as it exceeds the byte limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('http://agent-drive.test', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await expect(jsonBody(request)).rejects.toMatchObject({ code: 'validation_error' });
    expect(cancelled).toBe(true);
  });

  it('validates cursor structure and supports maximum-length paths', () => {
    const id = '8fc84b3f-81b5-48b8-b22d-21f14859d0e3';
    const path = `/${'a'.repeat(1023)}`;
    const cursor = encodeCursor({ value: path, id });
    expect(cursor.length).toBeLessThanOrEqual(2048);
    expect(decodeCursor(cursor, 'path')).toEqual({ value: path, id });
    expect(() => decodeCursor(encodeCursor({ sql: 'invalid' }), 'path')).toThrow(ApiError);
  });

  it('validates share cursor timestamps and identifiers', () => {
    const value = '2025-01-02T03:04:05.000Z';
    const id = 'A'.repeat(22);
    const cursor = encodeCursor({ value, id });
    expect(decodeCursor(cursor, 'share')).toEqual({ value, id });
    expect(() => decodeCursor(encodeCursor({ value: 'not-a-date', id }), 'share')).toThrow(
      ApiError,
    );
  });

  it('accepts only positive bigint seq cursors with a UUID id', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const ok = '9223372036854775807';
    expect(decodeCursor(encodeCursor({ value: ok, id }), 'seq')).toEqual({ value: ok, id });
    for (const value of ['9223372036854775808', '0', '2025-01-02T03:04:05.000Z', '-1', '1.5'])
      expect(() => decodeCursor(encodeCursor({ value, id }), 'seq')).toThrow(ApiError);
    expect(() => decodeCursor(encodeCursor({ value: '1', id: 'nope' }), 'seq')).toThrow(ApiError);
  });

  it('escapes SQL LIKE wildcard characters and rejects noncanonical paths', () => {
    expect(escapeLikeLiteral('/a%_b\\c')).toBe('/a\\%\\_b\\\\c');
    expect(() => canonicalPath('/a/../b')).toThrow(ApiError);
  });

  it('requires the request URL to be HTTPS in production', () => {
    const insecureRequest = new Request('http://agent-drive.test/api/v1/whoami', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const secureRequest = new Request('https://agent-drive.test/api/v1/whoami');
    expect(secureTransportAllowed(new URL(insecureRequest.url).protocol, 'production')).toBe(false);
    expect(secureTransportAllowed(new URL(secureRequest.url).protocol, 'production')).toBe(true);
    expect(secureTransportAllowed(new URL(insecureRequest.url).protocol, 'test')).toBe(true);
  });

  it('validates writePaths', () => {
    expect(writePaths({})).toEqual([]);
    expect(writePaths({ writePaths: ['/a', '/a', '/b/c'] })).toEqual(['/a', '/b/c']);
    const sixteen = Array.from({ length: 16 }, (_, i) => `/p${i}`);
    expect(writePaths({ writePaths: sixteen })).toHaveLength(16);
    for (const bad of [['/'], ['inbox'], ['/a/'], '/a', [1], [...sixteen, '/p16']])
      expect(() => writePaths({ writePaths: bad })).toThrow(ApiError);
  });

  it('matches write paths on folder boundaries', () => {
    expect(withinWritePaths([], '/anything')).toBe(true);
    expect(withinWritePaths(['/inbox/x'], '/inbox/x')).toBe(true);
    expect(withinWritePaths(['/inbox/x'], '/inbox/x/a.txt')).toBe(true);
    expect(withinWritePaths(['/inbox/x'], '/inbox/xy/a.txt')).toBe(false);
    expect(withinWritePaths(['/inbox/x'], '/inbox')).toBe(false);
    expect(withinWritePaths(['/a', '/b'], '/b/c')).toBe(true);
  });
});

describe('assertDelegation', () => {
  const drive = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const caller = (over: Partial<Parameters<typeof assertDelegation>[0]> = {}) => ({
    driveIds: [drive],
    scopes: ['read', 'write', 'share', 'delegate'],
    writePaths: [] as string[],
    ...over,
  });
  const ask = (over = {}) => ({ driveIds: [drive], scopes: ['read'], writePaths: [], ...over });
  const limit = 'A key cannot grant more than it holds.';

  it('allows a subset of what the caller holds', () => {
    expect(() =>
      assertDelegation(caller(), ask({ scopes: ['read', 'write', 'share'] })),
    ).not.toThrow();
    expect(() =>
      assertDelegation(caller({ writePaths: ['/a'] }), ask({ writePaths: ['/a/b', '/a'] })),
    ).not.toThrow();
  });

  it('names the missing delegate scope', () => {
    expect(() => assertDelegation(caller({ scopes: ['read', 'write', 'share'] }), ask())).toThrow(
      /delegate/,
    );
  });

  it.each([
    ['manage', ask({ scopes: ['manage'] }), { scopes: ['read', 'manage', 'delegate'] }],
    ['delegate', ask({ scopes: ['delegate'] }), {}],
    ['a foreign drive', ask({ driveIds: [drive, other] }), {}],
    ['a scope it lacks', ask({ scopes: ['delete'] }), {}],
    ['a path outside its own', ask({ writePaths: ['/b'] }), { writePaths: ['/a'] }],
    ['no paths when restricted', ask({ writePaths: [] }), { writePaths: ['/a'] }],
    ['a sibling prefix path', ask({ writePaths: ['/ab'] }), { writePaths: ['/a'] }],
  ])('refuses %s', (_name, requested, over) => {
    try {
      assertDelegation(caller(over), requested);
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('permission_denied');
      expect((error as ApiError).message).toBe(limit);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import {
  canonicalPath,
  decodeCursor,
  encodeCursor,
  escapeLikeLiteral,
  jsonBody,
  MAX_BODY_BYTES,
  secureTransportAllowed,
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
});

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

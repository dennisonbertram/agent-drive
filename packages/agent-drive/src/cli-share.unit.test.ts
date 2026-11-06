import { describe, expect, it } from 'vitest';
import { parseShareExpiry } from './cli.js';
import { publicOutput } from './client.js';

describe('share expiry parsing', () => {
  it('parses supported durations', () => {
    expect(parseShareExpiry('30m', 0)).toBe('1970-01-01T00:30:00.000Z');
    expect(parseShareExpiry('24h', 0)).toBe('1970-01-02T00:00:00.000Z');
    expect(parseShareExpiry('7d', 0)).toBe('1970-01-08T00:00:00.000Z');
    expect(parseShareExpiry('2m', 0)).toBe('1970-01-01T00:02:00.000Z');
  });

  it('rejects unsupported or unsafe durations', () => {
    expect(() => parseShareExpiry('5s')).toThrow();
    expect(() => parseShareExpiry('1m')).toThrow(
      '--expires-in must be between 2m and 30d to allow for API request transit (API minimum: 60 seconds).',
    );
    expect(() => parseShareExpiry('31d')).toThrow();
  });
});

describe('public output', () => {
  it('drops the presigned download URL and the wrapped key, keeps the rest', () => {
    const shown = publicOutput({
      id: 'v1',
      path: '/a.md',
      ciphertextSize: 5,
      agentId: 'a',
      createdAt: 't',
      wrappedKey: 'secret',
      downloadUrl: 'https://s3.test/x?X-Amz-Signature=abc',
    });
    expect(shown).toEqual({
      id: 'v1',
      path: '/a.md',
      ciphertextSize: 5,
      agentId: 'a',
      createdAt: 't',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { parseShareFragment } from './fragment';

describe('share fragments', () => {
  it('accepts a canonical 32-byte base64url file key', () => {
    const key = 'A'.repeat(43);
    expect(parseShareFragment(`#k=${key}`)).toBe(key);
  });

  it('returns null when the key is missing', () => {
    expect(parseShareFragment('')).toBeNull();
    expect(parseShareFragment('#other=value')).toBeNull();
  });

  it('rejects invalid and noncanonical key encodings', () => {
    expect(parseShareFragment('#k=short')).toBeNull();
    expect(parseShareFragment(`#k=${'A'.repeat(42)}B`)).toBeNull();
  });
});

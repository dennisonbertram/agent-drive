import { describe, expect, it } from 'vitest';
import { formatBytes } from './bytes';

describe('formatBytes', () => {
  it('uses decimal units (1 KB = 1000 B) with at most two decimals', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.54 KB');
    expect(formatBytes(9700)).toBe('9.7 KB');
    expect(formatBytes(9461)).toBe('9.46 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.15 MB');
    expect(formatBytes(1e12)).toBe('1 TB');
  });
  it('keeps exact plan limits exact', () => {
    expect(formatBytes(5n * 1024n ** 3n)).toBe('5.37 GB');
    expect(formatBytes(String(5n * 1024n ** 3n))).toBe('5.37 GB');
    expect(formatBytes(1024n * 1024n ** 3n)).toBe('1.1 TB');
  });
  it('promotes the unit when rounding reaches 1000', () => {
    expect(formatBytes(999_999)).toBe('1 MB');
    expect(formatBytes(999_994)).toBe('999.99 KB');
  });
  it('handles huge values without precision loss', () => {
    expect(formatBytes(12345n * 10n ** 12n)).toBe('12345 TB');
  });
});

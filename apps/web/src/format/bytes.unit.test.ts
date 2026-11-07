import { describe, expect, it } from 'vitest';
import { formatBytes, perGbDollars } from './bytes';

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
  it('is exact past Number.MAX_SAFE_INTEGER and rejects non-integer strings', () => {
    expect(formatBytes('9007204999999999')).toBe('9007.2 TB');
    expect(formatBytes(9007204999999999n)).toBe('9007.2 TB');
    expect(formatBytes('9007199254740993')).toBe('9007.2 TB');
    expect(() => formatBytes('1.5')).toThrow();
    expect(() => formatBytes('abc')).toThrow();
    expect(() => formatBytes('')).toThrow();
  });
  it('shows the exact price per decimal GB for a per-GiB rate, rounded up', () => {
    // 1 cent per GiB = $0.01 / 1.073741824 GB = $0.0093132...
    expect(perGbDollars(1n)).toBe('$0.0094');
    expect(perGbDollars(10n)).toBe('$0.0932');
    expect(perGbDollars(0n)).toBe('$0.0000');
  });
});

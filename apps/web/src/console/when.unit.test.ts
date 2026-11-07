import { describe, expect, it } from 'vitest';
import { versionWhen } from './when';

// Local-time dates, so the test does not depend on the machine's time zone.
const now = new Date(2026, 10, 7, 9, 30);
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m, d, h, min).toISOString();

describe('versionWhen', () => {
  it('says today and yesterday with a 24-hour time', () => {
    expect(versionWhen(at(2026, 10, 7, 14, 2), now)).toBe('today 14:02');
    expect(versionWhen(at(2026, 10, 7, 0, 5), now)).toBe('today 00:05');
    expect(versionWhen(at(2026, 10, 6, 23, 59), now)).toBe('yesterday 23:59');
  });
  it('uses local midnight as the boundary', () => {
    const justAfterMidnight = new Date(2026, 10, 7, 0, 1);
    expect(versionWhen(at(2026, 10, 6, 23, 59), justAfterMidnight)).toBe('yesterday 23:59');
    expect(versionWhen(at(2026, 10, 5, 23, 59), justAfterMidnight)).toBe('Nov 5, 23:59');
  });
  it('shows month, day and time in the same year', () => {
    expect(versionWhen(at(2026, 10, 3, 14, 2), now)).toBe('Nov 3, 14:02');
    expect(versionWhen(at(2026, 0, 1, 8, 0), now)).toBe('Jan 1, 08:00');
  });
  it('shows the year, without a time, for other years', () => {
    expect(versionWhen(at(2025, 10, 3, 14, 2), now)).toBe('Nov 3, 2025');
    expect(versionWhen(at(2025, 11, 31, 23, 59), new Date(2026, 0, 2, 0, 1))).toBe('Dec 31, 2025');
  });
  it('handles yesterday across a month boundary', () => {
    expect(versionWhen(at(2026, 9, 31, 10, 0), new Date(2026, 10, 1, 8, 0))).toBe(
      'yesterday 10:00',
    );
  });
  it('returns a dash for a missing or invalid time', () => {
    expect(versionWhen(undefined, now)).toBe('—');
    expect(versionWhen('nope', now)).toBe('—');
  });
});

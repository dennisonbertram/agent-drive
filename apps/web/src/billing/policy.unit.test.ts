import { describe, expect, it } from 'vitest';
import { GIB, PLANS, quoteUsage, monthBounds, accruedOverage, downloadsLabel } from './policy';

const rates = { drive: 200n, storage: 5n, egress: 15n, operations: 1n };
describe('billing quota and price math', () => {
  it('counts every retained version, including overwritten and trashed versions', () => {
    const retainedVersions = [3n * GIB, 2n * GIB, 1n];
    const usage = {
      drives: 1n,
      storageBytes: retainedVersions.reduce((sum, bytes) => sum + bytes, 0n),
      egressBytes: 0n,
      operations: 0n,
    };
    expect(quoteUsage('free', usage, rates).overLimit).toBe(true);
    expect(quoteUsage('developer', usage, rates).totalCents).toBe(2000n);
  });
  it('rounds each overage category upward only to a cent, without floating point', () => {
    const usage = {
      drives: 26n,
      storageBytes: 100n * GIB + 1n,
      egressBytes: 101n * GIB,
      operations: 10_000_001n,
    };
    expect(quoteUsage('developer', usage, rates)).toEqual({
      overLimit: true,
      overageCents: 217n,
      totalCents: 2217n,
    });
    expect(quoteUsage('developer', { ...PLANS.developer }, rates).totalCents).toBe(2000n);
  });
  it('does not silently enable overage without configured prices', () => {
    expect(
      quoteUsage(
        'developer',
        { drives: 26n, storageBytes: 0n, egressBytes: 0n, operations: 0n },
        null,
      ),
    ).toEqual({ overLimit: true, overageCents: 0n, totalCents: 2000n });
  });
  it('uses UTC calendar-month boundaries across years and leap days', () => {
    expect(monthBounds(new Date('2024-02-29T23:59:59Z')).end.toISOString()).toBe(
      '2024-03-01T00:00:00.000Z',
    );
    expect(monthBounds(new Date('2026-12-31T23:59:59Z')).end.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
  it('preserves already-earned overage at a plan change without repricing prior usage', () => {
    const earned = accruedOverage(217n, 0n, 0n);
    expect(accruedOverage(0n, 0n, earned)).toBe(217n);
    expect(accruedOverage(350n, 300n, earned)).toBe(267n);
    expect(accruedOverage(299n, 300n, earned)).toBe(217n);
  });
});

describe('pricing download wording', () => {
  it('lists the allowance only when downloads are metered', () => {
    expect(downloadsLabel('100 GiB', false)).toBe('100 GiB monthly downloads included');
    expect(downloadsLabel('100 GiB', true)).toBe('Downloads not charged');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  cleanupExpiredUploads,
  createOpportunisticUploadCleanup,
  maybeCleanupExpiredUploads,
} from './upload-cleanup';

describe('opportunistic expired upload cleanup', () => {
  it('exposes a per-process entry point for put handlers', () => {
    expect(typeof maybeCleanupExpiredUploads).toBe('function');
  });

  it('runs on the first call and skips calls inside the interval', async () => {
    let clock = 1_000_000;
    const run = vi.fn(async () => 0);
    const warn = vi.fn();
    const maybe = createOpportunisticUploadCleanup({ run, warn, now: () => clock });

    await expect(maybe()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    clock += 59_999;
    await expect(maybe()).resolves.toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    clock += 1;
    await expect(maybe()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('runs at most once while one cleanup is in flight and the trigger awaits it', async () => {
    let release!: () => void;
    const gate = new Promise<number>((resolve) => {
      release = () => resolve(0);
    });
    const run = vi.fn(() => gate);
    const maybe = createOpportunisticUploadCleanup({ run, warn: vi.fn(), now: () => 0 });

    const first = maybe();
    const second = maybe();
    const third = maybe();
    expect(run).toHaveBeenCalledTimes(1);

    await expect(second).resolves.toBe(false);
    await expect(third).resolves.toBe(false);

    // The caller that performs the cleanup must await it: `first` is still pending.
    let finished = false;
    void first.then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    release();
    await expect(first).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a sanitized warning on failure and retries after a bounded delay', async () => {
    let clock = 0;
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('connect to postgres://agent:supersecret@db.internal:5432 failed'),
      )
      .mockResolvedValue(0);
    const warn = vi.fn();
    const maybe = createOpportunisticUploadCleanup({ run, warn, now: () => clock });

    // The failing cleanup must not fail the upload.
    await expect(maybe()).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).not.toContain('supersecret');
    expect(message).not.toContain('postgres://');
    expect(message).not.toContain('db.internal');

    // A follow-up call inside the retry delay is skipped.
    clock += 1_000;
    await expect(maybe()).resolves.toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    // After the bounded delay the next call retries, well before the full interval.
    clock += 4_000;
    await expect(maybe()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed attempt block concurrent callers as in-flight', async () => {
    let clock = 0;
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(0);
    const maybe = createOpportunisticUploadCleanup({ run, warn: vi.fn(), now: () => clock });

    await expect(maybe()).resolves.toBe(true);
    clock += 5_000;
    await expect(maybe()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('explicit expired upload cleanup', () => {
  it('still enforces the batch limit before touching the database', async () => {
    await expect(cleanupExpiredUploads(0)).rejects.toThrow(RangeError);
    await expect(cleanupExpiredUploads(101)).rejects.toThrow(RangeError);
    await expect(cleanupExpiredUploads(1.5)).rejects.toThrow(RangeError);
  });
});

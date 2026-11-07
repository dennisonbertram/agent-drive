import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_LIMIT_MS, startIdleLock } from './idle-lock';

const minutes = (n: number) => n * 60_000;

describe('startIdleLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('limit is 30 minutes', () => expect(IDLE_LIMIT_MS).toBe(minutes(30)));

  it('is not idle at 29:59 and locks once by 30:15', () => {
    const onIdle = vi.fn();
    startIdleLock({ onIdle, target: new EventTarget() as unknown as Document });
    vi.advanceTimersByTime(minutes(30) - 1000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(minutes(1));
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(minutes(5));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('a pointerdown at 20:00 moves the lock to 50:00', () => {
    const onIdle = vi.fn();
    const target = new EventTarget();
    startIdleLock({ onIdle, target: target as unknown as Document });
    vi.advanceTimersByTime(minutes(20));
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(minutes(29));
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(minutes(1) + 15_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('locks immediately on visibilitychange after a long sleep', () => {
    const onIdle = vi.fn();
    const target = new EventTarget();
    startIdleLock({ onIdle, target: target as unknown as Document });
    vi.setSystemTime(minutes(31));
    target.dispatchEvent(new Event('visibilitychange'));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stop() removes the listeners and the timer', () => {
    const onIdle = vi.fn();
    const target = new EventTarget();
    const lock = startIdleLock({ onIdle, target: target as unknown as Document });
    lock.stop();
    vi.setSystemTime(minutes(60));
    target.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(minutes(60));
    expect(onIdle).not.toHaveBeenCalled();
  });
});

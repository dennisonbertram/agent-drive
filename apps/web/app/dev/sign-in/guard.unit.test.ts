import { describe, expect, it } from 'vitest';
import { devSignInAllowed, parseDevUserId } from './guard';

describe('devSignInAllowed', () => {
  const ok = { nodeEnv: 'development', testAuth: true, host: 'localhost:3600' };
  it('allows development + enabled + localhost', () => {
    expect(devSignInAllowed(ok)).toBe(true);
    expect(devSignInAllowed({ ...ok, host: '127.0.0.1:3000' })).toBe(true);
    expect(devSignInAllowed({ ...ok, host: 'localhost' })).toBe(true);
  });
  it('denies when any condition is missing', () => {
    expect(devSignInAllowed({ ...ok, nodeEnv: 'production' })).toBe(false);
    expect(devSignInAllowed({ ...ok, testAuth: false })).toBe(false);
    expect(devSignInAllowed({ ...ok, host: 'example.com' })).toBe(false);
    expect(devSignInAllowed({ ...ok, host: 'localhost.evil.com' })).toBe(false);
    expect(devSignInAllowed({ ...ok, host: null })).toBe(false);
  });
});

describe('parseDevUserId', () => {
  it('defaults and accepts e2e ids', () => {
    expect(parseDevUserId(null)).toBe('e2e_uxreview');
    expect(parseDevUserId('')).toBe('e2e_uxreview');
    expect(parseDevUserId('e2e_other-1')).toBe('e2e_other-1');
  });
  it('rejects others', () => {
    expect(parseDevUserId('user_123')).toBeNull();
    expect(parseDevUserId('e2e_bad id')).toBeNull();
  });
});

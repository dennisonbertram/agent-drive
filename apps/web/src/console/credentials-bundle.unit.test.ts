import { describe, expect, it } from 'vitest';
import { driveKeyFromBundle } from './credentials-bundle';

const bundle = (value: unknown) =>
  `adcred1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;

describe('driveKeyFromBundle', () => {
  const good = bundle({
    v: 1,
    apiUrl: 'https://x',
    apiKey: 'k',
    driveKeys: { d1: 'KEY1', d2: 'KEY2' },
  });
  it('returns the selected drive key', () => {
    expect(driveKeyFromBundle(` ${good}\n`, 'd2')).toBe('KEY2');
  });
  it('rejects a missing drive, bad prefix, bad version, bad encoding', () => {
    expect(() => driveKeyFromBundle(good, 'd3')).toThrow(/does not contain/);
    expect(() => driveKeyFromBundle('nope', 'd1')).toThrow();
    expect(() => driveKeyFromBundle(bundle({ v: 2, driveKeys: { d1: 'a' } }), 'd1')).toThrow();
    expect(() => driveKeyFromBundle('adcred1.!!!', 'd1')).toThrow();
  });
});

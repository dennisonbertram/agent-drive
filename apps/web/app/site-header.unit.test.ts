import { describe, expect, it } from 'vitest';
import { authHref, safeRedirect } from './site-header';

describe('safeRedirect', () => {
  const origin = 'https://agentdrive.test';

  it('keeps safe relative paths with query and fragment', () => {
    expect(safeRedirect('/console?drive=drv_1&path=/team/specs', origin)).toBe(
      '/console?drive=drv_1&path=/team/specs',
    );
    expect(safeRedirect('/connect?code=ABCD-EFGH', origin)).toBe('/connect?code=ABCD-EFGH');
  });

  it('reduces an absolute http(s) URL on the deployment origin to path, query and fragment', () => {
    expect(safeRedirect(`${origin}/console?drive=drv_1#top`, origin)).toBe(
      '/console?drive=drv_1#top',
    );
    expect(safeRedirect('HTTP://AGENTDRIVE.TEST/console', 'http://agentdrive.test')).toBe(
      '/console',
    );
  });

  it('matches when the explicit default port spells the same origin', () => {
    expect(safeRedirect('https://agentdrive.test:443/console?drive=drv_1', origin)).toBe(
      '/console?drive=drv_1',
    );
    expect(safeRedirect('http://localhost:80/console', 'http://localhost')).toBe('/console');
    expect(safeRedirect('https://agentdrive.test/console', 'https://agentdrive.test:443')).toBe(
      '/console',
    );
  });

  it('rejects userinfo, other origins, other schemes and non-default ports', () => {
    for (const v of [
      'https://owner@agentdrive.test/console',
      'https://owner:pw@agentdrive.test/console',
      'https://evil.example/console',
      'https://agentdrive.test.evil.example/console',
      'https://agentdrive.test:444/console',
      'http://agentdrive.test/console',
      'ftp://agentdrive.test/console',
      'javascript:alert(1)',
    ]) {
      expect(safeRedirect(v, origin), v).toBeUndefined();
    }
  });

  it('rejects protocol-relative values and a serialized // pathname', () => {
    expect(safeRedirect('//evil.example/console', origin)).toBeUndefined();
    expect(safeRedirect(`${origin}//evil.example/x`, origin)).toBeUndefined();
    expect(safeRedirect('//agentdrive.test/console', origin)).toBeUndefined();
  });

  it('rejects backslashes, whitespace and non-strings', () => {
    expect(safeRedirect('/\\evil', origin)).toBeUndefined();
    expect(safeRedirect('/\t/evil', origin)).toBeUndefined();
    expect(safeRedirect('https://agentdrive.test/\\evil', origin)).toBeUndefined();
    expect(safeRedirect(undefined, origin)).toBeUndefined();
    expect(safeRedirect(['/console'], origin)).toBeUndefined();
  });

  it('rejects absolute URLs when no deployment origin is given', () => {
    expect(safeRedirect(`${origin}/console`)).toBeUndefined();
  });
});

describe('authHref', () => {
  it('builds plain auth hrefs and carries an already-validated redirect', () => {
    expect(authHref('sign-in')).toBe('/sign-in');
    expect(authHref('sign-up')).toBe('/sign-up');
    expect(authHref('sign-up', '/console?drive=drv_1&path=/a')).toBe(
      '/sign-up?redirect_url=%2Fconsole%3Fdrive%3Ddrv_1%26path%3D%2Fa',
    );
  });
});

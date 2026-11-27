import { describe, expect, it } from 'vitest';
import { consoleFolderUrl } from './console-link.js';

describe('consoleFolderUrl', () => {
  it('links the folder holding the saved path on the configured API origin', () => {
    expect(consoleFolderUrl('https://drive.example', 'd1', '/outputs/launch/video final.mp4')).toBe(
      'https://drive.example/console?drive=d1&path=%2Foutputs%2Flaunch',
    );
  });

  it('encodes reserved characters in the folder', () => {
    expect(consoleFolderUrl('https://x.test', 'd', '/a & b/c#d/f.txt')).toBe(
      'https://x.test/console?drive=d&path=%2Fa+%26+b%2Fc%23d',
    );
  });

  it('opens the drive root for a root file or a path with no folder', () => {
    const root = 'https://x.test/console?drive=d&path=%2F';
    expect(consoleFolderUrl('https://x.test', 'd', '/f.txt')).toBe(root);
    expect(consoleFolderUrl('https://x.test', 'd', '')).toBe(root);
    expect(consoleFolderUrl('https://x.test', 'd', 'no-slash')).toBe(root);
    expect(consoleFolderUrl('https://x.test', 'd', undefined as unknown as string)).toBe(root);
  });

  it('carries no credentials and strips any userinfo in the origin', () => {
    const url = consoleFolderUrl('https://user:pass@x.test', 'd', '/a/f.txt');
    expect(url).toBe('https://x.test/console?drive=d&path=%2Fa');
    expect(url).not.toContain('@');
    expect(url).not.toContain('pass');
  });

  it('keeps a self-hosted origin instead of pointing at the hosted console', () => {
    expect(consoleFolderUrl('http://127.0.0.1:3000', 'd', '/a/f.txt')).toBe(
      'http://127.0.0.1:3000/console?drive=d&path=%2Fa',
    );
  });

  it('omits the link when the origin is unusable or the drive id is empty', () => {
    expect(consoleFolderUrl('not a url', 'd', '/a/f.txt')).toBeUndefined();
    expect(consoleFolderUrl('', 'd', '/a/f.txt')).toBeUndefined();
    expect(consoleFolderUrl('foo:bar', 'd', '/a/f.txt')).toBeUndefined();
    expect(consoleFolderUrl('https://x.test', '', '/a/f.txt')).toBeUndefined();
  });
});

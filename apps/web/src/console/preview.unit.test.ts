import { describe, expect, it } from 'vitest';
import { looksBinary, previewKind, previewMime } from './preview';

describe('preview', () => {
  it('classifies by extension', () => {
    for (const n of ['report.html', 'logo.svg', 'README.MD', 'a/b.json'])
      expect(previewKind(n)).toBe('text');
    for (const n of ['a.PNG', 'b.jpeg', 'c.webp', 'd.gif']) expect(previewKind(n)).toBe('image');
    expect(previewKind('c.pdf')).toBe('pdf');
    for (const n of ['clip.mp4', 'CLIP.MP4', 'take.webm', 'a/b/final.mp4'])
      expect(previewKind(n)).toBe('video');
    for (const n of ['d.heic', 'e.bin', 'noext', 'x.constructor', 'dir.md/file'])
      expect(previewKind(n)).toBe('none');
    // Still not supported: other containers never get a preview or a MIME type.
    for (const n of ['c.mov', 'd.mkv', 'e.avi', 'f.m4v', 'g.mp3', 'h.wav'])
      expect(previewKind(n)).toBe('none');
  });
  it('only gives a MIME type for image, pdf and video', () => {
    expect(previewMime('logo.svg')).toBeNull();
    expect(previewMime('x.html')).toBeNull();
    expect(previewMime('x.txt')).toBeNull();
    expect(previewMime('a.JPG')).toBe('image/jpeg');
    expect(previewMime('a.pdf')).toBe('application/pdf');
    expect(previewMime('a.MP4')).toBe('video/mp4');
    expect(previewMime('a.webm')).toBe('video/webm');
    expect(previewMime('a.mov')).toBeNull();
    expect(previewMime('a.mp3')).toBeNull();
  });
  it('detects binary by NUL in the first 8192 bytes', () => {
    const b = new Uint8Array(200);
    b.fill(65);
    b[100] = 0;
    expect(looksBinary(b)).toBe(true);
    expect(looksBinary(new TextEncoder().encode('héllo 😀'))).toBe(false);
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
  });
});

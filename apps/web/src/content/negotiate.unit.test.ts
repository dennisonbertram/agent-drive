import { describe, expect, it } from 'vitest';
import { prefersMarkdown } from './negotiate';

describe('prefersMarkdown', () => {
  it.each([
    ['text/markdown', true],
    ['text/markdown;q=0, text/html', false],
    ['text/html;q=0.5, text/markdown', true],
    ['text/markdown;q=0.4, text/html;q=0.8', false],
    ['text/markdown, text/html;q=0.9', true],
    ['text/markdown, text/html', true],
    ['text/html, text/markdown', false],
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', false],
    ['*/*', false],
    ['text/*', false],
    ['', false],
    [null, false],
    ['text/markdown;q=abc', true],
  ])('%s -> %s', (accept, want) => {
    expect(prefersMarkdown(accept)).toBe(want);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

describe('Markdown renderer', () => {
  it('returns for an indented list', () => {
    expect(html('  - one\n  - two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });
  it('returns for a nested list and keeps the text', () => {
    const out = html('- a\n  - b\n- c');
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
  });
  it('returns for a list at end of input and a lone dash', () => {
    expect(html('- last')).toBe('<ul><li>last</li></ul>');
    expect(html('-')).toBe('<p>-</p>');
    expect(html('1.')).toBe('<p>1.</p>');
  });
  it('returns for a very long input', () => {
    const src = Array.from({ length: 20000 }, (_, i) => `  - item ${String(i)}`).join('\n');
    expect(html(src).length).toBeGreaterThan(src.length);
  });
  it('shows raw HTML as text', () => {
    expect(html('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });
}, 10_000);

import { describe, expect, it } from 'vitest';
import { sanitizeModel, tracePath, traceTags } from './trace-path.js';

describe('trace paths', () => {
  it('builds the dated path', () => {
    expect(
      tracePath({
        agent: 'claude',
        model: 'claude-sonnet-4-5',
        at: new Date('2026-11-08T12:00:01.123Z'),
        suffix: 'ab12cd',
      }),
    ).toBe('/traces/claude/2026-11-08/120001.123Z_claude-sonnet-4-5_ab12cd.json');
  });

  it('sanitizes and bounds the model so every tag fits in 64 characters', () => {
    const model = sanitizeModel(`a/b c${'x'.repeat(80)}`);
    expect(model).toMatch(/^[A-Za-z0-9._-]{1,50}$/u);
    expect(model.startsWith('a-b-c')).toBe(true);
    for (const tag of traceTags('a'.repeat(40), 'm'.repeat(80)))
      expect(tag.length).toBeLessThanOrEqual(64);
    expect(traceTags('codex', 'gpt-5')).toEqual(['trace', 'agent:codex', 'model:gpt-5']);
  });

  it('falls back to unknown and to the undated folder', () => {
    expect(sanitizeModel(undefined)).toBe('unknown');
    expect(sanitizeModel('')).toBe('unknown');
    expect(tracePath({ agent: 'x', model: null, at: null, suffix: 'abc123' })).toBe(
      '/traces/x/undated/unknown_abc123.json',
    );
  });
});

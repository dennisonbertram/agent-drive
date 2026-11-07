import { describe, expect, it } from 'vitest';
import { keyDetail } from './audit-who';

describe('keyDetail', () => {
  it('drops the agent name the label already starts with', () => {
    expect(keyDetail('flowtest-codex', 'flowtest-codex on flowtest-sandbox')).toBe(
      'on flowtest-sandbox',
    );
    expect(keyDetail('flowtest-codex', 'Flowtest-Codex')).toBeNull();
    expect(keyDetail('flowtest-codex', 'flowtest-codex · laptop')).toBe('laptop');
  });
  it('keeps a label that adds information', () => {
    expect(keyDetail('flowtest-codex', 'ci key')).toBe('ci key');
    expect(keyDetail('You', 'Console')).toBe('Console');
  });
  it('only strips the name as a whole word', () => {
    expect(keyDetail('Ann', 'Annual backup')).toBe('Annual backup');
    expect(keyDetail('Ann', 'Ann on laptop')).toBe('on laptop');
  });
  it('is empty without a label', () => {
    expect(keyDetail('x', null)).toBeNull();
    expect(keyDetail('x', '  ')).toBeNull();
  });
});

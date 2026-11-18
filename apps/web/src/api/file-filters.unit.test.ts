import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { appendFileFilters } from './handler';

const url = (query: string) => new URL(`https://x.test/v1/drives/d/files${query}`);

describe('appendFileFilters', () => {
  it('omits the ILIKE clause and parameter when q is absent', () => {
    const params: unknown[] = ['d', 'p%'];
    const clause = appendFileFilters(url(''), params, true);
    expect(clause).not.toContain('ILIKE');
    expect(params).toHaveLength(2);
  });

  it('omits the ILIKE clause and parameter when q is empty', () => {
    const params: unknown[] = ['d', 'p%'];
    const clause = appendFileFilters(url('?q='), params, true);
    expect(clause).not.toContain('ILIKE');
    expect(params).toHaveLength(2);
  });

  it('adds an escaped ILIKE clause for a non-empty q', () => {
    const params: unknown[] = ['d', 'p%'];
    const clause = appendFileFilters(url('?q=a_b'), params, true);
    expect(params.at(-1)).toBe('%a\\_b%');
    expect(clause).toContain('f.path ILIKE $3 ESCAPE');
  });

  it('numbers later filter placeholders correctly when q is absent', () => {
    const params: unknown[] = ['d'];
    const clause = appendFileFilters(url('?tag=x'), params, true);
    expect(clause).toContain('$2 = ANY(v.tags)');
    expect(params).toEqual(['d', 'x']);
  });

  it('still rejects a q longer than 128 characters', () => {
    const params: unknown[] = [];
    try {
      appendFileFilters(url(`?q=${'a'.repeat(129)}`), params, true);
      expect.unreachable('a q over 128 characters must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('validation_error');
    }
  });
});

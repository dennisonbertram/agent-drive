import { describe, expect, it } from 'vitest';
import { foundationStatus } from './index.js';

describe('scaffold smoke (not product acceptance)', () => {
  it('exposes the package foundation marker', () => {
    expect(foundationStatus).toBe('scaffold');
  });
});

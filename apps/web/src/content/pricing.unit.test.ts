import { afterEach, describe, expect, it } from 'vitest';
import { DISCLOSURE, pricingMarkdown } from './pricing';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe('pricing rates', () => {
  it('shows per-GB prices and the metering unit note in /pricing.md', () => {
    process.env.BILLING_DRIVE_MONTH_CENTS = '100';
    process.env.BILLING_STORAGE_GIB_MONTH_CENTS = '10';
    process.env.BILLING_EGRESS_GIB_CENTS = '20';
    process.env.BILLING_OPERATIONS_1000_CENTS = '5';
    delete process.env.S3_EGRESS_METERING;
    const md = pricingMarkdown('https://x.test');
    expect(md).toContain('- Extra GB stored / month: $0.10');
    expect(md).toContain('- Extra GB downloaded: $0.20');
    expect(md).toContain('Usage is metered in GB of 1,073,741,824 bytes (2^30).');
    expect(md).toContain('5 GB stored ciphertext');
    expect(md).not.toMatch(/5\.37|107\.37|1\.1 TB/);
    expect(DISCLOSURE.usage.join(' ')).toContain('1,073,741,824 bytes');
  });
});

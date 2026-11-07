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
    expect(md).toContain('- Extra GB stored / month: $0.0932');
    expect(md).toContain('- Extra GB downloaded: $0.1863');
    expect(md).toContain(
      'Overage is metered per 1,073,741,824 bytes (1.07 GB); prices above are shown per GB.',
    );
    expect(DISCLOSURE.usage.join(' ')).toContain('1,073,741,824 bytes');
  });
});

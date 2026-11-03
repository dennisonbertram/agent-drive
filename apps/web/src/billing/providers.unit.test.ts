import { afterEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  meterEvent: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class StripeMock {
    billing = { meterEvents: { create: stripeMocks.meterEvent } };
    webhooks = { constructEvent: stripeMocks.constructEvent };

    constructor(key: string, options: unknown) {
      stripeMocks.constructor(key, options);
    }
  },
}));

import {
  checkoutConfigured,
  configured,
  egressMeteringConfigured,
  processStripeWebhook,
  sendBillingEmail,
  sendMeterReport,
} from './providers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('billing provider adapters', () => {
  it('requires a real webhook configuration before enabling checkout', () => {
    for (const [key, value] of Object.entries({
      STRIPE_SECRET_KEY: 'sk_test_configuration_fixture',
      STRIPE_DEVELOPER_PRICE_ID: 'price_developer_fixture',
      STRIPE_TEAM_PRICE_ID: 'price_team_fixture',
      STRIPE_USAGE_PRICE_ID: 'price_usage_fixture',
      STRIPE_METER_EVENT_NAME: 'agent_drive_usage',
      AGENT_DRIVE_PUBLIC_URL: 'http://localhost:3100',
      S3_LOGS_BUCKET: 'logs-fixture',
      S3_LOGS_PREFIX: 'access/',
      BILLING_DRIVE_MONTH_CENTS: '200',
      BILLING_STORAGE_GIB_MONTH_CENTS: '5',
      BILLING_EGRESS_GIB_CENTS: '15',
      BILLING_OPERATIONS_1000_CENTS: '1',
    }))
      vi.stubEnv(key, value);
    for (const value of [
      '',
      '   ',
      'replace-me',
      'whsec_replace_me',
      'price_replace_me',
      'sk_live_replace_me',
    ]) {
      expect(configured(value)).toBe(false);
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', value);
      expect(checkoutConfigured()).toBe(false);
    }
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_configuration_fixture');
    expect(checkoutConfigured()).toBe(true);
  });

  it('allows paid checkout without access logs when the provider does not bill egress', () => {
    for (const [key, value] of Object.entries({
      STRIPE_SECRET_KEY: 'sk_test_configuration_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_configuration_fixture',
      STRIPE_DEVELOPER_PRICE_ID: 'price_developer_fixture',
      STRIPE_TEAM_PRICE_ID: 'price_team_fixture',
      STRIPE_USAGE_PRICE_ID: 'price_usage_fixture',
      STRIPE_METER_EVENT_NAME: 'agent_drive_usage',
      AGENT_DRIVE_PUBLIC_URL: 'http://localhost:3100',
      BILLING_DRIVE_MONTH_CENTS: '200',
      BILLING_STORAGE_GIB_MONTH_CENTS: '5',
      BILLING_EGRESS_GIB_CENTS: '15',
      BILLING_OPERATIONS_1000_CENTS: '1',
      S3_LOGS_BUCKET: '',
      S3_LOGS_PREFIX: '',
      S3_EGRESS_METERING: 'none',
    }))
      vi.stubEnv(key, value);

    expect(checkoutConfigured()).toBe(true);
    expect(egressMeteringConfigured()).toBe(false);

    vi.stubEnv('S3_EGRESS_METERING', '');
    expect(checkoutConfigured()).toBe(false);
    expect(egressMeteringConfigured()).toBe(false);
  });

  it('uses the durable report id as the Stripe meter-event identifier on retries', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_provider_fixture');
    vi.stubEnv('STRIPE_METER_EVENT_NAME', 'agent_drive_usage');
    stripeMocks.meterEvent.mockResolvedValue({});
    const report = {
      id: 'a35924df-2a99-4b8a-aec8-48cfc546e8da',
      customer: 'cus_fixture',
      cents: '55',
      timestamp: 1_800_000_000,
    };

    await sendMeterReport(report);
    await sendMeterReport(report);

    expect(stripeMocks.constructor).toHaveBeenCalledWith('sk_test_provider_fixture', {
      timeout: 10_000,
    });
    for (const call of stripeMocks.meterEvent.mock.calls)
      expect(call).toEqual([
        {
          event_name: 'agent_drive_usage',
          payload: { value: '55', stripe_customer_id: 'cus_fixture' },
          identifier: report.id,
          timestamp: 1_800_000_000,
        },
        { idempotencyKey: report.id },
      ]);
  });

  it('sends fixed billing-email content with a stable Resend idempotency key', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_provider_fixture');
    vi.stubEnv('EMAIL_FROM', 'Agent Drive <billing@example.test>');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const message = {
      idempotencyKey: 'billing-notification/fixture',
      to: 'owner@example.test',
      subject: 'Agent Drive billing threshold reached',
      text: 'Your threshold was reached. Review billing at https://example.test/console/billing.',
    };

    await sendBillingEmail(message);
    await sendBillingEmail(message);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test_provider_fixture',
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: 'Agent Drive <billing@example.test>',
          to: ['owner@example.test'],
          subject: message.subject,
          text: message.text,
        }),
      });
    }
  });

  it('rejects invalid webhook signatures without processing an event', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_provider_fixture');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_provider_fixture');
    stripeMocks.constructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(processStripeWebhook('{"fixture":true}', 't=1,v1=invalid')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(stripeMocks.constructEvent).toHaveBeenCalledWith(
      '{"fixture":true}',
      't=1,v1=invalid',
      'whsec_provider_fixture',
    );
  });
});

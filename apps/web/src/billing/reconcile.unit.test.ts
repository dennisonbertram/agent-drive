import { describe, expect, it } from 'vitest';
import { classifyMeterDelivery, uniqueCheckoutSession, type CheckoutCandidate } from './reconcile';

describe('billing reconciliation decisions', () => {
  const now = new Date('2026-11-26T12:00:00.000Z');

  it('allows only unleased reports inside the existing retry window to replay', () => {
    expect(
      classifyMeterDelivery({ reported_at: null, first_attempt_at: null, lease_until: null }, now),
    ).toBe('retry-safe');
    expect(
      classifyMeterDelivery(
        {
          reported_at: null,
          first_attempt_at: new Date('2026-11-26T11:00:00.000Z'),
          lease_until: null,
        },
        now,
      ),
    ).toBe('retry-safe');
    expect(
      classifyMeterDelivery(
        {
          reported_at: null,
          first_attempt_at: new Date('2026-11-25T12:59:59.000Z'),
          lease_until: null,
        },
        now,
      ),
    ).toBe('unresolved');
    expect(
      classifyMeterDelivery(
        {
          reported_at: null,
          first_attempt_at: null,
          lease_until: new Date('2026-11-26T12:30:00.000Z'),
        },
        now,
      ),
    ).toBe('leased');
    expect(
      classifyMeterDelivery(
        {
          reported_at: new Date('2026-11-26T11:00:00.000Z'),
          first_attempt_at: new Date('2026-11-26T10:00:00.000Z'),
          lease_until: null,
        },
        now,
      ),
    ).toBe('reported');
  });

  it('recovers checkout only when one session matches the reserved account, customer, mode, price and time', () => {
    const session: CheckoutCandidate = {
      id: 'cs_match',
      customer: 'cus_account',
      client_reference_id: 'account-1',
      mode: 'subscription',
      livemode: false,
      created: Math.floor(Date.parse('2026-11-26T12:00:00.000Z') / 1000),
      status: 'open',
      lineItems: [
        { price: 'price_plan', quantity: 1 },
        { price: 'price_usage', quantity: null },
      ],
    };
    const expected = {
      accountId: 'account-1',
      customerId: 'cus_account',
      liveMode: false,
      planPriceId: 'price_plan',
      usagePriceId: 'price_usage',
      reservedAt: new Date('2026-11-26T12:00:00.000Z'),
      idempotencyKey: 'checkout/v3/account-1/developer/attempt-1',
      now,
    };

    expect(
      uniqueCheckoutSession(
        [
          { ...session, checkoutIdempotencyKey: expected.idempotencyKey },
          { ...session, id: 'cs_legacy' },
        ],
        expected,
      )?.id,
    ).toBe('cs_match');
    expect(uniqueCheckoutSession([session], expected)?.id).toBe('cs_match');
    expect(
      uniqueCheckoutSession([session, { ...session, id: 'cs_duplicate' }], expected),
    ).toBeNull();
    expect(uniqueCheckoutSession([{ ...session, customer: 'cus_other' }], expected)).toBeNull();
    expect(
      uniqueCheckoutSession([{ ...session, client_reference_id: 'account-other' }], expected),
    ).toBeNull();
    expect(uniqueCheckoutSession([{ ...session, livemode: true }], expected)).toBeNull();
    expect(
      uniqueCheckoutSession(
        [{ ...session, lineItems: [{ price: 'price_unrelated', quantity: 1 }] }],
        expected,
      ),
    ).toBeNull();
    expect(
      uniqueCheckoutSession(
        [
          {
            ...session,
            lineItems: [
              { price: 'price_plan', quantity: 1 },
              { price: 'price_usage', quantity: 0 },
            ],
          },
        ],
        expected,
      ),
    ).toBeNull();
    expect(
      uniqueCheckoutSession(
        [
          {
            ...session,
            created: Math.floor(expected.reservedAt.getTime() / 1000) + 23 * 60 * 60 + 1,
          },
        ],
        { ...expected, now: new Date('2026-11-27T12:00:00.000Z') },
      ),
    ).toBeNull();
  });
});

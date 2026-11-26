import { describe, expect, it } from 'vitest';
import {
  checkoutReservationFromKey,
  classifyMeterDelivery,
  uniqueCheckoutSession,
  type CheckoutCandidate,
} from './reconcile';

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
      idempotencyKey: 'checkout/v3/account-1/developer/11111111-1111-4111-8111-111111111111',
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

  it('does not use an untagged legacy session for a v4 reservation', () => {
    const session: CheckoutCandidate = {
      id: 'cs_legacy',
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
      idempotencyKey: 'checkout/v4/account-1/developer/22222222-2222-4222-8222-222222222222',
      now,
    };

    expect(uniqueCheckoutSession([session], expected)).toBeNull();
    expect(
      uniqueCheckoutSession(
        [{ ...session, id: 'cs_v4', checkoutIdempotencyKey: expected.idempotencyKey }],
        expected,
      )?.id,
    ).toBe('cs_v4');
    expect(
      uniqueCheckoutSession([session], {
        ...expected,
        idempotencyKey: 'checkout/v3/account-1/developer/33333333-3333-4333-8333-333333333333',
      })?.id,
    ).toBe('cs_legacy');
  });

  it('parses only known checkout reservation key formats and their requested plan', () => {
    expect(
      checkoutReservationFromKey(
        'checkout/v4/account-1/team/44444444-4444-4444-8444-444444444444',
        'account-1',
      ),
    ).toEqual({ plan: 'team', requiresExactSessionMetadata: true });
    expect(
      checkoutReservationFromKey(
        'checkout/v3/account-1/developer/55555555-5555-4555-8555-555555555555',
        'account-1',
      ),
    ).toEqual({ plan: 'developer', requiresExactSessionMetadata: false });
    expect(
      checkoutReservationFromKey(
        'checkout/account-1/developer/66666666-6666-4666-8666-666666666666',
        'account-1',
      ),
    ).toEqual({ plan: 'developer', requiresExactSessionMetadata: false });
    for (const key of [
      'checkout/v5/account-1/developer/77777777-7777-4777-8777-777777777777',
      'checkout/v4/account-other/developer/88888888-8888-4888-8888-888888888888',
      'checkout/v4/account-1/free/99999999-9999-4999-8999-999999999999',
      'checkout/v4/account-1/developer/not-a-uuid',
      'checkout/v4/account-1/developer/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extra',
    ])
      expect(checkoutReservationFromKey(key, 'account-1')).toBeNull();
  });
});

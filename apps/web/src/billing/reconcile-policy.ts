const meterRetryWindowMs = 23 * 60 * 60 * 1000;
const checkoutRecoveryWindowSeconds = 23 * 60 * 60;

export type MeterDeliveryRow = {
  reported_at: Date | null;
  first_attempt_at: Date | null;
  lease_until: Date | null;
};

export type MeterDeliveryStatus = 'reported' | 'retry-safe' | 'unresolved' | 'leased';

export function classifyMeterDelivery(
  row: MeterDeliveryRow,
  now = new Date(),
): MeterDeliveryStatus {
  if (row.reported_at) return 'reported';
  if (row.lease_until && row.lease_until.getTime() > now.getTime()) return 'leased';
  if (row.first_attempt_at && row.first_attempt_at.getTime() <= now.getTime() - meterRetryWindowMs)
    return 'unresolved';
  return 'retry-safe';
}

export type CheckoutLineItem = { price: string; quantity: number | null };
export type CheckoutCandidate = {
  id: string;
  customer: string | null;
  client_reference_id: string | null;
  mode: string;
  livemode: boolean;
  created: number;
  status: 'open' | 'complete' | 'expired';
  lineItems: CheckoutLineItem[];
  checkoutIdempotencyKey?: string | null;
};

export type CheckoutExpectation = {
  accountId: string;
  customerId: string;
  liveMode: boolean;
  planPriceId: string;
  usagePriceId: string;
  reservedAt: Date;
  idempotencyKey?: string;
  now?: Date;
};

export function uniqueCheckoutSession(
  sessions: CheckoutCandidate[],
  expected: CheckoutExpectation,
): CheckoutCandidate | null {
  const lowerBound = Math.floor(expected.reservedAt.getTime() / 1000) - 60;
  const upperBound = Math.min(
    Math.floor((expected.now ?? new Date()).getTime() / 1000) + 60,
    Math.floor(expected.reservedAt.getTime() / 1000) + checkoutRecoveryWindowSeconds,
  );
  const matches = sessions.filter((session) => {
    if (
      !session.id.startsWith('cs_') ||
      session.customer !== expected.customerId ||
      session.client_reference_id !== expected.accountId ||
      session.mode !== 'subscription' ||
      session.livemode !== expected.liveMode ||
      session.created < lowerBound ||
      session.created > upperBound ||
      !['open', 'complete', 'expired'].includes(session.status)
    )
      return false;
    const items = session.lineItems;
    if (items.length !== 2) return false;
    const plan = items.find((item) => item.price === expected.planPriceId);
    const usage = items.find((item) => item.price === expected.usagePriceId);
    return (
      !!plan && !!usage && plan.quantity === 1 && (usage.quantity === 1 || usage.quantity === null)
    );
  });
  if (expected.idempotencyKey) {
    const exact = matches.filter(
      (session) => session.checkoutIdempotencyKey === expected.idempotencyKey,
    );
    if (exact.length) return exact.length === 1 ? exact[0]! : null;
    const legacy = matches.filter((session) => !session.checkoutIdempotencyKey);
    return legacy.length === 1 ? legacy[0]! : null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

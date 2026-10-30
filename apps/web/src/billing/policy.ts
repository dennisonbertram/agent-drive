import { ApiError } from '../api/errors';

export const GIB = 1024n ** 3n;
export const PLANS = {
  free: {
    baseCents: 0,
    drives: 3n,
    storageBytes: 5n * GIB,
    egressBytes: 5n * GIB,
    operations: 1_000_000n,
  },
  developer: {
    baseCents: 2000,
    drives: 25n,
    storageBytes: 100n * GIB,
    egressBytes: 100n * GIB,
    operations: 10_000_000n,
  },
  team: {
    baseCents: 20000,
    drives: 250n,
    storageBytes: 1024n * GIB,
    egressBytes: 1024n * GIB,
    operations: 100_000_000n,
  },
} as const;
export type PlanName = keyof typeof PLANS;
export type Usage = {
  drives: bigint;
  storageBytes: bigint;
  egressBytes: bigint;
  operations: bigint;
};
export type Rates = { drive: bigint; storage: bigint; egress: bigint; operations: bigint };

export function billingRates(): Rates | null {
  const names = ['DRIVE_MONTH', 'STORAGE_GIB_MONTH', 'EGRESS_GIB', 'OPERATIONS_1000'] as const;
  const values = names.map((name) => process.env[`BILLING_${name}_CENTS`]);
  if (values.some((value) => !value)) return null;
  if (values.some((value) => !/^\d{1,7}$/u.test(value!) || Number(value) <= 0)) {
    throw new ApiError('internal_error', 'Billing rates are not configured correctly.');
  }
  return {
    drive: BigInt(values[0]!),
    storage: BigInt(values[1]!),
    egress: BigInt(values[2]!),
    operations: BigInt(values[3]!),
  };
}

const excess = (used: bigint, included: bigint) => (used > included ? used - included : 0n);
const cents = (units: bigint, rate: bigint, divisor = 1n) =>
  (units * rate + divisor - 1n) / divisor;

// Storage and drive overage use the calendar month's high-water allocation, not GB-hours.
export function quoteUsage(plan: PlanName, usage: Usage, rates: Rates | null) {
  const included = PLANS[plan];
  const overage = {
    drives: excess(usage.drives, included.drives),
    storageBytes: excess(usage.storageBytes, included.storageBytes),
    egressBytes: excess(usage.egressBytes, included.egressBytes),
    operations: excess(usage.operations, included.operations),
  };
  const overLimit = Object.values(overage).some((value) => value > 0n);
  const overageCents =
    plan === 'free' || !rates
      ? 0n
      : cents(overage.drives, rates.drive) +
        cents(overage.storageBytes, rates.storage, GIB) +
        cents(overage.egressBytes, rates.egress, GIB) +
        cents(overage.operations, rates.operations, 1000n);
  return { overLimit, overageCents, totalCents: BigInt(included.baseCents) + overageCents };
}

export function monthBounds(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function accruedOverage(currentQuote: bigint, baseline: bigint, earned: bigint) {
  return earned + excess(currentQuote, baseline);
}

export function billingOrigin() {
  const raw = process.env.AGENT_DRIVE_PUBLIC_URL;
  if (!raw && process.env.NODE_ENV !== 'production') return 'http://localhost:3100';
  if (!raw) throw new ApiError('internal_error', 'The public application URL is not configured.');
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && local && url.protocol === 'http:'))
  ) {
    throw new ApiError('internal_error', 'The public application URL must use HTTPS.');
  }
  return url.origin;
}

export function paymentRequired(message: string): never {
  throw new ApiError('payment_required', message, 402, {
    upgradeUrl: `${billingOrigin()}/console/billing`,
  });
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function parseInteger(value: string) {
  if (!/^\d+$/u.test(value)) throw new RangeError(`Not an integer byte count: ${value}`);
  return BigInt(value);
}

function format(value: number | bigint | string, base: bigint): string {
  // Strings are parsed as integers so values past Number.MAX_SAFE_INTEGER stay exact (non-integers throw).
  const n =
    typeof value === 'bigint'
      ? value
      : typeof value === 'string'
        ? parseInteger(value)
        : BigInt(Math.trunc(value));
  if (n < base) return `${n < 0n ? 0n : n} B`;
  let i = 1;
  while (i < 4 && n >= base ** BigInt(i + 1)) i += 1;
  const round = () => (n * 100n + base ** BigInt(i) / 2n) / base ** BigInt(i);
  let hundredths = round();
  if (hundredths >= base * 100n && i < 4) {
    i += 1;
    hundredths = round();
  }
  const whole = hundredths / 100n;
  const frac = String(hundredths % 100n)
    .padStart(2, '0')
    .replace(/0+$/u, '');
  return `${whole}${frac ? `.${frac}` : ''} ${UNITS[i]}`;
}

/**
 * The byte formatter for file sizes. Decimal units: 1 KB = 1000 B.
 * Two decimals at most, trailing zeros dropped, rounded half up. Exact for bigint and
 * decimal-string input.
 */
export const formatBytes = (value: number | bigint | string) => format(value, 1000n);

/**
 * Formatter for plan limits and metered usage. Billing meters in 1,073,741,824-byte units, so
 * here 1 GB = 2^30 bytes and the Free plan's 5 GiB limit reads "5 GB".
 */
export const formatMetered = (value: number | bigint | string) => format(value, 1024n);

/** Largest encrypted upload (5 GiB of ciphertext), in the same unit as every other size. */
export const MAX_UPLOAD = formatMetered(5n * 1024n ** 3n);

/**
 * Overage rates are charged per 2^30 bytes, which the product labels "GB" (see formatMetered),
 * so the displayed per-GB price is the metered rate itself: cents to dollars, no conversion.
 */
export function perGbDollars(centsPerGiB: bigint): string {
  const cents = centsPerGiB % 100n;
  return `$${centsPerGiB / 100n}.${String(cents).padStart(2, '0')}`;
}

export const RATE_UNIT_NOTE = 'Usage is metered in GB of 1,073,741,824 bytes (2^30).';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

function parseInteger(value: string) {
  if (!/^\d+$/u.test(value)) throw new RangeError(`Not an integer byte count: ${value}`);
  return BigInt(value);
}

/**
 * The one byte formatter for the whole product. Decimal units: 1 KB = 1000 B.
 * Two decimals at most, trailing zeros dropped, rounded half up. Exact for bigint and
 * decimal-string input, so plan limits such as 5 GiB print as 5.37 GB.
 */
export function formatBytes(value: number | bigint | string): string {
  // Strings are parsed as integers so values past Number.MAX_SAFE_INTEGER stay exact (non-integers throw).
  const n =
    typeof value === 'bigint'
      ? value
      : typeof value === 'string'
        ? parseInteger(value)
        : BigInt(Math.trunc(value));
  if (n < 1000n) return `${n < 0n ? 0n : n} B`;
  let i = 1;
  while (i < 4 && n >= 1000n ** BigInt(i + 1)) i += 1;
  let hundredths = (n * 100n + 1000n ** BigInt(i) / 2n) / 1000n ** BigInt(i);
  if (hundredths >= 100_000n && i < 4) {
    i += 1;
    hundredths = (n * 100n + 1000n ** BigInt(i) / 2n) / 1000n ** BigInt(i);
  }
  const whole = hundredths / 100n;
  const frac = String(hundredths % 100n)
    .padStart(2, '0')
    .replace(/0+$/u, '');
  return `${whole}${frac ? `.${frac}` : ''} ${UNITS[i]}`;
}

/** Largest encrypted upload (5 GiB of ciphertext), in the same unit as every other size. */
export const MAX_UPLOAD = formatBytes(5n * 1024n ** 3n);

/**
 * Overage rates are charged per GiB (2^30 bytes) but labelled per GB. This shows the exact
 * per-decimal-GB equivalent in dollars, rounded UP at four decimals so the shown price is never
 * lower than the real one.
 */
export function perGbDollars(centsPerGiB: bigint): string {
  const scale = 10n ** 4n;
  const den = 100n * 2n ** 30n;
  const units = (centsPerGiB * 10n ** 9n * scale + den - 1n) / den;
  return `$${units / scale}.${String(units % scale).padStart(4, '0')}`;
}

export const RATE_UNIT_NOTE =
  'Overage is metered per 1,073,741,824 bytes (1.07 GB); prices above are shown per GB.';

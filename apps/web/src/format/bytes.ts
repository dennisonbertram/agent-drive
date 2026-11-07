const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * The one byte formatter for the whole product. Decimal units: 1 KB = 1000 B.
 * Two decimals at most, trailing zeros dropped, rounded half up. Exact for bigint and
 * decimal-string input, so plan limits such as 5 GiB print as 5.37 GB.
 */
export function formatBytes(value: number | bigint | string): string {
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
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

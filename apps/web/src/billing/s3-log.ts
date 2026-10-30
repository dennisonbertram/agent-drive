import type { Transfer } from './ledger';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse only the fixed prefix. Referer/user-agent fields can contain unescaped quotes.
export function parseS3Transfer(line: string): Transfer | null {
  const match =
    /^\S+ (\S+) \[([^\]]+)\] \S+ \S+ (\S+) (\S+) (\S+) "[^"\r\n]*" (\d{3}) \S+ (\d+|-) (?:\d+|-)(?=\s|$)/u.exec(
      line,
    );
  if (!match || match[4] !== 'REST.GET.OBJECT' || !['200', '206'].includes(match[6]!)) return null;
  const date = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) \+0000$/u.exec(match[2]!);
  if (!date) return null;
  const month = months.indexOf(date[2]!);
  if (month < 0) return null;
  const occurredAt = new Date(
    Date.UTC(
      Number(date[3]),
      month,
      Number(date[1]),
      Number(date[4]),
      Number(date[5]),
      Number(date[6]),
    ),
  );
  if (
    occurredAt.getUTCDate() !== Number(date[1]) ||
    occurredAt.getUTCMonth() !== month ||
    Number(date[4]) > 23 ||
    Number(date[5]) > 59 ||
    Number(date[6]) > 59
  )
    return null;
  let objectKey: string;
  try {
    objectKey = decodeURIComponent(match[5]!);
  } catch {
    return null;
  }
  if (!objectKey.startsWith('objects/')) return null;
  return {
    bucket: match[1]!,
    requestId: match[3]!,
    objectKey,
    occurredAt,
    bytes: match[7] === '-' ? 0n : BigInt(match[7]!),
  };
}

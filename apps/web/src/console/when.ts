const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A version time for people: "today 14:02", "yesterday 14:02", "Nov 3, 14:02", "Nov 3, 2025". Local time. */
export function versionWhen(iso: string | undefined, now = new Date()): string {
  const then = iso ? new Date(iso) : null;
  if (!then || Number.isNaN(then.getTime())) return '—';
  const time = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(then)) / 86_400_000);
  if (daysAgo === 0) return `today ${time}`;
  if (daysAgo === 1) return `yesterday ${time}`;
  const label = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear()
    ? `${label}, ${time}`
    : `${label}, ${then.getFullYear()}`;
}

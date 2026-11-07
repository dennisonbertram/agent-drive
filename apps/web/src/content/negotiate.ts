/**
 * True when an Accept header prefers text/markdown over text/html. Only an explicit text/markdown
 * entry counts (wildcard entries keep HTML). q=0 refuses a type. On equal q, the type listed
 * first wins.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  let md: { q: number; at: number } | undefined;
  let html: { q: number; at: number } | undefined;
  let htmlWild = 0;
  accept.split(',').forEach((part, at) => {
    const [type = '', ...params] = part.trim().toLowerCase().split(';');
    const raw = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const n = raw === undefined ? 1 : Number(raw.slice(2));
    const q = Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 1;
    if (type.trim() === 'text/markdown') md = { q, at };
    else if (type.trim() === 'text/html') html = { q, at };
    else if (type.trim() === 'text/*' || type.trim() === '*/*') htmlWild = Math.max(htmlWild, q);
  });
  if (!md || md.q === 0) return false;
  const htmlQ = html ? html.q : htmlWild;
  return md.q > htmlQ || (md.q === htmlQ && (!html || md.at < html.at));
}

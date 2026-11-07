import type { ReactNode } from 'react';

/**
 * Small Markdown renderer for our own docs. It builds React elements only, so raw HTML in the
 * source is shown as text, never parsed. Links are kept only for http(s), "/" and "#" targets.
 * Supports: headings, paragraphs, fenced code, flat lists, tables, `code`, **bold** and links.
 */
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
const safeHref = (href: string) => /^(https?:\/\/|\/(?!\/)|#)/.test(href);

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${String(i++)}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined && m[3] !== undefined)
      out.push(
        safeHref(m[3]) ? (
          <a key={k} href={m[3]}>
            {m[2]}
          </a>
        ) : (
          m[2]
        ),
      );
    else out.push(<strong key={k}>{m[4]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const MARK = /^\s*([-*]|\d+\.) /;
const isBlock = (l: string) => /^(#{1,6} |```|\|)/.test(l) || MARK.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `b${String(out.length)}`;
  while (i < lines.length) {
    const before = i;
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
    } else if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? '').startsWith('```'); i++)
        code.push(lines[i] ?? '');
      i++;
      out.push(
        <pre key={key()} tabIndex={0}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (/^#{1,6} /.test(line)) {
      const level = Math.min(line.match(/^#+/)![0].length, 6);
      const text = line.replace(/^#+ /, '');
      const Tag = `h${String(level)}` as 'h2';
      out.push(
        <Tag key={key()} id={slugify(text)}>
          {inline(text, key())}
        </Tag>,
      );
      i++;
    } else if (line.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && (lines[i] ?? '').startsWith('|'); i++)
        rows.push(cells(lines[i] ?? ''));
      const k = key();
      out.push(
        <div key={k} className="doc-table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th key={c}>{inline(h, `${k}h${String(c)}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c, `${k}r${String(ri)}c${String(ci)}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (MARK.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      const start = Number(line.match(/^\s*(\d+)\./)?.[1] ?? 1);
      while (i < lines.length) {
        const l = lines[i] ?? '';
        if (MARK.test(l)) items.push(l.replace(MARK, ''));
        else if (l.trim() && items.length && !/^(#{1,6} |```|\|)/.test(l))
          items[items.length - 1] += ` ${l.trim()}`;
        else if (!l.trim() && MARK.test(lines[i + 1] ?? '')) {
          /* blank line inside a list */
        } else break;
        i++;
      }
      const k = key();
      const lis = items.map((t, n) => <li key={n}>{inline(t, `${k}i${String(n)}`)}</li>);
      out.push(
        ordered ? (
          <ol key={k} start={start}>
            {lis}
          </ol>
        ) : (
          <ul key={k}>{lis}</ul>
        ),
      );
    } else {
      const para = [line.trim()];
      for (i++; i < lines.length && (lines[i] ?? '').trim() && !isBlock(lines[i] ?? ''); i++)
        para.push((lines[i] ?? '').trim());
      out.push(<p key={key()}>{inline(para.join(' '), key())}</p>);
    }
    if (i === before) i++; // backstop: always advance
  }
  return <>{out}</>;
}

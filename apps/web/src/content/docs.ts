import allowlist from './docs.allowlist.json';
import sources from './docs.generated.json';

/**
 * Public docs. Only files named in docs.allowlist.json are ever embedded (scripts/gen-docs.mjs);
 * nothing is globbed from docs/. Plans, runbooks, design contracts and UX notes stay private by
 * not being listed. The text is embedded at build time, so nothing reads docs/ at request time.
 */
export const DOCS: readonly { slug: string; file: string; title: string; summary: string }[] =
  allowlist;

export const docMeta = (slug: string) => DOCS.find((d) => d.slug === slug);

/**
 * Markdown body of an allowlisted doc, without its first H1 (the page supplies the title).
 * Relative links to other allowlisted docs become `link(slug)`; any other relative link loses its
 * target and keeps its text.
 */
export function docBody(slug: string, link: (slug: string) => string): string | null {
  const meta = docMeta(slug);
  if (!meta) return null;
  const raw = (sources as Record<string, string>)[slug];
  if (raw === undefined) return null;
  return raw
    .replace(/^# .*\n+/, '')
    .replace(/\[([^\]]+)\]\((?!https?:|#|\/)([^)\s]+)\)/g, (_m, text: string, href: string) => {
      const target = docMeta((href.split('#')[0] ?? '').replace(/^.*\//, '').replace(/\.md$/, ''));
      return target && href.endsWith('.md') ? `[${text}](${link(target.slug)})` : text;
    });
}

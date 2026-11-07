import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Public docs. Only files named here are ever read; nothing is globbed from docs/. Plans, runbooks,
 * design contracts and UX notes stay private by not being listed.
 */
export const DOCS = [
  {
    slug: 'quickstart',
    file: 'quickstart.md',
    title: 'Quickstart',
    summary: 'Connect an agent, store a first file and back up its key.',
  },
  {
    slug: 'cli',
    file: 'cli.md',
    title: 'CLI and MCP reference',
    summary: 'Commands, credentials, sync, backup and the MCP server.',
  },
  {
    slug: 'api',
    file: 'api.md',
    title: 'HTTP API',
    summary: 'Routes, scopes, pagination, conflicts and device login endpoints.',
  },
  {
    slug: 'crypto',
    file: 'crypto.md',
    title: 'Encryption format',
    summary: 'The ADRV v1 ciphertext layout and key wrapping.',
  },
] as const;

export type DocSlug = (typeof DOCS)[number]['slug'];

export const docMeta = (slug: string) => DOCS.find((d) => d.slug === slug);

const DOCS_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), '..', '..', 'docs');

/**
 * Markdown body of an allowlisted doc, without its first H1 (the page supplies the title).
 * Relative links to other allowlisted docs become `link(slug)`; any other relative link loses its
 * target and keeps its text.
 */
export function docBody(slug: string, link: (slug: string) => string): string | null {
  const meta = docMeta(slug);
  if (!meta) return null;
  const raw = readFileSync(path.join(DOCS_DIR, meta.file), 'utf8');
  return raw
    .replace(/^# .*\n+/, '')
    .replace(/\[([^\]]+)\]\((?!https?:|#|\/)([^)\s]+)\)/g, (_m, text: string, href: string) => {
      const target = docMeta(path.basename(href.split('#')[0] ?? '', '.md'));
      return target && href.endsWith('.md') ? `[${text}](${link(target.slug)})` : text;
    });
}

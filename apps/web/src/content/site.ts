import { COMPARISONS, comparison, compareIndexMarkdown, comparisonMarkdown } from './compare';
import { DOCS, docBody, docMeta, sectionedDocs } from './docs';
import { homeMarkdown } from './home';
import { LEGAL, legalMarkdown } from './legal';
import { pricingMarkdown } from './pricing';

/** HTML path for a Markdown slug ("index" is the homepage). */
export const htmlPath = (slug: string) => (slug === 'index' ? '/' : `/${slug}`);

const docLines = (origin: string, level: string) =>
  sectionedDocs()
    .map(
      ({ section, docs }) =>
        `${level} ${section}\n\n${docs.map((d) => `- [${d.title}](${origin}/docs/${d.slug}.md): ${d.summary}`).join('\n')}`,
    )
    .join('\n\n');

export function docsIndexMarkdown(origin: string): string {
  return `# Agent Drive docs

${docLines(origin, '##')}

## For agents

- [Agent setup guide](${origin}/llms.txt): the instructions an agent follows to connect.
`;
}

export function docMarkdown(slug: string, origin: string): string | null {
  const meta = docMeta(slug);
  const body = docBody(slug, (s) => `${origin}/docs/${s}.md`);
  return meta && body !== null ? `# ${meta.title}\n\n${body}` : null;
}

/** Markdown twin for a public page, or null when the slug is not a public page. */
export function getMarkdown(slug: string[], origin: string): string | null {
  const [a, b, ...rest] = slug;
  if (rest.length) return null;
  if (a === 'index' && !b) return homeMarkdown(origin);
  if (a === 'pricing' && !b) return pricingMarkdown(origin);
  if ((a === 'privacy' || a === 'terms') && !b) return legalMarkdown(a);
  if (a === 'docs') return b ? docMarkdown(b, origin) : docsIndexMarkdown(origin);
  if (a === 'compare') {
    if (!b) return compareIndexMarkdown(origin);
    const c = comparison(b);
    return c ? comparisonMarkdown(c, origin) : null;
  }
  return null;
}

/** Every public HTML path, for the sitemap. */
export function publicPaths(): string[] {
  return [
    '/',
    '/pricing',
    ...LEGAL.map((p) => `/${p.slug}`),
    '/docs',
    ...DOCS.map((d) => `/docs/${d.slug}`),
    '/compare',
    ...COMPARISONS.map((c) => `/compare/${c.slug}`),
  ];
}

/** llmstxt.org-style index placed above the setup guide in /llms.txt. */
export function llmsIndex(origin: string): string {
  return `# Agent Drive

> Encrypted file storage for agents. Files are encrypted on the agent's machine before upload, so they survive sandboxes, machines and platform switches. A human approves each agent once.

Every page below is also available as Markdown at the URL shown. The setup guide follows the lists.

## Docs

${docLines(origin, '###')}

## Pages

- [Home](${origin}/index.md): what Agent Drive is and how it works
- [Pricing](${origin}/pricing.md): plans, limits and prices
- [Privacy](${origin}/privacy.md): what we collect, who handles it, and how long we keep it
- [Terms](${origin}/terms.md): the rules for using Agent Drive
- [Compare](${origin}/compare.md): when to use S3 or R2, git or GitHub, Dropbox or Google Drive instead
${COMPARISONS.map((c) => `- [${c.title}](${origin}/compare/${c.slug}.md): ${c.summary}`).join('\n')}

## Optional

- [Everything in one file](${origin}/llms-full.txt): this index plus the full text of the docs

---

`;
}

export function llmsFull(origin: string): string {
  const docs = DOCS.map((d) => `\n---\n\n${docMarkdown(d.slug, origin)}`).join('');
  return `${llmsIndex(origin).replace(/\n---\n\n$/, '')}${docs}`;
}

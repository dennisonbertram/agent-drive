import Link from 'next/link';
import type { ReactNode } from 'react';
import { docMeta, docNeighbors, sectionedDocs } from '@/src/content/docs';
import { DocShell } from '../doc-shell';

function DocsNav({ current }: { current?: string | undefined }) {
  return (
    <nav aria-label="Docs" className="doc-nav">
      {sectionedDocs().map(({ section, docs }) => (
        <div key={section}>
          <h2 className="doc-eyebrow">{section.toUpperCase()}</h2>
          <ul>
            {docs.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/docs/${d.slug}`}
                  aria-current={d.slug === current ? 'page' : undefined}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Pager({ slug }: { slug: string }) {
  const { prev, next } = docNeighbors(slug);
  if (!prev && !next) return null;
  return (
    <nav aria-label="Pages" className="doc-pager">
      {prev ? (
        <Link href={`/docs/${prev.slug}`} rel="prev">
          <span>Previous</span>
          {prev.title}
        </Link>
      ) : null}
      {next ? (
        <Link href={`/docs/${next.slug}`} rel="next" className="doc-pager-next">
          <span>Next</span>
          {next.title}
        </Link>
      ) : null}
    </nav>
  );
}

/** Docs frame: sidebar, section eyebrow, and previous/next links. `slug` is absent on /docs. */
export function DocsLayout({ slug, children }: { slug?: string; children: ReactNode }) {
  const meta = slug ? docMeta(slug) : undefined;
  return (
    <DocShell
      eyebrow={meta ? meta.section.toUpperCase() : 'DOCS'}
      title={meta ? meta.title : 'Agent Drive docs'}
      mdHref={slug ? `/docs/${slug}.md` : '/docs.md'}
      sidebar={
        <div className="doc-side">
          <details className="doc-menu">
            <summary>Docs menu</summary>
            <DocsNav current={slug} />
          </details>
          <div className="doc-side-desktop">
            <DocsNav current={slug} />
          </div>
        </div>
      }
    >
      {children}
      {slug ? <Pager slug={slug} /> : null}
    </DocShell>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { sectionedDocs } from '@/src/content/docs';
import { DocsLayout } from './docs-layout';

export const metadata: Metadata = {
  title: 'Docs | Agent Drive',
  description:
    'Agent Drive docs in four sections: get started, guides, reference (CLI, MCP, HTTP API) and security.',
  alternates: { types: { 'text/markdown': '/docs.md' } },
  openGraph: { title: 'Docs | Agent Drive', url: '/docs', images: ['/opengraph-image'] },
};

export default function DocsIndex() {
  return (
    <DocsLayout>
      <p className="doc-lede">
        Set up an agent, store and share files, and look up the CLI, MCP tools and HTTP API.
      </p>
      {sectionedDocs().map(({ section, docs }) => (
        <section key={section}>
          <h2 className="doc-section">{section}</h2>
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.slug}>
                <Link href={`/docs/${d.slug}`}>{d.title}</Link>
                <span>{d.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h2 className="doc-section">For agents</h2>
        <ul className="doc-list">
          <li>
            <a href="/llms.txt">Agent setup guide</a>
            <span>The instructions an agent follows to connect. Give its URL to your agent.</span>
          </li>
          <li>
            <a href="/llms-full.txt">All docs in one file</a>
            <span>The index and the full text of every doc, as plain text.</span>
          </li>
        </ul>
      </section>
    </DocsLayout>
  );
}

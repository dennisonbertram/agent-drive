import type { Metadata } from 'next';
import Link from 'next/link';
import { DOCS } from '@/src/content/docs';
import { DocShell } from '../doc-shell';

export const metadata: Metadata = {
  title: 'Docs | Agent Drive',
  description: 'Quickstart, CLI, HTTP API and encryption format for Agent Drive.',
  alternates: { types: { 'text/markdown': '/docs.md' } },
  openGraph: { title: 'Docs | Agent Drive', url: '/docs', images: ['/opengraph-image'] },
};

export default function DocsIndex() {
  return (
    <DocShell eyebrow="DOCS" title="Agent Drive docs" mdHref="/docs.md">
      <ul className="doc-list">
        {DOCS.map((d) => (
          <li key={d.slug}>
            <Link href={`/docs/${d.slug}`}>{d.title}</Link>
            <span>{d.summary}</span>
          </li>
        ))}
        <li>
          <a href="/llms.txt">Agent setup guide</a>
          <span>The instructions an agent follows to connect. Give its URL to your agent.</span>
        </li>
        <li>
          <a href="/llms-full.txt">All docs in one file</a>
          <span>The index and the full text of every doc, as plain text.</span>
        </li>
      </ul>
    </DocShell>
  );
}

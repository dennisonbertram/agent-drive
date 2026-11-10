import type { Metadata } from 'next';
import { legalPage } from '@/src/content/legal';
import { Markdown } from '@/src/content/markdown';
import { DocShell } from '../doc-shell';

const page = legalPage('terms')!;

export const metadata: Metadata = {
  title: 'Terms of Service | Agent Drive',
  description: page.summary,
  alternates: { canonical: '/terms', types: { 'text/markdown': '/terms.md' } },
  openGraph: {
    title: 'Terms of Service | Agent Drive',
    url: '/terms',
    images: ['/opengraph-image'],
  },
};

export default function TermsPage() {
  return (
    <DocShell eyebrow="LEGAL" title={page.title} mdHref="/terms.md">
      <article className="doc-prose">
        <Markdown source={page.body} />
      </article>
    </DocShell>
  );
}

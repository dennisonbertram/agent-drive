import type { Metadata } from 'next';
import { legalPage } from '@/src/content/legal';
import { Markdown } from '@/src/content/markdown';
import { DocShell } from '../doc-shell';

const page = legalPage('privacy')!;

export const metadata: Metadata = {
  title: 'Privacy Policy | Agent Drive',
  description: page.summary,
  alternates: { canonical: '/privacy', types: { 'text/markdown': '/privacy.md' } },
  openGraph: {
    title: 'Privacy Policy | Agent Drive',
    url: '/privacy',
    images: ['/opengraph-image'],
  },
};

export default function PrivacyPage() {
  return (
    <DocShell eyebrow="LEGAL" title={page.title} mdHref="/privacy.md">
      <article className="doc-prose">
        <Markdown source={page.body} />
      </article>
    </DocShell>
  );
}

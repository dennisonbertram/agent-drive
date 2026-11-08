import type { Metadata } from 'next';
import { LEGAL_NOTICE, legalPage } from '@/src/content/legal';
import { Markdown } from '@/src/content/markdown';
import { DocShell } from '../doc-shell';

const page = legalPage('privacy')!;

export const metadata: Metadata = {
  title: 'Privacy Policy | Agent Drive',
  description: page.summary,
  alternates: { types: { 'text/markdown': '/privacy.md' } },
  openGraph: {
    title: 'Privacy Policy | Agent Drive',
    url: '/privacy',
    images: ['/opengraph-image'],
  },
};

export default function PrivacyPage() {
  return (
    <DocShell eyebrow="LEGAL" title={page.title} mdHref="/privacy.md">
      <p className="doc-answer" role="note" data-testid="draft-notice">
        {LEGAL_NOTICE}
      </p>
      <article className="doc-prose">
        <Markdown source={page.body} />
      </article>
    </DocShell>
  );
}

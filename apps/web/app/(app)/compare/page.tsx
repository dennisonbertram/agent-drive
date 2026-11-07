import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPARISONS } from '@/src/content/compare';
import { DocShell } from '../doc-shell';

export const metadata: Metadata = {
  title: 'Compare | Agent Drive',
  description: 'How Agent Drive differs from S3 and R2, git and GitHub, Dropbox and Google Drive.',
  alternates: { types: { 'text/markdown': '/compare.md' } },
  openGraph: { title: 'Compare | Agent Drive', url: '/compare', images: ['/opengraph-image'] },
};

export default function CompareIndex() {
  return (
    <DocShell eyebrow="COMPARE" title="Compare Agent Drive" mdHref="/compare.md">
      <p className="doc-lede">
        How Agent Drive differs from other places to keep files, and when each is the better choice.
      </p>
      <ul className="doc-list">
        {COMPARISONS.map((c) => (
          <li key={c.slug}>
            <Link href={`/compare/${c.slug}`}>{c.title}</Link>
            <span>{c.summary}</span>
          </li>
        ))}
      </ul>
    </DocShell>
  );
}

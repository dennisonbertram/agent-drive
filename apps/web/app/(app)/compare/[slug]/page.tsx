import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COMPARE_CHECKED, COMPARISONS, comparison } from '@/src/content/compare';
import { DocShell } from '../../doc-shell';

const code = (t: string) =>
  t.split('`').map((part, n) => (n % 2 ? <code key={n}>{part}</code> : part));

export const dynamicParams = false;
export const generateStaticParams = () => COMPARISONS.map((c) => ({ slug: c.slug }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = comparison(slug);
  if (!c) return {};
  return {
    title: `${c.title} | Agent Drive`,
    description: c.summary,
    alternates: { types: { 'text/markdown': `/compare/${slug}.md` } },
    openGraph: { title: c.title, url: `/compare/${slug}`, images: ['/opengraph-image'] },
  };
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = comparison(slug);
  if (!c) notFound();
  return (
    <DocShell eyebrow="COMPARE" title={c.title} mdHref={`/compare/${slug}.md`}>
      <p className="doc-answer">{c.answer}</p>
      <div className="doc-table stack">
        <table>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Aspect</span>
              </th>
              <th scope="col">{c.other}</th>
              <th scope="col">Agent Drive</th>
            </tr>
          </thead>
          <tbody>
            {c.table.map(([aspect, other, ad]) => (
              <tr key={aspect}>
                <th scope="row">{aspect}</th>
                <td data-label={c.other}>{code(other)}</td>
                <td data-label="Agent Drive">{code(ad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="doc-prose">
        <h2>When to choose which</h2>
        <h3>Choose {c.other} when</h3>
        <ul>
          {c.chooseOther.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <h3>Choose Agent Drive when</h3>
        <ul>
          {c.chooseAgentDrive.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <h2>Notes</h2>
        <p>
          Statements about {c.other} are general descriptions checked on {COMPARE_CHECKED}. They may
          change, so check the vendor&apos;s documentation:{' '}
          {c.links.map(([label, href], i) => (
            <span key={href}>
              {i > 0 && ', '}
              <a href={href} rel="noreferrer">
                {label}
              </a>
            </span>
          ))}
          .
        </p>
        <p>
          <Link href="/docs/quickstart">Get started with the quickstart</Link>
        </p>
      </section>
    </DocShell>
  );
}

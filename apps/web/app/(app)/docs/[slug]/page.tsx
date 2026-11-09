import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DOCS, docBody, docMeta } from '@/src/content/docs';
import { Markdown } from '@/src/content/markdown';
import { DocsLayout } from '../docs-layout';

export const dynamicParams = false;
export const generateStaticParams = () => DOCS.map((d) => ({ slug: d.slug }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = docMeta(slug);
  if (!meta) return {};
  return {
    title: `${meta.title} | Agent Drive docs`,
    description: meta.summary,
    alternates: { types: { 'text/markdown': `/docs/${slug}.md` } },
    openGraph: { title: meta.title, url: `/docs/${slug}`, images: ['/opengraph-image'] },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = docMeta(slug);
  const body = docBody(slug, (s) => `/docs/${s}`);
  if (!meta || body === null) notFound();
  return (
    <DocsLayout slug={slug}>
      <article className="doc-prose">
        <Markdown source={body} />
      </article>
    </DocsLayout>
  );
}

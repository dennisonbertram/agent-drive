import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { publicOrigin } from '@/src/content/origin';

// All crawlers, including AI crawlers, may read public pages. Private paths stay closed.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = publicOrigin(await headers());
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/console', '/connect', '/api', '/s/', '/sign-in', '/sign-up', '/md/'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}

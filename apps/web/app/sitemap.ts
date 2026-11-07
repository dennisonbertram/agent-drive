import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { publicOrigin } from '@/src/content/origin';
import { publicPaths } from '@/src/content/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicOrigin(await headers());
  return [...publicPaths(), '/llms.txt', '/llms-full.txt'].map((p) => ({ url: `${origin}${p}` }));
}

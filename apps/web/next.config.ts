import type { NextConfig } from 'next';

// Public pages that have a Markdown twin. Keep in step with src/content/site.ts getMarkdown().
const TWIN_PAGES = ['/pricing', '/docs', '/docs/:slug', '/compare', '/compare/:slug'];
// Markdown listed before text/html in Accept means the client prefers Markdown.
const WANTS_MARKDOWN = [
  { type: 'header' as const, key: 'accept', value: '^(?:(?!text/html).)*text/markdown.*$' },
];

const nextConfig: NextConfig = {
  logging: { incomingRequests: true },
  // docs/*.md live outside apps/web; the allowlist in src/content/docs.ts decides which are read.
  outputFileTracingIncludes: {
    '/md/[...slug]': ['../../docs/*.md'],
    '/docs/[slug]': ['../../docs/*.md'],
    '/llms-full.txt': ['../../docs/*.md'],
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/index.md', destination: '/md/index' },
        { source: '/:path*.md', destination: '/md/:path*' },
        { source: '/', has: WANTS_MARKDOWN, destination: '/md/index' },
        ...TWIN_PAGES.map((source) => ({
          source,
          has: WANTS_MARKDOWN,
          destination: `/md${source}`,
        })),
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/s/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
      {
        source: '/api/shares/:path*',
        headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }],
      },
      // The HTML twins differ by Accept, so caches must key on it.
      ...['/', ...TWIN_PAGES].map((source) => ({
        source,
        headers: [{ key: 'Vary', value: 'Accept' }],
      })),
    ];
  },
};

export default nextConfig;

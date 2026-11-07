import type { NextConfig } from 'next';

// Public pages that have a Markdown twin. Keep in step with src/content/site.ts getMarkdown().
const TWIN_PAGES = [
  '/pricing',
  '/privacy',
  '/terms',
  '/docs',
  '/docs/:slug',
  '/compare',
  '/compare/:slug',
];
const nextConfig: NextConfig = {
  logging: { incomingRequests: true },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/index.md', destination: '/md/index' },
        { source: '/:path*.md', destination: '/md/:path*' },
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

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: { incomingRequests: true },
  async headers() {
    return [
      {
        source: '/s/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ];
  },
};

export default nextConfig;

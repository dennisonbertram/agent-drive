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
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
      {
        source: '/api/shares/:path*',
        headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }],
      },
    ];
  },
};

export default nextConfig;

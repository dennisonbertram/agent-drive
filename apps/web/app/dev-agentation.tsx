'use client';

import dynamic from 'next/dynamic';

// Copy-review toolbar. The NODE_ENV check is inlined at build time, so the dynamic import is
// removed from production bundles.
export const DevAgentation =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('agentation').then((m) => m.Agentation), { ssr: false })
    : () => null;

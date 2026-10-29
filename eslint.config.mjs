import { defineConfig, globalIgnores } from 'eslint/config';
import nextTypescript from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'apps/web/.next/**',
    'apps/web/out/**',
    'apps/web/build/**',
    'packages/agent-drive/dist/**',
    'next-env.d.ts',
    'apps/web/next-env.d.ts',
  ]),
]);

import { defineConfig, globalIgnores } from 'eslint/config';
import nextTypescript from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';

const scopeToWeb = (configs, defaultFiles) =>
  configs.map((config) => {
    if (config.ignores) {
      return config;
    }

    return {
      ...config,
      files: config.files ? config.files.map((pattern) => `apps/web/${pattern}`) : defaultFiles,
    };
  });

export default defineConfig([
  ...scopeToWeb(nextVitals, ['apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}']),
  ...nextTypescript,
  {
    settings: {
      next: {
        rootDir: 'apps/web/',
      },
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    settings: {
      next: {
        rootDir: 'apps/web/',
      },
    },
  },
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

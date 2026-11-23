import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      // Mirrors apps/web/tsconfig.json paths so app modules resolve in tests too.
      '@': resolve(__dirname, 'apps/web'),
    },
  },
  test: {
    include: [
      'packages/agent-drive/src/**/*.unit.test.ts',
      'apps/web/src/**/*.unit.test.ts',
      'apps/web/app/**/*.unit.test.ts',
      'tests/**/*.unit.test.ts',
    ],
    environment: 'node',
  },
});

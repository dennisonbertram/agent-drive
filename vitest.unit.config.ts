import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/agent-drive/src/**/*.unit.test.ts',
      'apps/web/src/**/*.unit.test.ts',
      'tests/**/*.unit.test.ts',
    ],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/agent-drive/src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

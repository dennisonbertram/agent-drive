import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/agent-drive/src/**/*.integration.test.ts',
      'apps/web/src/**/*.integration.test.ts',
    ],
    exclude: ['packages/agent-drive/src/mcp.integration.test.ts'],
    environment: 'node',
    // Files share one database and each migrates it in beforeAll; parallel files race on a fresh
    // database and see each other's billing rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

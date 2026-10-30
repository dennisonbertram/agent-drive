import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';

process.env.AGENT_DRIVE_TEST_AUTH_SECRET ??= randomBytes(32).toString('hex');
process.env.DATABASE_URL ??=
  'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_BUCKET ??= 'agent-drive-local';
process.env.S3_ACCESS_KEY_ID ??= 'agent_drive_local';
process.env.S3_SECRET_ACCESS_KEY ??= 'agent_drive_local_secret';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    // This journey displays single-use test secrets; never persist browser traces.
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      "bash -o pipefail -c 'mkdir -p test-results; pnpm --filter @agent-drive/web dev --hostname localhost --port 3100 2>&1 | tee test-results/web-server.log'",
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: {
      AGENT_DRIVE_TEST_AUTH: '1',
      AGENT_DRIVE_TEST_AUTH_SECRET: process.env.AGENT_DRIVE_TEST_AUTH_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_REGION: process.env.S3_REGION,
      S3_BUCKET: process.env.S3_BUCKET,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_SECRET_KEY: '',
    },
    timeout: 120_000,
  },
});

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execute = promisify(execFile);

test('release smoke exercises console provisioning, CLI roundtrip, and public sharing', async ({
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const path = info.outputPath('release-smoke.json');
  await execute(
    process.execPath,
    [
      'scripts/release-smoke.mjs',
      '--url',
      baseURL!,
      '--local-test-auth',
      '--headless',
      '--report',
      path,
    ],
    {
      env: {
        ...process.env,
        AGENT_DRIVE_SMOKE_TEST_AUTH_SECRET: process.env.AGENT_DRIVE_TEST_AUTH_SECRET,
      },
      timeout: 150_000,
      maxBuffer: 1_000_000,
    },
  );
  const report = JSON.parse(await readFile(path, 'utf8')) as {
    passed: boolean;
    auth: string;
    checks: { passed: boolean }[];
    cleanup: { keysRevoked?: boolean; deletionRequest?: string; accountDeletionRequest?: string };
  };
  expect(report.auth).toBe('local synthetic—not live Clerk');
  expect(report.passed).toBe(true);
  expect(report.checks).toHaveLength(3);
  expect(report.checks.every((check) => check.passed)).toBe(true);
  expect(report.cleanup.keysRevoked).toBe(true);
  expect(report.cleanup.deletionRequest).toBeTruthy();
  expect(report.cleanup.accountDeletionRequest).toBeTruthy();
});

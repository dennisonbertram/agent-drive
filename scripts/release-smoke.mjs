import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function smokeOrigin(value, localTestAuth = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Provide an origin only, without credentials, paths, or query parameters.');
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('A hosted smoke target must use HTTPS.');
  if (localTestAuth && !local) throw new Error('Synthetic authentication is loopback-only.');
  return url.origin;
}

function cli(args, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, 'packages/agent-drive/dist/cli.js'), ...args],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let oversized = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      if (output.length > 1_000_000) {
        oversized = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('CLI could not start.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || oversized) reject(new Error('CLI smoke operation failed.'));
      else resolveResult(output);
    });
  });
}

function requireCheck(condition) {
  if (!condition) throw new Error('Smoke assertion failed.');
}

export async function runSmoke({ url, localTestAuth = false, headless = false, reportPath }) {
  const origin = smokeOrigin(url, localTestAuth);
  if (headless && !localTestAuth)
    throw new Error('Hosted signup requires the interactive browser.');
  if (localTestAuth && !process.env.AGENT_DRIVE_SMOKE_TEST_AUTH_SECRET)
    throw new Error('Local smoke requires AGENT_DRIVE_SMOKE_TEST_AUTH_SECRET.');
  const report = {
    origin,
    auth: localTestAuth ? 'local synthetic—not live Clerk' : 'interactive Clerk signup',
    startedAt: new Date().toISOString(),
    checks: [],
    cleanup: {},
    passed: false,
  };
  const temporary = await mkdtemp(join(tmpdir(), 'agent-drive-release-'));
  let browser;
  let context;
  let driveId;
  let agentId;
  let stage = 'browser startup';
  const driveName = `release-smoke-${randomUUID()}`;
  try {
    browser = await chromium.launch({ headless });
    context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    stage = 'signup';
    let signupComplete = false;
    const signupResponses = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.includes('/sign_ups') && response.ok()) {
        signupResponses.push(
          response
            .json()
            .then((body) => {
              if (body.response?.object === 'sign_up' && body.response?.status === 'complete')
                signupComplete = true;
            })
            .catch(() => undefined),
        );
      }
    });
    const signup = await page.goto(`${origin}/sign-up`);
    requireCheck(signup?.ok());
    if (localTestAuth) {
      const login = await context.request.post(`${origin}/api/test-session`, {
        headers: { Authorization: `Bearer ${process.env.AGENT_DRIVE_SMOKE_TEST_AUTH_SECRET}` },
        data: { userId: `e2e_${randomUUID().replaceAll('-', '')}` },
      });
      requireCheck(login.status() === 200);
      await page.goto(`${origin}/console`);
    } else {
      console.log(
        'Complete signup with a NEW disposable Agent Drive identity in the opened browser. Do not use your personal workspace.',
      );
      await page.waitForURL(
        (target) => target.origin === origin && target.pathname === '/console',
        { timeout: 300_000 },
      );
      await Promise.all(signupResponses);
      requireCheck(signupComplete);
    }
    const session = await context.request.get(`${origin}/api/console/session`);
    requireCheck(session.status() === 200);
    report.checks.push({ name: 'signup and workspace', passed: true });

    stage = 'console provisioning';
    await page.getByRole('button', { name: 'New drive', exact: true }).click();
    await page.getByLabel('Drive name').fill(driveName);
    const driveCreated = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/console/drives` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create drive', exact: true }).click();
    const driveResponse = await driveCreated;
    requireCheck(driveResponse.ok());
    driveId = (await driveResponse.json()).id;
    requireCheck(typeof driveId === 'string');
    const driveKey = await page.getByTestId('drive-key').inputValue();
    const recoveryDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download recovery file and continue' }).click();
    await recoveryDownload;
    await page.getByRole('button', { name: 'I saved it' }).click();
    await page.getByTestId('drive-id').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Create your first agent' }).click();
    await page.getByLabel('Agent name').fill('Release smoke agent');
    const agentCreated = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/console/agents` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    const agentResponse = await agentCreated;
    requireCheck(agentResponse.ok());
    agentId = (await agentResponse.json()).id;
    requireCheck(typeof agentId === 'string');
    await page.getByRole('button', { name: 'Create API key', exact: true }).click();
    await page.getByLabel('Key label').fill('Release smoke key');
    await page.getByLabel('share', { exact: true }).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create API key', exact: true })
      .click();
    const token = await page.getByTestId('api-key').inputValue();
    await page.getByLabel('I saved my API key securely').check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const env = {
      ...process.env,
      AGENT_DRIVE_API_URL: origin,
      AGENT_DRIVE_API_KEY: token,
      AGENT_DRIVE_KEY: driveKey,
      AGENT_DRIVE_CONFIG: join(temporary, 'config.json'),
    };
    stage = 'CLI put/get';
    const bytes = randomBytes(4096);
    await writeFile(join(temporary, 'input.bin'), bytes, { mode: 0o600 });
    await cli(['put', join(temporary, 'input.bin'), '/release-smoke.bin', '--drive', driveId], env);
    await cli(
      ['get', '/release-smoke.bin', '--drive', driveId, '--output', join(temporary, 'output.bin')],
      env,
    );
    requireCheck((await readFile(join(temporary, 'output.bin'))).equals(bytes));
    report.checks.push({ name: 'encrypted CLI put/get byte equality', passed: true });

    stage = 'encrypted share link';
    const share = JSON.parse(
      await cli(['share', '/release-smoke.bin', '--drive', driveId, '--expires-in', '10m'], env),
    );
    const shareUrl = new URL(share.url);
    requireCheck(shareUrl.origin === origin && shareUrl.hash.startsWith('#k='));
    const visitor = await browser.newContext({ acceptDownloads: true });
    let fragmentLeaked = false;
    visitor.on('request', (request) => {
      if (
        `${request.url()} ${request.postData() ?? ''} ${JSON.stringify(request.headers())}`.includes(
          shareUrl.hash.slice(3),
        )
      )
        fragmentLeaked = true;
    });
    const sharePage = await visitor.newPage();
    sharePage.setDefaultTimeout(30_000);
    await sharePage.goto(share.url);
    const download = sharePage.waitForEvent('download');
    await sharePage.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await (await download).path();
    requireCheck(saved && (await readFile(saved)).equals(bytes) && !fragmentLeaked);
    await cli(['share', 'revoke', share.id, '--drive', driveId], env);
    await sharePage.reload();
    await sharePage.getByRole('heading', { name: 'Share link revoked' }).waitFor();
    report.checks.push({
      name: 'anonymous share download, fragment secrecy, revocation',
      passed: true,
    });
    report.passed = true;
  } catch {
    report.checks.push({ name: stage, passed: false });
  } finally {
    if (context && agentId) {
      try {
        const revoked = await context.request.post(
          `${origin}/api/console/agents/${encodeURIComponent(agentId)}/revoke`,
          { headers: { Origin: origin } },
        );
        requireCheck(revoked.ok());
        report.cleanup.keysRevoked = true;
      } catch {
        report.cleanup.keysRevoked = false;
        report.passed = false;
      }
    }
    if (context && driveId) {
      try {
        const removed = await context.request.delete(
          `${origin}/api/console/drives/${encodeURIComponent(driveId)}`,
          { headers: { Origin: origin }, data: { confirmation: driveName } },
        );
        requireCheck(removed.status() === 202);
        report.cleanup.deletionRequest = (await removed.json()).deletion.id;
      } catch {
        report.cleanup.deletionFailedForDrive = driveId;
        report.passed = false;
      }
    }
    report.cleanup.note =
      'Drive purge is asynchronous. Disposable identity and revoked agent metadata remain; delete the test account in its console when no longer needed.';
    if (context && localTestAuth) {
      try {
        const removed = await context.request.delete(`${origin}/api/console/account`, {
          headers: { Origin: origin },
          data: { confirmation: 'DELETE MY ACCOUNT' },
        });
        requireCheck(removed.status() === 202);
        report.cleanup.accountDeletionRequest = (await removed.json()).deletion.id;
        report.cleanup.note =
          'Synthetic local account deletion queued; background maintenance must finish the purge.';
      } catch {
        report.cleanup.accountDeletionFailed = true;
        report.passed = false;
      }
    }
    const cleanup = await Promise.allSettled([
      browser?.close(),
      rm(temporary, { recursive: true, force: true }),
    ]);
    if (cleanup.some((result) => result.status === 'rejected')) {
      report.cleanup.localCleanupFailed = true;
      report.passed = false;
    }
    report.finishedAt = new Date().toISOString();
    if (reportPath) {
      await mkdir(dirname(resolve(reportPath)), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        url: { type: 'string' },
        'local-test-auth': { type: 'boolean' },
        headless: { type: 'boolean' },
        report: { type: 'string', default: 'test-results/release-smoke.json' },
      },
    });
    if (!values.url) throw new Error('Run with --url https://YOUR-AGENT-DRIVE-ORIGIN.');
    const report = await runSmoke({
      url: values.url,
      localTestAuth: !!values['local-test-auth'],
      headless: !!values.headless,
      reportPath: values.report,
    });
    console.log(
      `Release smoke ${report.passed ? 'PASSED' : 'FAILED'} (${report.auth}). Report: ${values.report}`,
    );
    if (!report.passed) process.exitCode = 1;
  } catch {
    console.error(
      'Release smoke could not run. Check target origin, browser installation, CLI build, and authentication configuration.',
    );
    process.exitCode = 1;
  }
}

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// A job folder is /jobs/<id>: request.md is the draft, submitted.md the queue marker the
// runner waits for, status.json its pickup receipt. These specs stub the whole console API
// with synthetic data; the rename body is asserted exactly.
const DRIVE = 'drive-jobs';
const REQUEST = {
  id: 'file-request',
  path: '/jobs/job-123/request.md',
  version_id: 'version-request-1',
  ciphertext_size: 128,
  agent_id: 'agent-1',
  created_at: new Date(0).toISOString(),
  kind: 'file',
};
const SUBMITTED = {
  ...REQUEST,
  id: 'file-submitted',
  path: '/jobs/job-123/submitted.md',
  version_id: 'version-submitted-1',
};
const STATUS = {
  ...REQUEST,
  id: 'file-status',
  path: '/jobs/job-123/status.json',
  version_id: 'version-status-1',
};

type RenameCall = { drive: string; body: Record<string, unknown> };
type RenameReply = { status?: number; json: unknown };

async function stubConsole(
  browser: Page,
  options: {
    items: () => Record<string, unknown>[];
    onRename?: (call: RenameCall) => Promise<RenameReply>;
  },
) {
  const calls = new Map<string, number>();
  const renames: RenameCall[] = [];
  const record = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1);
  await browser.route('**/api/console/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/console/', '');
    if (path === 'drives' || path === 'agents' || path === 'keys') {
      record(`${path}:first`);
      const items =
        path === 'drives'
          ? [
              {
                id: DRIVE,
                name: 'Synthetic jobs drive',
                quota_bytes: '1000000',
                key_backup_at: null,
                key_backup_method: null,
              },
            ]
          : [];
      await route.fulfill({ json: { items, nextCursor: null } });
      return;
    }
    if (/^drives\/[^/]+\/list$/.test(path)) {
      record('list');
      await route.fulfill({ json: { items: options.items(), nextCursor: null } });
      return;
    }
    const rename = /^drives\/([^/]+)\/rename$/.exec(path);
    if (rename && request.method() === 'POST') {
      record('rename');
      const call: RenameCall = { drive: rename[1]!, body: request.postDataJSON() };
      renames.push(call);
      const reply = (await options.onRename?.(call)) ?? { json: {} };
      await route.fulfill({ status: reply.status ?? 200, json: reply.json });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected ${path}` } } });
  });
  return { calls, renames };
}

async function signIn(context: BrowserContext, userId: string) {
  const authSecret = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
  if (!authSecret) throw new Error('The isolated job-submit test auth secret is missing.');
  const session = await context.request.post('/api/test-session', {
    headers: { Authorization: `Bearer ${authSecret}` },
    data: { userId },
  });
  expect(session.status()).toBe(200);
}

test('job-submit: one click on Submit job posts the rename contract once and the row becomes Queued', async ({
  page: browser,
  context,
}) => {
  let submitted = false;
  let releaseRename!: () => void;
  const heldRename = new Promise<void>((resolve) => {
    releaseRename = resolve;
  });
  const { calls, renames } = await stubConsole(browser, {
    items: () => (submitted ? [SUBMITTED] : [REQUEST]),
    onRename: async () => {
      await heldRename;
      submitted = true;
      return { json: { id: SUBMITTED.id, path: SUBMITTED.path, versionId: SUBMITTED.version_id } };
    },
  });
  await signIn(context, 'e2e_job_submit_test');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  const submit = browser.getByRole('button', { name: 'Submit job', exact: true });
  await expect(submit).toBeVisible();
  await expect(browser.getByText('request.md', { exact: true })).toBeVisible();
  expect(calls.get('list')).toBe(1);

  await submit.click();
  // The in-flight submit disables the button and a duplicate dispatch still never submits.
  await expect(submit).toBeDisabled();
  await submit.dispatchEvent('click');
  releaseRename();

  await expect(browser.locator('.toast').last()).toContainText('Job job-123 queued');
  expect(renames).toHaveLength(1);
  expect(renames[0]!.drive).toBe(DRIVE);
  expect(renames[0]!.body).toEqual({
    path: '/jobs/job-123/request.md',
    destinationPath: '/jobs/job-123/submitted.md',
    ifSourceVersionId: 'version-request-1',
    ifDestinationVersionId: null,
    operationId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ),
  });

  // The refreshed listing shows exactly one queue marker, and no Submit action remains.
  await expect(browser.getByText('submitted.md', { exact: true })).toBeVisible();
  await expect(browser.getByText('Queued', { exact: true })).toHaveCount(1);
  await expect(submit).toHaveCount(0);
  await expect.poll(() => calls.get('list')).toBeGreaterThanOrEqual(2);
});

test('job-submit: a rename conflict is reported and the refreshed list shows the queued marker', async ({
  page: browser,
  context,
}) => {
  let raced = false;
  const { calls } = await stubConsole(browser, {
    // request.md stayed (the draft raced a submit that already happened elsewhere), so the
    // refreshed listing carries both the draft and the marker.
    items: () => (raced ? [REQUEST, SUBMITTED] : [REQUEST]),
    onRename: async () => {
      raced = true;
      return {
        status: 409,
        json: {
          error: {
            code: 'conflict',
            message: 'The destination already exists.',
            state: 'exists',
          },
        },
      };
    },
  });
  await signIn(context, 'e2e_job_submit_conflict');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  const submit = browser.getByRole('button', { name: 'Submit job', exact: true });
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(browser.locator('.toast').last()).toContainText('Could not queue job job-123');
  await expect.poll(() => calls.get('list')).toBeGreaterThanOrEqual(2);
  // The one queue indicator lives on submitted.md; the coexisting draft gets no Submit.
  await expect(browser.getByText('Queued', { exact: true })).toHaveCount(1);
  await expect(submit).toHaveCount(0);
});

test('job-submit: status.json means the runner picked the job up and no Submit is offered', async ({
  page: browser,
  context,
}) => {
  const { renames } = await stubConsole(browser, {
    items: () => [REQUEST, SUBMITTED, STATUS],
  });
  await signIn(context, 'e2e_job_submit_picked');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  await expect(browser.getByText('status.json', { exact: true })).toBeVisible();
  await expect(browser.getByRole('button', { name: 'Submit job' })).toHaveCount(0);
  // One pickup indicator — on submitted.md; status.json stays a normal openable file.
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(1);
  await browser.getByText('request.md', { exact: true }).click();
  expect(renames).toHaveLength(0);
});

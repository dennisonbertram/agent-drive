import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// A job folder is /jobs/<id>: request.md is the draft, submitted.md the submission marker
// the runner waits for, status.json the worker's visible status, and
// /jobs/.agent-drive/claims/<id>.json the worker-owned execution receipt — the
// authoritative "picked up" record. These specs stub the whole console API with
// synthetic data; the rename body and the receipt lookups are asserted exactly.
const DRIVE = 'drive-jobs';
const RECEIPT_PATH = '/jobs/.agent-drive/claims/job-123.json';
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
type GetCall = { path: string | null; metadataOnly: string | null };
type Reply = { status?: number; json: unknown };
const NOT_FOUND: Reply = { status: 404, json: { error: { message: 'File not found.' } } };
const RECEIPT: Reply = { status: 200, json: { id: 'version-receipt-1', path: RECEIPT_PATH } };

async function stubConsole(
  browser: Page,
  options: {
    items: () => Record<string, unknown>[];
    onRename?: (call: RenameCall) => Promise<Reply>;
    // Answers GET /get calls; the default is a 404 — no receipt exists unless a spec
    // installs one. Calls are recorded so a spec can prove what was looked up.
    onGet?: (call: GetCall, index: number) => Promise<Reply>;
  },
) {
  const calls = new Map<string, number>();
  const renames: RenameCall[] = [];
  const gets: GetCall[] = [];
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
    if (/^drives\/[^/]+\/get$/.test(path) && request.method() === 'GET') {
      record('get');
      const call: GetCall = {
        path: url.searchParams.get('path'),
        metadataOnly: url.searchParams.get('metadataOnly'),
      };
      gets.push(call);
      const reply = (await options.onGet?.(call, gets.length)) ?? NOT_FOUND;
      await route.fulfill({ status: reply.status ?? 200, json: reply.json });
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
  return { calls, renames, gets };
}

// Every /get this page makes must be a metadata-only probe of this job's receipt —
// never a per-row lookup, never a plaintext fetch.
function expectReceiptLookups(gets: GetCall[]) {
  expect(gets.length).toBeGreaterThan(0);
  for (const call of gets) {
    expect(call.path).toBe(RECEIPT_PATH);
    expect(call.metadataOnly).toBe('1');
  }
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

test('job-submit: one click on Submit job posts the rename contract once and the row becomes Submitted', async ({
  page: browser,
  context,
}) => {
  let submitted = false;
  let releaseRename!: () => void;
  const heldRename = new Promise<void>((resolve) => {
    releaseRename = resolve;
  });
  const { calls, renames, gets } = await stubConsole(browser, {
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

  await expect(browser.locator('.toast').last()).toContainText('Job job-123 submitted');
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

  // The refreshed listing shows exactly one submission marker, and no Submit action
  // remains. The pickup claim came from a receipt metadata lookup, not from the
  // absence of status.json.
  await expect(browser.getByText('submitted.md', { exact: true })).toBeVisible();
  await expect(browser.getByText('Submitted', { exact: true })).toHaveCount(1);
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(0);
  await expect(submit).toHaveCount(0);
  await expect.poll(() => calls.get('list')).toBeGreaterThanOrEqual(2);
  expectReceiptLookups(gets);
});

test('job-submit: a rename conflict is reported and the refreshed list shows the submission marker', async ({
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

  await expect(browser.locator('.toast').last()).toContainText('Could not submit job job-123');
  await expect.poll(() => calls.get('list')).toBeGreaterThanOrEqual(2);
  // The one submission indicator lives on submitted.md; the coexisting draft gets no Submit.
  await expect(browser.getByText('Submitted', { exact: true })).toHaveCount(1);
  await expect(submit).toHaveCount(0);
});

test('job-submit: the claims receipt — not status.json alone — marks the job picked up', async ({
  page: browser,
  context,
}) => {
  const { renames, gets } = await stubConsole(browser, {
    items: () => [REQUEST, SUBMITTED, STATUS],
    onGet: async (call) => (call.path === RECEIPT_PATH ? RECEIPT : NOT_FOUND),
  });
  await signIn(context, 'e2e_job_submit_picked');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  await expect(browser.getByText('status.json', { exact: true })).toBeVisible();
  await expect(browser.getByRole('button', { name: 'Submit job' })).toHaveCount(0);
  // One pickup indicator — on submitted.md; status.json stays a normal openable file.
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(1);
  await browser.getByText('request.md', { exact: true }).click();
  expect(renames).toHaveLength(0);
  expectReceiptLookups(gets);
});

test('job-submit: a held job stays picked up even when status.json and submitted.md moved', async ({
  page: browser,
  context,
}) => {
  // The worker created its receipt, then stopped before writing status.json; a
  // submitted.md row alone must not read as still queued.
  const { gets } = await stubConsole(browser, {
    items: () => [SUBMITTED],
    onGet: async (call) => (call.path === RECEIPT_PATH ? RECEIPT : NOT_FOUND),
  });
  await signIn(context, 'e2e_job_submit_held');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(1);
  await expect(browser.getByText('Submitted', { exact: true })).toHaveCount(0);
  await expect(browser.getByRole('button', { name: 'Submit job' })).toHaveCount(0);
  expectReceiptLookups(gets);
});

test('job-submit: status.json without a claims receipt is not proof of pickup', async ({
  page: browser,
  context,
}) => {
  // A readable listing can carry a forged or orphaned status.json; only the
  // worker-owned receipt makes a job picked up. The marker reads Submitted.
  const { gets } = await stubConsole(browser, {
    items: () => [REQUEST, SUBMITTED, STATUS],
    onGet: async () => NOT_FOUND,
  });
  await signIn(context, 'e2e_job_submit_untrusted_status');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  await expect(browser.getByText('Submitted', { exact: true })).toHaveCount(1);
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(0);
  await expect(browser.getByRole('button', { name: 'Submit job' })).toHaveCount(0);
  expectReceiptLookups(gets);
});

test('job-submit: an unknown receipt answer never reads as queued or claimed', async ({
  page: browser,
  context,
}) => {
  // A non-404 lookup failure is "unknown": the marker can only claim the
  // submission file exists.
  const { gets } = await stubConsole(browser, {
    items: () => [SUBMITTED],
    onGet: async () => ({ status: 500, json: { error: { message: 'Synthetic failure.' } } }),
  });
  await signIn(context, 'e2e_job_submit_unknown');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  await expect(browser.getByText('Submitted', { exact: true })).toHaveCount(1);
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(0);
  expectReceiptLookups(gets);
});

test('job-submit: a job claimed between the listing and the click is never resubmitted', async ({
  page: browser,
  context,
}) => {
  // The listing predates the claim: the click-time receipt check is the last guard.
  const { renames, gets } = await stubConsole(browser, {
    items: () => [REQUEST],
    onGet: async (_call, index) => (index === 1 ? NOT_FOUND : RECEIPT),
  });
  await signIn(context, 'e2e_job_submit_guarded');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/jobs/job-123')}`);

  const submit = browser.getByRole('button', { name: 'Submit job', exact: true });
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(browser.locator('.toast').last()).toContainText('Job job-123 is already picked up');
  expect(renames).toHaveLength(0);
  // The draft is the only marker left, and it carries the pickup indicator.
  await expect(browser.getByText('Picked up', { exact: true })).toHaveCount(1);
  await expect(submit).toHaveCount(0);
  expectReceiptLookups(gets);
});

test('job-submit: ordinary folders make no job receipt lookups', async ({
  page: browser,
  context,
}) => {
  const { gets } = await stubConsole(browser, {
    items: () => [
      {
        ...REQUEST,
        id: 'file-note',
        path: '/notes.md',
      },
    ],
  });
  await signIn(context, 'e2e_job_submit_plain');
  await browser.goto(`/console?drive=${DRIVE}&path=${encodeURIComponent('/')}`);

  await expect(browser.getByText('notes.md', { exact: true })).toBeVisible();
  await expect(browser.getByRole('button', { name: 'Submit job' })).toHaveCount(0);
  await browser.waitForTimeout(500);
  expect(gets).toHaveLength(0);
});

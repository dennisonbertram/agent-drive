#!/usr/bin/env node
/*
 * Seed fake console data so testers and the video recorder can reproduce the
 * Files, Trash, first-run and key-backup states. Safe to re-run: every run
 * deletes the four `e2e_uxr1_*` users (database rows and S3 objects) and
 * rebuilds them. It never touches any other user.
 *
 * Run from the repo root, with Postgres and MinIO up and the web app running
 * in test-auth mode (see playwright.config.ts: AGENT_DRIVE_TEST_AUTH=1):
 *
 *   pnpm --filter ./packages/agent-drive build
 *   BASE_URL=http://localhost:3100 \
 *   AGENT_DRIVE_TEST_AUTH_SECRET=<the secret the server was started with> \
 *   S3_ENDPOINT=http://127.0.0.1:19000 \
 *   node scripts/seed-console-fixtures.mjs
 *
 * Optional env: DATABASE_URL, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY (defaults match playwright.config.ts), OUT_DIR
 * (default: <tmp>/agent-drive-console-seed).
 *
 * Users (sign in with POST /api/test-session {"userId": "..."}):
 *   e2e_uxr1_first       no drives (first-run panel, Trash "No drives yet.")
 *   e2e_uxr1_emptydrive  one human-created drive "my-drive", no files, not backed up
 *   e2e_uxr1_full        "research-bot": human-created, 29 files, 4 in Trash on
 *                        different days, key backup recorded;
 *                        "nightly-builds": created by an agent, 3 files, not backed up
 *   e2e_uxr1_many        one drive with 120 files (Load more, "loaded" filter copy)
 *
 * Output (OUT_DIR): state.json (ids), <driveId>.key.json recovery files in the
 * console's agent-drive-key-v1 format (mode 600), README.txt.
 * The secret is never printed.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
const SECRET = process.env.AGENT_DRIVE_TEST_AUTH_SECRET;
if (!SECRET) throw new Error('Set AGENT_DRIVE_TEST_AUTH_SECRET to the secret the server uses.');
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive';
const BUCKET = process.env.S3_BUCKET ?? 'agent-drive-local';
const OUT = process.env.OUT_DIR ?? join(tmpdir(), 'agent-drive-console-seed');
const PREFIX = 'e2e_uxr1_';
const USERS = ['first', 'emptydrive', 'full', 'many'].map((name) => PREFIX + name);
const CLI = resolve('packages/agent-drive/dist/cli.js');

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:19000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'agent_drive_local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'agent_drive_local_secret',
  },
});

async function cleanup(userId) {
  if (!userId.startsWith(PREFIX)) throw new Error('refusing to clean a non-seed user');
  const accounts = await pool.query('SELECT id FROM accounts WHERE external_clerk_user_id=$1', [
    userId,
  ]);
  for (const { id } of accounts.rows) {
    for (const prefix of [`objects/${id}/`, `staging/${id}/`]) {
      let token;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents ?? [])
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: object.Key }));
        token = page.NextContinuationToken;
      } while (token);
    }
    await pool.query('DELETE FROM audit_events WHERE account_id=$1', [id]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
      [id],
    );
    await pool.query('DELETE FROM upload_intents WHERE account_id=$1', [id]);
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id=$1)',
      [id],
    );
    await pool.query('DELETE FROM accounts WHERE id=$1', [id]);
  }
}

// One signed-in console session per user, using the test-session cookie.
async function session(userId) {
  const login = await fetch(`${BASE_URL}/api/test-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (login.status !== 200) throw new Error(`test-session failed for ${userId}: ${login.status}`);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return async (path, data) => {
    const response = await fetch(`${BASE_URL}/api/console/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, Origin: BASE_URL, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
    return body;
  };
}

function cli(args, env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, AGENT_DRIVE_API_URL: BASE_URL, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', fail);
    child.on('close', (status) =>
      status === 0 ? done() : fail(new Error(`cli ${args[0]} failed: ${stderr.slice(0, 300)}`)),
    );
  });
}

async function saveRecovery(driveId, key) {
  await writeFile(
    join(OUT, `${driveId}.key.json`),
    JSON.stringify({ format: 'agent-drive-key-v1', driveId, key }, null, 2),
    { mode: 0o600 },
  );
}

// Upload [path, text] pairs with limited concurrency. A path listed twice gets a second version.
async function upload(work, { driveId, key, token, configPath }, concurrency = 4) {
  const env = {
    AGENT_DRIVE_API_KEY: token,
    AGENT_DRIVE_KEY: key,
    AGENT_DRIVE_CONFIG: configPath,
  };
  const seen = new Set();
  const queue = work.map(([path, text]) => {
    const overwrite = seen.has(path);
    seen.add(path);
    return { path, text, overwrite };
  });
  const firstPass = queue.filter((item) => !item.overwrite);
  const secondPass = queue.filter((item) => item.overwrite);
  for (const pass of [firstPass, secondPass]) {
    let next = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < pass.length) {
          const item = pass[next++];
          const local = join(work.tmp, `${next}-${Math.random().toString(36).slice(2)}.txt`);
          await writeFile(local, item.text, { mode: 0o600 });
          await cli(
            [
              'put',
              local,
              item.path,
              '--drive',
              driveId,
              ...(item.overwrite ? ['--overwrite'] : []),
            ],
            env,
          );
        }
      }),
    );
  }
}

const log = (index) =>
  `${new Date(Date.UTC(2026, 10, 1, 6, index)).toISOString()} step=${index} tool=search ok\n`.repeat(
    8,
  );
const researchFiles = [
  ['/README.md', '# research-bot\nWeekly research agent. Writes reports to /outputs.\n'],
  ['/memory/project-notes.md', 'Notes v1: scope is the Q4 market scan.\n'],
  ['/memory/project-notes.md', 'Notes v2: scope widened to include pricing pages.\n'],
  ['/memory/preferences.json', '{"tone":"concise","citations":true}\n'],
  ['/inbox/request-0412-pricing-scan.md', 'Please compare pricing pages for 6 vendors.\n'],
  [
    '/inbox/request-0415-competitor-feed.md',
    'Add the competitor changelog feed to the weekly run.\n',
  ],
  ['/inbox/request-0419-glossary.md', 'Draft a glossary of terms used in the reports.\n'],
  [
    '/outputs/reports/weekly-2026-44.md',
    '# Week 44\nTop findings: three vendors changed pricing.\n',
  ],
  ['/outputs/reports/weekly-2026-45.md', '# Week 45 (draft)\nTwo vendors changed pricing.\n'],
  [
    '/outputs/reports/weekly-2026-45.md',
    '# Week 45\nTwo vendors changed pricing; one added a free tier.\n',
  ],
  ['/outputs/vendors.csv', 'vendor,plan,price\nAcme,Team,12\nGlobex,Team,15\nInitech,Team,9\n'],
  [
    '/outputs/charts/pricing-trend.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n',
  ],
  ...[1, 2, 3, 4, 5, 6].map((n) => [`/logs/agent-trace-${n}.log`, log(n)]),
  ['/work/scratch/dedupe-attempt-1.txt', 'scratch: 14 duplicate rows found\n'],
  ['/work/scratch/dedupe-attempt-2.txt', 'scratch: 14 duplicate rows removed\n'],
  ['/work/scratch/old-outline.md', 'outline from the first plan, superseded\n'],
  ['/work/scratch/tmp-export.json', '{"rows":0}\n'],
  ['/work/csv-export/2026-q3-roadmap-and-planning-draft-final-v2.md', '# Q3 roadmap draft\n'],
  ['/work/csv-export/q3-input.csv', 'id,value\n1,10\n2,20\n'],
  ['/config/schedule.yaml', 'weekly: mon 06:00\n'],
  ['/config/sources.yaml', 'sources:\n  - vendors\n  - changelogs\n'],
  ['/archive/2026-09-report.md', '# September\nArchived.\n'],
  ['/archive/2026-10-report.md', '# October\nArchived.\n'],
];
const trashedResearch = [
  '/work/scratch/dedupe-attempt-1.txt',
  '/work/scratch/old-outline.md',
  '/work/scratch/tmp-export.json',
  '/archive/2026-09-report.md',
];
const nightlyFiles = [
  ['/builds/2026-11-05/summary.json', '{"passed":212,"failed":1}\n'],
  ['/builds/2026-11-06/summary.json', '{"passed":214,"failed":0}\n'],
  ['/builds/latest.txt', '2026-11-06\n'],
];

async function main() {
  // Only clear a directory this script created earlier (it holds the marker file).
  const MARKER = join(OUT, '.console-seed-marker');
  let existing = [];
  try {
    existing = await readdir(OUT);
  } catch {}
  if (existing.length && !existing.includes('.console-seed-marker'))
    throw new Error(`Refusing to use ${OUT}: it exists and was not created by this script.`);
  if (existing.length) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(MARKER, 'created by scripts/seed-console-fixtures.mjs\n');
  const tmp = await mkdtemp(join(tmpdir(), 'ad-seed-'));
  const state = { baseUrl: BASE_URL, users: {} };
  try {
    for (const userId of USERS) await cleanup(userId);

    // first: zero drives. Provisioning the account only needs a signed-in call.
    const first = await session(PREFIX + 'first');
    await first('drives');
    state.users[PREFIX + 'first'] = { drives: [] };

    // emptydrive: one human-created drive, not backed up, key kept in OUT for "Load drive key".
    const empty = await session(PREFIX + 'emptydrive');
    const emptyDrive = await empty('drives', { name: 'my-drive' });
    const emptyKey = randomBytes(32).toString('base64url');
    await saveRecovery(emptyDrive.id, emptyKey);
    state.users[PREFIX + 'emptydrive'] = { drives: [{ name: 'my-drive', id: emptyDrive.id }] };

    // full: a human-created, backed-up drive and an agent-created, unbacked-up drive.
    const full = await session(PREFIX + 'full');
    const research = await full('drives', { name: 'research-bot' });
    const researchKey = randomBytes(32).toString('base64url');
    await saveRecovery(research.id, researchKey);
    const agent = await full('agents', { name: 'research-bot' });
    const writer = await full('keys', {
      label: 'seed writer',
      agentId: agent.id,
      driveIds: [research.id],
      scopes: ['read', 'write', 'delete', 'manage'],
    });
    const configPath = join(tmp, 'agent-config.json');
    // The agent itself creates nightly-builds, so its key is never backed up from the console.
    await cli(['drive', 'create', 'nightly-builds'], {
      AGENT_DRIVE_API_KEY: writer.token,
      AGENT_DRIVE_CONFIG: configPath,
    });
    const drives = (await full('drives?limit=100')).items;
    const nightly = drives.find((item) => item.name === 'nightly-builds');
    if (!nightly) throw new Error('agent did not create nightly-builds');
    // Grant the agent's key access to the new drive: a second key with both drives.
    const both = await full('keys', {
      label: 'seed both drives',
      agentId: agent.id,
      driveIds: [research.id, nightly.id],
      scopes: ['read', 'write', 'delete'],
    });
    const nightlyKey = randomBytes(32).toString('base64url');
    const researchWork = Object.assign([...researchFiles], { tmp });
    await upload(researchWork, {
      driveId: research.id,
      key: researchKey,
      token: both.token,
      configPath,
    });
    await upload(Object.assign([...nightlyFiles], { tmp }), {
      driveId: nightly.id,
      key: nightlyKey,
      token: both.token,
      configPath,
    });
    for (const path of trashedResearch) await full(`drives/${research.id}/delete`, { path });
    // Spread deleted_at over the last 1-12 days so Trash rows show different dates.
    const days = [1, 3, 7, 12];
    for (const [index, path] of trashedResearch.entries())
      await pool.query(
        `UPDATE files SET deleted_at = now() - ($1 || ' days')::interval - ($2 || ' minutes')::interval
          WHERE drive_id=$3 AND path=$4`,
        [days[index], index * 37 + 11, research.id, path],
      );
    await full(`drives/${research.id}/key-backup`, { method: 'file' });
    state.users[PREFIX + 'full'] = {
      drives: [
        { name: 'research-bot', id: research.id, keyBackedUp: true, createdBy: 'human' },
        { name: 'nightly-builds', id: nightly.id, keyBackedUp: false, createdBy: 'agent' },
      ],
    };
    // The console never recorded a backup for nightly-builds; this file lets testers load its key.
    await saveRecovery(nightly.id, nightlyKey);

    // many: 120 files so the first page (100) has a next cursor.
    const many = await session(PREFIX + 'many');
    const manyDrive = await many('drives', { name: 'archive-dump' });
    const manyKey = randomBytes(32).toString('base64url');
    await saveRecovery(manyDrive.id, manyKey);
    const manyAgent = await many('agents', { name: 'ingest-bot' });
    const manyToken = await many('keys', {
      label: 'seed writer',
      agentId: manyAgent.id,
      driveIds: [manyDrive.id],
      scopes: ['read', 'write'],
    });
    const manyWork = Object.assign(
      Array.from({ length: 120 }, (_, i) => [
        `/dump/2026-11/entry-${String(i).padStart(3, '0')}.txt`,
        `entry ${i}\n`,
      ]),
      { tmp },
    );
    await upload(
      manyWork,
      {
        driveId: manyDrive.id,
        key: manyKey,
        token: manyToken.token,
        configPath: join(tmp, 'many.json'),
      },
      8,
    );
    state.users[PREFIX + 'many'] = {
      drives: [{ name: 'archive-dump', id: manyDrive.id, files: 120 }],
    };

    await writeFile(join(OUT, 'state.json'), JSON.stringify(state, null, 2));
    await writeFile(
      join(OUT, 'README.txt'),
      `Sign in: POST ${BASE_URL}/api/test-session  Authorization: Bearer <secret>  {"userId": "<user>"}\n` +
        `Users: ${USERS.join(', ')}\nRecovery files (mode 600): <driveId>.key.json, loadable with "Load drive key".\n`,
    );
    console.log(`Seeded ${USERS.length} users. State and recovery files are in ${OUT}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
    s3.destroy();
    await pool.end();
  }
}

await main();

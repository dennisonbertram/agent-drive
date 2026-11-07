#!/usr/bin/env node
/*
 * Seed fake console data so testers and the video recorder can reproduce the
 * Files, Trash, first-run and key-backup states. Safe to re-run: every run
 * deletes the `e2e_uxr1_*` users (database rows and S3 objects) and
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
 *   e2e_uxr1_browse      file-browser fixtures. "research-bot": human-created, backup recorded,
 *                        about 170 files (two list pages at the root): nested folders 5 deep,
 *                        a file and a folder both named /reports, spaces and Unicode names,
 *                        an 80+ character name, a PNG, a ZIP and a PDF, /.agent-drive/check.txt
 *                        from a real `agent-drive check`, three authors (research-bot,
 *                        summarizer, Console), modified times simulated over the last 7 days;
 *                        "nightly-builds": agent-created, not backed up;
 *                        "design-assets": human-created, backup recorded, a few images
 *   e2e_uxr1_big         one drive "bulk-logs" with 1,050 files (/logs/run-0000..0999.log and
 *                        /outputs/summary-01..50.md): the 1,000-row cap note at the root, and
 *                        /outputs missing at the root but present at ?path=/outputs
 *
 * Output (OUT_DIR): state.json (ids), <driveId>.key.json recovery files in the
 * console's agent-drive-key-v1 format (mode 600), README.txt.
 * The secret is never printed.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
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
const USERS = ['first', 'emptydrive', 'full', 'many', 'browse', 'big'].map((name) => PREFIX + name);
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

function cliOnce(args, env) {
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

// Per-key rate limits are real, so wait out "Retry after: N seconds" instead of failing.
async function cli(args, env) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await cliOnce(args, env);
    } catch (error) {
      const wait = /request limit[\s\S]*Retry after: (\d+)/.exec(String(error.message));
      if (!wait || attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, (Number(wait[1]) + 1) * 1000));
    }
  }
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

// ---- Binary fixtures: real bytes so icons and binary downloads can be checked. ----
const pad = (head, size, seed) =>
  Buffer.concat([head, Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed) & 255))]);
// 1x1 PNG, then padding after IEND (viewers ignore trailing bytes).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const png = (size, seed) => pad(PNG_1X1, size, seed);
function zip(name, body) {
  const data = Buffer.from(body);
  const nameBuf = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  const centralSize = 46 + nameBuf.length;
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(30 + nameBuf.length + data.length, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}
const pdf = (size) =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' +
      '%' +
      'x'.repeat(size) +
      '\n',
  );

const browseFiles = [
  ...researchFiles,
  ['/projects/acme/2026/q4/notes.md', '# Q4 notes\nKickoff on Monday.\n'],
  ['/projects/acme/2026/q4/drafts/v1.md', '# Draft v1\nOutline only.\n'],
  ['/projects/acme/2026/q4/drafts/v2.md', '# Draft v2\nFirst full pass.\n'],
  ['/projects/acme/2026/q3/notes.md', '# Q3 notes\nWrapped up.\n'],
  ['/projects/acme/README.md', '# Acme\nClient workspace.\n'],
  ['/reports', 'A file that shares its name with the /reports folder.\n'],
  ['/reports/week-45.md', '# Week 45 report\n'],
  ['/reports/week-44.md', '# Week 44 report\n'],
  ['/inbox/Meeting notes – Q4 ünïcode.md', '# Meeting notes\nAttendees: Zoë, Łukasz, 李雷.\n'],
  ['/写真/图表 1.png', png(1500, 1)],
  ['/写真/图表 2.png', png(9000, 2)],
  [
    '/work/csv-export/2026-q4-roadmap-and-planning-workshop-synthesis-with-stakeholder-comments-final-v3.md',
    '# A very long file name\n',
  ],
  ['/assets/logo.png', png(4000, 3)],
  ['/assets/screenshot.png', png(48000, 4)],
  ['/archive/2026-q3-export.zip', zip('export.txt', 'rows: 1200\n'.repeat(80))],
  ['/archive/backup-2026-10.zip', zip('backup.txt', 'backup\n'.repeat(400))],
  ['/outputs/reports/weekly-2026-45.pdf', pdf(6000)],
  ['/outputs/charts/pricing-trend.png', png(2500, 5)],
  // Filler so the root needs two list pages (100 per page).
  ...Array.from({ length: 100 }, (_, i) => [
    `/memory/daily/2026-${String(1 + (i % 12)).padStart(2, '0')}/entry-${String(i).padStart(3, '0')}.md`,
    `Daily note ${i}\n`,
  ]),
];
// Files the second agent writes (so Author shows two agents).
const summarizerFiles = [
  ['/outputs/summaries/q4-summary.md', '# Q4 summary\nThree themes.\n'],
  ['/outputs/summaries/pricing-summary.md', '# Pricing summary\nTwo vendors changed.\n'],
  ['/inbox/summarizer-queue.json', '{"pending":3}\n'],
];
const designFiles = [
  ['/brand/logo-light.png', png(3000, 6)],
  ['/brand/logo-dark.png', png(3200, 7)],
  ['/mockups/home.png', png(12000, 8)],
  ['/mockups/pricing.png', png(15000, 9)],
  ['/notes.md', 'Design assets for the 2026 refresh.\n'],
];

// Simulated week of activity: CLI uploads all land within a minute, which would make the
// modified column and Recent meaningless. Spread each file's current version over the last
// 7 days (deterministic), and put older versions an hour before their current one.
async function spreadDates(driveId) {
  await pool.query(
    `WITH ranked AS (
       SELECT f.current_version_id AS vid,
              row_number() OVER (ORDER BY f.path) AS n
         FROM files f WHERE f.drive_id=$1 AND f.current_version_id IS NOT NULL)
     UPDATE versions v
        SET created_at = now() - ((ranked.n * 67) % 10080 || ' minutes')::interval
       FROM ranked WHERE v.id = ranked.vid`,
    [driveId],
  );
  await pool.query(
    `UPDATE versions v SET created_at = cur.created_at - interval '1 hour'
       FROM files f JOIN versions cur ON cur.id = f.current_version_id
      WHERE v.file_id = f.id AND v.id <> f.current_version_id AND v.drive_id=$1`,
    [driveId],
  );
}

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

    // browse: file-browser fixtures (see header). Three drives, three authors, simulated week.
    const browse = await session(PREFIX + 'browse');
    const bResearch = await browse('drives', { name: 'research-bot' });
    const bResearchKey = randomBytes(32).toString('base64url');
    await saveRecovery(bResearch.id, bResearchKey);
    const bAgent = await browse('agents', { name: 'research-bot' });
    const bSummarizer = await browse('agents', { name: 'summarizer' });
    const bWriterConfig = join(tmp, 'browse-writer.json');
    const bNightlyOwner = await browse('keys', {
      label: 'seed writer',
      agentId: bAgent.id,
      driveIds: [bResearch.id],
      scopes: ['read', 'write', 'delete', 'manage'],
    });
    await cli(['drive', 'create', 'nightly-builds'], {
      AGENT_DRIVE_API_KEY: bNightlyOwner.token,
      AGENT_DRIVE_CONFIG: bWriterConfig,
    });
    const bNightly = (await browse('drives?limit=100')).items.find(
      (item) => item.name === 'nightly-builds',
    );
    if (!bNightly) throw new Error('agent did not create nightly-builds (browse)');
    const bDesign = await browse('drives', { name: 'design-assets' });
    const bDesignKey = randomBytes(32).toString('base64url');
    await saveRecovery(bDesign.id, bDesignKey);
    const bBoth = await browse('keys', {
      label: 'seed all drives',
      agentId: bAgent.id,
      driveIds: [bResearch.id, bNightly.id, bDesign.id],
      scopes: ['read', 'write', 'delete'],
    });
    const bSumKey = await browse('keys', {
      label: 'summarizer',
      agentId: bSummarizer.id,
      driveIds: [bResearch.id],
      scopes: ['read', 'write'],
    });
    const bNightlyKey = randomBytes(32).toString('base64url');
    await saveRecovery(bNightly.id, bNightlyKey);
    const bCtx = (driveId, key, token, configPath) => ({ driveId, key, token, configPath });
    await upload(
      Object.assign([...browseFiles], { tmp }),
      bCtx(bResearch.id, bResearchKey, bBoth.token, bWriterConfig),
      8,
    );
    await upload(
      Object.assign([...summarizerFiles], { tmp }),
      bCtx(bResearch.id, bResearchKey, bSumKey.token, join(tmp, 'browse-summarizer.json')),
    );
    await upload(
      Object.assign([...nightlyFiles], { tmp }),
      bCtx(bNightly.id, bNightlyKey, bBoth.token, bWriterConfig),
    );
    await upload(
      Object.assign([...designFiles], { tmp }),
      bCtx(bDesign.id, bDesignKey, bBoth.token, bWriterConfig),
    );
    // The real CLI path writes /.agent-drive/check.txt.
    await cli(['check', '--drive', bResearch.id], {
      AGENT_DRIVE_API_KEY: bBoth.token,
      AGENT_DRIVE_KEY: bResearchKey,
      AGENT_DRIVE_CONFIG: bWriterConfig,
    });
    // A console restore writes a version authored by "Console".
    await browse(`drives/${bResearch.id}/delete`, { path: '/config/schedule.yaml' });
    await browse(`drives/${bResearch.id}/restore`, { path: '/config/schedule.yaml' });
    await browse(`drives/${bResearch.id}/key-backup`, { method: 'file' });
    await browse(`drives/${bDesign.id}/key-backup`, { method: 'file' });
    for (const id of [bResearch.id, bNightly.id, bDesign.id]) await spreadDates(id);
    state.users[PREFIX + 'browse'] = {
      drives: [
        { name: 'research-bot', id: bResearch.id, keyBackedUp: true, createdBy: 'human' },
        { name: 'nightly-builds', id: bNightly.id, keyBackedUp: false, createdBy: 'agent' },
        { name: 'design-assets', id: bDesign.id, keyBackedUp: true, createdBy: 'human' },
      ],
    };

    // big: 1,050 files, so the root hits the 1,000-row cap and /outputs sorts past it.
    const bigStart = Date.now();
    const big = await session(PREFIX + 'big');
    const bigDrive = await big('drives', { name: 'bulk-logs' });
    const bigKey = randomBytes(32).toString('base64url');
    await saveRecovery(bigDrive.id, bigKey);
    const bigAgent = await big('agents', { name: 'log-shipper' });
    const bigToken = await big('keys', {
      label: 'seed writer',
      agentId: bigAgent.id,
      driveIds: [bigDrive.id],
      scopes: ['read', 'write'],
    });
    const pad2 = (n) => String(n).padStart(2, '0');
    const bigWork = Object.assign(
      [
        ...Array.from({ length: 1000 }, (_, i) => [
          `/logs/run-${String(i).padStart(4, '0')}.log`,
          `run ${i} ok\n`,
        ]),
        ...Array.from({ length: 50 }, (_, i) => [
          `/outputs/summary-${pad2(i + 1)}.md`,
          `# Summary ${i + 1}\n`,
        ]),
      ],
      { tmp },
    );
    await upload(
      bigWork,
      {
        driveId: bigDrive.id,
        key: bigKey,
        token: bigToken.token,
        configPath: join(tmp, 'big.json'),
      },
      16,
    );
    await spreadDates(bigDrive.id);
    const bigSeconds = Math.round((Date.now() - bigStart) / 1000);
    state.users[PREFIX + 'big'] = {
      drives: [{ name: 'bulk-logs', id: bigDrive.id, files: 1050, seedSeconds: bigSeconds }],
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

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
const db = new pg.Pool({
  connectionString: 'postgresql://agent_drive:agent_drive_local_only@127.0.0.1:5432/agent_drive',
});
const root = mkdtempSync(join(tmpdir(), 'uxv-share-'));
const [acc, agent, drive] = [randomUUID(), randomUUID(), randomUUID()];
const token = `adk_${randomBytes(32).toString('base64url')}`;
const env = {
  ...process.env,
  AGENT_DRIVE_API_URL: 'http://localhost:3230/api',
  AGENT_DRIVE_API_KEY: token,
  AGENT_DRIVE_KEY: randomBytes(32).toString('base64url'),
  AGENT_DRIVE_CONFIG: join(root, 'c.json'),
};
await db.query('INSERT INTO accounts (id,name) VALUES ($1,$2)', [acc, 'uxv-share-' + acc]);
await db.query('INSERT INTO agents (id,account_id,name) VALUES ($1,$2,$3)', [
  agent,
  acc,
  'uxv-agent',
]);
await db.query('INSERT INTO drives (id,account_id,name) VALUES ($1,$2,$3)', [
  drive,
  acc,
  'uxv-drive',
]);
await db.query(
  `INSERT INTO api_keys (account_id,agent_id,label,token_hash,drive_ids,scopes) VALUES ($1,$2,'uxv',$3,$4::uuid[],ARRAY['read','write','share']::text[])`,
  [acc, agent, createHash('sha256').update(token).digest('hex'), [drive]],
);
const cli = (a) => {
  const r = spawnSync(process.execPath, [resolve('packages/agent-drive/dist/cli.js'), ...a], {
    env,
    encoding: 'utf8',
  });
  if (r.status) throw new Error(r.stderr);
  return r.stdout;
};
const mk = (n, name, size) => {
  writeFileSync(join(root, name), randomBytes(size));
  cli(['put', join(root, name), '/uxv/' + name, '--drive', drive]);
  return JSON.parse(cli(['share', '/uxv/' + name, '--drive', drive]));
};
const out = {};
out.ready = mk(0, 'quarterly-report-final.pdf', 48213);
out.long = mk(
  0,
  'a-very-long-synthetic-file-name-for-wrapping-checks-2026-board-meeting-minutes-final-v7-reviewed-by-everyone.txt',
  3000,
);
out.wrong = mk(0, 'wrong-key.bin', 500);
out.expired = mk(0, 'expired.bin', 500);
out.revoked = mk(0, 'revoked.bin', 500);
await db.query(
  `UPDATE shares SET created_at=now()-interval '2 seconds', expires_at=now()-interval '1 second' WHERE id=$1`,
  [out.expired.id],
);
cli(['share', 'revoke', out.revoked.id, '--drive', drive]);
out.acc = acc;
out.drive = drive;
console.log(JSON.stringify(out));
await db.end();

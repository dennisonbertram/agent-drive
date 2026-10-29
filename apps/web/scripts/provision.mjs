import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { Pool } from 'pg';

if (!process.argv.includes('--local') || process.env.NODE_ENV === 'production') {
  throw new Error('Local provisioning requires the explicit --local flag outside production.');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const databaseHost = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('Local provisioning only permits a loopback database host.');
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const accountName = (await prompt.question('Account name: ')).trim();
const agentName = (await prompt.question('Agent name: ')).trim();
prompt.close();

if (!/^[\p{L}\p{N}][\p{L}\p{N} ._:@-]{0,127}$/u.test(accountName)) {
  throw new Error('Account name must be 1-128 characters and contain no control characters.');
}
if (!/^[\p{L}\p{N}][\p{L}\p{N} ._:@-]{0,127}$/u.test(agentName)) {
  throw new Error('Agent name must be 1-128 characters and contain no control characters.');
}

const token = `adk_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const pool = new Pool({ connectionString: databaseUrl });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [
      accountName,
    ]);
    const accountId = account.rows[0].id;
    const agent = await client.query(
      'INSERT INTO agents (account_id, name) VALUES ($1, $2) RETURNING id',
      [accountId, agentName],
    );
    const agentId = agent.rows[0].id;
    await client.query(
      `INSERT INTO api_keys
       (account_id, agent_id, label, token_hash, drive_ids, scopes)
       VALUES ($1, $2, $3, $4, '{}'::uuid[], ARRAY['manage']::text[])`,
      [accountId, agentId, 'local operator manage credential', tokenHash],
    );
    await client.query('COMMIT');
    process.stdout.write(
      `\nProvisioned local account ${accountId} and agent ${agentId}.\n` +
        'Save this credential now; it is shown only once:\n' +
        `${token}\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

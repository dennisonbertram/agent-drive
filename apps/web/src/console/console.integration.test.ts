import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  handleApiRequest,
  handleConsoleApiRequest,
  handlePublicShareRequest,
} from '../api/handler';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://agent_drive:agent_drive_local_only@localhost:5432/agent_drive',
});
const db = drizzle(pool);
const consoleOrigin = 'http://console.test';
const apiOrigin = 'http://api.test';
const suffix = randomUUID().replaceAll('-', '_');
const ownerUserId = `e2e_owner_${suffix}`;
const otherUserId = `e2e_other_${suffix}`;
const accountIds: string[] = [];
let ownerAccountId = '';
let ownerConsoleAgentId = '';
let otherConsoleAgentId = '';
let ownerDriveId = '';
let otherDriveId = '';
let managedAgentId = '';

function token() {
  return `adk_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
}

async function json(response: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await response.json()) as Record<string, any>;
}

function consoleRequest(
  userId: string | null,
  path: string,
  method = 'GET',
  body?: unknown,
  origin: string | null = consoleOrigin,
  headers: HeadersInit = {},
) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  if (method !== 'GET' && origin !== null) requestHeaders.set('origin', origin);
  const init: RequestInit = { method, headers: requestHeaders };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleConsoleApiRequest(new Request(`${consoleOrigin}/api/console${path}`, init), userId);
}

function apiRequest(path: string, apiKey?: string, method = 'GET', body?: unknown) {
  const headers = new Headers();
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleApiRequest(new Request(`${apiOrigin}/api/v1${path}`, init));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'apps/web/drizzle') });

  const firstSession = await json(await consoleRequest(ownerUserId, '/session'));
  const otherSession = await json(await consoleRequest(otherUserId, '/session'));
  ownerAccountId = firstSession.account.id as string;
  accountIds.push(ownerAccountId, otherSession.account.id as string);

  ownerConsoleAgentId = (
    await pool.query("SELECT id FROM agents WHERE account_id = $1 AND name = '__console__'", [
      ownerAccountId,
    ])
  ).rows[0].id as string;
  otherConsoleAgentId = (
    await pool.query("SELECT id FROM agents WHERE account_id = $1 AND name = '__console__'", [
      otherSession.account.id,
    ])
  ).rows[0].id as string;

  const ownerDrive = await json(
    await consoleRequest(ownerUserId, '/drives', 'POST', { name: `owner-${suffix}` }),
  );
  const otherDrive = await json(
    await consoleRequest(otherUserId, '/drives', 'POST', { name: `other-${suffix}` }),
  );
  ownerDriveId = ownerDrive.id as string;
  otherDriveId = otherDrive.id as string;
  managedAgentId = (
    await json(
      await consoleRequest(ownerUserId, '/agents', 'POST', {
        name: `managed-${suffix}`,
      }),
    )
  ).id as string;
});

afterAll(async () => {
  if (accountIds.length) {
    await pool.query('DELETE FROM audit_events WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query(
      'DELETE FROM file_events WHERE drive_id IN (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))',
      [accountIds],
    );
    await pool.query(
      'DELETE FROM versions WHERE drive_id IN (SELECT id FROM drives WHERE account_id = ANY($1::uuid[]))',
      [accountIds],
    );
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  }
  await pool.end();
});

describe('Phase 4 console API', () => {
  it('bootstraps idempotently, isolates owners, rejects header bypasses, and enforces CSRF', async () => {
    const accounts = await pool.query('SELECT id FROM accounts WHERE external_clerk_user_id = $1', [
      ownerUserId,
    ]);
    const consoleAgents = await pool.query(
      "SELECT id FROM agents WHERE account_id = $1 AND name = '__console__'",
      [ownerAccountId],
    );
    expect(accounts.rows).toHaveLength(1);
    expect(consoleAgents.rows).toHaveLength(1);
    await pool.query('UPDATE accounts SET name = $1 WHERE id = $2', [
      'Renamed workspace',
      ownerAccountId,
    ]);
    const repeatedSession = await json(await consoleRequest(ownerUserId, '/session'));
    expect(repeatedSession.account).toEqual({ id: ownerAccountId, name: 'Renamed workspace' });

    const drives = await json(await consoleRequest(ownerUserId, '/drives'));
    expect(drives.items.map((drive: { id: string }) => drive.id)).toContain(ownerDriveId);
    expect(drives.items.map((drive: { id: string }) => drive.id)).not.toContain(otherDriveId);
    expect((await consoleRequest(ownerUserId, `/drives/${otherDriveId}/list`)).status).toBe(403);

    const bypass = await consoleRequest(null, '/session', 'GET', undefined, null, {
      authorization: `Bearer ${token()}`,
      'x-user-id': ownerUserId,
    });
    expect(bypass.status).toBe(401);
    expect(
      (
        await handleApiRequest(
          new Request(`${apiOrigin}/api/v1/whoami`, {
            headers: { 'x-user-id': ownerUserId },
          }),
        )
      ).status,
    ).toBe(401);

    expect(
      (
        await consoleRequest(
          ownerUserId,
          '/drives',
          'POST',
          { name: `missing-origin-${suffix}` },
          null,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await consoleRequest(
          ownerUserId,
          '/drives',
          'POST',
          { name: `foreign-origin-${suffix}` },
          'https://attacker.test',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await pool.query("SELECT id FROM drives WHERE account_id = $1 AND name LIKE '%-origin-%'", [
          ownerAccountId,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('revokes only the owner agent keys and preserves read-only bearer behavior', async () => {
    const created = await json(
      await consoleRequest(ownerUserId, '/keys', 'POST', {
        agentId: managedAgentId,
        label: `read-only-${suffix}`,
        driveIds: [ownerDriveId],
        scopes: ['read'],
      }),
    );
    expect((await apiRequest('/whoami', created.token)).status).toBe(200);
    expect((await apiRequest(`/drives/${ownerDriveId}/list`, created.token)).status).toBe(200);
    expect(
      (
        await apiRequest(`/drives/${ownerDriveId}/delete`, created.token, 'POST', {
          path: '/not-allowed',
        })
      ).status,
    ).toBe(403);

    const attributedAudit = await pool.query(
      'SELECT id FROM audit_events WHERE api_key_id = $1 AND account_id = $2 ORDER BY id DESC LIMIT 1',
      [created.id, ownerAccountId],
    );
    expect(attributedAudit.rows).toHaveLength(1);
    await pool.query('DELETE FROM api_keys WHERE id = $1 AND account_id = $2', [
      created.id,
      ownerAccountId,
    ]);
    const retainedAudit = await pool.query(
      'SELECT api_key_id, user_id FROM audit_events WHERE id = $1',
      [attributedAudit.rows[0].id],
    );
    expect(retainedAudit.rows[0]).toEqual({ api_key_id: null, user_id: null });

    const activeKey = await json(
      await consoleRequest(ownerUserId, '/keys', 'POST', {
        agentId: managedAgentId,
        label: `revocation-${suffix}`,
        driveIds: [ownerDriveId],
        scopes: ['read'],
      }),
    );
    expect(
      (await consoleRequest(ownerUserId, `/agents/${otherConsoleAgentId}/revoke`, 'POST', {}))
        .status,
    ).toBe(404);
    const revoked = await json(
      await consoleRequest(ownerUserId, `/agents/${managedAgentId}/revoke`, 'POST', {}),
    );
    expect(revoked).toEqual({ id: managedAgentId, revokedKeys: 1 });
    expect((await apiRequest('/whoami', activeKey.token)).status).toBe(401);
  });

  it('does not apply key write paths to console moves and deletes', async () => {
    const limited = await json(
      await consoleRequest(ownerUserId, '/keys', 'POST', {
        agentId: managedAgentId,
        label: `limited-${suffix}`,
        driveIds: [ownerDriveId],
        scopes: ['read', 'write', 'delete'],
        writePaths: ['/inbox/x'],
      }),
    );
    expect(limited.write_paths).toEqual(['/inbox/x']);
    await pool.query("INSERT INTO files (drive_id, path) VALUES ($1, '/console-wp.bin')", [
      ownerDriveId,
    ]);
    const move = (token: string | null, to: string) =>
      token
        ? apiRequest(`/drives/${ownerDriveId}/move`, token, 'POST', {
            path: '/console-wp.bin',
            destinationPath: to,
          })
        : consoleRequest(ownerUserId, `/drives/${ownerDriveId}/move`, 'POST', {
            path: '/console-wp.bin',
            destinationPath: to,
          });
    expect((await move(limited.token, '/outputs/m.bin')).status).toBe(403);
    expect((await move(null, '/outputs/m.bin')).status).toBe(200);
    const removed = await consoleRequest(ownerUserId, `/drives/${ownerDriveId}/delete`, 'POST', {
      path: '/outputs/m.bin',
    });
    expect(removed.status).not.toBe(403);
    // Keep the shared trash and usage assertions in the next test unchanged.
    const ids = `SELECT id FROM files WHERE drive_id = $1 AND path = '/outputs/m.bin'`;
    await pool.query(`DELETE FROM file_events WHERE file_id IN (${ids})`, [ownerDriveId]);
    await pool.query(`DELETE FROM files WHERE id IN (${ids})`, [ownerDriveId]);
  });

  it('console creates, lists and revokes share links with same-origin checks', async () => {
    const driveId = ownerDriveId;
    const shareFile = '/share-me.bin';
    await pool.query('INSERT INTO files (drive_id, path) VALUES ($1, $2)', [driveId, shareFile]);
    const file = (
      await pool.query('SELECT id FROM files WHERE drive_id = $1 AND path = $2', [
        driveId,
        shareFile,
      ])
    ).rows[0].id as string;
    const object = `console-share-${suffix}`;
    const version = (
      await pool.query(
        `INSERT INTO versions (file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
         VALUES ($1, $2, $3, 100, $4, $5) RETURNING id`,
        [file, driveId, object, 'w'.repeat(82), ownerConsoleAgentId],
      )
    ).rows[0].id as string;
    await pool.query('UPDATE files SET current_version_id = $1 WHERE id = $2', [version, file]);
    const base = `/drives/${driveId}/shares`;
    const body = { path: shareFile, versionId: version };

    const noOrigin = await consoleRequest(ownerUserId, base, 'POST', body, null);
    expect((await json(noOrigin)).error.code).toBe('permission_denied');

    const created = await consoleRequest(ownerUserId, base, 'POST', body);
    expect(created.status).toBe(201);
    const share = await json(created);
    expect(share.versionId).toBe(version);

    const status = async () =>
      (await json(await consoleRequest(ownerUserId, base))).items.find(
        (s: { id: string }) => s.id === share.id,
      ).status;
    expect(await status()).toBe('active');
    await consoleRequest(ownerUserId, `/drives/${driveId}/delete`, 'POST', { path: shareFile });
    expect(await status()).toBe('unavailable');
    await pool.query('UPDATE files SET deleted_at = NULL WHERE id = $1', [file]);
    expect(await status()).toBe('active');

    // Another owner is refused on this drive (existing behaviour: permission_denied).
    expect((await consoleRequest(otherUserId, base)).status).toBe(403);
    expect((await consoleRequest(otherUserId, base, 'POST', body)).status).toBe(403);
    expect((await consoleRequest(otherUserId, `${base}/${share.id}`, 'DELETE')).status).toBe(403);
    // Routes outside the allow-list stay closed.
    expect((await consoleRequest(ownerUserId, `${base}/${share.id}`, 'GET')).status).toBe(404);
    expect((await consoleRequest(ownerUserId, `${base}/${share.id}`, 'POST', {})).status).toBe(404);
    expect((await consoleRequest(ownerUserId, base, 'DELETE')).status).toBe(404);
    expect((await consoleRequest(ownerUserId, `${base}/${share.id}/x`, 'DELETE')).status).toBe(404);

    expect(
      (await consoleRequest(ownerUserId, `${base}/${share.id}`, 'DELETE', undefined, null)).status,
    ).toBe(403);
    // A foreign Origin is refused on create and revoke, and nothing changes.
    const foreign = 'https://evil.example';
    expect((await consoleRequest(ownerUserId, base, 'POST', body, foreign)).status).toBe(403);
    expect(
      (await consoleRequest(ownerUserId, `${base}/${share.id}`, 'DELETE', undefined, foreign))
        .status,
    ).toBe(403);
    expect(await status()).toBe('active');
    const revoked = await consoleRequest(ownerUserId, `${base}/${share.id}`, 'DELETE');
    expect((await json(revoked)).revokedAt).toBeTruthy();
    expect(await status()).toBe('revoked');

    const publicShare = await handlePublicShareRequest(share.id as string, true);
    expect((await json(publicShare)).error.code).toBe('share_revoked');
    await pool.query('DELETE FROM shares WHERE drive_id = $1', [driveId]);
    await pool.query('UPDATE files SET current_version_id = NULL WHERE id = $1', [file]);
    await pool.query('DELETE FROM file_events WHERE file_id = $1', [file]);
    await pool.query('DELETE FROM versions WHERE file_id = $1', [file]);
    await pool.query('DELETE FROM files WHERE id = $1', [file]);
  });

  it('paginates trash, overrides submitted attribution, and reports isolated usage', async () => {
    const deletedFileId = randomUUID();
    const deletedVersionId = randomUUID();
    const liveFileId = randomUUID();
    const firstLiveVersionId = randomUUID();
    const currentLiveVersionId = randomUUID();
    await pool.query(
      `INSERT INTO files (id, drive_id, path, current_version_id, deleted_at)
       VALUES ($1, $2, '/trash-a.bin', $3, now()),
              ($4, $2, '/trash-b.bin', $5, NULL)`,
      [deletedFileId, ownerDriveId, deletedVersionId, liveFileId, currentLiveVersionId],
    );
    await pool.query(
      `INSERT INTO versions
        (id, file_id, drive_id, object_key, ciphertext_size, wrapped_key, agent_id)
       VALUES ($1, $2, $3, $4, 10, 'wrapped', $5),
              ($6, $7, $3, $8, 20, 'wrapped', $5),
              ($9, $7, $3, $10, 30, 'wrapped', $5)`,
      [
        deletedVersionId,
        deletedFileId,
        ownerDriveId,
        `test/${suffix}/deleted`,
        ownerConsoleAgentId,
        firstLiveVersionId,
        liveFileId,
        `test/${suffix}/history`,
        currentLiveVersionId,
        `test/${suffix}/current`,
      ],
    );

    expect(
      (
        await consoleRequest(ownerUserId, `/drives/${ownerDriveId}/delete`, 'POST', {
          path: '/trash-b.bin',
          userId: 'client-controlled-user',
        })
      ).status,
    ).toBe(200);
    const firstPage = await json(
      await consoleRequest(ownerUserId, `/drives/${ownerDriveId}/trash?limit=1`),
    );
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await json(
      await consoleRequest(
        ownerUserId,
        `/drives/${ownerDriveId}/trash?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      ),
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.items, ...secondPage.items].map((item) => item.path)).toEqual([
      '/trash-a.bin',
      '/trash-b.bin',
    ]);

    const event = await pool.query(
      "SELECT user_id FROM file_events WHERE drive_id = $1 AND operation = 'delete' AND path = '/trash-b.bin'",
      [ownerDriveId],
    );
    expect(event.rows[0].user_id).toBe(ownerUserId);

    const usage = await json(await consoleRequest(ownerUserId, '/usage'));
    expect(usage.egressBytes).toBeNull();
    expect(usage.cost).toBeNull();
    expect(usage.storageBytes).toBe(60);
    expect(usage.drives.find((drive: { id: string }) => drive.id === ownerDriveId)).toMatchObject({
      storageBytes: 60,
      liveFiles: 0,
      versions: 3,
    });
    expect(
      usage.agents.find((agent: { id: string }) => agent.id === ownerConsoleAgentId),
    ).toMatchObject({
      storageBytes: 60,
      versions: 3,
      operations: expect.any(Number),
    });

    const audits = await pool.query(
      'SELECT api_key_id, user_id FROM audit_events WHERE account_id = $1 AND user_id = $2',
      [ownerAccountId, ownerUserId],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(audits.rows.every((row) => row.api_key_id === null)).toBe(true);
  });

  it('protects billing settings with console auth and same-origin checks', async () => {
    const summary = await json(await consoleRequest(ownerUserId, '/billing'));
    expect(summary).toMatchObject({
      checkoutConfigured: expect.any(Boolean),
      egressMeteringConfigured: expect.any(Boolean),
      emailConfigured: expect.any(Boolean),
    });
    expect(summary.rates === null || typeof summary.rates === 'object').toBe(true);
    expect(summary.checkoutRates === null || typeof summary.checkoutRates === 'object').toBe(true);

    expect(
      (
        await consoleRequest(ownerUserId, '/billing/settings', 'PATCH', {
          spendCapCents: 2500,
          alertThresholdCents: 500,
          alertEmail: 'billing@example.test',
        })
      ).status,
    ).toBe(200);
    const settings = await json(await consoleRequest(ownerUserId, '/billing'));
    expect(settings).toMatchObject({
      spendCapCents: '2500',
      alertThresholdCents: '500',
      alertEmail: 'billing@example.test',
    });
    expect(
      (
        await consoleRequest(ownerUserId, '/billing/settings', 'PATCH', {
          spendCapCents: 2500,
          alertThresholdCents: 500,
          alertEmail: null,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await consoleRequest(
          ownerUserId,
          '/billing/settings',
          'PATCH',
          { spendCapCents: 2000, alertThresholdCents: null, alertEmail: null },
          null,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await consoleRequest(ownerUserId, '/billing/settings', 'PATCH', {
          spendCapCents: Number.MAX_SAFE_INTEGER,
          alertThresholdCents: null,
          alertEmail: null,
        })
      ).status,
    ).toBe(400);
    expect((await apiRequest('/billing')).status).toBe(401);
  });
  it('usage includes plan limits', async () => {
    const usage = await json(await consoleRequest(ownerUserId, '/usage'));
    expect(usage.plan).toBe('free');
    expect(usage.limits.storageBytes).toBe(String(5n * 1024n ** 3n));
    expect(usage.limits.operations).toBe('1000000');
    expect(usage.limits.drives).toBe('3');
  });

  it('audit consoleReads=0 hides the console own reads only', async () => {
    const created = await json(
      await consoleRequest(ownerUserId, '/keys', 'POST', {
        agentId: managedAgentId,
        label: `audit-${suffix}`,
        driveIds: [ownerDriveId],
        scopes: ['read'],
      }),
    );
    await consoleRequest(ownerUserId, '/drives');
    await consoleRequest(ownerUserId, '/drives', 'POST', { name: `audit-drive-${suffix}` });
    await apiRequest(`/drives/${ownerDriveId}/list`, created.token);
    const actions = async (query: string) =>
      (
        (await json(await consoleRequest(ownerUserId, `/audit?limit=20${query}`))).items as {
          action: string;
          userId: string | null;
        }[]
      ).map((row) => `${row.action}:${row.userId ? 'console' : 'agent'}`);
    const filtered = await actions('&consoleReads=0');
    expect(filtered).not.toContain('drives.list:console');
    expect(filtered).toContain('drives.create:console');
    expect(filtered).toContain('drive.list:agent');
    const all = await actions('');
    expect(all).toContain('drives.list:console');
    expect(all).toContain('drives.create:console');
    expect(all).toContain('drive.list:agent');
  });

  it('billing routes are named in the audit log', async () => {
    expect((await consoleRequest(ownerUserId, '/billing')).status).toBe(200);
    const row = await pool.query(
      'SELECT action FROM audit_events WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [ownerAccountId],
    );
    expect(row.rows[0].action).toBe('billing.read');
  });
});

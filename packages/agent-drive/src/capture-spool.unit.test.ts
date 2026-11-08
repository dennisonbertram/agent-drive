import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Drainer, Spool, SpoolFullError, type UploadClient } from './capture-spool.js';
import { AgentDriveApiError } from './client.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'spool-test-'));
  dirs.push(dir);
  return dir;
}
const meta = (path: string) => ({ path, wrappedKey: 'w', ciphertextSize: 3, tags: ['trace'] });
const bytes = new Uint8Array([1, 2, 3]);
const names = async (dir: string) => (await readdir(dir)).sort();

function drainer(spool: Spool, put: UploadClient['putEncrypted'], logs: string[] = []) {
  return new Drainer(spool, { putEncrypted: put }, 'd', {
    log: (l) => logs.push(l),
    minBackoffMs: 2,
    maxBackoffMs: 4,
  });
}
const apiError = (code: string, status: number) => new AgentDriveApiError(code, status, code);

describe('spool', () => {
  it('uploads in name order and deletes on success and on 409 exists', async () => {
    const spool = await Spool.open(await tempDir());
    for (const id of ['2', '1', '3']) await spool.add(id, bytes, meta(`/p${id}`));
    const order: string[] = [];
    const d = drainer(spool, async (_d, path) => {
      order.push(path);
      if (path === '/p2') throw apiError('exists', 409);
    });
    await d.finish(Date.now() + 2000);
    expect(order).toEqual(['/p1', '/p2', '/p3']);
    expect(d.uploaded).toBe(2);
    expect((await names(spool.dir)).filter((n) => /\.(json|adrv)$/u.test(n))).toEqual([]);
  });

  it('retries a network error until it succeeds and keeps files while offline', async () => {
    const spool = await Spool.open(await tempDir());
    await spool.add('1', bytes, meta('/p'));
    let calls = 0;
    await drainer(spool, async () => {
      if (++calls < 3) throw new TypeError('fetch failed');
    }).finish(Date.now() + 2000);
    expect(calls).toBe(3);
    const offline = await Spool.open(await tempDir());
    await offline.add('1', bytes, meta('/p'));
    await drainer(offline, async () => Promise.reject(apiError('internal_error', 503))).finish(
      Date.now() + 50,
    );
    expect(await names(offline.dir)).toEqual(expect.arrayContaining(['1.adrv', '1.json']));
  });

  it('moves a validation_error entry to invalid/ and still uploads the next one', async () => {
    const spool = await Spool.open(await tempDir());
    await spool.add('1', bytes, meta('/bad'));
    await spool.add('2', bytes, meta('/good'));
    const logs: string[] = [];
    const uploaded: string[] = [];
    await drainer(
      spool,
      async (_d, path) => {
        if (path === '/bad') throw apiError('validation_error', 400);
        uploaded.push(path);
      },
      logs,
    ).finish(Date.now() + 2000);
    expect(uploaded).toEqual(['/good']);
    expect(await names(join(spool.dir, 'invalid'))).toEqual(['1.adrv', '1.json']);
    expect(logs.length).toBe(1);
    expect(await spool.invalidCount()).toBe(1);
  });

  it.each([
    ['unauthorized', 401],
    ['quota_exceeded', 413],
    ['payment_required', 402],
    ['permission_denied', 403],
  ])('%s stops the drain with one message and keeps the files', async (code, status) => {
    const spool = await Spool.open(await tempDir());
    await spool.add('1', bytes, meta('/a'));
    await spool.add('2', bytes, meta('/b'));
    const logs: string[] = [];
    let calls = 0;
    await drainer(
      spool,
      async () => {
        calls++;
        throw apiError(code, status);
      },
      logs,
    ).finish(Date.now() + 2000);
    expect(calls).toBe(1);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain(code);
    expect((await names(spool.dir)).filter((n) => n.endsWith('.json'))).toEqual([
      '1.json',
      '2.json',
    ]);
  });

  it('removes stale incomplete entries at startup but not fresh ones', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'old.adrv'), 'x');
    await writeFile(join(dir, '.old.json.1.2.tmp'), 'x');
    await writeFile(join(dir, 'fresh.adrv'), 'x');
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(join(dir, 'old.adrv'), old, old);
    await utimes(join(dir, '.old.json.1.2.tmp'), old, old);
    await Spool.open(dir);
    expect(await names(dir)).toEqual(['fresh.adrv', 'invalid']);
  });

  it('leaves no sidecar when the publish fails after the ciphertext write', async () => {
    const dir = await tempDir();
    const spool = await Spool.open(dir, {
      beforePublish: () => {
        throw new Error('crash');
      },
    });
    await expect(spool.add('1', bytes, meta('/p'))).rejects.toThrow('crash');
    expect((await names(dir)).filter((n) => n.endsWith('.json'))).toEqual([]);
  });

  it('does not drain when another live process holds the lock, and retakes a stale lock', async () => {
    const spool = await Spool.open(await tempDir());
    await spool.add('1', bytes, meta('/p'));
    const lock = join(spool.dir, 'drain.lock');
    await mkdir(lock);
    await writeFile(
      join(lock, 'owner'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
    );
    let calls = 0;
    const put = async () => void calls++;
    await drainer(spool, put).finish(Date.now() + 500);
    expect(calls).toBe(0);
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    await writeFile(join(lock, 'owner'), JSON.stringify({ pid: dead, startedAt: Date.now() }));
    await drainer(spool, put).finish(Date.now() + 500);
    expect(calls).toBe(1);
  });

  it('counts invalid/ against the cap and never deletes queued entries', async () => {
    const dir = await tempDir();
    const spool = await Spool.open(dir, { capBytes: 5 });
    await writeFile(join(dir, 'invalid', 'x.adrv'), new Uint8Array(3));
    await expect(spool.add('1', bytes, meta('/p'))).rejects.toBeInstanceOf(SpoolFullError);
    expect(await spool.usedBytes()).toBe(3);
    const roomy = await Spool.open(dir, { capBytes: 6 });
    await roomy.add('1', bytes, meta('/p'));
    await expect(roomy.add('2', bytes, meta('/q'))).rejects.toBeInstanceOf(SpoolFullError);
    expect((await names(dir)).filter((n) => n.endsWith('.json'))).toEqual(['1.json']);
  });
});

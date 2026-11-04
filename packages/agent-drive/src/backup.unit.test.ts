import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriveClient } from './client.js';
import { backupDirectory } from './backup.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-backup-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'cfg', 'config.json'));
  const root = join(dir, 'src');
  await mkdir(join(root, 'sub'), { recursive: true });
  await writeFile(join(root, 'a.txt'), 'A');
  await writeFile(join(root, 'sub', 'b.txt'), 'B');
  return { dir, root };
}

function mock(failOn?: string) {
  const puts: { path: string; options: unknown }[] = [];
  const client = {
    apiOrigin: 'https://x.test',
    put: async (_d: string, path: string, _b: Uint8Array, options: unknown) => {
      if (failOn && path.endsWith(failOn)) throw new Error('boom');
      puts.push({ path, options });
      return { id: 'v' };
    },
  } as unknown as AgentDriveClient;
  return { client, puts };
}

describe('backupDirectory', () => {
  it('uploads all, skips unchanged, re-uploads changed', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    const first = await backupDirectory(client, 'd', root, '/backups/box');
    expect(first).toMatchObject({ uploaded: 2, unchanged: 0, failed: 0 });
    expect(puts.map((p) => p.path).sort()).toEqual([
      '/backups/box/a.txt',
      '/backups/box/sub/b.txt',
    ]);
    expect(puts[0]?.options).toMatchObject({ mode: 'overwrite' });
    puts.length = 0;
    expect(await backupDirectory(client, 'd', root, '/backups/box')).toMatchObject({
      uploaded: 0,
      unchanged: 2,
    });
    await writeFile(join(root, 'a.txt'), 'A2');
    const third = await backupDirectory(client, 'd', root, '/backups/box');
    expect(third).toMatchObject({ uploaded: 1, unchanged: 1 });
    expect(puts.map((p) => p.path)).toEqual(['/backups/box/a.txt']);
  });

  it('keys the manifest by prefix, not only the local path', async () => {
    const { root } = await fixture();
    const { client } = mock();
    await backupDirectory(client, 'd', root, '/one');
    expect(await backupDirectory(client, 'd', root, '/two')).toMatchObject({ uploaded: 2 });
  });

  it('continues past a failing file and reports failure', async () => {
    const { root } = await fixture();
    const { client, puts } = mock('a.txt');
    const result = await backupDirectory(client, 'd', root, '/p');
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(puts.map((p) => p.path)).toEqual(['/p/sub/b.txt']);
    // the failed file is retried next run
    const again = await backupDirectory(mock().client, 'd', root, '/p');
    expect(again).toMatchObject({ uploaded: 1, unchanged: 1, failed: 0 });
  });

  it('dry-run uploads nothing and records nothing', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    const result = await backupDirectory(client, 'd', root, '/p', { dryRun: true });
    expect(puts).toEqual([]);
    expect(result.wouldUpload.sort()).toEqual(['/p/a.txt', '/p/sub/b.txt']);
    expect(await backupDirectory(client, 'd', root, '/p')).toMatchObject({ uploaded: 2 });
  });

  it('skips symlinks', async () => {
    const { dir, root } = await fixture();
    await writeFile(join(dir, 'outside.txt'), 'secret');
    await symlink(join(dir, 'outside.txt'), join(root, 'link.txt'));
    const { client, puts } = mock();
    await backupDirectory(client, 'd', root, '/p');
    expect(puts.map((p) => p.path)).not.toContain('/p/link.txt');
  });
});

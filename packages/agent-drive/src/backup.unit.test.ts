import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriveClient } from './client.js';
import { backupDirectory, readFileInside } from './backup.js';

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

  it('excludes the config and state when the config path goes through a symlink', async () => {
    const { dir } = await fixture();
    const real = join(dir, 'real');
    await mkdir(join(real, 'cfg'), { recursive: true });
    await writeFile(join(real, 'a.txt'), 'A');
    await writeFile(join(real, 'cfg', 'config.json'), '{"apiKey":"x"}');
    await mkdir(join(real, 'cfg', 'config.json.state'));
    await writeFile(join(real, 'cfg', 'config.json.state', 'm.json'), '{}');
    const link = join(dir, 'link');
    await symlink(real, link);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(link, 'cfg', 'config.json'));
    const { client, puts } = mock();
    await backupDirectory(client, 'd', real, '/p');
    expect(puts.map((p) => p.path)).toEqual(['/p/a.txt']);
  });

  it('excludes the key file and config temp files', async () => {
    const { dir } = await fixture();
    const root = join(dir, 'cfgroot');
    await mkdir(root);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(root, 'config.json'));
    await writeFile(join(root, 'a.txt'), 'A');
    await writeFile(join(root, 'drive.key'), 'secret');
    await writeFile(
      join(root, 'config.json.123.0b6f1e0a-1111-4222-8333-444455556666.tmp'),
      'secret',
    );
    const { client, puts } = mock();
    await backupDirectory(client, 'd', root, '/p', { keyFile: join(root, 'drive.key') });
    expect(puts.map((p) => p.path)).toEqual(['/p/a.txt']);
  });

  it('refuses a file swapped for a symlink after listing', async () => {
    const { dir, root } = await fixture();
    const file = join(root, 'a.txt');
    const info = await lstat(file);
    await writeFile(join(dir, 'outside.txt'), 'secret');
    await rm(file);
    await symlink(join(dir, 'outside.txt'), file);
    await expect(readFileInside(file, await realpath(root), info)).rejects.toThrow();
  });

  it('refuses a file whose directory was swapped for a symlink', async () => {
    const { dir, root } = await fixture();
    const file = join(root, 'sub', 'b.txt');
    const info = await lstat(file);
    await mkdir(join(dir, 'evil'));
    await writeFile(join(dir, 'evil', 'b.txt'), 'secret');
    await rename(join(root, 'sub'), join(dir, 'moved'));
    await symlink(join(dir, 'evil'), join(root, 'sub'));
    await expect(readFileInside(file, await realpath(root), info)).rejects.toThrow();
  });

  it.skipIf(process.getuid?.() === 0)('reports an unreadable directory and continues', async () => {
    const { root } = await fixture();
    await chmod(join(root, 'sub'), 0);
    try {
      const { client, puts } = mock();
      const lines: string[] = [];
      const result = await backupDirectory(client, 'd', root, '/p', { log: (l) => lines.push(l) });
      expect(result).toMatchObject({ uploaded: 1, failed: 1 });
      expect(puts.map((p) => p.path)).toEqual(['/p/a.txt']);
      expect(lines.join('\n')).toContain('sub');
    } finally {
      await chmod(join(root, 'sub'), 0o700);
    }
  });
});

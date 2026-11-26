import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentDriveApiError } from './client.js';
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

function mock(failOn?: string, beforeUpload?: (path: string) => Promise<void>) {
  const puts: { path: string; options: unknown }[] = [];
  const client = {
    apiOrigin: 'https://x.test',
    putStream: async (
      _d: string,
      path: string,
      source: AsyncIterable<Uint8Array>,
      size: number,
      options: unknown,
    ) => {
      if (failOn && path.endsWith(failOn)) throw new Error('boom');
      await beforeUpload?.(path);
      let uploadedBytes = 0;
      for await (const chunk of source) uploadedBytes += chunk.byteLength;
      if (uploadedBytes !== size) throw new Error('stream size mismatch');
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
    await writeFile(join(real, 'cfg', 'config.json.lock.sqlite'), 'lock metadata');
    await writeFile(join(real, 'cfg', 'config.json.lock.sqlite-journal'), 'journal metadata');
    await writeFile(join(real, 'cfg', 'config.json.lock.sqlite-wal'), 'WAL metadata');
    await writeFile(join(real, 'cfg', 'config.json.lock.sqlite-shm'), 'shared memory metadata');
    await mkdir(join(real, 'cfg', 'config.json.state'), { mode: 0o700 });
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
    await writeFile(join(dir, 'outside.txt'), 'secret');
    let swapped = false;
    const { client, puts } = mock();
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      log: (line) => {
        lines.push(line);
        if (!swapped && line.startsWith('backup found')) {
          swapped = true;
          rmSync(file);
          symlinkSync(join(dir, 'outside.txt'), file);
        }
      },
    });
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(puts.map((put) => put.path)).toEqual(['/p/sub/b.txt']);
    expect(lines.join('\n')).toContain('failed /p/a.txt');
  });

  it('refuses a file whose directory was swapped for a symlink', async () => {
    const { dir, root } = await fixture();
    await mkdir(join(dir, 'evil'));
    await writeFile(join(dir, 'evil', 'b.txt'), 'secret');
    let swapped = false;
    const { client, puts } = mock();
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      log: (line) => {
        lines.push(line);
        if (!swapped && line.startsWith('backup found')) {
          swapped = true;
          renameSync(join(root, 'sub'), join(dir, 'moved'));
          symlinkSync(join(dir, 'evil'), join(root, 'sub'));
        }
      },
    });
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(puts.map((put) => put.path)).toEqual(['/p/a.txt']);
    expect(lines.join('\n')).toContain('failed /p/sub/b.txt');
  });

  it('with gitignore, skips ignored entries and .git control metadata', async () => {
    const { root } = await fixture();
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    await writeFile(join(root, '.gitignore'), 'ignored/\n*.log\n');
    await mkdir(join(root, 'ignored'));
    await writeFile(join(root, 'ignored', 'x.txt'), 'X');
    await writeFile(join(root, 'a.log'), 'L');
    // A nested .git (an embedded repo or submodule marker) is control metadata too.
    await writeFile(join(root, 'sub', '.git'), 'gitdir: /elsewhere');
    const { client, puts } = mock();
    const lines: string[] = [];
    await backupDirectory(client, 'd', root, '/p', { gitignore: true, log: (l) => lines.push(l) });
    const paths = puts.map((p) => p.path);
    expect(paths).not.toContain('/p/ignored/x.txt');
    expect(paths).not.toContain('/p/a.log');
    expect(paths).toContain('/p/a.txt');
    expect(paths).toContain('/p/sub/b.txt');
    expect(paths.some((p) => p.startsWith('/p/.git/'))).toBe(false);
    expect(paths).not.toContain('/p/sub/.git');
    expect(lines.join('\n')).toMatch(
      /backup found \d+ files \([\d.]+ MB\) in .+; skipped 4 ignored paths/u,
    );
  });

  it('with gitignore, skips a linked worktree .git file and honors its rules', async () => {
    const { dir } = await fixture();
    const main = join(dir, 'main');
    const worktree = join(dir, 'wt');
    await mkdir(main);
    execFileSync('git', ['init'], { cwd: main, stdio: 'pipe' });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=backup@test',
        '-c',
        'user.name=backup',
        'commit',
        '--allow-empty',
        '-m',
        'init',
      ],
      { cwd: main, stdio: 'pipe' },
    );
    execFileSync('git', ['worktree', 'add', '--detach', worktree], { cwd: main, stdio: 'pipe' });
    // In a linked worktree .git is a file pointing at the real git dir, not a directory.
    expect((await lstat(join(worktree, '.git'))).isFile()).toBe(true);
    await writeFile(join(worktree, '.gitignore'), 'ignored/\n');
    await mkdir(join(worktree, 'ignored'));
    await writeFile(join(worktree, 'ignored', 'x.txt'), 'X');
    await writeFile(join(worktree, 'kept.txt'), 'K');
    const { client, puts } = mock();
    await backupDirectory(client, 'd', worktree, '/p', { gitignore: true });
    const paths = puts.map((p) => p.path);
    expect(paths).toContain('/p/kept.txt');
    expect(paths).not.toContain('/p/.git');
    expect(paths).not.toContain('/p/ignored/x.txt');
  });

  it('uploads gitignored files and .git by default', async () => {
    const { root } = await fixture();
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    await writeFile(join(root, '.gitignore'), 'ignored/\n*.log\n');
    await mkdir(join(root, 'ignored'));
    await writeFile(join(root, 'ignored', 'x.txt'), 'X');
    await writeFile(join(root, 'a.log'), 'L');
    const { client, puts } = mock();
    await backupDirectory(client, 'd', root, '/p');
    const paths = puts.map((p) => p.path);
    expect(paths).toContain('/p/ignored/x.txt');
    expect(paths).toContain('/p/a.log');
    expect(paths.some((p) => p.startsWith('/p/.git/'))).toBe(true);
  });

  it('applies --exclude globs to the root-relative path', async () => {
    const { root } = await fixture();
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'x.js'), 'X');
    await mkdir(join(root, 'sub', 'node_modules'), { recursive: true });
    await writeFile(join(root, 'sub', 'node_modules', 'y.js'), 'Y');
    await mkdir(join(root, 'build'));
    await writeFile(join(root, 'build', 'out.js'), 'O');
    // A bare name matches only at the top level.
    let run = mock();
    await backupDirectory(run.client, 'd', root, '/p1', { exclude: ['node_modules'] });
    expect(run.puts.map((p) => p.path).sort()).toEqual([
      '/p1/a.txt',
      '/p1/build/out.js',
      '/p1/sub/b.txt',
      '/p1/sub/node_modules/y.js',
    ]);
    // A ** pattern matches at any depth.
    run = mock();
    await backupDirectory(run.client, 'd', root, '/p2', { exclude: ['**/node_modules'] });
    expect(run.puts.map((p) => p.path).sort()).toEqual([
      '/p2/a.txt',
      '/p2/build/out.js',
      '/p2/sub/b.txt',
    ]);
    // build/** matches everything under build/ at the top level only.
    run = mock();
    await backupDirectory(run.client, 'd', root, '/p3', { exclude: ['build/**'] });
    expect(run.puts.map((p) => p.path).sort()).toEqual([
      '/p3/a.txt',
      '/p3/node_modules/x.js',
      '/p3/sub/b.txt',
      '/p3/sub/node_modules/y.js',
    ]);
  });

  it('refuses a large backup without --yes and never uploads', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    await expect(backupDirectory(client, 'd', root, '/p', { maxFiles: 1 })).rejects.toThrow(
      /2 files.+--exclude.+--dry-run.+--yes/su,
    );
    expect(puts).toEqual([]);
    await expect(backupDirectory(client, 'd', root, '/p', { maxBytes: 1 })).rejects.toThrow(
      /--yes/u,
    );
    // Dry-run is exempt from the guard.
    const dry = await backupDirectory(client, 'd', root, '/p', { maxFiles: 0, dryRun: true });
    expect(dry.wouldUpload).toHaveLength(2);
    expect(puts).toEqual([]);
  });

  it('uploads over the threshold when --yes is passed', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    const result = await backupDirectory(client, 'd', root, '/p', { maxFiles: 1, yes: true });
    expect(result).toMatchObject({ uploaded: 2, failed: 0 });
    expect(puts).toHaveLength(2);
  });

  it('refuses to run when a live lock exists for the same prefix', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const lock = join(state, `backup-${key}.lock`);
    await writeFile(lock, String(process.pid));
    await expect(backupDirectory(mock().client, 'd', root, '/p')).rejects.toThrow(
      `another backup to /p is already running (pid ${process.pid})`,
    );
  });

  it('takes over a stale or unreadable lock and removes it at the end', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const lock = join(state, `backup-${key}.lock`);
    await writeFile(lock, '999999999');
    await expect(backupDirectory(mock().client, 'd', root, '/p')).resolves.toMatchObject({
      uploaded: 2,
    });
    await expect(lstat(lock)).rejects.toThrow();
    await writeFile(lock, 'not a pid');
    await expect(backupDirectory(mock().client, 'd', root, '/p')).resolves.toMatchObject({
      unchanged: 2,
    });
    await expect(lstat(lock)).rejects.toThrow();
  });

  it('does not take the lock on a dry run', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    await writeFile(join(state, `backup-${key}.lock`), String(process.pid));
    const result = await backupDirectory(mock().client, 'd', root, '/p', { dryRun: true });
    expect(result.wouldUpload).toHaveLength(2);
  });

  it('counts a 429 as a failed file and does not retry the put', async () => {
    const { root } = await fixture();
    let calls = 0;
    const client = {
      apiOrigin: 'https://x.test',
      putStream: async (_d: string, path: string) => {
        if (path.endsWith('a.txt')) {
          calls++;
          throw new AgentDriveApiError('rate_limited', 429, 'slow down', { retryAfter: 0 });
        }
        return { id: 'v' };
      },
    } as unknown as AgentDriveClient;
    const result = await backupDirectory(client, 'd', root, '/p');
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(calls).toBe(1);
  });

  it('prints a progress line on the injected interval', async () => {
    const { root } = await fixture();
    const client = {
      apiOrigin: 'https://x.test',
      putStream: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { id: 'v' };
      },
    } as unknown as AgentDriveClient;
    const lines: string[] = [];
    await backupDirectory(client, 'd', root, '/p', {
      progressIntervalMs: 5,
      log: (l) => lines.push(l),
    });
    expect(
      lines.some((l) =>
        /^backup progress \d+\/2 uploaded=\d+ unchanged=\d+ failed=\d+ [\d.]+ MB\/s$/u.test(l),
      ),
    ).toBe(true);
  });

  it('never runs more than four puts at once', async () => {
    const { root } = await fixture();
    for (let i = 0; i < 10; i++) await writeFile(join(root, `f${i}.txt`), `f${i}`);
    let inflight = 0;
    let max = 0;
    const client = {
      apiOrigin: 'https://x.test',
      putStream: async () => {
        inflight++;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return { id: 'v' };
      },
    } as unknown as AgentDriveClient;
    const result = await backupDirectory(client, 'd', root, '/p');
    expect(result).toMatchObject({ uploaded: 12, failed: 0 });
    expect(max).toBe(4);
  });

  it('still writes the manifest when a file fails mid-run', async () => {
    const { dir, root } = await fixture();
    const { client } = mock('a.txt');
    const result = await backupDirectory(client, 'd', root, '/p');
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const manifest = JSON.parse(await readFile(join(state, `backup-${key}.json`), 'utf8')) as {
      files: Record<string, string>;
    };
    expect(Object.keys(manifest.files)).toEqual(['sub/b.txt']);
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

  it('keeps its pid in the lock file for the whole run', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const lock = join(state, `backup-${key}.lock`);
    const seen: string[] = [];
    const client = {
      apiOrigin: 'https://x.test',
      putStream: async () => {
        seen.push((await readFile(lock, 'utf8')).trim());
        return { id: 'v' };
      },
    } as unknown as AgentDriveClient;
    await backupDirectory(client, 'd', root, '/p');
    expect(seen).toHaveLength(2);
    expect(seen.every((content) => content === String(process.pid))).toBe(true);
  });

  it('reclaims a lock with a live pid but a stale mtime', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    await mkdir(state, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const lock = join(state, `backup-${key}.lock`);
    await writeFile(lock, String(process.pid));
    const stale = new Date(Date.now() - 3 * 60 * 1000);
    await utimes(lock, stale, stale);
    await expect(backupDirectory(mock().client, 'd', root, '/p')).resolves.toMatchObject({
      uploaded: 2,
    });
    await expect(lstat(lock)).rejects.toThrow();
  });

  it('with gitignore, treats a root inside an ignored directory as all ignored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-backup-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'cfg', 'config.json'));
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    await writeFile(join(dir, '.gitignore'), 'ignored-root/\n');
    const root = join(dir, 'ignored-root');
    await mkdir(root);
    await writeFile(join(root, 'a.txt'), 'A');
    const { client, puts } = mock();
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      gitignore: true,
      log: (line) => lines.push(line),
    });
    expect(result.uploaded).toBe(0);
    expect(puts).toEqual([]);
    expect(lines.join('\n')).toContain('backup found 0 files');
  });

  it('with gitignore, fails closed when git exits non-zero', async () => {
    const { dir, root } = await fixture();
    const bin = join(dir, 'bin');
    await mkdir(bin);
    const fake = join(bin, 'git');
    await writeFile(fake, '#!/bin/sh\necho bogus >&2\nexit 42\n');
    await chmod(fake, 0o755);
    vi.stubEnv('PATH', bin);
    const { client, puts } = mock();
    await expect(backupDirectory(client, 'd', root, '/p', { gitignore: true })).rejects.toThrow(
      /could not read \.gitignore rules: /u,
    );
    expect(puts).toEqual([]);
  });

  it('with gitignore, backs up everything outside a work tree', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    await backupDirectory(client, 'd', root, '/p', { gitignore: true });
    expect(puts).toHaveLength(2);
  });

  it('skips a whole directory matched by an exclude glob, including hidden files', async () => {
    const { root } = await fixture();
    await mkdir(join(root, 'build'));
    await writeFile(join(root, 'build', '.env'), 'SECRET');
    await writeFile(join(root, 'build', 'out.js'), 'O');
    const { client, puts } = mock();
    await backupDirectory(client, 'd', root, '/p', { exclude: ['build/**'] });
    expect(puts.map((p) => p.path).sort()).toEqual(['/p/a.txt', '/p/sub/b.txt']);
  });

  it('fails a file that changed since the scan', async () => {
    const { root } = await fixture();
    const { client, puts } = mock();
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      log: (line) => {
        lines.push(line);
        if (line.startsWith('backup found'))
          appendFileSync(join(root, 'a.txt'), 'grew after the scan');
      },
    });
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(puts.map((p) => p.path)).toEqual(['/p/sub/b.txt']);
    expect(lines.join('\n')).toContain('file changed since the scan');
  });

  it('does not publish or record a file changed between hashing and upload', async () => {
    const { dir, root } = await fixture();
    const file = join(root, 'a.txt');
    const { client, puts } = mock(undefined, async (path) => {
      if (path === '/p/a.txt') await writeFile(file, 'B');
    });
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      log: (line) => lines.push(line),
    });

    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(puts.map((put) => put.path)).toEqual(['/p/sub/b.txt']);
    expect(lines.join('\n')).toContain('file changed since the scan');

    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const manifest = JSON.parse(await readFile(join(state, `backup-${key}.json`), 'utf8')) as {
      files: Record<string, string>;
    };
    expect(Object.keys(manifest.files)).toEqual(['sub/b.txt']);
  });

  it('counts a file it cannot stat during the scan as one failure', async () => {
    const { dir, root } = await fixture();
    // A path longer than PATH_MAX (1024 on macOS, 4096 on Linux) is listed by readdir but cannot
    // be lstat'ed. Each level stays below the limit; the renamed-in payload pushes past it.
    const levels = process.platform === 'linux' ? 20 : 4;
    let deep = root;
    for (let i = 0; i < levels; i++) {
      deep = join(deep, 'd'.repeat(200));
      await mkdir(deep);
    }
    const payload = join(dir, 'payload');
    await mkdir(payload);
    await writeFile(join(payload, `${'f'.repeat(200)}.txt`), 'X');
    await rename(payload, join(deep, 'payload'));
    const { client, puts } = mock();
    const lines: string[] = [];
    try {
      const result = await backupDirectory(client, 'd', root, '/p', {
        log: (line) => lines.push(line),
      });
      expect(result).toMatchObject({ uploaded: 2, failed: 1 });
      expect(puts).toHaveLength(2);
      expect(lines.join('\n')).toMatch(/failed .+payload/u);
    } finally {
      // Shorten the path again so cleanup can address it.
      await rename(join(root, 'd'.repeat(200)), join(root, 'cleanup'));
    }
  });

  it('returns the counts when the final manifest save fails', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    const manifest = join(state, `backup-${key}.json`);
    const { client } = mock();
    await backupDirectory(client, 'd', root, '/p');
    await rm(manifest);
    await mkdir(manifest);
    const lines: string[] = [];
    const result = await backupDirectory(client, 'd', root, '/p', {
      log: (line) => lines.push(line),
    });
    expect(result).toMatchObject({ uploaded: 2, failed: 1 });
    expect(lines.join('\n')).toContain('failed to save the backup manifest');
  });

  it('throttles manifest saves even when they fail', async () => {
    const { dir, root } = await fixture();
    const state = join(await realpath(dir), 'cfg', 'config.json.state');
    const key = createHash('sha256').update('https://x.test|d|/p').digest('hex');
    await mkdir(state, { recursive: true, mode: 0o700 });
    // A directory at the manifest path makes every save fail.
    await mkdir(join(state, `backup-${key}.json`));
    for (let i = 0; i < 10; i++) await writeFile(join(root, `f${i}.txt`), `f${i}`);
    const { client } = mock();
    const lines: string[] = [];
    await backupDirectory(client, 'd', root, '/p', { log: (line) => lines.push(line) });
    const saves = lines.filter((line) => line.startsWith('failed to save the backup manifest'));
    expect(saves).toHaveLength(2);
  });

  it.skipIf(process.getuid?.() === 0)(
    'reports progress with a numerator that only counts scanned files',
    async () => {
      const { root } = await fixture();
      await chmod(join(root, 'sub'), 0);
      const client = {
        apiOrigin: 'https://x.test',
        putStream: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return { id: 'v' };
        },
      } as unknown as AgentDriveClient;
      try {
        const lines: string[] = [];
        await backupDirectory(client, 'd', root, '/p', {
          progressIntervalMs: 5,
          log: (line) => lines.push(line),
        });
        const progress = lines.filter((line) => line.startsWith('backup progress '));
        expect(progress.length).toBeGreaterThan(0);
        for (const line of progress) {
          const [, done, total] = /progress (\d+)\/(\d+)/u.exec(line) ?? [];
          expect(Number(done)).toBeLessThanOrEqual(Number(total));
        }
      } finally {
        await chmod(join(root, 'sub'), 0o700);
      }
    },
  );
});

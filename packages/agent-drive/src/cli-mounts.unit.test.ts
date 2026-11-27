import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { writeConfig } from './config.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

type Saved = { keys: Record<string, string>; origins: Record<string, string> };

/** Runs the real CLI entry point in-process against a stubbed API. */
async function cli(
  argv: string[],
  saved: Saved,
  respond: (path: string, init?: RequestInit, search?: string) => unknown = (path) =>
    path === 'account-key' ? { accountKey: null } : {},
  env: Record<string, string> = {},
  dir?: string,
) {
  const configDir = dir ?? (await mkdtemp(join(tmpdir(), 'agent-drive-mounts-cmd-')));
  dirs.push(configDir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(configDir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: saved.keys,
    driveKeyOrigins: saved.origins,
    keyBackup: Object.fromEntries(
      Object.keys(saved.keys).map((id) => [id, { at: 'now', method: 'file' as const }]),
    ),
  });
  const paths: string[] = [];
  const calls: { path: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname.startsWith('/api/v1/')
        ? parsed.pathname.replace('/api/v1/', '')
        : `storage${parsed.pathname}`;
      paths.push(path);
      calls.push({ path, method: init?.method ?? 'GET' });
      const response = respond(path, init, parsed.search);
      if (response instanceof Response) return response;
      const hasAccountKey =
        response !== null &&
        typeof response === 'object' &&
        ('accountKey' in response || 'keyId' in response);
      const body = path === 'account-key' && !hasAccountKey ? { accountKey: null } : response;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true));
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', ...argv]);
  vi.resetModules();
  const mod = (await import('./cli.js')) as { done?: Promise<void> };
  await mod.done;
  const exitCode = process.exitCode;
  return {
    dir: configDir,
    get out() {
      return out.join('');
    },
    get err() {
      return err.join('');
    },
    paths,
    calls,
    exitCode,
  };
}

const one: Saved = { keys: { [A]: generateDriveKey() }, origins: { [A]: 'https://x.test' } };

function mountFakes() {
  const runLinuxMount = vi.fn(async () => {});
  const createMountBridge = vi.fn(async () => ({
    request: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  }));
  const startMacMount = vi.fn(async () => ({
    actualPath: '/mac/provider',
    requestedPath: '/requested',
    close: vi.fn(async () => {}),
    waitForExit: vi.fn(async () => ({ code: 0, signal: null })),
  }));
  vi.doMock('./mount.js', () => ({
    MOUNT_MAX_READ_BYTES: 1024 * 1024,
    MOUNT_MAX_WRITE_BYTES: 1024 * 1024,
    createMountBridge,
    resolveMountHelper: () => '/synthetic/agent-drive-mount',
    runLinuxMount,
  }));
  vi.doMock('./mount-mac.js', () => ({ startMacMount }));
  const whoami = (path: string) =>
    path === 'whoami'
      ? {
          accountId: 'account',
          agentId: 'agent',
          keyId: 'key',
          scopes: ['read', 'write'],
          driveIds: [A],
        }
      : {};
  return { runLinuxMount, createMountBridge, startMacMount, whoami };
}

describe('mounts add', () => {
  it('registers an entry offline and prints it as JSON', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const r = await cli(['mounts', 'add', 'work', mp, '--drive', A], one);
    expect(r.err).toBe('');
    const entry = JSON.parse(r.out) as Record<string, unknown>;
    expect(entry).toMatchObject({
      name: 'work',
      mountpoint: mp,
      driveId: A,
      apiUrl: 'https://x.test/api',
      readOnly: false,
    });
    // Registration is fully local: no API request of any kind was made.
    expect(r.paths).toEqual([]);
  });

  it('preserves --read-only and --sandbox verbatim', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const r = await cli(
      ['mounts', 'add', 'work', mp, '--drive', A, '--read-only', '--sandbox', 'sbx-abc_1'],
      one,
    );
    expect(r.err).toBe('');
    expect(JSON.parse(r.out)).toMatchObject({ readOnly: true, sandboxId: 'sbx-abc_1' });
    expect(r.paths).toEqual([]);
  });

  it('records an explicit --api account context', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const r = await cli(
      ['mounts', 'add', 'work', mp, '--drive', A, '--api', 'https://x.test/api'],
      one,
    );
    expect(JSON.parse(r.out)).toMatchObject({ apiUrl: 'https://x.test/api' });
  });

  it('requires NAME and MOUNTPOINT', async () => {
    const r = await cli(['mounts', 'add', 'work'], one);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('Usage: mounts add NAME MOUNTPOINT');
    expect(r.paths).toEqual([]);
  });

  it('rejects a drive that is not authorized on this machine for that origin', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const foreign: Saved = {
      keys: { [A]: generateDriveKey() },
      origins: { [A]: 'https://other.test' },
    };
    const r = await cli(['mounts', 'add', 'work', mp, '--drive', A], foreign);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain(`No saved drive key for ${A} on https://x.test`);
    expect(r.paths).toEqual([]);
    const list = await cli(['mounts', 'list'], foreign, undefined, {}, r.dir);
    expect(JSON.parse(list.out)).toEqual([]);
  });

  it('rejects duplicate names and mountpoints atomically', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    const mp2 = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'second');
    dirs.push(mp, mp2);
    const first = await cli(['mounts', 'add', 'work', mp, '--drive', A], one);
    const sameName = await cli(
      ['mounts', 'add', 'work', mp2, '--drive', A],
      one,
      undefined,
      {},
      first.dir,
    );
    expect(sameName.exitCode).toBe(1);
    expect(sameName.err).toContain(`A mount named 'work' is already registered`);
    const samePoint = await cli(
      ['mounts', 'add', 'other', mp, '--drive', A],
      one,
      undefined,
      {},
      first.dir,
    );
    expect(samePoint.exitCode).toBe(1);
    expect(samePoint.err).toContain('already registered');
    const list = await cli(['mounts', 'list'], one, undefined, {}, first.dir);
    expect((JSON.parse(list.out) as unknown[]).length).toBe(1);
  });

  it('rejects flags the registry never stores, like a delegated command string', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const r = await cli(['mounts', 'add', 'work', mp, '--drive', A, '--force'], one);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('Unsupported mounts option');
    expect(r.paths).toEqual([]);
  });
});

describe('mounts list and status', () => {
  it('lists registered entries without touching the API or a mount helper', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const first = await cli(['mounts', 'add', 'work', mp, '--drive', A, '--sandbox', 'sbx-1'], one);
    const r = await cli(['mounts', 'list'], one, undefined, {}, first.dir);
    expect(r.err).toBe('');
    const entries = JSON.parse(r.out) as Record<string, unknown>[];
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ name: 'work', mountpoint: mp, sandboxId: 'sbx-1' });
    expect(r.paths).toEqual([]);
  });

  it('lists an empty registry as []', async () => {
    const r = await cli(['mounts', 'list'], one);
    expect(r.err).toBe('');
    expect(JSON.parse(r.out)).toEqual([]);
    expect(r.paths).toEqual([]);
  });

  it('reports filesystem state per mountpoint without spinning anything up', async () => {
    const base = await mkdtemp(join(tmpdir(), 'agent-drive-mp-'));
    const real = join(base, 'real');
    const link = join(base, 'link');
    const free = join(base, 'free');
    dirs.push(base);
    await mkdir(real);
    await symlink(real, link);
    const seeded = await cli(['mounts', 'add', 'work', real, '--drive', A], one);
    await cli(['mounts', 'add', 'linked', link, '--drive', A], one, undefined, {}, seeded.dir);
    await cli(['mounts', 'add', 'absent', free, '--drive', A], one, undefined, {}, seeded.dir);
    const r = await cli(['mounts', 'status'], one, undefined, {}, seeded.dir);
    expect(r.err).toBe('');
    const entries = JSON.parse(r.out) as {
      name: string;
      filesystem: { state: string; target?: string };
    }[];
    expect(entries.map((entry) => [entry.name, entry.filesystem.state])).toEqual([
      ['work', 'directory'],
      ['linked', 'symlink'],
      ['absent', 'free'],
    ]);
    expect(entries[1]?.filesystem.target).toBe(real);
    expect(r.paths).toEqual([]);
  });

  it('filters status by name and rejects an unknown name', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const seeded = await cli(['mounts', 'add', 'work', mp, '--drive', A], one);
    const one_ = await cli(['mounts', 'status', 'work'], one, undefined, {}, seeded.dir);
    expect((JSON.parse(one_.out) as unknown[]).length).toBe(1);
    const missing = await cli(['mounts', 'status', 'nope'], one, undefined, {}, seeded.dir);
    expect(missing.exitCode).toBe(1);
    expect(missing.err).toContain(`No mount registered as 'nope'`);
  });

  it('rejects unknown mounts subcommands with a usage line', async () => {
    const r = await cli(['mounts', 'frobnicate'], one);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('Usage: mounts');
    expect(r.paths).toEqual([]);
  });

  it('confines --sandbox to mounts add and keeps --read-only off unrelated commands', async () => {
    const r = await cli(['ls', '--sandbox', 'sbx-1'], one);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('--sandbox is only supported by `mounts add`');
    const ro = await cli(['ls', '--read-only'], one);
    expect(ro.exitCode).toBe(1);
    expect(ro.err).toContain('--read-only');
  });
});

describe('mount --name', () => {
  it('mounts a registered entry with its mountpoint, drive and read-only flag', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const { runLinuxMount, createMountBridge, startMacMount, whoami } = mountFakes();
    const seeded = await cli(
      ['mounts', 'add', 'work', mp, '--drive', A, '--read-only'],
      one,
      whoami,
    );
    const r = await cli(['mount', '--name', 'work'], one, whoami, {}, seeded.dir);
    expect(r.err).toBe('');
    expect(createMountBridge).toHaveBeenCalledWith(
      expect.anything(),
      A,
      expect.objectContaining({
        capabilities: expect.objectContaining({ readOnly: true, write: false }),
      }),
    );
    if (process.platform === 'darwin') {
      expect(startMacMount).toHaveBeenCalledWith(
        expect.objectContaining({ driveId: A, requestedMountpoint: mp }),
      );
      expect(runLinuxMount).not.toHaveBeenCalled();
    } else {
      expect(runLinuxMount).toHaveBeenCalledWith(
        expect.anything(),
        A,
        mp,
        expect.objectContaining({ readWrite: false }),
      );
      expect(startMacMount).not.toHaveBeenCalled();
    }
  });

  it('rejects conflicting --drive and positional arguments instead of overriding the entry', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const two: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://x.test' },
    };
    const seeded = await cli(['mounts', 'add', 'work', mp, '--drive', A], two);
    const conflict = await cli(
      ['mount', '--name', 'work', '--drive', B],
      two,
      undefined,
      {},
      seeded.dir,
    );
    expect(conflict.exitCode).toBe(1);
    expect(conflict.err).toContain('--drive does not match');
    expect(conflict.paths).toEqual([]);
    const positional = await cli(
      ['mount', '--name', 'work', '/elsewhere'],
      two,
      undefined,
      {},
      seeded.dir,
    );
    expect(positional.exitCode).toBe(1);
    expect(positional.err).toContain('Usage: mount');
  });

  it('rejects an unregistered name before any API call', async () => {
    const r = await cli(['mount', '--name', 'ghost'], one);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain(`No mount registered as 'ghost'`);
    expect(r.paths).toEqual([]);
  });

  it('keeps the plain positional mount flow unchanged', async () => {
    const mp = join(await mkdtemp(join(tmpdir(), 'agent-drive-mp-')), 'mount');
    dirs.push(mp);
    const { createMountBridge, whoami } = mountFakes();
    const r = await cli(['mount', mp, '--drive', A], one, whoami);
    expect(r.err).toBe('');
    expect(createMountBridge).toHaveBeenCalledWith(
      expect.anything(),
      A,
      expect.objectContaining({ capabilities: expect.objectContaining({ write: true }) }),
    );
  });
});

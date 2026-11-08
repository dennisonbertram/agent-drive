import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { writeConfig } from './config.js';
import { issueCredentials } from './credentials.js';

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
async function cli(argv: string[], saved: Saved, respond: (path: string) => unknown = () => ({})) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cmd-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
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
  const queries: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      const path = new URL(String(url)).pathname.replace('/api/v1/', '');
      paths.push(path);
      queries.push(new URL(String(url)).search);
      return new Response(JSON.stringify(respond(path)), {
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
  await import('./cli.js');
  await vi.waitFor(() => expect(out.length + err.length).toBeGreaterThan(0), { timeout: 3000 });
  return { out: out.join(''), err: err.join(''), paths, queries };
}

const one: Saved = { keys: { [A]: generateDriveKey() }, origins: { [A]: 'https://x.test' } };
const version = { id: 'v1', path: '/a.md', wrappedKey: 'WRAPPED', downloadUrl: 'https://s3/x' };

describe('drive default at the command level', () => {
  it('ls uses the only drive key saved for this origin, and hides wrapped keys', async () => {
    const r = await cli(['ls'], one, () => ({ items: [version], nextCursor: null }));
    expect(r.err).toBe('');
    expect(r.paths[0]).toContain(`drives/${A}/list`);
    expect(r.out).toContain('"/a.md"');
    expect(r.out).not.toContain('WRAPPED');
    expect(r.out).not.toContain('downloadUrl');
  });

  it('ls --folder/--sort send delimiter and sort and print folder rows; plain ls sends neither', async () => {
    const folder = {
      kind: 'folder',
      path: '/reports',
      items: 2,
      ciphertext_size: '12',
      created_at: 't',
    };
    const r = await cli(['ls', '--folder', '/', '--sort', 'modified', '--limit', '5'], one, () => ({
      items: [folder, { ...version, id: 'f1', version_id: 'v1', ciphertext_size: 1 }],
      nextCursor: null,
    }));
    expect(r.err).toBe('');
    expect(r.queries[0]).toContain('delimiter=%2F');
    expect(r.queries[0]).toContain('prefix=%2F');
    expect(r.queries[0]).toContain('sort=modified');
    expect(r.queries[0]).toContain('limit=5');
    expect(r.out).toContain('"kind":"folder"');
    expect(r.out).toContain('"items":2');
    expect(r.out).not.toContain('WRAPPED');
    const plain = await cli(['ls'], one, () => ({ items: [], nextCursor: null }));
    expect(plain.queries[0]).not.toContain('delimiter');
    expect(plain.queries[0]).not.toContain('sort=');
    const flat = await cli(['ls', '--sort', 'modified', '--prefix', '/a'], one, () => ({
      items: [],
      nextCursor: null,
    }));
    expect(flat.queries[0]).toContain('sort=modified');
    expect(flat.queries[0]).toContain('prefix=%2Fa');
    expect(flat.queries[0]).not.toContain('delimiter');
    const explicitPath = await cli(['ls', '--sort', 'path', '--prefix', '/a'], one, () => ({
      items: [],
      nextCursor: null,
    }));
    expect(explicitPath.queries[0]).toBe('?prefix=%2Fa');
    const both = await cli(['ls', '--folder', '/a', '--prefix', '/b'], one);
    expect(both.err).toContain('either --folder or --prefix');
    const bad = await cli(['ls', '--sort', 'size'], one);
    expect(bad.err).toContain('--sort must be path or modified');
    expect(bad.paths).toEqual([]);
  });

  it('versions hides wrapped keys too', async () => {
    const r = await cli(['versions', '/a.md', '--drive', A], one, () => ({
      items: [version],
      nextCursor: null,
    }));
    expect(r.out).toContain('"v1"');
    expect(r.out).not.toContain('WRAPPED');
  });

  it('lists the configured ids when there are two keys', async () => {
    const two: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://x.test' },
    };
    const r = await cli(['ls'], two);
    expect(r.err).toContain('--drive ID is required');
    expect(r.err).toContain(A);
    expect(r.err).toContain(B);
    expect(r.paths).toEqual([]);
  });

  it('ignores a key saved for another origin', async () => {
    const r = await cli(['ls'], { keys: one.keys, origins: { [A]: 'https://other.test' } });
    expect(r.err).toContain('--drive ID is required');
    expect(r.paths).toEqual([]);
  });

  it('check keeps its own selection: a key authorized for B is checked, not the saved key for A', async () => {
    vi.stubEnv(
      `AGENT_DRIVE_KEY_${B.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`,
      generateDriveKey(),
    );
    const r = await cli(['check'], one, (path) =>
      path === 'whoami'
        ? { accountId: 'a', agentId: 'g', keyId: 'k', scopes: ['read'], driveIds: [B] }
        : { items: [], nextCursor: null },
    );
    expect(r.err).not.toContain(`drive ${A}`);
    expect(r.paths.some((p) => p.includes(`drives/${B}/`))).toBe(true);
    expect(r.paths.some((p) => p.includes(`drives/${A}/`))).toBe(false);
  });

  it('backup uses the current-origin key and ignores a foreign one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-bk-'));
    dirs.push(dir);
    await writeFile(join(dir, 'f.txt'), 'x');
    const mixed: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://other.test' },
    };
    const r = await cli(['backup', dir, '--dry-run'], mixed);
    expect(r.err).not.toContain('--drive ID is required');
    const foreign = await cli(['backup', dir, '--dry-run'], {
      keys: { [B]: generateDriveKey() },
      origins: { [B]: 'https://other.test' },
    });
    expect(foreign.err).toContain('--drive ID is required');
  });
});

describe('credentials issue drive default', () => {
  const sink = { isTTY: false, write: async () => {} };
  async function prepare(origins: Record<string, string>, keys: string[]) {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-iss-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    vi.stubEnv('AGENT_DRIVE_KEY', '');
    await writeConfig({
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: Object.fromEntries(keys.map((id) => [id, generateDriveKey()])),
      driveKeyOrigins: origins,
    });
  }
  const createKey = vi.fn(async () => ({ id: 'k1', token: 'newtok' }));

  it('rejects when only a foreign-origin key exists', async () => {
    await prepare({ [B]: 'https://other.test' }, [B]);
    await expect(
      issueCredentials({ name: 'n', stdout: true }, sink, createKey as never),
    ).rejects.toThrow(/--drive ID is required/);
  });

  it('picks the one current-origin key beside a foreign one', async () => {
    await prepare({ [A]: 'https://x.test', [B]: 'https://other.test' }, [A, B]);
    await issueCredentials({ name: 'n', stdout: true }, sink, createKey as never);
    expect((createKey.mock.calls as unknown[][])[0]?.[2]).toEqual([A]);
  });
});

describe('capture command', () => {
  async function capture(
    argv: string[],
    options: { saved?: Saved | 'none'; env?: Record<string, string> } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-capture-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    for (const name of [
      'AGENT_DRIVE_CREDENTIALS',
      'AGENT_DRIVE_API_URL',
      'AGENT_DRIVE_API_KEY',
      'AGENT_DRIVE_KEY',
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
    ])
      vi.stubEnv(name, '');
    for (const [name, value] of Object.entries(options.env ?? {})) vi.stubEnv(name, value);
    const saved = options.saved ?? one;
    if (saved !== 'none')
      await writeConfig({
        apiUrl: 'https://x.test/api',
        apiKey: 'tok',
        driveKeys: saved.keys,
        driveKeyOrigins: saved.origins,
      });
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true));
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', 'capture', ...argv]);
    process.exitCode = undefined;
    vi.resetModules();
    await import('./cli.js');
    await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined(), { timeout: 15_000 });
    return { err: err.join(''), dir, code: process.exitCode };
  }
  const dumpEnv = (file: string, code = 0) => [
    process.execPath,
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(process.env)); process.exit(${code})`,
  ];
  const disabled = (err: string) =>
    err.split('\n').filter((l) => l.startsWith('capture disabled:'));

  it('runs the child with both base URLs, passes its exit code, and leaves the parent env alone', async () => {
    const file = join(tmpdir(), `capture-env-${Date.now()}.json`);
    dirs.push(file);
    const r = await capture(['--drive', A, '--', ...dumpEnv(file, 3)]);
    expect(r.code).toBe(3);
    const env = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/anthropic$/u);
    expect(env.OPENAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/openai$/u);
    expect(process.env.ANTHROPIC_BASE_URL).toBe('');
    expect(process.env.OPENAI_BASE_URL).toBe('');
    expect(disabled(r.err)).toEqual([]);
    expect(r.err).toMatch(/capture: 0 uploaded, 0 queued .* 0 not captured \(none\), 0 invalid/u);
  });

  it('completely unconfigured: the child still runs, with one capture disabled line', async () => {
    const file = join(tmpdir(), `capture-env-u-${Date.now()}.json`);
    dirs.push(file);
    const r = await capture(['--', ...dumpEnv(file, 0)], { saved: 'none' });
    expect(r.code).toBe(0);
    const env = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL ?? '').toBe('');
    expect(disabled(r.err).length).toBe(1);
    expect(disabled(r.err)[0]).toContain('API configuration is missing');
  });

  it('configured but no drive key: the child runs unwrapped with one capture disabled line', async () => {
    const r = await capture(['--drive', B, '--', process.execPath, '-e', 'process.exit(0)']);
    expect(r.code).toBe(0);
    expect(disabled(r.err).length).toBe(1);
    expect(disabled(r.err)[0]).toContain('no drive key');
  });

  it('does not override an existing provider setting', async () => {
    const file = join(tmpdir(), `capture-env-o-${Date.now()}.json`);
    dirs.push(file);
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    const argsFile = join(bin, 'args.json');
    for (const name of ['claude', 'codex']) {
      await writeFile(
        join(bin, name),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify({argv: process.argv.slice(2), env: process.env}));\n`,
        { mode: 0o755 },
      );
    }
    const claude = await capture(['--drive', A, '--', join(bin, 'claude'), 'hi'], {
      env: { ANTHROPIC_BASE_URL: 'http://gateway.test' },
    });
    expect(disabled(claude.err).length).toBe(1);
    expect(disabled(claude.err)[0]).toContain('ANTHROPIC_BASE_URL is already set');
    const seen = JSON.parse(await readFile(argsFile, 'utf8')) as { env: Record<string, string> };
    expect(seen.env.ANTHROPIC_BASE_URL).toBe('http://gateway.test');
    const codex = await capture(['--drive', A, '--', join(bin, 'codex'), 'exec'], {
      env: { OPENAI_BASE_URL: 'http://gateway.test' },
    });
    expect(disabled(codex.err).length).toBe(1);
    const profile = await capture(['--drive', A, '--', join(bin, 'codex'), '--profile', 'work']);
    expect(disabled(profile.err)[0]).toContain('--profile');
    expect((JSON.parse(await readFile(argsFile, 'utf8')) as { argv: string[] }).argv).toEqual([
      '--profile',
      'work',
    ]);
  });

  it('prepends the six provider flags for codex', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    const argsFile = join(bin, 'args.json');
    await writeFile(
      join(bin, 'codex'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const r = await capture(['--drive', A, '--', join(bin, 'codex'), 'exec', 'hello']);
    expect(r.code).toBe(0);
    const argv = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
    expect(argv.filter((a) => a === '-c').length).toBe(6);
    expect(argv.slice(-2)).toEqual(['exec', 'hello']);
    expect(argv).toContain('model_provider="agent_drive_capture"');
    expect(argv.some((a) => /base_url="http:\/\/127\.0\.0\.1:\d+\/openai\/v1"/u.test(a))).toBe(
      true,
    );
  });

  it('rejects a missing -- and an invalid --agent without running anything', async () => {
    const noSeparator = await capture(['--drive', A, 'echo']);
    expect(noSeparator.code).toBe(1);
    expect(noSeparator.err).toContain('Usage: capture');
    const bad = await capture(['--agent', 'Bad Name', '--', process.execPath, '-e', '0']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('--agent');
  });

  it('does not print a codex override value', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    await writeFile(join(bin, 'codex'), `#!${process.execPath}\n`, { mode: 0o755 });
    const r = await capture([
      '--drive',
      A,
      '--',
      join(bin, 'codex'),
      '-c',
      'model_providers.foo.experimental_bearer_token="SECRET-VALUE"',
    ]);
    expect(disabled(r.err).length).toBe(1);
    expect(r.err).not.toContain('SECRET-VALUE');
    expect(disabled(r.err)[0]).toContain('model_providers.foo.experimental_bearer_token');
  });

  it('runs the child when --help comes after --', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-help-'));
    dirs.push(dir);
    const marker = join(dir, 'ran.json');
    const script = join(dir, 'child.js');
    await writeFile(
      script,
      `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2))); process.exit(5);`,
    );
    const r = await capture(['--drive', A, '--', process.execPath, script, '--help']);
    expect(r.code).toBe(5);
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual(['--help']);
  });
});

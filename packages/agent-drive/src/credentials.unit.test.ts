import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { readConfig, resolveConnection, writeConfig } from './config.js';
import {
  decodeBundle,
  encodeBundle,
  confirmCredentials,
  exportCredentials,
  importCredentials,
  reportEnvBackups,
  loadConfig,
  reportKeyBackup,
  unbackedUp,
} from './credentials.js';
import { runCheck } from './check.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  const key = generateDriveKey();
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: { d1: key },
    driveKeyOrigins: { d1: 'https://x.test' },
  });
  return { dir, key };
}

const io = (isTTY: boolean) => {
  const out: string[] = [];
  return { isTTY, write: async (s: string) => void out.push(s), out };
};

describe('bundle', () => {
  it('round-trips', () => {
    const b = {
      v: 1 as const,
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: { d1: 'k' },
      driveKeyOrigins: { d1: 'https://x.test' },
    };
    const text = encodeBundle(b);
    expect(text.startsWith('adcred1.')).toBe(true);
    expect(decodeBundle(`${text}\n`)).toEqual(b);
    expect(() => decodeBundle('nope')).toThrow(/bundle/);
  });
});

describe('export', () => {
  it('refuses --stdout on a TTY and prints the bundle otherwise', async () => {
    await setup();
    await expect(exportCredentials({ stdout: true }, io(true))).rejects.toThrow(/terminal/);
    const pipe = io(false);
    const result = await exportCredentials({ stdout: true }, pipe);
    expect(result.method).toBe('stdout');
    expect(decodeBundle(pipe.out.join('')).apiKey).toBe('tok');
    // --stdout alone does not record a backup: only `credentials confirm` does.
    expect((await readConfig()).keyBackup?.d1).toBeUndefined();
    await confirmCredentials('stdout');
    expect((await readConfig()).keyBackup?.d1?.method).toBe('stdout');
  });

  it('fails when stdout cannot be written (EPIPE)', async () => {
    await setup();
    const broken = {
      isTTY: false,
      write: async () => {
        throw new Error('EPIPE');
      },
    };
    await expect(exportCredentials({ stdout: true }, broken)).rejects.toThrow(/EPIPE/);
    expect((await readConfig()).keyBackup?.d1).toBeUndefined();
  });

  it('refuses to write through a symlink and never follows it', async () => {
    const { dir } = await setup();
    const victim = join(dir, 'victim');
    await writeFile(victim, 'keep', { mode: 0o644 });
    const link = join(dir, 'link');
    await symlink(victim, link);
    await expect(exportCredentials({ to: link, force: true }, io(true))).rejects.toThrow(/symlink/);
    expect(await readFile(victim, 'utf8')).toBe('keep');
    expect((await stat(victim)).mode & 0o777).toBe(0o644);
  });

  it('writes --to with mode 600, refuses an existing path, and --force overwrites', async () => {
    const { dir } = await setup();
    const path = join(dir, 'bundle');
    const quiet = io(true);
    await exportCredentials({ to: path }, quiet);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(quiet.out.join('')).not.toContain('tok');
    await expect(exportCredentials({ to: path }, quiet)).rejects.toThrow(/exists/);
    await exportCredentials({ to: path, force: true }, quiet);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readConfig()).keyBackup?.d1?.method).toBe('file');
  });
});

describe('import', () => {
  it('merges into the existing config and records the backup', async () => {
    const { dir, key } = await setup();
    const other = generateDriveKey();
    await importCredentials(
      encodeBundle({
        v: 1,
        apiUrl: 'https://x.test/api',
        apiKey: 'new',
        driveKeys: { d2: other },
        driveKeyOrigins: { d2: 'https://x.test' },
      }),
      'file',
    );
    const config = await readConfig();
    expect(config.apiKey).toBe('new');
    expect(config.driveKeys).toEqual({ d1: key, d2: other });
    expect(config.keyBackup?.d2?.method).toBe('file');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AGENT_DRIVE_CREDENTIALS', () => {
  it('is merged in memory only and counts as backed up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    const configFile = join(dir, 'config.json');
    vi.stubEnv('AGENT_DRIVE_CONFIG', configFile);
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    const key = generateDriveKey();
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://env.test/api',
        apiKey: 'envtok',
        driveKeys: { e1: key },
        driveKeyOrigins: { e1: 'https://env.test' },
      }),
    );
    const connection = await resolveConnection();
    expect(connection.apiKey).toBe('envtok');
    expect(connection.config.driveKeys?.e1).toBe(key);
    expect(unbackedUp(await loadConfig(), ['e1'])).toEqual([]);
    await writeConfig({ driveKeys: { other: generateDriveKey() } });
    expect(await readFile(configFile, 'utf8')).not.toContain('envtok');
    expect(await readFile(configFile, 'utf8')).not.toContain(key);
  });

  it('loses to explicit environment variables', async () => {
    await setup();
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'explicit');
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://e/api',
        apiKey: 'b',
        driveKeys: {},
        driveKeyOrigins: {},
      }),
    );
    expect((await resolveConnection()).apiKey).toBe('explicit');
  });
});

describe('login replacing the API key', () => {
  it('clears backup records, which describe a stale bundle', async () => {
    await setup();
    await exportCredentials({ to: join(dirs[0]!, 'b') }, io(true));
    expect((await readConfig()).keyBackup?.d1).toBeTruthy();
    expect(await writeConfig({ apiKey: 'tok' })).toEqual({ backupsCleared: false });
    expect((await readConfig()).keyBackup?.d1).toBeTruthy();
    expect(await writeConfig({ apiKey: 'new' })).toEqual({ backupsCleared: true });
    expect((await readConfig()).keyBackup).toBeUndefined();
  });
});

describe('env bundle reporting', () => {
  it('reports only drives whose effective key and origin match the bundle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    const [a, b, c, d] = [1, 2, 3, 4].map(() => generateDriveKey());
    await writeConfig({ driveKeys: { b: generateDriveKey() } });
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://x.test/api',
        apiKey: 'k',
        driveKeys: { a: a!, b: b!, c: c!, d: d! },
        driveKeyOrigins: {
          a: 'https://x.test',
          b: 'https://x.test',
          c: 'https://other.test',
          d: 'https://x.test',
        },
      }),
    );
    vi.stubEnv('AGENT_DRIVE_KEY_D', generateDriveKey());
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await reportEnvBackups('https://x.test/api', 'k', {
      fetch: fetcher as unknown as typeof fetch,
    });
    const urls = fetcher.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(urls).toEqual(['https://x.test/api/v1/drives/a/key-backup']);
  });
});

describe('enforcement and reporting', () => {
  it('does not send the token to an insecure URL', async () => {
    const warn: string[] = [];
    const fetcher = vi.fn(async () => new Response('', { status: 200 }));
    await reportKeyBackup('http://evil.test/api', 'tok', ['d1'], 'file', {
      fetch: fetcher as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(warn.join('')).toMatch(/d1/);
  });

  it('lists drives with no backup record', async () => {
    const { key } = await setup();
    expect(unbackedUp(await loadConfig(), ['d1'])).toEqual(['d1']);
    await exportCredentials({ to: join(dirs[0]!, 'b') }, io(true));
    expect(unbackedUp(await loadConfig(), ['d1'])).toEqual([]);
    expect(key).toBeTruthy();
  });

  it('only warns when the report endpoint fails', async () => {
    const warn: string[] = [];
    const fail = vi.fn(async () => new Response('', { status: 404 }));
    await reportKeyBackup('https://x.test/api', 'tok', ['d1'], 'file', {
      fetch: fail as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(warn.join('')).toMatch(/d1/);
    expect(fail).toHaveBeenCalledWith(
      'https://x.test/api/v1/drives/d1/key-backup',
      expect.objectContaining({ method: 'POST' }),
    );
    const boom = vi.fn(async () => {
      throw new Error('net');
    });
    await reportKeyBackup('https://x.test/api', 'tok', ['d1'], 'env', {
      fetch: boom as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(warn).toHaveLength(2);
  });
});

void runCheck;
void writeFile;

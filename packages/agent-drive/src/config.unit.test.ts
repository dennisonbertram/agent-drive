import { chmod, mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { encodeBundle } from './credentials.js';
import {
  configPath,
  DEFAULT_API_URL,
  readConfig,
  resolveConnection,
  resolveDriveKey,
  resolveLoginApiUrl,
  resolveDriveId,
  writeConfig,
} from './config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function isolatedConfig() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-config-'));
  temporaryDirectories.push(directory);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(directory, 'config.json'));
  return directory;
}

describe('private CLI configuration', () => {
  it('writes the config directory and file with private permissions', async () => {
    const directory = await isolatedConfig();
    const nestedDirectory = join(directory, 'new', 'agent-drive');
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(nestedDirectory, 'config.json'));
    await writeConfig({ apiUrl: 'http://127.0.0.1:3000', apiKey: 'token' });
    expect(configPath()).toBe(join(nestedDirectory, 'config.json'));
    expect((await stat(nestedDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('refuses to discard malformed configuration', async () => {
    await isolatedConfig();
    const path = configPath();
    await writeFile(path, '{not json');
    await chmod(path, 0o600);
    await expect(readConfig()).rejects.toThrow('malformed');
    await expect(writeConfig({ apiKey: 'replacement' })).rejects.toThrow('malformed');
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });

  it('merges concurrent drive-key patches without losing existing keys', async () => {
    await isolatedConfig();
    await writeConfig({ apiUrl: 'https://drive.example', apiKey: 'token' });
    await writeConfig({ driveKeys: { existing: 'existing-key' } });

    await Promise.all([
      writeConfig({ driveKeys: { driveA: 'key-a' } }),
      writeConfig({ driveKeys: { driveB: 'key-b' } }),
    ]);

    await expect(readConfig()).resolves.toMatchObject({
      apiUrl: 'https://drive.example',
      apiKey: 'token',
      driveKeys: {
        existing: 'existing-key',
        driveA: 'key-a',
        driveB: 'key-b',
      },
    });
  });

  it('keeps and drops drive-key sources with the values they describe', async () => {
    await isolatedConfig();
    await writeConfig({
      driveKeys: { driveA: 'key-a', driveB: 'key-b' },
      driveKeySources: { driveA: 'grant', driveB: 'grant' },
    });
    // A new value without a new source drops the stale one; a value written with its own
    // source keeps it, and an unchanged key keeps its source too.
    await writeConfig({ driveKeys: { driveA: 'key-a2' } });
    await writeConfig({ driveKeys: { driveB: 'key-b2' }, driveKeySources: { driveB: 'bundle' } });
    const config = await readConfig();
    expect(config.driveKeys).toEqual({ driveA: 'key-a2', driveB: 'key-b2' });
    expect(config.driveKeySources).toEqual({ driveB: 'bundle' });
  });

  it('does not release a live SQLite lock when a same-process writer opens the lock file', async () => {
    await isolatedConfig();
    const lockDbPath = `${configPath()}.lock.sqlite`;
    const legacyLock = `${configPath()}.lock`;
    await mkdir(legacyLock, { mode: 0o700 });

    const firstWrite = writeConfig({ driveKeys: { first: 'first-key' } });
    firstWrite.catch(() => {});
    const probeScript = [
      "import { DatabaseSync } from 'node:sqlite';",
      'const db = new DatabaseSync(process.env.AGENT_DRIVE_LOCK_DB);',
      "db.exec('PRAGMA busy_timeout = 0');",
      "try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); process.stdout.write('free'); }",
      "catch (error) { if (error.errcode === 5 || error.errcode === 6) process.stdout.write('busy'); else throw error; }",
      'db.close();',
    ].join('\n');
    const waitForBusyLock = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const probe = spawnSync(process.execPath, ['--input-type=module', '-e', probeScript], {
          env: { ...process.env, AGENT_DRIVE_LOCK_DB: lockDbPath },
          encoding: 'utf8',
          timeout: 2_000,
        });
        if (probe.status === 0 && probe.stdout === 'busy') return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      throw new Error('The first config writer did not acquire the SQLite lock.');
    };

    const contenderScript = [
      "import { DatabaseSync } from 'node:sqlite';",
      'const db = new DatabaseSync(process.env.AGENT_DRIVE_LOCK_DB);',
      "db.exec('PRAGMA busy_timeout = 0');",
      "process.stdout.write('ready\\n');",
      'function contend() {',
      "  try { db.exec('BEGIN IMMEDIATE'); process.stdout.write('acquired\\n'); }",
      '  catch (error) { if (error.errcode === 5 || error.errcode === 6) { setTimeout(contend, 1); return; } throw error; }',
      "  process.stdin.once('data', () => { db.exec('ROLLBACK'); db.close(); process.exit(0); });",
      '}',
      'contend();',
    ].join('\n');
    let contender: ReturnType<typeof spawn> | undefined;
    let contenderExit: ReturnType<typeof once> | undefined;
    let contenderOutput = '';
    let secondWrite: Promise<unknown> | undefined;
    try {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await waitForBusyLock();
      contender = spawn(process.execPath, ['--input-type=module', '-e', contenderScript], {
        env: { ...process.env, AGENT_DRIVE_LOCK_DB: lockDbPath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const contenderStdout = contender.stdout;
      if (!contenderStdout) throw new Error('The SQLite contender has no stdout pipe.');
      contenderStdout.setEncoding('utf8');
      contenderStdout.on('data', (chunk: string) => {
        contenderOutput += chunk;
      });
      contenderExit = once(contender, 'exit');
      await vi.waitFor(() => expect(contenderOutput).toContain('ready'), { timeout: 5_000 });

      secondWrite = writeConfig({ driveKeys: { second: 'second-key' } });
      secondWrite.catch(() => {});
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      const acquiredWhileFirstWriterWaited = contenderOutput.includes('acquired');

      contender.kill('SIGKILL');
      await contenderExit;
      await rmdir(legacyLock);
      await Promise.all([firstWrite, secondWrite]);

      expect(acquiredWhileFirstWriterWaited).toBe(false);
      await expect(readConfig()).resolves.toMatchObject({
        driveKeys: { first: 'first-key', second: 'second-key' },
      });
    } finally {
      if (contender && contender.exitCode === null) {
        contender.kill('SIGKILL');
        if (contenderExit) await contenderExit;
      }
      await rmdir(legacyLock).catch(() => {});
      await Promise.allSettled([firstWrite, ...(secondWrite ? [secondWrite] : [])]);
    }
  }, 20_000);

  it('accepts the Windows owner-writable mode while preserving the existing lock file mode', async () => {
    await isolatedConfig();
    await writeConfig({ apiKey: 'before-windows-mode-check' });
    const lockDbPath = `${configPath()}.lock.sqlite`;
    await chmod(lockDbPath, 0o666);

    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
      await expect(writeConfig({ apiKey: 'after-windows-mode-check' })).resolves.toEqual({
        backupsCleared: false,
      });
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    }

    if (originalPlatform !== 'win32') expect((await stat(lockDbPath)).mode & 0o777).toBe(0o666);
    await expect(readConfig()).resolves.toMatchObject({ apiKey: 'after-windows-mode-check' });
  });

  it('recovers a config lock left by a process killed with SIGKILL', async () => {
    await isolatedConfig();
    const childScript = [
      "import { DatabaseSync } from 'node:sqlite';",
      "import { link, open } from 'node:fs/promises';",
      'const path = process.env.AGENT_DRIVE_CONFIG;',
      'const dbPath = `${path}.lock.sqlite`;',
      "const lockFile = await open(dbPath, 'wx', 0o600);",
      'await lockFile.close();',
      'const db = new DatabaseSync(dbPath);',
      "db.exec('BEGIN IMMEDIATE');",
      'await link(`${path}.lock.sqlite`, `${path}.lock`);',
      "process.stdout.write('ready\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      env: { ...process.env, AGENT_DRIVE_CONFIG: configPath() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    await vi.waitFor(() => expect(output).toContain('ready'), { timeout: 10_000 });
    child.kill('SIGKILL');
    const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    expect(code).toBeNull();
    expect(signal).toBe('SIGKILL');

    await expect(writeConfig({ apiKey: 'after-crash' })).resolves.toEqual({
      backupsCleared: false,
    });
    await expect(readConfig()).resolves.toMatchObject({ apiKey: 'after-crash' });
  }, 20_000);

  it('waits for an older CLI lock directory to be released', async () => {
    await isolatedConfig();
    const legacyLock = `${configPath()}.lock`;
    await mkdir(legacyLock, { mode: 0o700 });
    const pendingWrite = writeConfig({ apiKey: 'after-legacy-writer' });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    expect((await stat(legacyLock)).isDirectory()).toBe(true);
    await rmdir(legacyLock);

    await expect(pendingWrite).resolves.toEqual({ backupsCleared: false });
    await expect(readConfig()).resolves.toMatchObject({ apiKey: 'after-legacy-writer' });
  });

  it('preserves an existing config parent mode while keeping the file private', async () => {
    const directory = await isolatedConfig();
    await chmod(directory, 0o755);
    await writeConfig({ apiKey: 'token' });
    expect((await stat(directory)).mode & 0o777).toBe(0o755);
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('resolves the login URL as flag, env, saved config, then default', async () => {
    await isolatedConfig();
    expect(await resolveLoginApiUrl(undefined)).toBe(DEFAULT_API_URL);
    await writeConfig({ apiUrl: 'https://agent-drive.vercel.app/api', apiKey: 'token' });
    expect(await resolveLoginApiUrl(undefined)).toBe('https://agent-drive.vercel.app/api');
    vi.stubEnv('AGENT_DRIVE_API_URL', 'https://env.test/api');
    expect(await resolveLoginApiUrl(undefined)).toBe('https://env.test/api');
    expect(await resolveLoginApiUrl('https://flag.test/api')).toBe('https://flag.test/api');
  });

  describe('resolveDriveId', () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    const api = 'https://x.test/api';
    it('uses the flag when given', () => {
      expect(resolveDriveId(B, {}, api)).toBe(B);
    });
    it('defaults to the only drive key saved for this API origin', () => {
      const config = { driveKeys: { [A]: 'k' }, driveKeyOrigins: { [A]: 'https://x.test' } };
      expect(resolveDriveId(undefined, config, api)).toBe(A);
    });
    it('errors listing the ids when there are none or several', () => {
      expect(() => resolveDriveId(undefined, {}, api)).toThrow(/--drive ID is required/);
      const two = {
        driveKeys: { [A]: 'k', [B]: 'k' },
        driveKeyOrigins: { [A]: 'https://x.test', [B]: 'https://x.test' },
      };
      expect(() => resolveDriveId(undefined, two, api)).toThrow(new RegExp(`${A}.*${B}`));
    });
    it('ignores a key saved for another origin', () => {
      const other = { driveKeys: { [A]: 'k' }, driveKeyOrigins: { [A]: 'https://other.test' } };
      expect(() => resolveDriveId(undefined, other, api)).toThrow(/--drive ID is required/);
    });
  });

  describe('resolveConnection bearer binding', () => {
    const setup = async () => {
      await isolatedConfig();
      vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
      vi.stubEnv('AGENT_DRIVE_API_URL', '');
      vi.stubEnv('AGENT_DRIVE_API_KEY', '');
      await writeConfig({ apiUrl: 'https://x.test/api', apiKey: 'tok' });
    };

    it('withholds the saved bearer when the env URL selects another origin', async () => {
      await setup();
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://other.test/api');
      await expect(resolveConnection()).rejects.toThrow(/API configuration is missing/);
    });

    it('withholds the saved bearer when an explicit --api selects another origin', async () => {
      await setup();
      await expect(resolveConnection('https://other.test/api')).rejects.toThrow(
        /API configuration is missing/,
      );
    });

    it('keeps the saved bearer when the selected URL stays on the saved origin', async () => {
      await setup();
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://x.test/other/path');
      const connection = await resolveConnection();
      expect(connection.apiUrl).toBe('https://x.test/other/path');
      expect(connection.apiKey).toBe('tok');
      const flagged = await resolveConnection('https://x.test/api');
      expect(flagged.apiKey).toBe('tok');
    });

    it('lets an explicit environment key through at any origin', async () => {
      await setup();
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://other.test/api');
      vi.stubEnv('AGENT_DRIVE_API_KEY', 'envtok');
      const connection = await resolveConnection();
      expect(connection.apiUrl).toBe('https://other.test/api');
      expect(connection.apiKey).toBe('envtok');
    });

    it('binds a legacy apiKey saved without apiUrl to the default origin only', async () => {
      await isolatedConfig();
      vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
      vi.stubEnv('AGENT_DRIVE_API_URL', '');
      vi.stubEnv('AGENT_DRIVE_API_KEY', '');
      await writeConfig({ apiKey: 'legacy-tok' });
      const connection = await resolveConnection();
      expect(connection.apiUrl).toBe(DEFAULT_API_URL);
      expect(connection.apiKey).toBe('legacy-tok');
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://other.test/api');
      await expect(resolveConnection()).rejects.toThrow(/API configuration is missing/);
    });

    it('serves the env-bundle bearer only at the bundle origin', async () => {
      await setup();
      vi.stubEnv(
        'AGENT_DRIVE_CREDENTIALS',
        encodeBundle({
          v: 1,
          apiUrl: 'https://bundle.test/api',
          apiKey: 'bundletok',
          driveKeys: {},
          driveKeyOrigins: {},
        }),
      );
      // Saved pair wins at its own origin.
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://x.test/api');
      expect((await resolveConnection()).apiKey).toBe('tok');
      // Selecting the bundle origin falls back to the bundle's key, never the saved one.
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://bundle.test/api');
      expect((await resolveConnection()).apiKey).toBe('bundletok');
      // A third origin gets no stored bearer at all.
      vi.stubEnv('AGENT_DRIVE_API_URL', 'https://third.test/api');
      await expect(resolveConnection()).rejects.toThrow(/API configuration is missing/);
    });
  });

  describe('resolveDriveKey origin binding', () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const savedKey = generateDriveKey();
    const saved = {
      apiUrl: 'https://x.test/api',
      driveKeys: { [A]: savedKey },
      driveKeyOrigins: { [A]: 'https://x.test' },
    };
    it('returns the saved key at its recorded origin and withholds it elsewhere', async () => {
      expect(await resolveDriveKey(A, 'https://x.test/api', undefined, saved)).toBe(savedKey);
      expect(await resolveDriveKey(A, 'https://other.test/api', undefined, saved)).toBeUndefined();
    });
    it('withholds a saved key that cannot decode, even at its origin', async () => {
      const bad = {
        driveKeys: { [A]: 'not-a-drive-key' },
        driveKeyOrigins: { [A]: 'https://x.test' },
      };
      expect(await resolveDriveKey(A, 'https://x.test/api', undefined, bad)).toBeUndefined();
    });
    it('withholds a saved key with no recorded origin', async () => {
      const unmarked = { driveKeys: { [A]: savedKey } };
      expect(await resolveDriveKey(A, 'https://x.test/api', undefined, unmarked)).toBeUndefined();
    });
    it('keeps explicit env and --key-file precedence at any origin', async () => {
      const envName = `AGENT_DRIVE_KEY_${A.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
      vi.stubEnv(envName, ` ${generateDriveKey()} `);
      expect(await resolveDriveKey(A, 'https://other.test/api', undefined, saved)).toBe(
        process.env[envName]!.trim(),
      );
      vi.stubEnv(envName, '');
      vi.stubEnv('AGENT_DRIVE_KEY', generateDriveKey());
      expect(await resolveDriveKey(A, 'https://other.test/api', undefined, saved)).toBe(
        process.env.AGENT_DRIVE_KEY,
      );
      vi.stubEnv('AGENT_DRIVE_KEY', '');
      const directory = await mkdtemp(join(tmpdir(), 'agent-drive-key-'));
      temporaryDirectories.push(directory);
      const keyFile = join(directory, 'key');
      const fileKey = generateDriveKey();
      await writeFile(keyFile, `${fileKey}\n`, { mode: 0o600 });
      expect(await resolveDriveKey(A, 'https://other.test/api', keyFile, saved)).toBe(fileKey);
    });
  });
});

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

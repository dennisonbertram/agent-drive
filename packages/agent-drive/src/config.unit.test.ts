import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configPath,
  DEFAULT_API_URL,
  readConfig,
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
});

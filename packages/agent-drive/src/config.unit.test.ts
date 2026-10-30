import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configPath, readConfig, writeConfig } from './config.js';

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
});

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
    await writeConfig({ apiUrl: 'http://127.0.0.1:3000', apiKey: 'token' });
    expect(configPath()).toBe(join(directory, 'config.json'));
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
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
});

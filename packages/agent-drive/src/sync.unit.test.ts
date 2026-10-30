import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configPath } from './config.js';
import type { AgentDriveClient } from './client.js';
import { syncDirectory } from './sync.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-sync-'));
  temporaryDirectories.push(directory);
  const configurationDirectory = join(directory, 'config');
  await mkdir(configurationDirectory);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(configurationDirectory, 'config.json'));
  const root = join(directory, 'source');
  await mkdir(root);
  return { directory, configurationDirectory, root };
}

function mockClient(
  onPut?: (path: string, bytes: Uint8Array) => Promise<void>,
  existing: { path: string; versionId: string }[] = [],
) {
  const uploaded: { path: string; bytes: Uint8Array; ifVersionId?: string }[] = [];
  const client = {
    apiOrigin: 'https://drive.example',
    whoami: async () => ({
      accountId: 'sync-test-account',
      agentId: 'sync-test-agent',
      keyId: 'sync-test-key',
      scopes: ['read', 'write'],
      driveIds: null,
    }),
    list: async () => ({
      items: existing.map((file) => ({
        fileId: randomUUID(),
        versionId: file.versionId,
        path: file.path,
        ciphertextSize: 1,
        agentId: randomUUID(),
        machineId: null,
        userId: null,
        tags: [],
        description: null,
        createdAt: new Date().toISOString(),
      })),
      nextCursor: null,
    }),
    put: async (
      _driveId: string,
      path: string,
      bytes: Uint8Array,
      options: { ifVersionId?: string } = {},
    ) => {
      uploaded.push({ path, bytes: new Uint8Array(bytes), ...options });
      await onPut?.(path, bytes);
      return {
        id: randomUUID(),
        path,
        ciphertextSize: bytes.byteLength,
        wrappedKey: 'wrapped-key',
        agentId: randomUUID(),
        machineId: null,
        userId: null,
        tags: [],
        description: null,
        createdAt: new Date().toISOString(),
      };
    },
  };
  return { client: client as unknown as AgentDriveClient, uploaded };
}

describe('upload-only sync safety', () => {
  it('rejects a selected file replaced with a symlink before reading outside bytes', async () => {
    const { directory, root } = await fixture();
    const first = join(root, 'first.txt');
    const second = join(root, 'second.txt');
    const outside = join(directory, 'outside.txt');
    await writeFile(first, 'inside first');
    await writeFile(second, 'inside second');
    await writeFile(outside, 'private outside bytes');

    const { client, uploaded } = mockClient(async (path) => {
      if (path !== '/first.txt') return;
      await unlink(second);
      await symlink(outside, second);
    });

    await expect(syncDirectory(client, 'drive', root)).rejects.toThrow('changed after enumeration');
    expect(uploaded.map((item) => Buffer.from(item.bytes).toString())).toEqual(['inside first']);
    expect(Buffer.concat(uploaded.map((item) => Buffer.from(item.bytes))).toString()).not.toContain(
      'private outside bytes',
    );
    expect((await lstat(second)).isSymbolicLink()).toBe(true);
  });

  it('skips initial symlink entries and refuses a symlink sync root', async () => {
    const { directory, root } = await fixture();
    const outside = join(directory, 'outside.txt');
    const link = join(root, 'link.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, link);
    const { client, uploaded } = mockClient();

    await syncDirectory(client, 'drive', root);
    expect(uploaded).toHaveLength(0);

    const rootLink = join(directory, 'root-link');
    await symlink(root, rootLink);
    await expect(syncDirectory(client, 'drive', rootLink)).rejects.toThrow(
      'Sync root must be a real directory',
    );
  });

  it('keeps sync state private without changing a pre-existing parent mode', async () => {
    const { configurationDirectory, root } = await fixture();
    await chmod(configurationDirectory, 0o755);
    await writeFile(join(root, 'file.txt'), 'safe');
    const { client } = mockClient();

    await syncDirectory(client, 'drive', root);

    const stateDirectory = `${configPath()}.state`;
    expect((await stat(configurationDirectory)).mode & 0o777).toBe(0o755);
    expect((await stat(stateDirectory)).mode & 0o777).toBe(0o700);
    const [manifest] = await readdir(stateDirectory);
    expect((await stat(join(stateDirectory, manifest!))).mode & 0o777).toBe(0o600);
  });

  it('does not change permissions on an existing unsafe state directory', async () => {
    const { configurationDirectory, root } = await fixture();
    const stateDirectory = `${configPath()}.state`;
    await mkdir(stateDirectory);
    await chmod(stateDirectory, 0o755);
    await writeFile(join(root, 'file.txt'), 'safe');
    const { client } = mockClient();

    await expect(syncDirectory(client, 'drive', root)).rejects.toThrow(
      'must be a real directory accessible only to the current user',
    );
    expect((await stat(stateDirectory)).mode & 0o777).toBe(0o755);
    expect((await stat(configurationDirectory)).mode & 0o777).toBe(0o755);
    await expect(readFile(join(stateDirectory, 'unused'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('requires explicit guarded adoption of an unknown remote path', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'existing.txt'), 'new local bytes');
    const remoteVersion = randomUUID();
    const { client, uploaded } = mockClient(undefined, [
      { path: '/existing.txt', versionId: remoteVersion },
    ]);

    await expect(syncDirectory(client, 'drive', root)).rejects.toThrow('no local sync history');
    expect(uploaded).toHaveLength(0);

    await syncDirectory(client, 'drive', root, '/', { overwriteExisting: true });
    expect(uploaded).toMatchObject([{ path: '/existing.txt', ifVersionId: remoteVersion }]);
  });

  it('keeps known-manifest remote conflicts even with initial adoption enabled', async () => {
    const { root } = await fixture();
    const path = join(root, 'known.txt');
    await writeFile(path, 'local');
    const first = mockClient();
    await syncDirectory(first.client, 'drive', root);
    const stateDirectory = `${configPath()}.state`;
    const [manifestName] = await readdir(stateDirectory);
    const manifestPath = join(stateDirectory, manifestName!);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    const knownVersion = manifest.files['known.txt']!.versionId;
    const changed = mockClient(undefined, [{ path: '/known.txt', versionId: randomUUID() }]);

    await expect(
      syncDirectory(changed.client, 'drive', root, '/', { overwriteExisting: true }),
    ).rejects.toThrow('Remote conflict');
    expect(changed.uploaded).toHaveLength(0);
    expect(manifest.files['known.txt']!.versionId).toBe(knownVersion);
  });
});

import { randomUUID } from 'node:crypto';
import { symlinkSync, unlinkSync } from 'node:fs';
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
  beforePut?: (path: string) => void | Promise<void>,
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
    putStream: async (
      _driveId: string,
      path: string,
      input: AsyncIterable<Uint8Array>,
      _size: number,
      options: { ifVersionId?: string } = {},
    ) => {
      await beforePut?.(path);
      const chunks: Uint8Array[] = [];
      for await (const chunk of input) chunks.push(new Uint8Array(chunk));
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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

    const { client, uploaded } = mockClient(undefined, [], (path) => {
      if (path !== '/first.txt') return;
      // The first worker runs this before consuming its stream, so the second
      // worker observes the replacement before it opens the selected path.
      unlinkSync(second);
      symlinkSync(outside, second);
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

  it('checks known conflicts before starting uploads for sibling files', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'a-safe.txt'), 'safe');
    await writeFile(join(root, 'z-conflict.txt'), 'changed');
    const first = mockClient();
    await syncDirectory(first.client, 'drive', root);

    const stateDirectory = `${configPath()}.state`;
    const [manifestName] = await readdir(stateDirectory);
    const manifest = JSON.parse(await readFile(join(stateDirectory, manifestName!), 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    const changed = mockClient(undefined, [
      { path: '/a-safe.txt', versionId: manifest.files['a-safe.txt']!.versionId },
      { path: '/z-conflict.txt', versionId: randomUUID() },
    ]);

    await expect(
      syncDirectory(changed.client, 'drive', root, '/', { overwriteExisting: true }),
    ).rejects.toThrow('Remote conflict for z-conflict.txt');
    expect(changed.uploaded).toHaveLength(0);
  });

  it('checkpoints successful in-flight files after a sibling failure and resumes safely', async () => {
    const { root } = await fixture();
    for (let index = 0; index < 5; index++) {
      await writeFile(join(root, `file-${index}.txt`), `contents ${index}`);
    }

    const remoteVersions = new Map<string, string>();
    let entered = 0;
    let markFourEntered!: () => void;
    const fourEntered = new Promise<void>((resolve) => {
      markFourEntered = resolve;
    });
    let releaseSiblings!: () => void;
    const siblingsReleased = new Promise<void>((resolve) => {
      releaseSiblings = resolve;
    });
    const makeClient = (failFirst: boolean) =>
      ({
        apiOrigin: 'https://drive.example',
        whoami: async () => ({
          accountId: 'sync-test-account',
          agentId: 'sync-test-agent',
          keyId: 'sync-test-key',
          scopes: ['read', 'write'],
          driveIds: null,
        }),
        list: async () => ({
          items: Array.from(remoteVersions, ([path, versionId]) => ({
            fileId: randomUUID(),
            versionId,
            path,
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
        putStream: async (
          _driveId: string,
          path: string,
          source: AsyncIterable<Uint8Array>,
          size: number,
        ) => {
          if (failFirst) {
            entered++;
            if (entered === 4) markFourEntered();
            if (path === '/file-0.txt') {
              await fourEntered;
              throw new Error('injected upload failure');
            }
            await siblingsReleased;
          }
          let bytesRead = 0;
          for await (const chunk of source) bytesRead += chunk.byteLength;
          if (bytesRead !== size) throw new Error('stream size mismatch');
          const id = randomUUID();
          remoteVersions.set(path, id);
          return {
            id,
            path,
            ciphertextSize: 1,
            wrappedKey: 'wrapped-key',
            agentId: randomUUID(),
            machineId: null,
            userId: null,
            tags: [],
            description: null,
            createdAt: new Date().toISOString(),
          };
        },
      }) as unknown as AgentDriveClient;

    const firstRun = syncDirectory(makeClient(true), 'drive', root);
    await fourEntered;
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseSiblings();
    await expect(firstRun).rejects.toThrow('injected upload failure');

    const stateDirectory = `${configPath()}.state`;
    const [manifestName] = await readdir(stateDirectory);
    const manifestPath = join(stateDirectory, manifestName!);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    expect(Object.keys(manifest.files).sort()).toEqual(['file-1.txt', 'file-2.txt', 'file-3.txt']);
    expect(Array.from(remoteVersions.keys()).sort()).toEqual([
      '/file-1.txt',
      '/file-2.txt',
      '/file-3.txt',
    ]);

    const resumed = await syncDirectory(makeClient(false), 'drive', root);
    expect(resumed).toMatchObject({ uploaded: 2, skipped: 3, conflicts: 0 });
    const finalManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    expect(Object.keys(finalManifest.files).sort()).toHaveLength(5);
  });

  it('uploads distinct files concurrently with a bounded worker pool', async () => {
    const { root } = await fixture();
    for (let index = 0; index < 8; index++) {
      await writeFile(join(root, `file-${index}.txt`), `contents ${index}`);
    }

    let active = 0;
    let peak = 0;
    const { client, uploaded } = mockClient(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    });

    const result = await syncDirectory(client, 'drive', root);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.uploaded).toBe(8);
    expect(uploaded.map((file) => file.path).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `/file-${index}.txt`).sort(),
    );
    const stateDirectory = `${configPath()}.state`;
    const [manifestName] = await readdir(stateDirectory);
    const manifest = JSON.parse(await readFile(join(stateDirectory, manifestName!), 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    expect(Object.keys(manifest.files).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `file-${index}.txt`).sort(),
    );
  });
});

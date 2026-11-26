import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configPath } from './config.js';
import type { AgentDriveClient, FileEntry, Version } from './client.js';
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
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-sync-lifecycle-'));
  temporaryDirectories.push(directory);
  const configDirectory = join(directory, 'config');
  await mkdir(configDirectory);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(configDirectory, 'config.json'));
  const root = join(directory, 'source');
  await mkdir(root);
  await writeFile(join(root, 'payload.bin'), Buffer.from([1, 2, 3, 4]));
  return { directory, root };
}

type RemoteVersion = { path: string; versionId: string };

function makeClient(
  remote: Map<string, string>,
  options: {
    accountId?: string;
    onList?: () => void | Promise<void>;
    onPut?: (path: string) => void | Promise<void>;
  } = {},
) {
  const client = {
    apiOrigin: 'https://drive.example',
    whoami: async () => ({
      accountId: options.accountId ?? 'sync-lifecycle-account',
      agentId: 'sync-lifecycle-agent',
      keyId: 'sync-lifecycle-key',
      scopes: ['read', 'write'],
      driveIds: null,
    }),
    list: async () => {
      await options.onList?.();
      return {
        items: Array.from(remote, ([path, versionId]) => ({
          fileId: 'sync-file',
          versionId,
          path,
          ciphertextSize: 4,
          agentId: 'sync-agent',
          machineId: null,
          userId: null,
          tags: [],
          description: null,
          createdAt: new Date(0).toISOString(),
        })) as FileEntry[],
        nextCursor: null,
      };
    },
    putStream: async (
      _driveId: string,
      path: string,
      source: AsyncIterable<Uint8Array>,
      size: number,
    ): Promise<Version> => {
      await options.onPut?.(path);
      const parts: Buffer[] = [];
      for await (const part of source) parts.push(Buffer.from(part));
      const bytes = Buffer.concat(parts);
      if (bytes.byteLength !== size) throw new Error('stream size mismatch');
      const id = randomUUID();
      remote.set(path, id);
      return {
        id,
        path,
        ciphertextSize: size,
        wrappedKey: 'wrapped-key',
        agentId: 'sync-agent',
        machineId: null,
        userId: null,
        tags: [],
        description: null,
        createdAt: new Date(0).toISOString(),
      };
    },
  };
  return client as unknown as AgentDriveClient;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function syncManifestFile(stateDirectory: string) {
  const manifests = (await readdir(stateDirectory)).filter((name) => name.endsWith('.json'));
  if (manifests.length !== 1) throw new Error('Expected one sync manifest in the state directory.');
  return join(stateDirectory, manifests[0]!);
}

describe('sync target lifecycle', () => {
  it('serializes the same target until its upload and manifest checkpoint finish', async () => {
    const { root } = await fixture();
    const remote = new Map<string, string>();
    const firstEntered = gate();
    const firstRelease = gate();
    let secondListStarted = false;
    const firstClient = makeClient(remote, {
      onPut: async () => {
        firstEntered.release();
        await firstRelease.promise;
      },
    });
    const secondClient = makeClient(remote, {
      onList: () => {
        secondListStarted = true;
      },
    });
    const firstRun = syncDirectory(firstClient, 'same-drive', root);
    firstRun.catch(() => {});
    let secondRun: Promise<unknown> | undefined;
    try {
      await firstEntered.promise;
      secondRun = syncDirectory(secondClient, 'same-drive', root);
      secondRun.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(secondListStarted).toBe(false);
    } finally {
      firstRelease.release();
      await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]);
    }
    await expect(secondRun).resolves.toMatchObject({ uploaded: 0, skipped: 1 });
  });

  it('allows different target identities to sync while one target is waiting on upload', async () => {
    const { root } = await fixture();
    const release = gate();
    const firstEntered = gate();
    const firstClient = makeClient(new Map(), {
      onPut: async () => {
        firstEntered.release();
        await release.promise;
      },
    });
    const secondEntered = gate();
    const secondClient = makeClient(new Map(), {
      onPut: () => secondEntered.release(),
    });
    const firstRun = syncDirectory(firstClient, 'drive-a', root);
    firstRun.catch(() => {});
    try {
      await firstEntered.promise;
      const secondRun = syncDirectory(secondClient, 'drive-b', root);
      await Promise.race([
        secondEntered.promise,
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error('second target was blocked by the first target')),
            2_000,
          ),
        ),
      ]);
      await secondRun;
    } finally {
      release.release();
      await Promise.allSettled([firstRun]);
    }
  });

  it('stops assigning work on interruption, checkpoints active uploads, and resumes', async () => {
    const { root } = await fixture();
    for (let index = 0; index < 4; index++)
      await writeFile(join(root, `payload-${index}.bin`), Buffer.from([index, 2, 3, 4]));
    const remote = new Map<string, string>();
    const allEntered = gate();
    const release = gate();
    let entered = 0;
    const client = makeClient(remote, {
      onPut: async () => {
        entered++;
        if (entered === 4) allEntered.release();
        await release.promise;
      },
    });
    const controller = new AbortController();
    const interruptedRun = syncDirectory(client, 'same-drive', root, '/', {
      signal: controller.signal,
    } as { overwriteExisting?: boolean; signal: AbortSignal });
    interruptedRun.catch(() => {});
    try {
      await allEntered.promise;
      controller.abort('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(entered).toBe(4);
      release.release();
      await expect(interruptedRun).rejects.toMatchObject({
        name: 'SyncInterruptedError',
        signalName: 'SIGINT',
      });
    } finally {
      release.release();
      await Promise.allSettled([interruptedRun]);
    }

    const stateDirectory = `${configPath()}.state`;
    const manifest = JSON.parse(await readFile(await syncManifestFile(stateDirectory), 'utf8')) as {
      files: Record<string, { hash: string; versionId: string }>;
    };
    expect(Object.keys(manifest.files)).toHaveLength(4);
    const resumed = await syncDirectory(makeClient(remote), 'same-drive', root);
    expect(resumed).toMatchObject({ uploaded: 1, skipped: 4, conflicts: 0 });
  });

  it('releases the per-target SQLite lock after its holder is killed', async () => {
    const { root } = await fixture();
    const stateDirectory = `${configPath()}.state`;
    await mkdir(stateDirectory, { mode: 0o700 });
    const identity = `https://drive.example|sync-lifecycle-account|same-drive|/|${root}`;
    const stateKey = createHash('sha256').update(identity).digest('hex');
    const lockDatabasePath = join(stateDirectory, `${stateKey}.json.lock.sqlite`);
    const lockFile = await open(lockDatabasePath, 'wx', 0o600);
    await lockFile.close();
    const childScript = [
      "const { DatabaseSync } = await import('node:sqlite');",
      'const db = new DatabaseSync(process.env.SYNC_LOCK_DB);',
      "db.exec('BEGIN IMMEDIATE');",
      "process.stdout.write('LOCK_HELD\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: process.cwd(),
      env: { ...process.env, SYNC_LOCK_DB: lockDatabasePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (!childStdout || !childStderr) throw new Error('The sync subprocess has no output pipes.');
    childStdout.setEncoding('utf8');
    childStderr.setEncoding('utf8');
    childStdout.on('data', (chunk: string) => (output += chunk));
    childStderr.on('data', (chunk: string) => (errors += chunk));
    const childExit = once(child, 'exit');
    const remote = new Map<string, string>();
    let parentListStarted = false;
    let parentRun: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(output).toContain('LOCK_HELD'), { timeout: 10_000 });
      parentRun = syncDirectory(
        makeClient(remote, {
          onList: () => {
            parentListStarted = true;
          },
        }),
        'same-drive',
        root,
      );
      parentRun.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(parentListStarted).toBe(false);
      child.kill('SIGKILL');
      const [code, signal] = (await childExit) as [number | null, NodeJS.Signals | null];
      expect(code).toBeNull();
      expect(signal).toBe('SIGKILL');
      await expect(parentRun).resolves.toMatchObject({ uploaded: 1, skipped: 0 });
      const manifest = JSON.parse(
        await readFile(await syncManifestFile(stateDirectory), 'utf8'),
      ) as {
        files: Record<string, { hash: string; versionId: string }>;
      };
      expect(Object.keys(manifest.files)).toEqual(['payload.bin']);
      expect((await stat(lockDatabasePath)).isFile()).toBe(true);
      expect(errors).toBe('');
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await childExit;
      }
      await Promise.allSettled(parentRun ? [parentRun] : []);
    }
  }, 20_000);
});

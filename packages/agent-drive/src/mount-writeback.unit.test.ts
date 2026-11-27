import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriveClient, PutStreamOptions, Version } from './client.js';
import * as config from './config.js';
import { createMountWriteback, MountWritebackConflictError } from './mount-writeback.js';

const roots: string[] = [];
const version = (id: string, path = '/doc.txt'): Version => ({
  id,
  path,
  ciphertextSize: 20,
  wrappedKey: 'wrapped',
  agentId: 'agent',
  machineId: null,
  userId: null,
  tags: ['keep-tag'],
  description: 'keep description',
  createdAt: '2026-11-26T00:00:00.000Z',
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-drive-writeback-'));
  roots.push(root);
  return root;
}

type FakeSettings = {
  remote?: Uint8Array;
  baseVersionId?: string | null;
  loseFirstCommitAck?: boolean;
  conflict?: boolean;
  expireIntent?: boolean;
};

function fakeClient(settings: FakeSettings = {}) {
  const initial = settings.remote ?? new TextEncoder().encode('abcdefghij');
  const commits: string[] = [];
  const uploads: { path: string; options: PutStreamOptions; bytes: Uint8Array }[] = [];
  const streamReads: string[] = [];
  const metadataReads: string[] = [];
  let intentNumber = 0;
  let lostAck = false;
  const committed = new Map<string, Version>();
  const client = {
    apiOrigin: 'https://api.synthetic.invalid',
    writebackScopeId: () => 'a'.repeat(64),
    async getStream(_driveId: string, path: string, options: { versionId?: string } = {}) {
      streamReads.push(options.versionId ?? 'latest');
      if (settings.baseVersionId === null) throw new Error('not found');
      const selected = settings.baseVersionId ?? 'base-version';
      if (options.versionId !== undefined && options.versionId !== selected)
        throw new Error('wrong pinned version');
      const plaintext = (async function* () {
        yield initial.slice();
      })();
      return { plaintextBytes: initial.byteLength, plaintext, version: version(selected, path) };
    },
    async getVersionMetadata(_driveId: string, path: string, options: { versionId?: string } = {}) {
      const selected = settings.baseVersionId ?? 'base-version';
      metadataReads.push(options.versionId ?? 'latest');
      return version(selected, path);
    },
    async putStream(
      _driveId: string,
      path: string,
      plaintext: AsyncIterable<Uint8Array>,
      _size: number,
      options: PutStreamOptions,
    ) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of plaintext) chunks.push(chunk.slice());
      const bytes = joinBytes(chunks);
      const intentId = `intent-${++intentNumber}`;
      await options.onIntent?.(intentId);
      await options.onUploadComplete?.(intentId);
      uploads.push({ path, options, bytes });
      const result = version(`committed-${intentId}`, path);
      if (settings.conflict) {
        throw Object.assign(new Error('conditional write conflict'), {
          code: 'conflict',
          status: 409,
          state: 'changed',
          currentVersionId: 'newer-remote-version',
        });
      }
      committed.set(intentId, result);
      if (settings.loseFirstCommitAck && !lostAck) {
        lostAck = true;
        throw Object.assign(new Error('commit response lost'), { status: 502 });
      }
      return result;
    },
    async replayCommit(_driveId: string, intentId: string) {
      commits.push(intentId);
      const result = committed.get(intentId);
      if (settings.conflict) {
        throw Object.assign(new Error('conditional write conflict'), {
          code: 'conflict',
          status: 409,
          state: 'changed',
          currentVersionId: 'newer-remote-version',
        });
      }
      if (!result)
        throw Object.assign(new Error('expired intent'), { code: 'conflict', status: 409 });
      if (settings.expireIntent)
        throw Object.assign(new Error('expired intent'), { code: 'conflict', status: 409 });
      return result;
    },
  };
  return {
    client: client as unknown as AgentDriveClient,
    commits,
    uploads,
    streamReads,
    metadataReads,
    seedCommit: (id: string, value: Version) => committed.set(id, value),
  };
}

function joinBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function crashFixture(
  root: string,
  client: AgentDriveClient,
  record: Record<string, unknown>,
  stagedBytes: string,
) {
  const canonicalRoot = await realpath(root);
  const scopeId = client.writebackScopeId('drive-a');
  const scopePath = join(canonicalRoot, scopeId);
  const lockDirectory = join(scopePath, '.locks');
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  await chmod(scopePath, 0o700).catch(() => undefined);
  const id = typeof record.id === 'string' ? record.id : randomUUID();
  const recoveryPath = join(scopePath, `${id}.data`);
  await writeFile(recoveryPath, stagedBytes, { mode: 0o600 });
  await writeFile(
    join(scopePath, `${id}.json`),
    JSON.stringify({ ...record, format: 1, scopeId, id }),
    { mode: 0o600 },
  );
  return { scopeId, scopePath, recoveryPath };
}

describe('mount writeback journal protocol', () => {
  it('keeps an incomplete Finder copy local after a copy failure and process restart', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient();
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite(
      '/doc.txt',
      'base-version',
      undefined,
      true,
      false,
      true,
    );
    await journal.truncate(handle.handleId, 8);
    await journal.write(handle.handleId, 0, new TextEncoder().encode('partial'));

    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({ code: 'EINPROGRESS' });
    await expect(journal.release(handle.handleId)).resolves.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    expect(uploads).toHaveLength(0);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('partial\0');
    await journal.close();

    const restarted = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    await expect(restarted.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'pending', recoveryPath: handle.recoveryPath },
    ]);
    expect(uploads).toHaveLength(0);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('partial\0');
    await restarted.close();
  });

  it('preserves an incomplete copy when the writeback service closes', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient();
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite(
      '/doc.txt',
      'base-version',
      undefined,
      true,
      false,
      true,
    );
    await journal.truncate(handle.handleId, 6);
    await journal.write(handle.handleId, 0, new TextEncoder().encode('partial'));

    await expect(journal.close()).rejects.toMatchObject({ code: 'EIO' });
    expect(uploads).toHaveLength(0);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('partial');
  });

  it('keeps a never-submitted stage as manual recovery data across remount', async () => {
    const root = await fixture();
    const fake = fakeClient({ baseVersionId: null });
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    const handle = await journal.openWrite('/doc.txt', null, 0, true, true);
    await journal.truncate(handle.handleId, 6);
    await journal.write(handle.handleId, 0, new TextEncoder().encode('staged'));

    await expect(journal.closeWithoutFlush(handle.handleId)).resolves.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    expect(fake.uploads).toHaveLength(0);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('staged');
    await journal.close();

    const restarted = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    await expect(restarted.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'pending', recoveryPath: handle.recoveryPath },
    ]);
    expect(fake.uploads).toHaveLength(0);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('staged');
    const next = await restarted.openWrite('/doc.txt', null, 0, true);
    await expect(restarted.listStaged('/')).resolves.toEqual([
      expect.objectContaining({ path: '/doc.txt', handleId: next.handleId }),
    ]);
    await restarted.write(next.handleId, 0, new TextEncoder().encode('fresh'));
    await expect(restarted.flush(next.handleId)).resolves.toMatchObject({
      id: 'committed-intent-1',
      path: '/doc.txt',
    });
    expect(fake.uploads).toHaveLength(1);
    expect(new TextDecoder().decode(await readFile(handle.recoveryPath))).toBe('staged');
    await restarted.close();
  });

  it('reconciles an uploaded intent on no-flush close without starting another upload', async () => {
    const root = await fixture();
    const fake = fakeClient({ loseFirstCommitAck: true });
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    const handle = await journal.openWrite('/doc.txt', 'base-version');
    await journal.write(handle.handleId, 0, new TextEncoder().encode('new'));

    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    await expect(journal.closeWithoutFlush(handle.handleId)).resolves.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    expect(fake.uploads).toHaveLength(1);
    await journal.close();

    const restarted = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    await expect(restarted.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'committed', versionId: 'committed-intent-1' },
    ]);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.commits).toEqual(['intent-1']);
    await restarted.close();
  });

  it('recovers a Finder copy after the producer persisted completion but before upload', async () => {
    const root = await fixture();
    const fake = fakeClient();
    const persisted = await crashFixture(
      root,
      fake.client,
      {
        path: '/doc.txt',
        baseVersionId: 'base-version',
        state: 'dirty',
        size: 8,
        generation: 1,
        committedGeneration: 0,
        producerComplete: true,
      },
      'complete',
    );
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });

    await expect(journal.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'committed', recoveryPath: persisted.recoveryPath },
    ]);
    expect(new TextDecoder().decode(fake.uploads[0]?.bytes)).toBe('complete');
    await journal.close();
  });

  it('publishes a Finder copy only after completion is durably marked', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient();
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite(
      '/doc.txt',
      'base-version',
      undefined,
      true,
      false,
      true,
    );
    const contents = new TextEncoder().encode('complete');
    await journal.truncate(handle.handleId, contents.byteLength);
    await journal.write(handle.handleId, 0, contents);

    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({ code: 'EINPROGRESS' });
    await journal.completeWrite(handle.handleId);
    await expect(
      readFile(join(journal.scopePath, `${handle.handleId}.json`), 'utf8').then((raw) =>
        JSON.parse(raw),
      ),
    ).resolves.toMatchObject({ producerComplete: true });
    await expect(journal.flush(handle.handleId)).resolves.toMatchObject({
      id: 'committed-intent-1',
      path: '/doc.txt',
    });
    expect(new TextDecoder().decode(uploads[0]?.bytes)).toBe('complete');
    await journal.release(handle.handleId);
    await journal.close();
  });

  it('re-reads the journal after locking and recovers the latest acknowledged bytes', async () => {
    const root = await fixture();
    const fake = fakeClient();
    const persisted = await crashFixture(
      root,
      fake.client,
      {
        path: '/doc.txt',
        baseVersionId: 'base-version',
        state: 'dirty',
        size: 5,
        generation: 1,
        committedGeneration: 0,
      },
      'stale',
    );
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    const originalLock = config.withSqliteFileLock;
    let changed = false;
    vi.spyOn(config, 'withSqliteFileLock').mockImplementation(async (path, work, options) => {
      if (!changed && String(path).includes('/.locks/')) {
        changed = true;
        await writeFile(persisted.recoveryPath, 'latest-bytes');
        await writeFile(
          join(
            persisted.scopePath,
            `${persisted.recoveryPath
              .split('/')
              .at(-1)!
              .replace(/\.data$/u, '')}.json`,
          ),
          JSON.stringify({
            format: 1,
            scopeId: persisted.scopeId,
            id: persisted.recoveryPath
              .split('/')
              .at(-1)!
              .replace(/\.data$/u, ''),
            path: '/doc.txt',
            baseVersionId: 'base-version',
            state: 'dirty',
            size: 12,
            generation: 2,
            committedGeneration: 0,
          }),
        );
      }
      return await originalLock(path, work, options);
    });

    await expect(journal.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'committed', recoveryPath: persisted.recoveryPath },
    ]);
    expect(changed).toBe(true);
    expect(new TextDecoder().decode(fake.uploads[0]?.bytes)).toBe('latest-bytes');
    await journal.close();
  });

  it('does not act under a stale path lock when the journal path changes before acquisition', async () => {
    const root = await fixture();
    const fake = fakeClient();
    const persisted = await crashFixture(
      root,
      fake.client,
      {
        path: '/doc.txt',
        baseVersionId: 'base-version',
        state: 'dirty',
        size: 6,
        generation: 1,
        committedGeneration: 0,
      },
      'staged',
    );
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });
    const originalLock = config.withSqliteFileLock;
    let changed = false;
    vi.spyOn(config, 'withSqliteFileLock').mockImplementation(async (path, work, options) => {
      if (!changed && String(path).includes('/.locks/')) {
        changed = true;
        const journalPath = join(
          persisted.scopePath,
          `${persisted.recoveryPath
            .split('/')
            .at(-1)!
            .replace(/\.data$/u, '')}.json`,
        );
        const record = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>;
        record.path = '/moved.txt';
        await writeFile(journalPath, JSON.stringify(record));
      }
      return await originalLock(path, work, options);
    });

    await expect(journal.recover()).resolves.toMatchObject([
      { path: '/moved.txt', state: 'pending', recoveryPath: persisted.recoveryPath },
    ]);
    expect(changed).toBe(true);
    expect(fake.uploads).toHaveLength(0);
    expect(await readFile(persisted.recoveryPath, 'utf8')).toBe('staged');
    await journal.close();
  });

  it('stages random writes, reads its own changes, and commits against the opened base version', async () => {
    const root = await fixture();
    const { client, uploads, streamReads } = fakeClient();
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite('/doc.txt', 'base-version');

    await journal.write(handle.handleId, 3, new TextEncoder().encode('ZZ'));
    expect(new TextDecoder().decode((await journal.readStaged(handle.handleId, 2, 5)).data)).toBe(
      'cZZfg',
    );
    expect(await journal.listStaged('/')).toMatchObject([
      {
        path: '/doc.txt',
        size: 10,
        handleId: handle.handleId,
        recoveryPath: handle.recoveryPath,
        state: 'dirty',
      },
    ]);
    expect((await journal.truncate(handle.handleId, 8)).size).toBe(8);
    const committed = await journal.flush(handle.handleId);

    expect(streamReads).toEqual(['base-version']);
    expect(uploads[0]?.options.ifVersionId).toBe('base-version');
    expect(uploads[0]?.options.mode).toBeUndefined();
    expect(uploads[0]?.options.tags).toEqual(['keep-tag']);
    expect(uploads[0]?.options.description).toBe('keep description');
    expect(new TextDecoder().decode(uploads[0]?.bytes)).toBe('abcZZfgh');
    expect(committed.id).toBe('committed-intent-1');
    await journal.release(handle.handleId);
    await journal.close();
  });

  it('truncates at open through metadata-only lookup and preserves the opened version metadata', async () => {
    const root = await fixture();
    const { client, uploads, streamReads, metadataReads } = fakeClient();
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const opened = await journal.openWrite('/doc.txt', 'base-version', 0, true);

    expect(opened.size).toBe(0);
    expect(metadataReads).toEqual(['base-version']);
    expect(streamReads).toEqual([]);
    await journal.flush(opened.handleId);
    expect(uploads[0]?.bytes.byteLength).toBe(0);
    expect(uploads[0]?.options.ifVersionId).toBe('base-version');
    expect(uploads[0]?.options.tags).toEqual(['keep-tag']);
    expect(uploads[0]?.options.description).toBe('keep description');
    await journal.release(opened.handleId);
    await journal.close();
  });

  it('uses create-only on a missing file and forces owner-only durable staging files', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient({ baseVersionId: null, remote: new Uint8Array() });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite('/new.txt', null, undefined, false, true);

    await journal.write(handle.handleId, 0, new TextEncoder().encode('new local content'));
    const stagePath = handle.recoveryPath;
    const files = await readdir(root, { recursive: true });
    const privateFiles = files.filter((name) => !String(name).includes('.lock'));
    for (const name of privateFiles) {
      const metadata = await stat(join(root, String(name)));
      expect(metadata.mode & 0o777).toBe(metadata.isDirectory() ? 0o700 : 0o600);
    }
    expect(stagePath).toContain(await realpath(root));

    await journal.flush(handle.handleId);
    expect(uploads[0]?.options.mode).toBe('create');
    expect(uploads[0]?.options.ifVersionId).toBeUndefined();
    expect(uploads[0]?.options.allowTrashedCreate).toBe(true);
    await journal.release(handle.handleId);
    await journal.close();
  });

  it('persists trashed-create permission with the upload intent across an ambiguous commit', async () => {
    const root = await fixture();
    const { client, uploads, commits } = fakeClient({
      baseVersionId: null,
      remote: new Uint8Array(),
      loseFirstCommitAck: true,
    });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const opened = await journal.openWrite('/recreated.txt', null, undefined, false, true);
    await journal.write(opened.handleId, 0, new TextEncoder().encode('restored content'));

    await expect(journal.flush(opened.handleId)).rejects.toMatchObject({
      status: 502,
      recoveryPath: opened.recoveryPath,
    });
    const record = JSON.parse(
      await readFile(opened.recoveryPath.replace(/\.data$/u, '.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(record.allowTrashedCreate).toBe(true);
    expect(uploads[0]?.options.allowTrashedCreate).toBe(true);

    await expect(journal.recover()).resolves.toMatchObject([
      { path: '/recreated.txt', state: 'committed' },
    ]);
    expect(commits).toEqual(['intent-1']);
    expect(uploads).toHaveLength(1);
    await journal.release(opened.handleId);
    await journal.close();
  });

  it('rejects a preexisting journal root with broad permissions without changing it', async () => {
    const root = await fixture();
    await chmod(root, 0o755);
    const { client } = fakeClient();

    await expect(
      createMountWriteback({ client, driveId: 'drive-a', journalRoot: root }),
    ).rejects.toMatchObject({ code: 'EACCES' });
    expect((await stat(root)).mode & 0o777).toBe(0o755);
  });

  it('canonicalizes symlinked parent paths before choosing the journal scope and SQLite lock paths', async () => {
    const realTemp = await realpath('/tmp');
    const root = await mkdtemp(join(realTemp, 'agent-drive-writeback-alias-'));
    roots.push(root);
    const realJournalRoot = join(root, 'journal');
    let aliasedJournalRoot: string;
    if (process.platform === 'darwin' && root.startsWith('/private/tmp/')) {
      const aliasRoot = `/tmp/${root.slice('/private/tmp/'.length)}`;
      expect(await realpath(aliasRoot)).toBe(root);
      aliasedJournalRoot = join(aliasRoot, 'journal');
    } else {
      const aliasParent = `${root}-alias`;
      roots.push(aliasParent);
      await symlink(root, aliasParent);
      aliasedJournalRoot = join(aliasParent, 'journal');
    }
    const { client } = fakeClient();
    const first = await createMountWriteback({
      client,
      driveId: 'drive-a',
      journalRoot: realJournalRoot,
    });
    const second = await createMountWriteback({
      client,
      driveId: 'drive-a',
      journalRoot: aliasedJournalRoot,
    });

    expect(second.scopePath).toBe(first.scopePath);
    const opened = await first.openWrite('/same-path.txt', null);
    const [databaseName] = (await readdir(join(first.scopePath, '.locks'))).filter((name) =>
      name.endsWith('.sqlite'),
    );
    expect(databaseName).toBeDefined();
    expect((await stat(join(first.scopePath, '.locks', databaseName!))).mode & 0o777).toBe(0o600);
    await expect(second.openWrite('/same-path.txt', null)).rejects.toMatchObject({ code: 'EBUSY' });
    await first.release(opened.handleId);
    await first.close();
    await second.close();
  });

  it('replays the same persisted intent after a lost commit acknowledgement and deduplicates fsync', async () => {
    const root = await fixture();
    const { client, commits } = fakeClient({ loseFirstCommitAck: true });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite('/doc.txt', 'base-version');
    await journal.write(handle.handleId, 0, new TextEncoder().encode('local'));

    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({
      status: 502,
      recoveryPath: handle.recoveryPath,
    });
    const recovered = await journal.recover();

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ path: '/doc.txt', state: 'committed' });
    expect(commits).toEqual(['intent-1']);
    expect(await journal.flush(handle.handleId)).toMatchObject({ id: 'committed-intent-1' });
    expect(commits).toEqual(['intent-1']);
    await journal.release(handle.handleId);
    await journal.close();
  });

  it('recovers a prior-process uploaded journal by replaying its persisted intent id', async () => {
    const root = await fixture();
    const fake = fakeClient();
    fake.seedCommit('intent-after-crash', version('recovered-version'));
    const persisted = await crashFixture(
      root,
      fake.client,
      {
        path: '/doc.txt',
        baseVersionId: 'base-version',
        tags: ['keep-tag'],
        description: 'keep description',
        state: 'uploaded',
        size: 5,
        generation: 1,
        committedGeneration: 0,
        versionId: 'base-version',
        intentId: 'intent-after-crash',
      },
      'local',
    );
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });

    await expect(journal.recover()).resolves.toEqual([
      {
        path: '/doc.txt',
        state: 'committed',
        recoveryPath: persisted.recoveryPath,
        versionId: 'recovered-version',
      },
    ]);
    expect(fake.commits).toEqual(['intent-after-crash']);
    expect(fake.uploads).toHaveLength(0);
    await journal.close();
  });

  it('replays a write-ahead mutation after a crash before the staged data write completed', async () => {
    const root = await fixture();
    const fake = fakeClient();
    const pendingBytes = Buffer.from('CRASH').toString('base64');
    const persisted = await crashFixture(
      root,
      fake.client,
      {
        path: '/doc.txt',
        baseVersionId: 'base-version',
        tags: ['keep-tag'],
        description: 'keep description',
        state: 'dirty',
        size: 10,
        generation: 0,
        committedGeneration: -1,
        pendingMutation: { kind: 'write', offset: 2, data: pendingBytes },
      },
      'abcdefghij',
    );
    const journal = await createMountWriteback({
      client: fake.client,
      driveId: 'drive-a',
      journalRoot: root,
    });

    await expect(journal.recover()).resolves.toMatchObject([
      { path: '/doc.txt', state: 'committed', recoveryPath: persisted.recoveryPath },
    ]);
    expect(new TextDecoder().decode(fake.uploads[0]?.bytes)).toBe('abCRASHhij');
    expect(fake.uploads[0]?.options.ifVersionId).toBe('base-version');
    await journal.close();
  });

  it('preserves local bytes and reports the recovery path when the opened remote version is stale', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient({ conflict: true });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite('/doc.txt', 'base-version');
    await journal.write(handle.handleId, 0, new TextEncoder().encode('local edit'));

    await expect(journal.flush(handle.handleId)).rejects.toBeInstanceOf(
      MountWritebackConflictError,
    );
    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({
      path: '/doc.txt',
      currentVersionId: 'newer-remote-version',
      recoveryPath: handle.recoveryPath,
    });
    expect(await readFile(handle.recoveryPath, 'utf8')).toContain('local edit');
    expect(uploads[0]?.options.ifVersionId).toBe('base-version');
    await expect(journal.release(handle.handleId)).resolves.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    await journal.close();
  });

  it('preserves local bytes and reports the recovery path when an uploaded intent expires', async () => {
    const root = await fixture();
    const { client } = fakeClient({ loseFirstCommitAck: true, expireIntent: true });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const handle = await journal.openWrite('/doc.txt', 'base-version');
    await journal.write(handle.handleId, 0, new TextEncoder().encode('local edit'));

    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({ status: 502 });
    await expect(journal.flush(handle.handleId)).rejects.toMatchObject({
      recoveryPath: handle.recoveryPath,
      path: '/doc.txt',
    });
    expect(await readFile(handle.recoveryPath, 'utf8')).toContain('local edit');
    await expect(journal.release(handle.handleId)).resolves.toMatchObject({
      recoveryPath: handle.recoveryPath,
    });
    await journal.close();
  });

  it('uses a stable SQLite lock after a killed owner and lets only one process win a contention race', async () => {
    const root = await fixture();
    const { client, uploads } = fakeClient({ baseVersionId: null, remote: new Uint8Array() });
    const journal = await createMountWriteback({ client, driveId: 'drive-a', journalRoot: root });
    const lockHash = createHash('sha256').update('/doc.txt').digest('hex');
    const databasePath = join(journal.scopePath, '.locks', `${lockHash}.sqlite`);
    await writeFile(databasePath, '', { mode: 0o600 });
    const oldOwnerScript = [
      "import { DatabaseSync } from 'node:sqlite';",
      'const db = new DatabaseSync(process.env.LOCK_DB);',
      "db.exec('BEGIN IMMEDIATE');",
      "process.stdout.write('held\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const contenderScript = [
      "import { DatabaseSync } from 'node:sqlite';",
      'const db = new DatabaseSync(process.env.LOCK_DB, { timeout: 0 });',
      "process.stdout.write('ready\\n');",
      "process.stdin.once('data', () => {",
      "  try { db.exec('BEGIN IMMEDIATE'); process.stdout.write('acquired\\n'); setInterval(() => {}, 1000); }",
      "  catch (error) { if (error.errcode === 5 || error.errcode === 6) { process.stdout.write('busy\\n'); db.close(); process.exit(0); } throw error; }",
      '});',
    ].join('\n');
    const oldOwner = spawn(process.execPath, ['--input-type=module', '-e', oldOwnerScript], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', LOCK_DB: databasePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let oldOwnerOutput = '';
    oldOwner.stdout?.setEncoding('utf8');
    oldOwner.stdout?.on('data', (chunk: string) => {
      oldOwnerOutput += chunk;
    });
    const waitForOutput = async (getOutput: () => string, marker: string) => {
      await vi.waitFor(() => expect(getOutput()).toContain(marker), { timeout: 5_000 });
    };
    const contenderOutputs = ['', ''];
    let contenders: ChildProcessByStdio<Writable, Readable, Readable>[] = [];
    try {
      await waitForOutput(() => oldOwnerOutput, 'held');
      await expect(journal.openWrite('/doc.txt', null)).rejects.toMatchObject({ code: 'EBUSY' });
      const oldOwnerExit = once(oldOwner, 'exit');
      oldOwner.kill('SIGKILL');
      const [, oldSignal] = (await oldOwnerExit) as [number | null, NodeJS.Signals | null];
      expect(oldSignal).toBe('SIGKILL');
      const databaseIdentity = await stat(databasePath);

      contenders = [0, 1].map(() =>
        spawn(process.execPath, ['--input-type=module', '-e', contenderScript], {
          env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', LOCK_DB: databasePath },
          stdio: ['pipe', 'pipe', 'pipe'] as const,
        }),
      );
      contenders.forEach((child, index) => {
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          contenderOutputs[index] += chunk;
        });
      });
      await Promise.all(
        contenders.map((_child, index) => waitForOutput(() => contenderOutputs[index]!, 'ready')),
      );
      for (const child of contenders) child.stdin?.write('go');
      await vi.waitFor(
        () => expect(contenderOutputs.join('')).toMatch(/acquired[\s\S]*busy|busy[\s\S]*acquired/u),
        { timeout: 5_000 },
      );
      const winner = contenders.find((_child, index) =>
        contenderOutputs[index]?.includes('acquired'),
      );
      const loser = contenders.find((_child, index) => contenderOutputs[index]?.includes('busy'));
      expect(winner).toBeDefined();
      expect(loser).toBeDefined();
      const winnerExit = once(winner!, 'exit');
      winner!.kill('SIGKILL');
      await winnerExit;
      if (loser!.exitCode === null && loser!.signalCode === null) await once(loser!, 'exit');

      const reopened = await journal.openWrite('/doc.txt', null);
      await journal.write(reopened.handleId, 0, new TextEncoder().encode('retained bytes'));
      await journal.release(reopened.handleId);
      expect(new TextDecoder().decode(uploads[0]?.bytes)).toBe('retained bytes');
      expect((await stat(databasePath)).ino).toBe(databaseIdentity.ino);
      await journal.close();
    } finally {
      for (const child of [oldOwner, ...contenders]) {
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, 'exit');
          child.kill('SIGKILL');
          await exit;
        }
      }
      await journal.close().catch(() => undefined);
    }
  });
});

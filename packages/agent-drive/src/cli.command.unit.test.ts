import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { writeConfig } from './config.js';
import { encodeBundle, issueCredentials } from './credentials.js';
import { unsealDriveKey, type SealedDriveKey } from './seal.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_KEY_ID = '33333333-3333-4333-8333-333333333333';
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

type Saved = { keys: Record<string, string>; origins: Record<string, string> };

/** Runs the real CLI entry point in-process against a stubbed API. */
async function cli(
  argv: string[],
  saved: Saved,
  respond: (path: string, init?: RequestInit) => unknown = (path) =>
    path === 'account-key' ? { accountKey: null } : {},
  env: Record<string, string> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cmd-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: saved.keys,
    driveKeyOrigins: saved.origins,
    keyBackup: Object.fromEntries(
      Object.keys(saved.keys).map((id) => [id, { at: 'now', method: 'file' as const }]),
    ),
  });
  const paths: string[] = [];
  const queries: string[] = [];
  const origins: string[] = [];
  const calls: {
    path: string;
    origin: string;
    method: string;
    authorization: string | null;
    body?: string;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const api = parsed.pathname.startsWith('/api/v1/');
      const path = api ? parsed.pathname.replace('/api/v1/', '') : `storage${parsed.pathname}`;
      paths.push(path);
      queries.push(parsed.search);
      origins.push(parsed.origin);
      if (init?.body instanceof ReadableStream) {
        const reader = init.body.getReader();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
        }
      }
      calls.push({
        path,
        origin: parsed.origin,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });
      const response = respond(path, init);
      const hasAccountKey =
        response !== null &&
        typeof response === 'object' &&
        ('accountKey' in response || 'keyId' in response);
      const body = path === 'account-key' && !hasAccountKey ? { accountKey: null } : response;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true));
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', ...argv]);
  vi.resetModules();
  const mod = (await import('./cli.js')) as { done?: Promise<void> };
  // The CLI entry point runs the command without awaiting it; `done` settles when the whole
  // command (including best-effort account sealing) has finished.
  await mod.done;
  const exitCode = process.exitCode;
  // Getters, not snapshots: best-effort account sealing can write to stderr after the first
  // output line, and tests poll these inside vi.waitFor.
  return {
    get out() {
      return out.join('');
    },
    get err() {
      return err.join('');
    },
    paths,
    queries,
    origins,
    calls,
    exitCode,
  };
}

async function accountKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
    'base64url',
  );
  return { privateKey: pair.privateKey, publicKey };
}

function sealApi(account: Awaited<ReturnType<typeof accountKeyPair>>, driveIds: string[]) {
  return (path: string) => {
    if (path === 'account-key')
      return { keyId: ACCOUNT_KEY_ID, publicKey: account.publicKey, format: 1 };
    if (path === 'drives')
      return {
        items: driveIds.map((id) => ({ id, name: id, agentOnly: false })),
        nextCursor: null,
      };
    if (path.endsWith('/account-key-slot')) return { status: 'created' };
    return {};
  };
}

async function credentialsFile(bundle: Parameters<typeof encodeBundle>[0]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-import-'));
  dirs.push(dir);
  const path = join(dir, 'credentials.bundle');
  await writeFile(path, encodeBundle(bundle));
  return path;
}

async function openedSlots(
  calls: Awaited<ReturnType<typeof cli>>['calls'],
  account: Awaited<ReturnType<typeof accountKeyPair>>,
) {
  const opened = new Map<string, string>();
  for (const call of calls.filter(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/account-key-slot'),
  )) {
    const driveId = /drives\/([^/]+)\/account-key-slot$/u.exec(call.path)?.[1];
    if (!driveId || !call.body) throw new Error('The account-key slot request was incomplete.');
    const body = JSON.parse(call.body) as { keyId: string; sealed: SealedDriveKey };
    expect(body.keyId).toBe(ACCOUNT_KEY_ID);
    opened.set(
      driveId,
      await unsealDriveKey(account.privateKey, driveId, body.sealed, {
        salt: 'agent-drive-account-v1',
        label: `${ACCOUNT_KEY_ID}:${driveId}`,
      }),
    );
  }
  return opened;
}

const one: Saved = { keys: { [A]: generateDriveKey() }, origins: { [A]: 'https://x.test' } };
const version = { id: 'v1', path: '/a.md', wrappedKey: 'WRAPPED', downloadUrl: 'https://s3/x' };

describe('drive default at the command level', () => {
  it('ls uses the only drive key saved for this origin, and hides wrapped keys', async () => {
    const r = await cli(['ls'], one, (path) =>
      path === 'drives' ? { items: [], nextCursor: null } : { items: [version], nextCursor: null },
    );
    expect(r.err).toBe('');
    // paths[0] is the throttled account-seal drive listing; the ls request follows.
    expect(r.paths.some((p) => p.includes(`drives/${A}/list`))).toBe(true);
    expect(r.out).toContain('"/a.md"');
    expect(r.out).not.toContain('WRAPPED');
    expect(r.out).not.toContain('downloadUrl');
  });

  it('ls --folder/--sort send delimiter and sort and print folder rows; plain ls sends neither', async () => {
    const folder = {
      kind: 'folder',
      path: '/reports',
      items: 2,
      ciphertext_size: '12',
      created_at: 't',
    };
    const r = await cli(
      ['ls', '--folder', '/', '--sort', 'modified', '--limit', '5'],
      one,
      (path) =>
        path === 'drives'
          ? { items: [], nextCursor: null }
          : {
              items: [folder, { ...version, id: 'f1', version_id: 'v1', ciphertext_size: 1 }],
              nextCursor: null,
            },
    );
    expect(r.err).toBe('');
    // The throttled account-seal GET drives carries no query; find the ls request instead.
    const list = r.queries.find((q) => q.includes('delimiter'));
    expect(list).toContain('delimiter=%2F');
    expect(list).toContain('prefix=%2F');
    expect(list).toContain('sort=modified');
    expect(list).toContain('limit=5');
    expect(r.out).toContain('"kind":"folder"');
    expect(r.out).toContain('"items":2');
    expect(r.out).not.toContain('WRAPPED');
    const plain = await cli(['ls'], one, () => ({ items: [], nextCursor: null }));
    expect(plain.queries.every((q) => !q.includes('delimiter') && !q.includes('sort='))).toBe(true);
    const flat = await cli(['ls', '--sort', 'modified', '--prefix', '/a'], one, () => ({
      items: [],
      nextCursor: null,
    }));
    const flatList = flat.queries.find((q) => q.includes('sort='));
    expect(flatList).toContain('sort=modified');
    expect(flatList).toContain('prefix=%2Fa');
    expect(flatList).not.toContain('delimiter');
    const explicitPath = await cli(['ls', '--sort', 'path', '--prefix', '/a'], one, () => ({
      items: [],
      nextCursor: null,
    }));
    expect(explicitPath.queries.some((q) => q === '?prefix=%2Fa')).toBe(true);
    const both = await cli(['ls', '--folder', '/a', '--prefix', '/b'], one);
    expect(both.err).toContain('either --folder or --prefix');
    const bad = await cli(['ls', '--sort', 'size'], one);
    expect(bad.err).toContain('--sort must be path or modified');
    // Only the throttled account-seal traffic may have gone out — never the ls list request.
    expect(bad.paths.every((p) => !p.includes('/list'))).toBe(true);
  });

  it('versions hides wrapped keys too', async () => {
    const r = await cli(['versions', '/a.md', '--drive', A], one, () => ({
      items: [version],
      nextCursor: null,
    }));
    expect(r.out).toContain('"v1"');
    expect(r.out).not.toContain('WRAPPED');
  });

  it('lists the configured ids when there are two keys', async () => {
    const two: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://x.test' },
    };
    const r = await cli(['ls'], two);
    expect(r.err).toContain('--drive ID is required');
    expect(r.err).toContain(A);
    expect(r.err).toContain(B);
    expect(r.paths).toEqual([]);
  });

  it('ignores a key saved for another origin', async () => {
    const r = await cli(['ls'], { keys: one.keys, origins: { [A]: 'https://other.test' } });
    expect(r.err).toContain('--drive ID is required');
    expect(r.paths).toEqual([]);
  });

  it('check keeps its own selection: a key authorized for B is checked, not the saved key for A', async () => {
    vi.stubEnv(
      `AGENT_DRIVE_KEY_${B.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`,
      generateDriveKey(),
    );
    const r = await cli(['check'], one, (path) =>
      path === 'whoami'
        ? { accountId: 'a', agentId: 'g', keyId: 'k', scopes: ['read'], driveIds: [B] }
        : { items: [], nextCursor: null },
    );
    expect(r.err).not.toContain(`drive ${A}`);
    expect(r.paths.some((p) => p.includes(`drives/${B}/`))).toBe(true);
    expect(r.paths.some((p) => p.includes(`drives/${A}/`))).toBe(false);
  });

  it('backup uses the current-origin key and ignores a foreign one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-bk-'));
    dirs.push(dir);
    await writeFile(join(dir, 'f.txt'), 'x');
    const mixed: Saved = {
      keys: { [A]: generateDriveKey(), [B]: generateDriveKey() },
      origins: { [A]: 'https://x.test', [B]: 'https://other.test' },
    };
    const r = await cli(['backup', dir, '--dry-run'], mixed);
    expect(r.err).not.toContain('--drive ID is required');
    const foreign = await cli(['backup', dir, '--dry-run'], {
      keys: { [B]: generateDriveKey() },
      origins: { [B]: 'https://other.test' },
    });
    expect(foreign.err).toContain('--drive ID is required');
  });
});

describe('sync flag validation', () => {
  it('rejects backup-only flags before any key or network lookup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-syncf-'));
    dirs.push(dir);
    await writeFile(join(dir, 'f.txt'), 'x');
    for (const flags of [['--dry-run'], ['--exclude', 'build/**'], ['--gitignore']]) {
      const r = await cli(['sync', dir, ...flags], one);
      expect(r.err).toContain(`sync does not support ${flags[0]}`);
      expect(r.err).toContain('use backup');
      // No connect() ran: no drive key lookup, no API call of any kind.
      expect(r.paths).toEqual([]);
    }
  });

  it('still syncs a folder normally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-syncok-'));
    dirs.push(dir);
    await writeFile(join(dir, 'f.txt'), 'x');
    const r = await cli(['sync', dir], one, (path, init) => {
      if (path === 'whoami')
        return {
          accountId: 'a',
          agentId: 'g',
          keyId: 'k',
          scopes: ['read', 'write'],
          driveIds: [A],
        };
      if (path === 'drives' || path.endsWith('/list')) return { items: [], nextCursor: null };
      if (path.endsWith('/put'))
        return {
          intentId: 'i1',
          uploadUrl: 'https://s3.test/x',
          ciphertextSize: (JSON.parse(String(init?.body)) as { ciphertextSize: number })
            .ciphertextSize,
        };
      if (path.endsWith('/commit')) return { version: { id: randomUUID(), path: '/f.txt' } };
      return {};
    });
    expect(r.err).toBe('');
    expect(r.out).toContain('"uploaded":1');
    expect(r.paths.some((p) => p.includes(`drives/${A}/commit`))).toBe(true);
  });
});

describe('sync interruption handling', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('maps %s to its conventional exit status after sync drains', async (signal, code) => {
    class TestSyncInterruptedError extends Error {
      constructor(readonly signalName: 'SIGINT' | 'SIGTERM') {
        super('sync interrupted');
        this.name = 'SyncInterruptedError';
      }
    }
    let observedSignal: AbortSignal | undefined;
    const syncDirectory = vi.fn(
      async (
        _client: unknown,
        _driveId: string,
        _localRoot: string,
        _prefix: string | undefined,
        options: { signal?: AbortSignal },
      ) => {
        observedSignal = options.signal;
        process.emit(signal);
        if (!options.signal?.aborted) throw new Error('CLI did not abort sync');
        throw new TestSyncInterruptedError(signal);
      },
    );
    vi.doMock('./sync.js', () => ({
      syncDirectory,
      SyncInterruptedError: TestSyncInterruptedError,
    }));
    const listenersBefore = process.listeners(signal);
    try {
      const result = await cli(['sync', '.', '--drive', A], one);
      expect(result.exitCode).toBe(code);
      expect(result.out).toBe('');
      expect(result.err).toContain(`Sync interrupted by ${signal}`);
      expect(observedSignal?.aborted).toBe(true);
      expect(process.listeners(signal)).toEqual(listenersBefore);
    } finally {
      vi.doUnmock('./sync.js');
      vi.resetModules();
    }
  });

  it('forces exit on a second termination signal', async () => {
    class TestSyncInterruptedError extends Error {
      constructor(readonly signalName: 'SIGINT' | 'SIGTERM') {
        super('sync interrupted');
        this.name = 'SyncInterruptedError';
      }
    }
    const syncDirectory = vi.fn(
      async (
        _client: unknown,
        _driveId: string,
        _localRoot: string,
        _prefix: string | undefined,
        options: { signal?: AbortSignal },
      ) => {
        process.emit('SIGINT');
        process.emit('SIGTERM');
        if (!options.signal?.aborted) throw new Error('CLI did not abort sync');
        throw new TestSyncInterruptedError('SIGINT');
      },
    );
    vi.doMock('./sync.js', () => ({
      syncDirectory,
      SyncInterruptedError: TestSyncInterruptedError,
    }));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await cli(['sync', '.', '--drive', A], one);
      expect(exit).toHaveBeenCalledWith(143);
    } finally {
      vi.doUnmock('./sync.js');
      vi.resetModules();
    }
  });
});

describe('binary stdin size validation', () => {
  it('rejects invalid or misplaced --size before loading a drive key or making a request', async () => {
    for (const [args, expected] of [
      [['put', '-', '/x', '--size=-1'], 'non-negative safe integer'],
      [['put', 'file.bin', '/x', '--size', '4'], 'only supported by `put -`'],
      [['whoami', '--size', '4'], 'only supported by `put -`'],
    ] as const) {
      const result = await cli([...args], one);
      expect(result.err).toContain(expected);
      expect(result.paths).toEqual([]);
    }
  });
});

describe('pipe command guard validation', () => {
  it('rejects --token-stdin outside login before connecting or consuming put stdin', async () => {
    const input = Readable.from([Buffer.from('synthetic-api-token')]);
    const stdinIterator = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockReturnValue(input[Symbol.asyncIterator]());
    const result = await cli(
      ['put', '-', '/token.txt', '--drive', A, '--token-stdin'],
      one,
      (path, init) => {
        if (path.endsWith('/put'))
          return {
            intentId: 'i1',
            uploadUrl: 'https://s3.test/x',
            ciphertextSize: (JSON.parse(String(init?.body)) as { ciphertextSize: number })
              .ciphertextSize,
          };
        if (path.endsWith('/commit')) return { version: { id: 'v1', path: '/token.txt' } };
        return {};
      },
    );

    expect(result.err).toContain('--token-stdin is only supported by `login`');
    expect(result.paths).toEqual([]);
    expect(stdinIterator).not.toHaveBeenCalled();

    const whoami = await cli(['whoami', '--token-stdin'], one);
    expect(whoami.err).toContain('--token-stdin is only supported by `login`');
    expect(whoami.paths).toEqual([]);
    expect(stdinIterator).not.toHaveBeenCalled();
  });

  it('rejects --token-stdin for capture before loading the wrapped-command runner', async () => {
    const captureLoaded = vi.fn();
    vi.doMock('./capture.js', () => {
      captureLoaded();
      return { runCapture: vi.fn(async () => 0) };
    });
    try {
      const result = await cli(['capture', '--token-stdin', '--', 'echo', 'ignored'], one);
      expect(result.err).toContain('--token-stdin is only supported by `login`');
      expect(captureLoaded).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./capture.js');
      vi.resetModules();
    }
  });

  it('keeps --token-stdin available to login', async () => {
    const result = await cli(
      ['login', '--api', 'https://x.test/api', '--token-stdin'],
      one,
      (path) => (path === 'whoami' ? { accountId: 'a', agentId: 'g', keyId: 'k' } : {}),
      { AGENT_DRIVE_API_KEY: 'login-token-fixture' },
    );
    expect(result.err).toContain('credential backups are out of date');
    expect(result.paths).toContain('whoami');
  });

  it('rejects empty and whitespace version guards before connecting', async () => {
    for (const value of ['', '   ']) {
      const put = await cli(
        ['put', '-', '/x', '--drive', A, '--size', '0', '--if-version', value],
        one,
      );
      expect(put.err).toContain('--if-version must not be empty');
      expect(put.paths).toEqual([]);

      const get = await cli(['get', '/x', '--drive', A, '--output', '-', '--version', value], one);
      expect(get.err).toContain('--version must not be empty');
      expect(get.paths).toEqual([]);
    }
  });

  it('keeps overwrite mutually exclusive with an explicit version and preserves restore versions', async () => {
    const conflict = await cli(
      ['put', '-', '/x', '--drive', A, '--size', '0', '--overwrite', '--if-version', 'v1'],
      one,
    );
    expect(conflict.err).toContain('--overwrite and --if-version are mutually exclusive');
    expect(conflict.paths).toEqual([]);

    const restored = await cli(['restore', '/x', '--drive', A, '--version', 'v1'], one, (path) => {
      if (path.endsWith('/restore')) return { version: { id: 'v2', path: '/x' } };
      return {};
    });
    const restoreCall = restored.calls.find(({ path }) => path.endsWith('/restore'));
    expect(restoreCall).toMatchObject({
      body: JSON.stringify({ path: '/x', versionId: 'v1' }),
    });
  });

  it('rejects a malformed selected drive key before spooling unknown-size stdin', async () => {
    const input = Readable.from([Buffer.from('synthetic-upload')]);
    const stdinIterator = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockReturnValue(input[Symbol.asyncIterator]());
    const result = await cli(['put', '-', '/x', '--drive', A], one, undefined, {
      AGENT_DRIVE_KEY: 'not-a-drive-key',
    });

    expect(result.err).toContain('Invalid drive key');
    expect(result.paths).toEqual([]);
    expect(stdinIterator).not.toHaveBeenCalled();
  });

  it('rejects a missing selected drive key before spooling unknown-size stdin', async () => {
    const input = Readable.from([Buffer.from('synthetic-upload')]);
    const stdinIterator = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockReturnValue(input[Symbol.asyncIterator]());
    const result = await cli(
      ['put', '-', '/x', '--drive', A],
      { keys: {}, origins: {} },
    );

    expect(result.err).toContain('Missing drive key');
    expect(result.paths).toEqual([]);
    expect(stdinIterator).not.toHaveBeenCalled();
  });

  it('validates the selected drive key before a known-size stdin upload too', async () => {
    const input = Readable.from([Buffer.from('synthetic-upload')]);
    const stdinIterator = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockReturnValue(input[Symbol.asyncIterator]());
    const result = await cli(['put', '-', '/x', '--drive', A, '--size', '15'], {
      keys: {},
      origins: {},
    });

    expect(result.err).toContain('Missing drive key');
    expect(result.paths).toEqual([]);
    expect(stdinIterator).not.toHaveBeenCalled();
  });
});

describe('credential origin binding at the command level', () => {
  const whoami = { accountId: 'a', agentId: 'g', keyId: 'k', scopes: ['read', 'write'] };

  it('sends no request — never the saved bearer — when env or --api selects another origin', async () => {
    const viaEnv = await cli(['whoami'], one, () => whoami, {
      AGENT_DRIVE_API_URL: 'https://other.test/api',
    });
    expect(viaEnv.err).toContain('API configuration is missing');
    expect(viaEnv.paths).toEqual([]);
    const viaFlag = await cli(['whoami', '--api', 'https://other.test/api'], one, () => whoami);
    expect(viaFlag.err).toContain('API configuration is missing');
    expect(viaFlag.paths).toEqual([]);
  });

  it('keeps the saved bearer when the selected URL stays on the saved origin', async () => {
    const r = await cli(['whoami'], one, () => ({ ...whoami, driveIds: [A] }), {
      AGENT_DRIVE_API_URL: 'https://x.test/other/path',
    });
    expect(r.err).toBe('');
    expect(r.paths.some((p) => p.includes('whoami'))).toBe(true);
  });

  it('connects to another origin only with an explicit environment key', async () => {
    const r = await cli(['whoami'], one, () => ({ ...whoami, driveIds: [] }), {
      AGENT_DRIVE_API_URL: 'https://other.test/api',
      AGENT_DRIVE_API_KEY: 'envtok',
    });
    expect(r.err).toBe('');
    expect(r.paths.some((p) => p.includes('whoami'))).toBe(true);
  });

  it('whoami reports a foreign-origin saved drive key as not held', async () => {
    const r = await cli(
      ['whoami'],
      { keys: one.keys, origins: { [A]: 'https://other.test' } },
      () => ({ ...whoami, driveIds: [A] }),
    );
    expect(r.err).toBe('');
    expect(r.out).toContain(`"${A}":false`);
  });
});

describe('automatic sealing follows the connection saved by the command', () => {
  it('seals same-origin environment-only keys with the saved connection', async () => {
    const savedKey = generateDriveKey();
    const envKey = generateDriveKey();
    const file = await credentialsFile({
      v: 1,
      apiUrl: 'https://production.test/api',
      apiKey: 'production-token',
      driveKeys: { [A]: savedKey },
      driveKeyOrigins: { [A]: 'https://production.test' },
    });
    const environment = encodeBundle({
      v: 1,
      apiUrl: 'https://production.test/api',
      apiKey: 'bundle-token',
      driveKeys: { [B]: envKey },
      driveKeyOrigins: { [B]: 'https://production.test' },
    });
    const account = await accountKeyPair();
    const r = await cli(['credentials', 'import', '--from', file], one, sealApi(account, [A, B]), {
      AGENT_DRIVE_API_URL: 'https://staging.test/api',
      AGENT_DRIVE_API_KEY: 'staging-token',
      AGENT_DRIVE_CREDENTIALS: environment,
    });

    expect(r.out).toContain('imported 1 drive key');
    expect(r.exitCode).toBeUndefined();
    expect(r.calls.length).toBeGreaterThan(0);
    expect(new Set(r.calls.map((call) => call.origin))).toEqual(
      new Set(['https://production.test']),
    );
    expect(new Set(r.calls.map((call) => call.authorization))).toEqual(
      new Set(['Bearer production-token']),
    );
    const opened = await openedSlots(r.calls, account);
    expect([...opened.keys()].sort()).toEqual([A, B].sort());
    expect(opened.get(A)).toBe(savedKey);
    expect(opened.get(B)).toBe(envKey);
  }, 15_000);

  it('uses the saved key when an environment bundle has a conflicting drive ID', async () => {
    const savedKey = generateDriveKey();
    const envKey = generateDriveKey();
    const file = await credentialsFile({
      v: 1,
      apiUrl: 'https://production.test/api',
      apiKey: 'production-token',
      driveKeys: { [A]: savedKey },
      driveKeyOrigins: { [A]: 'https://production.test' },
    });
    const account = await accountKeyPair();
    const r = await cli(['credentials', 'import', '--from', file], one, sealApi(account, [A]), {
      AGENT_DRIVE_CREDENTIALS: encodeBundle({
        v: 1,
        apiUrl: 'https://production.test/api',
        apiKey: 'bundle-token',
        driveKeys: { [A]: envKey },
        driveKeyOrigins: { [A]: 'https://production.test' },
      }),
    });

    const opened = await openedSlots(r.calls, account);
    expect(opened.get(A)).toBe(savedKey);
    expect(opened.get(A)).not.toBe(envKey);
  }, 15_000);

  it('does not seal an environment key bound to a different origin', async () => {
    const savedKey = generateDriveKey();
    const foreignKey = generateDriveKey();
    const file = await credentialsFile({
      v: 1,
      apiUrl: 'https://production.test/api',
      apiKey: 'production-token',
      driveKeys: { [A]: savedKey },
      driveKeyOrigins: { [A]: 'https://production.test' },
    });
    const account = await accountKeyPair();
    const r = await cli(['credentials', 'import', '--from', file], one, sealApi(account, [A, B]), {
      AGENT_DRIVE_CREDENTIALS: encodeBundle({
        v: 1,
        apiUrl: 'https://production.test/api',
        apiKey: 'bundle-token',
        driveKeys: { [B]: foreignKey },
        driveKeyOrigins: { [B]: 'https://foreign.test' },
      }),
    });

    expect(new Set(r.calls.map((call) => call.origin)).size).toBe(1);
    expect(new Set(r.calls.map((call) => call.authorization))).toEqual(
      new Set(['Bearer production-token']),
    );
    const opened = await openedSlots(r.calls, account);
    expect([...opened.keys()]).toEqual([A]);
    expect(opened.get(A)).toBe(savedKey);
  }, 15_000);

  it('keeps a malformed environment bundle from failing a successful import', async () => {
    const savedKey = generateDriveKey();
    const file = await credentialsFile({
      v: 1,
      apiUrl: 'https://production.test/api',
      apiKey: 'production-token',
      driveKeys: { [A]: savedKey },
      driveKeyOrigins: { [A]: 'https://production.test' },
    });
    const account = await accountKeyPair();
    const r = await cli(['credentials', 'import', '--from', file], one, sealApi(account, [A]), {
      AGENT_DRIVE_CREDENTIALS: 'not-a-valid-bundle',
    });

    expect(r.out).toContain('imported 1 drive key');
    expect(r.exitCode).toBeUndefined();
    expect(r.err).not.toContain('AGENT_DRIVE_CREDENTIALS is not a valid credentials bundle');
    expect((await openedSlots(r.calls, account)).get(A)).toBe(savedKey);
  }, 15_000);

  it('imports and seals with the bundle API when the shell URL points elsewhere', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-import-'));
    dirs.push(dir);
    const path = join(dir, 'credentials.bundle');
    await writeFile(
      path,
      encodeBundle({
        v: 1,
        apiUrl: 'https://production.test/api',
        apiKey: 'production-token',
        driveKeys: { [A]: generateDriveKey() },
        driveKeyOrigins: { [A]: 'https://production.test' },
      }),
    );
    const r = await cli(
      ['credentials', 'import', '--from', path],
      one,
      (endpoint) =>
        endpoint === 'drives'
          ? { items: [{ id: A, name: 'Research', agentOnly: false }], nextCursor: null }
          : {},
      { AGENT_DRIVE_API_URL: 'https://staging.test/api' },
    );
    expect(r.err).toContain('no account key yet');
    expect(r.origins.length).toBeGreaterThan(0);
    expect(new Set(r.origins)).toEqual(new Set(['https://production.test']));
  });
});

describe('credentials issue drive default', () => {
  const sink = { isTTY: false, write: async () => {} };
  async function prepare(origins: Record<string, string>, keys: string[]) {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-iss-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    vi.stubEnv('AGENT_DRIVE_KEY', '');
    await writeConfig({
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: Object.fromEntries(keys.map((id) => [id, generateDriveKey()])),
      driveKeyOrigins: origins,
    });
  }
  const createKey = vi.fn(async () => ({ id: 'k1', token: 'newtok' }));

  it('rejects when only a foreign-origin key exists', async () => {
    await prepare({ [B]: 'https://other.test' }, [B]);
    await expect(
      issueCredentials({ name: 'n', stdout: true }, sink, createKey as never),
    ).rejects.toThrow(/--drive ID is required/);
  });

  it('picks the one current-origin key beside a foreign one', async () => {
    await prepare({ [A]: 'https://x.test', [B]: 'https://other.test' }, [A, B]);
    await issueCredentials({ name: 'n', stdout: true }, sink, createKey as never);
    expect((createKey.mock.calls as unknown[][])[0]?.[2]).toEqual([A]);
  });

  it('refuses to seal an explicitly named foreign-origin drive key into the bundle', async () => {
    await prepare({ [B]: 'https://other.test' }, [B]);
    const issued = createKey.mock.calls.length;
    await expect(
      issueCredentials({ name: 'n', drive: B, stdout: true }, sink, createKey as never),
    ).rejects.toThrow(/no drive key/);
    expect(createKey.mock.calls.length).toBe(issued);
  });
});

describe('capture command', () => {
  async function capture(
    argv: string[],
    options: { saved?: Saved | 'none'; env?: Record<string, string> } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-capture-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    for (const name of [
      'AGENT_DRIVE_CREDENTIALS',
      'AGENT_DRIVE_API_URL',
      'AGENT_DRIVE_API_KEY',
      'AGENT_DRIVE_KEY',
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
    ])
      vi.stubEnv(name, '');
    for (const [name, value] of Object.entries(options.env ?? {})) vi.stubEnv(name, value);
    const saved = options.saved ?? one;
    if (saved !== 'none')
      await writeConfig({
        apiUrl: 'https://x.test/api',
        apiKey: 'tok',
        driveKeys: saved.keys,
        driveKeyOrigins: saved.origins,
      });
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true));
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', 'capture', ...argv]);
    process.exitCode = undefined;
    vi.resetModules();
    await import('./cli.js');
    await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined(), { timeout: 15_000 });
    return { err: err.join(''), dir, code: process.exitCode };
  }
  const dumpEnv = (file: string, code = 0) => [
    process.execPath,
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(process.env)); process.exit(${code})`,
  ];
  const disabled = (err: string) =>
    err.split('\n').filter((l) => l.startsWith('capture disabled:'));

  it('runs the child with both base URLs, passes its exit code, and leaves the parent env alone', async () => {
    const file = join(tmpdir(), `capture-env-${Date.now()}.json`);
    dirs.push(file);
    const r = await capture(['--drive', A, '--', ...dumpEnv(file, 3)]);
    expect(r.code).toBe(3);
    const env = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/anthropic$/u);
    expect(env.OPENAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/openai$/u);
    expect(process.env.ANTHROPIC_BASE_URL).toBe('');
    expect(process.env.OPENAI_BASE_URL).toBe('');
    expect(disabled(r.err)).toEqual([]);
    expect(r.err).toMatch(/capture: 0 uploaded, 0 queued .* 0 not captured \(none\), 0 invalid/u);
  });

  it('completely unconfigured: the child still runs, with one capture disabled line', async () => {
    const file = join(tmpdir(), `capture-env-u-${Date.now()}.json`);
    dirs.push(file);
    const r = await capture(['--', ...dumpEnv(file, 0)], { saved: 'none' });
    expect(r.code).toBe(0);
    const env = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL ?? '').toBe('');
    expect(disabled(r.err).length).toBe(1);
    expect(disabled(r.err)[0]).toContain('API configuration is missing');
  });

  it('configured but no drive key: the child runs unwrapped with one capture disabled line', async () => {
    const r = await capture(['--drive', B, '--', process.execPath, '-e', 'process.exit(0)']);
    expect(r.code).toBe(0);
    expect(disabled(r.err).length).toBe(1);
    expect(disabled(r.err)[0]).toContain('no drive key');
  });

  it('does not override an existing provider setting', async () => {
    const file = join(tmpdir(), `capture-env-o-${Date.now()}.json`);
    dirs.push(file);
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    const argsFile = join(bin, 'args.json');
    for (const name of ['claude', 'codex']) {
      await writeFile(
        join(bin, name),
        `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify({argv: process.argv.slice(2), env: process.env}));\n`,
        { mode: 0o755 },
      );
    }
    const claude = await capture(['--drive', A, '--', join(bin, 'claude'), 'hi'], {
      env: { ANTHROPIC_BASE_URL: 'http://gateway.test' },
    });
    expect(disabled(claude.err).length).toBe(1);
    expect(disabled(claude.err)[0]).toContain('ANTHROPIC_BASE_URL is already set');
    const seen = JSON.parse(await readFile(argsFile, 'utf8')) as { env: Record<string, string> };
    expect(seen.env.ANTHROPIC_BASE_URL).toBe('http://gateway.test');
    const codex = await capture(['--drive', A, '--', join(bin, 'codex'), 'exec'], {
      env: { OPENAI_BASE_URL: 'http://gateway.test' },
    });
    expect(disabled(codex.err).length).toBe(1);
    const profile = await capture(['--drive', A, '--', join(bin, 'codex'), '--profile', 'work']);
    expect(disabled(profile.err)[0]).toContain('--profile');
    expect((JSON.parse(await readFile(argsFile, 'utf8')) as { argv: string[] }).argv).toEqual([
      '--profile',
      'work',
    ]);
  });

  it('prepends the six provider flags for codex', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    const argsFile = join(bin, 'args.json');
    await writeFile(
      join(bin, 'codex'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const r = await capture(['--drive', A, '--', join(bin, 'codex'), 'exec', 'hello']);
    expect(r.code).toBe(0);
    const argv = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
    expect(argv.filter((a) => a === '-c').length).toBe(6);
    expect(argv.slice(-2)).toEqual(['exec', 'hello']);
    expect(argv).toContain('model_provider="agent_drive_capture"');
    expect(argv.some((a) => /base_url="http:\/\/127\.0\.0\.1:\d+\/openai\/v1"/u.test(a))).toBe(
      true,
    );
  });

  it('rejects a missing -- and an invalid --agent without running anything', async () => {
    const noSeparator = await capture(['--drive', A, 'echo']);
    expect(noSeparator.code).toBe(1);
    expect(noSeparator.err).toContain('Usage: capture');
    const bad = await capture(['--agent', 'Bad Name', '--', process.execPath, '-e', '0']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('--agent');
  });

  it('does not print a codex override value', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'agent-drive-bin-'));
    dirs.push(bin);
    await writeFile(join(bin, 'codex'), `#!${process.execPath}\n`, { mode: 0o755 });
    const r = await capture([
      '--drive',
      A,
      '--',
      join(bin, 'codex'),
      '-c',
      'model_providers.foo.experimental_bearer_token="SECRET-VALUE"',
    ]);
    expect(disabled(r.err).length).toBe(1);
    expect(r.err).not.toContain('SECRET-VALUE');
    expect(disabled(r.err)[0]).toContain('model_providers.foo.experimental_bearer_token');
  });

  it('runs the child when --help comes after --', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-help-'));
    dirs.push(dir);
    const marker = join(dir, 'ran.json');
    const script = join(dir, 'child.js');
    await writeFile(
      script,
      `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2))); process.exit(5);`,
    );
    const r = await capture(['--drive', A, '--', process.execPath, script, '--help']);
    expect(r.code).toBe(5);
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual(['--help']);
  });
});

describe('version', () => {
  const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
  it('prints the package version for --version and version', async () => {
    const flag = await cli(['--version'], one);
    expect(flag.out).toBe(`${version}\n`);
    expect(flag.err).toBe('');
    const command = await cli(['version'], one);
    expect(command.out).toBe(`${version}\n`);
    expect(command.err).toBe('');
  });
});

describe('CLI startup import isolation', () => {
  it('loads the MCP module only for mcp, not version or get commands', async () => {
    const loadMcp = vi.fn();
    const runMcp = vi.fn(async () => {});
    vi.doMock('./mcp.js', () => {
      loadMcp();
      return { runMcp };
    });
    vi.doMock('./capture.js', () => {
      throw new Error('capture module was loaded outside the capture command');
    });

    try {
      const version = await cli(['--version'], one);
      const { version: expectedVersion } = createRequire(import.meta.url)('../package.json') as {
        version: string;
      };
      expect(version.out.trim()).toBe(expectedVersion);
      expect(version.exitCode).toBeUndefined();
      expect(loadMcp).not.toHaveBeenCalled();

      const get = await cli(['get', '/x', '--drive', A, '--output', '-'], one);
      expect(get.exitCode).toBe(1);
      expect(get.err).not.toContain('capture module was loaded');
      expect(loadMcp).not.toHaveBeenCalled();

      process.exitCode = undefined;
      await cli(['mcp'], one);
      expect(loadMcp).toHaveBeenCalledTimes(1);
      expect(runMcp).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./mcp.js');
      vi.doUnmock('./capture.js');
      vi.resetModules();
    }
  });
});

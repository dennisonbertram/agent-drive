import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDriveKey } from './crypto.js';
import { readConfig, resolveConnection, resolveDriveKey, writeConfig } from './config.js';
import {
  decodeBundle,
  encodeBundle,
  confirmCredentials,
  exportCredentials,
  importCredentials,
  issueCredentials,
  buildBundle,
  reportEnvBackups,
  loadConfig,
  reportKeyBackup,
  REPORT_CONCURRENCY,
  unbackedUp,
} from './credentials.js';
import { backupCandidates, runCheck } from './check.js';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const IA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
  dirs.push(dir);
  vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
  vi.stubEnv('AGENT_DRIVE_CREDENTIALS', '');
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  const key = generateDriveKey();
  await writeConfig({
    apiUrl: 'https://x.test/api',
    apiKey: 'tok',
    driveKeys: { [D1]: key },
    driveKeyOrigins: { [D1]: 'https://x.test' },
  });
  return { dir, key };
}

const io = (isTTY: boolean) => {
  const out: string[] = [];
  return { isTTY, write: async (s: string) => void out.push(s), out };
};

describe('bundle', () => {
  it('round-trips', () => {
    const b = {
      v: 1 as const,
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: { [D1]: generateDriveKey() },
      driveKeyOrigins: { [D1]: 'https://x.test' },
    };
    const text = encodeBundle(b);
    expect(text.startsWith('adcred1.')).toBe(true);
    expect(decodeBundle(`${text}\n`)).toEqual(b);
    expect(() => decodeBundle('nope')).toThrow(/bundle/);
  });
});

describe('export', () => {
  it('refuses --stdout on a TTY and prints the bundle otherwise', async () => {
    await setup();
    await expect(exportCredentials({ stdout: true }, io(true))).rejects.toThrow(/terminal/);
    const pipe = io(false);
    const result = await exportCredentials({ stdout: true }, pipe);
    expect(result.method).toBe('stdout');
    expect(decodeBundle(pipe.out.join('')).apiKey).toBe('tok');
    // --stdout alone does not record a backup: only `credentials confirm` does.
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
    await confirmCredentials('stdout');
    expect((await readConfig()).keyBackup?.[D1]?.method).toBe('stdout');
  });

  it('fails when stdout cannot be written (EPIPE)', async () => {
    await setup();
    const broken = {
      isTTY: false,
      write: async () => {
        throw new Error('EPIPE');
      },
    };
    await expect(exportCredentials({ stdout: true }, broken)).rejects.toThrow(/EPIPE/);
    expect((await readConfig()).keyBackup?.[D1]).toBeUndefined();
  });

  it('refuses to write through a symlink and never follows it', async () => {
    const { dir } = await setup();
    const victim = join(dir, 'victim');
    await writeFile(victim, 'keep', { mode: 0o644 });
    const link = join(dir, 'link');
    await symlink(victim, link);
    await expect(exportCredentials({ to: link, force: true }, io(true))).rejects.toThrow(/symlink/);
    expect(await readFile(victim, 'utf8')).toBe('keep');
    expect((await stat(victim)).mode & 0o777).toBe(0o644);
  });

  it('writes --to with mode 600, refuses an existing path, and --force overwrites', async () => {
    const { dir } = await setup();
    const path = join(dir, 'bundle');
    const quiet = io(true);
    await exportCredentials({ to: path }, quiet);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(quiet.out.join('')).not.toContain('tok');
    await expect(exportCredentials({ to: path }, quiet)).rejects.toThrow(/exists/);
    await exportCredentials({ to: path, force: true }, quiet);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readConfig()).keyBackup?.[D1]?.method).toBe('file');
  });
});

describe('import', () => {
  it('merges into the existing config and records the backup', async () => {
    const { dir, key } = await setup();
    const other = generateDriveKey();
    await importCredentials(
      encodeBundle({
        v: 1,
        apiUrl: 'https://x.test/api',
        apiKey: 'new',
        driveKeys: { [D2]: other },
        driveKeyOrigins: { [D2]: 'https://x.test' },
      }),
      'file',
    );
    const config = await readConfig();
    expect(config.apiKey).toBe('new');
    expect(config.driveKeys).toEqual({ [D1]: key, [D2]: other });
    expect(config.keyBackup?.[D2]?.method).toBe('file');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AGENT_DRIVE_CREDENTIALS', () => {
  it('is merged in memory only and counts as backed up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    const configFile = join(dir, 'config.json');
    vi.stubEnv('AGENT_DRIVE_CONFIG', configFile);
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    const key = generateDriveKey();
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://env.test/api',
        apiKey: 'envtok',
        driveKeys: { [E1]: key },
        driveKeyOrigins: { [E1]: 'https://env.test' },
      }),
    );
    const connection = await resolveConnection();
    expect(connection.apiKey).toBe('envtok');
    expect(connection.config.driveKeys?.[E1]).toBe(key);
    expect(unbackedUp(await loadConfig(), [E1])).toEqual([]);
    await writeConfig({ driveKeys: { other: generateDriveKey() } });
    expect(await readFile(configFile, 'utf8')).not.toContain('envtok');
    expect(await readFile(configFile, 'utf8')).not.toContain(key);
  });

  it('loses to explicit environment variables', async () => {
    await setup();
    vi.stubEnv('AGENT_DRIVE_API_KEY', 'explicit');
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://e/api',
        apiKey: 'b',
        driveKeys: {},
        driveKeyOrigins: {},
      }),
    );
    expect((await resolveConnection()).apiKey).toBe('explicit');
  });

  it('never grafts a bundle bearer onto a saved URL of another origin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    await writeConfig({ apiUrl: 'https://a.test/api' });
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://b.test/api',
        apiKey: 'bundle-key',
        driveKeys: {},
        driveKeyOrigins: {},
      }),
    );
    // The effective URL is the saved origin; the bundle key must not attach to it.
    expect((await loadConfig()).apiKey).toBeUndefined();
    // Selecting the bundle origin serves the bundle key.
    vi.stubEnv('AGENT_DRIVE_API_URL', 'https://b.test/api');
    expect((await loadConfig()).apiKey).toBe('bundle-key');
  });

  it('backfills missing bundle drive-key origins with the bundle origin (legacy bundles)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    const key = generateDriveKey();
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://env.test/api',
        apiKey: 'envtok',
        driveKeys: { [E1]: key },
        driveKeyOrigins: {},
      }),
    );
    const config = await loadConfig();
    expect(config.driveKeyOrigins?.[E1]).toBe('https://env.test');
    expect(await resolveDriveKey(E1, 'https://env.test/api', undefined, config)).toBe(key);
    expect(await resolveDriveKey(E1, 'https://other.test/api', undefined, config)).toBeUndefined();
    expect(unbackedUp(config, [E1])).toEqual([]);
  });
});

describe('login replacing the API key', () => {
  it('clears backup records, which describe a stale bundle', async () => {
    await setup();
    await exportCredentials({ to: join(dirs[0]!, 'b') }, io(true));
    expect((await readConfig()).keyBackup?.[D1]).toBeTruthy();
    expect(await writeConfig({ apiKey: 'tok' })).toEqual({ backupsCleared: false });
    expect((await readConfig()).keyBackup?.[D1]).toBeTruthy();
    expect(await writeConfig({ apiKey: 'new' })).toEqual({ backupsCleared: true });
    expect((await readConfig()).keyBackup).toBeUndefined();
  });
});

describe('env bundle reporting', () => {
  it('reports only drives whose effective key and origin match the bundle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-drive-cred-'));
    dirs.push(dir);
    vi.stubEnv('AGENT_DRIVE_CONFIG', join(dir, 'config.json'));
    vi.stubEnv('AGENT_DRIVE_API_URL', '');
    vi.stubEnv('AGENT_DRIVE_API_KEY', '');
    const [a, b, c, d] = [1, 2, 3, 4].map(() => generateDriveKey());
    await writeConfig({ driveKeys: { [IB]: generateDriveKey() } });
    vi.stubEnv(
      'AGENT_DRIVE_CREDENTIALS',
      encodeBundle({
        v: 1,
        apiUrl: 'https://x.test/api',
        apiKey: 'k',
        driveKeys: { [IA]: a!, [IB]: b!, [IC]: c!, [ID]: d! },
        driveKeyOrigins: {
          [IA]: 'https://x.test',
          [IB]: 'https://x.test',
          [IC]: 'https://other.test',
          [ID]: 'https://x.test',
        },
      }),
    );
    vi.stubEnv('AGENT_DRIVE_KEY_DDDDDDDD_DDDD_4DDD_8DDD_DDDDDDDDDDDD', generateDriveKey());
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await reportEnvBackups('https://x.test/api', 'k', {
      fetch: fetcher as unknown as typeof fetch,
    });
    const urls = fetcher.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(urls).toEqual([`https://x.test/api/v1/drives/${IA}/key-backup`]);
  });
});

describe('review fixes', () => {
  const envBundleFor = (over: Partial<Parameters<typeof encodeBundle>[0]>, key: string) =>
    encodeBundle({
      v: 1,
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: { [D1]: key },
      driveKeyOrigins: { [D1]: 'https://x.test' },
      ...over,
    });

  it('a stale env bundle (different API key or origin) is not a backup', async () => {
    const { key } = await setup();
    await writeConfig({ driveKeys: { [D2]: generateDriveKey() } });
    for (const over of [{ apiKey: 'old' }, { apiUrl: 'https://other.test/api' }]) {
      vi.stubEnv('AGENT_DRIVE_CREDENTIALS', envBundleFor(over, key));
      expect(unbackedUp(await loadConfig(), [D1])).toEqual([D1]);
    }
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', envBundleFor({}, key));
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([]);
  });

  it('does not report a stale env bundle', async () => {
    const { key } = await setup();
    vi.stubEnv('AGENT_DRIVE_CREDENTIALS', envBundleFor({ apiKey: 'old' }, key));
    const fetcher = vi.fn(async () => new Response('{}'));
    vi.resetModules(); // reportEnvBackups reports once per process
    const fresh = await import('./credentials.js');
    await fresh.reportEnvBackups('https://x.test/api', 'tok', {
      fetch: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('confirm needs a matching pending export and records only its drives', async () => {
    await setup();
    await expect(confirmCredentials('stdout')).rejects.toThrow(/credentials export/);
    await exportCredentials({ stdout: true }, io(false));
    const pending = (await readConfig()).pendingExport;
    expect(pending?.apiKeyHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(pending)).not.toContain('tok');
    await writeConfig({ driveKeys: { [D2]: generateDriveKey() } });
    const result = await confirmCredentials('stdout');
    expect(result.driveIds).toEqual([D1]);
    const config = await readConfig();
    expect(config.keyBackup?.[D1]).toBeTruthy();
    expect(config.keyBackup?.[D2]).toBeUndefined();
    expect(config.pendingExport).toBeUndefined();
    await expect(confirmCredentials('stdout')).rejects.toThrow(/credentials export/);
  });

  it('confirm fails when the API key changed after the export', async () => {
    await setup();
    await exportCredentials({ stdout: true }, io(false));
    await writeConfig({ apiKey: 'rotated' });
    await expect(confirmCredentials('stdout')).rejects.toThrow(/credentials export/);
  });

  it('--key-file exempts only the checked drive from the backup requirement', () => {
    const keys = { [D1]: true, [D2]: true };
    expect(backupCandidates(keys, D1, '/k', {} as NodeJS.ProcessEnv)).toEqual([D2]);
    expect(backupCandidates(keys, D1, undefined, {} as NodeJS.ProcessEnv)).toEqual([D1, D2]);
  });

  it('rejects bundles with invalid fields', () => {
    const good = {
      v: 1 as const,
      apiUrl: 'https://x.test/api',
      apiKey: 'tok',
      driveKeys: { [D1]: generateDriveKey() },
      driveKeyOrigins: { [D1]: 'https://x.test' },
    };
    expect(() => decodeBundle(encodeBundle(good))).not.toThrow();
    for (const bad of [
      { apiUrl: 'http://evil.test/api' },
      { apiUrl: 'not a url' },
      { apiKey: '' },
      { apiKey: 'x'.repeat(5000) },
      { driveKeys: { [D1]: 'short' } },
      { driveKeys: { 'not-a-uuid': generateDriveKey() } },
    ])
      expect(() => decodeBundle(encodeBundle({ ...good, ...bad }))).toThrow(/bundle/);
    expect(() =>
      decodeBundle(encodeBundle({ ...good, apiUrl: 'http://localhost:3000/api' })),
    ).not.toThrow();
  });
});

describe('enforcement and reporting', () => {
  it('does not send the token to an insecure URL', async () => {
    const warn: string[] = [];
    const fetcher = vi.fn(async () => new Response('', { status: 200 }));
    await reportKeyBackup('http://evil.test/api', 'tok', [D1], 'file', {
      fetch: fetcher as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(warn.join('')).toMatch(new RegExp(D1));
  });

  it('lists drives with no backup record', async () => {
    const { key } = await setup();
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([D1]);
    await exportCredentials({ to: join(dirs[0]!, 'b') }, io(true));
    expect(unbackedUp(await loadConfig(), [D1])).toEqual([]);
    expect(key).toBeTruthy();
  });

  it('only warns when the report endpoint fails', async () => {
    const warn: string[] = [];
    const fail = vi.fn(async () => new Response('', { status: 404 }));
    await reportKeyBackup('https://x.test/api', 'tok', [D1], 'file', {
      fetch: fail as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(warn.join('')).toMatch(new RegExp(D1));
    expect(fail).toHaveBeenCalledWith(
      `https://x.test/api/v1/drives/${D1}/key-backup`,
      expect.objectContaining({ method: 'POST' }),
    );
    const boom = vi.fn(async () => {
      throw new Error('net');
    });
    await reportKeyBackup('https://x.test/api', 'tok', [D1], 'env', {
      fetch: boom as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(warn).toHaveLength(2);
  });

  it('stays silent when the key is not allowed to report (read-only key, HTTP 403)', async () => {
    const warn: string[] = [];
    const denied = vi.fn(async () => new Response('', { status: 403 }));
    await reportKeyBackup('https://x.test/api', 'tok', [D1], 'env', {
      fetch: denied as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(warn).toEqual([]);
  });

  it('reports a few drives at a time under one shared deadline', async () => {
    const ids = [IA, IB, IC, ID, E1, D1, D2];
    const slots: { signal: AbortSignal | null; resolve: (r: Response) => void }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Response>((resolve) => {
        slots.push({
          signal: (init?.signal as AbortSignal | undefined) ?? null,
          resolve: (r) => {
            inFlight -= 1;
            resolve(r);
          },
        });
      });
    });
    const warn: string[] = [];
    const done = reportKeyBackup('https://x.test/api', 'tok', ids, 'env', {
      fetch: fetcher as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    // Bounded workers: only REPORT_CONCURRENCY requests start before any response arrives.
    expect(fetcher).toHaveBeenCalledTimes(REPORT_CONCURRENCY);
    expect(maxInFlight).toBe(REPORT_CONCURRENCY);
    // One shared deadline: every request carries the same AbortSignal.
    expect(slots[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(new Set(slots.map((s) => s.signal)).size).toBe(1);
    // Overlap: resolving one frees a lane, and the next drive goes out in order.
    for (let i = REPORT_CONCURRENCY; i < ids.length; i += 1) {
      slots[i - REPORT_CONCURRENCY]!.resolve(new Response('{}', { status: 200 }));
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(i + 1));
    }
    for (const slot of slots.splice(0)) slot.resolve(new Response('{}', { status: 200 }));
    await done;
    expect(fetcher).toHaveBeenCalledTimes(ids.length);
    expect(warn).toEqual([]);
    expect(fetcher.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(
      ids.map((id) => `https://x.test/api/v1/drives/${id}/key-backup`),
    );
  });

  it('cuts every unreported drive when the shared deadline aborts', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const fetcher = vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
      });
      const warn: string[] = [];
      const ids = [IA, IB, IC, ID, E1, D1];
      const done = reportKeyBackup('https://x.test/api', 'tok', ids, 'env', {
        fetch: fetcher as unknown as typeof fetch,
        warn: (m) => warn.push(m),
      });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(REPORT_CONCURRENCY));
      controller.abort();
      await done;
      // The deadline never let the queued drives start a request.
      expect(fetcher).toHaveBeenCalledTimes(REPORT_CONCURRENCY);
      // Every unreported drive is a warning; none is silently dropped or claimed.
      expect(warn).toHaveLength(ids.length);
      for (const id of ids) expect(warn.join('\n')).toContain(id);
    } finally {
      timeout.mockRestore();
    }
  });

  it('warns only for reports that fail while the rest succeed', async () => {
    const resolveBy = new Map<string, (r: Response) => void>();
    const fetcher = vi.fn(
      (url: string) => new Promise<Response>((resolve) => resolveBy.set(url, resolve)),
    );
    const warn: string[] = [];
    const ids = [IA, IB, IC, ID, E1];
    const done = reportKeyBackup('https://x.test/api', 'tok', ids, 'env', {
      fetch: fetcher as unknown as typeof fetch,
      warn: (m) => warn.push(m),
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(REPORT_CONCURRENCY));
    const at = (id: string) => `https://x.test/api/v1/drives/${id}/key-backup`;
    resolveBy.get(at(IA))!(new Response('{}', { status: 500 }));
    resolveBy.get(at(IB))!(new Response('{}', { status: 200 }));
    resolveBy.get(at(IC))!(new Response('{}', { status: 403 }));
    resolveBy.get(at(ID))!(new Response('{}', { status: 200 }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(ids.length));
    resolveBy.get(at(E1))!(new Response('{}', { status: 200 }));
    await done;
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain(IA);
  });
});

void runCheck;
void writeFile;

describe('buildBundle and issue', () => {
  it('buildBundle keeps only the named drives and round-trips', async () => {
    const k1 = generateDriveKey();
    const text = buildBundle(
      {
        apiUrl: 'https://x.test/api',
        apiKey: 'new',
        driveKeys: { [D1]: k1, [D2]: generateDriveKey() },
        driveKeyOrigins: { [D1]: 'https://x.test', [D2]: 'https://x.test' },
      },
      [D1],
    );
    expect(decodeBundle(text)).toEqual({
      v: 1,
      apiUrl: 'https://x.test/api',
      apiKey: 'new',
      driveKeys: { [D1]: k1 },
      driveKeyOrigins: { [D1]: 'https://x.test' },
    });
  });

  const mint = () => {
    const calls: unknown[][] = [];
    const createKey = (async (...args: unknown[]) => {
      calls.push(args);
      return { id: 'key-1', token: 'adk_new' };
    }) as never;
    return { calls, createKey };
  };

  it('prints one env line with only the new key; the issuer token and config stay out', async () => {
    const { key } = await setup();
    const { calls, createKey } = mint();
    const pipe = io(false);
    const before = await readFile(process.env.AGENT_DRIVE_CONFIG!, 'utf8');
    const result = await issueCredentials(
      { name: 'sandbox-b', writePaths: ['/outputs'], machine: 'box', stdout: true },
      pipe,
      createKey,
    );
    const text = pipe.out.join('');
    expect(text.match(/\n/gu)).toHaveLength(1);
    expect(text.startsWith('AGENT_DRIVE_CREDENTIALS=adcred1.')).toBe(true);
    expect(text).not.toContain('tok');
    expect(decodeBundle(text.trim().replace('AGENT_DRIVE_CREDENTIALS=', ''))).toEqual({
      v: 1,
      apiUrl: 'https://x.test/api',
      apiKey: 'adk_new',
      driveKeys: { [D1]: key },
      driveKeyOrigins: { [D1]: 'https://x.test' },
    });
    expect(calls[0]).toEqual([
      undefined,
      'sandbox-b (issued by box)',
      [D1],
      ['read', 'write'],
      ['/outputs'],
      'sandbox-b',
    ]);
    expect(result.keyId).toBe('key-1');
    expect(await readFile(process.env.AGENT_DRIVE_CONFIG!, 'utf8')).toBe(before);
  });

  it('refuses a TTY without --to before minting anything', async () => {
    await setup();
    const { calls, createKey } = mint();
    await expect(
      issueCredentials({ name: 'b', stdout: true }, io(true), createKey),
    ).rejects.toThrow(/terminal/);
    expect(calls).toHaveLength(0);
  });

  it('writes --to with mode 600 and refuses an existing path before minting', async () => {
    const { dir } = await setup();
    const path = join(dir, 'issued');
    const { calls, createKey } = mint();
    await issueCredentials({ name: 'b', to: path }, io(true), createKey);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toMatch(/^AGENT_DRIVE_CREDENTIALS=adcred1\./u);
    await expect(issueCredentials({ name: 'b', to: path }, io(true), createKey)).rejects.toThrow(
      /exists/,
    );
    expect(calls).toHaveLength(1);
  });

  it('refuses a dangling symlink at --to before minting', async () => {
    const { dir } = await setup();
    const link = join(dir, 'dangling');
    await symlink(join(dir, 'nowhere'), link);
    const { calls, createKey } = mint();
    await expect(issueCredentials({ name: 'b', to: link }, io(true), createKey)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('refuses a malformed drive key before minting', async () => {
    await setup();
    await writeConfig({ driveKeys: { [D1]: 'not-a-key' } });
    const { calls, createKey } = mint();
    await expect(
      issueCredentials({ name: 'b', stdout: true }, io(false), createKey),
    ).rejects.toThrow(/drive key/);
    expect(calls).toHaveLength(0);
  });
});

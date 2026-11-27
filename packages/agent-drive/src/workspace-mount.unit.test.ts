import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorkspaceMount, workspaceMountDomainId } from './workspace-mount.js';

const WORKSPACE_A = 'account-1/sandbox-9/root';
const WORKSPACE_B = 'account-2/sandbox-9/root';

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
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-workspace-mount-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeHelper(directory: string, name: string, source: string) {
  const helper = join(directory, name);
  await writeFile(helper, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  await chmod(helper, 0o700);
  return helper;
}

const waitForSignal = `
process.on('SIGTERM', () => {
  clearInterval(hold);
  process.exit(0);
});
const hold = setInterval(() => {}, 1000);
`;

describe('workspace mount domain', () => {
  it('derives a stable lowercase UUID domain from the workspace identity', () => {
    const first = workspaceMountDomainId(WORKSPACE_A);
    expect(first).toBe(workspaceMountDomainId(WORKSPACE_A));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).not.toBe(workspaceMountDomainId(WORKSPACE_B));
    // Distinct mounts of distinct workspaces coexist as distinct Finder domains.
    expect(workspaceMountDomainId('account-1/sandbox-9/other-root')).not.toBe(first);
  });

  it('rejects workspace ids that cannot identify a domain', () => {
    for (const value of ['', 'has\0nul', 'x'.repeat(1025)]) {
      expect(() => workspaceMountDomainId(value)).toThrow('Invalid workspace id.');
    }
  });
});

describe('workspace mount on macOS', () => {
  it('connects the Finder helper with the derived workspace domain and provided dispatch', async () => {
    const directory = await fixture();
    const actualPath = join(directory, 'finder-root');
    await mkdir(actualPath);
    const requestedMountpoint = join(directory, 'requested-mount');
    const helper = await writeHelper(
      directory,
      'AgentDriveFinder.mjs',
      `
const { createInterface } = await import('node:readline');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const line = await new Promise((resolve) => input.once('line', resolve));
input.close();
const startup = JSON.parse(line);
if (startup.driveId !== ${JSON.stringify(workspaceMountDomainId(WORKSPACE_A))}) process.exit(41);
const endpoint = 'http://127.0.0.1:' + startup.port + '/rpc';
const headers = { authorization: 'Bearer ' + startup.token, 'content-type': 'application/json' };
const stat = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ id: 'ws-stat', op: 'stat', path: '/live.txt' }) });
const answer = await stat.json();
if (stat.status !== 200 || answer.id !== 'ws-stat' || answer.entry?.name !== 'live.txt') process.exit(42);
${waitForSignal}
process.stdout.write(JSON.stringify({ path: ${JSON.stringify(actualPath)}, protocolVersion: 2 }) + '\\n');
`,
    );
    vi.stubEnv('AGENT_DRIVE_FINDER_HELPER', helper);
    const dispatched: unknown[] = [];
    const handle = await startWorkspaceMount({
      workspaceId: WORKSPACE_A,
      mountPoint: requestedMountpoint,
      dispatch: async (request) => {
        dispatched.push(request);
        const rpc = request as { id: string };
        return {
          id: rpc.id,
          ok: true,
          entry: { name: 'live.txt', kind: 'file', size: 3, mtimeMs: 1 },
        };
      },
      platform: 'darwin',
    });

    expect(handle.platform).toBe('macos');
    expect(handle.domainId).toBe(workspaceMountDomainId(WORKSPACE_A));
    expect(handle.actualPath).toBe(actualPath);
    expect(await readlink(requestedMountpoint)).toBe(actualPath);
    expect(dispatched).toEqual([{ id: 'ws-stat', op: 'stat', path: '/live.txt' }]);

    await handle.close();
    expect(await handle.waitForExit()).toMatchObject({ code: 0 });
    await expect(lstat(requestedMountpoint)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);
});

describe('workspace mount on Linux', () => {
  it('serves helper requests through the provided dispatch and reports a clean exit', async () => {
    const directory = await fixture();
    const helper = await writeHelper(
      directory,
      'linux-helper',
      `
if (!process.argv.includes('--read-write')) process.exit(71);
process.stdout.write(JSON.stringify({ id: 7, op: 'list', path: '/' }) + '\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (!input.includes('\\n')) return;
  const response = JSON.parse(input.slice(0, input.indexOf('\\n')));
  process.exit(response.ok === true && response.id === 7 ? 0 : 72);
});
`,
    );
    const dispatched: unknown[] = [];
    const handle = await startWorkspaceMount({
      workspaceId: WORKSPACE_A,
      mountPoint: join(directory, 'mountpoint'),
      dispatch: async (request) => {
        dispatched.push(request);
        return { id: (request as { id: number }).id, ok: true, entries: [], nextCursor: null };
      },
      helperPath: helper,
      platform: 'linux',
    });

    expect(handle.platform).toBe('linux');
    expect(handle.domainId).toBeUndefined();
    expect(handle.actualPath).toBe(join(directory, 'mountpoint'));
    await expect(handle.waitForExit()).resolves.toEqual({ code: 0, signal: null });
    expect(dispatched).toEqual([{ id: 7, op: 'list', path: '/' }]);
  });

  it('enforces read-only locally and rewrites advertised capabilities', async () => {
    const directory = await fixture();
    const helper = await writeHelper(
      directory,
      'linux-helper',
      `
if (process.argv.includes('--read-write')) process.exit(71);
const write = () => new Promise((resolve, reject) => {
  process.stdout.write(JSON.stringify({ id: 1, op: 'write', handleId: 'h', offset: 0, data: 'AA==' }) + '\\n');
  process.stdin.once('data', (chunk) => resolve(JSON.parse(chunk.toString())));
});
const caps = () => new Promise((resolve) => {
  process.stdout.write(JSON.stringify({ id: 2, op: 'capabilities' }) + '\\n');
  process.stdin.once('data', (chunk) => resolve(JSON.parse(chunk.toString())));
});
(async () => {
  const refused = await write();
  if (refused.ok !== false || refused.errno !== 'EROFS') process.exit(72);
  const reported = await caps();
  const c = reported.capabilities;
  if (reported.ok !== true || c.readOnly !== true || c.write !== false || c.delete !== false) process.exit(73);
  if (JSON.stringify(c.ops) !== JSON.stringify(['stat', 'read'])) process.exit(74);
  process.exit(0);
})().catch(() => process.exit(75));
`,
    );
    const dispatch = vi.fn(async (request: unknown) => {
      const rpc = request as { id: number };
      if ((request as { op: string }).op === 'capabilities') {
        return {
          id: rpc.id,
          ok: true,
          capabilities: {
            readOnly: false,
            write: true,
            delete: true,
            writePaths: ['/docs'],
            maxReadBytes: 1048576,
            maxWriteBytes: 1048576,
            ops: ['stat', 'read', 'write'],
          },
        };
      }
      return { id: rpc.id, ok: true };
    });
    const handle = await startWorkspaceMount({
      workspaceId: WORKSPACE_A,
      mountPoint: join(directory, 'mountpoint'),
      readOnly: true,
      dispatch,
      helperPath: helper,
      platform: 'linux',
    });

    await expect(handle.waitForExit()).resolves.toEqual({ code: 0, signal: null });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ op: 'capabilities' });
  });

  it('stops the helper gracefully when the provided signal aborts', async () => {
    const directory = await fixture();
    const started = join(directory, 'started');
    const terminated = join(directory, 'terminated');
    const helper = await writeHelper(
      directory,
      'linux-helper',
      `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(started)}, 'ready');
process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(terminated)}, 'graceful');
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
    );
    const controller = new AbortController();
    const handle = await startWorkspaceMount({
      workspaceId: WORKSPACE_A,
      mountPoint: join(directory, 'mountpoint'),
      dispatch: async () => ({}),
      signal: controller.signal,
      helperPath: helper,
      platform: 'linux',
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await readFile(started, 'utf8');
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
    }
    await expect(readFile(started, 'utf8')).resolves.toBe('ready');

    controller.abort('SIGTERM');
    await expect(handle.waitForExit()).resolves.toEqual({ code: 0, signal: null });
    await expect(readFile(terminated, 'utf8')).resolves.toBe('graceful');
  }, 20_000);

  it('surfaces helper protocol failures through waitForExit and keeps close quiet', async () => {
    const directory = await fixture();
    const helper = await writeHelper(
      directory,
      'linux-helper',
      `
process.stdout.write('not-json\\n');
setInterval(() => {}, 1000);
`,
    );
    const handle = await startWorkspaceMount({
      workspaceId: WORKSPACE_A,
      mountPoint: join(directory, 'mountpoint'),
      dispatch: async () => ({}),
      helperPath: helper,
      platform: 'linux',
    });

    await expect(handle.waitForExit()).rejects.toThrow(
      'Mount helper sent malformed protocol data.',
    );
    await expect(handle.close()).resolves.toBeUndefined();
  });
});

describe('workspace mount validation', () => {
  it('requires an absolute mountpoint and never starts the helper', async () => {
    const dispatch = vi.fn(async () => ({}));
    await expect(
      startWorkspaceMount({
        workspaceId: WORKSPACE_A,
        mountPoint: 'relative/mount',
        dispatch,
        platform: 'linux',
      }),
    ).rejects.toThrow('Workspace mountpoint must be absolute.');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a mount that is canceled before it starts', async () => {
    const directory = await fixture();
    const started = join(directory, 'started');
    const helper = await writeHelper(
      directory,
      'linux-helper',
      `
require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started');
`,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      startWorkspaceMount({
        workspaceId: WORKSPACE_A,
        mountPoint: join(directory, 'mountpoint'),
        dispatch: async () => ({}),
        signal: controller.signal,
        helperPath: helper,
        platform: 'linux',
      }),
    ).rejects.toThrow();
    await expect(readFile(started, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects platforms without a workspace mount implementation', async () => {
    const directory = await fixture();
    await expect(
      startWorkspaceMount({
        workspaceId: WORKSPACE_A,
        mountPoint: join(directory, 'mountpoint'),
        dispatch: async () => ({}),
        platform: 'freebsd' as NodeJS.Platform,
      }),
    ).rejects.toThrow(/unavailable/);
  });
});

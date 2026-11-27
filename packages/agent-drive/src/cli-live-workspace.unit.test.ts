import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('./live-workspace.js');
  vi.doUnmock('./workspace-mount.js');
  vi.doUnmock('./workspace-wake.js');
  vi.resetModules();
  process.exitCode = undefined;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runCli(args: string[], registry?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-drive-live-cli-'));
  directories.push(directory);
  const configPath = join(directory, 'config.json');
  const registryPath = join(directory, 'mounts.json');
  if (registry !== undefined) await writeFile(registryPath, `${JSON.stringify(registry)}\n`);

  // A live workspace is local Instabox I/O and must not require saved Agent Drive credentials.
  vi.stubEnv('AGENT_DRIVE_CONFIG', configPath);
  vi.stubEnv('AGENT_DRIVE_API_URL', '');
  vi.stubEnv('AGENT_DRIVE_API_KEY', '');
  vi.stubEnv('AGENT_DRIVE_KEY', '');
  const fetchMock = vi.fn(async () => {
    throw new Error('live workspace CLI must not call the Agent Drive API');
  });
  vi.stubGlobal('fetch', fetchMock);

  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (value) => (stdout.push(String(value)), true),
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(
    (value) => (stderr.push(String(value)), true),
  );
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'agent-drive', ...args]);

  vi.resetModules();
  const cli = (await import('./cli.js')) as { done: Promise<void> };
  await cli.done;
  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    exitCode: process.exitCode,
    fetchMock,
    registryPath,
    configPath,
  };
}

function mockLiveMountRuntime() {
  const providerOptions: Record<string, unknown>[] = [];
  const mountOptions: Record<string, unknown>[] = [];
  const wakes: string[] = [];
  vi.doMock('./live-workspace.js', () => ({
    createLiveWorkspaceProvider: vi.fn(async (options: Record<string, unknown>) => {
      providerOptions.push(options);
      return {
        capabilities: {},
        dispatch: async (request: { id: string | number; op: string }) => {
          if (request.op !== 'capabilities')
            await (options.beforeIO as ((sandboxId: string) => Promise<void>) | undefined)?.(
              options.sandboxId as string,
            );
          return {
            id: request.id,
            ok: true,
            ...(request.op === 'capabilities' ? { capabilities: {} } : {}),
          };
        },
        close: vi.fn(async () => {}),
      };
    }),
  }));
  vi.doMock('./workspace-wake.js', () => ({
    createInstaboxWorkspaceWaker: vi.fn((options: { registeredMachineIds: string[] }) => ({
      wake: vi.fn(async (machineId: string) => {
        expect(options.registeredMachineIds).toEqual([machineId]);
        wakes.push(machineId);
        return 'already-running';
      }),
    })),
  }));
  vi.doMock('./workspace-mount.js', () => ({
    startWorkspaceMount: vi.fn(async (options: Record<string, unknown>) => {
      mountOptions.push(options);
      const dispatch = options.dispatch as (request: {
        id: string;
        op: string;
        path?: string;
      }) => Promise<unknown>;
      await dispatch({ id: 'cap', op: 'capabilities' });
      await dispatch({ id: 'root', op: 'list', path: '/' });
      return {
        waitForExit: async () => ({ code: 0, signal: null }),
        close: vi.fn(async () => {}),
      };
    }),
  }));
  return { providerOptions, mountOptions, wakes };
}

describe('live workspace CLI registration', () => {
  it('persists and starts a named local sandbox/root mount without cloud credentials', async () => {
    const runtime = mockLiveMountRuntime();
    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'instabox-coordinator-42',
      '--root',
      '/workspace/project',
    ]);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    const registry = JSON.parse(await readFile(result.registryPath, 'utf8')) as {
      mounts: Array<Record<string, unknown>>;
    };
    expect(registry.mounts).toHaveLength(1);
    expect(registry.mounts[0]).toMatchObject({
      kind: 'live-workspace',
      name: 'coordinator',
      mountpoint: '/tmp/agent-drive-coordinator',
      sandboxId: 'instabox-coordinator-42',
      root: '/workspace/project',
      readOnly: false,
      wakeOnAccess: true,
    });
    expect(registry.mounts[0]).not.toHaveProperty('driveId');
    expect(registry.mounts[0]).not.toHaveProperty('apiUrl');
    expect(runtime.mountOptions[0]).toMatchObject({
      mountPoint: '/tmp/agent-drive-coordinator',
      readOnly: false,
      workspaceId: JSON.stringify(['instabox-coordinator-42', '/workspace/project']),
    });
    expect(runtime.wakes).toEqual(['instabox-coordinator-42']);
  });

  it('rejects a duplicate local name instead of replacing its binding', async () => {
    const existing = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/old-coordinator',
          sandboxId: 'instabox-old',
          root: '/workspace/old',
          readOnly: false,
        },
      ],
    };
    const result = await runCli(
      [
        'connect',
        'coordinator',
        '/tmp/new-coordinator',
        '--sandbox',
        'instabox-new',
        '--root',
        '/workspace/new',
      ],
      existing,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/already registered/i);
    expect(JSON.parse(await readFile(result.registryPath, 'utf8'))).toEqual(existing);
    expect(result.fetchMock).not.toHaveBeenCalled();
  });

  it('lets a new connection opt out of wake-on-access', async () => {
    const runtime = mockLiveMountRuntime();
    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'instabox-coordinator-42',
      '--root',
      '/workspace/project',
      '--no-wake-on-access',
    ]);

    const registry = JSON.parse(await readFile(result.registryPath, 'utf8')) as {
      mounts: Array<Record<string, unknown>>;
    };
    expect(registry.mounts[0]).toMatchObject({ wakeOnAccess: false });
    expect(runtime.wakes).toEqual([]);
    expect(result.fetchMock).not.toHaveBeenCalled();
  });

  it('accepts explicit wake-on-access and rejects contradictory wake flags', async () => {
    const runtime = mockLiveMountRuntime();
    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'instabox-coordinator-42',
      '--root',
      '/workspace/project',
      '--wake-on-access',
    ]);
    expect(result.exitCode).toBeUndefined();
    expect(runtime.wakes).toEqual(['instabox-coordinator-42']);

    const contradiction = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'instabox-coordinator-42',
      '--root',
      '/workspace/project',
      '--wake-on-access',
      '--no-wake-on-access',
    ]);
    expect(contradiction.exitCode).toBe(1);
    expect(contradiction.stderr).toMatch(/only one/i);
    expect(contradiction.fetchMock).not.toHaveBeenCalled();
  });

  it('changes a saved wake setting locally without starting a sandbox', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'instabox-coordinator-42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
        },
      ],
    };
    const result = await runCli(['mounts', 'wake', 'coordinator', 'off'], registry);
    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toMatchObject({ wakeOnAccess: false });
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts[0]).toMatchObject({
      wakeOnAccess: false,
    });
  });

  it('installs and starts a persistent mount when connect is given --persist', async () => {
    const runtime = mockLiveMountRuntime();
    const install = vi.fn(async () => ({ state: 'installed', path: '/private/service' }));
    const activate = vi.fn(async () => {});
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: true });
    vi.doMock('./workspace-service.js', () => ({
      installWorkspaceService: install,
      activateWorkspaceService: activate,
      getWorkspaceServiceRuntimeStatus: getStatus,
    }));

    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'instabox-coordinator-42',
      '--root',
      '/workspace/project',
      '--persist',
    ]);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'coordinator',
        cliPath: expect.stringMatching(/^\//u),
        configPath: result.configPath,
      }),
    );
    expect(activate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toMatchObject({
      state: 'installed',
      active: true,
    });
    expect(runtime.mountOptions).toEqual([]);
  });

  it('lists registered live workspaces without calling the cloud API or waking a sandbox', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'instabox-coordinator-42',
          root: '/workspace/project',
          readOnly: false,
        },
      ],
    };
    const createWaker = vi.fn();
    vi.doMock('./workspace-wake.js', () => ({ createInstaboxWorkspaceWaker: createWaker }));
    const result = await runCli(['mounts', 'list'], registry);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(result.stdout).toContain('instabox-coordinator-42');
    expect(result.stdout).toContain('/workspace/project');
    expect(createWaker).not.toHaveBeenCalled();
  });

  it('mounts only the selected live workspace and wakes it only when explicitly enabled', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'instabox-coordinator-42',
          root: '/workspace/coordinator',
          readOnly: false,
          wakeOnAccess: true,
        },
        {
          kind: 'live-workspace',
          name: 'subagent',
          mountpoint: '/tmp/agent-drive-subagent',
          sandboxId: 'instabox-subagent-12',
          root: '/workspace/subagent',
          readOnly: true,
          wakeOnAccess: false,
        },
      ],
    };
    const providerOptions: Record<string, unknown>[] = [];
    const mountOptions: Record<string, unknown>[] = [];
    const wakes: string[] = [];
    const closeProvider = vi.fn(async () => {});
    vi.doMock('./live-workspace.js', () => ({
      createLiveWorkspaceProvider: vi.fn(async (options: Record<string, unknown>) => {
        providerOptions.push(options);
        return {
          capabilities: {},
          dispatch: async (request: { id: string | number; op: string }) => {
            if (request.op !== 'capabilities')
              await (providerOptions[0]!.beforeIO as (sandboxId: string) => Promise<void>)(
                'instabox-coordinator-42',
              );
            return {
              id: request.id,
              ok: true,
              ...(request.op === 'capabilities' ? { capabilities: {} } : {}),
            };
          },
          close: closeProvider,
        };
      }),
    }));
    vi.doMock('./workspace-wake.js', () => ({
      createInstaboxWorkspaceWaker: vi.fn((options: { registeredMachineIds: string[] }) => ({
        wake: vi.fn(async (machineId: string) => {
          expect(options.registeredMachineIds).toEqual(['instabox-coordinator-42']);
          wakes.push(machineId);
          return 'already-running';
        }),
      })),
    }));
    vi.doMock('./workspace-mount.js', () => ({
      startWorkspaceMount: vi.fn(async (options: Record<string, unknown>) => {
        mountOptions.push(options);
        const dispatch = options.dispatch as (request: {
          id: string;
          op: string;
          path?: string;
        }) => Promise<unknown>;
        await dispatch({ id: 'cap', op: 'capabilities' });
        await dispatch({ id: 'root', op: 'list', path: '/' });
        return {
          waitForExit: async () => ({ code: 0, signal: null }),
          close: vi.fn(async () => {}),
        };
      }),
    }));

    const result = await runCli(['mount', '--name', 'coordinator'], registry);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(providerOptions).toHaveLength(1);
    expect(providerOptions[0]).toMatchObject({
      sandboxId: 'instabox-coordinator-42',
      root: '/workspace/coordinator',
    });
    expect(mountOptions[0]).toMatchObject({
      mountPoint: '/tmp/agent-drive-coordinator',
      readOnly: false,
      workspaceId: JSON.stringify(['instabox-coordinator-42', '/workspace/coordinator']),
    });
    expect(wakes).toEqual(['instabox-coordinator-42']);
    expect(closeProvider).toHaveBeenCalledTimes(1);
  });

  it('installs and activates the named login service without contacting Instabox or the cloud', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'instabox-coordinator-42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: false,
        },
      ],
    };
    const install = vi.fn(async () => ({ state: 'installed', path: '/private/service' }));
    const activate = vi.fn(async () => {});
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: true });
    vi.doMock('./workspace-service.js', () => ({
      installWorkspaceService: install,
      activateWorkspaceService: activate,
      getWorkspaceServiceRuntimeStatus: getStatus,
    }));

    const result = await runCli(['mounts', 'service', 'install', 'coordinator'], registry);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'coordinator', cliPath: expect.stringMatching(/^\//u) }),
    );
    expect(activate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: 'installed', active: true });
  });
});

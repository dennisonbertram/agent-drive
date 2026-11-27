import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  vi.doUnmock('./workspace-service.js');
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

function mockLiveMountRuntime(runtimeOptions: { mountError?: Error } = {}) {
  const providerOptions: Record<string, unknown>[] = [];
  const mountOptions: Record<string, unknown>[] = [];
  const wakes: string[] = [];
  const availabilityChecks: Array<{ machineId: string; wakeOnAccess: boolean }> = [];
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
      ensureAvailable: vi.fn(async (machineId: string, request: { wakeOnAccess: boolean }) => {
        expect(options.registeredMachineIds).toEqual([machineId]);
        availabilityChecks.push({ machineId, wakeOnAccess: request.wakeOnAccess });
        if (request.wakeOnAccess) wakes.push(machineId);
        return 'already-running';
      }),
    })),
  }));
  vi.doMock('./workspace-mount.js', () => ({
    workspaceMountDomainId: () => 'test-domain-id',
    startWorkspaceMount: vi.fn(async (options: Record<string, unknown>) => {
      if (runtimeOptions.mountError) throw runtimeOptions.mountError;
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
  return { providerOptions, mountOptions, wakes, availabilityChecks };
}

describe('live workspace CLI registration', () => {
  it('persists and starts a named local sandbox/root mount without cloud credentials', async () => {
    const runtime = mockLiveMountRuntime();
    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'm_coordinator42',
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
      sandboxId: 'm_coordinator42',
      root: '/workspace/project',
      readOnly: false,
      wakeOnAccess: true,
    });
    expect(registry.mounts[0]).not.toHaveProperty('driveId');
    expect(registry.mounts[0]).not.toHaveProperty('apiUrl');
    expect(runtime.mountOptions[0]).toMatchObject({
      mountPoint: '/tmp/agent-drive-coordinator',
      readOnly: false,
      workspaceId: JSON.stringify(['m_coordinator42', '/workspace/project']),
    });
    expect(runtime.wakes).toEqual(['m_coordinator42']);
  });

  it('releases the just-created registration when foreground mount startup fails', async () => {
    mockLiveMountRuntime({ mountError: new Error('synthetic mount startup failure') });
    const result = await runCli([
      'connect',
      'recoverable',
      '/tmp/agent-drive-recoverable',
      '--sandbox',
      'm_recoverable42',
      '--root',
      '/workspace/project',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('synthetic mount startup failure');
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts).toEqual([]);
  });

  it('forgets an offline live workspace without changing remote state', async () => {
    vi.doMock('./workspace-service.js', () => ({
      getWorkspaceServiceRuntimeStatus: vi.fn(async () => ({
        state: 'missing',
        path: '/private/synthetic-service',
        active: false,
      })),
    }));
    const mountDir = await mkdtemp(join(tmpdir(), 'agent-drive-forget-free-'));
    directories.push(mountDir);
    const existing = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: join(mountDir, 'mount'),
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
          registeredAt: '2026-11-27T12:00:00.000Z',
        },
      ],
    };

    const result = await runCli(['mounts', 'forget', 'coordinator'], existing);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({ forgotten: 'coordinator' });
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts).toEqual([]);
  });

  it('refuses to forget a live workspace with an installed login service', async () => {
    vi.doMock('./workspace-service.js', () => ({
      getWorkspaceServiceRuntimeStatus: vi.fn(async () => ({
        state: 'installed',
        path: '/private/synthetic-service',
        active: false,
      })),
    }));
    const existing = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-forget-service-coordinator',
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
          registeredAt: '2026-11-27T12:00:00.000Z',
        },
      ],
    };

    const result = await runCli(['mounts', 'forget', 'coordinator'], existing);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/login service is installed/i);
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts).toHaveLength(1);
  });

  it('refuses to forget a live workspace while a mountpoint alias is present', async () => {
    vi.doMock('./workspace-service.js', () => ({
      getWorkspaceServiceRuntimeStatus: vi.fn(async () => ({
        state: 'missing',
        path: '/private/synthetic-service',
        active: false,
      })),
    }));
    const directory = await mkdtemp(join(tmpdir(), 'agent-drive-forget-mounted-'));
    directories.push(directory);
    const target = join(directory, 'actual');
    const alias = join(directory, 'alias');
    await mkdir(target);
    await symlink(target, alias);
    const existing = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: alias,
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
          registeredAt: '2026-11-27T12:00:00.000Z',
        },
      ],
    };

    const result = await runCli(['mounts', 'forget', 'coordinator'], existing);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Finder mountpoint is present|cannot safely verify/i);
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts).toHaveLength(1);
  });

  it('rejects a duplicate local name instead of replacing its binding', async () => {
    const existing = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/old-coordinator',
          sandboxId: 'm_old',
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
        'm_new',
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
      'm_coordinator42',
      '--root',
      '/workspace/project',
      '--no-wake-on-access',
    ]);

    const registry = JSON.parse(await readFile(result.registryPath, 'utf8')) as {
      mounts: Array<Record<string, unknown>>;
    };
    expect(registry.mounts[0]).toMatchObject({ wakeOnAccess: false });
    expect(runtime.wakes).toEqual([]);
    expect(runtime.availabilityChecks).toEqual([
      { machineId: 'm_coordinator42', wakeOnAccess: false },
    ]);
    expect(result.fetchMock).not.toHaveBeenCalled();
  });

  it('accepts explicit wake-on-access and rejects contradictory wake flags', async () => {
    const runtime = mockLiveMountRuntime();
    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'm_coordinator42',
      '--root',
      '/workspace/project',
      '--wake-on-access',
    ]);
    expect(result.exitCode).toBeUndefined();
    expect(runtime.wakes).toEqual(['m_coordinator42']);

    const contradiction = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'm_coordinator42',
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
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
        },
      ],
    };
    vi.doMock('./workspace-service.js', () => ({
      resolveInstaboxExecutable: () => '/opt/instabox/bin/instabox',
      getWorkspaceServiceRuntimeStatus: vi.fn(async () => ({
        state: 'missing',
        path: '/private/service',
        active: false,
      })),
    }));
    const result = await runCli(['mounts', 'wake', 'coordinator', 'off'], registry);
    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toMatchObject({ wakeOnAccess: false });
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts[0]).toMatchObject({
      wakeOnAccess: false,
    });
  });

  it('restarts only the active owned service when its wake policy changes', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
        },
      ],
    };
    const restart = vi.fn(async () => ({ restarted: true, active: true }));
    const status = vi.fn(async () => ({
      state: 'installed',
      path: '/private/service',
      active: true,
    }));
    const waitReady = vi.fn(async () => ({
      ready: true,
      mountpoint: '/tmp/agent-drive-coordinator',
    }));
    vi.doMock('./workspace-service.js', () => ({
      resolveInstaboxExecutable: () => '/opt/instabox/bin/instabox',
      getWorkspaceServiceRuntimeStatus: status,
      restartWorkspaceService: restart,
    }));
    vi.doMock('./workspace-service-readiness.js', () => ({
      waitForWorkspaceMountReadiness: waitReady,
    }));

    const result = await runCli(['mounts', 'wake', 'coordinator', 'off'], registry);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'coordinator', instaboxPath: '/opt/instabox/bin/instabox' }),
    );
    expect(waitReady).toHaveBeenCalledWith(
      expect.objectContaining({ mountpoint: '/tmp/agent-drive-coordinator' }),
    );
    expect(JSON.parse(result.stdout)).toMatchObject({ wakeOnAccess: false });
  });

  it('does not change saved wake policy when service ownership cannot be verified', async () => {
    const registry = {
      version: 1,
      mounts: [
        {
          kind: 'live-workspace',
          name: 'coordinator',
          mountpoint: '/tmp/agent-drive-coordinator',
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: true,
        },
      ],
    };
    vi.doMock('./workspace-service.js', () => ({
      resolveInstaboxExecutable: () => '/opt/instabox/bin/instabox',
      getWorkspaceServiceRuntimeStatus: vi.fn(async () => ({
        state: 'conflict',
        path: '/private/service',
        active: false,
      })),
    }));

    const result = await runCli(['mounts', 'wake', 'coordinator', 'off'], registry);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not the exact owned definition/i);
    expect(JSON.parse(await readFile(result.registryPath, 'utf8')).mounts[0]).toMatchObject({
      wakeOnAccess: true,
    });
  });

  it('installs and starts a persistent mount when connect is given --persist', async () => {
    const runtime = mockLiveMountRuntime();
    const install = vi.fn(async () => ({
      state: 'installed',
      path: '/private/service',
      updated: false,
    }));
    const activate = vi.fn(async () => {});
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: true });
    vi.doMock('./workspace-service.js', () => ({
      resolveInstaboxExecutable: () => '/opt/instabox/bin/instabox',
      installWorkspaceService: install,
      activateWorkspaceService: activate,
      getWorkspaceServiceRuntimeStatus: getStatus,
    }));
    const waitReady = vi.fn(async () => ({
      ready: true,
      mountpoint: '/tmp/agent-drive-coordinator',
    }));
    vi.doMock('./workspace-service-readiness.js', () => ({
      waitForWorkspaceMountReadiness: waitReady,
    }));

    const result = await runCli([
      'connect',
      'coordinator',
      '/tmp/agent-drive-coordinator',
      '--sandbox',
      'm_coordinator42',
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
        instaboxPath: '/opt/instabox/bin/instabox',
      }),
    );
    expect(activate).toHaveBeenCalledTimes(1);
    expect(waitReady).toHaveBeenCalledWith(
      expect.objectContaining({ mountpoint: '/tmp/agent-drive-coordinator' }),
    );
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
          sandboxId: 'm_coordinator42',
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
    expect(result.stdout).toContain('m_coordinator42');
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
          sandboxId: 'm_coordinator42',
          root: '/workspace/coordinator',
          readOnly: false,
          wakeOnAccess: true,
        },
        {
          kind: 'live-workspace',
          name: 'subagent',
          mountpoint: '/tmp/agent-drive-subagent',
          sandboxId: 'm_subagent12',
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
                'm_coordinator42',
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
        ensureAvailable: vi.fn(async (machineId: string, request: { wakeOnAccess: boolean }) => {
          expect(options.registeredMachineIds).toEqual(['m_coordinator42']);
          if (machineId !== 'm_coordinator42') throw new Error('wrong sandbox');
          if (request.wakeOnAccess) wakes.push(machineId);
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
      sandboxId: 'm_coordinator42',
      root: '/workspace/coordinator',
    });
    expect(mountOptions[0]).toMatchObject({
      mountPoint: '/tmp/agent-drive-coordinator',
      readOnly: false,
      workspaceId: JSON.stringify(['m_coordinator42', '/workspace/coordinator']),
    });
    expect(wakes).toEqual(['m_coordinator42']);
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
          sandboxId: 'm_coordinator42',
          root: '/workspace/project',
          readOnly: false,
          wakeOnAccess: false,
        },
      ],
    };
    const install = vi.fn(async () => ({
      state: 'installed',
      path: '/private/service',
      updated: false,
    }));
    const activate = vi.fn(async () => {});
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: false })
      .mockResolvedValueOnce({ state: 'installed', path: '/private/service', active: true });
    vi.doMock('./workspace-service.js', () => ({
      resolveInstaboxExecutable: () => '/opt/instabox/bin/instabox',
      installWorkspaceService: install,
      activateWorkspaceService: activate,
      getWorkspaceServiceRuntimeStatus: getStatus,
    }));
    vi.doMock('./workspace-service-readiness.js', () => ({
      waitForWorkspaceMountReadiness: vi.fn(async () => ({
        ready: true,
        mountpoint: '/tmp/agent-drive-coordinator',
      })),
    }));

    const result = await runCli(['mounts', 'service', 'install', 'coordinator'], registry);

    expect(result.exitCode).toBeUndefined();
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'coordinator',
        cliPath: expect.stringMatching(/^\//u),
        instaboxPath: '/opt/instabox/bin/instabox',
      }),
    );
    expect(activate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: 'installed', active: true });
  });
});

import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getWorkspaceServiceStatus,
  installWorkspaceService,
  activateWorkspaceService,
  deactivateWorkspaceService,
  getWorkspaceServiceRuntimeStatus,
  removeWorkspaceService,
  renderWorkspaceService,
  resolveInstaboxExecutable,
  restartWorkspaceService,
  workspaceServicePaths,
} from './workspace-service.js';

const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'agent-drive-service-'));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('persistent workspace service definitions', () => {
  it('renders argv-safe launchd and systemd definitions without shell or environment secrets', () => {
    const mac = renderWorkspaceService({
      platform: 'darwin',
      cliPath: '/Applications/Agent Drive/bin/cli.js',
      nodePath: '/opt/node/bin/node',
      instaboxPath: '/Users/alice/.local/lib/node_modules/instabox/bin/instabox.mjs',
      configPath: '/Users/alice/.config/agent-drive/custom.json',
      name: 'team-work',
    });
    expect(mac).toContain('<string>/Applications/Agent Drive/bin/cli.js</string>');
    expect(mac).toContain('<string>team-work</string>');
    expect(mac).toContain(
      '<key>PATH</key><string>/opt/node/bin:/Users/alice/.local/lib/node_modules/instabox/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>',
    );
    expect(mac).toContain('<!-- agent-drive-workspace-service:v1:team-work -->');
    expect(mac).toContain(
      '<key>AGENT_DRIVE_INSTABOX_CLI</key><string>/Users/alice/.local/lib/node_modules/instabox/bin/instabox.mjs</string>',
    );
    expect(mac).toContain(
      '<key>AGENT_DRIVE_CONFIG</key><string>/Users/alice/.config/agent-drive/custom.json</string>',
    );
    expect(mac).not.toContain('sh -c');
    expect(mac).not.toContain('API_KEY');
    const linux = renderWorkspaceService({
      platform: 'linux',
      cliPath: '/home/alice/Agent Drive/cli.js',
      nodePath: '/usr/bin/node',
      instaboxPath: '/home/alice/.local/bin/instabox',
      configPath: '/home/alice/.config/agent-drive/custom.json',
      name: 'team-work',
    });
    expect(linux).toContain(
      'ExecStart="/usr/bin/node" "/home/alice/Agent Drive/cli.js" "mount" "--name" "team-work"',
    );
    expect(linux).toContain(
      'Environment="PATH=/usr/bin:/home/alice/.local/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin"',
    );
    expect(linux).toContain('# agent-drive-workspace-service:v1:team-work');
    expect(linux).toContain(
      'Environment="AGENT_DRIVE_INSTABOX_CLI=/home/alice/.local/bin/instabox"',
    );
    expect(linux).toContain(
      'Environment="AGENT_DRIVE_CONFIG=/home/alice/.config/agent-drive/custom.json"',
    );
    expect(linux).not.toContain('After=default.target');
    expect(linux).not.toContain('sh -c');
    expect(linux).not.toContain('API_KEY');
    const escaped = renderWorkspaceService({
      platform: 'linux',
      cliPath: '/home/alice$staff/Agent Drive/cli.js',
      nodePath: '/home/alice$staff/node/bin/node',
      instaboxPath: '/home/alice$staff/.local/bin/instabox',
      name: 'work',
    });
    expect(escaped).toContain('"/home/alice$$staff/node/bin/node"');
    expect(escaped).toContain(
      'Environment="PATH=/home/alice$$staff/node/bin:/home/alice$$staff/.local/bin:',
    );
    expect(escaped).toContain(
      'Environment="AGENT_DRIVE_INSTABOX_CLI=/home/alice$$staff/.local/bin/instabox"',
    );
  });

  it('selects an executable from ~/.local/bin without copying the caller PATH', async () => {
    const home = await root();
    const bin = join(home, '.local', 'bin');
    const executable = join(bin, 'instabox');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(bin, { recursive: true });
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await chmod(executable, 0o700);
    expect(await resolveInstaboxExecutable({ searchPath: '/missing', home })).toBe(
      await realpath(executable),
    );
  });

  it('installs privately, reports status, and removes only its exact definition', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
      instaboxPath: '/opt/instabox/bin/instabox',
      name: 'work',
    };
    expect(await getWorkspaceServiceStatus(options)).toMatchObject({ state: 'missing' });
    const installed = await installWorkspaceService(options);
    expect(installed.state).toBe('installed');
    expect((await stat(installed.path)).mode & 0o777).toBe(0o600);
    expect(await getWorkspaceServiceStatus(options)).toMatchObject({
      state: 'installed',
      path: installed.path,
    });
    expect((await installWorkspaceService(options)).state).toBe('installed');
    const calls: Array<[string, string[]]> = [];
    const runner = async (command: string, args: string[]) => {
      calls.push([command, args]);
      return { code: args.includes('is-active') ? 3 : 0, stdout: '', stderr: '' };
    };
    expect(await removeWorkspaceService(options, runner)).toMatchObject({ state: 'removed' });
    expect(calls).toEqual([
      ['/usr/bin/systemctl', ['--user', 'is-active', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'disable', '--now', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'daemon-reload']],
    ]);
    expect(await getWorkspaceServiceStatus(options)).toMatchObject({ state: 'missing' });
  });

  it('refuses to replace or remove a colliding definition', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
      instaboxPath: '/opt/instabox/bin/instabox',
      name: 'work',
    };
    const { path } = workspaceServicePaths(options);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(home, '.config/systemd/user'), { recursive: true });
    await writeFile(path, 'user-owned service');
    await expect(installWorkspaceService(options)).rejects.toThrow(/collision/i);
    expect(await readFile(path, 'utf8')).toBe('user-owned service');
    await expect(removeWorkspaceService(options)).rejects.toThrow(/ownership/i);
    expect(await readFile(path, 'utf8')).toBe('user-owned service');
  });

  it('recognizes and updates a service after the Node, CLI, or config path changes', async () => {
    const home = await root();
    const original = {
      platform: 'linux' as const,
      home,
      cliPath: '/old/node/cli.js',
      nodePath: '/old/node/bin/node',
      configPath: '/old/config.json',
      instaboxPath: '/old/local/bin/instabox',
      name: 'work',
    };
    const installed = await installWorkspaceService(original);
    expect(installed.updated).toBe(false);

    const relocated = {
      ...original,
      cliPath: '/new/tooling/cli.js',
      nodePath: '/new/node/bin/node',
      configPath: '/new/config.json',
      instaboxPath: '/new/local/bin/instabox',
    };
    expect(await getWorkspaceServiceStatus(relocated)).toMatchObject({ state: 'installed' });
    expect(await installWorkspaceService(relocated)).toMatchObject({
      state: 'installed',
      updated: true,
    });
    const content = await readFile(installed.path, 'utf8');
    expect(content).toContain('"/new/node/bin/node"');
    expect(content).toContain('"/new/tooling/cli.js"');
    expect(content).toContain('AGENT_DRIVE_CONFIG=/new/config.json');
    expect(content).toContain('AGENT_DRIVE_INSTABOX_CLI=/new/local/bin/instabox');
    expect(content).not.toContain('/old/');
  });

  it('recognizes the prior private Linux unit format before relocation', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/new/tooling/cli.js',
      nodePath: '/new/node/bin/node',
      configPath: '/new/config.json',
      instaboxPath: '/new/local/bin/instabox',
      name: 'work',
    };
    const { directory, path } = workspaceServicePaths(options);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const oldDefinition = [
      '# Managed by Agent Drive. Do not edit while the named mount is installed.',
      '[Unit]',
      'Description=Agent Drive persistent mount work',
      '',
      '[Service]',
      'Environment="PATH=/old/node/bin:/usr/local/bin:/usr/bin"',
      'Environment="AGENT_DRIVE_CONFIG=/old/config.json"',
      'Type=simple',
      'ExecStart="/old/node/bin/node" "/old/cli.js" "mount" "--name" "work"',
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n');
    await writeFile(path, oldDefinition, { mode: 0o600 });

    expect(await getWorkspaceServiceStatus(options)).toMatchObject({ state: 'installed' });
    expect(await installWorkspaceService(options)).toMatchObject({ updated: true });
    expect(await readFile(path, 'utf8')).toContain('# agent-drive-workspace-service:v1:work');
  });

  it('rejects unsafe names and paths before rendering', () => {
    expect(() =>
      renderWorkspaceService({
        platform: 'linux',
        cliPath: '/x/cli.js',
        nodePath: '/usr/bin/node',
        name: '../work',
      }),
    ).toThrow(/name/i);
    expect(() =>
      renderWorkspaceService({
        platform: 'linux',
        cliPath: '/x\nExecStart=evil',
        nodePath: '/usr/bin/node',
        name: 'work',
      }),
    ).toThrow(/path/i);
  });

  it('activates, checks, and deactivates only the owned systemd unit using argv calls', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
      instaboxPath: '/opt/instabox/bin/instabox',
      name: 'work',
    };
    await installWorkspaceService(options);
    const calls: Array<[string, string[]]> = [];
    const results = [3, 0, 0, 0, 0, 0];
    const runner = async (command: string, args: string[]) => {
      calls.push([command, args]);
      return { code: results.shift() ?? 0, stdout: 'active', stderr: '' };
    };
    await activateWorkspaceService(options, runner);
    expect(await getWorkspaceServiceRuntimeStatus(options, runner)).toMatchObject({
      state: 'installed',
      active: true,
    });
    await deactivateWorkspaceService(options, runner);
    expect(calls).toEqual([
      ['/usr/bin/systemctl', ['--user', 'is-active', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'daemon-reload']],
      ['/usr/bin/systemctl', ['--user', 'enable', '--now', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'is-active', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'is-active', 'agent-drive-mount-work.service']],
      ['/usr/bin/systemctl', ['--user', 'disable', '--now', 'agent-drive-mount-work.service']],
    ]);
  });

  it('does not call a service manager when definition ownership is uncertain', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
      name: 'work',
    };
    const runner = async () => {
      throw new Error('runner should not be called');
    };
    await expect(activateWorkspaceService(options, runner)).rejects.toThrow(
      /definition is missing/i,
    );
  });

  it('restarts only an active, owned service', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
      instaboxPath: '/opt/instabox/bin/instabox',
      name: 'work',
    };
    await installWorkspaceService(options);
    const calls: string[][] = [];
    const results = [0, 0, 0, 3, 0, 0, 0];
    const runner = async (_command: string, args: string[]) => {
      calls.push(args);
      return { code: results.shift() ?? 0, stdout: '', stderr: '' };
    };
    expect(await restartWorkspaceService(options, runner)).toEqual({
      restarted: true,
      active: true,
    });
    expect(calls).toEqual([
      ['--user', 'is-active', 'agent-drive-mount-work.service'],
      ['--user', 'is-active', 'agent-drive-mount-work.service'],
      ['--user', 'disable', '--now', 'agent-drive-mount-work.service'],
      ['--user', 'is-active', 'agent-drive-mount-work.service'],
      ['--user', 'daemon-reload'],
      ['--user', 'enable', '--now', 'agent-drive-mount-work.service'],
      ['--user', 'is-active', 'agent-drive-mount-work.service'],
    ]);
  });
});

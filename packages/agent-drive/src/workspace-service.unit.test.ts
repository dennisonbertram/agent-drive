import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
      configPath: '/Users/alice/.config/agent-drive/custom.json',
      name: 'team-work',
    });
    expect(mac).toContain('<string>/Applications/Agent Drive/bin/cli.js</string>');
    expect(mac).toContain('<string>team-work</string>');
    expect(mac).toContain(
      '<key>PATH</key><string>/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>',
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
      configPath: '/home/alice/.config/agent-drive/custom.json',
      name: 'team-work',
    });
    expect(linux).toContain(
      'ExecStart="/usr/bin/node" "/home/alice/Agent Drive/cli.js" "mount" "--name" "team-work"',
    );
    expect(linux).toContain(
      'Environment="PATH=/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin"',
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
      name: 'work',
    });
    expect(escaped).toContain('"/home/alice$$staff/node/bin/node"');
    expect(escaped).toContain('Environment="PATH=/home/alice$$staff/node/bin:');
  });

  it('installs privately, reports status, and removes only its exact definition', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
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
    expect(await removeWorkspaceService(options)).toMatchObject({ state: 'removed' });
    expect(await getWorkspaceServiceStatus(options)).toMatchObject({ state: 'missing' });
  });

  it('refuses to replace or remove a colliding definition', async () => {
    const home = await root();
    const options = {
      platform: 'linux' as const,
      home,
      cliPath: '/opt/agent-drive/cli.js',
      nodePath: '/usr/bin/node',
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
});

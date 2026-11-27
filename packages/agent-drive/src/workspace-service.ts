import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export type WorkspaceServicePlatform = 'darwin' | 'linux';
export type WorkspaceServiceOptions = {
  platform?: WorkspaceServicePlatform;
  home?: string;
  name: string;
  cliPath: string;
  nodePath?: string;
  configPath?: string;
};
export type WorkspaceServicePaths = { directory: string; path: string };
export type WorkspaceServiceStatus = {
  state: 'missing' | 'installed' | 'conflict';
  path: string;
};
export type WorkspaceServiceCommandResult = { code: number; stdout: string; stderr: string };
export type WorkspaceServiceRunner = (
  command: string,
  args: string[],
) => Promise<WorkspaceServiceCommandResult>;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const execFileAsync = promisify(execFile);

const runCommand: WorkspaceServiceRunner = async (command, args) => {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8', timeout: 15_000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (typeof failure.code === 'number')
      return { code: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    throw new Error(`Could not run ${command}: ${failure.message}`);
  }
};

function platformOf(value?: WorkspaceServicePlatform): WorkspaceServicePlatform {
  const platform = value ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux')
    throw new Error(`Persistent mounts are unsupported on ${platform}`);
  return platform;
}

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid workspace service name');
}

function validatePath(value: string, label: string): void {
  if (!value || value.includes('\0') || /[\r\n]/.test(value) || !value.startsWith('/'))
    throw new Error(`${label} must be a newline-free absolute path`);
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function systemdArg(value: string): string {
  // ExecStart is parsed by systemd, not a shell. Double quoted arguments preserve spaces;
  // percent and dollar are escaped because systemd expands specifiers and variables.
  return `"${value
    .replaceAll('%', '%%')
    .replaceAll('$', () => '$$')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')}"`;
}

function servicePath(nodePath: string): string {
  return [
    ...new Set([
      dirname(nodePath),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]),
  ].join(':');
}

export function workspaceServicePaths(
  options: Pick<WorkspaceServiceOptions, 'platform' | 'home' | 'name'>,
): WorkspaceServicePaths {
  validateName(options.name);
  const platform = platformOf(options.platform);
  const home = options.home ?? process.env.HOME;
  if (!home) throw new Error('Could not determine the user home directory');
  validatePath(home, 'Home directory');
  const directory =
    platform === 'darwin'
      ? join(home, 'Library', 'LaunchAgents')
      : join(home, '.config', 'systemd', 'user');
  const filename =
    platform === 'darwin'
      ? `com.agentdrive.mount.${options.name}.plist`
      : `agent-drive-mount-${options.name}.service`;
  return { directory, path: join(directory, filename) };
}

export function renderWorkspaceService(
  options: Pick<
    WorkspaceServiceOptions,
    'platform' | 'name' | 'cliPath' | 'nodePath' | 'configPath'
  >,
): string {
  validateName(options.name);
  validatePath(options.cliPath, 'CLI path');
  const platform = platformOf(options.platform);
  const nodePath = options.nodePath ?? process.execPath;
  validatePath(nodePath, 'Node path');
  const path = servicePath(nodePath);
  const configFilePath = resolve(
    options.configPath ?? join(homedir(), '.config', 'agent-drive', 'config.json'),
  );
  validatePath(configFilePath, 'Agent Drive config path');
  if (platform === 'darwin') {
    const label = `com.agentdrive.mount.${options.name}`;
    const args = [nodePath, options.cliPath, 'mount', '--name', options.name]
      .map((arg) => `    <string>${xml(arg)}</string>`)
      .join('\n');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      `  <key>Label</key><string>${xml(label)}</string>`,
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      `    <key>PATH</key><string>${xml(path)}</string>`,
      `    <key>AGENT_DRIVE_CONFIG</key><string>${xml(configFilePath)}</string>`,
      '  </dict>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      args,
      '  </array>',
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      '  <key>StandardOutPath</key><string>/dev/null</string>',
      '  <key>StandardErrorPath</key><string>/dev/null</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }
  return [
    '# Managed by Agent Drive. Do not edit while the named mount is installed.',
    '[Unit]',
    `Description=Agent Drive persistent mount ${options.name}`,
    '',
    '[Service]',
    `Environment=${systemdArg(`PATH=${path}`)}`,
    `Environment=${systemdArg(`AGENT_DRIVE_CONFIG=${configFilePath}`)}`,
    'Type=simple',
    `ExecStart=${[nodePath, options.cliPath, 'mount', '--name', options.name].map(systemdArg).join(' ')}`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function contents(options: WorkspaceServiceOptions): string {
  return renderWorkspaceService(options);
}

export async function getWorkspaceServiceStatus(
  options: WorkspaceServiceOptions,
): Promise<WorkspaceServiceStatus> {
  const { path } = workspaceServicePaths(options);
  let existing: string;
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      (info.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())
    )
      return { state: 'conflict', path };
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', path };
    throw error;
  }
  return { state: existing === contents(options) ? 'installed' : 'conflict', path };
}

export async function installWorkspaceService(
  options: WorkspaceServiceOptions,
): Promise<{ state: 'installed'; path: string }> {
  const { directory, path } = workspaceServicePaths(options);
  const expected = contents(options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const current = await getWorkspaceServiceStatus(options);
  if (current.state === 'installed') return { state: 'installed', path };
  if (current.state === 'conflict') throw new Error(`Service definition collision at ${path}`);

  // Write a private temporary file, then hard-link it into place without replacing a collision.
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(expected, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new Error(`Service definition collision at ${path}`);
      throw error;
    });
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return { state: 'installed', path };
}

export async function removeWorkspaceService(
  options: WorkspaceServiceOptions,
): Promise<{ state: 'removed' | 'missing'; path: string }> {
  const status = await getWorkspaceServiceStatus(options);
  if (status.state === 'missing') return { state: 'missing', path: status.path };
  if (status.state === 'conflict')
    throw new Error(
      `Refusing to remove a service definition without matching ownership at ${status.path}`,
    );
  // Re-read just before unlink so edits made after the status check are preserved.
  const current = await readFile(status.path, 'utf8');
  if (current !== contents(options))
    throw new Error(
      `Refusing to remove a service definition without matching ownership at ${status.path}`,
    );
  await unlink(status.path);
  return { state: 'removed', path: status.path };
}

function serviceTarget(options: WorkspaceServiceOptions) {
  const platform = platformOf(options.platform);
  const paths = workspaceServicePaths(options);
  return platform === 'darwin'
    ? { platform, paths, unit: `com.agentdrive.mount.${options.name}` }
    : { platform, paths, unit: `agent-drive-mount-${options.name}.service` };
}

function launchAgentDomain(): string {
  if (typeof process.getuid !== 'function')
    throw new Error('Could not determine the current user for launchctl');
  return `gui/${process.getuid()}`;
}

async function assertOwned(options: WorkspaceServiceOptions): Promise<WorkspaceServicePaths> {
  const status = await getWorkspaceServiceStatus(options);
  if (status.state !== 'installed')
    throw new Error(
      `Refusing service-manager operation because the definition is ${status.state}: ${status.path}`,
    );
  return workspaceServicePaths(options);
}

export async function activateWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<void> {
  const target = serviceTarget(options);
  const paths = await assertOwned(options);
  const runtime = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (runtime.active) return;
  const commands: Array<[string, string[]]> =
    target.platform === 'darwin'
      ? [['/bin/launchctl', ['bootstrap', launchAgentDomain(), paths.path]]]
      : [
          ['/usr/bin/systemctl', ['--user', 'daemon-reload']],
          ['/usr/bin/systemctl', ['--user', 'enable', '--now', target.unit]],
        ];
  for (const [command, args] of commands) {
    const result = await runner(command, args);
    if (result.code !== 0)
      throw new Error(
        `Could not activate workspace service (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`,
      );
  }
}

export async function deactivateWorkspaceService(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<void> {
  const target = serviceTarget(options);
  const paths = await assertOwned(options);
  const runtime = await getWorkspaceServiceRuntimeStatus(options, runner);
  if (!runtime.active) return;
  const command = target.platform === 'darwin' ? '/bin/launchctl' : '/usr/bin/systemctl';
  const args =
    target.platform === 'darwin'
      ? ['bootout', launchAgentDomain(), paths.path]
      : ['--user', 'disable', '--now', target.unit];
  const result = await runner(command, args);
  if (result.code !== 0)
    throw new Error(
      `Could not deactivate workspace service (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`,
    );
}

export async function getWorkspaceServiceRuntimeStatus(
  options: WorkspaceServiceOptions,
  runner: WorkspaceServiceRunner = runCommand,
): Promise<WorkspaceServiceStatus & { active: boolean }> {
  const target = serviceTarget(options);
  const status = await getWorkspaceServiceStatus(options);
  if (status.state !== 'installed') return { ...status, active: false };
  const command = target.platform === 'darwin' ? '/bin/launchctl' : '/usr/bin/systemctl';
  const args =
    target.platform === 'darwin'
      ? ['print', `${launchAgentDomain()}/${target.unit}`]
      : ['--user', 'is-active', target.unit];
  const result = await runner(command, args);
  return { ...status, active: result.code === 0 };
}
